/**
 * Solids and rails for the four districts. Layout comes from layout.ts and the carved ground; the
 * seeded RNG only picks heights, widths, colours and scatter.
 */
import { PI, TAU, dcos, dsin } from '../math';
import { Rng } from '../rng';
import { Surface, addRail, addSolid, terrainHeight, type World } from '../world';
import {
  CITY,
  FUNI_X,
  FUNI_X0,
  FUNI_X1,
  HILL_STATION,
  LEVELS,
  MERCADO_STAIRS,
  NEEDLE,
  NEEDLE_WIRE,
  PAD_DEPTH,
  PLAZA_BODA,
  PLAZA_LEVEL_Z,
  SPINE_HALF,
  baseHeight,
  docksHeight,
  levelHeight,
  streetHeight,
  type Level,
} from './layout';
import { PARAPET, ROAD_HALF, SPINE_X, STAIR_HALF } from './layout';

/** The tallest step a board rolls up onto, m (FEEL.STEP_UP's default: the city is built once, before any tuning). */
const FEEL_STEP_UP = 0.4;
import { HILL_STATION_DECK, HILL_STATION_PLATFORM, type Ground } from './terrain';

interface Range {
  lo: number;
  hi: number;
}

/** Lowest and highest terrain under a rectangle (sampled every 1.5 m, edges included). */
function groundRange(w: World, x0: number, x1: number, z0: number, z1: number): Range {
  let lo = Infinity;
  let hi = -Infinity;
  const nx = Math.max(1, Math.ceil((x1 - x0) / 1.5));
  const nz = Math.max(1, Math.ceil((z1 - z0) / 1.5));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const y = terrainHeight(w, x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return { lo, hi };
}

function box(
  w: World,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  yBase: number,
  yTop: number,
  kind: string,
  style: number,
  surface: Surface = Surface.ROOF,
  oneWay = false,
): void {
  addSolid(w, {
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    hx: (x1 - x0) / 2,
    hz: (z1 - z0) / 2,
    rot: 0,
    yBase,
    yTop,
    surface,
    oneWay,
    kind,
    style,
  });
}

/** Paint the cells whose centres lie under a footprint (the ground inside a building). */
function paintUnder(w: World, x0: number, x1: number, z0: number, z1: number, s: Surface): void {
  const ix0 = Math.max(0, Math.ceil((x0 - w.minX) / w.cell - 0.5));
  const ix1 = Math.min(w.nx - 1, Math.floor((x1 - w.minX) / w.cell - 0.5));
  const iz0 = Math.max(0, Math.ceil((z0 - w.minZ) / w.cell - 0.5));
  const iz1 = Math.min(w.nz - 1, Math.floor((z1 - w.minZ) / w.cell - 0.5));
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) w.surfaces[iz * w.nx + ix] = s;
}

/** A rail along x at height `yOf(x)` above... (absolute heights), points every `step` m. */
function railAlongX(w: World, x0: number, x1: number, z: number, yOf: (x: number) => number, kind: string, step = 4): void {
  const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step));
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push(x, yOf(x), z);
  }
  addRail(w, pts, kind);
}

/** x ranges with the spine and the funicular corridor cut out. */
function clearRuns(x0: number, x1: number, funi: boolean): [number, number][] {
  const cuts: [number, number][] = [[-10, 10]];
  if (funi) cuts.push([FUNI_X0 - 4, FUNI_X1 + 4]);
  let runs: [number, number][] = [[x0, x1]];
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of runs) {
      if (c1 <= a || c0 >= b) next.push([a, b]);
      else {
        if (c0 > a) next.push([a, c0]);
        if (c1 < b) next.push([c1, b]);
      }
    }
    runs = next;
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Docks

export const WAREHOUSES: readonly [number, number][] = [
  [-105, 110],
  [-60, 110],
  [-105, 190],
  [-60, 190],
  [60, 110],
  [108, 110],
  [154, 110],
  [154, 200],
  [108, 214],
  [-155, 150],
  [-155, 214],
];
export const FISH_MARKET = { x0: -130, x1: -90, z0: 40, z1: 60 } as const;
export const PIER = { x0: -24, x1: -8, z0: -36, z1: -0.8 } as const;
/** Slipway gaps in the quay wall. */
export const SLIPWAYS: readonly [number, number][] = [
  [-100, -90],
  [90, 100],
];
export const QUAY_TOP = docksHeight(0) + 0.7;

