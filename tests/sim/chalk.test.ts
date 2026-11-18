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
  STEER_LEVELS,
  base64urlDecode,
  chalkId,
  chalkPath,
  codeFromBytes,
  crc32,
  decodeChalk,
  decodeFrames,
  encodeChalk,
  isChalkError,
  packChalk,
  packFrame,
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
import { Surface, terrainSurface, type World } from '../../src/sim/world';
import { Gestures } from '../../src/input/gestures';
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
  it('steers on one level give identical sims, either side of a boundary they differ; the level is within 1/62', () => {
    expect(STEER_LEVELS).toBe(31);
    const drive = (steer: number): number => {
      const g = newGame();
      for (let i = 0; i < 600; i++) g.step({ steer, hold: false, hop: i === 100 });
      return g.sim.hash();
    };
    // The level boundary 15.5/31 = 0.5: 0.4990 is level 15, 0.5010 and 0.5150 are level 16.
    expect(quantiseSteer(0.499)).toBe(15);
    expect(quantiseSteer(0.501)).toBe(16);
    expect(quantiseSteer(0.515)).toBe(16);
    expect(drive(0.501)).toBe(drive(0.515));
    expect(drive(0.499)).not.toBe(drive(0.501));
    // Same around -0.5 and around the boundary 0.5/31 next to centre.
    expect(quantiseSteer(-0.499)).toBe(-15);
    expect(quantiseSteer(-0.501)).toBe(-16);
    expect(quantiseSteer(0.5 / 31 - 1e-4)).toBe(0);
    expect(quantiseSteer(0.5 / 31 + 1e-4)).toBe(1);
    for (const s of [-1.3, -1, -0.73, -0.4999, -0.004, 0, 0.0039, 0.0162, 0.25, 0.5004, 0.999, 1, 2]) {
      const q = quantiseSteer(s) / 31;
      const c = Math.max(-1, Math.min(1, s));
      expect(Math.abs(q - c)).toBeLessThanOrEqual(1 / 62 + 1e-12);
    }
    expect(quantiseSteer(Number.NaN)).toBe(0);
    // The sim gets exactly level / 31: a recorded frame replays the same steer.
    const g = newGame();
    g.step({ steer: 0.3, hold: false, hop: false });
    expect(g.applied.steerQ).toBe(9);
    const rd = new FrameReader();
    rd.reset(Uint16Array.from([packFrame(9, false, false)]));
    expect(rd.next()?.steer).toBe(9 / 31);
  });
});

