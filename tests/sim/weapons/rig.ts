/**
 * Shared set-up for the weapon tests: one weapon alone on level ground among hand-placed enemies,
 * with the speed and gear held so rides compare, the mover held on one spot in different poses,
 * and a scripted ride through a placed crowd.
 */
import { P_HASTE, W_WAKE } from '../../../src/sim/arsenal';
import { applyBuildToMover, setPassiveLevel, setWeaponLevel } from '../../../src/sim/build';
import { DT } from '../../../src/sim/constants';
import { stepMover } from '../../../src/sim/mover';
import { copySimState, makeSimState, type Sim } from '../../../src/sim/sim';
import { makeInputFrame, type InputFrame, type SimState } from '../../../src/sim/types';
import { KIND_BOLLARD, KIND_SHUFFLER, spawnEnemy, type World } from '../../../src/sim/world';
import { FORWARD, steer, TUCK } from '../fixtures';
import { arena, place, root } from '../world-fixtures';

/**
 * A run with only `id` at `level`: the starting Wake is taken away, and levelling up is switched off
 * so an automatic card can never add another weapon mid-test.
 */
export function rig(id: number, level: number, keepWake = false): Sim {
  const sim = arena();
  if (!keepWake) setWeaponLevel(sim.world, W_WAKE, 0);
  setWeaponLevel(sim.world, id, level);
  sim.world.player.xpNext = Infinity;
  return sim;
}

/** Give the player the Haste passive at `level` (5 is the most there is); returns the wait multiplier. */
export function haste(sim: Sim, level: number): number {
  setPassiveLevel(sim.world, P_HASTE, level);
  return sim.world.player.stats.haste;
}

/** Ticks in `seconds`, for waits that are a whole number of ticks. */
export function ticksIn(seconds: number): number {
  return Math.round(seconds / DT);
}

// ---- the mover held on one spot ------------------------------------------------------------

/**
 * How the mover is held for a tick: standing still; riding at 12 m/s with the thumb on and off and
 * a hop every 45 ticks (so it tucks, carves, hops and lands); or launched, 4 m up at 30 m/s.
 */
export type Pose = 'stand' | 'ride' | 'launch';

const POSE_SPEED: Record<Pose, number> = { stand: 0, ride: 12, launch: 30 };
const RIDE_HOP: InputFrame = { steerX: 0, steerY: 0, carve: false, hop: true };
const RIDE_CARVE: InputFrame = { steerX: 0, steerY: 1, carve: true, hop: false };

/** What the held mover is given on tick `t` of a pose. */
function poseInput(pose: Pose, t: number): InputFrame {
  if (pose !== 'ride') return TUCK;
  if (t % 45 === 20) return RIDE_HOP;
  return t % 90 < 45 ? TUCK : RIDE_CARVE;
}

let rehearsal: SimState | null = null;

/**
 * One rooted step with the mover facing +z at the origin in `pose` and `gear`. Its velocity, gear,
 * tuck, hops and landings are whatever the pose says, but it is put back so that it ends the
 * mover's own step exactly at the origin (the step is rehearsed on a copy first, on level ground):
 * every pose sees the same field from the same place.
 */
export function poseTick(sim: Sim, pose: Pose, gear: number, t: number, type = -1): number {
  root(sim.world);
  const m = sim.state.mover;
  const speed = POSE_SPEED[pose];
  const ground = sim.terrain.heightAt(0, 0);
  m.heading = 0;
  m.vx = 0;
  m.vz = speed;
  m.x = 0;
  m.z = 0;
  if (pose === 'stand') {
    m.grounded = true;
    m.y = ground;
    m.vy = 0;
  } else if (pose === 'launch') {
    m.grounded = false;
    m.y = ground + 4;
    m.vy = 0;
  }
  holdGear(sim, gear);
  const input = poseInput(pose, t);
  rehearsal ??= makeSimState(sim.terrain);
  copySimState(rehearsal, sim.state);
  applyBuildToMover(sim.world, rehearsal);
  stepMover(rehearsal, input, sim.terrain);
  m.x -= rehearsal.mover.x;
  m.z -= rehearsal.mover.z;
  sim.step(input);
  return type < 0 ? 0 : countFx(sim.world, type);
}

