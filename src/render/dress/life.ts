/**
 * Printed life on the ground (brief M7b): plaza tiles by district, two-colour stair flights, zebra
 * crossings where stair streets cross the road, manhole covers and drain grates, tile motifs,
 * chalk hopscotch and arrows, and at the docks painted bays, bay numbers and coloured patches.
 *
 * Everything is decoration: paint lies within PAINT_LIFT of the ground (the tile colours are the
 * ground cells' own colours, so they cost no triangles), it is deterministic from cell indices
 * (`hash2`), and rows are independent so a chunk can be painted a row at a time.
 */
import { District, Surface, districtAt, terrainHeight, type World } from '../../sim/world';
import { type MeshBuilder, hash2 } from '../geom';
import { INK } from '../look';

/** Paint lift for printed pattern; kept a little under the kerb and dash lift so lines win. */
const LIFT_LO = 0.014;
const LIFT_HI = 0.024;

/** Plaza tiles by district: two field tones and an accent tile (near), and their mix (far). */
interface Tiles {
  a: number;
  b: number;
  accent: number;
  far: number;
  /** Motif ink printed at block centres, and a second for alternate blocks. */
  motif: number;
  motif2: number;
}

const TILES: Record<District, Tiles> = {
  // Docks: big weathered slabs of two concretes, with painted bays on top.
  [District.DOCKS]: { a: 0xc9c0ad, b: 0xe6dfd1, accent: 0x9fd3c9, far: 0xd6cebd, motif: INK.mango, motif2: INK.teal },
  // Mercado: terracotta and paper checks, pink accent tiles, mango and teal diamonds.
  [District.MERCADO]: { a: 0xefb08a, b: 0xf3e4cf, accent: 0xf7b3cb, far: 0xf0c9ab, motif: INK.pink, motif2: INK.teal },
  // Terraces: azulejo blues on paper, cobalt and mango motifs.
  [District.TERRACES]: { a: 0xc9d3f3, b: 0xf1ede4, accent: 0xffd890, far: 0xdfe0ec, motif: INK.cobalt, motif2: INK.mango },
  // Antenna Hill: pink gravel and pale slabs, cobalt marks.
  [District.ANTENNA]: { a: 0xe6cfd3, b: 0xdcd6cd, accent: 0xb9c4f0, far: 0xe0d2cf, motif: INK.cobalt, motif2: INK.pink },
};

function districtOfRow(w: World, iz: number): District {
  return districtAt(w, w.minZ + (iz + 0.5) * w.cell);
}

/** Ink of a plaza cell: tiles near, their mix far (so far ground still merges into long quads). */
export function plazaInk(w: World, ix: number, iz: number, near: boolean): number {
  const t = TILES[districtOfRow(w, iz)];
  if (!near) return t.far;
  // Docks slabs are two cells big; the town's tiles one cell, in checks with scattered accents.
  const big = districtOfRow(w, iz) === District.DOCKS;
  const bx = big ? ix >> 1 : ix;
  const bz = big ? iz >> 1 : iz;
  if (hash2(bx * 7 + 3, bz * 11 + 5) < 0.1) return t.accent;
  return ((bx + bz) & 1) === 0 ? t.a : t.b;
}

/** Two-colour rhythms for stair flights, by district: [tread A, tread B] pairs. */
const FLIGHTS: Record<District, readonly (readonly [number, number])[]> = {
  [District.DOCKS]: [
    [0x4fc1b5, INK.paper],
    [0xffbf4d, INK.paper],
    [0x4fc1b5, 0xffd890],
  ],
  [District.MERCADO]: [
    [0xff6fa8, INK.paper],
    [0xffbf4d, INK.paper],
    [0x4fc1b5, INK.paper],
    [0xff6fa8, 0xffd890],
    [0xffbf4d, 0xf7b3cb],
  ],
  [District.TERRACES]: [
    [0x7d93ec, INK.paper],
    [0xffbf4d, INK.paper],
    [0x7d93ec, 0xffd890],
  ],
  [District.ANTENNA]: [
    [0x7d93ec, INK.paper],
    [0xff8fb8, INK.paper],
    [0x7d93ec, 0xf7b3cb],
  ],
};

/**
 * The two tread inks of the flight a stair cell belongs to: the flight is keyed by its extent
 * across the stair street and along it, so each flight keeps its own rhythm from top to bottom.
 */
export function flightInks(w: World, a0: number, a1: number, f0: number, iz: number, out: [number, number]): void {
  const set = FLIGHTS[districtOfRow(w, iz)];
  const pair = set[Math.floor(hash2(a0 * 31 + a1 * 7 + 1, f0 * 13 + 9) * set.length)];
  out[0] = pair[0];
  out[1] = pair[1];
}

