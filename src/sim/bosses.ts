/**
 * The bosses: three movement problems, one at a time, at the times in `BOSS_TIMES`.
 *
 * - The Bruiser walks at you, stops and faces where you will be (the tell), then charges in a
 *   straight line without steering. Turning during the tell beats it.
 * - The Mortar keeps its distance and lays a line of lob rings across where you are heading. A
 *   change of line beats it. Now and then it calls a cloud of gnats.
 * - The Standstill slows a grounded mover near it and sends rings out along the ground. An ollie
 *   over the front beats them (so does a rail). Now and then it calls an elite.
 *
 * A boss is an ordinary enemy in the horde with `boss: true` in its kind: weapons hit it, touching
 * it hurts, nothing clears it. Its kind has `accel` 0, so the horde's step only carries it along:
 * this step sets its velocity every tick, and uses `Horde.state` and `timer` for its phases. It is
 * never thrown and never recycled. While one is alive `w.boss` says where it is and how it stands.
 *
 * When it falls: `FX_BOSS_DOWN`, 40% of maximum health back, its sparks (its kind's `xp`, dropped by
 * the sparks' step like anyone's) and a rare card. The Standstill's fall wins the run.
 *
 * Runs once a tick after the dead are reaped (it reads `w.deaths`) and before the sparks. Pure and
 * allocation-free after a world's first tick.
 */
import { BOSS_TIMES } from './balance';
import { queueOffer } from './build';
import { DT, TICK_HZ } from './constants';
import { hurtPlayer } from './contact';
import { DIRECTOR, makeElite } from './director';
import { lob } from './hazards';
import { dcos, dsin, PI, TAU } from './math';
import { OFFER_TOTEM } from './offer';
import type { Terrain } from './terrain';
import type { SimState, Vec3 } from './types';
import {
  addZone,
  ELITE_HASTE,
  ELITE_JAM,
  emitFx,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_HEAL,
  KIND_BRUISER,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_STANDSTILL,
  KINDS,
  PHASE_PLAY,
  PHASE_WON,
  removeZone,
  SPAWN_TICKS,
  spawnEnemy,
  ZONE_RING,
  type World,
} from './world';

export const BOSS = {
  /** A boss comes up this far ahead of the mover, m: along its travel at this speed or more (m/s), else along the view. */
  ahead: 45,
  aheadSpeed: 3,
  /** Share of maximum health a fallen boss gives back. */
  heal: 0.15,

  bruiser: {
    /** Walking speed, m/s. */
    walk: 3,
    /** Seconds of walking between charges. */
    every: 4,
    /** Seconds it stands facing where it will charge: the tell. */
    tell: 0.8,
    /** While telling it leans in along its aim at this, m/s: slow enough to call standing, enough to show which way it faces. */
    lean: 0.15,
    /** Charge speed, m/s, and its limits: this far, m, or this long, s, whichever comes first. */
    charge: 16,
    chargeFar: 40,
    chargeFor: 2.5,
    /** Seconds it stands winded after a charge. */
    rest: 1,
  },

  mortar: {
    speed: 2,
    /** It backs off when nearer than this and closes in when farther than `far`, m. */
    near: 10,
    far: 18,
    /** Seconds between lines of rings. */
    volleyEvery: 4,
    /** Rings in a line, how far apart, m, and how long until they land, s. */
    rings: 5,
    ringGap: 4,
    ringFlight: 1.2,
    /** Seconds between gnat clouds; gnats in one; how far in front of it they come up, m, and in how wide a blob. */
    gnatsEvery: 12,
    gnats: 10,
    gnatsAhead: 3,
    gnatsRadius: 1.5,
  },

  standstill: {
    speed: 2.5,
    /** A grounded mover this near it is slowed by this much drag, 1/s. */
    auraReach: 8.5,
    auraDrag: 0.8,
    /** Seconds between rings; how fast the front spreads, m/s; how far it goes, m; its damage. */
    ringEvery: 3.5,
    ringSpeed: 9,
    ringReach: 40,
    ringDamage: 35,
    /** Seconds between called elites, and how far from it they come up, m. */
    eliteEvery: 15,
    eliteNear: 10,
    eliteFar: 14,
  },
} as const;

/** The boss that comes at each of `BOSS_TIMES`. */
export const BOSS_KINDS: readonly number[] = [KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL];

/** The Bruiser's phases, in `Horde.state`. Never 1: contact reads state 1 as a clinger holding on. */
export const BRUISER_WALK = 0;
export const BRUISER_TELL = 2;
export const BRUISER_CHARGE = 3;
export const BRUISER_REST = 4;