function dressDocks(w: World, rng: Rng): void {
  // Quay wall with two slipways.
  const segs: [number, number][] = [
    [CITY.minX, SLIPWAYS[0][0]],
    [SLIPWAYS[0][1], SLIPWAYS[1][0]],
    [SLIPWAYS[1][1], CITY.maxX],
  ];
  for (const [a, b] of segs) {
    box(w, a, b, -0.8, 0.2, 0, QUAY_TOP, 'quay', 0, Surface.PLAZA);
    railAlongX(w, a + 1, b - 1, -0.3, () => QUAY_TOP + 0.05, 'ledge', 8);
  }
  // Gantry crane rails along the quayside street.
  for (const z of [4.5, 13.5]) railAlongX(w, -160, 160, z, (x) => docksHeight(z) + 0.2 + 0 * x, 'pipe', 10);
  // Ferry pier, flush with the quay wall top.
  box(w, PIER.x0, PIER.x1, PIER.z0, PIER.z1, 0, QUAY_TOP, 'platform', 0, Surface.PLAZA);
  for (const x of [PIER.x0 + 0.3, PIER.x1 - 0.3]) addRail(w, [x, QUAY_TOP + 0.05, PIER.z1 - 0.5, x, QUAY_TOP + 0.05, PIER.z0 + 0.5], 'ledge');
  // Fish market hall: big and low.
  const fm = FISH_MARKET;
  box(w, fm.x0, fm.x1, fm.z0, fm.z1, docksHeight(fm.z0) - 0.5, docksHeight(fm.z1) + 3, 'market', 0);
  railAlongX(w, fm.x0 + 1, fm.x1 - 1, fm.z0 - 0.5, () => docksHeight(fm.z0) + 0.6, 'ledge', 8);

  // Warehouses with pipes along their long walls.
  for (const [cx, cz] of WAREHOUSES) {
    const hx = rng.range(12, 15);
    const hz = rng.range(8, 10);
    const g = groundRange(w, cx - hx, cx + hx, cz - hz, cz + hz);
    box(w, cx - hx, cx + hx, cz - hz, cz + hz, g.lo - 0.5, g.hi + rng.range(8, 12), 'warehouse', rng.int(4));
    const py = g.lo + rng.range(1.0, 1.6);
    railAlongX(w, cx - hx + 1, cx + hx - 1, cz - hz - 0.6, () => py, 'pipe', 6);
    railAlongX(w, cx + hx - 1, cx - hx + 1, cz + hz + 0.6, () => py + 0.4, 'pipe', 6);
  }

  // Container yard: rows of stacks stepping 1-2-3-2-1, rideable from the crates at each end.
  for (const z of [146, 162]) {
    const pattern = [1, 2, 3, 2, 1];
    for (let i = 0; i < pattern.length; i++) {
      const x0 = 28 + i * 13;
      const lv = Math.max(1, Math.min(3, pattern[i] + (rng.chance(0.25) ? (rng.chance(0.5) ? 1 : -1) : 0)));
      const y0 = docksHeight(z);
      box(w, x0, x0 + 12, z - 1.22, z + 1.22, y0 - 0.3, y0 + 2.6 * lv, 'container', rng.int(6));
      if (lv === 1) addRail(w, [x0 + 0.5, y0 + 2.65, z - 1.1, x0 + 11.5, y0 + 2.65, z - 1.1], 'ledge');
    }
    // Crates as steps at the row ends.
    for (const x of [24.5, 97.5]) {
      const y0 = docksHeight(z);
      box(w, x - 0.6, x + 0.6, z - 0.6, z + 0.6, y0 - 0.2, y0 + rng.range(1.0, 1.2), 'crate', rng.int(3));
    }
  }
  // Crane yard: crates and single containers near the quay.
  for (let i = 0; i < 22; i++) {
    const x = rng.range(44, 116);
    const z = rng.range(22, 40);
    const s = rng.range(0.5, 0.65);
    const y0 = docksHeight(z);
    box(w, x - s, x + s, z - s, z + s, y0 - 0.2, y0 + rng.range(1.0, 1.3), 'crate', rng.int(3));
  }
  for (let i = 0; i < 4; i++) {
    const x = 50 + i * 16;
    const y0 = docksHeight(48);
    box(w, x, x + 6, 46.8, 49.2, y0 - 0.3, y0 + 2.6, 'container', rng.int(6));
  }
}

// ---------------------------------------------------------------------------------------------
// Mercado Steps

/**
 * Building blocks between the N-S streets (stairs at -84, -56, 28, 56, 84, run-out -28, spine 0):
 * each block's side walls stand 2 m off the stair street beside it.
 */
const BLOCK_X: readonly [number, number][] = [
  [-100, -90],
  [-78, -62],
  [-50, -36],
  [-20, -8],
  [8, 22],
  [34, 50],
  [62, 78],
  [90, 100],
];

/** Stair streets of the Mercado as [axis, half width], the spine and the funicular run-out included. */
const MERCADO_CROSSINGS: readonly (readonly [number, number])[] = [[SPINE_X, SPINE_HALF], [FUNI_X, 6], ...MERCADO_STAIRS.map((x) => [x, STAIR_HALF] as const)];

