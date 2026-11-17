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
  INNER_R,
  LEVELS,
  MERCADO_STAIRS,
  OUTER_X,
  PAD_DEPTH,
  PAD_TILT,
  PLAZA_BODA,
  PARAPET,
  PLAZA_LEVEL_Z,
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
  streetHeight,
  type Level,
} from './layout';
import { buildRoad, type Arc, type Road } from './roads';
import { dcos, dsin } from '../math';
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
const BERM_RAMP = 24;

/**
 * Curl the ground up near the world's side edges (above the docks), so the fall line never points
 * out of the world: a skater who reaches the edge rolls back instead of being pinned against it.
 */
function berm(w: World): void {
  const row = w.nx + 1;
  for (let iz = 0; iz <= w.nz; iz++) {
    const z = w.minZ + iz * w.cell;
    if (z < CITY.bands.mercado) continue;
    // The curl grows in over BERM_RAMP above the docks, so it does not start as a cliff at their edge.
    const t = Math.min(1, (z - CITY.bands.mercado) / BERM_RAMP);
    const k = BERM_K * t * t * (3 - 2 * t);
    for (let ix = 0; ix <= w.nx; ix++) {
      const d = Math.abs(w.minX + ix * w.cell) - BERM_X;
      if (d > 0) w.heights[iz * row + ix] += k * d * d;
    }
  }
}

/** Antenna Hill's paved paths off the spine: z and far end x. */
export const ANTENNA_PATHS: readonly (readonly [number, number])[] = [
  [1150, -66],
  [1110, 66],
  [1200, 40],
];
/** The hill station's platform (dress.ts builds it), and the fall of the plaza away from it. */
export const HILL_STATION_PLATFORM = { x0: 20, x1: 40, z0: 1035, z1: 1045 } as const;
const PLAZA_SHED = 0.03;

/** Half width of the verge outside each outer hairpin. */
const VERGE_HALF = 2.4;

/** The verge's centre line round an outer hairpin, at the road's height plus the parapet's. */
function vergeRing(r: Road, a: Arc): number[] {
  const R = a.r + ROAD_HALF + PARAPET.out + VERGE_HALF - PARAPET.half;
  const n = Math.max(4, Math.ceil((Math.abs(a.da) * R) / 2));
  const out: number[] = [];
  const p = r.pts;
  for (let k = 0; k <= n; k++) {
    const t = a.a0 + (a.da * k) / n;
    const c = dcos(t);
    const sn = dsin(t);
    // Height of the road's centre line at this angle.
    const rx = a.cx + a.r * c;
    const rz = a.cz + a.r * sn;
    let best = Infinity;
    let y = 0;
    for (let i = 0; i < p.length; i += 3) {
      const d = (p[i] - rx) * (p[i] - rx) + (p[i + 2] - rz) * (p[i + 2] - rz);
      if (d < best) {
        best = d;
        y = p[i + 1];
      }
    }
    out.push(a.cx + R * c, y + PARAPET.height + PARAPET.flush, a.cz + R * sn);
  }
  return out;
}

/** Grade of a terrace yard up from its street. */
export const YARD_RISE = 0.04;

/** Height of a terrace pad (street or yard) at (x, z). The yard rises from the street's back edge. */
export function padHeight(L: Level, x: number, z: number): number {
  if (z <= L.z1) return streetHeight(L, x, z);
  return streetHeight(L, x, L.z1) + YARD_RISE * (z - L.z1);
}

/** The last level: the Antenna gate street. */
export const GATE = LEVELS[LEVELS.length - 1];

