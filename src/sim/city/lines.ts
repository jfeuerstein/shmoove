/**
 * The ride data for Santa Rampa: one line per row of the DESIGN section 5 roster, on the city's
 * routes, with vehicles, speeds, service hours and a timetable designed so rides meet.
 *
 * Ground lines drive on the right: each runs a fixed lane offset to the right of its route's
 * centre line (re-draped on the terrain), so lines that share a road in opposite directions pass
 * each other. Lines that share a lane in the same direction are kept apart in time by `phase`.
 */
import { DAY_TICKS } from '../constants';
import { compileLine, nearestArc, type CompiledLine, type LineDef, type RideKind } from '../lines';
import { LIVERIES, LINEUP_RIDES } from '../lineup';
import { len2, len3 } from '../math';
import { District, Surface, collideSolids, makeWallHit, terrainHeight, terrainSurface, type World } from '../world';
import type { RouteDef } from './index';

/** Service hours as day fractions (DESIGN section 5). */
export const HOURS = {
  allDay: [[0, 1]],
  dawn: [[0.22, 0.3]],
  day: [[0.3, 0.72]],
  dusk: [[0.72, 0.8]],
  night: [[0.8, 0.22]],
  dayDusk: [[0.3, 0.8]],
  dawnNoon: [[0.22, 0.5]],
  dawnAfternoon: [[0.22, 0.65]],
  boda: [[0.55, 0.72]],
  windy: [[0.35, 0.7]],
  ghost: [[0, 0.06]],
} as const satisfies Record<string, ReadonlyArray<readonly [number, number]>>;

/** When the blimp leaves on its one pass of the day. */
export const BLIMP_START = 0.76;

export interface CityLineSpec {
  id: string;
  name: string;
  kind: RideKind;
  district: District;
  stem: number;
  vehicles: number;
  cruise: number;
  accel: number;
  dwell: number;
  windows: ReadonlyArray<readonly [number, number]>;
  /** Timetable offset, ticks. */
  phase: number;
  /** Ground lines: metres to the right of the route centre line. */
  lane: number;
  parkHidden?: boolean;
  secret?: boolean;
  minChain?: number;
  /** Strap length, where the city needs a different one from the line-up's. */
  hang?: number;
  /** Day fraction a lap must leave the terminus at (sets the phase; overrides `phase`). */
  departAt?: number;
}

const D = District;

/** The roster. Order is the line index in the world. */
export const CITY_LINES: readonly CityLineSpec[] = [
  { id: 'D1', name: 'Grúa Uno', kind: 'crane', district: D.DOCKS, stem: 0, vehicles: 1, cruise: 4, accel: 1.5, dwell: 4, windows: HOURS.allDay, phase: 0, lane: 0 },
  { id: 'D2', name: 'Montacargas', kind: 'forklift', district: D.DOCKS, stem: 1, vehicles: 3, cruise: 5, accel: 2.5, dwell: 3, windows: HOURS.day, phase: 7, lane: 2 },
  { id: 'D3', name: 'Pescado Express', kind: 'truck', district: D.DOCKS, stem: 2, vehicles: 2, cruise: 8, accel: 2.5, dwell: 4, windows: HOURS.dawnNoon, phase: 2727, lane: 1.6 },
  { id: 'M1', name: 'Las Motos', kind: 'moped', district: D.MERCADO, stem: 0, vehicles: 4, cruise: 11, accel: 3.5, dwell: 3, windows: HOURS.dayDusk, phase: 1080, lane: 4.4 },
  { id: 'M2', name: 'Carretillas', kind: 'handcart', district: D.MERCADO, stem: 1, vehicles: 3, cruise: 3.5, accel: 1.5, dwell: 2, windows: HOURS.dawnAfternoon, phase: 4360, lane: 1.6 },
  { id: 'M3', name: 'La Boda', kind: 'parade', district: D.MERCADO, stem: 2, vehicles: 1, cruise: 2.2, accel: 1.5, dwell: 2, windows: HOURS.boda, phase: 0, lane: 0 },
  { id: 'T1', name: 'Funicular', kind: 'funicular', district: D.TERRACES, stem: 0, vehicles: 2, cruise: 11, accel: 3, dwell: 5, windows: HOURS.allDay, phase: 440, lane: 0 },
  { id: 'T2', name: 'Tranvía 5', kind: 'tram', district: D.TERRACES, stem: 1, vehicles: 3, cruise: 9, accel: 2.5, dwell: 6, windows: HOURS.allDay, phase: 2484, lane: 1.6 },
  { id: 'T3', name: 'Tranvía 9', kind: 'tram', district: D.TERRACES, stem: 2, vehicles: 2, cruise: 10, accel: 3, dwell: 3, windows: HOURS.dayDusk, phase: 80, lane: 1.6 },
  { id: 'T4', name: 'Nocturno', kind: 'bus', district: D.TERRACES, stem: 3, vehicles: 2, cruise: 11, accel: 3, dwell: 4, windows: HOURS.night, phase: 2268, lane: 3.5 },
  { id: 'A1', name: 'Teleférico Bajo', kind: 'cablecar', district: D.ANTENNA, stem: 0, vehicles: 4, cruise: 7, accel: 1.5, dwell: 4, windows: HOURS.allDay, phase: 0, lane: 0 },
  { id: 'A2', name: 'Teleférico Cumbre', kind: 'cablecar', district: D.ANTENNA, stem: 1, vehicles: 3, cruise: 7, accel: 1.5, dwell: 4, windows: HOURS.dayDusk, phase: 0, lane: 0 },
  { id: 'A3', name: 'Cometas', kind: 'kite', district: D.ANTENNA, stem: 2, vehicles: 5, cruise: 8, accel: 2, dwell: 3, windows: HOURS.windy, phase: 0, lane: 0 },
  { id: 'S1', name: 'Tranvía Fantasma', kind: 'ghosttram', district: D.TERRACES, stem: 3, vehicles: 1, cruise: 12, accel: 2.5, dwell: 4, windows: HOURS.ghost, phase: 0, lane: 1.6, parkHidden: true, secret: true },
  { id: 'S2', name: 'El Dirigible', kind: 'blimp', district: D.ANTENNA, stem: 3, vehicles: 1, cruise: 6, accel: 1, dwell: 5, windows: [[BLIMP_START, BLIMP_START + 0.01]], phase: 0, lane: 0, parkHidden: true, secret: true, departAt: BLIMP_START },
  { id: 'S3', name: 'Cometa Rey', kind: 'kite', district: D.ANTENNA, stem: 3, vehicles: 1, cruise: 11, accel: 2, dwell: 5, windows: HOURS.windy, phase: 0, lane: 0, secret: true, minChain: 4, hang: 3.5 },
];

