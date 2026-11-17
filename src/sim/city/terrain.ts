/**
 * The ground of Santa Rampa: base hill, every street carved into it, surfaces, and the retaining
 * walls that hold the steps. Returns the street geometry the dressing, routes and zones build on.
 */
import { Surface, fillHeights, fillSurfaces, terrainHeight, type World } from '../world';
import { Carver } from './carve';
import {
  APEX_X,
  BOULEVARD_Z,
  CITY,
  CROSS_FALL,
  FUNI_X,
  FUNI_X0,
  FUNI_X1,
  FUNI_Z0,
  FUNI_Z1,
  HILL_STATION,
  INNER_R,
  LEVELS,
  MERCADO_STAIRS,
  NEEDLE,
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
import { datan2, dcos, dsin, len2 } from '../math';
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
const BERM_K = 0.045;
const BERM_RAMP = 60;
const BERM_Z0 = 292;

/**
 * Curl the ground up near the world's side edges (above the docks), so the fall line never points
 * out of the world: a skater who reaches the edge rolls back instead of being pinned against it.
 */
function berm(w: World): void {
  const row = w.nx + 1;
  for (let iz = 0; iz <= w.nz; iz++) {
    const z = w.minZ + iz * w.cell;
    if (z < BERM_Z0) continue;
    // The curl grows in over BERM_RAMP, from above the switchbacks' bottom bends (which lie at the
    // docks' level), so it does not start as a cliff at the docks' edge.
    const t = Math.min(1, (z - BERM_Z0) / BERM_RAMP);
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
/**
 * The hill station's platform (dress.ts builds it), and the fall of the plaza away from it. Its west
 * end reaches to the plaza's edge: the blimp's ladder sweeps low across it once a day.
 */
export const HILL_STATION_PLATFORM = { x0: 12, x1: 40, z0: 1031, z1: 1045 } as const;
const PLAZA_SHED = 0.03;
/**
 * The platform's run-in: a flight of steps on its uphill (north) side, from the summit lawn and
 * the spine stairs down flush onto the deck, so a skater coming down from the summit rolls onto
 * the platform instead of meeting its lip, and the steps' drag takes the speed down to where a
 * planted foot stops them on the deck. It stays west of the cable cars' station (x < 29 with its
 * blend), so nothing under their cables changes. x0..x1 and the north end z1; it starts at the
 * deck's north edge.
 */
export const HILL_STATION_RUNIN = { x0: 6, x1: 27, z1: 1062 } as const;
/** Height of the hill station platform's deck above the plaza's level. */
export const HILL_STATION_DECK = 1.0;

/** Half width of the verge outside each outer hairpin. */
const VERGE_HALF = 2.4;
const VERGE_BLEND = 5;
const VERGE_MAX_RAISE = 1.2;
/** Metres beyond the parapet's last segment over which the verge eases back down to the bank. */
const VERGE_END_FADE = 7;

/**
 * Raise the ground just outside an outer hairpin's parapet to the parapet's top (less PARAPET.flush),
 * fading out beyond: where the bank there is already higher it is left alone.
 */
function raiseVerge(w: World, r: Road, a: Arc): void {
  // From a little beyond the parapet's outer face, so no ground cell on the road itself is lifted.
  const rin = a.r + ROAD_HALF + PARAPET.out + PARAPET.half;
  const rFull = rin + 2 * VERGE_HALF;
  const rOut = rFull + VERGE_BLEND;
  const n = 64;
  const roadY = new Float64Array(n + 1);
  const p = r.pts;
  for (let k = 0; k <= n; k++) {
    const t = a.a0 + (a.da * k) / n;
    const rx = a.cx + a.r * dcos(t);
    const rz = a.cz + a.r * dsin(t);
    let best = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const d = (p[i] - rx) * (p[i] - rx) + (p[i + 2] - rz) * (p[i + 2] - rz);
      if (d < best) {
        best = d;
        roadY[k] = p[i + 1];
      }
    }
  }
  // The bank beyond the verge, before it is touched: where it stands higher than the verge would
  // be, the verge is raised all the way, so no gully is left between the bank and the parapet.
  const bankY = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const t = a.a0 + (a.da * k) / n;
    bankY[k] = terrainHeight(w, a.cx + (rOut + w.cell) * dcos(t), a.cz + (rOut + w.cell) * dsin(t));
  }
  const fade = VERGE_END_FADE / (Math.abs(a.da) * rFull);
  const row = w.nx + 1;
  const ix0 = Math.max(0, Math.floor((a.cx - rOut - w.minX) / w.cell));
  const ix1 = Math.min(w.nx, Math.ceil((a.cx + rOut - w.minX) / w.cell));
  const iz0 = Math.max(0, Math.floor((a.cz - rOut - w.minZ) / w.cell));
  const iz1 = Math.min(w.nz, Math.ceil((a.cz + rOut - w.minZ) / w.cell));
  for (let iz = iz0; iz <= iz1; iz++) {
    const z = w.minZ + iz * w.cell;
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = w.minX + ix * w.cell;
      const rho = len2(x - a.cx, z - a.cz);
      if (rho < rin || rho > rOut) continue;
      // Position along the arc, 0..1; outside the arc's sweep, no verge.
      let f = (datan2(z - a.cz, x - a.cx) - a.a0) / a.da;
      f -= Math.floor(f / 2) * 2;
      if (f > PARAPET.sweep + fade) continue;
      const ka = Math.round(Math.min(f, PARAPET.sweep) * n);
      const target = roadY[ka] + PARAPET.height + PARAPET.flush;
      let wt = 1;
      if (rho > rFull) {
        const t = 1 - (rho - rFull) / VERGE_BLEND;
        wt = t * t * (3 - 2 * t);
      }
      // Past the parapet's end the verge eases back down, so its end is not a pocket.
      if (f > PARAPET.sweep) {
        const t = 1 - (f - PARAPET.sweep) / fade;
        wt *= t * t * (3 - 2 * t);
      }
      const k = iz * row + ix;
      const h = w.heights[k];
      // Where the road stands on fill the bank outside falls away from the parapet anyway: raise
      // it by no more than VERGE_MAX_RAISE, unless the bank beyond stands higher still.
      const cap = Math.max(VERGE_MAX_RAISE, Math.min(target, bankY[ka]) - h);
      if (target > h) w.heights[k] = h + Math.min(target - h, cap) * wt;
    }
  }
}

