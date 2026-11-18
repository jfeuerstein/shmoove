/**
 * Small props that say who lives where (brief M7b): plants in pots by doors and on balconies,
 * bikes and scooters against walls, cats on roofs, antennas and dishes up the hill, crates and
 * baskets by the stalls, nets and buoys at the docks, and bunting with bulbs across the stair
 * streets. Decoration only: nothing here collides, and props on the ground keep to the same
 * clear spots as people (off lanes, rails and run-ins and the middle of stair streets).
 */
import { District, Surface, districtAt, terrainHeight, topHeight, type Solid, type World } from '../../sim/world';
import { type MeshBuilder, hash2 } from '../geom';
import { INK } from '../look';
import { clearForFigure, type RouteCtx } from '../people';
import { disc2, fbox, faceGround, fx, fz, lx2x, lx2z, prism, solidFaces, streetSide, type Face } from './kit';

const LEAF = [INK.leaf, 0x2f8f5a, 0x7cc86a];
const POTS = [INK.brick, 0xc98a55, INK.teal, INK.cobalt, INK.paper];
const BIKES = [INK.pink, INK.teal, INK.cobalt, INK.mango, 0x2a2f6e];
const CAT = [0x2c2a3c, 0xe0904a, 0xf3ebdd, 0x8a8478];

function onGround(w: World, x: number, z: number): boolean {
  return topHeight(w, x, z) <= terrainHeight(w, x, z) + 0.05;
}

function pot(b: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const pc = POTS[Math.floor(hash2(seed, 1) * POTS.length)];
  const lc = LEAF[Math.floor(hash2(seed, 2) * LEAF.length)];
  const r = 0.2 + 0.08 * hash2(seed, 3);
  b.box(x, y + r * 0.9, z, r, r * 0.9, r, 1, 0, pc);
  // A bush: a fat leafy block, a little turned.
  const a = hash2(seed, 4) * 1.5;
  b.box(x, y + r * 1.8 + r * 0.9, z, r * 1.3, r, r * 1.3, Math.cos(a), Math.sin(a), lc, { top: LEAF[(Math.floor(hash2(seed, 2) * 3) + 1) % 3] });
}

function bike(b: MeshBuilder, x: number, y: number, z: number, ax: number, az: number, nx: number, nz: number, seed: number): void {
  // Leaning on a wall: wheels in the plane along the wall, (ax, az) along it, (nx, nz) out of it.
  const c = BIKES[Math.floor(hash2(seed, 1) * BIKES.length)];
  const wr = 0.32;
  const px = x + ax * 0.5;
  const pz = z + az * 0.5;
  const qx = x - ax * 0.5;
  const qz = z - az * 0.5;
  disc2(b, px, y + wr, pz, nx, nz, wr, 8, 0x2c2a3c, 0x2c2a3c);
  disc2(b, qx, y + wr, qz, nx, nz, wr, 8, 0x2c2a3c, 0x2c2a3c);
  b.beam(px, y + wr, pz, x, y + 0.8, z, 0.03, c);
  b.beam(qx, y + wr, qz, x, y + 0.8, z, 0.03, c);
  b.beam(px, y + wr, pz, px - ax * 0.05, y + 0.95, pz - az * 0.05, 0.03, c);
  b.beam(px - ax * 0.15 - nx * 0.25, y + 0.95, pz - az * 0.15 - nz * 0.25, px - ax * 0.15 + nx * 0.25, y + 0.95, pz - az * 0.15 + nz * 0.25, 0.025, 0x2c2a3c);
}

function cat(b: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const c = CAT[Math.floor(hash2(seed, 1) * CAT.length)];
  const a = hash2(seed, 2) * 6.283;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  // Sitting loaf, head, tail curled flat.
  b.box(x, y + 0.11, z, 0.12, 0.11, 0.2, cs, sn, c);
  const hx = x - sn * 0.18;
  const hz = z + cs * 0.18;
  b.box(hx, y + 0.27, hz, 0.08, 0.07, 0.07, cs, sn, c);
  b.beam(x + sn * 0.2, y + 0.03, z - cs * 0.2, x + sn * 0.2 + cs * 0.22, y + 0.03, z - cs * 0.2 + sn * 0.22, 0.025, c);
}