// ---------------------------------------------------------------------------------------------
// Paint helpers

/** An axis-aligned printed rectangle on the ground, one quad facing up. */
function rect(b: MeshBuilder, w: World, x0: number, z0: number, x1: number, z1: number, lift: number, color: number, glow = 0): void {
  // (x0,z0) -> (x0,z1) -> (x1,z1) -> (x1,z0) is counter-clockwise seen from above.
  b.quad(
    x0, terrainHeight(w, x0, z0) + lift, z0,
    x0, terrainHeight(w, x0, z1) + lift, z1,
    x1, terrainHeight(w, x1, z1) + lift, z1,
    x1, terrainHeight(w, x1, z0) + lift, z0,
    color, glow,
  );
}

/** A printed quad on the ground centred at (cx, cz) with half-axes u and v (v = u turned left). */
function quadUV(b: MeshBuilder, w: World, cx: number, cz: number, ux: number, uz: number, vx: number, vz: number, lift: number, color: number): void {
  const ax = cx - ux - vx;
  const az = cz - uz - vz;
  const bx = cx + ux - vx;
  const bz = cz + uz - vz;
  const qx = cx + ux + vx;
  const qz = cz + uz + vz;
  const dx = cx - ux + vx;
  const dz = cz - uz + vz;
  // Upward winding: the cross product of (b - a) and (d - a) must point up (y = dz*ex - dx*ez > 0).
  const cy = (dz - az) * (bx - ax) - (dx - ax) * (bz - az);
  const h = (x: number, z: number): number => terrainHeight(w, x, z) + lift;
  if (cy > 0) b.quad(ax, h(ax, az), az, dx, h(dx, dz), dz, qx, h(qx, qz), qz, bx, h(bx, bz), bz, color);
  else b.quad(ax, h(ax, az), az, bx, h(bx, bz), bz, qx, h(qx, qz), qz, dx, h(dx, dz), dz, color);
}

/** A printed disc on the ground. */
function disc(b: MeshBuilder, w: World, cx: number, cz: number, r: number, sides: number, lift: number, color: number): void {
  const c = b.vert(cx, terrainHeight(w, cx, cz) + lift, cz, color);
  let first = -1;
  let prev = -1;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz - Math.sin(a) * r;
    const v = b.vert(x, terrainHeight(w, x, z) + lift, z, color);
    // Angle runs clockwise seen from above (z flipped), so c, v, prev is counter-clockwise from above.
    if (prev >= 0) b.tri(c, prev, v);
    else first = v;
    prev = v;
  }
  b.tri(c, prev, first);
}

/** A printed arrow pointing along (dx, dz) (unit), `len` long. */
function arrow(b: MeshBuilder, w: World, cx: number, cz: number, dx: number, dz: number, len: number, half: number, lift: number, color: number): void {
  const px = -dz;
  const pz = dx;
  // Shaft.
  quadUV(b, w, cx - dx * len * 0.15, cz - dz * len * 0.15, dx * len * 0.35, dz * len * 0.35, px * half, pz * half, lift, color);
  // Head.
  const tx = cx + dx * len * 0.5;
  const tz = cz + dz * len * 0.5;
  const hx = cx + dx * len * 0.18;
  const hz = cz + dz * len * 0.18;
  const h = (x: number, z: number): number => terrainHeight(w, x, z) + lift;
  const lx = hx + px * half * 3;
  const lz = hz + pz * half * 3;
  const rx = hx - px * half * 3;
  const rz = hz - pz * half * 3;
  const v0 = b.vert(tx, h(tx, tz), tz, color);
  const v1 = b.vert(lx, h(lx, lz), lz, color);
  const v2 = b.vert(rx, h(rx, rz), rz, color);
  const cy = (lz - tz) * (rx - tx) - (lx - tx) * (rz - tz);
  if (cy > 0) b.tri(v0, v2, v1);
  else b.tri(v0, v1, v2);
}

