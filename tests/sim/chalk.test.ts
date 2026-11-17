import { describe, expect, it } from 'vitest';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import {
  CHALK_COUNTDOWN_TICKS,
  CHALK_END_RADIUS,
  CHALK_MAX_LINES,
  CHALK_MAX_TICKS,
  CHALK_MIN_TICKS,
  CHALK_PATH_STRIDE,
  CHALK_TIMEOUT_TICKS,
  FrameReader,
  base64urlDecode,
  chalkId,
  chalkPath,
  codeFromBytes,
  crc32,
  decodeChalk,
  encodeChalk,
  isChalkError,
  packChalk,
  placeAtStart,
  type ChalkLine,
} from '../../src/sim/game/chalk';
import { Game, quantiseSteer, type GameEvent } from '../../src/sim/game/game';
import { inkedCount } from '../../src/sim/game/progress';
import { exportSave, importSave, migrate, DEFAULT_SETTINGS } from '../../src/sim/game/save';
import { createPlayer, stepPlayer } from '../../src/sim/player';
import { Rng } from '../../src/sim/rng';
import { hashPlayer } from '../../src/sim/sim';
import { Mode, type InputFrame, type SimCtx, type SimEvent } from '../../src/sim/types';
import { seekVehicle, slice, teleport } from './helpers';

const TRAM = 0;

function newGame(): Game {
  resetFeel();
  return new Game(slice(), { seed: 1, startDayFrac: 0.3 });
}

const NONE: InputFrame = { steer: 0, hold: false, hop: false };

/** Step one tick; returns the game events. */
function step(g: Game, f: InputFrame = NONE): GameEvent[] {
  g.step(f);
  return g.events.slice();
}

interface Recording {
  game: Game;
  line: ChalkLine;
  frames: InputFrame[];
  /** Skater hash (clock excluded) when the recording stopped. */
  endHash: number;
  /** Tick offsets (1-based frame index) of sim events during the recording. */
  hitchAt: number[];
  releaseAt: number[];
  hopAt: number[];
  progressInked: number;
}

/**
 * A busy run on the slice through Game: wait beside the tram, catch it, carve the swing hard,
 * release (sling), carve both ways on the way down and hop twice. State-dependent on purpose: the
 * frames actually fed are what gets replayed.
 */
function recordBusyRun(): Recording {
  const g = newGame();
  seekVehicle(g.sim, TRAM, 0, 60, 1, 60);
  teleport(g.sim, -1.5, 62, 0, 5);
  // A tick to settle on the ground.
  step(g);
  expect(g.chalkStartRecording()).toEqual({ ok: true });
  const frames: InputFrame[] = [];
  const hitchAt: number[] = [];
  const releaseAt: number[] = [];
  const hopAt: number[] = [];
  let hitched = -1;
  let released = -1;
  let sawStart = false;
  for (let i = 1; i <= 900; i++) {
    let f: InputFrame;
    if (released < 0) {
      const k = hitched < 0 ? -1 : i - hitched;
      // The whip from the hitch tests: lean left, then crack back right and let go.
      const steer = k < 0 ? 0.13 : k < 127 ? 0.05 : k < 172 ? -1 : 0.9;
      f = { steer, hold: k < 200, hop: false };
    } else {
      const k = i - released;
      const steer = k < 80 ? 0.6 : k < 160 ? -0.45 : k < 260 ? 0.2 : -0.7;
      f = { steer, hold: false, hop: k === 120 || k === 330 };
    }
    frames.push(f);
    for (const e of step(g, f)) if (e.type === 'chalkRecordStart') sawStart = true;
    for (const e of g.sim.events) {
      if (e.type === 'hitch') {
        hitchAt.push(i);
        if (hitched < 0) hitched = i;
      } else if (e.type === 'release') {
        releaseAt.push(i);
        if (released < 0) released = i;
      } else if (e.type === 'hop') hopAt.push(i);
    }
  }
  expect(sawStart).toBe(true);
  expect(g.chalk.mode).toBe('recording');
  expect(g.chalk.elapsedTicks).toBe(900);
  const endHash = hashPlayer(g.sim.player, 0);
  expect(g.chalkStopRecording('Busy run')).toEqual({ ok: true });
  const ev = step(g);
  const stop = ev.find((e) => e.type === 'chalkRecordStop');
  expect(stop).toBeDefined();
  expect(g.chalk.lines.length).toBe(1);
  const line = g.chalk.lines[0];
  expect(stop).toEqual({ type: 'chalkRecordStop', id: line.id, ticks: 900 });
  let inked = 0;
  for (let i = 0; i < g.progress.lines.length; i++) inked += inkedCount(g.progress, i);
  return { game: g, line, frames, endHash, hitchAt, releaseAt, hopAt, progressInked: inked };
}

