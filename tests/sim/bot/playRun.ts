/**
 * Plays a bot through a whole horde run (three minutes, or until it dies) and records what the end
 * screen and a watcher would see: how it ended, health, kills, level, weapons, loops, gears, hits,
 * the size of the horde, and a per-tick fingerprint for the determinism check.
 *
 * Lean on purpose: 25 of these run in one test file, so nothing here allocates per tick.
 */
import { RUN_TICKS } from '../../../src/sim/balance';
import type { Bowl } from '../../../src/sim/bowl';
import { TICK_HZ } from '../../../src/sim/constants';
import { hashSimState, Sim } from '../../../src/sim/sim';
import { makeInputFrame } from '../../../src/sim/types';
import { FX_PLAYER_HIT, hashWorld, PHASE_DEAD, PHASE_PLAY, PHASE_WON } from '../../../src/sim/world';
import type { Bot } from './steer';

export type RunEnd = 'won' | 'dead';

export interface HordeRun {
  end: RunEnd;
  /** Seconds played when the run ended. */
  seconds: number;
  hp: number;
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
  /**
   * Shortest time from the last moment at full health to death, s; Infinity if the run did not end
   * in death. Nothing heals in this slice, so it is the time from the first hit to death.
   */
  fullToDead: number;
  /** Health at each whole second played; index 0 is the start. */
  hpAt: Float32Array;
  /** `hashWorld` and `hashSimState` mixed, after every tick played. */
  hashes: Uint32Array;
}

/** True if the run was still going (or had been won) at `seconds`. */
export function aliveAt(r: HordeRun, seconds: number): boolean {
  return r.end === 'won' || r.seconds > seconds;
}

export function playRun(bowl: Bowl, seed: number, bot: Bot): HordeRun {
  const sim = new Sim(bowl, { seed, horde: true });
  const w = sim.world;
  const s = sim.state;
  const p = w.player;
  const input = makeInputFrame();
  const hashes = new Uint32Array(RUN_TICKS);
  const hpAt = new Float32Array(Math.ceil(RUN_TICKS / TICK_HZ) + 1);
  hpAt[0] = p.hp;
  let ticks = 0;
  let high = 0;
  let hits = 0;
  let peak = 0;
  let firstHit = -1;
  let lastFull = 0;

  while (w.run.phase === PHASE_PLAY && ticks < RUN_TICKS) {
    bot(sim, input);
    sim.step(input);
    hashes[ticks] = Math.imul(hashWorld(w) ^ 0x9e3779b9, 0x01000193) ^ hashSimState(s);
    ticks++;
    if (s.mover.gear >= 3) high++;
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      if (f.type[i] !== FX_PLAYER_HIT) continue;
      hits++;
      if (firstHit < 0) firstHit = ticks;
    }
    if (p.hp >= p.maxHp) lastFull = ticks;
    if (w.horde.count > peak) peak = w.horde.count;
    if (ticks % TICK_HZ === 0) hpAt[ticks / TICK_HZ] = p.hp;
  }

  const dead = w.run.phase === PHASE_DEAD;
  if (!dead && w.run.phase !== PHASE_WON) throw new Error(`run ended in phase ${w.run.phase}`);
  return {
    end: dead ? 'dead' : 'won',
    seconds: ticks / TICK_HZ,
    hp: p.hp,
    kills: p.kills,
    level: p.level,
    wakeLevel: p.wakeLevel,
    seekersLevel: p.seekersLevel,
    pops: p.pops,
    bestPop: p.bestPop,
    gear3plus: ticks > 0 ? high / ticks : 0,
    hits,
    peakHorde: peak,
    firstHitAt: firstHit < 0 ? -1 : firstHit / TICK_HZ,
    fullToDead: dead ? (ticks - lastFull) / TICK_HZ : Infinity,
    hpAt,
    hashes: hashes.subarray(0, ticks),
  };
}