/** Seven-segment digit printed flat on the ground, reading toward -z (uphill viewers see it). */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
function groundDigit(b: MeshBuilder, w: World, d: number, x: number, z: number, h: number, lift: number, color: number): void {
  // Read from the downhill side looking up (+z is the top of the digit).
  const wd = h * 0.55;
  const t = h * 0.16;
  const bits = SEG[d];
  const x0 = x;
  const x1 = x + wd;
  const zm = z + h / 2;
  const z1 = z + h;
  if (bits & 1) rect(b, w, x0, z1 - t, x1, z1, lift, color);
  if (bits & 2) rect(b, w, x1 - t, zm, x1, z1, lift, color);
  if (bits & 4) rect(b, w, x1 - t, z, x1, zm, lift, color);
  if (bits & 8) rect(b, w, x0, z, x1, z + t, lift, color);
  if (bits & 16) rect(b, w, x0, z, x0 + t, zm, lift, color);
  if (bits & 32) rect(b, w, x0, zm, x0 + t, z1, lift, color);
  if (bits & 64) rect(b, w, x0, zm - t / 2, x1, zm + t / 2, lift, color);
}

function surfaceAt(w: World, ix: number, iz: number): number {
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return -1;
  return w.surfaces[iz * w.nx + ix];
}

/** Length of the run of `s` cells from (ix, iz) stepping (dx, dz), not counting the start; stops at `max`. */
function runLen(w: World, ix: number, iz: number, dx: number, dz: number, s: number, max: number): number {
  let n = 0;
  while (n < max && surfaceAt(w, ix + dx * (n + 1), iz + dz * (n + 1)) === s) n++;
  return n;
}

const ZEBRA = 0xf6f0e3;
const MANHOLE = 0x4a4656;
const MANHOLE_RIM = 0x6a6575;
const GRATE = 0x3a3748;
const CHALK = 0xfbf6ec;
const CHALK_PINK = 0xff9fc3;
const CHALK_BLUE = 0x9fb0f0;
const BAY_LINE = 0xffc23d;

/**
 * Printed life for cells [ix0, ix1) x [iz0, iz1), near only. Rows are independent: painting rows
 * one call at a time gives exactly the geometry of one call.
 */
export function meshLifePaint(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number): void {
  const c = w.cell;
  for (let iz = iz0; iz < iz1; iz++) {
    const district = districtOfRow(w, iz);
    const tiles = TILES[district];
    for (let ix = ix0; ix < ix1; ix++) {
      const s = w.surfaces[iz * w.nx + ix];
      const x0 = w.minX + ix * c;
      const z0 = w.minZ + iz * c;
      const hh = hash2(ix * 13 + 7, iz * 17 + 3);
      if (s === Surface.STREET) {
        // Zebra crossing: a short street run between stair cells (a stair street crossing a road).
        const up = runLen(w, ix, iz, 0, 1, Surface.STREET, 8);
        const dn = runLen(w, ix, iz, 0, -1, Surface.STREET, 8);
        // A crossing has the stair street on both sides of a road at most five cells across.
        const crossZ = up + dn + 1 <= 5 && surfaceAt(w, ix, iz + up + 1) === Surface.STAIRS && surfaceAt(w, ix, iz - dn - 1) === Surface.STAIRS;
        const rt = runLen(w, ix, iz, 1, 0, Surface.STREET, 8);
        const lf = runLen(w, ix, iz, -1, 0, Surface.STREET, 8);
        const crossX = !crossZ && rt + lf + 1 <= 5 && surfaceAt(w, ix + rt + 1, iz) === Surface.STAIRS && surfaceAt(w, ix - lf - 1, iz) === Surface.STAIRS;
        if (crossZ) {
          // Bars run along the crossing (z), side by side across x.
          for (let k = 0; k < 3; k++) rect(b, w, x0 + 0.2 + k, z0 + 0.12, x0 + 0.75 + k, z0 + c - 0.12, LIFT_HI, ZEBRA);
          continue;
        }
        if (crossX) {
          for (let k = 0; k < 3; k++) rect(b, w, x0 + 0.12, z0 + 0.2 + k, x0 + c - 0.12, z0 + 0.75 + k, LIFT_HI, ZEBRA);
          continue;
        }
        if (hh < 0.035) {
          // Manhole cover: rim and lid.
          disc(b, w, x0 + c * 0.5, z0 + c * 0.5, 0.42, 8, LIFT_LO, MANHOLE_RIM);
          disc(b, w, x0 + c * 0.5, z0 + c * 0.5, 0.3, 8, LIFT_HI, MANHOLE);
        } else if (hh < 0.2) {
          // Drain grate at the kerb.
          const k = Math.floor(hh * 1000) & 3;
          const nx = k === 0 ? -1 : k === 1 ? 1 : 0;
          const nz = k === 2 ? -1 : k === 3 ? 1 : 0;
          if (surfaceAt(w, ix + nx, iz + nz) === Surface.PLAZA) {
            const gx = x0 + c * 0.5 + nx * (c * 0.5 - 0.35);
            const gz = z0 + c * 0.5 + nz * (c * 0.5 - 0.35);
            const ax = nx === 0 ? 0.45 : 0.22;
            const az = nz === 0 ? 0.45 : 0.22;
            rect(b, w, gx - ax, gz - az, gx + ax, gz + az, LIFT_HI, GRATE);
          }
        }
      } else if (s === Surface.PLAZA) {
        plazaCell(b, w, ix, iz, x0, z0, district, tiles, hh);
      }
    }
  }
}