let cached: Recording | null = null;
function busy(): Recording {
  if (!cached) cached = recordBusyRun();
  return cached;
}

interface RaceLog {
  game: Game;
  /** sim.tick before the race started, at the race start, and on the chalkGo tick. */
  before: number;
  atStart: number;
  goTick: number;
  countdown: number[];
  ticks: number[];
  ghostHitchAt: number[];
  /** Racing ticks on which ghost and player had identical state. */
  matched: number;
  finish: Extract<GameEvent, { type: 'chalkFinish' }> | null;
  ghostEndHash: number;
  playerEndHash: number;
}

/**
 * Start a race on `g` for line `id`, step the countdown, then feed the player `feed(i)` (1-based
 * racing tick) for `ticks` ticks (the player keeps skating after the race ends).
 */
function race(g: Game, id: string, ticks: number, feed: (i: number) => InputFrame): RaceLog {
  if (g.chalk.mode !== 'idle') g.chalkAbortRace();
  const before = g.sim.tick;
  expect(g.chalkStartRace(id)).toEqual({ ok: true });
  const atStart = g.sim.tick;
  const log: RaceLog = {
    game: g,
    before,
    atStart,
    goTick: -1,
    countdown: [],
    ticks: [],
    ghostHitchAt: [],
    matched: 0,
    finish: null,
    ghostEndHash: 0,
    playerEndHash: 0,
  };
  expect(g.chalk.mode).toBe('countdown');
  let last = g.sim.tick;
  for (let i = 0; i < CHALK_COUNTDOWN_TICKS; i++) {
    // Countdown input is ignored: neither skater moves.
    const px = g.sim.player.x;
    const ev = step(g, { steer: 1, hold: true, hop: i === 50 });
    expect(g.sim.player.x).toBe(px);
    expect(g.sim.tick).toBe(last + 1);
    last = g.sim.tick;
    log.ticks.push(g.sim.tick);
    for (const e of ev) {
      if (e.type === 'chalkCountdown') log.countdown.push(e.secondsLeft);
      if (e.type === 'chalkGo') log.goTick = g.sim.tick;
    }
  }
  expect(g.chalk.mode).toBe('racing');
  for (let i = 1; i <= ticks; i++) {
    const ev = step(g, feed(i));
    log.ticks.push(g.sim.tick);
    const ghost = g.chalk.ghost;
    if (ghost) {
      for (const e of ghost.events) if (e.type === 'hitch') log.ghostHitchAt.push(i);
      if (hashPlayer(ghost.player, ghost.tick) === g.sim.hash()) log.matched++;
      if (g.chalk.ghostFinished && log.ghostEndHash === 0) log.ghostEndHash = hashPlayer(ghost.player, 0);
    }
    for (const e of ev) if (e.type === 'chalkFinish') log.finish = e;
  }
  log.playerEndHash = hashPlayer(g.sim.player, 0);
  return log;
}

describe('steer quantisation', () => {
  it('steers that round to the same level give identical sims; the level is within 1/254', () => {
    // Either side of the level 64/127 = 0.50394. (The brief's 0.5004 / 0.4996 straddle the rounding
    // boundary 63.5/127 = 0.5 exactly, so under round(steer * 127) they are adjacent levels.)
    const a = newGame();
    const b = newGame();
    for (let i = 0; i < 600; i++) {
      a.step({ steer: 0.5043, hold: false, hop: i === 100 });
      b.step({ steer: 0.5036, hold: false, hop: i === 100 });
    }
    expect(a.sim.hash()).toBe(b.sim.hash());
    for (const s of [-1.3, -1, -0.73, -0.004, 0, 0.0039, 0.25, 0.5004, 0.999, 1, 2]) {
      const q = quantiseSteer(s) / 127;
      const c = Math.max(-1, Math.min(1, s));
      expect(Math.abs(q - c)).toBeLessThanOrEqual(1 / 254 + 1e-12);
    }
    expect(quantiseSteer(Number.NaN)).toBe(0);
  });
});

