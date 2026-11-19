/**
 * The spawn director: brings the right kinds in from where the player is heading, at a rate, and
 * takes away what has been left far behind so it can come back ahead.
 *
 * Enemies arrive at a rate that rises with run time, paid for from a budget: every second adds the
 * rate, each enemy costs one (a gnat cloud costs its size). Killing faster than the rate thins the
 * horde; killing slower lets it grow. Two bounds hold whatever the player does: below the floor the
 * director spawns as fast as it can until the floor is met (the field is never empty), and it never
 * lets more than the cap be alive. What it takes away is refunded, so it comes back promptly.
 *
 * Every number is in `DIRECTOR`. Pure and allocation-free after a world's first tick: the little
 * state it carries between ticks (a gnat cloud still coming up, when the next bollard may come)
 * lives in one object per world, created once.
 */
import { DT } from './constants';
import { clamp, datan2, dcos, dsin, HALF_PI, PI, TAU } from './math';
import type { Terrain } from './terrain';
import type { MoverState, SimState, Vec3 } from './types';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_NONE,
  KIND_BOLLARD,
  KIND_CLINGER,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KINDS,
  MARK_PACK,
  removeEnemy,
  spawnEnemy,
  type World,
} from './world';

const DEG = PI / 180;

export const DIRECTOR = {
  /** Run times (s) at which the rate, floor and cap below are given; linear between, flat after. */
  at: [0, 30, 60, 120, 180],
  /** Enemies arriving per second. */
  rate: [2.5, 5, 8, 13, 17],
  /** Fewer than this alive and the director spawns perTick a tick until there are this many. */
  floor: [10, 15, 25, 40, 60],
  /** Never more than this alive. */
  cap: [50, 100, 200, 330, 400],
  /** Seconds of rate the budget may hold beyond what the room under the cap could use. */
  bank: 2,
  /** Most spawns in one tick. */
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

  /** Cutters arrive from this run time, as this share of the horde. */
  cutterFrom: 60,
  cutterShare: 0.08,
  /** Lobbers arrive from this run time, one at a time at least lobberGap s apart, at most lobberMax alive. */
  lobberFrom: 75,
  lobberMax: 8,
  lobberGap: 2.5,
  /** Sludges likewise. */
  sludgeFrom: 100,
  sludgeMax: 5,
  sludgeGap: 4,
  /** Clingers arrive from this run time, as this share of the horde. */
  clingerFrom: 120,
  clingerShare: 0.06,

  /** From this run time, about every eliteEvery s, the next shuffler or cutter to come up is an elite. */
  eliteFrom: 90,
  eliteEvery: 25,
  /** An elite has this many times its kind's health. */
  eliteHp: 6,

  /** A totem's pack: one elite and packSize shufflers in a ring this far from it, m. */
  packSize: 10,
  packNear: 18,
  packFar: 24,

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
  /** Run ticks from which the next lobber, sludge and elite may come. */
  nextLobber: number;
  nextSludge: number;
  nextElite: number;
  /** Spawns paid for and not yet made. */
  budget: number;
}

const states = new WeakMap<World, DirectorState>();

function stateOf(w: World): DirectorState {
  let st = states.get(w);
  if (st === undefined) {
    st = { cloudLeft: 0, cloudX: 0, cloudZ: 0, nextBollard: 0, nextLobber: 0, nextSludge: 0, nextElite: 0, budget: 0 };
    states.set(w, st);
  }
  return st;
}

/** Make enemy i an elite with `aura` (ELITE_*): more health; its aura is the horde's business. */
export function makeElite(w: World, i: number, aura: number): void {
  const h = w.horde;
  h.elite[i] = aura;
  h.hp[i] = KINDS[h.kind[i]].hp * DIRECTOR.eliteHp;
}

/** One of the three auras, at random. */
function randomAura(w: World): number {
  const a = ELITE_HASTE + Math.floor(w.rng.next() * 3);
  return a > ELITE_JAM ? ELITE_JAM : a;
}

/** Share of the horde that should be cutters at `seconds`. */
export function cutterShare(seconds: number): number {
  return seconds < DIRECTOR.cutterFrom ? 0 : DIRECTOR.cutterShare;
}

/** Share of the horde that should be clingers at `seconds`. */
export function clingerShare(seconds: number): number {
  return seconds < DIRECTOR.clingerFrom ? 0 : DIRECTOR.clingerShare;
}

/** How many lobbers may be alive at `seconds`. */
export function lobberCap(seconds: number): number {
  return seconds < DIRECTOR.lobberFrom ? 0 : DIRECTOR.lobberMax;
}

