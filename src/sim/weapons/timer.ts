/**
 * The clock every weapon fires on. A weapon keeps the time it has waited since its last shot, in
 * seconds, in one number (a slot of `w.mem`, or `w.seekerMeter` for the Seekers), and adds `DT` to
 * it every tick. The number starts at 0 with the run, so the first shot comes after one full wait,
 * never at tick 0.
 *
 * The wait itself is the weapon's table number times the build's Haste (1 is normal, lower fires
 * faster). Nothing about the mover enters into it.
 */
import type { Stats } from '../stats';

/** Slack for adding up ticks: a wait of a whole number of ticks is ready on that tick. */
const SLACK = 1e-6;

/** The wait between shots for a table wait of `base` s with these stats, s. */
export function waitOf(base: number, st: Stats): number {
  return base * st.haste;
}

/** Has `waited` s reached a wait of `wait` s? */
export function isReady(waited: number, wait: number): boolean {
  return waited >= wait - SLACK;
}

/**
 * The time waited after a shot: the part of a tick that ran over is kept, so the average rate is
 * the wait exactly; never more than one wait is banked.
 */
export function afterShot(waited: number, wait: number): number {
  const left = waited - wait;
  return left < 0 ? 0 : left > wait ? wait : left;
}
