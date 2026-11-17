/**
 * The ride data for Santa Rampa: one line per row of the DESIGN section 5 roster, on the city's
 * routes, with vehicles, speeds, service hours and a timetable designed so rides meet.
 *
 * Ground lines drive on the right: each runs a fixed lane offset to the right of its route's
 * centre line (re-draped on the terrain), so lines that share a road in opposite directions pass
 * each other. Lines that share a lane in the same direction are kept apart in time by `phase`.
 */
import { compileLine, nearestArc, type CompiledLine, type LineDef, type RideKind } from '../lines';
import { LIVERIES, LINEUP_RIDES } from '../lineup';
import { len2 } from '../math';
import { District, terrainHeight, type World } from '../world';
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
}

const D = District;

/** The roster. Order is the line index in the world. */
export const CITY_LINES: readonly CityLineSpec[] = [
  { id: 'D1', name: 'Grúa Uno', kind: 'crane', district: D.DOCKS, stem: 0, vehicles: 1, cruise: 4, accel: 1.5, dwell: 4, windows: HOURS.allDay, phase: 0, lane: 0 },
  { id: 'D2', name: 'Montacargas', kind: 'forklift', district: D.DOCKS, stem: 1, vehicles: 3, cruise: 5, accel: 2.5, dwell: 3, windows: HOURS.day, phase: 0, lane: 0 },
  { id: 'D3', name: 'Pescado Express', kind: 'truck', district: D.DOCKS, stem: 2, vehicles: 2, cruise: 8, accel: 2.5, dwell: 4, windows: HOURS.dawnNoon, phase: 0, lane: 3.5 },
  { id: 'M1', name: 'Las Motos', kind: 'moped', district: D.MERCADO, stem: 0, vehicles: 4, cruise: 11, accel: 3.5, dwell: 3, windows: HOURS.dayDusk, phase: 0, lane: 3.5 },
  { id: 'M2', name: 'Carretillas', kind: 'handcart', district: D.MERCADO, stem: 1, vehicles: 3, cruise: 3.5, accel: 1.5, dwell: 2, windows: HOURS.dawnAfternoon, phase: 0, lane: 3.5 },
  { id: 'M3', name: 'La Boda', kind: 'parade', district: D.MERCADO, stem: 2, vehicles: 1, cruise: 2.2, accel: 1.5, dwell: 2, windows: HOURS.boda, phase: 0, lane: 0 },
  { id: 'T1', name: 'Funicular', kind: 'funicular', district: D.TERRACES, stem: 0, vehicles: 2, cruise: 12, accel: 3, dwell: 4, windows: HOURS.allDay, phase: 0, lane: 0 },
  { id: 'T2', name: 'Tranvía 5', kind: 'tram', district: D.TERRACES, stem: 1, vehicles: 3, cruise: 10, accel: 3, dwell: 3, windows: HOURS.allDay, phase: 0, lane: 3.5 },
  { id: 'T3', name: 'Tranvía 9', kind: 'tram', district: D.TERRACES, stem: 2, vehicles: 2, cruise: 10, accel: 3, dwell: 3, windows: HOURS.dayDusk, phase: 0, lane: 3.5 },
  { id: 'T4', name: 'Nocturno', kind: 'bus', district: D.TERRACES, stem: 3, vehicles: 2, cruise: 11, accel: 3, dwell: 4, windows: HOURS.night, phase: 0, lane: 3.5 },
  { id: 'A1', name: 'Teleférico Bajo', kind: 'cablecar', district: D.ANTENNA, stem: 0, vehicles: 4, cruise: 7, accel: 1.5, dwell: 4, windows: HOURS.allDay, phase: 0, lane: 0 },
  { id: 'A2', name: 'Teleférico Cumbre', kind: 'cablecar', district: D.ANTENNA, stem: 1, vehicles: 3, cruise: 7, accel: 1.5, dwell: 4, windows: HOURS.dayDusk, phase: 0, lane: 0 },
  { id: 'A3', name: 'Cometas', kind: 'kite', district: D.ANTENNA, stem: 2, vehicles: 5, cruise: 9, accel: 2, dwell: 3, windows: HOURS.windy, phase: 0, lane: 0 },
  { id: 'S1', name: 'Tranvía Fantasma', kind: 'ghosttram', district: D.TERRACES, stem: 3, vehicles: 1, cruise: 12, accel: 2.5, dwell: 4, windows: HOURS.ghost, phase: 0, lane: 3.5, parkHidden: true, secret: true },
  { id: 'S2', name: 'El Dirigible', kind: 'blimp', district: D.ANTENNA, stem: 3, vehicles: 1, cruise: 6, accel: 1, dwell: 5, windows: [[BLIMP_START, BLIMP_START + 0.01]], phase: 0, lane: 0, parkHidden: true, secret: true },
  { id: 'S3', name: 'Cometa Rey', kind: 'kite', district: D.ANTENNA, stem: 3, vehicles: 1, cruise: 11, accel: 2, dwell: 3, windows: HOURS.windy, phase: 0, lane: 0, secret: true, minChain: 4 },
];

/** Offset a draped path `lane` metres to the right of travel and re-drape it. */
function offsetPath(w: World, path: readonly number[], lane: number, loop: boolean): number[] {
  if (lane === 0) return path.slice();
  const n = path.length / 3;
  const out: number[] = [];
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
    const x = path[i * 3] + (-fz / fl) * lane;
    const z = path[i * 3 + 2] + (fx / fl) * lane;
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
    const d = Math.sqrt(
      (path[i * 3] - path[i * 3 - 3]) ** 2 + (path[i * 3 + 1] - path[i * 3 - 2]) ** 2 + (path[i * 3 + 2] - path[i * 3 - 1]) ** 2,
    );
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
  const path = route.overhead ? route.path.slice() : offsetPath(w, route.path, spec.lane, route.loop);
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
    return compileLine(cityLineDef(w, spec, route), i);
  });
}
