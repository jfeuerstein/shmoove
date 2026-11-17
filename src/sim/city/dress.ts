/**
 * Solids and rails for the four districts. Layout comes from layout.ts and the carved ground; the
 * seeded RNG only picks heights, widths, colours and scatter.
 */
import { PI, TAU, dcos, dsin } from '../math';
import { Rng } from '../rng';
import { Surface, addRail, addSolid, terrainHeight, type World } from '../world';
import {
  CITY,
  FUNI_X0,
  FUNI_X1,
  HILL_STATION,
  LEVELS,
  NEEDLE,
  PAD_DEPTH,
  PLAZA_BODA,
  baseHeight,
  docksHeight,
  levelHeight,
  type Level,
} from './layout';
import { PARAPET, ROAD_HALF, SPINE_X, STAIR_HALF } from './layout';
import { HILL_STATION_PLATFORM, type Ground } from './terrain';

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

/** Building blocks between the N-S streets (stairs at -84, -56, 28, 56, 84, run-out -28, spine 0). */
const BLOCK_X: readonly [number, number][] = [
  [-100, -89],
  [-79, -61],
  [-51, -35],
  [-21, -9],
  [9, 23],
  [33, 51],
  [61, 79],
  [89, 100],
];

interface Gap {
  zA: number;
  zB: number;
  yLow: (x: number) => number;
  yUp: (x: number) => number;
  /** Awnings over the lower street. */
  awnings: boolean;
}

function dressMercado(w: World, rng: Rng, firstTerrace: number): number {
  const merc = LEVELS.slice(0, firstTerrace);
  const gaps: Gap[] = [
    { zA: CITY.bands.mercado + 3, zB: merc[0].z0, yLow: () => docksHeight(CITY.bands.mercado), yUp: (x) => levelHeight(merc[0], x), awnings: true },
  ];
  for (let i = 0; i + 1 < merc.length; i++) {
    const a = merc[i];
    const b = merc[i + 1];
    gaps.push({ zA: a.z1, zB: b.z0, yLow: (x) => levelHeight(a, x), yUp: (x) => levelHeight(b, x), awnings: true });
  }
  const top = merc[merc.length - 1];
  const pad = LEVELS[firstTerrace];
  gaps.push({ zA: top.z1, zB: pad.z0 - 3, yLow: (x) => levelHeight(top, x), yUp: (x) => levelHeight(pad, x), awnings: true });

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
              const yUp = Math.min(gap.yUp(x0), gap.yUp(x1));
              yTop = rng.chance(0.55) ? yUp + rng.range(-0.9, 0.9) : yUp + rng.range(2.0, 3.5);
            } else {
              yTop = gap.yLow(xc) + rng.range(6.5, 8.5);
            }
            yTop = Math.max(yTop, g.hi + 2.5);
            box(w, x0, x1, z0, z1, g.lo - 1, yTop, 'building', rng.int(8));
            paintUnder(w, x0, x1, z0, z1, Surface.PLAZA);
            // Awnings over the street below the front of the lowest row.
            if (gap.awnings && z0 === gap.zA && rng.chance(0.88)) {
              // Underside 2.35-2.95 m above every point of the street beneath.
              const ag = groundRange(w, x0 + 0.4, x1 - 0.4, z0 - 3.2, z0 - 0.4);
              const room = ag.lo + 2.95 - (ag.hi + 2.35);
              if (room >= 0) {
                const yA = ag.hi + 2.35 + rng.range(0, room);
                box(w, x0 + 0.4, x1 - 0.4, z0 - 3.2, z0 - 0.4, yA, yA + 0.2, 'awning', rng.int(6), Surface.AWNING, true);
                awnings++;
              }
            }
          }
        }
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
    box(w, x - 1.1, x + 1.1, P.z1 - 2.0, P.z1 - 0.4, yP - 0.2, yP + 2.4, 'stall', rng.int(6));
  }
  box(w, 38.5, 41.5, 467.5, 470.5, yP - 0.2, yP + 1.0, 'kiosk', 1);
  // Spice row: stalls along the south side of the landing at 514.
  const spice = merc[4];
  for (let x = -100; x <= -64; x += 6) {
    const ys = levelHeight(spice, x);
    box(w, x - 1.1, x + 1.1, spice.z - 7.2, spice.z - 5.6, ys - 0.2, ys + 2.4, 'stall', rng.int(6));
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
    const dg = groundRange(w, dx - 1.5, dx + 1.5, mz - 1.5, mz + 1.5);
    box(w, dx - 1.5, dx + 1.5, mz - 1.5, mz + 1.5, dg.lo - 0.5, dg.hi + 2.5, 'dish', rng.int(2));
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
  box(w, pf.x0, pf.x1, pf.z0, pf.z1, yh - 0.5, yh + 1.0, 'platform', 1, Surface.PLAZA);
  // The summit antenna and the needle.
  const gN = terrainHeight(w, NEEDLE.x, NEEDLE.z);
  const top = needleTop();
  box(w, NEEDLE.x - 0.6, NEEDLE.x + 0.6, NEEDLE.z - 0.6, NEEDLE.z + 0.6, gN - 1, top - 0.6, 'mast', 1);
  box(w, NEEDLE.x - NEEDLE.half, NEEDLE.x + NEEDLE.half, NEEDLE.z - NEEDLE.half, NEEDLE.z + NEEDLE.half, top - 0.6, top, 'needle', 0, Surface.ROOF);
}

// ---------------------------------------------------------------------------------------------
// Handrails: one per flight on every stair street (two on the spine), 0.9 m above the steps, with
// a level run-in on the landing above and a short run-out past the bottom.

export const HANDRAIL_H = 0.9;
const RUN_IN = 5;
const RUN_OUT = 2.5;

function handrail(w: World, x: number, zLo: number, zHi: number): void {
  const y = (z: number): number => terrainHeight(w, x, z) + HANDRAIL_H;
  const zTop = zHi + RUN_IN;
  const zBot = zLo - RUN_OUT;
  addRail(w, [x, y(zHi), zTop, x, y(zHi), zHi, x, y(zLo), zLo, x, y(zLo), zBot], 'handrail');
}

function dressHandrails(w: World, g: Ground): void {
  for (const st of g.stairs) {
    const x = st.x + (st.half > STAIR_HALF ? 3 : 2);
    for (const f of st.stepper.flights) handrail(w, x, f.zLo, f.zHi);
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
    for (const a of road.outer) {
      const R = a.r + ROAD_HALF + PARAPET.out;
      const n = Math.max(2, Math.ceil((Math.abs(a.da) * R) / PARAPET.seg));
      const step = a.da / n;
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
        let lo = Infinity;
        let road = -Infinity;
        let bank = -Infinity;
        for (const t of [t0, tm, t1]) {
          const c = dcos(t);
          const sn = dsin(t);
          const yi = terrainHeight(w, a.cx + (R - 1) * c, a.cz + (R - 1) * sn);
          const yo = terrainHeight(w, a.cx + (R + 1) * c, a.cz + (R + 1) * sn);
          lo = Math.min(lo, yi, yo);
          road = Math.max(road, yi);
          bank = Math.max(bank, yo);
        }
        addSolid(w, {
          cx,
          cz,
          hx: chord / 2 + 0.2,
          hz: PARAPET.half,
          rot: tm + PI / 2,
          yBase: lo - 0.6,
          yTop: Math.max(road + PARAPET.height, bank + PARAPET.flush),
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
