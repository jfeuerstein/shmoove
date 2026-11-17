/**
 * The ground of Santa Rampa: base hill, every street carved into it, surfaces, and the retaining
 * walls that hold the steps. Returns the street geometry the dressing, routes and zones build on.
 */
import { Surface, fillHeights, fillSurfaces, type World } from '../world';
import { Carver } from './carve';
import {
  APEX_X,
  BOULEVARD_Z,
  CITY,
  FUNI_X,
  FUNI_X0,
  FUNI_X1,
  FUNI_Z0,
  FUNI_Z1,
  HILL_STATION,
  LEVELS,
  MERCADO_STAIRS,
  OUTER_X,
  PAD_DEPTH,
  PLAZA_BODA,
  ROAD_HALF,
  SPINE_BOTTOM_Z,
  SPINE_HALF,
  SPINE_TOP_Z,
  SPINE_X,
  STAIR_HALF,
  TERRACE_FRONTS,
  baseHeight,
  docksHeight,
  levelHeight,
  type Level,
} from './layout';
import { buildRoad, type Road } from './roads';
import { STAIR_OPTS, Stepper, type Span } from './stepper';

export interface StairStreet {
  x: number;
  half: number;
  stepper: Stepper;
}

export interface Ground {
  carver: Carver;
  east: Road;
  west: Road;
  spine: Stepper;
  funicular: Stepper;
  stairs: StairStreet[];
  /** Index of the first terrace level in LEVELS. */
  firstTerrace: number;
}

function gridFloor(z: number): number {
  return CITY.minZ + Math.floor((z - CITY.minZ) / CITY.cell + 1e-9) * CITY.cell;
}

function gridCeil(z: number): number {
  return CITY.minZ + Math.ceil((z - CITY.minZ) / CITY.cell - 1e-9) * CITY.cell;
}

/** Where the ground starts to curl up at the east and west edges of the world. */
const BERM_X = 172;
const BERM_K = 0.06;

/**
 * Curl the ground up near the world's side edges (above the docks), so the fall line never points
 * out of the world: a skater who reaches the edge rolls back instead of being pinned against it.
 */
function berm(w: World): void {
  const row = w.nx + 1;
  for (let iz = 0; iz <= w.nz; iz++) {
    const z = w.minZ + iz * w.cell;
    if (z < CITY.bands.mercado) continue;
    for (let ix = 0; ix <= w.nx; ix++) {
      const d = Math.abs(w.minX + ix * w.cell) - BERM_X;
      if (d > 0) w.heights[iz * row + ix] += BERM_K * d * d;
    }
  }
}

/** Grade of a terrace yard up from its street. */
export const YARD_RISE = 0.025;

/** Height of a terrace pad (street or yard) at (x, z). */
export function padHeight(L: Level, x: number, z: number): number {
  return levelHeight(L, x) + YARD_RISE * Math.max(0, z - L.z1);
}

/** The last level: the Antenna gate street. */
export const GATE = LEVELS[LEVELS.length - 1];

function levelSpan(L: Level, surf: number): Span {
  return { z0: L.z0, z1: L.z1, h: (x) => levelHeight(L, x), surf };
}

function baseSurface(x: number, z: number): Surface {
  const B = CITY.bands;
  if (z < 0) return Surface.WATER;
  if (z < B.mercado) return Surface.PLAZA;
  // Mercado: the ground between landings is stepped alleys (slow); the edge-zone banks are planted.
  if (z < TERRACE_FRONTS[0]) return Math.abs(x) <= 103 ? Surface.STAIRS : Surface.GRASS;
  if (z < B.antenna) return Surface.GRASS;
  return Math.abs(x) < 3 ? Surface.DIRT : Surface.GRASS;
}