function plazaCell(b: MeshBuilder, w: World, ix: number, iz: number, x0: number, z0: number, district: District, t: Tiles, hh: number): void {
  const c = w.cell;
  // Only fully paved neighbourhoods get motifs (no paint spilling onto a kerb or a stair).
  const paved = surfaceAt(w, ix + 1, iz) === Surface.PLAZA && surfaceAt(w, ix, iz + 1) === Surface.PLAZA && surfaceAt(w, ix + 1, iz + 1) === Surface.PLAZA;
  switch (district) {
    case District.MERCADO:
    case District.TERRACES: {
      // A diamond at every other corner shared by four tiles, in two inks.
      if (paved && ((ix + iz) & 1) === 0) {
        const r = 0.42;
        const ink = ((ix >> 1) + iz) % 3 === 0 ? t.motif2 : t.motif;
        quadUV(b, w, x0 + c, z0 + c, r * 0.7, r * 0.7, -r * 0.7, r * 0.7, LIFT_LO, ink);
      }
      if (hh > 0.985 && paved) hopscotch(b, w, x0 + c * 0.5, z0 + c * 0.5, ix + iz);
      else if (hh > 0.97 && hh <= 0.985) {
        const a = hh * 600;
        arrow(b, w, x0 + c * 0.5, z0 + c * 0.5, Math.cos(a), Math.sin(a), 1.4, 0.07, LIFT_HI, (ix & 1) === 0 ? CHALK : CHALK_PINK);
      }
      break;
    }
    case District.DOCKS: {
      // Painted bays: a lane line every four cells along x, with the bay's number at its foot;
      // a coloured patch in some blocks, hazard stripes round others.
      if ((ix & 3) === 0) {
        rect(b, w, x0 - 0.09, z0 + 0.05, x0 + 0.09, z0 + c - 0.05, LIFT_HI, BAY_LINE);
        if ((iz & 7) === 0) {
          const n = ((ix >> 2) * 7 + (iz >> 3)) % 100;
          const d1 = Math.floor(n / 10);
          groundDigit(b, w, d1, x0 + 0.5, z0 + 0.6, 1.4, LIFT_HI, INK.paper);
          groundDigit(b, w, n % 10, x0 + 1.5, z0 + 0.6, 1.4, LIFT_HI, INK.paper);
        }
      }
      const bx = ix >> 2;
      const bz = iz >> 2;
      const hb = hash2(bx * 19 + 1, bz * 23 + 7);
      if (hb < 0.22 && paved) {
        // Flat patch of colour over the whole block, a cell at a time.
        rect(b, w, x0 + 0.02, z0 + 0.02, x0 + c - 0.02, z0 + c - 0.02, LIFT_LO, hb < 0.11 ? 0x7fcabf : 0xffd27a);
      } else if (hb > 0.88 && (iz & 3) === 0) {
        // Hazard stripes along the block's lower edge.
        for (let k = 0; k < 4; k++) {
          const xa = x0 + k * 0.75;
          quadUV(b, w, xa + 0.375, z0 + 0.35, 0.3, 0.12, -0.12, 0.3, LIFT_LO, (k & 1) === 0 ? INK.mango : INK.ink);
        }
      }
      break;
    }
    case District.ANTENNA: {
      if (paved && (ix & 1) === 1 && (iz & 1) === 1 && hh < 0.5) {
        quadUV(b, w, x0 + c, z0 + c, 0.4, 0, 0, 0.4, LIFT_LO, t.motif);
      }
      break;
    }
  }
}

/** Chalk hopscotch: single, single, double, single, double, half-moon, along +z from (x, z). */
function hopscotch(b: MeshBuilder, w: World, x: number, z: number, seed: number): void {
  const s = 0.42;
  const layout: [number, number][] = [[0, 0], [0, 1], [-0.5, 2], [0.5, 2], [0, 3], [-0.5, 4], [0.5, 4]];
  for (let i = 0; i < layout.length; i++) {
    const [u, v] = layout[i];
    const cx = x + u * s * 2;
    const cz = z - 1.2 + v * s * 2;
    rect(b, w, cx - s * 0.85, cz - s * 0.85, cx + s * 0.85, cz + s * 0.85, LIFT_HI, (i + seed) % 3 === 0 ? CHALK_PINK : (i + seed) % 3 === 1 ? CHALK : CHALK_BLUE);
  }
}