describe('recording and racing a chalk line', () => {
  it('the scripted run is busy: it catches the tram, slings and hops', () => {
    const r = busy();
    expect(r.hitchAt.length).toBeGreaterThanOrEqual(1);
    expect(r.releaseAt.length).toBeGreaterThanOrEqual(1);
    expect(r.hopAt.length).toBeGreaterThanOrEqual(2);
    expect(r.line.ticks).toBe(900);
    expect(r.line.inputs.length % 3).toBe(0);
  });

  it('the ghost shadows a player fed the same inputs on every tick, and both end where the recording did', () => {
    const r = busy();
    const g = r.game;
    const log = race(g, r.line.id, r.frames.length, (i) => r.frames[i - 1]);
    // The race ends when the player reaches the finish zone, at or before the ghost's time: a win.
    expect(log.finish).not.toBeNull();
    expect(log.finish?.won).toBe(true);
    const raced = log.finish ? log.finish.ticks : 0;
    expect(raced).toBeLessThanOrEqual(r.line.ticks);
    expect(log.matched).toBe(raced - 1);
    // Fed every frame, the player ends bit-identical to the recording.
    expect(log.playerEndHash).toBe(r.endHash);
    expect(r.line.bestTicks).toBe(raced);
  });

  it('a ghost left to run alone plays the whole recording, hitches on the same tick, and ends identical', () => {
    const r = busy();
    const log = race(r.game, r.line.id, r.line.ticks + 10, () => NONE);
    expect(log.ghostEndHash).toBe(r.endHash);
    // The first hitch happens at the same offset: the rides were where they were when recorded.
    expect(log.ghostHitchAt[0]).toBe(r.hitchAt[0]);
  });

  it('the race re-syncs the clock forward to the recording time; the hitch needs it', () => {
    const r = busy();
    const g = r.game;
    // Move the clock away first so the re-sync has real work to do.
    g.sim.tick += 12345;
    const log = race(g, r.line.id, 400, () => NONE);
    expect(log.atStart).toBeGreaterThanOrEqual(log.before);
    expect(log.atStart - log.before).toBeLessThan(DAY_TICKS);
    for (let i = 1; i < log.ticks.length; i++) expect(log.ticks[i]).toBe(log.ticks[i - 1] + 1);
    expect(log.countdown).toEqual([3, 2, 1]);
    expect(log.goTick).toBe(log.atStart + CHALK_COUNTDOWN_TICKS);
    expect(log.goTick % DAY_TICKS).toBe(r.line.startDayTick);
    expect(log.ghostHitchAt[0]).toBe(r.hitchAt[0]);

    // The same frames from the same start at another time of day miss the tram.
    const ctx: SimCtx = { world: g.sim.world, tick: r.line.startDayTick + 600, player: createPlayer(), events: [] as SimEvent[] };
    placeAtStart(g.sim.world, ctx, r.line);
    const rd = new FrameReader();
    rd.reset(r.line.inputs);
    let hitchedAt = -1;
    for (let i = 1; i <= r.hitchAt[0] + 30; i++) {
      const f = rd.next();
      if (!f) break;
      ctx.tick++;
      ctx.events.length = 0;
      stepPlayer(ctx, f);
      if (hitchedAt < 0 && ctx.events.some((e) => e.type === 'hitch')) hitchedAt = i;
    }
    expect(hitchedAt).not.toBe(r.hitchAt[0]);
  });

  it('the same holds after a share-code round trip, in a fresh game', () => {
    const r = busy();
    const code = encodeChalk(r.line);
    const back = decodeChalk(code);
    if (isChalkError(back)) throw new Error(back.error);
    expect(back.id).toBe(r.line.id);
    const g = newGame();
    expect(g.chalkImport(code)).toEqual({ ok: true });
    const log = race(g, r.line.id, r.line.ticks + 10, (i) => (i <= r.frames.length ? r.frames[i - 1] : NONE));
    expect(log.finish?.won).toBe(true);
    expect(log.matched).toBe((log.finish?.ticks ?? 0) - 1);
    expect(log.playerEndHash).not.toBe(0);
    const solo = race(g, r.line.id, r.line.ticks + 10, () => NONE);
    expect(solo.ghostEndHash).toBe(r.endHash);
  });

  it('the same holds after a save is exported, stringified, parsed, migrated and imported', () => {
    const r = busy();
    const json = JSON.stringify(exportSave(r.game, DEFAULT_SETTINGS));
    const data = migrate(JSON.parse(json));
    if (!data) throw new Error('save did not migrate');
    const g = newGame();
    importSave(g, data);
    const line = g.chalk.lines.find((l) => l.id === r.line.id);
    expect(line).toBeDefined();
    expect(line?.bestTicks).toBe(r.line.bestTicks);
    const solo = race(g, r.line.id, r.line.ticks + 10, () => NONE);
    expect(solo.ghostEndHash).toBe(r.endHash);
    expect(solo.ghostHitchAt[0]).toBe(r.hitchAt[0]);
  });

  it('chalkPath replays the line: it starts at the start and ends at the finish', () => {
    const r = busy();
    const path = chalkPath(r.game.sim.world, r.line);
    expect(path.length).toBe((r.line.ticks / CHALK_PATH_STRIDE + 1) * 3);
    expect(path[0]).toBeCloseTo(r.line.x, 4);
    expect(path[2]).toBeCloseTo(r.line.z, 4);
    const n = path.length;
    expect(path[n - 3]).toBeCloseTo(r.line.endX, 3);
    expect(path[n - 2]).toBeCloseTo(r.line.endY, 3);
    expect(path[n - 1]).toBeCloseTo(r.line.endZ, 3);
    expect(chalkPath(r.game.sim.world, r.line)).toBe(path);
  });
});