/** Clearance a ground vehicle's origin keeps from solid walls beyond its half width, metres. */
const LANE_CLEAR = 1.6;
/** Points either side over which a lane squeezes in and widens out again (about 3 m apart). */
const LANE_EASE = 6;
const LANE_SURFACES: ReadonlySet<number> = new Set([Surface.STREET, Surface.TRACK, Surface.PLAZA]);
const _wh = makeWallHit();

/**
 * Offset a draped path to the right of travel and re-drape it. The lane is `lane` metres where the
 * street is wide enough; where a wall or the street's edge comes closer (the inside of a corner)
 * it squeezes toward the centre line, or past it, easing in and out over a few metres.
 */
function offsetPath(w: World, path: readonly number[], lane: number, loop: boolean, halfWid: number, height: number): number[] {
  if (lane === 0) return path.slice();
  const n = path.length / 3;
  const rx = new Float64Array(n);
  const rz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i - 1;
    let b = i + 1;
    if (loop) {
      // The last point repeats the first.
      if (a < 0) a = n - 2;
      if (b > n - 1) b = 1;
    } else {
      if (a < 0) a = 0;
      if (b > n - 1) b = n - 1;
    }
    const fx = path[b * 3] - path[a * 3];
    const fz = path[b * 3 + 2] - path[a * 3 + 2];
    const fl = len2(fx, fz);
    // Right of heading (fx, fz) is (-fz, fx).
    rx[i] = -fz / fl;
    rz[i] = fx / fl;
  }
  // The widest safe offset at each point, from `lane` down toward (and past) the centre line.
  const fits = (i: number, d: number): boolean => {
    const x = path[i * 3] + rx[i] * d;
    const z = path[i * 3 + 2] + rz[i] * d;
    if (!LANE_SURFACES.has(terrainSurface(w, x, z))) return false;
    collideSolids(w, x, terrainHeight(w, x, z), z, halfWid + LANE_CLEAR, height, 0.4, _wh);
    return !_wh.hit;
  };
  const safe = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = lane;
    while (d > -lane && !fits(i, d)) d -= 0.25;
    safe[i] = d;
  }
  // Ease: a running minimum, then a running mean, over LANE_EASE points either side.
  const at = (arr: Float64Array, i: number): number => {
    if (loop) return arr[(((i % (n - 1)) + (n - 1)) % (n - 1))];
    return arr[i < 0 ? 0 : i >= n ? n - 1 : i];
  };
  const lo = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = -LANE_EASE; k <= LANE_EASE; k++) m = Math.min(m, at(safe, i + k));
    lo[i] = m;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -LANE_EASE; k <= LANE_EASE; k++) sum += at(lo, i + k);
    const d = sum / (2 * LANE_EASE + 1);
    const x = path[i * 3] + rx[i] * d;
    const z = path[i * 3 + 2] + rz[i] * d;
    out.push(x, terrainHeight(w, x, z), z);
  }
  if (loop) {
    out[(n - 1) * 3] = out[0];
    out[(n - 1) * 3 + 1] = out[1];
    out[(n - 1) * 3 + 2] = out[2];
  }
  return out;
}