const B = BOSS.bruiser;
const M = BOSS.mortar;
const S = BOSS.standstill;
const BRUISER_EVERY = Math.round(B.every * TICK_HZ);
const BRUISER_TELL_TICKS = Math.round(B.tell * TICK_HZ);
const BRUISER_CHARGE_TICKS = Math.round(B.chargeFor * TICK_HZ);
const BRUISER_REST_TICKS = Math.round(B.rest * TICK_HZ);
const MORTAR_VOLLEY = Math.round(M.volleyEvery * TICK_HZ);
const MORTAR_GNATS = Math.round(M.gnatsEvery * TICK_HZ);
const MORTAR_FLIGHT = Math.round(M.ringFlight * TICK_HZ);
/** The Mortar's timer wraps here: a whole number of both its periods. */
const MORTAR_WRAP = lcm(MORTAR_VOLLEY, MORTAR_GNATS);
const STAND_RING = Math.round(S.ringEvery * TICK_HZ);
const STAND_ELITE = Math.round(S.eliteEvery * TICK_HZ);
const STAND_WRAP = lcm(STAND_RING, STAND_ELITE);
/** A ring lives as long as its front takes to reach `ringReach`. */
const RING_TICKS = Math.ceil((S.ringReach / S.ringSpeed) * TICK_HZ);

function lcm(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return (a / x) * b;
}

/** What the bosses remember between ticks for one world. */
interface BossBrain {
  /** The run tick last stepped, to notice a fresh run or a clock that was set. */
  lastTick: number;
  /** Index in `BOSS_TIMES` of the next boss to come. */
  next: number;
  /** The Bruiser's aim (a unit vector) and where its charge began. */
  aimX: number;
  aimZ: number;
  fromX: number;
  fromZ: number;
  /** The mover's position at the last step, for the rings' crossing test. */
  moverX: number;
  moverZ: number;
}

const brains = new WeakMap<World, BossBrain>();

function brainOf(w: World, s: SimState): BossBrain {
  let b = brains.get(w);
  if (b === undefined) {
    b = { lastTick: -2, next: 0, aimX: 0, aimZ: 1, fromX: 0, fromZ: 0, moverX: s.mover.x, moverZ: s.mover.z };
    brains.set(w, b);
  }
  return b;
}

/** Index of the boss in the horde, or -1. */
export function findBoss(w: World): number {
  const h = w.horde;
  for (let i = 0; i < h.count; i++) if (KINDS[h.kind[i]].boss === true) return i;
  return -1;
}

/** The first boss whose time is at or after run tick `tick`. */
function nextAt(tick: number): number {
  let k = 0;
  while (k < BOSS_TIMES.length && Math.round(BOSS_TIMES[k] * TICK_HZ) < tick) k++;
  return k;
}

const normal: Vec3 = { x: 0, y: 1, z: 0 };

/** Can a boss of radius `r` come up at (x, z): inside the enemies' region and on fair ground? */
function fairGround(terrain: Terrain, x: number, z: number, r: number): boolean {
  const rMax = DIRECTOR.region * terrain.radius - r;
  if (x * x + z * z > rMax * rMax) return false;
  terrain.normalAt(x, z, normal);
  return Math.sqrt(normal.x * normal.x + normal.z * normal.z) < DIRECTOR.maxSlope * normal.y;
}

/** The way the mover is going: its velocity, or its heading when it is nearly still. Into `dir`. */
const dir = { x: 0, z: 1 };
function travel(s: SimState): void {
  const m = s.mover;
  const v = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
  if (v > 0.5) {
    dir.x = m.vx / v;
    dir.z = m.vz / v;
  } else {
    dir.x = dsin(m.heading);
    dir.z = dcos(m.heading);
  }
}

/**
 * Bring boss `kind` on, `BOSS.ahead` in front of the mover: along its travel when it is going
 * somewhere (`BOSS.aheadSpeed` or faster), else where the view looks, so it comes up on screen. If
 * that is off the floor, the nearest direction either side that is on it; if none is, straight
 * ahead pulled in to the region.
 */
