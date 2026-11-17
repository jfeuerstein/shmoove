/**
 * What the bot knows about the city: the same things a player can read off the world and the
 * timetable (where a line's vehicles stand at each stop and which way they face, whether one is
 * standing there now). Read-only lookups; nothing here touches a Game.
 */
import { DAY_TICKS } from '../../../src/sim/constants';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../../../src/sim/lines';
import type { World } from '../../../src/sim/world';

export interface Pose {
  /** Vehicle origin. */
  x: number;
  y: number;
  z: number;
  /** Heading of travel (unit, horizontal). */
  hx: number;
  hz: number;
  /** Grab point: rear bumper, or the end of the strap. */
  gx: number;
  gy: number;
  gz: number;
}

const _vs = makeVehicleState();
const _gp = { x: 0, y: 0, z: 0 };

export function lineById(w: World, id: string): CompiledLine {
  const l = w.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

export function stopIndex(l: CompiledLine, name: string): number {
  const k = l.allStops.findIndex((s) => s.name === name);
  if (k < 0) throw new Error(`${l.id} has no stop ${name}`);
  return k;
}

/** Where a vehicle of `l` stands while it waits at stop `k`. */
export function stopPose(l: CompiledLine, k: number): Pose {
  const st = l.allStops[k];
  for (let t = 0; t < l.period; t++) {
    if (Math.abs(l.lapS[t] - st.s) < 0.05 && l.lapS[t] === l.lapS[t + 1]) {
      // Vehicle 0 is at lap tick t when the day tick is t - phase (mod period).
      vehicleAt(l, 0, t - l.phaseTicks + DAY_TICKS, _vs);
      grabPoint(l, _vs, _gp);
      return { x: _vs.x, y: _vs.y, z: _vs.z, hx: _vs.hx, hz: _vs.hz, gx: _gp.x, gy: _gp.y, gz: _gp.z };
    }
  }
  throw new Error(`${l.id} never stands at stop ${k}`);
}

/** Is vehicle state v standing at stop k? */
export function atStop(l: CompiledLine, v: VehicleState, k: number): boolean {
  if (v.vx * v.vx + v.vz * v.vz >= 0.0025) return false;
  const s = l.allStops[k].s;
  // A loop's terminus is at both ends of the path: a vehicle home from its lap stands at s = length.
  if (l.loop && k === 0 && Math.abs(v.s - l.length) < 0.05) return true;
  return Math.abs(v.s - s) < 0.05;
}

export function dayTick(tick: number): number {
  return ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

/** Day fraction of a tick. */
export function frac(tick: number): number {
  return dayTick(tick) / DAY_TICKS;
}