/** `ticks` held steps; returns how many FX of `type` were seen. */
export function holdPose(sim: Sim, pose: Pose, gear: number, ticks: number, type = -1): number {
  let seen = 0;
  for (let t = 0; t < ticks; t++) seen += poseTick(sim, pose, gear, t, type);
  return seen;
}

/** A ground point `d` metres from the mover, `bearing` radians off its heading (positive is to the right). */
export function pointAt(sim: Sim, d: number, bearing = 0): { x: number; z: number } {
  const m = sim.state.mover;
  const a = m.heading + bearing;
  return { x: m.x + Math.sin(a) * d, z: m.z + Math.cos(a) * d };
}

/** Set the mover's horizontal speed along its heading (or its current direction of travel). */
export function holdSpeed(sim: Sim, speed: number): void {
  const m = sim.state.mover;
  const hs = Math.hypot(m.vx, m.vz);
  const ux = hs > 1e-3 ? m.vx / hs : Math.sin(m.heading);
  const uz = hs > 1e-3 ? m.vz / hs : Math.cos(m.heading);
  m.vx = ux * speed;
  m.vz = uz * speed;
}

/** Keep the mover in `gear` whatever its speed, as tests/sim/wake.test.ts does. */
export function holdGear(sim: Sim, gear: number): void {
  sim.state.mover.gear = gear;
  sim.state.mover.gearHold = 0;
}

export interface Hold {
  speed?: number;
  gear?: number;
}

/** One rooted step, with speed and gear held if asked. Returns the FX of `type` seen this step. */
export function tick(sim: Sim, input: InputFrame, hold: Hold = {}, type = -1): number {
  root(sim.world);
  if (hold.speed !== undefined) holdSpeed(sim, hold.speed);
  if (hold.gear !== undefined) holdGear(sim, hold.gear);
  sim.step(input);
  return type < 0 ? 0 : countFx(sim.world, type);
}

/** Rooted steps; returns how many FX of `type` were seen. */
export function ride(sim: Sim, input: InputFrame, ticks: number, hold: Hold = {}, type = -1): number {
  let seen = 0;
  for (let t = 0; t < ticks; t++) seen += tick(sim, input, hold, type);
  return seen;
}

export function countFx(w: World, type: number): number {
  let n = 0;
  for (let i = 0; i < w.fx.count; i++) if (w.fx.type[i] === type) n++;
  return n;
}

/** The health every enemy has left, summed. */
export function totalHp(w: World): number {
  let hp = 0;
  for (let i = 0; i < w.horde.count; i++) hp += Math.max(0, w.horde.hp[i]);
  return hp;
}

/** Place an enemy that is still rising (age 0). */
export function placeRising(sim: Sim, kind: number, x: number, z: number): number {
  return spawnEnemy(sim.world, kind, x, sim.terrain.heightAt(x, z), z);
}

// ---- the scripted ride ----------------------------------------------------------------------

const HOP: InputFrame = { steerX: 0, steerY: 0, carve: false, hop: true };
const LEFT = steer(-1, 0.35);
const RIGHT = steer(1, 0.35);

/**
 * The scripted ride: a tucked straight with a hop in it, a hard carve left, another straight and
 * hop, a hard carve right, over and over, so it zig-zags onward over new ground. It has everything
 * a mover does in it (distance, turns, hops, landings, tucking).
 */
export function rideInput(t: number): InputFrame {
  const k = t % 260;
  if (k < 100) return k === 30 ? HOP : TUCK;
  if (k < 130) return LEFT;
  if (k < 230) return k === 160 ? HOP : TUCK;
  return RIGHT;
}

export const RIDE_SPEED = 10;
/** How long the table rides, ticks. */
export const RIDE_TICKS = 60 * 60;

export interface CrowdResult {
  kills: number;
  /** Health taken off enemies, not counting overkill. */
  damage: number;
}