function antenna(b: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const h = 1.6 + hash2(seed, 1);
  b.beam(x, y, z, x, y + h, z, 0.03, 0x4d4757);
  const a = hash2(seed, 2) * 3.14;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  for (let k = 0; k < 2; k++) {
    const yy = y + h - 0.15 - k * 0.3;
    const l = 0.5 - k * 0.1;
    b.beam(x - cs * l, yy, z - sn * l, x + cs * l, yy, z + sn * l, 0.02, 0x4d4757);
  }
}

function dishProp(b: MeshBuilder, x: number, y: number, z: number, nx: number, nz: number): void {
  b.beam(x, y, z, x, y + 0.5, z, 0.03, 0x4d4757);
  disc2(b, x + nx * 0.05, y + 0.6, z + nz * 0.05, nx, nz, 0.32, 8, INK.white, 0xcfc8bb);
}

function buoy(b: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const c = hash2(seed, 1) < 0.5 ? INK.mango : INK.pink;
  prism(b, x, z, 0.3, y, y + 0.25, 6, c, INK.white);
  prism(b, x, z, 0.3, y + 0.25, y + 0.45, 6, INK.white, c);
}

function net(b: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const a = hash2(seed, 1) * 3;
  b.box(x, y + 0.18, z, 0.7, 0.18, 0.5, Math.cos(a), Math.sin(a), 0x2b8f87, { top: 0x63c9be });
  b.box(x + 0.3, y + 0.42, z, 0.35, 0.08, 0.3, Math.cos(a), Math.sin(a), 0x2b8f87, { top: INK.mango });
}

function crates(b: MeshBuilder, x: number, y: number, z: number, nx: number, nz: number, seed: number): void {
  const n = 2 + Math.floor(hash2(seed, 1) * 2);
  const ax = -nz;
  const az = nx;
  const goods = [INK.mango, INK.pink, INK.leaf, INK.teal, 0xffd27a, INK.brick];
  for (let k = 0; k < n; k++) {
    const u = (k - (n - 1) / 2) * 0.62;
    const cx = x + ax * u;
    const cz = z + az * u;
    b.box(cx, y + 0.2, cz, 0.28, 0.2, 0.22, ax, az, 0xc98a55, { top: goods[Math.floor(hash2(seed, k + 2) * goods.length)] });
    if (k === 0 && hash2(seed, 9) < 0.6) b.box(cx, y + 0.55, cz, 0.24, 0.15, 0.2, ax, az, 0xa9683a, { top: goods[(k + 3) % goods.length] });
  }
}

/** A balcony planter on a face at height y. */
function planter(b: MeshBuilder, f: Face, u: number, y: number, seed: number): void {
  // A box of flowers: the pot's ink on its sides, leaves and a pink bloom on top.
  fbox(b, f, u, y, 0.45, 0.16, 0.3, 0, POTS[Math.floor(hash2(seed, 1) * POTS.length)], 0, hash2(seed, 2) < 0.5 ? INK.pink : LEAF[0]);
}

