/**
 * Ground: the heightfield cells exactly as the sim splits them (never moved), per-surface inks with
 * per-patch variation, and painted decoration that stays within 3 cm of the ground (stair treads
 * within 12 cm): centre dashes, kerb lines, tram rails, treads, grass tufts, quay hazard paint.
 */
import { Surface, terrainHeight, vertexHeight, type World } from '../../sim/world';
import { type MeshBuilder, hash2, shade } from '../geom';
import { INK } from '../look';

const SURFACE_COLOR: Record<number, number> = {
  [Surface.STREET]: INK.asphalt,
  [Surface.PLAZA]: INK.concrete,
  [Surface.STAIRS]: INK.curb,
  [Surface.DIRT]: INK.sand,
  [Surface.GRASS]: INK.leaf,
  [Surface.TRACK]: 0x6f6a78,
  [Surface.WATER]: 0x0fa6b4,
  [Surface.ROOF]: INK.concrete,
  [Surface.AWNING]: INK.pink,
};

export function surfaceColor(surface: number): number {
  return SURFACE_COLOR[surface] ?? INK.concrete;
}

/** Paint sits this far above the ground: enough to beat depth fighting, under the 3 cm rule. */
export const PAINT_LIFT = 0.025;
/** Stair treads may stand this far proud of the stair ramp. */
export const TREAD_MAX = 0.12;

function surfaceAt(w: World, ix: number, iz: number): number {
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return -1;
  return w.surfaces[iz * w.nx + ix];
}

/** Ink of one cell: the surface colour with a little per-patch variation (near only). */
function cellColor(w: World, ix: number, iz: number, surface: number, varied: boolean): number {
  const base = surfaceColor(surface);
  if (surface === Surface.STAIRS) return shade(base, (iz & 1) === 0 ? 1.03 : 0.9);
  if (surface === Surface.WATER || !varied) return base;
  switch (surface) {
    case Surface.PLAZA:
      // Big paving patches, a checker of two tones.
      return shade(base, ((ix >> 1) + (iz >> 1)) & 1 ? 0.975 : 1.015 + 0.02 * hash2(ix >> 2, iz >> 2));
    case Surface.STREET:
      return shade(base, 0.97 + 0.05 * hash2(ix >> 2, iz >> 1));
    case Surface.GRASS:
      return shade(base, 0.92 + 0.12 * hash2(ix, iz));
    case Surface.DIRT:
      return shade(base, 0.94 + 0.08 * hash2(ix >> 1, iz));
    case Surface.TRACK:
      return shade(base, (iz & 1) === 0 ? 1 : 0.93);
    default:
      return shade(base, 0.985 + 0.03 * hash2(ix >> 1, iz >> 1));
  }
}

function emitCell(b: MeshBuilder, w: World, ix: number, iz: number, color: number): void {
  const x0 = w.minX + ix * w.cell;
  const z0 = w.minZ + iz * w.cell;
  const x1 = x0 + w.cell;
  const z1 = z0 + w.cell;
  const a = b.vert(x0, vertexHeight(w, ix, iz), z0, color);
  const c = b.vert(x1, vertexHeight(w, ix + 1, iz), z0, color);
  const d = b.vert(x1, vertexHeight(w, ix + 1, iz + 1), z1, color);
  const e = b.vert(x0, vertexHeight(w, ix, iz + 1), z1, color);
  // Split along (ix, iz)-(ix+1, iz+1), as the sim does.
  b.tri(a, d, c);
  b.tri(a, e, d);
}

function planar(w: World, ix: number, iz: number): boolean {
  const h00 = vertexHeight(w, ix, iz);
  const h10 = vertexHeight(w, ix + 1, iz);
  const h01 = vertexHeight(w, ix, iz + 1);
  const h11 = vertexHeight(w, ix + 1, iz + 1);
  return Math.abs(h00 + h11 - h10 - h01) < 1e-5;
}

