/**
 * Built-in input scripts, played with `?route=NAME`. The perf harness uses these:
 *
 * - `perfcity`: what `npm run perf` times. The run a player would do, cut into legs: each leg puts
 *   the skater on the spine at a fixed place in one district and rides down from there for
 *   LEG_TICKS ticks, carving and hopping, holding the touch when a ride comes within reach so it
 *   hitches and letting go a few seconds later so it slings. The legs cover all four districts,
 *   catch rides, and one runs the fast stretch through the terraces that crosses chunk rows at
 *   speed. `routeWindows` names the ticks of each leg the harness times (all but the first
 *   LEG_WARM, which hold the teleport and the camera settling).
 * - `perf`: the same riding from the summit in one long loop (the summit back to the top once a
 *   descent reaches the bottom). Kept for profiling and the sim-hash test.
 * - `tour`: fixed viewpoints in every district, held still for a while each, for the draw-call and
 *   triangle budgets across the whole city (`tests/perf/run.mjs`).
 *
 * The scripts steer with the sim's deterministic math, so a route plays out tick for tick the same
 * in Node (tests/unit/perfRoute.test.ts) as in the browser.
 */
import { datan2, dcos, dsin, wrapAngle } from '../sim/math';
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
/**
 * A ride whose grab point is within SEEK (m, horizontal, and within SEEK_Y vertically) draws the
 * skater off the lane toward it; the touch is held once it is within HOLD_NEAR. Ride it RIDE_TICKS,
 * then let go to sling, and leave rides alone for RELEASE_TICKS.
 */
const SEEK = 30;
const SEEK_Y = 4;
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

const _v = makeVehicleState();
const _g = { x: 0, y: 0, z: 0 };

const _near = { x: 0, z: 0, d: 0 };

/**
 * The nearest grab point of an active ride the skater could catch (minimum chain met) within
 * `range` horizontally and SEEK_Y vertically, into `_near`. false when there is none.
 */
function nearestRide(sim: Sim, range: number): boolean {
  const p = sim.player;
  const lines = sim.world.lines;
  const chain = p.chainAlive === 1 ? p.chain : 0;
  let best = range * range;
  let found = false;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    if (chain + 1 < L.minChainN) continue;
    const m = range + L.anchorBack + 1;
    if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, sim.tick, _v);
      if (!_v.active) continue;
      grabPoint(L, _v, _g);
      if (Math.abs(_g.y - p.y - 1.2) > SEEK_Y) continue;
      const dx = _g.x - p.x;
      const dz = _g.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        found = true;
        _near.x = _g.x;
        _near.z = _g.z;
        _near.d = Math.sqrt(d2);
      }
    }
  }
  return found;
}

/**
 * The riding shared by the perf routes: pursue a point ahead on the lane (through the world's spawn
 * along its downhill heading: the spine on the city), swung side to side so the board carves; seek
 * rides that come within reach, ride them a while and let go to sling; hop now and then.
 */
class Rider {
  private laneX = 0;
  private laneZ = 0;
  private dirX = 0;
  private dirZ = 1;
  private riding = 0;
  private released = 0;
  /** Ticks in a row stalled on the ground. */
  stalled = 0;

  constructor(w: World) {
    this.laneX = w.spawn.x;
    this.laneZ = w.spawn.z;
    this.dirX = dsin(w.spawn.heading);
    this.dirZ = dcos(w.spawn.heading);
  }

  /** The point on the lane at coordinate z (where the lane crosses z; a lane across the slope: nearest point). */
  laneAt(z: number): Point {
    const s = Math.abs(this.dirZ) > 0.2 ? (z - this.laneZ) / this.dirZ : (z - this.laneZ) * this.dirZ;
    return { x: this.laneX + this.dirX * s, z: this.laneZ + this.dirZ * s, heading: datan2(this.dirX, this.dirZ) };
  }

  /** Forget any ride in progress (after a teleport). */
  reset(): void {
    this.riding = 0;
    this.released = 0;
    this.stalled = 0;
  }

  drive(sim: Sim, i: number, out: InputFrame): void {
    const p = sim.player;
    this.stalled = p.mode === Mode.GROUND && p.speed < 0.3 ? this.stalled + 1 : 0;
    const along = (p.x - this.laneX) * this.dirX + (p.z - this.laneZ) * this.dirZ + LOOK_AHEAD;
    const side = CARVE_AMP * dsin(i / CARVE_PERIOD);
    let tx = this.laneX + this.dirX * along + this.dirZ * side;
    let tz = this.laneZ + this.dirZ * along - this.dirX * side;

    if (p.mode === Mode.HITCH) {
      this.riding++;
      out.hold = this.riding < RIDE_TICKS;
      if (!out.hold) this.released = RELEASE_TICKS;
    } else {
      this.riding = 0;
      if (this.released > 0) this.released--;
      const seek = this.released === 0 && nearestRide(sim, SEEK);
      if (seek) {
        tx = _near.x;
        tz = _near.z;
      }
      out.hold = seek && _near.d < HOLD_NEAR;
    }
    const want = datan2(tx - p.x, tz - p.z);
    // The sim turns heading by -steer.
    out.steer = Math.max(-1, Math.min(1, -wrapAngle(want - p.heading) * STEER_GAIN));
    out.hop = p.mode !== Mode.HITCH && i % 97 === 0;
  }
}

