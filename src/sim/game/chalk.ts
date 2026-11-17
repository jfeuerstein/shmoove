/**
 * Chalk lines: record a route, share it as a code, race its ghost.
 *
 * A recording is the skater's quantised input, one frame per tick, from a canonical start state
 * (position, heading and speed on the ground: everything else fresh). Because the sim is a pure
 * function of the start state, the inputs and the clock, replaying the frames from the same start
 * at the same time of day reproduces the run bit for bit, rides included. A race therefore moves
 * the clock forward to the recording's time of day (minus a countdown) and steps a second skater,
 * the ghost, in the same world with the recorded frames while the player skates against it.
 *
 * Frames are run-length encoded as (steerByte, flags, runLength) triples: steerByte is the
 * quantised steer + 127 (0..254), flags bit 0 is hold and bit 1 hop, runLength 1..255.
 *
 * Share code: `SK1-` + base64url (no padding) of version u8, name (u8 length + UTF-8),
 * startDayTick u16, x/z/heading/speed f64, endX/endY/endZ f32, ticks u16, input byte count u16,
 * input bytes, CRC-32 of everything before it. All little-endian. base64url and UTF-8 are written
 * here by hand: the sim has no DOM helpers.
 */
import { DAY_TICKS } from '../constants';
import { createPlayer, placePlayer, stepPlayer } from '../player';
import { Mode, type InputFrame, type SimCtx, type SimEvent } from '../types';
import { topHeight, type World } from '../world';
import type { Game, GameReducer } from './game';

export interface ChalkLine {
  v: 1;
  /** Stable hash of the route (start, end, frames; not the name), so re-importing is a no-op. */
  id: string;
  /** Up to 24 characters. */
  name: string;
  /** 0..DAY_TICKS-1, the time of day the recording started. */
  startDayTick: number;
  /** Canonical start. */
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Run-length encoded frames. */
  inputs: Uint8Array;
  /** Length of the recording, ticks. */
  ticks: number;
  /** Where the recording stopped: the centre of the finish zone (float32 values). */
  endX: number;
  endY: number;
  endZ: number;
  /** Best player time in a race, or 0 if never finished. */
  bestTicks: number;
}

/** Finish zone radius in plan, metres (also needs |dy| < CHALK_END_DY). */
export const CHALK_END_RADIUS = 6;
export const CHALK_END_DY = 4;
export const CHALK_MAX_TICKS = 4 * 60 * 60;
export const CHALK_MIN_TICKS = 5 * 60;
export const CHALK_COUNTDOWN_TICKS = 3 * 60;
export const CHALK_MAX_LINES = 20;
/** A race is lost this long after the ghost finishes. */
export const CHALK_TIMEOUT_TICKS = 20 * 60;
export const CHALK_NAME_MAX = 24;
export const CHALK_CODE_PREFIX = 'SK1-';
/** Path samples for drawing and progress: one every this many ticks. */
export const CHALK_PATH_STRIDE = 6;

export const CHALK_VERSION = 1;

export type CommandResult = { ok: true } | { ok: false; reason: string };

export type ChalkMode = 'idle' | 'recording' | 'countdown' | 'racing';

/** What the UI and renderer read. Owned and written by the chalk reducer only. */
export interface ChalkState {
  lines: ChalkLine[];
  mode: ChalkMode;
  /** Recording: ticks recorded. Countdown: ticks of countdown gone. Racing: the player's time. */
  elapsedTicks: number;
  /** The ghost skater while a race (or its countdown) runs. */
  ghost: SimCtx | null;
  /** Ghost position before its last step, for interpolation. */
  ghostPrevX: number;
  ghostPrevY: number;
  ghostPrevZ: number;
  /** The ghost has played its whole recording (it stays where it stopped). */
  ghostFinished: boolean;
  /** The line being raced, or null. */
  activeId: string | null;
}

const OK: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

// ---------------------------------------------------------------------------------------------
// Names

