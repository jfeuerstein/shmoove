/**
 * The line-up: a fixture world for looking at every ride. A flat 240 x 240 m plaza with one line
 * per row of the DESIGN section 5 roster, each a straight shuttle in its own east-west lane, lanes
 * 12 m apart, timed so the vehicles cross in front of the spawn one after another (nearest lane
 * first) a few seconds after midday. Open with `?world=lineup&t=0.5`.
 *
 * The liveries and the body/anchor/rope numbers here are the first proposal the ride data reuses.
 */
import { DAY_TICKS } from './constants';
import { compileLine, type LineDef, type Livery, type RideKind } from './lines';
import { District, Surface, addZone, createWorld, fillSurfaces, finalizeWorld, type World } from './world';

const MANGO = 0xffae1a;
const PINK = 0xff2e88;
const TEAL = 0x00a99d;
const COBALT = 0x1f3fbf;
const PAPER = 0xf3ebdd;
const INK = 0x1b1a2e;

/**
 * One livery per line. Base + pattern is unique per line; districts share inks (Docks teal/mango,
 * Mercado pink/mango, Terraces mango/cobalt, Antenna cobalt/pink, secrets pale/ink).
 * Pattern: 0 band, 1 chevrons, 2 checks, 3 diagonal, 4 dots, 5 zigzag.
 */
export const LIVERIES: Record<string, Livery> = {
  D1: { base: MANGO, stripe: INK, accent: TEAL, pattern: 3 },
  D2: { base: TEAL, stripe: MANGO, accent: INK, pattern: 2 },
  D3: { base: TEAL, stripe: PAPER, accent: MANGO, pattern: 5 },
  M1: { base: PINK, stripe: MANGO, accent: PAPER, pattern: 1 },
  M2: { base: MANGO, stripe: PINK, accent: PINK, pattern: 4 },
  M3: { base: PINK, stripe: PAPER, accent: MANGO, pattern: 5 },
  T1: { base: MANGO, stripe: COBALT, accent: COBALT, pattern: 1 },
  T2: { base: MANGO, stripe: COBALT, accent: PINK, pattern: 0 },
  T3: { base: COBALT, stripe: MANGO, accent: MANGO, pattern: 2 },
  T4: { base: COBALT, stripe: MANGO, accent: PINK, pattern: 4 },
  A1: { base: COBALT, stripe: PINK, accent: PAPER, pattern: 0 },
  A2: { base: PINK, stripe: COBALT, accent: COBALT, pattern: 2 },
  A3: { base: PINK, stripe: COBALT, accent: MANGO, pattern: 3 },
  S1: { base: PAPER, stripe: COBALT, accent: TEAL, pattern: 3 },
  S2: { base: PAPER, stripe: INK, accent: PINK, pattern: 0 },
  S3: { base: INK, stripe: MANGO, accent: MANGO, pattern: 1 },
};

/** Per-ride geometry and handling: body, grab anchor, strap, rope, pace. */
interface RideSpec {
  id: string;
  name: string;
  kind: RideKind;
  district: District;
  stem: number;
  overhead: boolean;
  /** Path height above the plaza: 0 for ground rides, the carriage height for overhead ones. */
  height: number;
  cruise: number;
  accel: number;
  anchorBack: number;
  anchorY: number;
  hang: number;
  rope: number;
  bodyHalfLen: number;
  bodyHalfWid: number;
  bodyHeight: number;
  minChain?: number;
  secret?: boolean;
}