/** A random but well-formed line. */
function randomLine(rng: Rng): ChalkLine {
  const ticks = CHALK_MIN_TICKS + rng.int(CHALK_MAX_TICKS - CHALK_MIN_TICKS + 1);
  const runs: number[] = [];
  let left = ticks;
  while (left > 0) {
    const n = Math.min(left, 1 + rng.int(255));
    runs.push(rng.int(255), rng.int(4), n);
    left -= n;
  }
  const names = ['Escalera', 'Muelle → Mirador', 'ñandú 🛹 run', '', 'a'.repeat(24), 'Línea 7'];
  const line: ChalkLine = {
    v: 1,
    id: '',
    name: names[rng.int(names.length)],
    startDayTick: rng.int(DAY_TICKS),
    x: rng.range(-500, 500),
    z: rng.range(-500, 500),
    heading: rng.range(-Math.PI, Math.PI),
    speed: rng.range(0, 20),
    inputs: Uint8Array.from(runs),
    ticks,
    endX: Math.fround(rng.range(-500, 500)),
    endY: Math.fround(rng.range(0, 80)),
    endZ: Math.fround(rng.range(-500, 500)),
    bestTicks: 0,
  };
  line.id = chalkId(line);
  return line;
}

/** Repack a code's bytes after `edit`, with a fresh CRC, so only the edited field is wrong. */
function reforge(code: string, edit: (b: Uint8Array) => Uint8Array): string {
  const b = base64urlDecode(code.slice(4));
  if (!b) throw new Error('bad code');
  const body = edit(b.slice(0, b.length - 4));
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  const c = crc32(out, body.length);
  out[body.length] = c & 255;
  out[body.length + 1] = (c >>> 8) & 255;
  out[body.length + 2] = (c >>> 16) & 255;
  out[body.length + 3] = (c >>> 24) & 255;
  return codeFromBytes(out);
}

const expectError = (r: ReturnType<typeof decodeChalk>): string => {
  expect(isChalkError(r)).toBe(true);
  return isChalkError(r) ? r.error : '';
};