/** The crowd's places around the mover: (metres to its right, metres ahead), and what stands there. */
const CROWD: { side: number; ahead: number; kind: number }[] = [];
for (let k = 0; k < 44; k++) {
  // A sunflower spiral from 1.6 m out to about 14 m: something at every distance and bearing.
  const a = k * 2.399963;
  const r = 1.6 + Math.sqrt(k) * 1.9;
  CROWD.push({ side: Math.sin(a) * r, ahead: Math.cos(a) * r, kind: k % 11 === 5 ? KIND_BOLLARD : KIND_SHUFFLER });
}
export const CROWD_SIZE = CROWD.length;

/**
 * The crowd's shufflers are toughened to between half and one and a half times this much health
 * (a shuffler has 10), standing in for the tougher enemies of a later run: against 10 health every
 * hit kills, and against one fixed health kills would jump at a threshold.
 */
export const CROWD_SHUFFLER_HP = 30;
/** A crowd member killed stands up again in its place this long after, ticks. */
export const CROWD_RESPAWN = 120;
/** Each placed enemy carries its place in the crowd in `phase` (only used to animate), so it survives reordering. */
const SLOT_SCALE = 1 / 65536;

/**
 * `ticks` among a crowd that keeps its places around the mover: each tick everything in the crowd
 * is carried along with the mover (moved by its move and turned by its turn), so whatever a weapon
 * did to where an enemy stands is kept but the mover never leaves the crowd behind. A member killed
 * stands up again in its place after CROWD_RESPAWN ticks. `riding` rides the scripted ride at a held
 * 10 m/s in gear 3; otherwise the mover stands still in gear 1.
 */
export function crowdRide(sim: Sim, riding: boolean, ticks: number, shufflerHp = CROWD_SHUFFLER_HP): CrowdResult {
  const w = sim.world;
  const h = w.horde;
  const m = sim.state.mover;
  // The tick each place's member died, or -1 while it stands.
  const diedAt = new Int32Array(CROWD.length).fill(-1);
  const present = new Uint8Array(CROWD.length);
  const stand = (k: number): void => {
    const c = CROWD[k];
    const fx = Math.sin(m.heading);
    const fz = Math.cos(m.heading);
    // Right of the heading is (cos h, -sin h).
    const x = m.x + fz * c.side + fx * c.ahead;
    const z = m.z - fx * c.side + fz * c.ahead;
    const i = place(sim, c.kind, x, z);
    h.phase[i] = (k + 0.5) * SLOT_SCALE;
    if (c.kind === KIND_SHUFFLER) h.hp[i] = shufflerHp * (0.5 + ((k * 0.618034) % 1));
  };
  for (let k = 0; k < CROWD.length; k++) stand(k);
  let damage = 0;
  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < CROWD.length; k++) {
      if (diedAt[k] >= 0 && t - diedAt[k] >= CROWD_RESPAWN) {
        stand(k);
        diedAt[k] = -1;
      }
    }
    const x0 = m.x;
    const z0 = m.z;
    const h0 = m.heading;
    const before = totalHp(w);
    if (riding) tick(sim, rideInput(t), { speed: RIDE_SPEED, gear: 3 });
    else tick(sim, TUCK, { speed: 0, gear: 1 });
    damage += before - totalHp(w);
    present.fill(0);
    for (let i = 0; i < h.count; i++) present[Math.floor(h.phase[i] / SLOT_SCALE)] = 1;
    for (let k = 0; k < CROWD.length; k++) if (diedAt[k] < 0 && present[k] === 0) diedAt[k] = t;
    // Carry the crowd along: turn about where the mover was by its turn, then move by its move.
    const da = m.heading - h0;
    const c = Math.cos(da);
    const sn = Math.sin(da);
    for (let i = 0; i < h.count; i++) {
      const dx = h.x[i] - x0;
      const dz = h.z[i] - z0;
      // Headings turn x toward z as (sin, cos): rotating a heading by da rotates offsets the same way.
      h.x[i] = m.x + dx * c + dz * sn;
      h.z[i] = m.z - dx * sn + dz * c;
      h.y[i] = sim.terrain.heightAt(h.x[i], h.z[i]);
    }
  }
  return { kills: w.player.kills, damage };
}

export { FORWARD, TUCK, makeInputFrame };