/** The summit's crown: its fall toward the spine and toward the south, and where it starts. */
export const CROWN = { fallX: 0.035, fallZ: 0.035, z0: SPINE_TOP_Z, ramp: 12, ridge0: 1256, ridge1: 1268, ridgeW: 14, ridgeH: 1, reach: 60 } as const;

/**
 * Replace the flat top of the hill with a crown: from the top of the spine northward the ground
 * rises CROWN.fallZ, and it rises CROWN.fallX away from the spine on either side, so every point
 * of the summit falls toward the spine (or down the hill) and nothing up there holds a skater.
 */
function crown(w: World): void {
  const row = w.nx + 1;
  const y0 = baseHeight(CROWN.z0);
  for (let iz = 0; iz <= w.nz; iz++) {
    const z = w.minZ + iz * w.cell;
    if (z < CROWN.z0) continue;
    let t = Math.min(1, (z - CROWN.z0) / CROWN.ramp);
    t = t * t * (3 - 2 * t);
    // North of the needle a ridge runs along the line through it, so nothing drains straight
    // onto the mast: the ground there falls away to either side as well as south.
    let u = Math.min(1, Math.max(0, (z - CROWN.ridge0) / (CROWN.ridge1 - CROWN.ridge0)));
    u = u * u * (3 - 2 * u);
    for (let ix = 0; ix <= w.nx; ix++) {
      const x = w.minX + ix * w.cell;
      const ax = Math.abs(x);
      const edge = Math.max(0, ax - BERM_X);
      const qx = (x - NEEDLE.x) / CROWN.ridgeW;
      const q = Math.abs(qx) < 1 ? 1 - qx * qx : 0;
      const ridge = u * CROWN.ridgeH * q * q;
      const xr = Math.min(ax, CROWN.reach);
      w.heights[iz * row + ix] = y0 + CROWN.fallZ * (z - CROWN.z0) + t * CROWN.fallX * (Math.sqrt(xr * xr + 4) - 2) + ridge + BERM_K * edge * edge;
    }
  }
}

/** Grade of a terrace yard up from its street. */
export const YARD_RISE = 0.04;