/**
 * Heightfield cells [ix0, ix1) x [iz0, iz1). Near: one quad per cell with patch variation. Far:
 * runs of coplanar cells of one colour along each row merge into one quad, which is still exactly
 * the collision ground (every merged vertex lies on the same plane).
 */
export function meshGround(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number, far = false): void {
  for (let iz = iz0; iz < iz1; iz++) {
    let ix = ix0;
    while (ix < ix1) {
      const s = w.surfaces[iz * w.nx + ix];
      const color = cellColor(w, ix, iz, s, !far);
      if (!far || !planar(w, ix, iz)) {
        emitCell(b, w, ix, iz, color);
        ix++;
        continue;
      }
      const h00 = vertexHeight(w, ix, iz);
      const gx = vertexHeight(w, ix + 1, iz) - h00;
      const gz = vertexHeight(w, ix, iz + 1) - h00;
      let end = ix + 1;
      while (end < ix1) {
        if (cellColor(w, end, iz, w.surfaces[iz * w.nx + end], false) !== color) break;
        const k = end + 1 - ix;
        if (Math.abs(vertexHeight(w, end + 1, iz) - (h00 + gx * k)) > 1e-5) break;
        if (Math.abs(vertexHeight(w, end + 1, iz + 1) - (h00 + gx * k + gz)) > 1e-5) break;
        if (Math.abs(vertexHeight(w, end, iz + 1) - (h00 + gx * (k - 1) + gz)) > 1e-5) break;
        end++;
      }
      const x0 = w.minX + ix * w.cell;
      const z0 = w.minZ + iz * w.cell;
      const x1 = w.minX + end * w.cell;
      const z1 = z0 + w.cell;
      const a = b.vert(x0, h00, z0, color);
      const c = b.vert(x1, vertexHeight(w, end, iz), z0, color);
      const d = b.vert(x1, vertexHeight(w, end, iz + 1), z1, color);
      const e = b.vert(x0, vertexHeight(w, ix, iz + 1), z1, color);
      b.tri(a, d, c);
      b.tri(a, e, d);
      ix = end;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Decoration

/** Quad from four points, flipped if needed so it faces (wx, wy, wz). */
function facing(
  b: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
  wx: number, wy: number, wz: number,
  color: number,
  glow = 0,
): void {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  if (nx * wx + ny * wy + nz * wz >= 0) b.quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, glow);
  else b.quad(dx, dy, dz, cx, cy, cz, bx, by, bz, ax, ay, az, color, glow);
}

/** A flat painted strip on the ground from (x0, z0) to (x1, z1), `half` wide, in two pieces. */
function paint(b: MeshBuilder, w: World, x0: number, z0: number, x1: number, z1: number, half: number, color: number): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return;
  const sx = (dz / len) * half;
  const sz = (-dx / len) * half;
  for (let k = 0; k < 2; k++) {
    const ax = x0 + (dx * k) / 2;
    const az = z0 + (dz * k) / 2;
    const bx = x0 + (dx * (k + 1)) / 2;
    const bz = z0 + (dz * (k + 1)) / 2;
    const h = (x: number, z: number): number => terrainHeight(w, x, z) + PAINT_LIFT;
    facing(
      b,
      ax - sx, h(ax - sx, az - sz), az - sz,
      bx - sx, h(bx - sx, bz - sz), bz - sz,
      bx + sx, h(bx + sx, bz + sz), bz + sz,
      ax + sx, h(ax + sx, az + sz), az + sz,
      0, 1, 0,
      color,
    );
  }
}

interface Run {
  a: number;
  b: number;
}

/** Run of cells of `surface` through (ix, iz) along x (axis 0) or z (axis 1), inclusive-exclusive. */
function runAt(w: World, ix: number, iz: number, surface: number, axis: 0 | 1, out: Run): void {
  let a = axis === 0 ? ix : iz;
  let b2 = a + 1;
  if (axis === 0) {
    while (surfaceAt(w, a - 1, iz) === surface) a--;
    while (surfaceAt(w, b2, iz) === surface) b2++;
  } else {
    while (surfaceAt(w, ix, a - 1) === surface) a--;
    while (surfaceAt(w, ix, b2) === surface) b2++;
  }
  out.a = a;
  out.b = b2;
}

const DASH = INK.mango;
const KERB = 0xf1eadb;
const RAIL_INK = 0x2c2a3c;
const TIE_INK = 0x4d4757;
const TUFT = 0x2f8f5a;
const TREAD_A = 0xddd5c4;
const TREAD_B = 0xb3aa98;
const RISER = 0xa39b8c;

/** Decoration for cells [ix0, ix1) x [iz0, iz1). It never changes the ground by more than 3 cm (12 cm for treads). */
export function meshGroundDecor(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number): void {
  meshGroundPaint(b, w, ix0, iz0, ix1, iz1);
  meshStairTreads(b, w, ix0, iz0, ix1, iz1);
}

/**
 * The painted part of the decoration (street dashes, kerbs, track, tufts, quay hazard stripes).
 * Rows are independent: meshing rows one call at a time gives exactly the geometry of one call.
 */
export function meshGroundPaint(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number): void {
  const c = w.cell;
  const rx: Run = { a: 0, b: 0 };
  const rz: Run = { a: 0, b: 0 };
  for (let iz = iz0; iz < iz1; iz++) {
    for (let ix = ix0; ix < ix1; ix++) {
      const s = w.surfaces[iz * w.nx + ix];
      const x0 = w.minX + ix * c;
      const z0 = w.minZ + iz * c;
      if (s === Surface.STREET) {
        // Centre dashes: this cell is the middle of a 2-6 cell wide street running along z or x.
        runAt(w, ix, iz, Surface.STREET, 0, rx);
        runAt(w, ix, iz, Surface.STREET, 1, rz);
        const wx = rx.b - rx.a;
        const wz = rz.b - rz.a;
        if (wx >= 2 && wx <= 6 && wz > wx && (iz & 1) === 0) {
          const xc = w.minX + ((rx.a + rx.b) / 2) * c;
          if (xc >= x0 && xc < x0 + c) paint(b, w, xc, z0 + c * 0.2, xc, z0 + c * 0.8, 0.08, DASH);
        }
        if (wz >= 2 && wz <= 6 && wx > wz && (ix & 1) === 0) {
          const zc = w.minZ + ((rz.a + rz.b) / 2) * c;
          if (zc >= z0 && zc < z0 + c) paint(b, w, x0 + c * 0.2, zc, x0 + c * 0.8, zc, 0.08, DASH);
        }
        // Kerb lines where the street meets a plaza: painted on the plaza side of the shared edge.
        if (surfaceAt(w, ix - 1, iz) === Surface.PLAZA) paint(b, w, x0 - 0.16, z0, x0 - 0.16, z0 + c, 0.15, KERB);
        if (surfaceAt(w, ix + 1, iz) === Surface.PLAZA) paint(b, w, x0 + c + 0.16, z0, x0 + c + 0.16, z0 + c, 0.15, KERB);
        if (surfaceAt(w, ix, iz - 1) === Surface.PLAZA) paint(b, w, x0, z0 - 0.16, x0 + c, z0 - 0.16, 0.15, KERB);
        if (surfaceAt(w, ix, iz + 1) === Surface.PLAZA) paint(b, w, x0, z0 + c + 0.16, x0 + c, z0 + c + 0.16, 0.15, KERB);
      } else if (s === Surface.TRACK) {
        trackCell(b, w, ix, iz, rx, rz);
      } else if (s === Surface.GRASS) {
        const n = hash2(ix * 3 + 1, iz * 5 + 2) < 0.55 ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const tx = x0 + 0.4 + (c - 0.8) * hash2(ix + 17 * k, iz);
          const tz = z0 + 0.4 + (c - 0.8) * hash2(iz + 31 * k, ix);
          tuft(b, w, tx, tz, 0.22 + 0.15 * hash2(ix, iz + k));
        }
      }
      if (s !== Surface.WATER && s !== Surface.STAIRS) {
        // Hazard paint along a quay edge: mango and ink blocks, set back from the edge.
        const stripe = (ax: number, az: number, dx: number, dz: number, inx: number, inz: number): void => {
          const n = Math.max(2, Math.round(c / 0.75));
          for (let k = 0; k < n; k++) {
            const t0 = (k / n) * c;
            const t1 = ((k + 1) / n) * c;
            const off = 1.1;
            paint(b, w, ax + dx * t0 + inx * off, az + dz * t0 + inz * off, ax + dx * t1 + inx * off, az + dz * t1 + inz * off, 0.22, (k & 1) === 0 ? INK.mango : INK.ink);
          }
        };
        if (surfaceAt(w, ix, iz - 1) === Surface.WATER) stripe(x0, z0, 1, 0, 0, 1);
        if (surfaceAt(w, ix, iz + 1) === Surface.WATER) stripe(x0, z0 + c, 1, 0, 0, -1);
        if (surfaceAt(w, ix - 1, iz) === Surface.WATER) stripe(x0, z0, 0, 1, 1, 0);
        if (surfaceAt(w, ix + 1, iz) === Surface.WATER) stripe(x0 + c, z0, 0, 1, -1, 0);
      }
    }
  }
}