function arrive(w: World, s: SimState, terrain: Terrain, kind: number): number {
  const m = s.mover;
  const r = KINDS[kind].radius;
  if (m.vx * m.vx + m.vz * m.vz >= BOSS.aheadSpeed * BOSS.aheadSpeed) {
    travel(s);
  } else {
    dir.x = dsin(s.viewYaw);
    dir.z = dcos(s.viewYaw);
  }
  let x = m.x + dir.x * BOSS.ahead;
  let z = m.z + dir.z * BOSS.ahead;
  if (!fairGround(terrain, x, z, r)) {
    let found = false;
    for (let k = 1; k <= 9 && !found; k++) {
      for (let side = -1; side <= 1 && !found; side += 2) {
        const a = (side * k * PI) / 9;
        const c = dcos(a);
        const sn = dsin(a);
        const dx = dir.x * c + dir.z * sn;
        const dz = dir.z * c - dir.x * sn;
        const cx = m.x + dx * BOSS.ahead;
        const cz = m.z + dz * BOSS.ahead;
        if (fairGround(terrain, cx, cz, r)) {
          x = cx;
          z = cz;
          found = true;
        }
      }
    }
    if (!found) {
      const rMax = DIRECTOR.region * terrain.radius - r;
      const d = Math.sqrt(x * x + z * z);
      if (d > rMax) {
        x *= rMax / d;
        z *= rMax / d;
      }
    }
  }
  const i = spawnEnemy(w, kind, x, terrain.heightAt(x, z), z);
  if (i >= 0) emitFx(w, FX_BOSS_IN, x, terrain.heightAt(x, z), z, kind);
  return i;
}

/** A boss fell this tick: the rewards, and for the last one the run. */
function fell(w: World, s: SimState, kind: number, x: number, y: number, z: number): void {
  const p = w.player;
  const m = s.mover;
  emitFx(w, FX_BOSS_DOWN, x, y, z, kind);
  w.boss.felled++;
  const give = Math.min(p.maxHp - p.hp, p.maxHp * BOSS.heal);
  if (give > 0) {
    p.hp += give;
    emitFx(w, FX_HEAL, m.x, m.y, m.z, give);
  }
  queueOffer(w, OFFER_TOTEM);
  if (kind === KIND_STANDSTILL && w.run.phase === PHASE_PLAY) w.run.phase = PHASE_WON;
}

/** Set boss i's velocity to `speed` toward (or, negative, away from) the mover. */
function walk(w: World, s: SimState, i: number, speed: number): void {
  const h = w.horde;
  const dx = s.mover.x - h.x[i];
  const dz = s.mover.z - h.z[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-3) {
    h.vx[i] = 0;
    h.vz[i] = 0;
    return;
  }
  h.vx[i] = (dx / d) * speed;
  h.vz[i] = (dz / d) * speed;
}

/**
 * Where the Bruiser aims when its tell begins: where the mover will be when a charge that starts
 * after the tell meets it, if the mover keeps its line. Solves |o + v t| = charge (t - tell) for the
 * first t after the tell; a mover it cannot catch is aimed at where it will be when the tell ends.
 */
function aimBruiser(w: World, s: SimState, i: number, b: BossBrain): void {
  const h = w.horde;
  const m = s.mover;
  const ox = m.x - h.x[i];
  const oz = m.z - h.z[i];
  const c: number = B.charge;
  const d: number = B.tell;
  const qa = m.vx * m.vx + m.vz * m.vz - c * c;
  const qb = ox * m.vx + oz * m.vz + c * c * d;
  const qc = ox * ox + oz * oz - c * c * d * d;
  let t = d;
  const disc = qb * qb - qa * qc;
  if (qa < -1e-6 && disc >= 0) {
    // qa < 0: the larger root of qa t^2 + 2 qb t + qc = 0 is the one after the tell.
    const root = (-qb - Math.sqrt(disc)) / qa;
    if (root > d) t = root < d + B.chargeFor ? root : d + B.chargeFor;
  }
  const ax = ox + m.vx * t;
  const az = oz + m.vz * t;
  const l = Math.sqrt(ax * ax + az * az);
  if (l < 1e-3) {
    // On top of it: any way will do; its own phase picks one.
    b.aimX = dsin(TAU * h.phase[i]);
    b.aimZ = dcos(TAU * h.phase[i]);
  } else {
    b.aimX = ax / l;
    b.aimZ = az / l;
  }
}

