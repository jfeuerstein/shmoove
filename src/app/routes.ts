/**
 * Built-in input scripts, played with `?route=NAME`. The perf harness uses `perf`: a busy,
 * endless ride that carves, hops, hitches and slings so every system is exercised while frame
 * time is measured.
 */
import { placePlayer } from '../sim/player';
import type { Sim } from '../sim/sim';
import { Mode, type InputFrame } from '../sim/types';

export type RouteScript = (sim: Sim, tick: number, out: InputFrame) => void;

const perf: RouteScript = (sim, i, out) => {
  const p = sim.player;
  // Keep the skater on the hill: back to the start when the run reaches the bottom.
  if (p.mode !== Mode.HITCH && (p.z < sim.world.spawn.z - 290 || (p.speed < 0.2 && p.mode === Mode.GROUND && i % 300 === 299))) {
    placePlayer(sim.world, p, sim.world.spawn.x, sim.world.spawn.z, sim.world.spawn.heading);
  }
  const phase = i % 420;
  out.steer = 0.7 * Math.sin(i / 37);
  out.hold = phase > 120 && phase < 360;
  out.hop = i % 97 === 0;
};

const ROUTES: Record<string, RouteScript> = { perf };

export function getRoute(name: string | null): RouteScript | null {
  return name !== null && name in ROUTES ? ROUTES[name] : null;
}
