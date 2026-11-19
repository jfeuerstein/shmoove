/**
 * Plays a bot through a whole horde run (until the final boss falls, it dies, or `maxSeconds` run
 * out) and records what the end screen and a watcher would see: how it ended, health, kills, level, weapons, loops, gears, hits,
 * the size of the horde, and a per-tick fingerprint for the determinism check.
 *
 * Lean on purpose: 25 of these run in one test file, so nothing here allocates per tick.
 */
import { preferWeapons } from './picks';
import { W_SEEKERS, W_WAKE } from '../../../src/sim/arsenal';
import type { Bowl } from '../../../src/sim/bowl';
import { TICK_HZ } from '../../../src/sim/constants';
import { hashSimState, Sim, type Picker } from '../../../src/sim/sim';
import { makeInputFrame } from '../../../src/sim/types';
import { FX_BOSS_DOWN, FX_BOSS_IN, FX_PLAYER_HIT, hashWorld, PHASE_DEAD, PHASE_PLAY, PHASE_WON } from '../../../src/sim/world';
import type { Bot } from './steer';

/** Won (the final boss fell), dead, or still going when the time allowed ran out. */
export type RunEnd = 'won' | 'dead' | 'time';

/** How long `playRun` lets a run go by default, s: the final boss comes at 9:00. */
export const MAX_RUN_SECONDS = 12 * 60;

export interface HordeRun {
  end: RunEnd;
  /** Seconds played when the run ended. */
  seconds: number;
  hp: number;
  /** Maximum health at the end (the build can raise it). */
  maxHp: number;
  kills: number;
  level: number;
  wakeLevel: number;
  seekersLevel: number;
  pops: number;
  bestPop: number;
  /** Share of ticks played in gear 3 or higher. */
  gear3plus: number;
  hits: number;
  /** Most enemies alive at once. */
  peakHorde: number;
  /** Seconds into the run of the first hit; -1 if never hit. */
  firstHitAt: number;
  /** Time from the last moment at full health to death, s; Infinity if the run did not end in death. */
  fullToDead: number;
  /** Bosses brought down. */
  bossesFelled: number;
  /** Run time, s, at which each boss came on the field (FX_BOSS_IN) and fell (FX_BOSS_DOWN), in order. */
  bossIn: number[];
  bossDown: number[];
  /** Health at each whole second played; index 0 is the start. */
  hpAt: Float32Array;
  /** `hashWorld` and `hashSimState` mixed, after every tick played. */
  hashes: Uint32Array;
}

/** True if the run was still going (or had been won) at `seconds`. */
export function aliveAt(r: HordeRun, seconds: number): boolean {
  return r.end === 'won' || r.seconds > seconds;
}

export interface PlayOptions {
  /** Something done to the world before every tick, after the bot has chosen. */
  hook?: RunHook | null;
  picker?: Picker;
  /** Stop after this long if the run is still going, s. */
  maxSeconds?: number;
}

/**
 * Something a test does to the world before every tick, after the bot has chosen (to hold a
 * weapon at level 0, say, or health up).
 */
export type RunHook = (sim: Sim) => void;

export function playRun(bowl: Bowl, seed: number, bot: Bot, options: PlayOptions = {}): HordeRun {
  const hook = options.hook ?? null;
  const picker = options.picker ?? preferWeapons;
  const maxTicks = Math.round((options.maxSeconds ?? MAX_RUN_SECONDS) * TICK_HZ);
  const sim = new Sim(bowl, { seed, horde: true, autoPick: picker });
  const w = sim.world;
  const s = sim.state;
  const p = w.player;
  const input = makeInputFrame();
  const hashes = new Uint32Array(maxTicks);
  const hpAt = new Float32Array(Math.ceil(maxTicks / TICK_HZ) + 1);
  const bossIn: number[] = [];
  const bossDown: number[] = [];
  hpAt[0] = p.hp;
  let ticks = 0;
  let high = 0;
  let hits = 0;
  let peak = 0;
  let firstHit = -1;
  let lastFull = 0;

  while (w.run.phase === PHASE_PLAY && ticks < maxTicks) {
    bot(sim, input);
    if (hook) hook(sim);
    sim.step(input);
    hashes[ticks] = Math.imul(hashWorld(w) ^ 0x9e3779b9, 0x01000193) ^ hashSimState(s);
    ticks++;
    if (s.mover.gear >= 3) high++;
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      if (f.type[i] === FX_BOSS_IN) bossIn.push(w.run.ticks / TICK_HZ);
      if (f.type[i] === FX_BOSS_DOWN) bossDown.push(w.run.ticks / TICK_HZ);
      if (f.type[i] !== FX_PLAYER_HIT) continue;
      hits++;
      if (firstHit < 0) firstHit = ticks;
    }
    if (p.hp >= p.maxHp) lastFull = ticks;
    if (w.horde.count > peak) peak = w.horde.count;
    if (ticks % TICK_HZ === 0) hpAt[ticks / TICK_HZ] = p.hp;
  }

  const dead = w.run.phase === PHASE_DEAD;
  const won = w.run.phase === PHASE_WON;
  if (!dead && !won && w.run.phase !== PHASE_PLAY) throw new Error(`run ended in phase ${w.run.phase}`);
  return {
    end: dead ? 'dead' : won ? 'won' : 'time',
    seconds: ticks / TICK_HZ,
    hp: p.hp,
    maxHp: p.maxHp,
    kills: p.kills,
    level: p.level,
    wakeLevel: p.loadout.weaponLevel[W_WAKE],
    seekersLevel: p.loadout.weaponLevel[W_SEEKERS],
    pops: p.pops,
    bestPop: p.bestPop,
    gear3plus: ticks > 0 ? high / ticks : 0,
    hits,
    peakHorde: peak,
    firstHitAt: firstHit < 0 ? -1 : firstHit / TICK_HZ,
    fullToDead: dead ? (ticks - lastFull) / TICK_HZ : Infinity,
    bossesFelled: w.boss.felled,
    bossIn,
    bossDown,
    hpAt,
    hashes: hashes.subarray(0, ticks),
  };
}
