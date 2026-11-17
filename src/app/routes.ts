/**
 * Built-in input scripts, played with `?route=NAME`. The perf harness uses `perf`: a busy,
 * endless ride that carves, hops, hitches and slings so every system is exercised while frame
 * time is measured.
 */
import { placePlayer } from '../sim/player';
import type { Sim } from '../sim/sim';
import { Mode, type InputFrame } from '../sim/types';
import type { World } from '../sim/world';

export type RouteScript = (sim: Sim, tick: number, out: InputFrame) => void;

/** Metres of descent after which the perf run goes back up the hill. */
const PERF_DROP = 60;

/** Where the perf run (re)starts: the world's spawn zones in turn, or its spawn point. */
function perfStarts(w: World): { x: number; z: number; heading: number }[] {
  const zones = w.zones.filter((z) => z.kind === 'spawn');
  if (zones.length === 0) return [w.spawn];
  // Every spawn faces downhill, like the world's own.
  return zones.map((z) => ({ x: z.x, z: z.z, heading: w.spawn.heading }));
}

let startWorld: World | null = null;
let starts: { x: number; z: number; heading: number }[] = [];
let next = 0;
let startY = 0;

const perf: RouteScript = (sim, i, out) => {
  const p = sim.player;
  const w = sim.world;
  if (startWorld !== w) {
    startWorld = w;
    starts = perfStarts(w);
    next = 0;
    startY = p.y;
  }
  // Keep the skater busy: back up the hill after a long descent, or when stalled on the ground.
  if (p.mode !== Mode.HITCH && (p.y < startY - PERF_DROP || (p.speed < 0.2 && p.mode === Mode.GROUND && i % 300 === 299))) {
    const s = starts[next % starts.length];
    next++;
    placePlayer(w, p, s.x, s.z, s.heading);
    startY = p.y;
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
