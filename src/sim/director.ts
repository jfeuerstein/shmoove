/**
 * The spawn director: keeps the right number of the right kinds arriving from where the player is
 * heading, and takes away what has been left far behind so it can come back ahead.
 *
 * Every number is in `DIRECTOR`. Pure and allocation-free after a world's first tick: the little
 * state it carries between ticks (a gnat cloud still coming up, when the next bollard may come)
 * lives in one object per world, created once.
 */
import { DT } from './constants';
import { clamp, datan2, dcos, dsin, HALF_PI, PI, TAU } from './math';
import type { Terrain } from './terrain';
import type { MoverState, SimState, Vec3 } from './types';
import { KIND_BOLLARD, KIND_GNAT, KIND_SHUFFLER, removeEnemy, spawnEnemy, type World } from './world';

const DEG = PI / 180;

export const DIRECTOR = {
  /** The number of living enemies wanted, by run time: seconds and counts, linear between. */
  targetAt: [0, 30, 60, 120, 180],
  target: [25, 60, 120, 260, 400],
  /** Most spawns in one tick while below the target. */
  perTick: 4,

  /** Gnats arrive from this run time, as clouds. */
  gnatFrom: 40,
  cloudSize: 10,
  /** A cloud comes up inside a blob of this radius, m. */
  cloudRadius: 1.5,
  /** Share of the horde that is gnats: from the first at gnatFrom to the full share at gnatFull. */
  gnatShareStart: 0.15,
  gnatShare: 0.3,
  gnatFull: 100,

  /** Bollards arrive from this run time, one at a time. */
  bollardFrom: 80,
  /** How many may be alive: one at bollardFrom, rising to bollardMax at bollardFull. */
  bollardMax: 6,
  bollardFull: 175,
  /** At least this long between two bollards, s. */
  bollardGap: 8,

  /** Spawns land this far from the mover, m. */
  nearest: 38,
  farthest: 65,
  /** Above this speed (m/s) most spawns come from ahead. */
  aheadSpeed: 3,
  /** Share of spawns within aheadHalfAngle of the direction of travel when going fast. */
  aheadShare: 0.7,
  aheadHalfAngle: 70 * DEG,
  /** Spawns stay inside this share of the terrain's radius, on ground no steeper than maxSlope. */
  region: 0.86,
  maxSlope: 0.6,
  /** Candidate spots tried per spawn before giving up for the tick. */
  tries: 6,

  /** Beyond this an enemy is taken away and brought back elsewhere, m. */
  recycleFar: 85,
  /** Beyond this and behind a mover going faster than recycleBehindSpeed, likewise. */
  recycleBehind: 55,
  recycleBehindSpeed: 7,
  /**
   * The faster the mover, the sooner what it leaves behind goes: the behind distance shrinks to
   * recycleBehindMin at recycleBehindMinSpeed. At 55 m a mover at 20 m/s keeps what it passed for
   * 3.5 s and what is ahead for only 2 s, so most of the horde near it would be behind it.
   */
  recycleBehindMin: 30,
  recycleBehindMinSpeed: 18,
} as const;

/** What the director remembers between ticks for one world. */
interface DirectorState {
  /** Gnats of the current cloud still to come up, and its centre. */
  cloudLeft: number;
  cloudX: number;
  cloudZ: number;
  /** Run tick from which the next bollard may come. */
  nextBollard: number;
}

const states = new WeakMap<World, DirectorState>();

function stateOf(w: World): DirectorState {
  let st = states.get(w);
  if (st === undefined) {
    st = { cloudLeft: 0, cloudX: 0, cloudZ: 0, nextBollard: 0 };
    states.set(w, st);
  }
  return st;
}

/** The living enemies wanted at `seconds` into the run. */
export function targetCount(seconds: number): number {
  const at = DIRECTOR.targetAt;
  const n = DIRECTOR.target;
  if (seconds <= at[0]) return n[0];
  for (let k = 1; k < at.length; k++) {
    if (seconds < at[k]) return n[k - 1] + ((n[k] - n[k - 1]) * (seconds - at[k - 1])) / (at[k] - at[k - 1]);
  }
  return n[n.length - 1];
}

