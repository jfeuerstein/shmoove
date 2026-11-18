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
 * In memory a line keeps its frames decoded, one 16-bit word per tick: the steer level + 31 (0..62)
 * in bits 0-5, hold in bit 6, hop in bit 7, brake in bit 8. Only the share code (and so the save) is
 * packed densely.
 *
 * Share code: `SK2-` + base64url (no padding) of version u8 (2), name (u8 length + UTF-8),
 * startDayTick u16, x/z/heading/speed f64, endX/endY/endZ f32, ticks u16 (bit 15 set when the line
 * brakes; a line is never longer than 2^15 ticks), input byte count (LEB128, minimal), input bytes,
 * CRC-32 of everything before it. All little-endian. base64url and UTF-8 are written here by hand:
 * the sim has no DOM helpers.
 *
 * Input bytes are one stream from an adaptive binary arithmetic coder (32-bit integer interval,
 * carry-less, 12-bit probabilities that adapt per context). Three sections follow each other in it:
 * every tick's steer as a delta from the previous tick's level, modelled on the previous delta (or,
 * after a zero delta, on how long steer has been still); then the gaps between hold toggles; then the
 * gaps between hops, each gap Elias-gamma binarised; then, only for a line that brakes (the flag in
 * `ticks`), the gaps between brake toggles. A line without braking codes exactly as it did before the
 * brake existed. Decoding is bounded by `ticks` and re-encodes what it decoded to check the stream
 * byte for byte, so every line has exactly one code (the brake flag is set if and only if it brakes).
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
  /** Decoded frames, one word per tick (see `packFrame`); `ticks` long. */
  inputs: Uint16Array;
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
export const CHALK_CODE_PREFIX = 'SK2-';
const CHALK_V1_PREFIX = 'SK1-';
/** Path samples for drawing and progress: one every this many ticks. */
export const CHALK_PATH_STRIDE = 6;

export const CHALK_VERSION = 2;

/** Frame bits above the steer level. */
const HOLD_BIT = 64;
const HOP_BIT = 128;
const BRAKE_BIT = 256;
/** In the packed `ticks` field: the line brakes, and its stream has a brake section. */
const TICKS_BRAKE_FLAG = 0x8000;

/**
 * Steer levels each side of centre. `Game.step` quantises steer to these (the sim only ever sees a
 * multiple of 1/STEER_LEVELS), and a recorded frame stores the level.
 */
export const STEER_LEVELS = 31;

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
// Frames

/** One recorded tick as a word: steer level + 31 in bits 0-5, hold bit 6, hop bit 7, brake bit 8. */
export function packFrame(steerQ: number, hold: boolean, hop: boolean, brake = false): number {
  return (steerQ + STEER_LEVELS) | (hold ? HOLD_BIT : 0) | (hop ? HOP_BIT : 0) | (brake ? BRAKE_BIT : 0);
}