describe('share codes', () => {
  it('round-trip bit-exactly for random lines', () => {
    const rng = new Rng(42);
    for (let k = 0; k < 200; k++) {
      const line = randomLine(rng);
      const code = encodeChalk(line);
      expect(code.startsWith('SK1-')).toBe(true);
      const back = decodeChalk(code);
      if (isChalkError(back)) throw new Error(back.error);
      expect(back).toEqual(line);
      expect(Object.is(back.x, line.x) && Object.is(back.heading, line.heading) && Object.is(back.speed, line.speed)).toBe(true);
      // Whitespace and line breaks in a paste are ignored.
      const spaced = code.replace(/(.{40})/g, '$1\n  ');
      expect(decodeChalk(' ' + spaced + '\n')).toEqual(line);
    }
  });

  it('every single-character corruption of a real code is an error, never a line or a throw', () => {
    const code = encodeChalk(busy().line);
    const rng = new Rng(7);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_+/=.!';
    for (let k = 0; k < 200; k++) {
      const at = rng.int(code.length);
      let ch = code[at];
      while (ch === code[at]) ch = alphabet[rng.int(alphabet.length)];
      const bad = code.slice(0, at) + ch + code.slice(at + 1);
      expectError(decodeChalk(bad));
    }
  });

  it('each kind of damage has its own reason', () => {
    const line = busy().line;
    const code = encodeChalk(line);
    const reasons = new Set<string>();
    const add = (c: string): void => {
      const e = expectError(decodeChalk(c));
      expect(reasons.has(e), e).toBe(false);
      reasons.add(e);
    };
    add('XK1-' + code.slice(4));
    add(code.slice(0, 4) + '***' + code.slice(7));
    add(code.slice(0, code.length - 8));
    add(code.slice(0, -3) + (code.slice(-3, -2) === 'A' ? 'B' : 'A') + code.slice(-2));
    add(reforge(code, (b) => ((b[0] = 2), b)));
    // Run total that does not match ticks: lengthen the last run by one.
    add(
      reforge(code, (b) => {
        b[b.length - 1] = b[b.length - 1] === 255 ? 254 : b[b.length - 1] + 1;
        return b;
      }),
    );
    // Ticks out of range (also breaks the total, but the range is checked first).
    const nameLen = packChalk(line)[1];
    const ticksAt = 2 + nameLen + 2 + 32 + 12;
    add(reforge(code, (b) => ((b[ticksAt] = 1), (b[ticksAt + 1] = 0), b)));
    // A non-finite number: x = NaN.
    add(
      reforge(code, (b) => {
        const xAt = 2 + nameLen + 2;
        for (let i = 0; i < 8; i++) b[xAt + i] = 0xff;
        return b;
      }),
    );
    expect(reasons.size).toBe(8);
    expect(expectError(decodeChalk(''))).not.toBe('');
  });
});

/** Record `ticks` ticks of `f` from the current state, then stop. */
function recordPlain(g: Game, ticks: number, f: (i: number) => InputFrame = () => ({ steer: 0.1, hold: false, hop: false })): ChalkLine | null {
  if (!g.chalkStartRecording().ok) return null;
  for (let i = 1; i <= ticks; i++) g.step(f(i));
  const before = g.chalk.lines.length;
  const r = g.chalkStopRecording('Plain');
  if (!r.ok) return null;
  return g.chalk.lines.length > before ? g.chalk.lines[g.chalk.lines.length - 1] : null;
}

/** A game whose skater rolls gently down the open slice from spawn. */
function rollingGame(): Game {
  const g = newGame();
  for (let i = 0; i < 30; i++) g.step(NONE);
  return g;
}