function createPerf(): RouteScript {
  let world: World | null = null;
  let rider: Rider | null = null;
  let start: Point = { x: 0, z: 0, heading: 0 };
  let bottomY = 0;
  return (sim, i, out) => {
    const p = sim.player;
    const w = sim.world;
    if (world !== w || rider === null) {
      world = w;
      rider = new Rider(w);
      start = perfStart(w);
      bottomY = perfBottom(w, start);
      placePlayer(w, p, start.x, start.z, start.heading);
    }
    if (p.mode !== Mode.HITCH && (p.y < bottomY || rider.stalled > STALL_TICKS)) {
      placePlayer(w, p, start.x, start.z, start.heading);
      rider.reset();
    }
    rider.drive(sim, i, out);
  };
}

// ---------------------------------------------------------------------------------------------
// perfcity: the timed legs

/** Ticks per leg of `perfcity`. */
export const LEG_TICKS = 600;
/** Ticks at the start of each leg that are not timed: the teleport, the camera cut, chunks filling. */
export const LEG_WARM = 150;

export interface PerfLeg {
  /** Short name, for the report. */
  name: string;
  /** Where on the lane the leg starts: the lane's z there, m (clamped into the world). */
  z: number;
}

/**
 * The legs of `perfcity`, in order (the order matters: the rides run to a timetable, so what a leg
 * meets depends on the tick it starts at). Chosen by riding candidate starts in the sim; what they
 * deliver is asserted tick for tick by tests/unit/perfRoute.test.ts and again in the browser by the
 * harness: every timed window travels well over 40 m, the windows see all four districts, the
 * mercado and docks legs hitch and sling, and `streaming` is the fast run down the terraces spine
 * that crosses chunk rows.
 */
export const PERF_LEGS: readonly PerfLeg[] = [
  { name: 'mercado', z: 375 },
  { name: 'terraces', z: 875 },
  { name: 'antenna', z: 1030 },
  { name: 'streaming', z: 935 },
  { name: 'docks', z: 260 },
];

/** Where a leg starts: on the lane where it crosses the leg's z, facing down the lane. */
export function legStart(w: World, leg: PerfLeg): Point {
  return new Rider(w).laneAt(Math.max(w.minZ + 1, Math.min(w.maxZ - 1, leg.z)));
}

export interface RouteWindow {
  /** The leg's name. */
  name: string;
  /** Route ticks [from, to) that are timed. Route tick 0 is the first sim step the route drives. */
  from: number;
  to: number;
}

/** The timed windows of a route (empty for routes that are not cut into legs). */
export function routeWindows(name: string | null): RouteWindow[] {
  if (name !== 'perfcity') return [];
  return PERF_LEGS.map((leg, k) => ({ name: leg.name, from: k * LEG_TICKS + LEG_WARM, to: (k + 1) * LEG_TICKS }));
}

/** A route that rides `legs` in turn, LEG_TICKS each, then starts over. `perfcity` is PERF_LEGS. */
export function createLegRoute(legs: readonly PerfLeg[]): RouteScript {
  let world: World | null = null;
  let rider: Rider | null = null;
  let starts: Point[] = [];
  let leg = -1;
  return (sim, i, out) => {
    const p = sim.player;
    const w = sim.world;
    if (world !== w || rider === null) {
      world = w;
      rider = new Rider(w);
      starts = legs.map((l) => legStart(w, l));
      leg = -1;
    }
    // After the last leg the run starts over from the first.
    const k = Math.floor(i / LEG_TICKS) % legs.length;
    if (k !== leg || rider.stalled > STALL_TICKS) {
      leg = k;
      const s = starts[k];
      placePlayer(w, p, s.x, s.z, s.heading);
      rider.reset();
    }
    rider.drive(sim, i, out);
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

const ROUTES: Record<string, () => RouteScript> = { perf: createPerf, perfcity: () => createLegRoute(PERF_LEGS), tour: createTour };

export function getRoute(name: string | null): RouteScript | null {
  return name !== null && name in ROUTES ? ROUTES[name]() : null;
}
