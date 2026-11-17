/**
 * Players, not a perfect bot: does the first-launch lesson get people through it?
 *
 * Each bot sees only what is on screen: the hint up now (as the onboarding state exposes it, with
 * its copy), where the world pointer is, and its own position, heading, speed and whether it is on a
 * ride. No vehicle scans, no timetable, no coordinates written in. It reacts to each hint after a
 * delay, does what the hint says, and otherwise rolls where the hill takes it. 30 fixed seeds each,
 * a new game as the app makes one, five simulated minutes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { NEW_GAME_DAY_FRAC } from '../../src/app/newGame';
import { buildCity, type City } from '../../src/sim/city';
import { resetFeel } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { LESSON_STEPS, type HintId } from '../../src/sim/game/onboarding';
import { angleDiff, clamp } from '../../src/sim/math';
import { Mode, type InputFrame } from '../../src/sim/types';
import { hintCopy } from '../../src/ui/hintCopy';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** `profile:seed` to log that run every half second (SKITCH_PLAYERS_TRACE). */
const TRACE = ENV?.SKITCH_PLAYERS_TRACE ?? '';

/** Five simulated minutes. */
const MAX_TICKS = 5 * 60 * 60;
const SEEDS = 30;

/** A small seeded generator (mulberry32), so every run of a seed is the same player. */
function rng(seed: number): () => number {
  let a = (seed * 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  name: string;
  /** Seconds between a hint showing and the player acting on it. */
  react: [number, number];
  /** Steering is off by up to this share, either way. */
  noise: number;
  /** Seconds the player keeps holding after they mean to let go. */
  lateLetGo: number;
  /** Distance from the pointer at which they press and hold, metres. */
  holdAt: [number, number];
  /** Never hops onto a rail. */
  skipsRails: boolean;
  /** Does nothing at all. */
  idle?: boolean;
}

const ATTENTIVE: Profile = { name: 'attentive', react: [0.5, 1.5], noise: 0, lateLetGo: 0, holdAt: [2, 3], skipsRails: false };
const CLUMSY: Profile = { name: 'clumsy', react: [2, 6], noise: 0.3, lateLetGo: 1, holdAt: [1.5, 4.5], skipsRails: false };
const FAST: Profile = { name: 'fast', react: [0.3, 0.8], noise: 0, lateLetGo: 0, holdAt: [2, 3], skipsRails: true };
const IDLE: Profile = { name: 'idle', react: [0, 0], noise: 0, lateLetGo: 0, holdAt: [0, 0], skipsRails: true, idle: true };

/** What the player can see each tick. */
interface Screen {
  hint: HintId | '';
  title: string;
  pointer: { kind: string; x: number; y: number; z: number };
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  riding: boolean;
  onGround: boolean;
}

function look(game: Game, out: Screen): void {
  const ob = game.onboarding;
  const p = game.sim.player;
  out.hint = ob.shown;
  out.title = ob.shown === '' ? '' : hintCopy(ob.shown, ob).title;
  out.pointer.kind = ob.target.kind;
  out.pointer.x = ob.target.x;
  out.pointer.y = ob.target.y;
  out.pointer.z = ob.target.z;
  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.heading = p.heading;
  out.speed = Math.hypot(p.vx, p.vz);
  out.riding = p.mode === Mode.HITCH;
  out.onGround = p.mode === Mode.GROUND;
}

/** A player who reads hints off the screen and does what they say, after a while. */
class Player {
  private readonly r: () => number;
  private seen: HintId | '' = '';
  private actAt = 0;
  private holdAt: number;
  private noise = 0;
  private noiseAt = 0;
  private knowsWiggle = false;
  private flickAt = -1e9;
  private dragFrom = -1;
  private letGoAt = -1;
  private holding = false;
  constructor(
    readonly profile: Profile,
    seed: number,
  ) {
    this.r = rng(seed * 7919 + profile.name.length);
    this.holdAt = this.pick(profile.holdAt);
  }

  private pick([a, b]: [number, number]): number {
    return a + (b - a) * this.r();
  }

  /** Steering toward (x, z), as a thumb would, with this player's error. */
  private toward(s: Screen, x: number, z: number, t: number): number {
    if (t >= this.noiseAt) {
      this.noise = (this.r() * 2 - 1) * this.profile.noise;
      this.noiseAt = t + 30;
    }
    return clamp(-2 * angleDiff(Math.atan2(x - s.x, z - s.z), s.heading) * (1 + this.noise), -1, 1);
  }

  private wiggle(t: number, period: number): number {
    return (Math.floor(t / period) % 2 === 0 ? 0.85 : -0.85) * (1 + this.noise);
  }

  act(s: Screen, t: number, out: InputFrame): void {
    out.steer = 0;
    out.hold = false;
    out.hop = false;
    if (this.profile.idle) return;
    if (s.hint !== this.seen) {
      this.seen = s.hint;
      this.actAt = t + Math.round(this.pick(this.profile.react) * 60);
      this.dragFrom = -1;
      this.holdAt = this.pick(this.profile.holdAt);
      if (s.hint === 'roll') this.knowsWiggle = true;
    }
    const acting = s.hint !== '' && t >= this.actAt;
    if (s.riding) {
      // On a ride: keep holding, unless the hint says drag and let go.
      out.hold = true;
      this.holding = false;
      if (acting && s.hint === 'sling') {
        if (this.dragFrom < 0) this.dragFrom = t;
        const dragged = t - this.dragFrom;
        if (dragged < 60) out.steer = 0.8 * (1 + this.noise);
        else {
          if (this.letGoAt < 0) this.letGoAt = t + Math.round(this.profile.lateLetGo * 60);
          if (t >= this.letGoAt) out.hold = false;
        }
      } else this.letGoAt = -1;
      return;
    }
    this.letGoAt = -1;
    if (!acting) {
      this.holding = false;
      return;
    }
    switch (s.hint) {
      case 'carve':
        out.steer = this.wiggle(t - this.actAt, 30);
        break;
      case 'roll':
        out.steer = this.wiggle(t - this.actAt, 12);
        break;
      case 'hop':
        if (t - this.flickAt > 90 && s.onGround) {
          out.hop = true;
          this.flickAt = t;
        }
        break;
      case 'grind': {
        if (this.profile.skipsRails || s.pointer.kind !== 'rail') break;
        const d = Math.hypot(s.pointer.x - s.x, s.pointer.z - s.z);
        out.steer = this.toward(s, s.pointer.x, s.pointer.z, t);
        if (d < 2.5 && s.onGround && t - this.flickAt > 90) {
          out.hop = true;
          this.flickAt = t;
        }
        break;
      }
      case 'hitch':
      case 'ink':
      case 'chain':
        this.catchRide(s, t, out);
        break;
      default:
        break;
    }
  }

  /** PRESS AND HOLD STILL: go to the pointer, then hold a still finger there. */
  private catchRide(s: Screen, t: number, out: InputFrame): void {
    const k = s.pointer.kind;
    if (k !== 'spot' && k !== 'vehicle') {
      if (s.title.startsWith('PRESS')) out.hold = true;
      return;
    }
    // How far the pointer looks: a spot on the ground below a wall is not where you are standing.
    const d = Math.hypot(s.pointer.x - s.x, s.pointer.y - (k === 'vehicle' ? s.y + 1 : s.y), s.pointer.z - s.z);
    // Holding already and the ride coming (or still near the spot): keep still and let it come.
    if (this.holding && (k === 'vehicle' || d < this.holdAt + 3)) {
      out.hold = true;
      if (s.title.startsWith('FLICK') && t - this.flickAt > 40) {
        out.hop = true;
        this.flickAt = t;
      }
      return;
    }
    if (d <= this.holdAt || (k === 'vehicle' && d < 6)) {
      this.holding = true;
      out.hold = true;
      return;
    }
    this.holding = false;
    out.steer = this.toward(s, s.pointer.x, s.pointer.z, t);
    // Too slow to get there on a flat: tic-tac toward it, as the roll hint taught.
    if (s.onGround && s.speed < 2.2 && this.knowsWiggle) out.steer = clamp(0.4 * out.steer + this.wiggle(t, 10), -1, 1);
  }
}

interface Outcome {
  complete: boolean;
  /** Seconds to complete. */
  seconds: number;
  done: string[];
  hint: string;
  x: number;
  y: number;
  z: number;
  mode: number;
  bails: number;
  log: string[];
  /** The roll hint showed at some point after the skater came to rest (for the idle player). */
  rollAfterRest: boolean;
}

function play(profile: Profile, seed: number): Outcome {
  resetFeel();
  const game = new Game(city.world, { seed: 1, startDayFrac: NEW_GAME_DAY_FRAC, hints: true });
  const bot = new Player(profile, seed);
  const s: Screen = { hint: '', title: '', pointer: { kind: 'none', x: 0, y: 0, z: 0 }, x: 0, y: 0, z: 0, heading: 0, speed: 0, riding: false, onGround: false };
  const inp: InputFrame = { steer: 0, hold: false, hop: false };
  const log: string[] = [];
  let bails = 0;
  let restAt = -1;
  let rollAfterRest = false;
  let t = 0;
  for (; t < MAX_TICKS && !game.onboarding.complete; t++) {
    look(game, s);
    bot.act(s, t, inp);
    game.step(inp);
    const p = game.sim.player;
    if (restAt < 0 && p.mode === Mode.GROUND && p.speed < 0.05 && t > 120) restAt = t;
    if (restAt >= 0 && game.onboarding.shown === 'roll') rollAfterRest = true;
    if (TRACE === `${profile.name}:${seed}` && t % 30 === 0) {
      const tg = game.onboarding.target;
      log.push(`${(t / 60).toFixed(1)} @(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) v${p.speed.toFixed(1)} m${p.mode} h=${game.onboarding.shown} tg=${tg.kind}(${tg.x.toFixed(1)},${tg.y.toFixed(1)},${tg.z.toFixed(1)}) in=${inp.steer.toFixed(2)}/${inp.hold ? 'H' : '-'}`);
    }
    for (const e of game.sim.events) {
      if (e.type === 'bail') bails++;
      if (e.type === 'hitch' || e.type === 'release') log.push(`${(t / 60).toFixed(1)} ${e.type} ${game.sim.world.lines[e.line].id}`);
    }
    for (const e of game.events) {
      if (e.type === 'hintShow' || e.type === 'hintDone') log.push(`${(t / 60).toFixed(1)} ${e.type} ${e.step}`);
      else if (e.type === 'segmentInked' || e.type === 'onboardingComplete') log.push(`${(t / 60).toFixed(1)} ${e.type}`);
    }
  }
  const p = game.sim.player;
  const done = Object.entries(game.onboarding.done)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return {
    complete: game.onboarding.complete,
    seconds: t / 60,
    done,
    hint: game.onboarding.shown,
    x: Math.round(p.x),
    y: Math.round(p.y),
    z: Math.round(p.z),
    mode: p.mode,
    bails,
    log,
    rollAfterRest,
  };
}

interface Tally {
  completed: number;
  outcomes: Outcome[];
  report: string;
}

function tally(profile: Profile): Tally {
  const outcomes: Outcome[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) outcomes.push(play(profile, seed));
  const completed = outcomes.filter((o) => o.complete).length;
  const rest = outcomes
    .map((o, i) => (o.complete ? '' : `seed ${i + 1}: at (${o.x}, ${o.y}, ${o.z}) mode ${o.mode}, hint '${o.hint}', learnt [${o.done.join(' ')}], bails ${o.bails}\n    ${o.log.slice(-8).join(' | ')}`))
    .filter((l) => l !== '')
    .join('\n');
  const times = outcomes.filter((o) => o.complete).map((o) => o.seconds);
  const median = times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0;
  const report = `${profile.name}: ${completed}/${SEEDS} complete (median ${median.toFixed(0)} s)\n${rest}`;
  if (ENV?.SKITCH_PLAYERS_REPORT) {
    console.info(report);
    console.info(outcomes.map((o, i) => `${i + 1}: ${o.complete ? 'OK ' : 'NO '}${o.seconds.toFixed(0)}s first ${o.log.find((l) => l.includes(' hitch ')) ?? '-'}`).join('\n'));
  }
  if (TRACE.startsWith(profile.name + ':')) console.info(outcomes[Number(TRACE.split(':')[1]) - 1].log.join('\n'));
  return { completed, outcomes, report };
}

describe('players get through the first-launch lesson', () => {
  it('attentive players (act 0.5-1.5 s after a hint shows): at least 27 of 30 complete', () => {
    const r = tally(ATTENTIVE);
    expect(r.completed, r.report).toBeGreaterThanOrEqual(27);
    for (const o of r.outcomes) if (o.complete) expect(o.done).toEqual(expect.arrayContaining([...LESSON_STEPS]));
  }, 300_000);

  it('clumsy players (2-6 s late, steering 30 % off, letting go a second late): at least 20 of 30 complete', () => {
    const r = tally(CLUMSY);
    expect(r.completed, r.report).toBeGreaterThanOrEqual(20);
  }, 300_000);

  it('fast players who never hop onto a rail: at least 27 of 30 complete', () => {
    const r = tally(FAST);
    expect(r.completed, r.report).toBeGreaterThanOrEqual(27);
    for (const o of r.outcomes) expect(o.done.includes('grind')).toBe(false);
  }, 300_000);

  it('a player who does nothing is told to wiggle once they have come to rest', () => {
    const o = play(IDLE, 1);
    expect(o.complete).toBe(false);
    expect(o.rollAfterRest, o.log.join('\n')).toBe(true);
  }, 120_000);
});