describe('finishing rules', () => {
  it('reaching the finish before or at the ghost time wins; after it loses; best only improves', () => {
    const r = busy();
    const g = newGame();
    expect(g.chalkImport(encodeChalk(r.line))).toEqual({ ok: true });
    const line = g.chalk.lines[0];
    expect(line.bestTicks).toBe(0);
    // Same inputs: a win at or under the ghost's time.
    const win = race(g, line.id, r.frames.length, (i) => r.frames[i - 1]);
    expect(win.finish).toMatchObject({ won: true, best: true, ghostTicks: line.ticks });
    const t1 = win.finish?.ticks ?? 0;
    expect(line.bestTicks).toBe(t1);

    // Stand still for a while, then teleport into the zone: a slower finish loses and keeps the best.
    expect(g.chalkStartRace(line.id).ok).toBe(true);
    let fin: Extract<GameEvent, { type: 'chalkFinish' }> | null = null;
    for (let i = 0; i < CHALK_COUNTDOWN_TICKS + line.ticks + 120 && !fin; i++) {
      if (i === CHALK_COUNTDOWN_TICKS + line.ticks + 60) teleport(g.sim, line.endX, line.endZ, 0, 0);
      for (const e of step(g)) if (e.type === 'chalkFinish') fin = e;
    }
    expect(fin).toMatchObject({ won: false, best: false });
    expect(line.bestTicks).toBe(t1);

    // Teleporting to the finish early (after leaving the start) is a faster win and a new best.
    expect(g.chalkStartRace(line.id).ok).toBe(true);
    fin = null;
    for (let i = 0; i < CHALK_COUNTDOWN_TICKS + 200 && !fin; i++) {
      if (i === CHALK_COUNTDOWN_TICKS + 100) teleport(g.sim, line.endX + CHALK_END_RADIUS * 0.5, line.endZ, 0, 0);
      for (const e of step(g)) if (e.type === 'chalkFinish') fin = e;
    }
    expect(fin).toMatchObject({ won: true, best: true });
    expect(line.bestTicks).toBeLessThan(t1);
    expect(g.chalk.mode).toBe('idle');
    expect(g.chalk.ghost).toBeNull();
  });

  it('a race is lost 20 s after the ghost finishes if the player never gets there', () => {
    const r = busy();
    const g = newGame();
    g.chalkImport(encodeChalk(r.line));
    const id = g.chalk.lines[0].id;
    const log = race(g, id, r.line.ticks + CHALK_TIMEOUT_TICKS + 5, () => NONE);
    expect(log.finish).toMatchObject({ won: false, ticks: 0, ghostTicks: r.line.ticks });
    const endTick = log.ticks.indexOf(log.ticks.find((t) => t === log.goTick + r.line.ticks + CHALK_TIMEOUT_TICKS) ?? -1);
    expect(endTick).toBeGreaterThan(0);
    expect(g.chalk.mode).toBe('idle');
  });

  it('a race can be aborted', () => {
    const r = busy();
    const g = newGame();
    g.chalkImport(encodeChalk(r.line));
    expect(g.chalkStartRace(g.chalk.lines[0].id).ok).toBe(true);
    for (let i = 0; i < 240; i++) g.step(NONE);
    expect(g.chalkAbortRace()).toEqual({ ok: true });
    expect(g.chalk.mode).toBe('idle');
    expect(step(g).some((e) => e.type === 'chalkAbort')).toBe(true);
    expect(g.chalkAbortRace().ok).toBe(false);
  });

  it('a too-short recording is discarded with a reason', () => {
    const g = rollingGame();
    expect(g.chalkStartRecording().ok).toBe(true);
    for (let i = 0; i < CHALK_MIN_TICKS - 1; i++) g.step(NONE);
    const r = g.chalkStopRecording('Short');
    expect(r.ok).toBe(false);
    expect(g.chalk.lines.length).toBe(0);
    expect(g.chalk.mode).toBe('idle');
    expect(step(g).find((e) => e.type === 'chalkRecordDiscard')).toMatchObject({ reason: 'too short' });
  });

  it('recording stops by itself at the maximum length', () => {
    const g = rollingGame();
    expect(g.chalkStartRecording().ok).toBe(true);
    let stop: GameEvent | undefined;
    for (let i = 0; i < CHALK_MAX_TICKS + 5; i++) {
      const e = step(g, { steer: i % 600 < 300 ? 0.4 : -0.4, hold: false, hop: false }).find((q) => q.type === 'chalkRecordStop' || q.type === 'chalkRecordDiscard');
      if (e) stop = e;
    }
    expect(stop).toMatchObject({ type: 'chalkRecordStop', ticks: CHALK_MAX_TICKS });
    expect(g.chalk.lines[0].ticks).toBe(CHALK_MAX_TICKS);
  });

  it('recording cannot start in the air, hitched or bailing, and says why', () => {
    const g = newGame();
    // In the air: hop.
    g.step({ steer: 0, hold: false, hop: true });
    for (let i = 0; i < 4 && g.sim.player.mode !== Mode.AIR; i++) g.step(NONE);
    expect(g.sim.player.mode).toBe(Mode.AIR);
    expect(g.chalkCannotRecord()).not.toBe('');
    expect(g.chalkStartRecording().ok).toBe(false);
    // Hitched.
    seekVehicle(g.sim, TRAM, 0, 60, 1, 60);
    teleport(g.sim, -1.5, 62, 0, 5);
    for (let i = 0; i < 600 && g.sim.player.mode !== Mode.HITCH; i++) g.step({ steer: 0, hold: true, hop: false });
    expect(g.sim.player.mode).toBe(Mode.HITCH);
    expect(g.chalkStartRecording().ok).toBe(false);
    // Bailing.
    const b = newGame();
    seekVehicle(b.sim, TRAM, 0, 100, 1, 60);
    teleport(b.sim, -4, 125, Math.PI, 12);
    for (let i = 0; i < 300 && b.sim.player.mode !== Mode.BAIL; i++) b.step(NONE);
    expect(b.sim.player.mode).toBe(Mode.BAIL);
    expect(b.chalkStartRecording().ok).toBe(false);
    expect(b.chalk.mode).toBe('idle');
  });

  it('starting a recording canonicalises the skater but keeps position, heading and speed', () => {
    const g = rollingGame();
    const p = g.sim.player;
    const before = { x: p.x, z: p.z, heading: p.heading, speed: p.speed };
    expect(g.chalkStartRecording().ok).toBe(true);
    expect({ x: p.x, z: p.z, heading: p.heading, speed: p.speed }).toEqual(before);
    expect(p.steer).toBe(0);
    expect(p.hopCooldown).toBe(0);
    expect(g.chalkStartRecording().ok).toBe(false);
  });

  it('the list caps at 20, and importing the same code twice keeps one line', () => {
    const g = newGame();
    const rng = new Rng(3);
    const codes: string[] = [];
    for (let i = 0; i < CHALK_MAX_LINES + 1; i++) codes.push(encodeChalk(randomLine(rng)));
    expect(g.chalkImport(codes[0])).toEqual({ ok: true });
    expect(g.chalkImport(codes[0])).toEqual({ ok: true });
    expect(g.chalk.lines.length).toBe(1);
    for (let i = 1; i < CHALK_MAX_LINES; i++) expect(g.chalkImport(codes[i]).ok).toBe(true);
    expect(g.chalk.lines.length).toBe(CHALK_MAX_LINES);
    expect(g.chalkImport(codes[CHALK_MAX_LINES]).ok).toBe(false);
    expect(g.chalk.lines.length).toBe(CHALK_MAX_LINES);
    // Recording cannot start with a full list either.
    expect(g.chalkCannotRecord()).not.toBe('');
    expect(g.chalkStartRecording().ok).toBe(false);
  });

  it('delete and rename work on saved lines; a recorded line can be raced right away', () => {
    const g = rollingGame();
    const line = recordPlain(g, CHALK_MIN_TICKS + 60);
    expect(line).not.toBeNull();
    if (!line) return;
    expect(g.chalkRename(line.id, '  New\tname  that is far too long for a ticket ')).toEqual({ ok: true });
    expect(line.name).toBe('New name that is far too');
    expect(g.chalkRename(line.id, '   ').ok).toBe(false);
    expect(g.chalkStartRace(line.id).ok).toBe(true);
    expect(g.chalkDelete(line.id).ok).toBe(false);
    g.chalkAbortRace();
    expect(g.chalkDelete(line.id)).toEqual({ ok: true });
    expect(g.chalk.lines.length).toBe(0);
    expect(g.chalkDelete(line.id).ok).toBe(false);
  });

  it('progress keeps inking during a race', () => {
    const r = busy();
    expect(r.progressInked).toBeGreaterThanOrEqual(0);
    // Race a long ride: record riding the tram from a stop through the next, then race with the same inputs.
    const g = newGame();
    seekVehicle(g.sim, TRAM, 0, 60, 1, 60);
    teleport(g.sim, -1.5, 62, 0, 5);
    g.step(NONE);
    const hold: InputFrame = { steer: 0, hold: true, hop: false };
    const line = recordPlain(g, 3600, () => hold);
    expect(line).not.toBeNull();
    if (!line) return;
    let recInked = 0;
    for (let i = 0; i < g.progress.lines.length; i++) recInked += inkedCount(g.progress, i);
    expect(recInked).toBeGreaterThan(0);
    // A fresh game with no ink races the line holding on: segments ink while the race runs.
    const h = newGame();
    h.chalkImport(encodeChalk(line));
    expect(h.chalkStartRace(line.id).ok).toBe(true);
    const inkedWhile: number[] = [];
    for (let i = 0; i < CHALK_COUNTDOWN_TICKS + line.ticks; i++) {
      const racing = h.chalk.mode === 'racing';
      for (const e of step(h, hold)) if (e.type === 'segmentInked' && racing) inkedWhile.push(e.segment);
    }
    expect(inkedWhile.length).toBeGreaterThan(0);
  });
});