/** Market stalls along each landing's back edge either side of the spine (x ranges), behind the building faces that line it. */
const STALL_RUNS: readonly [number, number][] = [
  [-21.5, -10.5],
  [10.5, 21.5],
];
const STALL_STEP = 3.2;
/** How far an awning off a building's side wall reaches out, m. */
const SIDE_AWNING = 1.8;
/** How far an awning under a roof's side edge reaches out over the stair street beside it, m. */
const EDGE_REACH = 3;
/** The landing the funicular's bottom turn-round sweeps (no stalls on its west side). */
const FUNI_TRACK_LEVEL = 566;
const STALL_HALF = 1.1;
const STALL_DEPTH = 1.4;

interface Gap {
  zA: number;
  zB: number;
  /** Height of the lower street's back edge and of the upper street's front edge at x. */
  yLow: (x: number) => number;
  yUp: (x: number) => number;
  /** Awnings over the lower street. */
  awnings: boolean;
}

/** A one-way awning over [x0, x1] x [z0, z1] whose underside is 2.3-3.0 m above every point beneath, if one fits. */
function awning(w: World, rng: Rng, x0: number, x1: number, z0: number, z1: number): boolean {
  const ag = groundRange(w, x0, x1, z0, z1);
  const room = ag.lo + 2.95 - (ag.hi + 2.35);
  if (room < 0) return false;
  const yA = ag.hi + 2.35 + rng.range(0, room);
  box(w, x0, x1, z0, z1, yA, yA + 0.2, 'awning', rng.int(6), Surface.AWNING, true);
  return true;
}

/** How far below a roof edge the top of an awning under it sits, m. */
const EDGE_DROP: readonly [number, number] = [0.3, 1.5];
/** Depth of an awning under an edge, m. */
const EDGE_DEPTH: readonly [number, number] = [2.5, 3.5];

/**
 * Awnings along [z0, z1] beside a roof edge (over [x0, x1]), each EDGE_DEPTH deep with its top
 * EDGE_DROP below the edge at `yEdge` and its underside 2.3-3.0 m above the ground beneath, as many
 * as fit, from the uphill end down. Returns how many.
 */
function edgeAwnings(w: World, rng: Rng, x0: number, x1: number, z0: number, z1: number, yEdge: number): number {
  let n = 0;
  let z = z1;
  while (z - EDGE_DEPTH[0] >= z0) {
    let placed = false;
    for (const d of [EDGE_DEPTH[1], (EDGE_DEPTH[0] + EDGE_DEPTH[1]) / 2, EDGE_DEPTH[0]]) {
      if (z - d < z0) continue;
      const ag = groundRange(w, x0, x1, z - d, z);
      const lo = Math.max(ag.hi + 2.35, yEdge - EDGE_DROP[1] - 0.2);
      const hi = Math.min(ag.lo + 2.95, yEdge - EDGE_DROP[0] - 0.2);
      if (hi < lo) continue;
      const yA = lo + rng.range(0, hi - lo);
      box(w, x0, x1, z - d, z, yA, yA + 0.2, 'awning', rng.int(6), Surface.AWNING, true);
      n++;
      z -= d + 0.2;
      placed = true;
      break;
    }
    if (!placed) z -= 0.5;
  }
  return n;
}