/** How many sludges may be alive at `seconds`. */
export function sludgeCap(seconds: number): number {
  return seconds < DIRECTOR.sludgeFrom ? 0 : DIRECTOR.sludgeMax;
}

/** (x, z) pulled in to lie inside the spawn region, written to `spot`. */
function inRegion(terrain: Terrain, x: number, z: number): void {
  const rMax = DIRECTOR.region * terrain.radius;
  const r2 = x * x + z * z;
  if (r2 > rMax * rMax) {
    const k = rMax / Math.sqrt(r2);
    x *= k;
    z *= k;
  }
  spot.x = x;
  spot.z = z;
}

/**
 * Answer the totems: for each place asked for, an elite with a random aura (marked as the pack's)
 * and a ring of shufflers around it, outside the budget and the cap. Then the requests are cleared.
 */
function servePacks(w: World, terrain: Terrain): void {
  const D = DIRECTOR;
  const n = w.packs < w.packX.length ? w.packs : w.packX.length;
  for (let p = 0; p < n; p++) {
    inRegion(terrain, w.packX[p], w.packZ[p]);
    const cx = spot.x;
    const cz = spot.z;
    const kind = w.rng.next() < 0.5 ? KIND_SHUFFLER : KIND_CUTTER;
    const e = spawnEnemy(w, kind, cx, terrain.heightAt(cx, cz), cz);
    if (e < 0) break;
    makeElite(w, e, randomAura(w));
    w.horde.mark[e] |= MARK_PACK;
    const turn = w.rng.next() * TAU;
    for (let k = 0; k < D.packSize; k++) {
      const a = turn + (k / D.packSize) * TAU;
      const r = D.packNear + w.rng.next() * (D.packFar - D.packNear);
      inRegion(terrain, cx + dsin(a) * r, cz + dcos(a) * r);
      if (!spawnAt(w, terrain, KIND_SHUFFLER, spot.x, spot.z)) break;
    }
  }
  w.packs = 0;
}

/** One of the DIRECTOR schedules (rate, floor, cap) at `seconds` into the run. */
function schedule(values: readonly number[], seconds: number): number {
  const at = DIRECTOR.at;
  if (seconds <= at[0]) return values[0];
  for (let k = 1; k < at.length; k++) {
    if (seconds < at[k]) return values[k - 1] + ((values[k] - values[k - 1]) * (seconds - at[k - 1])) / (at[k] - at[k - 1]);
  }
  return values[values.length - 1];
}

/** Enemies arriving per second at `seconds` into the run. */
export function spawnRate(seconds: number): number {
  return schedule(DIRECTOR.rate, seconds);
}

/** The fewest alive the director allows at `seconds`. */
export function floorCount(seconds: number): number {
  return schedule(DIRECTOR.floor, seconds);
}