function tuft(b: MeshBuilder, w: World, x: number, z: number, size: number): void {
  // Three blades lying flat, printed like a little fan.
  for (let k = -1; k <= 1; k++) {
    const a = k * 0.55 + 0.3;
    const tx = x + Math.sin(a) * size;
    const tz = z + Math.cos(a) * size;
    const px = Math.cos(a) * 0.04;
    const pz = -Math.sin(a) * 0.04;
    const y0 = terrainHeight(w, x - px, z - pz) + PAINT_LIFT;
    const y1 = terrainHeight(w, x + px, z + pz) + PAINT_LIFT;
    const y2 = terrainHeight(w, tx, tz) + PAINT_LIFT;
    const v0 = b.vert(x - px, y0, z - pz, TUFT);
    const v1 = b.vert(x + px, y1, z + pz, TUFT);
    const v2 = b.vert(tx, y2, tz, TUFT);
    // Upward facing: check orientation via the cross product's y.
    const cy = (x + px - (x - px)) * (tz - (z - pz)) - (z + pz - (z - pz)) * (tx - (x - px));
    if (cy < 0) b.tri(v0, v1, v2);
    else b.tri(v0, v2, v1);
  }
}

function trackCell(b: MeshBuilder, w: World, ix: number, iz: number, rx: Run, rz: Run): void {
  const c = w.cell;
  runAt(w, ix, iz, Surface.TRACK, 0, rx);
  runAt(w, ix, iz, Surface.TRACK, 1, rz);
  const wx = (rx.b - rx.a) * c;
  const wz = (rz.b - rz.a) * c;
  const alongZ = wz >= wx;
  const span = alongZ ? wx : wz;
  const centre = alongZ ? w.minX + ((rx.a + rx.b) / 2) * c : w.minZ + ((rz.a + rz.b) / 2) * c;
  // One track, or two 4 m apart on a wide bed.
  const tracks = span >= 7 ? [-2, 2] : [0];
  const x0 = w.minX + ix * c;
  const z0 = w.minZ + iz * c;
  const lo = alongZ ? x0 : z0;
  for (const t of tracks) {
    for (const g of [-0.72, 0.72]) {
      const p = centre + t + g;
      if (p < lo + 0.05 || p > lo + c - 0.05) continue;
      if (alongZ) paint(b, w, p, z0, p, z0 + c, 0.05, RAIL_INK);
      else paint(b, w, x0, p, x0 + c, p, 0.05, RAIL_INK);
    }
    // Sleepers between the rails.
    for (let k = 0; k < 3; k++) {
      const q = (k + 0.5) * (c / 3);
      const a = centre + t - 0.95;
      const e = centre + t + 0.95;
      if (a < lo - 0.01 || e > lo + c + 0.01) continue;
      if (alongZ) paint(b, w, a, z0 + q, e, z0 + q, 0.11, TIE_INK);
      else paint(b, w, x0 + q, a, x0 + q, e, 0.11, TIE_INK);
    }
  }
}