/** Whether any frame brakes. */
function framesBrake(frames: Uint16Array, ticks: number): boolean {
  for (let t = 0; t < ticks; t++) if ((frames[t] & BRAKE_BIT) !== 0) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic coder
//
// A carry-less binary arithmetic coder over a 32-bit integer interval [x1, x2] (the lpaq scheme).
// Each decision splits the interval at x1 + (x2 - x1) / 4096 * p, where p is the context's 12-bit
// estimate that the bit is 1, and emits leading bytes once x1 and x2 agree on them. Probabilities
// are 16-bit integers that move toward each coded bit by a shift that starts fast and settles. All
// values are integers below 2^32, so every engine computes the same bytes.
//
// The same routines encode, decode and verify: a binarisation is written once against `bit(ctx, y)`,
// which codes `y` when encoding and returns the decoded bit when decoding (ignoring `y`).

/** Context layout. */
const STEER_CTX = 16;
const UNARY_MAX = 10;
const CTX_ZERO = 0;
const CTX_SIGN = CTX_ZERO + STEER_CTX;
const CTX_MAG = CTX_SIGN + STEER_CTX;
const CTX_ESC = CTX_MAG + STEER_CTX * UNARY_MAX;
const ESC_BITS = 6;
const GAP_UNARY = 15;
const GAP_MODEL = GAP_UNARY + GAP_UNARY * GAP_UNARY;
const CTX_GAP = CTX_ESC + (1 << ESC_BITS);
/** Gap models: hold off -> on, hold on -> off, hops, brake off -> on, brake on -> off. */
const GAP_HOLD_ON = CTX_GAP;
const GAP_HOLD_OFF = CTX_GAP + GAP_MODEL;
const GAP_HOP = CTX_GAP + 2 * GAP_MODEL;
const GAP_BRAKE_ON = CTX_GAP + 3 * GAP_MODEL;
const GAP_BRAKE_OFF = CTX_GAP + 4 * GAP_MODEL;
const CTX_COUNT = CTX_GAP + 5 * GAP_MODEL;
/** Adaptation shift by how often a context has been used: fast at first, then steady. */
const RATE = Uint8Array.from([1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5]);
const RATE_LAST = RATE.length - 1;

const ENCODE = 0;
const DECODE = 1;
const VERIFY = 2;

class Coder {
  mode = ENCODE;
  private x1 = 0;
  private x2 = 0xffffffff;
  private x = 0;
  /** Decode / verify: the stream. */
  private src: Uint8Array = new Uint8Array(0);
  private srcAt = 0;
  private srcEnd = 0;
  /** Encode: output bytes (grown as needed). Verify: bytes compared so far. */
  out: Uint8Array = new Uint8Array(4096);
  n = 0;
  /** Verify: a byte differed from the stream. */
  mismatch = false;
  private readonly p = new Uint16Array(CTX_COUNT);
  private readonly uses = new Uint8Array(CTX_COUNT);

  private reset(mode: number): void {
    this.mode = mode;
    this.x1 = 0;
    this.x2 = 0xffffffff;
    this.x = 0;
    this.n = 0;
    this.mismatch = false;
    this.p.fill(32768);
    this.uses.fill(0);
  }

  startEncode(): void {
    this.reset(ENCODE);
  }

  /** Decode `src[at, end)`, or with `verify`, check that encoding reproduces exactly those bytes. */
  startRead(src: Uint8Array, at: number, end: number, verify: boolean): void {
    this.reset(verify ? VERIFY : DECODE);
    this.src = src;
    this.srcAt = at;
    this.srcEnd = end;
    if (!verify) for (let i = 0; i < 4; i++) this.x = ((this.x << 8) | this.read(i)) >>> 0;
  }

  get decoding(): boolean {
    return this.mode === DECODE;
  }

  /** Stream byte i, or 0 past the end (the encoder's final byte implies zeros after it). */
  private read(i: number): number {
    const at = this.srcAt + i;
    return at < this.srcEnd ? this.src[at] : 0;
  }

  private emit(b: number): void {
    if (this.mode === VERIFY) {
      if (this.srcAt + this.n >= this.srcEnd || this.src[this.srcAt + this.n] !== b) this.mismatch = true;
      this.n++;
      return;
    }
    if (this.n === this.out.length) {
      const grown = new Uint8Array(this.out.length * 2);
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.n++] = b;
  }

  /** Code one binary decision in context `ctx`; returns the bit (decoded, or `y`). */
  bit(ctx: number, y: number): number {
    let p12 = this.p[ctx] >>> 4;
    if (p12 < 1) p12 = 1;
    else if (p12 > 4095) p12 = 4095;
    const xmid = this.x1 + ((this.x2 - this.x1) >>> 12) * p12;
    if (this.mode === DECODE) y = this.x <= xmid ? 1 : 0;
    if (y) this.x2 = xmid;
    else this.x1 = xmid + 1;
    const u = this.uses[ctx];
    const r = RATE[u];
    if (u < RATE_LAST) this.uses[ctx] = u + 1;
    const pv = this.p[ctx];
    this.p[ctx] = y ? pv + ((65535 - pv) >> r) : pv - (pv >> r);
    while (((this.x1 ^ this.x2) & 0xff000000) === 0) {
      if (this.mode !== DECODE) this.emit(this.x2 >>> 24);
      else this.x = ((this.x << 8) | this.read(this.n++ + 4)) >>> 0;
      this.x1 = (this.x1 << 8) >>> 0;
      this.x2 = ((this.x2 << 8) | 255) >>> 0;
    }
    return y;
  }

  /** Encode / verify: the final byte, the shortest that pins a value inside [x1, x2]. */
  finish(): void {
    if (this.mode === DECODE) return;
    const top = this.x1 >>> 24;
    this.emit((this.x1 & 0xffffff) === 0 ? top : top + 1);
  }

  /** Verify: the stream was exactly what encoding produces. */
  verified(): boolean {
    return !this.mismatch && this.n === this.srcEnd - this.srcAt;
  }
}

const coder = new Coder();

/** Steer context from the previous delta, or, after a zero delta, from how long steer has been still. */
function steerCtx(prevDelta: number, still: number): number {
  if (prevDelta === 0) {
    // 0, 1, 2, 3-4, 5-8, 9-16, 17-32, 33+ ticks unchanged.
    if (still < 3) return still;
    if (still <= 4) return 3;
    if (still <= 8) return 4;
    if (still <= 16) return 5;
    if (still <= 32) return 6;
    return 7;
  }
  // -4..-1 -> 8..11, 1..4 -> 12..15.
  const d = prevDelta < -4 ? -4 : prevDelta > 4 ? 4 : prevDelta;
  return d < 0 ? 12 + d : 11 + d;
}

/**
 * Code every tick's steer level as a delta from the previous tick (the first from 0). Decoding writes
 * the level into bits 0-5 of `frames`. Returns false if a decoded level leaves -31..31.
 */
function codeSteer(c: Coder, frames: Uint16Array, ticks: number): boolean {
  const dec = c.decoding;
  let prev = 0;
  let prevDelta = 0;
  let still = 0;
  for (let t = 0; t < ticks; t++) {
    const want = dec ? 0 : (frames[t] & 63) - STEER_LEVELS - prev;
    const ctx = steerCtx(prevDelta, still);
    let d = 0;
    if (!c.bit(CTX_ZERO + ctx, want === 0 ? 1 : 0)) {
      const neg = c.bit(CTX_SIGN + ctx, want < 0 ? 1 : 0);
      const mag = want < 0 ? -want : want;
      // Unary up to UNARY_MAX, then the excess in ESC_BITS bits through a binary tree.
      let m = 1;
      while (m <= UNARY_MAX && c.bit(CTX_MAG + ctx * UNARY_MAX + (m - 1), mag > m ? 1 : 0)) m++;
      if (m > UNARY_MAX) {
        const extra = mag - UNARY_MAX - 1;
        let node = 1;
        for (let b = ESC_BITS - 1; b >= 0; b--) node = (node << 1) | c.bit(CTX_ESC + node, (extra >> b) & 1);
        m = UNARY_MAX + 1 + (node - (1 << ESC_BITS));
      }
      d = neg ? -m : m;
    }
    const level = prev + d;
    if (level < -STEER_LEVELS || level > STEER_LEVELS) return false;
    if (dec) frames[t] = level + STEER_LEVELS;
    still = d === 0 ? still + 1 : 0;
    prevDelta = d;
    prev = level;
  }
  return true;
}

/** Code a gap >= 1 with model `base`: Elias-gamma, every bit adaptive. Decoding returns the gap. */
function codeGap(c: Coder, base: number, gap: number): number {
  let len = 1;
  while (len < GAP_UNARY && c.bit(base + len - 1, gap >= 1 << len ? 1 : 0)) len++;
  let v = 1;
  const m = base + GAP_UNARY + (len - 1) * GAP_UNARY;
  for (let b = len - 2; b >= 0; b--) v = (v << 1) | c.bit(m + b, (gap >> b) & 1);
  return v;
}

/**
 * Code the ticks where `mask` (hold, hop or brake) changes, as gaps from the previous event (the
 * first from tick -1), ending with the gap to tick `ticks`. Hold and brake are coded as toggles from
 * off, hop as the ticks it is set. Decoding ORs the bit into `frames`. Returns false on a gap past
 * the end.
 */
function codeEvents(c: Coder, frames: Uint16Array, ticks: number, mask: number): boolean {
  const dec = c.decoding;
  const toggle = mask !== HOP_BIT;
  const onModel = mask === BRAKE_BIT ? GAP_BRAKE_ON : GAP_HOLD_ON;
  const offModel = mask === BRAKE_BIT ? GAP_BRAKE_OFF : GAP_HOLD_OFF;
  let last = -1;
  let on = false;
  for (;;) {
    let next = ticks;
    if (!dec) {
      for (let t = last + 1; t < ticks; t++) {
        const set = (frames[t] & mask) !== 0;
        if (toggle ? set !== on : set) {
          next = t;
          break;
        }
      }
    }
    const base = !toggle ? GAP_HOP : on ? offModel : onModel;
    const at = last + codeGap(c, base, next - last);
    if (at > ticks) return false;
    // A hold (or brake) that went on at `last` lasts until this toggle (or the end).
    if (dec && on) for (let t = last; t < at; t++) frames[t] |= mask;
    if (at === ticks) return true;
    if (toggle) on = !on;
    else if (dec) frames[at] |= mask;
    last = at;
  }
}

/** Run the sections through the coder: steer, hold, hop and, for a line that brakes, brake. */
function codeFrames(c: Coder, frames: Uint16Array, ticks: number, braking: boolean): boolean {
  return (
    codeSteer(c, frames, ticks) &&
    codeEvents(c, frames, ticks, HOLD_BIT) &&
    codeEvents(c, frames, ticks, HOP_BIT) &&
    (!braking || codeEvents(c, frames, ticks, BRAKE_BIT))
  );
}

/** The packed input stream of a line's frames (a view into scratch: copy before keeping). */
function encodeFrames(frames: Uint16Array, ticks: number): Uint8Array {
  coder.startEncode();
  codeFrames(coder, frames, ticks, framesBrake(frames, ticks));
  coder.finish();
  return coder.out.subarray(0, coder.n);
}

/**
 * Decode `ticks` frames from `src[at, end)`, with a brake section if `braking`; null unless the
 * bytes are exactly the canonical stream of those frames (a brake section that never brakes is not).
 * Bounded by `ticks` (at most CHALK_MAX_TICKS) and never throws.
 */
export function decodeFrames(src: Uint8Array, at: number, end: number, ticks: number, braking = false): Uint16Array | null {
  const frames = new Uint16Array(ticks);
  coder.startRead(src, at, end, false);
  if (!codeFrames(coder, frames, ticks, braking)) return null;
  if (braking !== framesBrake(frames, ticks)) return null;
  coder.startRead(src, at, end, true);
  codeFrames(coder, frames, ticks, braking);
  coder.finish();
  return coder.verified() ? frames : null;
}

// ---------------------------------------------------------------------------------------------
// Packing

function putVarint(out: number[], v: number): void {
  while (v >= 128) {
    out.push((v & 127) | 128);
    v >>>= 7;
  }
  out.push(v);
}

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
  putU16(out, line.ticks | (framesBrake(line.inputs, line.ticks) ? TICKS_BRAKE_FLAG : 0));
  const stream = encodeFrames(line.inputs, line.ticks);
  putVarint(out, stream.length);
  for (let i = 0; i < stream.length; i++) out.push(stream[i]);
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

/** Parse a share code. Never throws; every failure is a short distinct reason. */
export function decodeChalk(code: string): ChalkLine | { error: string } {
  if (typeof code !== 'string') return { error: 'not a code' };
  const s = code.replace(/\s+/g, '');
  if (s.length === 0) return { error: 'empty code' };
  // Version 1 codes (run-length frames, 255 steer levels) were only ever made before release.
  if (s.startsWith(CHALK_V1_PREFIX)) return { error: 'unknown version' };
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
  // startDayTick 2, 4 x f64 32, 3 x f32 12, ticks 2, count at least 1.
  if (at + 49 > b.length) return { error: 'truncated' };
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
  const ticksField = b[at] | (b[at + 1] << 8);
  const braking = (ticksField & TICKS_BRAKE_FLAG) !== 0;
  const ticks = ticksField & ~TICKS_BRAKE_FLAG;
  at += 2;
  // Minimal LEB128, at most three bytes (the stream is far below 2^21 bytes).
  let count = 0;
  let shift = 0;
  for (let k = 0; ; k++) {
    if (k === 3 || at >= b.length) return { error: 'truncated' };
    const v = b[at++];
    count |= (v & 127) << shift;
    shift += 7;
    if ((v & 128) === 0) {
      if (v === 0 && k > 0) return { error: 'bad input stream' };
      break;
    }
  }
  if (at + count + 4 > b.length) return { error: 'truncated' };
  const streamAt = at;
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
  const inputs = decodeFrames(b, streamAt, streamAt + count, ticks, braking);
  if (inputs === null) return { error: 'bad input stream' };
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

/** Reads a line's frames one tick at a time. */
export class FrameReader {
  private at = 0;
  private frames: Uint16Array = new Uint16Array(0);
  readonly frame: InputFrame = { steer: 0, hold: false, hop: false, brake: false };

  reset(frames: Uint16Array): void {
    this.frames = frames;
    this.at = 0;
  }

  /** The next frame, or null when the recording has run out. */
  next(): InputFrame | null {
    if (this.at >= this.frames.length) return null;
    const b = this.frames[this.at++];
    const f = this.frame;
    f.steer = ((b & 63) - STEER_LEVELS) / STEER_LEVELS;
    f.hold = (b & HOLD_BIT) !== 0;
    f.hop = (b & HOP_BIT) !== 0;
    f.brake = (b & BRAKE_BIT) !== 0;
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
  private readonly frames = new Uint16Array(CHALK_MAX_TICKS);
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

  private stepRecording(game: Game): void {
    const a = game.applied;
    this.frames[this.state.elapsedTicks] = packFrame(a.steerQ, a.hold, a.hop, a.brake);
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
      inputs: this.frames.slice(0, ticks),
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