/** The most alive the director allows at `seconds`. */
export function capCount(seconds: number): number {
  return schedule(DIRECTOR.cap, seconds);
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

/**
 * Take away what is too far from the mover, or far enough and left behind a fast one. Elites stay:
 * one is something to hunt (a pack's is a totem's reward), and it would not come back as itself.
 */
function recycle(w: World, s: SimState): number {
  const h = w.horde;
  const m = s.mover;
  const behind = behindLimit(m.vx, m.vz);
  let taken = 0;
  for (let i = h.count - 1; i >= 0; i--) {
    if (h.elite[i] === ELITE_NONE && leftBehind(m, h.x[i] - m.x, h.z[i] - m.z, behind)) {
      removeEnemy(w, i);
      taken++;
    }
  }
  return taken;
}

/**
 * One ordinary enemy of `kind` at `spot`. When an elite is due, a shuffler or cutter coming up is
 * it. False if the horde is full.
 */
function spawnKind(w: World, terrain: Terrain, st: DirectorState, kind: number, tick: number): boolean {
  const i = spawnEnemy(w, kind, spot.x, terrain.heightAt(spot.x, spot.z), spot.z);
  if (i < 0) return false;
  if ((kind === KIND_SHUFFLER || kind === KIND_CUTTER) && tick >= st.nextElite) {
    makeElite(w, i, randomAura(w));
    st.nextElite = tick + Math.round(DIRECTOR.eliteEvery / DT);
  }
  return true;
}

/**
 * Spawn and recycle for one tick. Packs a totem asked for come whatever; nothing else does unless
 * `w.spawning`.
 */
export function stepDirector(w: World, s: SimState, terrain: Terrain): void {
  if (w.packs > 0) servePacks(w, terrain);
  if (!w.spawning) return;
  const D = DIRECTOR;
  const st = stateOf(w);
  const tick = w.run.ticks;
  if (tick === 0) {
    // A fresh run (or a reset one): nothing carried over.
    st.cloudLeft = 0;
    st.nextBollard = 0;
    st.nextLobber = Math.round(D.lobberFrom / DT);
    st.nextSludge = Math.round(D.sludgeFrom / DT);
    st.nextElite = Math.round(D.eliteFrom / DT);
    st.budget = 0;
  }

  const taken = recycle(w, s);

  const seconds = tick * DT;
  const h = w.horde;
  const cap = Math.floor(capCount(seconds));
  const floor = floorCount(seconds);
  // Pay in this tick's share of the rate, holding no more than a couple of seconds of it (or a whole
  // cloud) unspent; then refund what was just taken away, so it comes back at once.
  const rate = spawnRate(seconds);
  const hold = Math.max(rate * D.bank, D.cloudSize);
  if (st.budget < hold) {
    st.budget += rate * DT;
    if (st.budget > hold) st.budget = hold;
  }
  st.budget += taken;

  let gnats = 0;
  let bollards = 0;
  let cutters = 0;
  let lobbers = 0;
  let sludges = 0;
  let clingers = 0;
  for (let i = 0; i < h.count; i++) {
    const k = h.kind[i];
    if (k === KIND_GNAT) gnats++;
    else if (k === KIND_BOLLARD) bollards++;
    else if (k === KIND_CUTTER) cutters++;
    else if (k === KIND_LOBBER) lobbers++;
    else if (k === KIND_SLUDGE) sludges++;
    else if (k === KIND_CLINGER) clingers++;
  }
  const crowd = h.count > floor ? h.count : floor;
  const gnatWanted = gnatShare(seconds) * crowd;
  const cutterWanted = cutterShare(seconds) * crowd;
  const clingerWanted = clingerShare(seconds) * crowd;
  const bollardsAllowed = bollardCap(seconds);
  const lobbersAllowed = lobberCap(seconds);
  const sludgesAllowed = sludgeCap(seconds);

  for (let n = 0; n < D.perTick; n++) {
    if (st.cloudLeft > 0) {
      // A cloud is paid for whole and comes up whole.
      if (spawnCloudGnat(w, s, terrain, st)) gnats++;
      continue;
    }
    if (h.count >= cap) break;
    // Below the floor spawns are free; above it each is paid from the budget.
    const free = h.count < floor;
    if (!free && st.budget < 1) break;
    if (bollards < bollardsAllowed && tick >= st.nextBollard) {
      if (!findSpot(w, s, terrain, 0)) break;
      if (spawnAt(w, terrain, KIND_BOLLARD, spot.x, spot.z)) {
        bollards++;
        if (!free) st.budget -= 1;
      }
      st.nextBollard = tick + Math.round(D.bollardGap / DT);
      continue;
    }
    if (gnats + D.cloudSize * 0.5 <= gnatWanted) {
      // Save up for a whole cloud rather than spend the budget on shufflers.
      if (h.count + D.cloudSize > cap) break;
      if (!free && st.budget < D.cloudSize) break;
      if (!findSpot(w, s, terrain, D.cloudRadius)) break;
      st.cloudLeft = D.cloudSize;
      st.cloudX = spot.x;
      st.cloudZ = spot.z;
      if (!free) st.budget -= D.cloudSize;
      if (spawnCloudGnat(w, s, terrain, st)) gnats++;
      continue;
    }
    // The rest come one at a time: the capped kinds when their gap allows, the shared kinds while
    // short of their share, and shufflers otherwise.
    let kind = KIND_SHUFFLER;
    if (lobbers < lobbersAllowed && tick >= st.nextLobber) {
      kind = KIND_LOBBER;
      st.nextLobber = tick + Math.round(D.lobberGap / DT);
    } else if (sludges < sludgesAllowed && tick >= st.nextSludge) {
      kind = KIND_SLUDGE;
      st.nextSludge = tick + Math.round(D.sludgeGap / DT);
    } else if (cutters + 1 <= cutterWanted) {
      kind = KIND_CUTTER;
    } else if (clingers + 1 <= clingerWanted) {
      kind = KIND_CLINGER;
    }
    if (!findSpot(w, s, terrain, 0)) break;
    if (!spawnKind(w, terrain, st, kind, tick)) break;
    if (!free) st.budget -= 1;
    if (kind === KIND_LOBBER) lobbers++;
    else if (kind === KIND_SLUDGE) sludges++;
    else if (kind === KIND_CUTTER) cutters++;
    else if (kind === KIND_CLINGER) clingers++;
  }
  // Refunds do not bank past the room under the cap: at the cap the budget holds only `hold`.
  const room = cap - h.count > 0 ? cap - h.count : 0;
  if (st.budget > hold + room) st.budget = hold + room;
}