describe('recording and racing a chalk line', () => {
  it('the scripted run is busy: it catches the tram, slings and hops', () => {
    const r = busy();
    expect(r.hitchAt.length).toBeGreaterThanOrEqual(1);
    expect(r.releaseAt.length).toBeGreaterThanOrEqual(1);
    expect(r.hopAt.length).toBeGreaterThanOrEqual(2);
    expect(r.line.ticks).toBe(900);
    expect(r.line.inputs.length).toBe(r.line.ticks);
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

describe('braking in a chalk line', () => {
  /**
   * A run down the slice's street that pulls down to stop, rolls on, carves, hops, brakes part of the
   * way and ends waiting with a hand out (brake and hold together), through Game like a player.
   */
  function recordBraking(): Recording & { brakeTicks: number } {
    const g = newGame();
    seekVehicle(g.sim, TRAM, 0, 60, 1, 1500);
    teleport(g.sim, -1.5, 120, Math.PI, 6);
    step(g);
    expect(g.chalkStartRecording()).toEqual({ ok: true });
    const frames: InputFrame[] = [];
    let brakeTicks = 0;
    for (let i = 1; i <= 900; i++) {
      const brake = (i > 90 && i <= 200) || (i > 420 && i <= 450) || i > 760;
      const steer = i > 260 && i <= 400 ? 0.3 : i > 520 && i <= 640 ? -0.25 : 0;
      const f: InputFrame = { steer, hold: i > 820, hop: i === 480, brake };
      if (brake) brakeTicks++;
      frames.push(f);
      step(g, f);
    }
    const endHash = hashPlayer(g.sim.player, 0);
    expect(g.chalkStopRecording('Frenada')).toEqual({ ok: true });
    step(g);
    const line = g.chalk.lines[0];
    return { game: g, line, frames, endHash, hitchAt: [], releaseAt: [], hopAt: [], progressInked: 0, brakeTicks };
  }

  let rec: (Recording & { brakeTicks: number }) | null = null;
  const braking = (): Recording & { brakeTicks: number } => (rec ??= recordBraking());

  it('records the brake on exactly the ticks the player pulled down', () => {
    const r = braking();
    expect(r.line.ticks).toBe(900);
    let n = 0;
    for (let i = 0; i < r.line.ticks; i++) {
      const b = (r.line.inputs[i] & 256) !== 0;
      expect(b, `tick ${i + 1}`).toBe(r.frames[i].brake === true);
      if (b) n++;
    }
    expect(n).toBe(r.brakeTicks);
    const rd = new FrameReader();
    rd.reset(r.line.inputs);
    for (let i = 0; i < r.line.ticks; i++) {
      const f = rd.next();
      expect(f?.brake).toBe(r.frames[i].brake === true);
      expect(f?.hold).toBe(r.frames[i].hold);
    }
  });

  it('round-trips through its share code with the brake intact', () => {
    const r = braking();
    const code = encodeChalk(r.line);
    const back = decodeChalk(code);
    if (isChalkError(back)) throw new Error(back.error);
    expect(back).toEqual(r.line);
    // The brake flag rides in the top bit of the tick count.
    const b = packChalk(r.line);
    const at = ticksAtOf(b);
    expect(b[at] | (b[at + 1] << 8)).toBe(r.line.ticks | 0x8000);
  });

  it('its ghost matches a player fed the same inputs tick for tick, and alone ends where the recording did', () => {
    const r = braking();
    const g = newGame();
    expect(g.chalkImport(encodeChalk(r.line))).toEqual({ ok: true });
    const log = race(g, r.line.id, r.frames.length, (i) => r.frames[i - 1]);
    // The recording ends at a standstill on its own finish: the player is there at once with it.
    const raced = log.finish ? log.finish.ticks : r.frames.length;
    expect(log.matched).toBe(raced - 1);
    // Alone: the player stays braked at the start so the ghost plays its whole recording.
    const solo = race(g, r.line.id, r.line.ticks + 10, () => ({ steer: 0, hold: false, hop: false, brake: true }));
    expect(solo.ghostEndHash).toBe(r.endHash);
  });

  it('the brake matters: the same line with the brake taken out ends somewhere else', () => {
    const r = braking();
    const ctx: SimCtx = { world: r.game.sim.world, tick: r.line.startDayTick, player: createPlayer(), events: [] as SimEvent[] };
    placeAtStart(ctx.world, ctx, r.line);
    const rd = new FrameReader();
    rd.reset(r.line.inputs.map((f) => f & ~256));
    for (let i = 1; i <= r.line.ticks; i++) {
      const f = rd.next();
      if (!f) break;
      ctx.tick++;
      ctx.events.length = 0;
      stepPlayer(ctx, f);
    }
    const dz = ctx.player.z - r.line.endZ;
    const dx = ctx.player.x - r.line.endX;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(CHALK_END_RADIUS);
  });

  it('a line without braking codes to the same bytes as before the brake existed', () => {
    // A fixed line coded by the encoder as it was before braking was recorded.
    const ticks = 600;
    const frames = new Uint16Array(ticks);
    for (let t = 0; t < ticks; t++) {
      frames[t] = packFrame(Math.abs((Math.floor(t / 4) % 40) - 20) - 10, t >= 200 && t < 320, t % 150 === 149);
    }
    expect(encodeChalk(lineFromFrames(frames))).toBe(
      'SK2-AgxNdWVsbGUgMDg6MDCgMvxYjELKwPM_cs711vywWEDb-QZPt-YHwI3l3HRrfhxApHBNwAAAJkIAQAxDWAIjwBFApCj1kI_oUTM-1516Br2Z-7IJPQeTGAA9jkRcP9AlZZ6QcE48',
    );
    // Braking costs only its own section: one pull of the brake adds a few bytes.
    const braked = frames.slice();
    for (let t = 400; t < 460; t++) braked[t] |= 256;
    const plain = encodeChalk(lineFromFrames(frames)).length;
    const withBrake = encodeChalk(lineFromFrames(braked)).length;
    expect(withBrake).toBeGreaterThan(plain);
    expect(withBrake - plain).toBeLessThanOrEqual(12);
  });

  it('a forged brake flag is caught, or is the one code of another line', () => {
    // Setting the flag reads a brake section past the stream's end (as zeros), clearing it drops one:
    // either way the result is an error or a different line whose one code this is.
    const plain = encodeChalk(busy().line);
    const flagged = reforge(plain, (b) => {
      const at = ticksAtOf(b);
      b[at + 1] |= 0x80;
      return b;
    });
    const f = decodeChalk(flagged);
    if (isChalkError(f)) expect(f.error).toBe('bad input stream');
    else {
      expect(f.inputs.some((v) => (v & 256) !== 0)).toBe(true);
      expect(encodeChalk(f)).toBe(flagged);
    }
    const braked = encodeChalk(braking().line);
    const unflagged = reforge(braked, (b) => {
      const at = ticksAtOf(b);
      b[at + 1] &= 0x7f;
      return b;
    });
    const r = decodeChalk(unflagged);
    if (isChalkError(r)) expect(r.error).toBe('bad input stream');
    else {
      expect(r.inputs.some((v) => (v & 256) !== 0)).toBe(false);
      expect(encodeChalk(r)).toBe(unflagged);
    }
    // A brake section that never brakes is never the code of anything.
    expect(decodeFrames(new Uint8Array(8), 0, 8, 600, true)).toBeNull();
  });
});

/**
 * A random but well-formed line: runs of random length (1 to 255 ticks) of a random steer level and
 * flags, with some stretches where every tick is random (the coder's worst case).
 */
function randomLine(rng: Rng): ChalkLine {
  const ticks = CHALK_MIN_TICKS + rng.int(CHALK_MAX_TICKS - CHALK_MIN_TICKS + 1);
  const frames = new Uint16Array(ticks);
  // Half the lines brake somewhere; the other half never do (and code without a brake section).
  const brakes = rng.chance(0.5);
  let t = 0;
  while (t < ticks) {
    const n = Math.min(ticks - t, 1 + rng.int(255));
    const noisy = rng.chance(0.1);
    const f = packFrame(rng.int(63) - 31, rng.chance(0.5), rng.chance(0.5), brakes && rng.chance(0.3));
    for (let k = 0; k < n; k++) {
      frames[t + k] = noisy ? packFrame(rng.int(63) - 31, rng.chance(0.5), rng.chance(0.5), brakes && rng.chance(0.5)) : f;
    }
    t += n;
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
    inputs: frames,
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
      expect(code.startsWith('SK2-')).toBe(true);
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
    add('XK2-' + code.slice(4));
    add(code.slice(0, 4) + '***' + code.slice(7));
    add(code.slice(0, code.length - 8));
    add(code.slice(0, -3) + (code.slice(-3, -2) === 'A' ? 'B' : 'A') + code.slice(-2));
    add(reforge(code, (b) => ((b[0] = 1), b)));
    const nameLen = packChalk(line)[1];
    const ticksAt = 2 + nameLen + 2 + 32 + 12;
    // An input stream that is not exactly what encoding produces: zeros after its last byte decode
    // to the same frames (bytes past the end read as zero) but are not the one code of that line.
    add(reforgeStream(code, (st) => [...st, 0, 0]));
    // A forged tick count is either caught the same way or is the one code of a shorter line.
    for (const forged of [line.ticks - 1, line.ticks >> 1]) {
      const c = reforge(code, (b) => ((b[ticksAt] = forged & 255), (b[ticksAt + 1] = forged >> 8), b));
      const r = decodeChalk(c);
      if (isChalkError(r)) expect(r.error).toBe('bad input stream');
      else {
        expect(r.ticks).toBe(forged);
        expect(encodeChalk(r)).toBe(c);
      }
    }
    // Ticks out of range (also breaks the stream, but the range is checked first).
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

// ---------------------------------------------------------------------------------------------
// Share-code size with realistic thumbs, v2 stream damage, fuzzing

/**
 * A thumb on the glass, driven through the real `Gestures` recogniser into `Game` on the slice:
 * drags that swing sinusoidally (0.3-1.5 Hz, 20-110 px), still touches that arm the hitch, lifts and
 * upward flicks, with +-1.5 px jitter on every move. Returns the frames the game actually applied.
 */
function thumbFrames(seed: number, ticks: number): Uint16Array {
  const g = newGame();
  const ges = new Gestures();
  const rng = new Rng(seed);
  const frames = new Uint16Array(ticks);
  const fy = 600;
  let kind = 'lift';
  let left = 0;
  let t0 = 0;
  let cx = 195;
  let freq = 1;
  let amp = 40;
  let ph = 0;
  let x = 195;
  let touching = false;
  for (let t = 0; t < ticks; t++) {
    if (left <= 0) {
      const r = rng.next();
      t0 = t;
      if (r < 0.6) {
        kind = 'drag';
        left = 60 + rng.int(180);
        freq = rng.range(0.3, 1.5);
        amp = rng.range(20, 110);
        ph = rng.range(0, 2 * Math.PI);
        cx = x;
      } else if (r < 0.75) {
        // A fresh still touch: arms the hitch.
        kind = 'hold';
        left = 24 + rng.int(96);
        if (touching) ges.up();
        touching = false;
        x = rng.range(100, 290);
      } else if (r < 0.9) {
        kind = 'lift';
        left = 9 + rng.int(40);
      } else {
        kind = 'flick';
        left = 8;
      }
    }
    left--;
    const k = t - t0;
    const jx = rng.range(-1.5, 1.5);
    const jy = rng.range(-1.5, 1.5);
    if (kind === 'lift') {
      if (touching) ges.up();
      touching = false;
    } else {
      let y = fy;
      if (kind === 'drag') x = cx + amp * (Math.sin(2 * Math.PI * freq * (k / 60) + ph) - Math.sin(ph));
      else if (kind === 'flick') y = fy - Math.min(k, 5) * 18;
      if (!touching) ges.down(x + jx, y + jy);
      else ges.move(x + jx, y + jy);
      touching = true;
    }
    g.step(ges.sample());
    frames[t] = packFrame(g.applied.steerQ, g.applied.hold, g.applied.hop);
  }
  return frames;
}

/** Steady steering: a new steer every 20-40 ticks (about every half second), a hop now and then. */
function steadyFrames(seed: number, ticks: number): Uint16Array {
  const g = newGame();
  const rng = new Rng(seed);
  const frames = new Uint16Array(ticks);
  let steer = 0;
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    if (t >= next) {
      steer = rng.range(-1, 1);
      next = t + 20 + rng.int(21);
    }
    g.step({ steer, hold: false, hop: t % 400 === 399 });
    frames[t] = packFrame(g.applied.steerQ, g.applied.hold, g.applied.hop);
  }
  return frames;
}

function lineFromFrames(frames: Uint16Array, name = 'Muelle 08:00'): ChalkLine {
  const line: ChalkLine = {
    v: 1,
    id: '',
    name,
    startDayTick: 12960,
    x: 1.2345678901234,
    z: 98.765432109876,
    heading: -2.9876543210987,
    speed: 7.123456789,
    inputs: frames,
    ticks: frames.length,
    endX: Math.fround(-3.21),
    endY: Math.fround(41.5),
    endZ: Math.fround(140.25),
    bestTicks: 0,
  };
  line.id = chalkId(line);
  return line;
}

/** Where a packing's tick count is. */
function ticksAtOf(b: Uint8Array): number {
  return 2 + b[1] + 2 + 32 + 12;
}

/** Where a packing's input-stream length starts, and the stream's offset and length. */
function streamOf(b: Uint8Array): { countAt: number; at: number; count: number } {
  const countAt = 2 + b[1] + 2 + 32 + 12 + 2;
  let at = countAt;
  let count = 0;
  let shift = 0;
  for (;;) {
    const v = b[at++];
    count |= (v & 127) << shift;
    shift += 7;
    if ((v & 128) === 0) break;
  }
  return { countAt, at, count };
}

/** Re-forge a code with its input stream replaced (length rewritten, or spelled `countBytes`; CRC fixed). */
function reforgeStream(code: string, edit: (stream: number[]) => number[], countBytes?: number[]): string {
  return reforge(code, (b) => {
    const { countAt, at, count } = streamOf(b);
    const stream = edit(Array.from(b.slice(at, at + count)));
    const out: number[] = Array.from(b.slice(0, countAt));
    if (countBytes) out.push(...countBytes);
    else {
      let n = stream.length;
      while (n >= 128) {
        out.push((n & 127) | 128);
        n >>>= 7;
      }
      out.push(n);
    }
    out.push(...stream);
    return Uint8Array.from(out);
  });
}

function streamBytes(code: string): number[] {
  const b = base64urlDecode(code.slice(4));
  if (!b) throw new Error('bad code');
  const { at, count } = streamOf(b);
  return Array.from(b.slice(at, at + count));
}

describe('share code version 2', () => {
  it('stays short with realistic thumb input (three seeds) and with steady steering', () => {
    const report: string[] = [];
    for (const [secs, limit] of [
      [30, 1300],
      [120, 4500],
      [240, 9000],
    ]) {
      const sizes: number[] = [];
      for (const seed of [1, 2, 3]) {
        const line = lineFromFrames(thumbFrames(seed, secs * 60));
        const code = encodeChalk(line);
        sizes.push(code.length);
        expect(code.length, `${secs} s, seed ${seed}`).toBeLessThanOrEqual(limit);
        const back = decodeChalk(code);
        if (isChalkError(back)) throw new Error(back.error);
        expect(back.inputs).toEqual(line.inputs);
      }
      report.push(`${secs} s thumb: ${sizes.join(' / ')}`);
    }
    const steady: number[] = [];
    for (const seed of [1, 2, 3]) {
      const code = encodeChalk(lineFromFrames(steadyFrames(seed, 30 * 60)));
      steady.push(code.length);
      expect(code.length).toBeLessThan(500);
    }
    report.push(`30 s steady: ${steady.join(' / ')}`);
    // The realistic input really does exercise every part of the stream.
    const f = thumbFrames(1, 120 * 60);
    let holds = 0;
    let hops = 0;
    let changes = 0;
    for (let i = 0; i < f.length; i++) {
      if (f[i] & 64 && !(i > 0 && f[i - 1] & 64)) holds++;
      if (f[i] & 128) hops++;
      if (i > 0 && (f[i] & 63) !== (f[i - 1] & 63)) changes++;
    }
    expect(holds).toBeGreaterThan(5);
    expect(hops).toBeGreaterThan(5);
    expect(changes).toBeGreaterThan(f.length / 3);
    console.log(`chalk code sizes (characters): ${report.join('; ')}`);
  });

  it('a version 1 code is an unknown version', () => {
    const v1 = 'SK1-AQtNaXJhZG9yIHJ1buY3AAAAAAAA-D99-QxZVft0QBgtRFT7IQnA4Q6lBuQ08j_JTrNA9q0OQuN_lUPgAQwAvwDITABkTAIBTACzLkl8fw';
    expect(expectError(decodeChalk(v1))).toBe('unknown version');
    const code = encodeChalk(busy().line);
    expect(expectError(decodeChalk(reforge(code, (b) => ((b[0] = 1), b))))).toBe('unknown version');
  });

  it('rejects trailing data, a short stream, a non-minimal length; another stream gives other frames', () => {
    const r = busy();
    const code = encodeChalk(r.line);
    expect(reforgeStream(code, (s) => s)).toBe(code);
    expect(expectError(decodeChalk(reforgeStream(code, (s) => [...s, 0])))).toBe('bad input stream');
    expect(expectError(decodeChalk(reforgeStream(code, (s) => [...s, 0x5a, 0x11])))).toBe('bad input stream');
    expect(expectError(decodeChalk(reforgeStream(code, (s) => s.slice(0, s.length - 1))))).toBe('bad input stream');
    expect(expectError(decodeChalk(reforgeStream(code, (s) => s.slice(0, s.length >> 1))))).toBe('bad input stream');
    expect(expectError(decodeChalk(reforgeStream(code, () => [])))).toBe('bad input stream');
    // The stream length spelled with a needless continuation byte.
    const len = streamBytes(code).length;
    expect(len).toBeLessThan(1 << 14);
    const padded = len < 128 ? [len | 128, 0] : [(len & 127) | 128, (len >> 7) | 128, 0];
    expect(expectError(decodeChalk(reforgeStream(code, (s) => s, padded)))).toBe('bad input stream');
    // Another line's stream of the same length in ticks decodes, to that line's frames.
    const otherFrames = steadyFrames(5, r.line.ticks);
    const other = streamBytes(encodeChalk(lineFromFrames(otherFrames)));
    const swapped = decodeChalk(reforgeStream(code, () => other));
    if (isChalkError(swapped)) throw new Error(swapped.error);
    expect(swapped.inputs).toEqual(otherFrames);
    expect(swapped.id).not.toBe(r.line.id);
  });

  it('fuzz: random strings and one- or two-character mutations never throw and never pass', () => {
    const rng = new Rng(20261117);
    const real = [
      encodeChalk(busy().line),
      encodeChalk(lineFromFrames(thumbFrames(4, 30 * 60), 'ñandú 🛹')),
      encodeChalk(lineFromFrames(steadyFrames(4, 60 * 60))),
      encodeChalk(randomLine(new Rng(9))),
    ];
    for (const c of real) expect(isChalkError(decodeChalk(c))).toBe(false);
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const junk = b64 + '+/=.!~é🛹';
    const pick = (a: string): string => a[rng.int(a.length)];
    let lines = 0;
    let threw = 0;
    let tried = 0;
    const tryDecode = (c: string): void => {
      tried++;
      try {
        if (!isChalkError(decodeChalk(c))) lines++;
      } catch (_e) {
        threw++;
      }
    };
    // 20 000 random strings: half anything, half a valid prefix and a base64url body.
    for (let k = 0; k < 20000; k++) {
      let c = k % 2 === 0 ? '' : 'SK2-';
      const n = rng.int(k % 2 === 0 ? 80 : 400);
      for (let i = 0; i < n; i++) c += pick(k % 2 === 0 ? junk : b64);
      tryDecode(c);
    }
    expect(threw).toBe(0);
    expect(lines).toBe(0);
    // 20 000 mutations of real codes: one or two characters replaced, or one inserted or deleted.
    for (let k = 0; k < 20000; k++) {
      const code = real[k % real.length];
      let c = code;
      const kind = k % 5;
      if (kind === 3) {
        const at = rng.int(c.length + 1);
        c = c.slice(0, at) + pick(b64) + c.slice(at);
      } else if (kind === 4) {
        const at = rng.int(c.length);
        c = c.slice(0, at) + c.slice(at + 1);
      } else {
        const edits = kind === 0 ? 1 : 2;
        for (let e = 0; e < edits; e++) {
          const at = rng.int(c.length);
          let ch = c[at];
          while (ch === c[at]) ch = pick(kind === 2 ? junk : b64);
          c = c.slice(0, at) + ch + c.slice(at + 1);
        }
      }
      if (c === code) continue;
      tryDecode(c);
    }
    expect(tried).toBeGreaterThan(39900);
    expect(threw).toBe(0);
    expect(lines).toBe(0);
    // Forged packings with a correct CRC but damaged input bytes: never a throw.
    for (let k = 0; k < 2000; k++) {
      const code = real[k % real.length];
      tryDecode(
        reforgeStream(code, (s) => {
          const out = s.slice();
          const n = 1 + rng.int(4);
          for (let i = 0; i < n; i++) out[rng.int(out.length)] = rng.int(256);
          return rng.chance(0.2) ? out.slice(0, rng.int(out.length + 1)) : out;
        }),
      );
    }
    expect(threw).toBe(0);
  }, 30000);
});

// ---------------------------------------------------------------------------------------------
// Rules the first verifier found untested

function firstWater(w: World): { x: number; z: number } {
  for (let z = w.minZ + 2; z < w.maxZ; z += 2) {
    for (let x = w.minX + 2; x < w.maxX; x += 2) if (terrainSurface(w, x, z) === Surface.WATER) return { x, z };
  }
  throw new Error('no water in the slice');
}

describe('chalk rules', () => {
  it('a bail in the water aborts a recording: discarded with the reason, no line added', () => {
    const g = rollingGame();
    expect(g.chalkStartRecording().ok).toBe(true);
    for (let i = 0; i < CHALK_MIN_TICKS + 30; i++) g.step(NONE);
    const wet = firstWater(g.sim.world);
    teleport(g.sim, wet.x, wet.z + 0.01, 0, 0);
    let discard: GameEvent | undefined;
    for (let i = 0; i < 120 && !discard; i++) discard = step(g).find((e) => e.type === 'chalkRecordDiscard');
    expect(g.sim.player.mode).toBe(Mode.BAIL);
    expect(discard).toEqual({ type: 'chalkRecordDiscard', reason: 'fell in the water' });
    expect(g.chalk.mode).toBe('idle');
    expect(g.chalk.lines.length).toBe(0);
    expect(g.chalkStopRecording('Wet').ok).toBe(false);
    expect(g.chalk.lines.length).toBe(0);
  });

  it('a loop does not finish at the start: the player must leave the finish zone and come back', () => {
    const g = rollingGame();
    const p = g.sim.player;
    expect(g.chalkStartRecording().ok).toBe(true);
    const sx = p.x;
    const sy = p.y;
    const sz = p.z;
    for (let i = 0; i < CHALK_MIN_TICKS + 30; i++) g.step(NONE);
    expect(g.chalkStopRecording('Loop').ok).toBe(true);
    step(g);
    const rec = g.chalk.lines[0];
    // The same route, but finishing where it started, from a standstill.
    const loop = decodeChalk(encodeChalk({ ...rec, speed: 0, endX: Math.fround(sx), endY: Math.fround(sy), endZ: Math.fround(sz) }));
    if (isChalkError(loop)) throw new Error(loop.error);
    expect(g.chalkImport(encodeChalk(loop))).toEqual({ ok: true });
    expect(g.chalkStartRace(loop.id).ok).toBe(true);
    let fin: Extract<GameEvent, { type: 'chalkFinish' }> | null = null;
    const watch = (): void => {
      for (const e of step(g)) if (e.type === 'chalkFinish') fin = e;
    };
    for (let i = 0; i < CHALK_COUNTDOWN_TICKS; i++) watch();
    expect(g.chalk.mode).toBe('racing');
    // Sitting in the zone (the race starts there) for a second does not finish.
    for (let i = 0; i < 60; i++) {
      watch();
      const dx = p.x - loop.endX;
      const dz = p.z - loop.endZ;
      expect(dx * dx + dz * dz).toBeLessThan(CHALK_END_RADIUS * CHALK_END_RADIUS);
    }
    expect(fin).toBeNull();
    expect(g.chalk.mode).toBe('racing');
    // Out of the zone and back in: now it counts.
    teleport(g.sim, sx, sz + CHALK_END_RADIUS * 3, 0, 0);
    watch();
    watch();
    expect(fin).toBeNull();
    teleport(g.sim, sx, sz, 0, 0);
    watch();
    expect(fin).toMatchObject({ id: loop.id, won: true, ticks: 63 });
  });

  it('recording refuses under an awning ("find open ground") and does not start there', () => {
    const g = newGame();
    // Roll down the east sidewalk under the awning at z = 165..175.
    teleport(g.sim, 13, 186, Math.PI, 4);
    const p = g.sim.player;
    for (let i = 0; i < 400 && !(p.z < 171 && p.z > 167); i++) g.step(NONE);
    expect(p.z).toBeLessThan(171);
    expect(p.z).toBeGreaterThan(167);
    expect(p.mode).toBe(Mode.GROUND);
    expect(g.chalkCannotRecord()).toBe('Find open ground');
    expect(g.chalkStartRecording()).toEqual({ ok: false, reason: 'Find open ground' });
    expect(g.chalk.mode).toBe('idle');
    expect(step(g).some((e) => e.type === 'chalkRecordStart')).toBe(false);
    // Out from under it, on open ground, it can.
    teleport(g.sim, 13, 150, Math.PI, 0);
    g.step(NONE);
    expect(g.chalkCannotRecord()).toBe('');
  });

  it("finishing in exactly the line's time wins; one tick more loses", () => {
    const r = busy();
    const finishAt = (ticks: number): Extract<GameEvent, { type: 'chalkFinish' }> | null => {
      const g = newGame();
      g.chalkImport(encodeChalk(r.line));
      const line = g.chalk.lines[0];
      expect(g.chalkStartRace(line.id).ok).toBe(true);
      for (let i = 0; i < CHALK_COUNTDOWN_TICKS; i++) g.step(NONE);
      let fin: Extract<GameEvent, { type: 'chalkFinish' }> | null = null;
      for (let i = 1; i <= ticks && !fin; i++) {
        // Arrive in the zone on racing tick `ticks`: put the skater there just before that step.
        if (i === ticks) teleport(g.sim, line.endX, line.endZ, 0, 0);
        for (const e of step(g)) if (e.type === 'chalkFinish') fin = e;
        if (i < ticks) expect(fin).toBeNull();
      }
      return fin;
    };
    expect(finishAt(r.line.ticks)).toMatchObject({ won: true, ticks: r.line.ticks, ghostTicks: r.line.ticks });
    expect(finishAt(r.line.ticks + 1)).toMatchObject({ won: false, ticks: r.line.ticks + 1, ghostTicks: r.line.ticks });
  });
});