/** Point on a path at arc position s. */
function pointAt(path: readonly number[], s: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length / 3; i++) {
    const d = len3(path[i * 3] - path[i * 3 - 3], path[i * 3 + 1] - path[i * 3 - 2], path[i * 3 + 2] - path[i * 3 - 1]);
    if (acc + d >= s) {
      const f = d > 0 ? (s - acc) / d : 0;
      return [path[i * 3 - 3] + (path[i * 3] - path[i * 3 - 3]) * f, path[i * 3 - 1] + (path[i * 3 + 2] - path[i * 3 - 1]) * f];
    }
    acc += d;
  }
  return [path[path.length - 3], path[path.length - 1]];
}

/** The LineDef for one roster row on its route. */
export function cityLineDef(w: World, spec: CityLineSpec, route: RouteDef): LineDef {
  const ride = LINEUP_RIDES.find((r) => r.id === spec.id);
  if (!ride) throw new Error(`no line-up ride for ${spec.id}`);
  const path = route.overhead ? route.path.slice() : offsetPath(w, route.path, spec.lane, route.loop, ride.bodyHalfWid, ride.bodyHeight);
  const stops = route.stops.map((st, k) => {
    if (k === 0) return { name: st.name, s: 0 };
    const [x, z] = pointAt(route.path, st.s);
    return { name: st.name, s: nearestArc(path, x, z) };
  });
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    district: spec.district,
    stem: spec.stem,
    path,
    loop: route.loop,
    stops,
    cruise: spec.cruise,
    accel: spec.accel,
    dwell: spec.dwell,
    vehicles: spec.vehicles,
    phase: spec.phase,
    windows: spec.windows.map((wd) => [wd[0], wd[1]]),
    parkHidden: spec.parkHidden,
    overhead: route.overhead,
    anchorBack: ride.anchorBack,
    anchorY: ride.anchorY,
    hang: spec.hang ?? ride.hang,
    rope: ride.rope,
    bodyHalfLen: ride.bodyHalfLen,
    bodyHalfWid: ride.bodyHalfWid,
    bodyHeight: ride.bodyHeight,
    minChain: spec.minChain,
    secret: spec.secret,
    livery: LIVERIES[spec.id],
  };
}

/** Compile every roster line on the city's routes, in roster order. */
export function buildCityLines(w: World, routes: Record<string, RouteDef>): CompiledLine[] {
  return CITY_LINES.map((spec, i) => {
    const route = routes[spec.id];
    if (!route) throw new Error(`no route for line ${spec.id}`);
    const def = cityLineDef(w, spec, route);
    if (spec.departAt === undefined) return compileLine(def, i);
    // Phase the lap so that it leaves the terminus exactly at departAt.
    const probe = compileLine(def, i);
    const at = Math.round(spec.departAt * DAY_TICKS) % probe.period;
    return compileLine({ ...def, phase: (probe.period - at) % probe.period }, i);
  });
}

/**
 * Designed meetings: at each of these chain spots a vehicle of line `a` and one of line `b` pass
 * within 12 m of each other at compatible heights, at least once every `everyTicks` while both
 * lines run. `b` is the ride to catch second; where the two run the same way it is the faster
 * one, coming past from behind.
 */
export const MEETINGS: { zone: string; a: string; b: string; everyTicks: number }[] = [
  // The fish truck overtakes the forklifts on the docks street they share.
  { zone: 'chain_D2_D3', a: 'D2', b: 'D3', everyTicks: 14400 },
  // Tram 5 overtakes the forklifts as they pass the tram depot.
  { zone: 'chain_D2_T2', a: 'D2', b: 'T2', everyTicks: 14400 },
  // A moped overtakes a handcart on the west ramp.
  { zone: 'chain_M1_M2', a: 'M2', b: 'M1', everyTicks: 14400 },
  // Tram 9 crosses the funicular track as a car goes by.
  { zone: 'chain_T1_T3', a: 'T1', b: 'T3', everyTicks: 14400 },
  // Tram 9 and the night bus pass on the west zigzag.
  { zone: 'chain_T3_T4', a: 'T3', b: 'T4', everyTicks: 14400 },
  // A kite overtakes a summit cable car on its way up.
  { zone: 'chain_A2_A3', a: 'A2', b: 'A3', everyTicks: 5400 },
];