export function buildGround(w: World): Ground {
  fillHeights(w, (_x, z) => baseHeight(z));
  fillSurfaces(w, baseSurface);
  const C = new Carver(w);
  const B = CITY.bands;
  const firstTerrace = LEVELS.findIndex((L) => L.terrace);

  // --- Docks: the whole band is one apron at the docks grade (already the base), the boulevard
  // along z = BOULEVARD_Z, and the quayside street.
  C.rect({
    x0: -OUTER_X,
    x1: OUTER_X,
    z0: BOULEVARD_Z - ROAD_HALF,
    z1: BOULEVARD_Z + ROAD_HALF,
    bx: 0,
    bz: 0,
    h: (_x, z) => docksHeight(z),
    surf: () => Surface.STREET,
  });
  C.rect({ x0: -170, x1: 170, z0: 4, z1: 14, bx: 0, bz: 0, h: (_x, z) => docksHeight(z), surf: () => Surface.STREET });

  // --- Levels: Mercado landings (level), terrace pads (street + yard, crest at x = 0).
  for (const L of LEVELS) {
    if (!L.terrace) {
      C.rect({
        x0: -APEX_X,
        x1: APEX_X,
        // Snapped out to grid lines so the flat street reaches the building faces exactly.
        z0: gridFloor(L.z0),
        z1: gridCeil(L.z1),
        bx: 4,
        bz: 3,
        h: (x) => levelHeight(L, x),
        surf: () => Surface.STREET,
      });
    } else {
      C.rect({
        x0: -APEX_X,
        x1: APEX_X,
        z0: L.z0,
        z1: L.z0 + PAD_DEPTH,
        bx: 6,
        bz: 3,
        // The yard rises gently from the street so it drains onto it.
        h: (x, z) => levelHeight(L, x) + YARD_RISE * Math.max(0, z - L.z1),
        surf: (_x, z) => (z <= L.z1 ? Surface.STREET : Surface.PLAZA),
        cliffZ: true,
        cliffLo: -APEX_X + 4,
        cliffHi: APEX_X - 4,
      });
    }
  }

  // --- Wedding plaza: flat at the level of its landing.
  const boda = LEVELS.find((L) => L.z === 462);
  if (boda) {
    C.rect({
      x0: PLAZA_BODA.x0,
      x1: PLAZA_BODA.x1,
      z0: PLAZA_BODA.z0,
      z1: PLAZA_BODA.z1,
      bx: 4,
      bz: 4,
      h: () => boda.yEnd,
      surf: () => Surface.PLAZA,
    });
  }

  // --- Mercado stair streets, with the funicular run-out at FUNI_X.
  const stairs: StairStreet[] = [];
  const mercado = LEVELS.slice(0, firstTerrace);
  const docksSpan: Span = { z0: B.mercado - 12, z1: B.mercado + 3, h: (_x, z) => docksHeight(z), surf: Surface.STREET };
  for (const xs of [...MERCADO_STAIRS, FUNI_X]) {
    const crossesPlaza = xs > PLAZA_BODA.x0 && xs < PLAZA_BODA.x1;
    // Two pieces when the plaza interrupts the street.
    const runs: Level[][] = crossesPlaza
      ? [mercado.filter((L) => L.z <= 462), mercado.filter((L) => L.z > 462)]
      : [mercado];
    for (let r = 0; r < runs.length; r++) {
      const levels = runs[r];
      if (levels.length === 0) continue;
      const spans: Span[] = [];
      // North of the plaza the street resumes at the next landing up (a block stands behind the plaza).
      if (r === 0) spans.push(docksSpan);
      for (const L of levels) spans.push(levelSpan(L, Surface.STREET));
      if (spans.length < 2) continue;
      const st = new Stepper(spans, { axis: xs, ...STAIR_OPTS });
      const half = xs === FUNI_X ? 6 : STAIR_HALF;
      C.rect({
        x0: xs - half,
        x1: xs + half,
        z0: st.z0,
        z1: st.z1,
        bx: 3,
        bz: 0,
        h: (x, z) => st.h(x, z),
        surf: (_x, z) => st.surf(z),
      });
      stairs.push({ x: xs, half, stepper: st });
    }
  }

  // --- Funicular bed: TRACK, level across every crossing, single flights between.
  const funiLevels = LEVELS.filter((L) => L.z + 8 >= FUNI_Z0 && L.z0 <= FUNI_Z1);
  const funicular = new Stepper(
    funiLevels.map((L) => levelSpan(L, Surface.TRACK)),
    { axis: FUNI_X, flightSurf: Surface.TRACK, midSurf: Surface.TRACK, midLen: 0, minGrade: 0, maxGrade: 0.45 },
  );
  C.rect({
    x0: FUNI_X0,
    x1: FUNI_X1,
    z0: funicular.z0,
    z1: funicular.z1,
    bx: 3,
    bz: 0,
    h: (x, z) => funicular.h(x, z),
    surf: () => Surface.TRACK,
    cliffX: true,
  });

  // --- Switchback roads.
  const east = buildRoad(false);
  const west = buildRoad(true);
  for (const r of [east, west]) C.path({ pts: r.pts, half: ROAD_HALF, blend: 10, surf: Surface.STREET });
  berm(w);

  // --- The spine: docks -> stairs through every level -> antenna street -> summit.
  const spineSpans: Span[] = [{ z0: SPINE_BOTTOM_Z, z1: B.mercado + 3, h: (_x, z) => docksHeight(z), surf: Surface.STREET }];
  for (const L of LEVELS) spineSpans.push(levelSpan(L, Surface.STREET));
  const gateTop = levelHeight(GATE, SPINE_X);
  spineSpans.push({ z0: GATE.z1, z1: SPINE_TOP_Z, h: (_x, z) => Math.max(gateTop, baseHeight(z)), surf: Surface.STREET });
  const spine = new Stepper(spineSpans, { axis: SPINE_X, ...STAIR_OPTS });
  C.rect({
    x0: SPINE_X - SPINE_HALF,
    x1: SPINE_X + SPINE_HALF,
    z0: spine.z0,
    z1: spine.z1,
    bx: 3,
    bz: 0,
    h: (x, z) => spine.h(x, z),
    surf: (_x, z) => spine.surf(z),
    cliffX: true,
  });
  // The summit plaza at the top of the spine.
  C.rect({ x0: -10, x1: 10, z0: SPINE_TOP_Z, z1: SPINE_TOP_Z + 8, bx: 4, bz: 4, h: (_x, z) => Math.max(gateTop, baseHeight(z)), surf: () => Surface.PLAZA });

  // --- Antenna Hill: the hill station plaza and paved paths off the spine.
  const hs = HILL_STATION;
  C.rect({ x0: hs.x0, x1: hs.x1, z0: hs.z0, z1: hs.z1, bx: 8, bz: 8, h: () => baseHeight((hs.z0 + hs.z1) / 2), surf: () => Surface.PLAZA });
  for (const [z, x1] of [[1150, -66], [1110, 66], [1200, 40]] as const) {
    const pts: number[] = [];
    const n = Math.ceil(Math.abs(x1) / 2);
    for (let i = 0; i <= n; i++) pts.push((x1 * i) / n, baseHeight(z), z);
    C.path({ pts, half: 3.5, blend: 4, surf: Surface.STREET });
  }

  // The docks stay at the docks grade under everything (the roads leave them level across).
  C.rect({ x0: CITY.minX, x1: CITY.maxX, z0: 0, z1: B.mercado - 1, bx: 0, bz: 0, h: (_x, z) => docksHeight(z), surf: () => -1 });

  return { carver: C, east, west, spine, funicular, stairs, firstTerrace };
}

/** The spine as an xyz polyline from the summit down to the docks, 2 m apart. */
export function spinePolyline(g: Ground): number[] {
  const out: number[] = [];
  for (let z = SPINE_TOP_Z; z >= SPINE_BOTTOM_Z; z -= 2) out.push(SPINE_X, g.spine.h(SPINE_X, z), z);
  return out;
}