function levelSpan(L: Level, surf: number): Span {
  return { z0: L.z0, z1: L.z1, h: (x, z) => streetHeight(L, x, z), surf };
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

/**
 * Pave the grass a little wider round each inner hairpin, where a road meets a level's street:
 * the vehicles' S-bends from road to street cut across those corners.
 */
function paveJunctions(w: World, r: Road): void {
  const reach = ROAD_HALF + JUNCTION_PAVE;
  const p = r.pts;
  for (let iz = 0; iz < w.nz; iz++) {
    const zc = w.minZ + (iz + 0.5) * w.cell;
    for (let ix = 0; ix < w.nx; ix++) {
      const ci = iz * w.nx + ix;
      if (w.surfaces[ci] !== Surface.GRASS) continue;
      const xc = w.minX + (ix + 0.5) * w.cell;
      const ax = Math.abs(xc);
      if (ax < APEX_X - 15 || ax > APEX_X + INNER_R) continue;
      if (!LEVELS.some((L) => zc > L.z0 - 10 && zc < L.z1 + 10)) continue;
      for (let i = 0; i < p.length; i += 3) {
        const dx = p[i] - xc;
        const dz = p[i + 2] - zc;
        if (dx * dx + dz * dz <= reach * reach) {
          w.surfaces[ci] = Surface.STREET;
          break;
        }
      }
    }
  }
}

/** Extra paving beyond a road's edge at the hairpin junctions, m. */
const JUNCTION_PAVE = 2.5;

/**
 * The hillside before any street is carved: the base hill, raised across the Mercado and the
 * Terraces by the same crest the streets have, so the ground between two streets meets both of
 * them rather than sagging into a pit behind the higher middle of the lower one.
 */
export function groundBase(x: number, z: number): number {
  const y = baseHeight(z);
  const B = CITY.bands;
  if (z <= B.mercado + 3 || z >= CREST_Z1) return y;
  let s = 1;
  if (z < B.mercado + 18) s = (z - B.mercado - 3) / 15;
  else if (z > CREST_Z0) s = (CREST_Z1 - z) / (CREST_Z1 - CREST_Z0);
  s = s * s * (3 - 2 * s);
  return y + s * PAD_TILT * (APEX_X - Math.min(Math.abs(x), APEX_X));
}

/** Above the Antenna gate the crest gives way to the open hill. */
const CREST_Z0 = 945;
const CREST_Z1 = 965;

export function buildGround(w: World): Ground {
  fillHeights(w, groundBase);
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
        h: (x, z) => streetHeight(L, x, z),
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
        h: (x, z) => padHeight(L, x, z),
        surf: (_x, z) => (z <= L.z1 ? Surface.STREET : Surface.PLAZA),
        // The retaining walls stop short of the hairpin junctions, where the vehicles' S-bends
        // cut the pad's corners; the last few metres are a steep bank instead.
        cliffZ: true,
        cliffLo: -APEX_X + 12,
        cliffHi: APEX_X - 12,
      });
    }
  }

  // --- Wedding plaza: flat at the level of its landing.
  const boda = LEVELS.find((L) => L.z === PLAZA_LEVEL_Z);
  if (boda) {
    const yPlaza = levelHeight(boda, (PLAZA_BODA.x0 + PLAZA_BODA.x1) / 2);
    C.rect({
      x0: PLAZA_BODA.x0,
      x1: PLAZA_BODA.x1,
      z0: PLAZA_BODA.z0,
      // On to the church's front, so the floor is level right up to the wall behind the stalls.
      z1: PLAZA_BODA.z1 + 3,
      bx: 4,
      bz: 4,
      h: () => yPlaza,
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
        actualX: true,
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
  for (const r of [east, west]) paveJunctions(w, r);
  berm(w);

  // --- Verges outside the outer hairpins, flush with the top of the parapet that will stand on
  // their inner edge: a skater coming down the bank beyond rolls over the parapet onto the road
  // instead of being pinned against its back. Then the roads again, crisp inside their edges.
  for (const r of [east, west]) {
    for (const a of r.outer) C.path({ pts: vergeRing(r, a), half: VERGE_HALF, blend: 6, surf: -1 });
  }
  for (const r of [east, west]) C.path({ pts: r.pts, half: ROAD_HALF, blend: 0, surf: Surface.STREET });

  // --- Antenna Hill's paths: paving laid on the hillside, which leaves nowhere on them to stop.
  for (const [z, x1] of ANTENNA_PATHS) C.paint(Math.min(0, x1), Math.max(0, x1), z - 3.5, z + 3.5, Surface.STREET);

  // --- The spine: docks -> stairs through every level -> antenna street -> summit.
  const spineSpans: Span[] = [{ z0: SPINE_BOTTOM_Z, z1: B.mercado + 3, h: (_x, z) => docksHeight(z), surf: Surface.STREET }];
  for (const L of LEVELS) spineSpans.push(levelSpan(L, Surface.STREET));
  const gateTop = streetHeight(GATE, SPINE_X, GATE.z1);
  // Over Antenna Hill the spine is one long stepped path: on smooth paving at this grade a skater
  // reached 29 m/s and drifted off it; on steps they keep to a walking-pace roll and the fall line
  // holds them to it.
  spineSpans.push({ z0: GATE.z1, z1: SPINE_TOP_Z, h: (_x, z) => Math.max(gateTop, baseHeight(z)), surf: Surface.STAIRS });
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
    actualX: true,
  });
  // The summit plaza at the top of the spine.
  C.rect({ x0: -10, x1: 10, z0: SPINE_TOP_Z, z1: SPINE_TOP_Z + 8, bx: 4, bz: 4, h: (_x, z) => Math.max(gateTop, baseHeight(z)), surf: () => Surface.PLAZA });

  // --- Antenna Hill: the hill station plaza, crowned so it sheds a skater off every side rather
  // than holding one at rest beside the bank that rises from its edge.
  const hs = HILL_STATION;
  const yHs = baseHeight((hs.z0 + hs.z1) / 2);
  const pf = HILL_STATION_PLATFORM;
  C.rect({
    x0: hs.x0,
    x1: hs.x1,
    z0: hs.z0,
    z1: hs.z1,
    bx: 8,
    bz: 8,
    h: (x, z) => yHs - PLAZA_SHED * Math.hypot(Math.max(0, pf.x0 - x, x - pf.x1), Math.max(0, pf.z0 - z, z - pf.z1)) - PLAZA_SHED * Math.max(0, pf.z0 - z),
    surf: () => Surface.PLAZA,
  });

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