/**
 * Stair treads drawn as real steps sitting on the ramp: each step's tread is level across its
 * run, set so its nose stands at most TREAD_MAX above the ramp. Runs of coplanar stair cells
 * across the street share one set of steps. Rows are independent, as for the paint.
 */
export function meshStairTreads(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number): void {
  const c = w.cell;
  for (let iz = iz0; iz < iz1; iz++) {
    let ix = ix0;
    while (ix < ix1) {
      if (w.surfaces[iz * w.nx + ix] !== Surface.STAIRS) {
        ix++;
        continue;
      }
      const h00 = vertexHeight(w, ix, iz);
      const h10 = vertexHeight(w, ix + 1, iz);
      const h01 = vertexHeight(w, ix, iz + 1);
      const h11 = vertexHeight(w, ix + 1, iz + 1);
      const gx = (h10 - h00 + h11 - h01) / (2 * c);
      const gz = (h01 - h00 + h11 - h10) / (2 * c);
      const fallZ = Math.abs(gz) >= 2 * Math.abs(gx);
      const fallX = Math.abs(gx) >= 2 * Math.abs(gz);
      if ((!fallZ && !fallX) || Math.max(Math.abs(gx), Math.abs(gz)) < 0.05) {
        ix++;
        continue;
      }
      // Extend along the row while cells stay stairs on the same plane (for z-fall stairs).
      let end = ix + 1;
      if (fallZ && planar(w, ix, iz)) {
        const sx = h10 - h00;
        const sz = h01 - h00;
        while (end < ix1 && w.surfaces[iz * w.nx + end] === Surface.STAIRS) {
          const k = end + 1 - ix;
          if (Math.abs(vertexHeight(w, end + 1, iz) - (h00 + sx * k)) > 1e-5) break;
          if (Math.abs(vertexHeight(w, end + 1, iz + 1) - (h00 + sx * k + sz)) > 1e-5) break;
          end++;
        }
      }
      // Steepest grade along the fall axis in either triangle of the cell sets the step size.
      const gMax = fallZ
        ? Math.max(Math.abs(h01 - h00), Math.abs(h11 - h10)) / c
        : Math.max(Math.abs(h10 - h00), Math.abs(h11 - h01)) / c;
      if (fallZ) steps(b, w, w.minX + ix * c + 0.01, w.minX + end * c - 0.01, w.minZ + iz * c, w.minZ + (iz + 1) * c, gz, gMax, true);
      else steps(b, w, w.minZ + iz * c + 0.01, w.minZ + (iz + 1) * c - 0.01, w.minX + ix * c, w.minX + (ix + 1) * c, gx, gMax, false);
      ix = end;
    }
  }
}

