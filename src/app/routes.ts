/**
 * Built-in input scripts, played with `?route=NAME`. The perf harness uses two:
 *
 * - `perf`: a run a player could do. Start at the summit (the world's spawn where there is none),
 *   ride down the spine carving and hopping, hold the touch when a ride comes within reach so it
 *   hitches, let go a few seconds later so it slings, and at the bottom go back to the top once.
 * - `tour`: fixed viewpoints in every district, held still for a while each, for the draw-call and
 *   triangle budgets across the whole city (`tests/perf/run.mjs`).
 */
import { grabPoint, makeVehicleState, vehicleAt } from '../sim/lines';
import { placePlayer } from '../sim/player';
import type { Sim } from '../sim/sim';
import { Mode, type InputFrame } from '../sim/types';
import { topHeight, type World } from '../sim/world';

export type RouteScript = (sim: Sim, tick: number, out: InputFrame) => void;

/** Metres of descent after which a world with no lower spawn sends the perf run back up. */
const PERF_DROP = 60;
/** A descent ends this far above the lowest spawn (the docks on the city). */
const BOTTOM_MARGIN = 4;
/** Ticks stalled on the ground before the run gives up on this descent. */
const STALL_TICKS = 240;
/** Pure pursuit along the lane: look-ahead, carve amplitude and period, steering gain. */
const LOOK_AHEAD = 14;
const CARVE_AMP = 4;
const CARVE_PERIOD = 45;
const STEER_GAIN = 2.5;
/** Hold when a ride's grab point is this close (m, horizontal); ride it this long, then sling. */
const HOLD_NEAR = 9;
const RIDE_TICKS = 150;
const RELEASE_TICKS = 90;

interface Point {
  x: number;
  z: number;
  heading: number;
}

/** The summit (a landmark zone) if the world has one, else the world's spawn. */
export function perfStart(w: World): Point {
  for (const z of w.zones) if (z.id === 'summit') return { x: z.x, z: z.z, heading: w.spawn.heading };
  return { x: w.spawn.x, z: w.spawn.z, heading: w.spawn.heading };
}

/** Height below which a descent is over: just above the lowest spawn, if it is well below the start. */
export function perfBottom(w: World, start: Point): number {
  const startY = topHeight(w, start.x, start.z);
  let low = Infinity;
  for (const z of w.zones) if (z.kind === 'spawn') low = Math.min(low, topHeight(w, z.x, z.z));
  if (low < startY - PERF_DROP) return low + BOTTOM_MARGIN;
  return startY - PERF_DROP;
}

function wrap(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

const _v = makeVehicleState();
const _g = { x: 0, y: 0, z: 0 };

/** Is an active ride's grab point within `range` of (x, z)? */
function rideNear(sim: Sim, x: number, z: number, range: number): boolean {
  const lines = sim.world.lines;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const m = range + L.anchorBack + 1;
    if (x < L.minX - m || x > L.maxX + m || z < L.minZ - m || z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, sim.tick, _v);
      if (!_v.active) continue;
      grabPoint(L, _v, _g);
      const dx = _g.x - x;
      const dz = _g.z - z;
      if (dx * dx + dz * dz < range * range) return true;
    }
  }
  return false;
}

function createPerf(): RouteScript {
  let world: World | null = null;
  let start: Point = { x: 0, z: 0, heading: 0 };
  let bottomY = 0;
  // The lane: through the world's spawn along its downhill heading (the spine on the city).
  let laneX = 0;
  let laneZ = 0;
  let dirX = 0;
  let dirZ = 1;
  let stalled = 0;
  let riding = 0;
  let released = 0;
  return (sim, i, out) => {
    const p = sim.player;
    const w = sim.world;
    if (world !== w) {
      world = w;
      start = perfStart(w);
      bottomY = perfBottom(w, start);
      laneX = w.spawn.x;
      laneZ = w.spawn.z;
      dirX = Math.sin(w.spawn.heading);
      dirZ = Math.cos(w.spawn.heading);
      placePlayer(w, p, start.x, start.z, start.heading);
      stalled = 0;
    }
    stalled = p.mode === Mode.GROUND && p.speed < 0.3 ? stalled + 1 : 0;
    if (p.mode !== Mode.HITCH && (p.y < bottomY || stalled > STALL_TICKS)) {
      placePlayer(w, p, start.x, start.z, start.heading);
      stalled = 0;
      riding = 0;
      released = 0;
    }

    // Steer for a point ahead on the lane, swung side to side so the board carves.
    const along = (p.x - laneX) * dirX + (p.z - laneZ) * dirZ + LOOK_AHEAD;
    const side = CARVE_AMP * Math.sin(i / CARVE_PERIOD);
    const tx = laneX + dirX * along + dirZ * side;
    const tz = laneZ + dirZ * along - dirX * side;
    const want = Math.atan2(tx - p.x, tz - p.z);
    // The sim turns heading by -steer.
    out.steer = Math.max(-1, Math.min(1, -wrap(want - p.heading) * STEER_GAIN));

    // Catch rides that come past, ride a while, then let go to sling.
    if (p.mode === Mode.HITCH) {
      riding++;
      out.hold = riding < RIDE_TICKS;
      if (!out.hold) released = RELEASE_TICKS;
    } else {
      riding = 0;
      if (released > 0) released--;
      out.hold = released === 0 && rideNear(sim, p.x, p.z, HOLD_NEAR);
    }
    out.hop = p.mode !== Mode.HITCH && i % 97 === 0;
  };
}

/** Zone ids of the tour's district viewpoints, besides every spawn zone. Missing ones are skipped. */
const TOUR_ZONES = ['plaza_boda', 'container_yard', 'funicular_top', 'summit'];
/** Ticks the tour holds each viewpoint. */
export const TOUR_HOLD = 240;

/** The tour's viewpoints: every spawn zone, then the named landmarks, facing the world's downhill. */
export function tourPoints(w: World): Point[] {
  const pts: Point[] = [];
  for (const z of w.zones) if (z.kind === 'spawn') pts.push({ x: z.x, z: z.z, heading: w.spawn.heading });
  for (const id of TOUR_ZONES) for (const z of w.zones) if (z.id === id) pts.push({ x: z.x, z: z.z, heading: w.spawn.heading });
  if (pts.length === 0) pts.push({ x: w.spawn.x, z: w.spawn.z, heading: w.spawn.heading });
  return pts;
}

function createTour(): RouteScript {
  let world: World | null = null;
  let pts: Point[] = [];
  return (sim, i, out) => {
    const w = sim.world;
    if (world !== w) {
      world = w;
      pts = tourPoints(w);
    }
    // Held at the viewpoint (re-placed every tick) so the camera settles on it; after the last one
    // the tour stays there.
    const k = Math.min(pts.length - 1, Math.floor(i / TOUR_HOLD));
    const pt = pts[k];
    placePlayer(w, sim.player, pt.x, pt.z, pt.heading);
    out.steer = 0;
    out.hold = false;
    out.hop = false;
  };
}

const ROUTES: Record<string, () => RouteScript> = { perf: createPerf, tour: createTour };

export function getRoute(name: string | null): RouteScript | null {
  return name !== null && name in ROUTES ? ROUTES[name]() : null;
}