function dressMercado(w: World, rng: Rng, firstTerrace: number): number {
  const merc = LEVELS.slice(0, firstTerrace);
  const back = (L: Level) => (x: number) => streetHeight(L, x, L.z1);
  const front = (L: Level) => (x: number) => streetHeight(L, x, L.z0);
  const gaps: Gap[] = [{ zA: CITY.bands.mercado + 3, zB: merc[0].z0, yLow: () => docksHeight(CITY.bands.mercado), yUp: front(merc[0]), awnings: true }];
  for (let i = 0; i + 1 < merc.length; i++) gaps.push({ zA: merc[i].z1, zB: merc[i + 1].z0, yLow: back(merc[i]), yUp: front(merc[i + 1]), awnings: true });
  const top = merc[merc.length - 1];
  const pad = LEVELS[firstTerrace];
  gaps.push({ zA: top.z1, zB: pad.z0 - 3, yLow: back(top), yUp: front(pad), awnings: true });
  const stallAt = (x0: number, x1: number): boolean => STALL_RUNS.some(([a, b]) => x1 > a && x0 < b);

  let awnings = 0;
  for (const gap of gaps) {
    const depth = gap.zB - gap.zA;
    const rows: [number, number, boolean][] =
      depth >= 24
        ? [
            [gap.zA, gap.zA + depth / 2, false],
            [gap.zA + depth / 2, gap.zB, true],
          ]
        : [[gap.zA, gap.zB, true]];
    for (const [bx0, bx1] of BLOCK_X) {
      let runs: [number, number][] = [[bx0, bx1]];
      if (gap.zB > 555) runs = clearRuns(bx0, bx1, true);
      for (const [rx0, rx1] of runs) {
        if (rx1 - rx0 < 6) continue;
        // An alley through the middle of wide blocks.
        const parts: [number, number][] =
          rx1 - rx0 >= 15
            ? [
                [rx0, (rx0 + rx1) / 2 - 2],
                [(rx0 + rx1) / 2 + 2, rx1],
              ]
            : [[rx0, rx1]];
        for (const [bx0p, bx1p] of parts) {
          for (const [z0r, z1r, north] of rows) {
            let z0 = z0r;
            const z1 = z1r;
            let x0 = bx0p;
            let x1 = bx1p;
            // Leave the wedding plaza open: trim whatever overlaps it.
            const P = PLAZA_BODA;
            if (x1 > P.x0 - 2 && x0 < P.x1 + 2 && z1 > P.z0 + 0.5 && z0 < P.z1 + 2) {
              if (x1 > P.x1 + 8) x0 = P.x1 + 2;
              else if (x0 < P.x0 - 8) x1 = P.x0 - 2;
              else z0 = Math.max(z0, P.z1 + 3);
            }
            if (z1 - z0 < 6 || x1 - x0 < 5) continue;
            const g = groundRange(w, x0, x1, z0, z1);
            const xc = (x0 + x1) / 2;
            let yTop: number;
            if (north) {
              // The uphill row: low roofs a step below the front edge of the street above, so a
              // skater rolling off that street lands on them instead of meeting a wall.
              yTop = Math.max(Math.min(gap.yUp(x0), gap.yUp(x1)) - rng.range(0.1, 0.6), g.hi + 0.05);
            } else {
              // The downhill row: the tall street wall over the lower street, a step lower than the
              // low roofs behind it, so a skater crossing those carries on onto it and off its front,
              // onto the awnings over the street below.
              const behind = Math.min(gap.yUp(x0), gap.yUp(x1)) - 0.6;
              yTop = Math.min(gap.yLow(xc) + rng.range(9, 11), behind - rng.range(0.3, 0.8));
              yTop = Math.max(yTop, terrainHeight(w, xc, (z0 + z1) / 2) + 5, g.hi + 2.5);
            }
            box(w, x0, x1, z0, z1, g.lo - 1, yTop, 'building', rng.int(8));
            paintUnder(w, x0, x1, z0, z1, Surface.PLAZA);
            // Below the roof's side edges, where a skater rolls off it into the stair street or
            // alley beside (most falls off a roof go that way): awnings off each side wall a step
            // below the roof, wherever one fits over the ground there, from the uphill end down.
            // Over a stair street they reach EDGE_REACH out; into an alley (4 m between two walls)
            // each side's reach not quite halfway.
            for (const [wall, side, alley] of [
              [x0, -1, parts.length > 1 && bx0p !== parts[0][0]],
              [x1, 1, parts.length > 1 && bx1p !== parts[parts.length - 1][1]],
            ] as const) {
              const reach = alley ? SIDE_AWNING : EDGE_REACH;
              const near = wall + side * 0.1;
              const far = wall + side * reach;
              awnings += edgeAwnings(w, rng, Math.min(near, far), Math.max(near, far), z0, z1, yTop);
            }
            // Awnings over the street below the front of the lowest row (not where stalls stand).
            const lowest = z0 === gap.zA && gap.zA > CITY.bands.mercado + 5;
            if (gap.awnings && lowest && !stallAt(x0, x1) && awning(w, rng, x0 + 0.4, x1 - 0.4, z0 - 3.2, z0 - 0.4)) awnings++;
          }
        }
      }
    }
  }

  // Where a flight comes down onto a landing (and where the next one leaves it), awnings over the
  // outer thirds of the stair street, underside within reach of the landing: what a skater coming
  // off the flight or its handrail lands on.
  for (const L of merc) {
    const third = (L.z1 - L.z0) / 3;
    for (const [a, h] of MERCADO_CROSSINGS) {
      if (L.z === PLAZA_LEVEL_Z && a > PLAZA_BODA.x0 && a < PLAZA_BODA.x1) continue;
      // The funicular's bottom turn-round and stop are on this crossing.
      if (L.z === FUNI_TRACK_LEVEL && a === FUNI_X) continue;
      // Below the flight, right across the stair street (the spine keeps its middle third clear);
      // above the next one down, over its outer thirds.
      const full = a !== SPINE_X;
      for (const [z0, z1, across] of [
        [L.z1 - third, L.z1 - 0.3, full],
        [L.z0 + 0.3, L.z0 + third, false],
      ] as const) {
        const spans: (readonly [number, number])[] = across
          ? [[a - h, a + h]]
          : [
              [a - h, a - h / 3],
              [a + h / 3, a + h],
            ];
        for (const [x0, x1] of spans) if (awning(w, rng, x0, x1, z0, z1)) awnings++;
      }
    }
    // A ledge along the front edge of the landing between the stair streets, over the low roofs.
    let free: [number, number][] = [[-100, 100]];
    const cuts: [number, number][] = MERCADO_CROSSINGS.map(([a, h]) => [a - h - 1, a + h + 1]);
    if (L.z === PLAZA_LEVEL_Z) cuts.push([PLAZA_BODA.x0 - 4, PLAZA_BODA.x1 + 4]);
    for (const [c0, c1] of cuts) {
      const next: [number, number][] = [];
      for (const [e0, e1] of free) {
        if (c1 <= e0 || c0 >= e1) next.push([e0, e1]);
        else {
          if (c0 > e0) next.push([e0, c0]);
          if (c1 < e1) next.push([c1, e1]);
        }
      }
      free = next;
    }
    for (const [e0, e1] of free) if (e1 - e0 >= 6) railAlongX(w, e0, e1, L.z0 + 0.3, (x) => streetHeight(L, x, L.z0) + 0.35, 'ledge');

    // Market stalls along the back edge either side of the spine, clear of its width, backed onto
    // the building wall behind (not where the wedding parade or the funicular turns).
    for (const [r0, r1] of STALL_RUNS) {
      if (L.z === PLAZA_LEVEL_Z && r0 > 0) continue;
      if (L.z === FUNI_TRACK_LEVEL && r0 < 0) continue;
      for (let x = r0 + STALL_HALF; x + STALL_HALF <= r1 + 1e-6; x += STALL_STEP) {
        const ys = streetHeight(L, x, L.z1);
        box(w, x - STALL_HALF, x + STALL_HALF, L.z1 - STALL_DEPTH, L.z1, ys - 0.2, ys + 2.4, 'stall', rng.int(6));
      }
    }
  }

  // The wedding plaza: church and clock tower behind, stalls along its back, a fountain.
  const P = PLAZA_BODA;
  const yP = levelHeight(merc[3], (P.x0 + P.x1) / 2);
  const cg = groundRange(w, P.x0 + 2, P.x1 - 2, P.z1 + 3, merc[4].z0 - 1);
  box(w, P.x0 + 2, P.x1 - 2, P.z1 + 3, merc[4].z0 - 1, cg.lo - 1, cg.hi + 7, 'church', 0);
  paintUnder(w, P.x0 - 4, P.x1 + 4, P.z0, merc[4].z0, Surface.PLAZA);
  box(w, 36, 44, P.z1 + 3, P.z1 + 11, cg.lo - 1, yP + 24, 'tower', 0);
  for (let x = P.x0 + 6; x <= P.x1 - 6; x += 6.4) {
    box(w, x - 1.1, x + 1.1, P.z1 - 1.6, P.z1, yP - 0.2, yP + 2.4, 'stall', rng.int(6));
  }
  box(w, 38.5, 41.5, 467.5, 470.5, yP - 0.2, yP + 1.0, 'kiosk', 1);
  // Spice row: stalls along the back of the landing at 514, clear of the stair streets.
  const spice = merc[4];
  for (let x = -100; x <= -64; x += 6) {
    if (MERCADO_CROSSINGS.some(([a, h]) => Math.abs(x - a) < h + STALL_HALF + 1)) continue;
    const ys = streetHeight(spice, x, spice.z1);
    box(w, x - STALL_HALF, x + STALL_HALF, spice.z1 - STALL_DEPTH, spice.z1, ys - 0.2, ys + 2.4, 'stall', rng.int(6));
  }
  return awnings;
}