/** Share of the horde that should be gnats at `seconds`. */
export function gnatShare(seconds: number): number {
  const D = DIRECTOR;
  if (seconds < D.gnatFrom) return 0;
  if (seconds >= D.gnatFull) return D.gnatShare;
  return D.gnatShareStart + ((D.gnatShare - D.gnatShareStart) * (seconds - D.gnatFrom)) / (D.gnatFull - D.gnatFrom);
}

/** How many bollards may be alive at `seconds`. */
export function bollardCap(seconds: number): number {
  const D = DIRECTOR;
  if (seconds < D.bollardFrom) return 0;
  if (seconds >= D.bollardFull) return D.bollardMax;
  return 1 + Math.floor(((D.bollardMax - 1) * (seconds - D.bollardFrom)) / (D.bollardFull - D.bollardFrom));
}

const normal: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * How far behind a mover moving at (vx, vz) an enemy may be before it is taken away, m; Infinity
 * when the mover is too slow for anything to be left behind.
 */
export function behindLimit(vx: number, vz: number): number {
  const D = DIRECTOR;
  const speed = Math.sqrt(vx * vx + vz * vz);
  if (speed <= D.recycleBehindSpeed) return Infinity;
  const k = clamp((speed - D.recycleBehindSpeed) / (D.recycleBehindMinSpeed - D.recycleBehindSpeed), 0, 1);
  return D.recycleBehind + (D.recycleBehindMin - D.recycleBehind) * k;
}

/** Would an enemy at offset (dx, dz) from the mover be taken away this tick? */
function leftBehind(m: MoverState, dx: number, dz: number, behind: number): boolean {
  const d2 = dx * dx + dz * dz;
  const far = DIRECTOR.recycleFar;
  return d2 > far * far || (d2 > behind * behind && dx * m.vx + dz * m.vz < 0);
}

/**
 * Can something come up at (x, z)? Far enough from the mover, inside the region, on fair ground,
 * and not somewhere it would be taken away again at once.
 */
export function spawnSpotOk(terrain: Terrain, s: SimState, x: number, z: number): boolean {
  const D = DIRECTOR;
  const m = s.mover;
  const rMax = D.region * terrain.radius;
  if (x * x + z * z > rMax * rMax) return false;
  const dx = x - m.x;
  const dz = z - m.z;
  if (dx * dx + dz * dz < D.nearest * D.nearest) return false;
  if (leftBehind(m, dx, dz, behindLimit(m.vx, m.vz))) return false;
  terrain.normalAt(x, z, normal);
  const flat = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
  return flat < D.maxSlope * normal.y;
}

/** Where `findSpot` puts its answer. */
const spot = { x: 0, z: 0 };

/**
 * A spot for a new enemy around the mover, written to `spot`; false if no candidate fitted.
 * `inset` keeps a blob of that radius wholly inside the spawn ring and the region.
 */
function findSpot(w: World, s: SimState, terrain: Terrain, inset: number): boolean {
  const D = DIRECTOR;
  const m = s.mover;
  const speed = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
  const fast = speed > D.aheadSpeed;
  // Direction of travel as a yaw: forward(yaw) = (sin yaw, cos yaw).
  const travel = fast ? datan2(m.vx, m.vz) : 0;
  const lo = D.nearest + inset;
  const hi = D.farthest - inset;
  // Fast enough that nothing in the ring behind would survive the next recycle.
  const sidesOnly = behindLimit(m.vx, m.vz) < lo;
  for (let t = 0; t < D.tries; t++) {
    let yaw: number;
    if (!fast) {
      yaw = w.rng.next() * TAU;
    } else if (w.rng.next() < D.aheadShare) {
      yaw = travel + (w.rng.next() * 2 - 1) * D.aheadHalfAngle;
    } else if (sidesOnly) {
      // Outside the cone ahead, but not behind, where it would be taken away again at once.
      const side = w.rng.next() < 0.5 ? -1 : 1;
      yaw = travel + side * (D.aheadHalfAngle + w.rng.next() * (HALF_PI - D.aheadHalfAngle));
    } else {
      // The rest of the circle, outside the cone ahead.
      yaw = travel + D.aheadHalfAngle + w.rng.next() * (TAU - 2 * D.aheadHalfAngle);
    }
    // Uniform over the ring's area, not its radius.
    const r = Math.sqrt(lo * lo + w.rng.next() * (hi * hi - lo * lo));
    const x = m.x + dsin(yaw) * r;
    const z = m.z + dcos(yaw) * r;
    if (inset > 0) {
      const rMax = D.region * terrain.radius - inset;
      if (x * x + z * z > rMax * rMax) continue;
    }
    if (!spawnSpotOk(terrain, s, x, z)) continue;
    spot.x = x;
    spot.z = z;
    return true;
  }
  return false;
}