/** Height of a terrace pad (street or yard) at (x, z). The yard rises from the street's back edge. */
export function padHeight(L: Level, x: number, z: number): number {
  if (z <= L.z1) return streetHeight(L, x, z);
  return streetHeight(L, x, L.z1) + YARD_RISE * (z - L.z1);
}

/**
 * The foot of a stair street on the docks: the docks grade, then a short apron above the docks'
 * edge that falls onto them, so a skater set down at the foot of the first flight rolls off it.
 */
function docksFoot(z: number): number {
  return docksHeight(z) + CROSS_FALL * Math.max(0, z - (gridFloor(CITY.bands.mercado + 3) - 3));
}

/** The last level: the Antenna gate street. */
export const GATE = LEVELS[LEVELS.length - 1];

/**
 * A level's crossing on a stair street, snapped out to grid lines like the level itself, so every
 * flight starts and ends on a row of height samples: the steps have crisp edges in the ground and
 * a handrail's run-in lies over the landing, not over a lip the grid has rounded off.
 */
function levelSpan(L: Level, surf: number): Span {
  return { z0: gridFloor(L.z0), z1: gridCeil(L.z1), h: (x, z) => streetHeight(L, x, z), surf };
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
  const docksSpan: Span = { z0: B.mercado - 12, z1: gridFloor(B.mercado + 3), h: (_x, z) => docksFoot(z), surf: Surface.STREET };
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

  // --- Verges outside the outer hairpins, raised to just under the top of the parapet that will
  // stand on their inner edge: a skater coming down the bank beyond rolls over the parapet onto
  // the road instead of being pinned against its back.
  for (const r of [east, west]) {
    // Not round the bottom bend, which lies on the level docks.
    for (const a of r.outer.slice(1)) raiseVerge(w, r, a);
  }
  berm(w);

  // --- Antenna Hill's paths: paving laid on the hillside, which leaves nowhere on them to stop.
  for (const [z, x1] of ANTENNA_PATHS) C.paint(Math.min(0, x1), Math.max(0, x1), z - 3.5, z + 3.5, Surface.STREET);

  // --- The spine: docks -> stairs through every level -> antenna street -> summit.
  const spineSpans: Span[] = [{ z0: SPINE_BOTTOM_Z, z1: gridFloor(B.mercado + 3), h: (_x, z) => docksFoot(z), surf: Surface.STREET }];
  for (const L of LEVELS) spineSpans.push(levelSpan(L, Surface.STREET));
  const gateTop = streetHeight(GATE, SPINE_X, GATE.z1);
  // Over Antenna Hill the spine is one long stepped path: on smooth paving at this grade a skater
  // reached 29 m/s and drifted off it; on steps they keep to a walking-pace roll and the fall line
  // holds them to it.
  spineSpans.push({ z0: gridCeil(GATE.z1), z1: SPINE_TOP_Z, h: (_x, z) => Math.max(gateTop, baseHeight(z)), surf: Surface.STAIRS });
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
  crown(w);

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
    h: (x, z) => {
      // Not north of it: there the plaza meets the rising hill, and a strip falling toward the hill
      // would be a trench at its foot. It stays level, between the platform and the hill.
      const shed = PLAZA_SHED * len2(Math.max(0, pf.x0 - x, x - pf.x1), Math.max(0, pf.z0 - z));
      // Beside the platform the plaza also falls south, so its side edges drain off it.
      let side = Math.max(0, Math.min(1, Math.max(pf.x0 - x, x - pf.x1) / 4));
      side = side * side * (3 - 2 * side);
      return yHs - shed - PLAZA_SHED * Math.max(0, pf.z0 - z) + side * PLAZA_SHED * 1.5 * (z - pf.z1);
    },
    surf: () => Surface.PLAZA,
  });

  // The platform's run-in: steps from the hill straight down onto the deck, flush with it.
  const ri = HILL_STATION_RUNIN;
  const yDeck = yHs + HILL_STATION_DECK;
  const yTop = baseHeight(ri.z1);
  C.rect({
    x0: ri.x0,
    x1: ri.x1,
    z0: pf.z1,
    z1: ri.z1,
    bx: 2,
    bz: 3,
    h: (_x, z) => yDeck + ((yTop - yDeck) * (z - pf.z1)) / (ri.z1 - pf.z1),
    surf: () => Surface.STAIRS,
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