/** Nearest lane first: small street rides, big bodies, then the sky. */
export const LINEUP_RIDES: RideSpec[] = [
  { id: 'M1', name: 'Las Motos', kind: 'moped', district: District.MERCADO, stem: 0, overhead: false, height: 0, cruise: 9, accel: 3, anchorBack: 1.25, anchorY: 0.95, hang: 0, rope: 2.6, bodyHalfLen: 0.9, bodyHalfWid: 0.45, bodyHeight: 1.6 },
  { id: 'M2', name: 'Carretillas', kind: 'handcart', district: District.MERCADO, stem: 1, overhead: false, height: 0, cruise: 3.2, accel: 1.5, anchorBack: 1.75, anchorY: 0.95, hang: 0, rope: 2.4, bodyHalfLen: 1.4, bodyHalfWid: 0.6, bodyHeight: 1.5 },
  { id: 'D2', name: 'Montacargas', kind: 'forklift', district: District.DOCKS, stem: 1, overhead: false, height: 0, cruise: 4.5, accel: 2, anchorBack: 1.9, anchorY: 0.8, hang: 0, rope: 2.5, bodyHalfLen: 1.5, bodyHalfWid: 0.65, bodyHeight: 2.2 },
  { id: 'D3', name: 'Pescado Express', kind: 'truck', district: District.DOCKS, stem: 2, overhead: false, height: 0, cruise: 8, accel: 2.5, anchorBack: 3.95, anchorY: 0.62, hang: 0, rope: 3.2, bodyHalfLen: 3.4, bodyHalfWid: 1.2, bodyHeight: 3.0 },
  { id: 'T2', name: 'Tranvía 5', kind: 'tram', district: District.TERRACES, stem: 1, overhead: false, height: 0, cruise: 8, accel: 2.5, anchorBack: 5, anchorY: 1, hang: 0, rope: 3.6, bodyHalfLen: 4.8, bodyHalfWid: 1.3, bodyHeight: 3.3 },
  { id: 'T3', name: 'Tranvía 9', kind: 'tram', district: District.TERRACES, stem: 2, overhead: false, height: 0, cruise: 7.5, accel: 2.5, anchorBack: 4.6, anchorY: 1, hang: 0, rope: 3.4, bodyHalfLen: 4.4, bodyHalfWid: 1.3, bodyHeight: 3.3 },
  { id: 'T1', name: 'Funicular', kind: 'funicular', district: District.TERRACES, stem: 0, overhead: false, height: 0, cruise: 7, accel: 2.5, anchorBack: 4.1, anchorY: 1, hang: 0, rope: 3, bodyHalfLen: 3.8, bodyHalfWid: 1.3, bodyHeight: 3.0 },
  { id: 'T4', name: 'Nocturno', kind: 'bus', district: District.TERRACES, stem: 3, overhead: false, height: 0, cruise: 9, accel: 2.5, anchorBack: 5.7, anchorY: 0.95, hang: 0, rope: 3.6, bodyHalfLen: 5.5, bodyHalfWid: 1.3, bodyHeight: 3.4 },
  { id: 'S1', name: 'Tranvía Fantasma', kind: 'ghosttram', district: District.TERRACES, stem: 3, overhead: false, height: 0, cruise: 7, accel: 2, anchorBack: 5, anchorY: 1, hang: 0, rope: 3.6, bodyHalfLen: 4.8, bodyHalfWid: 1.3, bodyHeight: 3.3, secret: true },
  { id: 'M3', name: 'La Boda', kind: 'parade', district: District.MERCADO, stem: 2, overhead: false, height: 0, cruise: 2.8, accel: 1, anchorBack: 4.75, anchorY: 0.95, hang: 0, rope: 3, bodyHalfLen: 4.5, bodyHalfWid: 1.5, bodyHeight: 3.3 },
  { id: 'D1', name: 'Grúa Uno', kind: 'crane', district: District.DOCKS, stem: 0, overhead: true, height: 10, cruise: 4, accel: 1.2, anchorBack: 0, anchorY: -0.15, hang: 6.85, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0 },
  { id: 'A1', name: 'Teleférico Bajo', kind: 'cablecar', district: District.ANTENNA, stem: 0, overhead: true, height: 9.5, cruise: 6, accel: 1.5, anchorBack: 0, anchorY: -3.6, hang: 2.9, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0 },
  { id: 'A2', name: 'Teleférico Cumbre', kind: 'cablecar', district: District.ANTENNA, stem: 1, overhead: true, height: 11, cruise: 6.5, accel: 1.5, anchorBack: 0, anchorY: -3.6, hang: 3.6, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0 },
  { id: 'A3', name: 'Cometas', kind: 'kite', district: District.ANTENNA, stem: 2, overhead: true, height: 12, cruise: 7, accel: 2, anchorBack: 2.5, anchorY: 0, hang: 7.8, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0 },
  { id: 'S3', name: 'Cometa Rey', kind: 'kite', district: District.ANTENNA, stem: 3, overhead: true, height: 12, cruise: 8, accel: 2, anchorBack: 3, anchorY: 0, hang: 7.8, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0, minChain: 4, secret: true },
  { id: 'S2', name: 'El Dirigible', kind: 'blimp', district: District.ANTENNA, stem: 3, overhead: true, height: 12, cruise: 5, accel: 1, anchorBack: 1, anchorY: -3.6, hang: 5.2, rope: 0.6, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0, secret: true },
];

