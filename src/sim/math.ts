/**
 * Deterministic math for the sim.
 *
 * JS leaves the results of Math.sin/cos/atan2/pow/exp unspecified across engines, so the sim uses
 * these polynomial versions built from + - * / and Math.sqrt only (all exactly specified by
 * IEEE-754). Two sims fed the same inputs are bit-identical on any engine.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** Wrap an angle to [-PI, PI). */
export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}

/** sin(x), max error about 1e-9. */
export function dsin(x: number): number {
  x = wrapAngle(x);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
  );
}

/** cos(x), max error about 1e-9. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** atan(z) for z in [0, 1]: two half-angle reductions, then a short series. */
function atan01(z: number): number {
  let t = z / (1 + Math.sqrt(1 + z * z));
  t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  return 4 * t * (1 + t2 * (-1 / 3 + t2 * (1 / 5 + t2 * (-1 / 7 + t2 * (1 / 9 + t2 * (-1 / 11))))));
}

/** atan2(y, x), max error about 1e-10. Returns 0 for (0, 0). */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a = ax >= ay ? atan01(ay / ax) : HALF_PI - atan01(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent approach without exp(): fraction of the gap closed in dt at `rate` 1/s. */
export function approachT(rate: number, dt: number): number {
  const k = rate * dt;
  return k / (1 + k);
}

/** Move `v` toward `target` by at most `maxDelta`. */
export function moveToward(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (d > maxDelta) return v + maxDelta;
  if (d < -maxDelta) return v - maxDelta;
  return target;
}

/** Shortest signed difference a - b, wrapped to [-PI, PI). */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Integer power by repeated multiplication (deterministic). */
export function ipow(base: number, exp: number): number {
  let r = 1;
  for (let i = 0; i < exp; i++) r *= base;
  return r;
}