function stepBruiser(w: World, s: SimState, i: number, b: BossBrain): void {
  const h = w.horde;
  const st = h.state[i];
  const t = h.timer[i] + 1;
  h.timer[i] = t;
  if (st === BRUISER_TELL) {
    if (t >= BRUISER_TELL_TICKS) {
      h.state[i] = BRUISER_CHARGE;
      h.timer[i] = 0;
      b.fromX = h.x[i];
      b.fromZ = h.z[i];
      h.vx[i] = b.aimX * B.charge;
      h.vz[i] = b.aimZ * B.charge;
    } else {
      h.vx[i] = b.aimX * B.lean;
      h.vz[i] = b.aimZ * B.lean;
    }
  } else if (st === BRUISER_CHARGE) {
    const dx = h.x[i] - b.fromX;
    const dz = h.z[i] - b.fromZ;
    if (t >= BRUISER_CHARGE_TICKS || dx * dx + dz * dz >= B.chargeFar * B.chargeFar) {
      h.state[i] = BRUISER_REST;
      h.timer[i] = 0;
      h.vx[i] = 0;
      h.vz[i] = 0;
    } else {
      // Straight on: it does not steer.
      h.vx[i] = b.aimX * B.charge;
      h.vz[i] = b.aimZ * B.charge;
    }
  } else if (st === BRUISER_REST) {
    h.vx[i] = 0;
    h.vz[i] = 0;
    if (t >= BRUISER_REST_TICKS) {
      h.state[i] = BRUISER_WALK;
      h.timer[i] = 0;
    }
  } else {
    if (t >= BRUISER_EVERY) {
      h.state[i] = BRUISER_TELL;
      h.timer[i] = 0;
      aimBruiser(w, s, i, b);
      h.vx[i] = b.aimX * B.lean;
      h.vz[i] = b.aimZ * B.lean;
    } else {
      walk(w, s, i, B.walk);
    }
  }
}

/** A line of rings across where the mover will be when they land, `ringGap` apart. */
function volley(w: World, s: SimState, terrain: Terrain): void {
  const m = s.mover;
  travel(s);
  const cx = m.x + m.vx * M.ringFlight;
  const cz = m.z + m.vz * M.ringFlight;
  // Across the way it is going.
  const px = dir.z;
  const pz = -dir.x;
  const half = (M.rings - 1) / 2;
  for (let k = 0; k < M.rings; k++) {
    const o = (k - half) * M.ringGap;
    lob(w, terrain, cx + px * o, cz + pz * o, MORTAR_FLIGHT);
  }
}