/**
 * Steps across [a0, a1] (the run axis) over the fall-axis span [f0, f1]; `g` is the mean grade
 * along the fall axis (its sign says which way is down), `gMax` the steepest.
 */
function steps(b: MeshBuilder, w: World, a0: number, a1: number, f0: number, f1: number, g: number, gMax: number, fallZ: boolean): void {
  // A tread sits `lift` over the ramp at its middle, so its nose stands lift + gMax * run / 2
  // proud; its back edge dips under the ramp, which hides it. Few, deep steps keep stairs cheap.
  const lift = 0.04;
  const run = Math.min(0.6, (2 * (TREAD_MAX - 0.005 - lift)) / Math.max(gMax, 1e-3));
  const n = Math.max(1, Math.ceil((f1 - f0) / run - 1e-6));
  const r = (f1 - f0) / n;
  // World point from (run axis, fall axis).
  const X = (a: number, f: number): number => (fallZ ? a : f);
  const Z = (a: number, f: number): number => (fallZ ? f : a);
  const H = (a: number, f: number): number => terrainHeight(w, X(a, f), Z(a, f));
  const down = g > 0 ? -1 : 1; // the downhill direction along the fall axis
  for (let k = 0; k < n; k++) {
    const lo = f0 + k * r;
    const hi = lo + r;
    const mid = (lo + hi) / 2;
    const fn = down < 0 ? lo : hi; // nose edge (downhill side)
    const fb = down < 0 ? hi : lo; // back edge (uphill side)
    const ta = H(a0, mid) + lift;
    const tb = H(a1, mid) + lift;
    // Two tones, alternating, so each step's edge reads from above.
    const ink = (k & 1) === 0 ? TREAD_A : TREAD_B;
    facing(b, X(a0, fb), ta, Z(a0, fb), X(a1, fb), tb, Z(a1, fb), X(a1, fn), tb, Z(a1, fn), X(a0, fn), ta, Z(a0, fn), 0, 1, 0, ink);
    // Riser at the nose, from just under the ramp to the tread, facing downhill.
    const ra = H(a0, fn) - 0.03;
    const rb = H(a1, fn) - 0.03;
    const dwx = fallZ ? 0 : down;
    const dwz = fallZ ? down : 0;
    facing(b, X(a0, fn), ra, Z(a0, fn), X(a1, fn), rb, Z(a1, fn), X(a1, fn), tb, Z(a1, fn), X(a0, fn), ta, Z(a0, fn), dwx, 0, dwz, RISER);
  }
}

