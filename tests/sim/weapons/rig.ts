/**
 * Shared set-up for the weapon tests: one weapon alone on level ground among hand-placed enemies,
 * with the speed and gear held so rides compare, and a scripted ride through a placed crowd.
 */
import { W_WAKE } from '../../../src/sim/arsenal';
import { setWeaponLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { makeInputFrame, type InputFrame } from '../../../src/sim/types';
import { KIND_BOLLARD, KIND_SHUFFLER, removeEnemy, spawnEnemy, type World } from '../../../src/sim/world';
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
 * The ride every weapon is compared on: a tucked straight with a hop in it, a hard carve left,
 * another straight and hop, a hard carve right, over and over, so it zig-zags onward over new
 * ground. It has every trigger in it (metres, hops, landings, tucking), at a held 10 m/s.
 */
export function rideInput(t: number): InputFrame {
  const k = t % 260;
  if (k < 100) return k === 30 ? HOP : TUCK;
  if (k < 130) return LEFT;
  if (k < 230) return k === 160 ? HOP : TUCK;
  return RIGHT;
}

export const RIDE_SPEED = 10;
/** The longest scripted ride the crowd is laid for, ticks. */
export const RIDE_TICKS = 60 * 60;

/** Where the scripted ride goes, sampled every `every` ticks, ridden on empty ground. */
function tracePath(ticks: number, every: number): { x: number; z: number; hx: number; hz: number }[] {
  const sim = rig(W_WAKE, 0);
  const out: { x: number; z: number; hx: number; hz: number }[] = [];
  for (let t = 0; t < ticks; t++) {
    holdSpeed(sim, RIDE_SPEED);
    sim.step(rideInput(t));
    if (t % every === 0) {
      const m = sim.state.mover;
      out.push({ x: m.x, z: m.z, hx: Math.sin(m.heading), hz: Math.cos(m.heading) });
    }
  }
  return out;
}

export interface Field {
  /** Where the crowd stands: shufflers, with a bollard every so often. */
  x: number[];
  z: number[];
  kind: number[];
}

let fieldCache: Field | null = null;

/**
 * A crowd laid along the scripted ride: on both sides of the line at a few distances, so weapons
 * that reach out, trail behind and point ahead all find something.
 */
export function rideField(): Field {
  if (fieldCache) return fieldCache;
  const path = tracePath(RIDE_TICKS + 120, 24);
  const f: Field = { x: [], z: [], kind: [] };
  const offsets = [-5, -2.5, 0, 2.5, 5];
  path.forEach((p, n) => {
    if (n < 2) return;
    offsets.forEach((o, j) => {
      const x = p.x + p.hz * o;
      const z = p.z - p.hx * o;
      // Keep apart from what is already placed: a crowd, not a pile.
      for (let q = 0; q < f.x.length; q++) if (Math.hypot(f.x[q] - x, f.z[q] - z) < 1.6) return;
      f.x.push(x);
      f.z.push(z);
      f.kind.push((n + j) % 11 === 0 ? KIND_BOLLARD : KIND_SHUFFLER);
    });
  });
  fieldCache = f;
  return f;
}

export interface RideResult {
  kills: number;
  /** Health taken off enemies, not counting overkill. */
  damage: number;
}

/** Each placed enemy carries its slot in the crowd in `phase` (only used to animate), so it survives reordering. */
const SLOT_SCALE = 1 / 65536;
/** The crowd stands up this close to the mover and is cleared away (not killed) beyond the far distance, m. */
const NEAR = 30;
/**
 * The crowd's shufflers are toughened to between half and one and a half times this much health
 * (a shuffler has 10), standing in for the tougher enemies of a later run: against 10 health every
 * hit kills and gears could not show, and against one fixed health kills would jump at a threshold.
 */
export const CROWD_SHUFFLER_HP = 30;
const FAR = 38;

/**
 * Ride the script for `ticks` through the crowd with the gear held. Each enemy of the crowd stands
 * once: it is placed as the mover comes near and taken away, uncounted, once the mover is well
 * past, so the horde stays small however long the ride. The crowd's shufflers have about `shufflerHp`
 * each (see CROWD_SHUFFLER_HP).
 */
export function rideThroughCrowd(sim: Sim, gear: number, ticks: number, shufflerHp = CROWD_SHUFFLER_HP): RideResult {
  const f = rideField();
  const w = sim.world;
  const h = w.horde;
  // 0 waiting, 1 standing, 2 gone.
  const state = new Uint8Array(f.x.length);
  let damage = 0;
  for (let t = 0; t < ticks; t++) {
    const m = sim.state.mover;
    for (let i = h.count - 1; i >= 0; i--) {
      if (Math.hypot(h.x[i] - m.x, h.z[i] - m.z) <= FAR) continue;
      state[Math.floor(h.phase[i] / SLOT_SCALE)] = 2;
      removeEnemy(w, i);
    }
    for (let k = 0; k < f.x.length; k++) {
      if (state[k] !== 0 || Math.hypot(f.x[k] - m.x, f.z[k] - m.z) > NEAR) continue;
      const i = place(sim, f.kind[k], f.x[k], f.z[k]);
      if (i < 0) break;
      h.phase[i] = (k + 0.5) * SLOT_SCALE;
      if (f.kind[k] === KIND_SHUFFLER) h.hp[i] = shufflerHp * (0.5 + ((k * 0.618034) % 1));
      state[k] = 1;
    }
    const before = totalHp(w);
    tick(sim, rideInput(t), { speed: RIDE_SPEED, gear });
    damage += before - totalHp(w);
  }
  return { kills: w.player.kills, damage };
}

export { FORWARD, TUCK, makeInputFrame };