export const LINEUP = {
  /** z of the nearest lane; lane k is at LANE_Z0 + k * LANE_GAP. */
  laneZ0: -96,
  laneGap: 12,
  /** Shuttle ends. */
  x0: -100,
  x1: 100,
  spawnZ: -108,
  /** Vehicle k crosses x = 0 heading east at day tick firstCross + k * crossGap. */
  firstCross: DAY_TICKS / 2 + 150,
  crossGap: 50,
} as const;

/** Lane z of line `k`. */
export function laneZ(k: number): number {
  return LINEUP.laneZ0 + k * LINEUP.laneGap;
}

function lineDef(spec: RideSpec, k: number, phase: number): LineDef {
  const z = laneZ(k);
  const y = spec.height;
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    district: spec.district,
    stem: spec.stem,
    path: [LINEUP.x0, y, z, LINEUP.x1, y, z],
    loop: false,
    stops: [],
    cruise: spec.cruise,
    accel: spec.accel,
    dwell: 2,
    vehicles: 1,
    phase,
    windows: [[0, 1]],
    overhead: spec.overhead,
    anchorBack: spec.anchorBack,
    anchorY: spec.anchorY,
    hang: spec.hang,
    rope: spec.rope,
    bodyHalfLen: spec.bodyHalfLen,
    bodyHalfWid: spec.bodyHalfWid,
    bodyHeight: spec.bodyHeight,
    minChain: spec.minChain,
    secret: spec.secret,
    livery: LIVERIES[spec.id],
  };
}

export function buildLineup(seed = 1): World {
  const w = createWorld({ seed, minX: -120, minZ: -120, cell: 4, nx: 60, nz: 60 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.bands = [{ district: District.DOCKS, zMin: -Infinity, zMax: Infinity }];
  w.spawn = { x: 0, z: LINEUP.spawnZ, heading: 0 };
  w.lines = LINEUP_RIDES.map((spec, k) => {
    // Find when the unphased lap crosses mid-plaza eastbound, then phase it onto its slot.
    const probe = compileLine(lineDef(spec, k, 0), k);
    const mid = probe.length / 2;
    let cross = 0;
    for (let t = 0; t < probe.period; t++) {
      if (probe.lapDir[t] > 0 && probe.lapS[t] <= mid && probe.lapS[t + 1] > mid) {
        cross = t;
        break;
      }
    }
    const want = LINEUP.firstCross + k * LINEUP.crossGap;
    const phase = (((cross - want) % probe.period) + probe.period) % probe.period;
    return compileLine(lineDef(spec, k, phase), k);
  });
  addZone(w, { id: 'spawn', name: 'Line-up', kind: 'spawn', x: 0, y: 0, z: LINEUP.spawnZ, r: 4 });
  finalizeWorld(w);
  return w;
}