// ---------------------------------------------------------------------------------------------
// Terraces

export const SCHOOL_LEVEL_Z = 727;
export const SCHOOL_X: readonly [number, number] = [40, 72];

function dressTerraces(w: World, rng: Rng, firstTerrace: number): void {
  const terr = LEVELS.slice(firstTerrace);
  for (let k = 0; k < terr.length; k++) {
    const L = terr[k];
    const next: Level | undefined = terr[k + 1];
    const zb = L.z0 + PAD_DEPTH;
    const garden = baseHeight(zb + 3);
    const school = L.z === SCHOOL_LEVEL_Z;
    for (const [rx0, rx1] of clearRuns(-100, 100, true)) {
      // Yard houses against the back wall.
      let x = rx0 + rng.range(0, 3);
      while (x < rx1 - 6) {
        const wd = Math.min(rng.range(8, 12), rx1 - x);
        const x1 = x + wd;
        if (school && x1 > SCHOOL_X[0] && x < SCHOOL_X[1]) {
          x = SCHOOL_X[1] + 4;
          continue;
        }
        const d = rng.range(11, 14);
        const z0 = Math.max(L.z1 + 2, zb - d);
        const g = groundRange(w, x, x1, z0, zb);
        const yTop = Math.min(g.hi + 9, Math.max(g.hi + 5, garden + rng.range(-1.0, 1.0)));
        box(w, x, x1, z0, zb, g.lo - 0.5, yTop, 'house', rng.int(8));
        x = x1 + rng.range(4, 6);
      }
      // Garden houses below the next pad: roofs just under its street.
      if (next) {
        let gx = rx0 + rng.range(0, 4);
        while (gx < rx1 - 6) {
          const wd = Math.min(rng.range(8, 12), rx1 - gx);
          const x1 = gx + wd;
          const z1 = next.z0 - 3;
          const z0 = Math.max(zb + 4, z1 - rng.range(8, 11));
          const g = groundRange(w, gx, x1, z0, z1);
          const yTop = Math.min(levelHeight(next, gx), levelHeight(next, x1)) - rng.range(0.5, 1.3);
          if (yTop > g.hi + 2.5) box(w, gx, x1, z0, z1, g.lo - 0.5, yTop, 'house', rng.int(8));
          gx = x1 + rng.range(4, 6);
        }
      }
      // Ledges along the wall tops.
      const fy = (xx: number): number => levelHeight(L, xx) + 0.3;
      railAlongX(w, rx0 + 1, rx1 - 1, L.z0 - 1.5, fy, 'ledge');
      if (next) railAlongX(w, rx1 - 1, rx0 + 1, zb + 1.5, () => garden + 0.3, 'ledge');
    }
    if (school) {
      const z0 = zb - 14;
      const g = groundRange(w, SCHOOL_X[0], SCHOOL_X[1], z0, zb);
      box(w, SCHOOL_X[0], SCHOOL_X[1], z0, zb, g.lo - 0.5, garden + 0.6, 'school', 0);
    }
    // Laundry lines across the street.
    for (let i = 0; i < 5; i++) {
      let lx = rng.range(-95, 95);
      if (Math.abs(lx) < 12) lx = 12 * Math.sign(lx || 1) + lx;
      if (lx > FUNI_X0 - 5 && lx < FUNI_X1 + 5) lx = FUNI_X0 - 8 - rng.range(0, 20);
      const y = levelHeight(L, lx) + rng.range(3.2, 4.6);
      addRail(w, [lx, y, L.z0 + 0.4, lx, y + rng.range(-0.3, 0.3), L.z1 + 1.6], 'wire');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Antenna Hill

export const MASTS: readonly [number, number, number][] = [
  [-80, 1000, 26],
  [-125, 1090, 28],
  [95, 1160, 30],
  [-62, 1205, 25],
  [125, 1040, 27],
  [-30, 1110, 24],
];

/** Top of the needle platform. */
export function needleTop(): number {
  return baseHeight(NEEDLE.z) + NEEDLE.height;
}

function dressAntenna(w: World, rng: Rng): void {
  for (const [mx, mz, h] of MASTS) {
    const g = terrainHeight(w, mx, mz);
    box(w, mx - 0.5, mx + 0.5, mz - 0.5, mz + 0.5, g - 1, g + h, 'mast', 0);
    const a0 = rng.range(0, TAU);
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * TAU) / 3;
      const d = 0.85 * h;
      const ax = mx + d * dcos(a);
      const az = mz + d * dsin(a);
      addRail(w, [mx + 0.6 * dcos(a), g + h - 0.8, mz + 0.6 * dsin(a), ax, terrainHeight(w, ax, az) + 0.3, az], 'guy');
    }
    const dx = mx + (mx < 0 ? 7 : -7);
    const dg = groundRange(w, dx - 2.1, dx + 2.1, mz - 2.1, mz + 2.1);
    // Turned 45 degrees: on the open slope a skater rolling down onto it meets a corner and slides
    // round, where a square face would pin them.
    addSolid(w, { cx: dx, cz: mz, hx: 1.5, hz: 1.5, rot: PI / 4, yBase: dg.lo - 0.5, yTop: dg.hi + 2.5, surface: Surface.ROOF, kind: 'dish', style: rng.int(2) });
  }
  // Sheds, and the radio shack off the west path.
  const sheds: [number, number, number][] = [
    [-60, 1140, 1],
    [-100, 1030, 0],
    [80, 1080, 0],
    [130, 1200, 2],
    [-140, 1170, 2],
  ];
  for (const [sx, sz, st] of sheds) {
    const hx = st === 1 ? 3 : 2;
    const g = groundRange(w, sx - hx, sx + hx, sz - 2, sz + 2);
    box(w, sx - hx, sx + hx, sz - 2, sz + 2, g.lo - 0.5, g.hi + 2.6, 'shed', st);
  }
  // Hill station platform.
  const hs = HILL_STATION;
  const yh = baseHeight((hs.z0 + hs.z1) / 2);
  const pf = HILL_STATION_PLATFORM;
  box(w, pf.x0, pf.x1, pf.z0, pf.z1, yh - 0.5, yh + HILL_STATION_DECK, 'platform', 1, Surface.PLAZA);
  // The summit antenna and the needle.
  const gN = terrainHeight(w, NEEDLE.x, NEEDLE.z);
  const top = needleTop();
  box(w, NEEDLE.x - 0.6, NEEDLE.x + 0.6, NEEDLE.z - 0.6, NEEDLE.z + 0.6, gN - 1, top - 0.6, 'mast', 1);
  box(w, NEEDLE.x - NEEDLE.half, NEEDLE.x + NEEDLE.half, NEEDLE.z - NEEDLE.half, NEEDLE.z + NEEDLE.half, top - 0.6, top, 'needle', 0, Surface.ROOF);
  // Its guy wire: a straight grindable line down to the lawn, the reward for reaching the needle.
  const gw = NEEDLE_WIRE;
  const y0 = top - gw.below;
  const y1 = terrainHeight(w, gw.x1, gw.z1) + gw.foot;
  const n = 12;
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    pts.push(gw.x0 + (gw.x1 - gw.x0) * f, y0 + (y1 - y0) * f, gw.z0 + (gw.z1 - gw.z0) * f);
  }
  addRail(w, pts, 'guy');
}