/** Lane arrows and stop boxes along a ground ride's path, for the part of it inside [x0,x1) x [z0,z1). */
export function meshLanePaint(b: MeshBuilder, w: World, li: number, x0: number, z0: number, x1: number, z1: number): void {
  const line = w.lines[li];
  if (line.overhead || line.bodyHalfLen <= 0) return;
  if (line.maxX < x0 || line.minX > x1 || line.maxZ < z0 || line.minZ > z1) return;
  const pts = line.pathPts;
  const n = pts.length / 3;
  const half = line.bodyHalfWid;
  const off = Math.max(1.2, half + 0.2);
  // Arrows every ARROW_GAP metres of path, on the travel side; a shuttle gets the return side too.
  const ARROW_GAP = 21;
  let next = ARROW_GAP * 0.5;
  for (let i = 1; i < n; i++) {
    const ax = pts[(i - 1) * 3];
    const az = pts[(i - 1) * 3 + 2];
    const bx = pts[i * 3];
    const bz = pts[i * 3 + 2];
    const s0 = line.cum[i - 1];
    const s1 = line.cum[i];
    const segLen = s1 - s0;
    if (segLen < 1e-6) continue;
    while (next <= s1) {
      const t = (next - s0) / segLen;
      next += ARROW_GAP;
      const dx = (bx - ax) / segLen;
      const dz = (bz - az) / segLen;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
      const hlen = Math.hypot(dx, dz);
      if (hlen < 0.5) continue;
      const ux = dx / hlen;
      const uz = dz / hlen;
      // Right of travel: (uz, -ux).
      const rx = px + uz * off;
      const rz = pz - ux * off;
      if (onStreet(w, rx, rz)) arrow(b, w, rx, rz, ux, uz, 2.4, 0.12, LIFT_HI, INK.paper);
      if (!line.loop) {
        const qx = px - uz * off;
        const qz = pz + ux * off;
        if (onStreet(w, qx, qz)) arrow(b, w, qx, qz, -ux, -uz, 2.4, 0.12, LIFT_HI, INK.paper);
      }
    }
  }
  // Stop boxes: a mango outline on the street at each stop.
  for (const st of line.allStops) {
    const s = st.s;
    let i = 1;
    while (i < n - 1 && line.cum[i] < s) i++;
    const s0 = line.cum[i - 1];
    const seg = Math.max(1e-6, line.cum[i] - s0);
    const t = Math.min(1, Math.max(0, (s - s0) / seg));
    const ax = pts[(i - 1) * 3];
    const az = pts[(i - 1) * 3 + 2];
    const bx = pts[i * 3];
    const bz = pts[i * 3 + 2];
    const px = ax + (bx - ax) * t;
    const pz = az + (bz - az) * t;
    if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
    const hl = Math.hypot(bx - ax, bz - az);
    if (hl < 1e-6 || !onStreet(w, px, pz)) continue;
    const ux = (bx - ax) / hl;
    const uz = (bz - az) / hl;
    const L = Math.max(3, line.bodyHalfLen + 1);
    const W = half + 0.5;
    const ink = 0xffc23d;
    // Four bars of the box, and a band of diagonal hatching at the front.
    quadUV(b, w, px + ux * L, pz + uz * L, ux * 0.12, uz * 0.12, -uz * W, ux * W, LIFT_HI, ink);
    quadUV(b, w, px - ux * L, pz - uz * L, ux * 0.12, uz * 0.12, -uz * W, ux * W, LIFT_HI, ink);
    quadUV(b, w, px + uz * W, pz - ux * W, ux * L, uz * L, -uz * 0.12, ux * 0.12, LIFT_HI, ink);
    quadUV(b, w, px - uz * W, pz + ux * W, ux * L, uz * L, -uz * 0.12, ux * 0.12, LIFT_HI, ink);
  }
}

function onStreet(w: World, x: number, z: number): boolean {
  if (x < w.minX || z < w.minZ || x >= w.maxX || z >= w.maxZ) return false;
  const ix = Math.floor((x - w.minX) / w.cell);
  const iz = Math.floor((z - w.minZ) / w.cell);
  return w.surfaces[iz * w.nx + ix] === Surface.STREET;
}