// ---------------------------------------------------------------------------------------------
// Sea overlay geometry

/**
 * Water cells as rows of quads lying exactly on the water ground, for the animated wave print
 * (drawn with a polygon offset so it sits on the flat sea). Returns null when there is no water.
 */
export function meshSea(b: MeshBuilder, w: World): boolean {
  let any = false;
  for (let iz = 0; iz < w.nz; iz++) {
    let ix = 0;
    while (ix < w.nx) {
      if (w.surfaces[iz * w.nx + ix] !== Surface.WATER) {
        ix++;
        continue;
      }
      any = true;
      if (!planar(w, ix, iz)) {
        emitCell(b, w, ix, iz, INK.white);
        ix++;
        continue;
      }
      const h00 = vertexHeight(w, ix, iz);
      const gx = vertexHeight(w, ix + 1, iz) - h00;
      const gz = vertexHeight(w, ix, iz + 1) - h00;
      let end = ix + 1;
      while (end < w.nx && w.surfaces[iz * w.nx + end] === Surface.WATER) {
        const k = end + 1 - ix;
        if (Math.abs(vertexHeight(w, end + 1, iz) - (h00 + gx * k)) > 1e-5) break;
        if (Math.abs(vertexHeight(w, end + 1, iz + 1) - (h00 + gx * k + gz)) > 1e-5) break;
        end++;
      }
      const x0 = w.minX + ix * w.cell;
      const z0 = w.minZ + iz * w.cell;
      const x1 = w.minX + end * w.cell;
      const z1 = z0 + w.cell;
      const a = b.vert(x0, h00, z0, INK.white);
      const c = b.vert(x1, vertexHeight(w, end, iz), z0, INK.white);
      const d = b.vert(x1, vertexHeight(w, end, iz + 1), z1, INK.white);
      const e = b.vert(x0, vertexHeight(w, ix, iz + 1), z1, INK.white);
      b.tri(a, d, c);
      b.tri(a, e, d);
      ix = end;
    }
  }
  return any;
}