function spawnAt(w: World, terrain: Terrain, kind: number, x: number, z: number): boolean {
  return spawnEnemy(w, kind, x, terrain.heightAt(x, z), z) >= 0;
}

/** One gnat of the current cloud, somewhere in its blob. False if the cloud has to be given up. */
function spawnCloudGnat(w: World, s: SimState, terrain: Terrain, st: DirectorState): boolean {
  const D = DIRECTOR;
  for (let t = 0; t < D.tries; t++) {
    const a = w.rng.next() * TAU;
    const r = D.cloudRadius * Math.sqrt(w.rng.next());
    const x = st.cloudX + dsin(a) * r;
    const z = st.cloudZ + dcos(a) * r;
    if (!spawnSpotOk(terrain, s, x, z)) continue;
    st.cloudLeft--;
    return spawnAt(w, terrain, KIND_GNAT, x, z);
  }
  // Steep patches in the blob: come up at its centre instead, if that still fits.
  if (spawnSpotOk(terrain, s, st.cloudX, st.cloudZ)) {
    st.cloudLeft--;
    return spawnAt(w, terrain, KIND_GNAT, st.cloudX, st.cloudZ);
  }
  st.cloudLeft = 0;
  return false;
}

/** Take away what is too far from the mover, or far enough and left behind a fast one. */
function recycle(w: World, s: SimState): void {
  const h = w.horde;
  const m = s.mover;
  const behind = behindLimit(m.vx, m.vz);
  for (let i = h.count - 1; i >= 0; i--) {
    if (leftBehind(m, h.x[i] - m.x, h.z[i] - m.z, behind)) removeEnemy(w, i);
  }
}

/** Spawn and recycle for one tick. Does nothing unless `w.spawning`. */
export function stepDirector(w: World, s: SimState, terrain: Terrain): void {
  if (!w.spawning) return;
  const D = DIRECTOR;
  const st = stateOf(w);
  const tick = w.run.ticks;
  if (tick === 0) {
    // A fresh run (or a reset one): nothing carried over.
    st.cloudLeft = 0;
    st.nextBollard = 0;
  }

  recycle(w, s);

  const seconds = tick * DT;
  const target = targetCount(seconds);
  const h = w.horde;
  let gnats = 0;
  let bollards = 0;
  for (let i = 0; i < h.count; i++) {
    if (h.kind[i] === KIND_GNAT) gnats++;
    else if (h.kind[i] === KIND_BOLLARD) bollards++;
  }
  const gnatWanted = gnatShare(seconds) * target;
  const bollardsAllowed = bollardCap(seconds);

  for (let n = 0; n < D.perTick; n++) {
    if (st.cloudLeft > 0) {
      // A cloud comes up whole, even if that takes the horde a few over the target.
      if (spawnCloudGnat(w, s, terrain, st)) gnats++;
      continue;
    }
    if (h.count >= target) return;
    if (bollards < bollardsAllowed && tick >= st.nextBollard) {
      if (!findSpot(w, s, terrain, 0)) return;
      if (spawnAt(w, terrain, KIND_BOLLARD, spot.x, spot.z)) bollards++;
      st.nextBollard = tick + Math.round(D.bollardGap / DT);
      continue;
    }
    if (gnats + D.cloudSize * 0.5 <= gnatWanted) {
      // Keep the room for most of a cloud rather than fill it with shufflers.
      if (target - h.count < D.cloudSize * 0.5) return;
      if (!findSpot(w, s, terrain, D.cloudRadius)) return;
      st.cloudLeft = D.cloudSize;
      st.cloudX = spot.x;
      st.cloudZ = spot.z;
      if (spawnCloudGnat(w, s, terrain, st)) gnats++;
      continue;
    }
    if (!findSpot(w, s, terrain, 0)) return;
    spawnAt(w, terrain, KIND_SHUFFLER, spot.x, spot.z);
  }
}