// ---------------------------------------------------------------------------------------------
// Handrails: one per flight on every stair street (two on the spine), 0.9 m above the steps, with
// a level run-in on the landing above and a short run-out past the bottom.

export const HANDRAIL_H = 0.9;
const RUN_IN = 4;
const RUN_OUT = 2.5;

function handrail(w: World, x: number, zLo: number, zHi: number): void {
  const y = (z: number): number => terrainHeight(w, x, z) + HANDRAIL_H;
  const zTop = zHi + RUN_IN;
  const zBot = zLo - RUN_OUT;
  // The landing above falls toward the flight: the level run-in sits half that fall higher at the
  // top of the flight, so it is HANDRAIL_H above the ground at the middle of its length.
  const yIn = (y(zHi) + y(zTop)) / 2;
  // Likewise the run-out over the landing below, which falls away from the flight's foot.
  const yOut = (y(zLo) + y(zBot)) / 2;
  addRail(w, [x, yIn, zTop, x, yIn, zHi, x, yOut, zLo, x, yOut, zBot], 'handrail');
}

function dressHandrails(w: World, g: Ground): void {
  for (const st of g.stairs) {
    // A rail either side of each stair street; the funicular run-out has one on its west side, on a
    // row of height samples, clear of the car standing at the base.
    // (Half a metre in from the run-out's side wall, so a grind does not run along its face:
    // DECISIONS 126.)
    const xs = st.x === FUNI_X ? [st.x - 4.5] : [st.x - 2, st.x + 2];
    for (const x of xs) for (const f of st.stepper.flights) handrail(w, x, f.zLo, f.zHi);
  }
  for (const f of g.spine.flights) {
    handrail(w, SPINE_X - 3, f.zLo, f.zHi);
    handrail(w, SPINE_X + 3, f.zLo, f.zHi);
  }
}