/** Props belonging to one solid. */
export function meshSolidProps(b: MeshBuilder, w: World, ctx: RouteCtx, o: Solid): void {
  const d = districtAt(w, o.cz);
  const seed = o.index * 7741 + 3;
  switch (o.kind) {
    case 'building':
    case 'house': {
      const faces = solidFaces(o);
      let planted = false;
      for (let fi = 0; fi < 4; fi++) {
        const f = faces[fi];
        if (f.hw < 2 || !streetSide(w, f)) continue;
        const h = hash2(seed, fi);
        const g = faceGround(w, f);
        // Pots by the door, one each side.
        if (h < 0.55) {
          for (const s of [-1, 1]) {
            const u = s * Math.min(f.hw - 0.5, 1.1) + (hash2(seed, fi + 4) - 0.5) * 0.6;
            const x = fx(f, u, 0.4);
            const z = fz(f, u, 0.4);
            if (clearForFigure(w, ctx, x, z) && onGround(w, x, z)) pot(b, x, terrainHeight(w, x, z), z, seed + fi * 3 + s);
          }
        } else if (h < 0.75) {
          const u = (hash2(seed, fi + 8) - 0.5) * (f.hw * 2 - 2);
          const x = fx(f, u, 0.32);
          const z = fz(f, u, 0.32);
          if (clearForFigure(w, ctx, x, z) && onGround(w, x, z)) bike(b, x, terrainHeight(w, x, z), z, f.rx, f.rz, f.nx, f.nz, seed + fi);
        }
        // Balcony planters up the facade.
        const top = o.yTop - g.hi;
        if (top > 5 && !planted && hash2(seed, fi + 12) < 0.7) {
          planted = true;
          const n = Math.min(2, Math.floor(f.hw / 2));
          for (let k = 0; k < n; k++) planter(b, f, n === 1 ? 0 : (k - 0.5) * (f.hw - 1.2), g.hi + 3.3, seed + k * 5 + fi);
        }
      }
      // Up on the roof: a cat (Mercado, Terraces), antennas and dishes up the hill. All within the
      // roof's edge band, so roofs stay skateable.
      const ex = Math.max(0, o.hx - 0.3);
      const ez = Math.max(0, o.hz - 0.3);
      const corner = Math.floor(hash2(seed, 20) * 4);
      const sx = corner & 1 ? 1 : -1;
      const sz = corner & 2 ? 1 : -1;
      const rx = lx2x(o, sx * ex, sz * ez * 0.4);
      const rz = lx2z(o, sx * ex, sz * ez * 0.4);
      if ((d === District.MERCADO || d === District.TERRACES) && hash2(seed, 21) < 0.18) cat(b, rx, o.yTop, rz, seed);
      if ((d === District.TERRACES || d === District.ANTENNA) && hash2(seed, 22) < 0.55) {
        const ax = lx2x(o, -sx * ex, -sz * ez);
        const az = lx2z(o, -sx * ex, -sz * ez);
        if (hash2(seed, 23) < 0.5) antenna(b, ax, o.yTop, az, seed);
        else dishProp(b, ax, o.yTop, az, o.cosR * -sx, o.sinR * -sx);
      }
      break;
    }
    case 'stall':
    case 'kiosk': {
      // Crates and baskets of goods stacked beside the stall.
      const faces = solidFaces(o);
      for (let fi = 0; fi < 4; fi++) {
        const f = faces[fi];
        if (f.hw > 1.6 || hash2(seed, fi) > 0.7) continue;
        const x = fx(f, 0, 0.45);
        const z = fz(f, 0, 0.45);
        if (clearForFigure(w, ctx, x, z) && onGround(w, x, z)) crates(b, x, terrainHeight(w, x, z), z, f.nx, f.nz, seed + fi);
      }
      break;
    }
    case 'warehouse':
    case 'quay':
    case 'container': {
      // Buoys and net piles at the docks, along the long sides.
      const faces = solidFaces(o);
      for (let fi = 0; fi < 4; fi++) {
        const f = faces[fi];
        if (f.hw < 3 || hash2(seed, fi + 2) > 0.5) continue;
        const n = 1 + Math.floor(hash2(seed, fi + 6) * 3);
        for (let k = 0; k < n; k++) {
          const u = (hash2(seed, fi * 8 + k) - 0.5) * (f.hw * 2 - 2);
          const x = fx(f, u, 0.8);
          const z = fz(f, u, 0.8);
          if (!clearForFigure(w, ctx, x, z) || !onGround(w, x, z)) continue;
          const y = terrainHeight(w, x, z);
          if (hash2(seed, fi * 8 + k + 50) < 0.5) buoy(b, x, y, z, seed + k);
          else net(b, x, y, z, seed + k);
        }
      }
      break;
    }
    default:
      break;
  }
}