/** A cloud of gnats a little in front of the Mortar, toward the mover. Outside the director's budget. */
function callGnats(w: World, s: SimState, terrain: Terrain, i: number): void {
  const h = w.horde;
  const dx = s.mover.x - h.x[i];
  const dz = s.mover.z - h.z[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  const k = d > 1e-3 ? (KINDS[KIND_MORTAR].radius + M.gnatsAhead) / d : 0;
  const cx = h.x[i] + dx * k;
  const cz = h.z[i] + dz * k;
  for (let n = 0; n < M.gnats; n++) {
    const a = w.rng.next() * TAU;
    const r = M.gnatsRadius * Math.sqrt(w.rng.next());
    const x = cx + dsin(a) * r;
    const z = cz + dcos(a) * r;
    if (spawnEnemy(w, KIND_GNAT, x, terrain.heightAt(x, z), z) < 0) return;
  }
}

function stepMortar(w: World, s: SimState, terrain: Terrain, i: number): void {
  const h = w.horde;
  const dx = s.mover.x - h.x[i];
  const dz = s.mover.z - h.z[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  walk(w, s, i, d > M.far ? M.speed : d < M.near ? -M.speed : 0);
  const t = (h.timer[i] + 1) % MORTAR_WRAP;
  h.timer[i] = t;
  if (t % MORTAR_VOLLEY === 0) volley(w, s, terrain);
  if (t % MORTAR_GNATS === 0) callGnats(w, s, terrain, i);
}

/** An elite shuffler or cutter with a random aura, a little way from the Standstill. */
function callElite(w: World, terrain: Terrain, i: number): void {
  const h = w.horde;
  const a = w.rng.next() * TAU;
  const r = S.eliteNear + w.rng.next() * (S.eliteFar - S.eliteNear);
  let x = h.x[i] + dsin(a) * r;
  let z = h.z[i] + dcos(a) * r;
  const rMax = DIRECTOR.region * terrain.radius;
  const d = Math.sqrt(x * x + z * z);
  if (d > rMax) {
    x *= rMax / d;
    z *= rMax / d;
  }
  const kind = w.rng.next() < 0.5 ? KIND_SHUFFLER : KIND_CUTTER;
  const e = spawnEnemy(w, kind, x, terrain.heightAt(x, z), z);
  if (e < 0) return;
  const aura = ELITE_HASTE + Math.floor(w.rng.next() * 3);
  makeElite(w, e, aura > ELITE_JAM ? ELITE_JAM : aura);
}

function stepStandstill(w: World, s: SimState, terrain: Terrain, i: number): void {
  const h = w.horde;
  const m = s.mover;
  walk(w, s, i, S.speed);
  const dx = m.x - h.x[i];
  const dz = m.z - h.z[i];
  // The drag the hazards worked out this tick is read by the mover next tick: add to it.
  if (m.grounded && dx * dx + dz * dz <= S.auraReach * S.auraReach) w.player.cling += S.auraDrag;
  const t = (h.timer[i] + 1) % STAND_WRAP;
  h.timer[i] = t;
  if (t % STAND_RING === 0) addZone(w, ZONE_RING, h.x[i], h.y[i], h.z[i], 0, RING_TICKS, S.ringDamage);
  if (t % STAND_ELITE === 0) callElite(w, terrain, i);
}

/**
 * Spread the rings and hurt a mover on the ground as a front crosses it. A front crosses when the
 * mover was outside it last tick and is inside it now. In the air or on a rail it passes under.
 */
function stepRings(w: World, s: SimState, b: BossBrain): void {
  const zn = w.zones;
  const m = s.mover;
  const p = w.player;
  const grow = S.ringSpeed * DT;
  for (let k = zn.count - 1; k >= 0; k--) {
    if (zn.kind[k] !== ZONE_RING) continue;
    const r0 = zn.r[k];
    const r1 = r0 + grow;
    zn.r[k] = r1;
    if (zn.age[k] < 65535) zn.age[k]++;
    if (zn.life[k] > 0) zn.life[k]--;
    const ax = b.moverX - zn.x[k];
    const az = b.moverZ - zn.z[k];
    const bx = m.x - zn.x[k];
    const bz = m.z - zn.z[k];
    const crossed = ax * ax + az * az > r0 * r0 && bx * bx + bz * bz <= r1 * r1;
    if (crossed && m.grounded && m.rail < 0 && p.invuln === 0 && w.run.phase === PHASE_PLAY) hurtPlayer(w, s, zn.power[k]);
    if (zn.life[k] === 0 || r1 >= S.ringReach) removeZone(w, k);
  }
}

/** Write what the HUD and the camera read about the boss. */
function report(w: World, i: number): void {
  const bs = w.boss;
  if (i < 0) {
    bs.kind = -1;
    bs.hp = 0;
    bs.maxHp = 0;
    return;
  }
  const h = w.horde;
  bs.kind = h.kind[i];
  bs.hp = h.hp[i] > 0 ? h.hp[i] : 0;
  bs.maxHp = KINDS[h.kind[i]].hp;
  bs.x = h.x[i];
  bs.z = h.z[i];
}

/** One tick of the bosses. Call after `reapHorde`, before the sparks. */
export function stepBosses(w: World, s: SimState, terrain: Terrain): void {
  const b = brainOf(w, s);
  const tick = w.run.ticks;
  if (tick !== b.lastTick + 1) {
    // A new run, or the clock was set: the next boss is the first whose time is still to come.
    b.next = nextAt(tick);
    b.moverX = s.mover.x;
    b.moverZ = s.mover.z;
  }
  b.lastTick = tick;

  const d = w.deaths;
  for (let k = 0; k < d.count; k++) {
    if (KINDS[d.kind[k]].boss === true) fell(w, s, d.kind[k], d.x[k], d.y[k], d.z[k]);
  }

  let i = findBoss(w);
  if (i < 0 && b.next < BOSS_TIMES.length && w.run.phase === PHASE_PLAY && tick >= Math.round(BOSS_TIMES[b.next] * TICK_HZ)) {
    i = arrive(w, s, terrain, BOSS_KINDS[b.next]);
    b.next++;
  }

  if (i >= 0 && w.horde.age[i] >= SPAWN_TICKS) {
    const h = w.horde;
    // Nothing throws a boss.
    h.stun[i] = 0;
    const kind = h.kind[i];
    if (kind === KIND_BRUISER) stepBruiser(w, s, i, b);
    else if (kind === KIND_MORTAR) stepMortar(w, s, terrain, i);
    else stepStandstill(w, s, terrain, i);
  }
  stepRings(w, s, b);
  b.moverX = s.mover.x;
  b.moverZ = s.mover.z;
  report(w, i);
}