/**
 * The strips between a stair street and the buildings that flank it are part of the flight: give
 * every cell there that a building does not wholly cover the stair surface, so a skater sliding
 * down beside a wall is slowed by the steps like one on them (paintUnder claims the cells whose
 * centres a footprint covers, which include the open edge of a cell beside the wall).
 */
function paintFlightStrips(w: World, g: Ground): void {
  const blocks = w.solids.filter((o) => !o.oneWay && o.rot === 0 && o.cz > CITY.bands.mercado && o.cz < CITY.bands.terraces + 40);
  const covered = (x0: number, x1: number, z0: number, z1: number): boolean =>
    blocks.some((o) => x0 >= o.cx - o.hx - 1e-6 && x1 <= o.cx + o.hx + 1e-6 && z0 >= o.cz - o.hz - 1e-6 && z1 <= o.cz + o.hz + 1e-6);
  const streets = [...g.stairs.map((st) => ({ x: st.x, half: st.half, stepper: st.stepper })), { x: SPINE_X, half: 6, stepper: g.spine }];
  for (const st of streets) {
    const reach = st.half + 4.5;
    const ix0 = Math.max(0, Math.floor((st.x - reach - w.minX) / w.cell));
    const ix1 = Math.min(w.nx - 1, Math.floor((st.x + reach - w.minX) / w.cell));
    for (let iz = 0; iz < w.nz; iz++) {
      const zc = w.minZ + (iz + 0.5) * w.cell;
      if (zc < st.stepper.z0 || zc > Math.min(st.stepper.z1, CITY.bands.terraces) || !st.stepper.isFlight(zc)) continue;
      for (let ix = ix0; ix <= ix1; ix++) {
        const ci = iz * w.nx + ix;
        if (w.surfaces[ci] !== Surface.PLAZA) continue;
        const xl = w.minX + ix * w.cell;
        const zl = w.minZ + iz * w.cell;
        if (!covered(xl, xl + w.cell, zl, zl + w.cell)) w.surfaces[ci] = Surface.STAIRS;
      }
    }
  }
}


