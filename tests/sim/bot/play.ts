/**
 * Plays a bot on a terrain for a fixed time and records what a player would see: speed, gears,
 * chains, distance, whether it ever got stuck with the thumb down, left the bowl or broke the maths.
 */
import { GEAR_COUNT, TICK_HZ } from '../../../src/sim/constants';
import { len2 } from '../../../src/sim/math';
import { hashSimState, Sim } from '../../../src/sim/sim';
import type { Terrain } from '../../../src/sim/terrain';
import { EV_BOOST, EV_CLEAN_HOP, EV_HOP, makeInputFrame, type MoverState } from '../../../src/sim/types';
import type { Bot } from './steer';

/** Slower than this counts as stopped, m/s. */
export const STOPPED = 1;
/** A stick pushed at least this far counts as held. */
const HELD = 0.3;

export interface RunStats {
  seconds: number;
  /** Mean of the gear's speed reading over the run, m/s. */
  avgSpeed: number;
  topSpeed: number;
  /** Share of ticks spent in each gear; index 0 is gear 1. */
  gearShare: number[];
  /** Highest gear ever reached. */
  topGear: number;
  /** Seconds into the run at which gear N was first reached; index 0 is gear 1. -1 if never. */
  gearAt: number[];
  longestChain: number;
  /** Hops, clean hops and boost pads ridden over the run. */
  hops: number;
  cleanHops: number;
  boosts: number;
  distance: number;
  /** Longest stretch, s, with the stick held and the mover stopped. */
  longestStuckHolding: number;
  /** Seconds until the mover first went faster than STOPPED. -1 if never. */
  movingAt: number;
  /** Distance travelled in the first 60 s. */
  distance60: number;
  /** Every number in the mover stayed finite. */
  finite: boolean;
  /** Furthest from the middle, m. */
  maxRadius: number;
  /** `hashSimState` after every tick. */
  hashes: Uint32Array;
}

function finiteMover(m: MoverState): boolean {
  return (
    Number.isFinite(m.x) &&
    Number.isFinite(m.y) &&
    Number.isFinite(m.z) &&
    Number.isFinite(m.vx) &&
    Number.isFinite(m.vy) &&
    Number.isFinite(m.vz) &&
    Number.isFinite(m.heading) &&
    Number.isFinite(m.speed) &&
    Number.isFinite(m.nx) &&
    Number.isFinite(m.ny) &&
    Number.isFinite(m.nz)
  );
}

export function play(terrain: Terrain, bot: Bot, seconds: number): RunStats {
  const sim = new Sim(terrain);
  const s = sim.state;
  const m = s.mover;
  const ticks = Math.round(seconds * TICK_HZ);
  const input = makeInputFrame();
  const gearTicks = new Array<number>(GEAR_COUNT).fill(0);
  const gearAt = new Array<number>(GEAR_COUNT).fill(-1);
  gearAt[0] = 0;
  const hashes = new Uint32Array(ticks);
  let speedSum = 0;
  let topSpeed = 0;
  let topGear = 1;
  let longestChain = 0;
  let stuck = 0;
  let longestStuck = 0;
  let movingAt = -1;
  let distance60 = 0;
  let finite = true;
  let maxRadius = 0;
  let hops = 0;
  let cleanHops = 0;
  let boosts = 0;

  for (let t = 0; t < ticks; t++) {
    bot(sim, input);
    const holding = input.carve && len2(input.steerX, input.steerY) >= HELD;
    sim.step(input);
    hashes[t] = hashSimState(s);
    if (!finiteMover(m)) finite = false;
    const r = len2(m.x, m.z);
    if (r > maxRadius) maxRadius = r;
    speedSum += m.speed;
    if (m.speed > topSpeed) topSpeed = m.speed;
    gearTicks[m.gear - 1]++;
    if (m.gear > topGear) topGear = m.gear;
    if (gearAt[m.gear - 1] < 0) gearAt[m.gear - 1] = (t + 1) / TICK_HZ;
    if (s.events & EV_HOP) hops++;
    if (s.events & EV_CLEAN_HOP) cleanHops++;
    if (s.events & EV_BOOST) boosts++;
    if (m.chain > longestChain) longestChain = m.chain;
    if (movingAt < 0 && m.speed > STOPPED) movingAt = (t + 1) / TICK_HZ;
    if (holding && m.speed < STOPPED) {
      stuck++;
      if (stuck > longestStuck) longestStuck = stuck;
    } else {
      stuck = 0;
    }
    if (t + 1 === 60 * TICK_HZ) distance60 = s.distance;
  }
  // A gear skipped on the way up was still passed through.
  for (let g = GEAR_COUNT - 2; g >= 0; g--) {
    if (gearAt[g] < 0 && gearAt[g + 1] >= 0) gearAt[g] = gearAt[g + 1];
  }

  return {
    seconds,
    avgSpeed: speedSum / ticks,
    topSpeed,
    gearShare: gearTicks.map((n) => n / ticks),
    topGear,
    gearAt,
    longestChain,
    hops,
    cleanHops,
    boosts,
    distance: s.distance,
    longestStuckHolding: longestStuck / TICK_HZ,
    movingAt,
    distance60: ticks >= 60 * TICK_HZ ? distance60 : s.distance,
    finite,
    maxRadius,
    hashes,
  };
}

/** Share of the run in gear `g` or higher. */
export function shareAtLeast(r: RunStats, g: number): number {
  let sum = 0;
  for (let i = g - 1; i < r.gearShare.length; i++) sum += r.gearShare[i];
  return sum;
}