const BUNTING_INKS: Record<District, readonly number[]> = {
  [District.DOCKS]: [INK.teal, INK.mango, INK.paper],
  [District.MERCADO]: [INK.pink, INK.mango, INK.teal, INK.paper, INK.cobalt],
  [District.TERRACES]: [INK.mango, INK.cobalt, INK.paper, INK.pink],
  [District.ANTENNA]: [INK.cobalt, INK.pink, INK.paper],
};

/**
 * Bunting across the stair streets: at the top of each flight that falls along z, and every
 * eighth row down it, a string of flags and bulbs across the street 5 m up. Rows are independent.
 */
export function meshBuntingRow(b: MeshBuilder, w: World, ix0: number, ix1: number, iz: number): void {
  const c = w.cell;
  const z = w.minZ + (iz + 0.5) * c;
  const d = districtAt(w, z);
  if (d === District.ANTENNA) return;
  let ix = ix0;
  while (ix < ix1) {
    if (w.surfaces[iz * w.nx + ix] !== Surface.STAIRS) {
      ix++;
      continue;
    }
    let a = ix;
    while (a > 0 && w.surfaces[iz * w.nx + a - 1] === Surface.STAIRS) a--;
    let e = ix + 1;
    while (e < w.nx && w.surfaces[iz * w.nx + e] === Surface.STAIRS) e++;
    // Each run is handled by the chunk holding its first cell.
    if (a < ix0 && ix === ix0) {
      ix = e;
      continue;
    }
    const width = e - a;
    let f0 = iz;
    while (f0 > 0 && w.surfaces[(f0 - 1) * w.nx + a] === Surface.STAIRS) f0--;
    const every = d === District.MERCADO ? 6 : 10;
    if (width >= 2 && width <= 6 && (iz - f0) % every === 0) {
      const x0 = w.minX + a * c - 0.3;
      const x1 = w.minX + e * c + 0.3;
      const y0 = Math.max(terrainHeight(w, x0 + 0.4, z), terrainHeight(w, x1 - 0.4, z)) + 5;
      bunting(b, x0, x1, z, y0, BUNTING_INKS[d], iz * 31 + a);
    }
    ix = e;
  }
}

function bunting(b: MeshBuilder, x0: number, x1: number, z: number, y: number, inks: readonly number[], seed: number): void {
  // The string in four sagging spans; flags printed both sides hang from it, a lit bulb between
  // every other pair.
  const sag = 0.45;
  const yAt = (t: number): number => y - sag * 4 * t * (1 - t);
  for (let k = 0; k < 4; k++) b.beam(x0 + ((x1 - x0) * k) / 4, yAt(k / 4), z, x0 + ((x1 - x0) * (k + 1)) / 4, yAt((k + 1) / 4), z, 0.015, 0x2c2a3c);
  const n = Math.max(4, Math.round((x1 - x0) / 0.6));
  for (let k = 0; k < n; k++) {
    const t0 = (k + 0.1) / n;
    const t1 = (k + 0.9) / n;
    const xa = x0 + (x1 - x0) * t0;
    const xb = x0 + (x1 - x0) * t1;
    const col = inks[(k + seed) % inks.length];
    const p0 = b.vert(xa, yAt(t0), z, col);
    const p1 = b.vert(xb, yAt(t1), z, col);
    const p2 = b.vert((xa + xb) / 2, yAt((t0 + t1) / 2) - 0.4, z, col);
    b.tri(p0, p1, p2);
    b.tri(p0, p2, p1);
    if ((k & 1) === 1) {
      const xm = x0 + ((x1 - x0) * k) / n;
      const ym = yAt(k / n) - 0.02;
      const q0 = b.vert(xm - 0.07, ym, z, 0xffe3a0, 1);
      const q1 = b.vert(xm + 0.07, ym, z, 0xffe3a0, 1);
      const q2 = b.vert(xm, ym - 0.14, z, 0xffe3a0, 1);
      b.tri(q0, q1, q2);
      b.tri(q0, q2, q1);
    }
  }
}