/** A cleaned name: control characters dropped, whitespace collapsed, trimmed, at most 24 chars. */
export function cleanChalkName(raw: string): string {
  let out = '';
  let n = 0;
  let space = false;
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0) || c === 0x2028 || c === 0x2029) {
      space = out.length > 0;
      continue;
    }
    if (ch === ' ' || ch === ' ' || ch === '　') {
      space = out.length > 0;
      continue;
    }
    if (space) {
      if (n >= CHALK_NAME_MAX - 1) break;
      out += ' ';
      n++;
      space = false;
    }
    if (n >= CHALK_NAME_MAX) break;
    out += ch;
    n++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Bytes: CRC-32, base64url, UTF-8, little-endian numbers

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of bytes [0, end). */
export function crc32(bytes: Uint8Array, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = 0; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** base64url without padding. */
export function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63];
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63];
  }
  return s;
}

/**
 * Strict base64url decode (no padding). Returns null for a character outside the alphabet, an
 * impossible length, or non-zero unused bits in the last character (so every code has exactly
 * one spelling and a changed character can never decode to the same bytes).
 */
export function base64urlDecode(s: string): Uint8Array | null {
  const n = s.length;
  if (n % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

function utf8Encode(s: string, out: number[]): void {
  for (const ch of s) {
    let c = ch.codePointAt(0) ?? 0xfffd;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
}

/** Strict UTF-8 decode of bytes [a, b); null when malformed. */
function utf8Decode(bytes: Uint8Array, a: number, b: number): string | null {
  let s = '';
  let i = a;
  while (i < b) {
    const c0 = bytes[i];
    let need = 0;
    let c = 0;
    let min = 0;
    if (c0 < 0x80) {
      s += String.fromCharCode(c0);
      i++;
      continue;
    } else if (c0 >= 0xc2 && c0 < 0xe0) {
      need = 1;
      c = c0 & 31;
      min = 0x80;
    } else if (c0 >= 0xe0 && c0 < 0xf0) {
      need = 2;
      c = c0 & 15;
      min = 0x800;
    } else if (c0 >= 0xf0 && c0 < 0xf5) {
      need = 3;
      c = c0 & 7;
      min = 0x10000;
    } else return null;
    if (i + need >= b) return null;
    for (let k = 1; k <= need; k++) {
      const cb = bytes[i + k];
      if ((cb & 0xc0) !== 0x80) return null;
      c = (c << 6) | (cb & 63);
    }
    if (c < min || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return null;
    s += String.fromCodePoint(c);
    i += need + 1;
  }
  return s;
}

const _dv = new DataView(new ArrayBuffer(8));

function putU16(out: number[], v: number): void {
  out.push(v & 255, (v >> 8) & 255);
}
function putF64(out: number[], v: number): void {
  _dv.setFloat64(0, v, true);
  for (let i = 0; i < 8; i++) out.push(_dv.getUint8(i));
}
function putF32(out: number[], v: number): void {
  _dv.setFloat32(0, v, true);
  for (let i = 0; i < 4; i++) out.push(_dv.getUint8(i));
}
function getF64(b: Uint8Array, at: number): number {
  for (let i = 0; i < 8; i++) _dv.setUint8(i, b[at + i]);
  return _dv.getFloat64(0, true);
}
function getF32(b: Uint8Array, at: number): number {
  for (let i = 0; i < 4; i++) _dv.setUint8(i, b[at + i]);
  return _dv.getFloat32(0, true);
}

// ---------------------------------------------------------------------------------------------
// Packing

/** The route part of the packing (everything after the name, before the CRC). */
function packRoute(line: ChalkLine, out: number[]): void {
  putU16(out, line.startDayTick);
  putF64(out, line.x);
  putF64(out, line.z);
  putF64(out, line.heading);
  putF64(out, line.speed);
  putF32(out, line.endX);
  putF32(out, line.endY);
  putF32(out, line.endZ);
  putU16(out, line.ticks);
  putU16(out, line.inputs.length);
  for (let i = 0; i < line.inputs.length; i++) out.push(line.inputs[i]);
}

function hex8(v: number): string {
  return (v >>> 0).toString(16).padStart(8, '0');
}

/** The id of a route: two independent 32-bit hashes of its packing, name excluded. */
export function chalkId(line: ChalkLine): string {
  const out: number[] = [];
  packRoute(line, out);
  const bytes = Uint8Array.from(out);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return hex8(crc32(bytes)) + hex8(h);
}

/** The binary packing of a line, CRC included (exported for tests that build edge cases). */
export function packChalk(line: ChalkLine, version = CHALK_VERSION): Uint8Array {
  const out: number[] = [version & 255];
  const name: number[] = [];
  utf8Encode(cleanChalkName(line.name), name);
  out.push(name.length);
  for (const b of name) out.push(b);
  packRoute(line, out);
  const bytes = new Uint8Array(out.length + 4);
  bytes.set(out);
  const c = crc32(bytes, out.length);
  bytes[out.length] = c & 255;
  bytes[out.length + 1] = (c >>> 8) & 255;
  bytes[out.length + 2] = (c >>> 16) & 255;
  bytes[out.length + 3] = (c >>> 24) & 255;
  return bytes;
}

/** Share code from a packing (exported for tests). */
export function codeFromBytes(bytes: Uint8Array): string {
  return CHALK_CODE_PREFIX + base64urlEncode(bytes);
}

export function encodeChalk(line: ChalkLine): string {
  return codeFromBytes(packChalk(line));
}

/** Sum of run lengths, or -1 if the runs are malformed (bad length, steer or flags). */
export function runTotal(inputs: Uint8Array): number {
  if (inputs.length % 3 !== 0) return -1;
  let total = 0;
  for (let i = 0; i < inputs.length; i += 3) {
    if (inputs[i] > 254 || inputs[i + 1] > 3 || inputs[i + 2] < 1) return -1;
    total += inputs[i + 2];
  }
  return total;
}

/** Parse a share code. Never throws; every failure is a short distinct reason. */
export function decodeChalk(code: string): ChalkLine | { error: string } {
  if (typeof code !== 'string') return { error: 'not a code' };
  const s = code.replace(/\s+/g, '');
  if (s.length === 0) return { error: 'empty code' };
  if (!s.startsWith(CHALK_CODE_PREFIX)) return { error: 'not a chalk code' };
  const b = base64urlDecode(s.slice(CHALK_CODE_PREFIX.length));
  if (b === null) return { error: 'bad characters' };
  if (b.length < 1) return { error: 'truncated' };
  if (b[0] !== CHALK_VERSION) return { error: 'unknown version' };
  let at = 1;
  if (at + 1 > b.length) return { error: 'truncated' };
  const nameLen = b[at++];
  const nameAt = at;
  at += nameLen;
  // startDayTick 2, 4 x f64 32, 3 x f32 12, ticks 2, count 2.
  if (at + 50 > b.length) return { error: 'truncated' };
  const startDayTick = b[at] | (b[at + 1] << 8);
  at += 2;
  const x = getF64(b, at);
  const z = getF64(b, at + 8);
  const heading = getF64(b, at + 16);
  const speed = getF64(b, at + 24);
  at += 32;
  const endX = getF32(b, at);
  const endY = getF32(b, at + 4);
  const endZ = getF32(b, at + 8);
  at += 12;
  const ticks = b[at] | (b[at + 1] << 8);
  const count = b[at + 2] | (b[at + 3] << 8);
  at += 4;
  if (at + count + 4 > b.length) return { error: 'truncated' };
  const inputs = b.slice(at, at + count);
  at += count;
  if (at + 4 !== b.length) return { error: 'trailing bytes' };
  const crc = (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  if (crc !== crc32(b, at)) return { error: 'checksum mismatch' };
  const name = utf8Decode(b, nameAt, nameAt + nameLen);
  if (name === null) return { error: 'bad name' };
  if (startDayTick >= DAY_TICKS) return { error: 'bad start time' };
  if (ticks < CHALK_MIN_TICKS || ticks > CHALK_MAX_TICKS) return { error: 'length out of range' };
  for (const v of [x, z, heading, speed, endX, endY, endZ]) {
    if (!Number.isFinite(v)) return { error: 'bad number' };
  }
  if (speed < 0) return { error: 'bad number' };
  const total = runTotal(inputs);
  if (total < 0) return { error: 'bad runs' };
  if (total !== ticks) return { error: 'run total mismatch' };
  const line: ChalkLine = {
    v: 1,
    id: '',
    name: cleanChalkName(name),
    startDayTick,
    x,
    z,
    heading,
    speed,
    inputs,
    ticks,
    endX,
    endY,
    endZ,
    bestTicks: 0,
  };
  line.id = chalkId(line);
  return line;
}

export function isChalkError(r: ChalkLine | { error: string }): r is { error: string } {
  return 'error' in r;
}

// ---------------------------------------------------------------------------------------------
// Frames

/** Reads RLE frames one tick at a time. */
export class FrameReader {
  private at = 0;
  private left = 0;
  private inputs: Uint8Array = new Uint8Array(0);
  readonly frame: InputFrame = { steer: 0, hold: false, hop: false };

  reset(inputs: Uint8Array): void {
    this.inputs = inputs;
    this.at = 0;
    this.left = inputs.length >= 3 ? inputs[2] : 0;
  }

  /** The next frame, or null when the recording has run out. */
  next(): InputFrame | null {
    while (this.left === 0) {
      this.at += 3;
      if (this.at + 2 >= this.inputs.length) return null;
      this.left = this.inputs[this.at + 2];
    }
    this.left--;
    const f = this.frame;
    f.steer = (this.inputs[this.at] - 127) / 127;
    const fl = this.inputs[this.at + 1];
    f.hold = (fl & 1) !== 0;
    f.hop = (fl & 2) !== 0;
    return f;
  }
}

/** Put a skater at a line's canonical start (the same call for the player, the ghost and paths). */
export function placeAtStart(world: World, ctx: SimCtx, line: Pick<ChalkLine, 'x' | 'z' | 'heading' | 'speed'>): void {
  placePlayer(world, ctx.player, line.x, line.z, line.heading);
  ctx.player.speed = line.speed;
}

function inZone(line: ChalkLine, x: number, y: number, z: number): boolean {
  const dx = x - line.endX;
  const dz = z - line.endZ;
  return dx * dx + dz * dz < CHALK_END_RADIUS * CHALK_END_RADIUS && Math.abs(y - line.endY) < CHALK_END_DY;
}

const pathCache = new WeakMap<World, Map<string, Float32Array>>();

/**
 * Replay a line headlessly from its canonical start at its time of day and return the skater's
 * xyz at the start, every CHALK_PATH_STRIDE ticks, and at the end. Cached per world and line id.
 */
export function chalkPath(world: World, line: ChalkLine): Float32Array {
  let byWorld = pathCache.get(world);
  if (!byWorld) {
    byWorld = new Map();
    pathCache.set(world, byWorld);
  }
  const hit = byWorld.get(line.id);
  if (hit) return hit;
  const events: SimEvent[] = [];
  const ctx: SimCtx = { world, tick: line.startDayTick, player: createPlayer(), events };
  placeAtStart(world, ctx, line);
  const n = Math.floor(line.ticks / CHALK_PATH_STRIDE) + 1 + (line.ticks % CHALK_PATH_STRIDE ? 1 : 0);
  const out = new Float32Array(n * 3);
  let k = 0;
  const put = (): void => {
    out[k++] = ctx.player.x;
    out[k++] = ctx.player.y;
    out[k++] = ctx.player.z;
  };
  put();
  const rd = new FrameReader();
  rd.reset(line.inputs);
  for (let i = 1; i <= line.ticks; i++) {
    const f = rd.next();
    if (!f) break;
    ctx.tick = line.startDayTick + i;
    events.length = 0;
    stepPlayer(ctx, f);
    if (i % CHALK_PATH_STRIDE === 0 || i === line.ticks) put();
  }
  const path = k === out.length ? out : out.slice(0, k);
  byWorld.set(line.id, path);
  return path;
}

// ---------------------------------------------------------------------------------------------
// Persistence

export interface ChalkData {
  v: 1;
  lines: Array<{ code: string; best: number }>;
}

// ---------------------------------------------------------------------------------------------
// Reducer

/** Records, races and keeps the list of chalk lines. Key 'chalk' in saves. */
export class ChalkReducer implements GameReducer {
  readonly key = 'chalk';
  readonly state: ChalkState = {
    lines: [],
    mode: 'idle',
    elapsedTicks: 0,
    ghost: null,
    ghostPrevX: 0,
    ghostPrevY: 0,
    ghostPrevZ: 0,
    ghostFinished: false,
    activeId: null,
  };
  // Recording.
  private readonly rle = new Uint8Array(CHALK_MAX_TICKS * 3);
  private rleLen = 0;
  private runSteer = -1;
  private runFlags = 0;
  private runLen = 0;
  private recX = 0;
  private recZ = 0;
  private recHeading = 0;
  private recSpeed = 0;
  private recDayTick = 0;
  // Race.
  private race: ChalkLine | null = null;
  private readonly reader = new FrameReader();
  private ghostFrames = 0;
  /** The player has been outside the finish zone since the start (a loop must be ridden). */
  private armed = false;

  constructor(private readonly world: World) {}

  holdsSkater(): boolean {
    return this.state.mode === 'countdown';
  }

  cannotRecord(game: Game): string {
    const st = this.state;
    if (st.mode === 'recording') return 'Already drawing';
    if (st.mode !== 'idle') return 'Racing';
    if (st.lines.length >= CHALK_MAX_LINES) return `List full (${CHALK_MAX_LINES})`;
    const p = game.sim.player;
    if (p.mode === Mode.HITCH) return 'Let go of the ride first';
    if (p.mode === Mode.BAIL) return 'Get back on the board first';
    if (p.mode !== Mode.GROUND) return 'Get on the ground first';
    // The canonical start drops the skater onto the highest surface here: not under a roof.
    if (Math.abs(topHeight(this.world, p.x, p.z) - p.y) > 0.25) return 'Find open ground';
    return '';
  }

  startRecording(game: Game): CommandResult {
    const why = this.cannotRecord(game);
    if (why) return fail(why);
    const p = game.sim.player;
    this.recX = p.x;
    this.recZ = p.z;
    this.recHeading = p.heading;
    this.recSpeed = p.speed;
    this.recDayTick = ((game.sim.tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    placeAtStart(this.world, game.sim, { x: this.recX, z: this.recZ, heading: this.recHeading, speed: this.recSpeed });
    this.rleLen = 0;
    this.runSteer = -1;
    this.runLen = 0;
    this.state.mode = 'recording';
    this.state.elapsedTicks = 0;
    game.queueEvent({ type: 'chalkRecordStart' });
    return OK;
  }

  stopRecording(game: Game, rawName: string): CommandResult {
    if (this.state.mode !== 'recording') return fail('Not drawing');
    const name = cleanChalkName(rawName);
    if (name === '') return fail('Needs a name');
    return this.finishRecording(game, name);
  }

  cancel(game: Game): CommandResult {
    const mode = this.state.mode;
    if (mode === 'recording') {
      this.state.mode = 'idle';
      this.state.elapsedTicks = 0;
      game.queueEvent({ type: 'chalkRecordDiscard', reason: 'cancelled' });
      return OK;
    }
    if (mode === 'countdown' || mode === 'racing') return this.abortRace(game);
    return fail('Nothing to cancel');
  }

  startRace(game: Game, id: string): CommandResult {
    if (this.state.mode !== 'idle') return fail(this.state.mode === 'recording' ? 'Drawing' : 'Already racing');
    const line = this.state.lines.find((l) => l.id === id);
    if (!line) return fail('No such line');
    const sim = game.sim;
    // Forward (never back) to the next tick whose time of day is the countdown's start.
    const want = (((line.startDayTick - CHALK_COUNTDOWN_TICKS) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    const now = ((sim.tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    sim.tick += (want - now + DAY_TICKS) % DAY_TICKS;
    placeAtStart(this.world, sim, line);
    const ghost: SimCtx = { world: this.world, tick: sim.tick, player: createPlayer(), events: [] };
    placeAtStart(this.world, ghost, line);
    const st = this.state;
    st.ghost = ghost;
    st.ghostPrevX = ghost.player.x;
    st.ghostPrevY = ghost.player.y;
    st.ghostPrevZ = ghost.player.z;
    st.ghostFinished = false;
    st.activeId = line.id;
    st.mode = 'countdown';
    st.elapsedTicks = 0;
    this.race = line;
    this.reader.reset(line.inputs);
    this.ghostFrames = 0;
    this.armed = !inZone(line, sim.player.x, sim.player.y, sim.player.z);
    return OK;
  }

  abortRace(game: Game): CommandResult {
    if (this.state.mode !== 'countdown' && this.state.mode !== 'racing') return fail('Not racing');
    this.endRace();
    game.queueEvent({ type: 'chalkAbort' });
    return OK;
  }

  importCode(code: string): CommandResult {
    const r = decodeChalk(code);
    if (isChalkError(r)) return fail(r.error);
    if (this.state.lines.some((l) => l.id === r.id)) return OK;
    if (this.state.lines.length >= CHALK_MAX_LINES) return fail('list full');
    this.state.lines.push(r);
    return OK;
  }

  deleteLine(id: string): CommandResult {
    const i = this.state.lines.findIndex((l) => l.id === id);
    if (i < 0) return fail('No such line');
    if (this.state.activeId === id) return fail('Racing this line');
    this.state.lines.splice(i, 1);
    return OK;
  }

  renameLine(id: string, rawName: string): CommandResult {
    const line = this.state.lines.find((l) => l.id === id);
    if (!line) return fail('No such line');
    const name = cleanChalkName(rawName);
    if (name === '') return fail('Needs a name');
    line.name = name;
    return OK;
  }

  step(game: Game): void {
    switch (this.state.mode) {
      case 'recording':
        this.stepRecording(game);
        break;
      case 'countdown':
        this.stepCountdown(game);
        break;
      case 'racing':
        this.stepRacing(game);
        break;
      default:
        break;
    }
  }

  exportState(): ChalkData {
    return { v: 1, lines: this.state.lines.map((l) => ({ code: encodeChalk(l), best: l.bestTicks })) };
  }

  importState(data: unknown): void {
    const st = this.state;
    st.lines.length = 0;
    if (st.mode === 'countdown' || st.mode === 'racing') this.endRace();
    st.mode = 'idle';
    st.elapsedTicks = 0;
    if (typeof data !== 'object' || data === null || !Array.isArray((data as { lines?: unknown }).lines)) return;
    for (const e of (data as { lines: unknown[] }).lines) {
      if (st.lines.length >= CHALK_MAX_LINES) break;
      if (typeof e !== 'object' || e === null) continue;
      const rec = e as { code?: unknown; best?: unknown };
      if (typeof rec.code !== 'string') continue;
      const r = decodeChalk(rec.code);
      if (isChalkError(r) || st.lines.some((l) => l.id === r.id)) continue;
      const best = rec.best;
      r.bestTicks = typeof best === 'number' && Number.isInteger(best) && best > 0 && best <= 0xffff ? best : 0;
      st.lines.push(r);
    }
  }

  // ------------------------------------------------------------------------------------------

  private flushRun(): void {
    if (this.runLen === 0) return;
    this.rle[this.rleLen++] = this.runSteer;
    this.rle[this.rleLen++] = this.runFlags;
    this.rle[this.rleLen++] = this.runLen;
    this.runLen = 0;
  }

  private stepRecording(game: Game): void {
    const a = game.applied;
    const sb = a.steerQ + 127;
    const fl = (a.hold ? 1 : 0) | (a.hop ? 2 : 0);
    if (this.runLen > 0 && (sb !== this.runSteer || fl !== this.runFlags || this.runLen === 255)) this.flushRun();
    if (this.runLen === 0) {
      this.runSteer = sb;
      this.runFlags = fl;
    }
    this.runLen++;
    this.state.elapsedTicks++;
    const p = game.sim.player;
    if (p.mode === Mode.BAIL && p.bailWater === 1) {
      this.state.mode = 'idle';
      this.state.elapsedTicks = 0;
      game.events.push({ type: 'chalkRecordDiscard', reason: 'fell in the water' });
      return;
    }
    if (this.state.elapsedTicks >= CHALK_MAX_TICKS) {
      this.finishRecording(game, `Chalk ${this.state.lines.length + 1}`, true);
    }
  }

  private finishRecording(game: Game, name: string, inStep = false): CommandResult {
    const st = this.state;
    const ticks = st.elapsedTicks;
    st.mode = 'idle';
    st.elapsedTicks = 0;
    const emit = (e: Parameters<Game['queueEvent']>[0]): void => {
      if (inStep) game.events.push(e);
      else game.queueEvent(e);
    };
    if (ticks < CHALK_MIN_TICKS) {
      const reason = 'too short';
      emit({ type: 'chalkRecordDiscard', reason });
      return fail(reason);
    }
    if (st.lines.length >= CHALK_MAX_LINES) {
      emit({ type: 'chalkRecordDiscard', reason: 'list full' });
      return fail('list full');
    }
    this.flushRun();
    const p = game.sim.player;
    const line: ChalkLine = {
      v: 1,
      id: '',
      name,
      startDayTick: this.recDayTick,
      x: this.recX,
      z: this.recZ,
      heading: this.recHeading,
      speed: this.recSpeed,
      inputs: this.rle.slice(0, this.rleLen),
      ticks,
      endX: Math.fround(p.x),
      endY: Math.fround(p.y),
      endZ: Math.fround(p.z),
      bestTicks: 0,
    };
    line.id = chalkId(line);
    if (!st.lines.some((l) => l.id === line.id)) st.lines.push(line);
    emit({ type: 'chalkRecordStop', id: line.id, ticks });
    return OK;
  }

  private stepCountdown(game: Game): void {
    const st = this.state;
    st.elapsedTicks++;
    const left = CHALK_COUNTDOWN_TICKS - st.elapsedTicks;
    if (left <= 0) {
      st.mode = 'racing';
      st.elapsedTicks = 0;
      game.events.push({ type: 'chalkGo' });
      return;
    }
    const secs = Math.ceil(left / 60);
    const before = Math.ceil((left + 1) / 60);
    if (st.elapsedTicks === 1 || secs !== before) game.events.push({ type: 'chalkCountdown', secondsLeft: secs });
  }

  private stepRacing(game: Game): void {
    const st = this.state;
    const line = this.race;
    const ghost = st.ghost;
    if (!line || !ghost) {
      this.endRace();
      return;
    }
    const g = ghost.player;
    st.ghostPrevX = g.x;
    st.ghostPrevY = g.y;
    st.ghostPrevZ = g.z;
    if (!st.ghostFinished) {
      const f = this.reader.next();
      if (f) {
        ghost.tick = game.sim.tick;
        ghost.events.length = 0;
        stepPlayer(ghost, f);
        this.ghostFrames++;
      }
      if (!f || this.ghostFrames >= line.ticks) st.ghostFinished = true;
    } else ghost.events.length = 0;
    st.elapsedTicks++;
    const p = game.sim.player;
    const t = st.elapsedTicks;
    if (inZone(line, p.x, p.y, p.z)) {
      if (this.armed) {
        const won = t <= line.ticks;
        const best = line.bestTicks === 0 || t < line.bestTicks;
        if (best) line.bestTicks = t;
        game.events.push({ type: 'chalkFinish', id: line.id, ticks: t, ghostTicks: line.ticks, won, best });
        this.endRace();
        return;
      }
    } else this.armed = true;
    if (st.ghostFinished && t >= line.ticks + CHALK_TIMEOUT_TICKS) {
      game.events.push({ type: 'chalkFinish', id: line.id, ticks: 0, ghostTicks: line.ticks, won: false, best: false });
      this.endRace();
    }
  }

  private endRace(): void {
    const st = this.state;
    st.mode = 'idle';
    st.elapsedTicks = 0;
    st.ghost = null;
    st.ghostFinished = false;
    st.activeId = null;
    this.race = null;
  }
}