/**
 * A low parapet round the outside of each outer hairpin of the switchback roads, so a skater who
 * comes down a road without steering is turned along the bend instead of leaving the road for the
 * terraced banks beyond it.
 */
function dressParapets(w: World, g: Ground): void {
  for (const road of [g.east, g.west]) {
    // Not round the bottom bend, on the level docks: a skater who runs wide there just rolls out onto them.
    for (const a of road.outer.slice(1)) {
      const R = a.r + ROAD_HALF + PARAPET.out;
      // From the bottom of the bend, where the road stands on fill, round to PARAPET.sweep of it:
      // at the top the road is cut into the hill and the bank stops a skater by itself.
      const sweep = a.da * PARAPET.sweep;
      const n = Math.max(2, Math.ceil((Math.abs(sweep) * R) / PARAPET.seg));
      const step = sweep / n;
      const chord = 2 * R * dsin(Math.abs(step) / 2);
      for (let k = 0; k < n; k++) {
        const t0 = a.a0 + step * k;
        const t1 = t0 + step;
        const tm = (t0 + t1) / 2;
        const cx = a.cx + R * dcos(tm);
        const cz = a.cz + R * dsin(tm);
        // A wall from the road; from the bank outside (higher, where the road is cut into the
        // hill) its top is nearly flush, so a skater coming down the bank rolls over it onto the
        // road instead of being pinned against it.
        // The bank is read just outside the parapet's face, at its lowest along the segment.
        let lo = Infinity;
        let road = -Infinity;
        let bank = Infinity;
        let rise = Infinity;
        /** Outside ground at the face, and how far the bank beyond rises above it, at each sample. */
        const foot: number[] = [];
        const drain: number[] = [];
        for (const t of [t0, (t0 + tm) / 2, tm, (tm + t1) / 2, t1]) {
          const c = dcos(t);
          const sn = dsin(t);
          const yi = terrainHeight(w, a.cx + (R - 1) * c, a.cz + (R - 1) * sn);
          const yo = terrainHeight(w, a.cx + (R + PARAPET.half + 0.35) * c, a.cz + (R + PARAPET.half + 0.35) * sn);
          const yb = terrainHeight(w, a.cx + (R + PARAPET.half + PARAPET.drainAt) * c, a.cz + (R + PARAPET.half + PARAPET.drainAt) * sn);
          lo = Math.min(lo, yi, yo);
          road = Math.max(road, yi);
          bank = Math.min(bank, yo);
          rise = Math.min(rise, terrainHeight(w, a.cx + (R + PARAPET.open) * c, a.cz + (R + PARAPET.open) * sn));
          foot.push(yo);
          drain.push(yb - yo);
        }
        const top = Math.max(road + PARAPET.height, bank + PARAPET.flush);
        // Where the bank climbs steeply just beyond, the road is cut into the hill: the bank turns a
        // skater by itself, and a wall at its foot would only leave a gutter to be pinned in.
        if (rise > top + PARAPET.openRise) continue;
        // A hollow against the face: the outside ground is lowest along the segment somewhere in its
        // middle, the bank beyond runs down into it, and the wall stands taller than a board rolls
        // up. A skater coming down the bank is pinned there (found by the 400-drop test once the
        // board was twice as fast: DECISIONS 126): leave that segment open, and the hollow drains
        // onto the road.
        let m = 0;
        for (let i = 1; i < foot.length; i++) if (foot[i] < foot[m]) m = i;
        const hollow = m > 0 && m < foot.length - 1 && foot[0] - foot[m] > PARAPET.gutter && foot[foot.length - 1] - foot[m] > PARAPET.gutter;
        if (hollow && drain[m] > PARAPET.drainRise && top - foot[m] > FEEL_STEP_UP) continue;
        addSolid(w, {
          cx,
          cz,
          hx: chord / 2 + 0.2,
          hz: PARAPET.half,
          rot: tm + PI / 2,
          yBase: lo - 0.6,
          yTop: top,
          surface: Surface.PLAZA,
          kind: 'wall',
          style: 1,
        });
      }
    }
  }
}

export interface DressStats {
  awnings: number;
}

export function dressCity(w: World, g: Ground, seed: number): DressStats {
  const rng = new Rng(seed);
  dressDocks(w, rng.fork('docks'));
  const awnings = dressMercado(w, rng.fork('mercado'), g.firstTerrace);
  dressTerraces(w, rng.fork('terraces'), g.firstTerrace);
  dressAntenna(w, rng.fork('antenna'));
  paintFlightStrips(w, g);
  dressParapets(w, g);
  dressHandrails(w, g);
  return { awnings };
}
