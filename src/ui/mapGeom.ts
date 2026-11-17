/**
 * Pure geometry for the line map: cut a line's path into per-segment plan polylines, simplify
 * them, and fit the network into a screen box with uphill at the top.
 */
import type { CompiledLine } from '../sim/lines';

/** Plan polyline as flat [x0, z0, x1, z1, ...]. */
export type Poly = number[];

function pointAt(line: CompiledLine, s: number, out: Poly): void {
  const cum = line.cum;
  const n = cum.length;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const len = cum[lo + 1] - cum[lo];
  const t = len > 0 ? Math.min(1, Math.max(0, (s - cum[lo]) / len)) : 0;
  const p = line.pathPts;
  out.push(p[lo * 3] + (p[lo * 3 + 3] - p[lo * 3]) * t, p[lo * 3 + 2] + (p[lo * 3 + 5] - p[lo * 3 + 2]) * t);
}

/** The plan (x, z) polyline of a line's path between arc positions s0 < s1, endpoints included. */
export function subPath(line: CompiledLine, s0: number, s1: number): Poly {
  const out: Poly = [];
  pointAt(line, s0, out);
  const cum = line.cum;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(line.pathPts[i * 3], line.pathPts[i * 3 + 2]);
  }
  pointAt(line, s1, out);
  return out;
}

/** Distance from point p to segment ab. */
export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + ex * t - px;
  const dy = ay + ey * t - py;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Douglas-Peucker: keeps both endpoints; every dropped point lies within `tol` of the result. */
export function simplify(pts: Poly, tol: number): Poly {
  const n = pts.length >> 1;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegDist(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const out: Poly = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function polyBounds(polys: readonly Poly[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of polys) {
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minZ) b.minZ = p[i + 1];
      if (p[i + 1] > b.maxZ) b.maxZ = p[i + 1];
    }
  }
  return b;
}

/**
 * Screen mapping of plan (x, z): uphill (+z) at the top, and the map seen as the player sees the
 * city facing uphill (+x is on the left, as the chase camera shows it).
 */
export interface Projection {
  /** Screen px per metre across (x) and up (z). Equal unless the fit was allowed to stretch. */
  sx: number;
  scale: number;
  /** Screen position of plan (0, 0). */
  ox: number;
  oy: number;
}

export function project(pr: Projection, x: number, z: number): [number, number] {
  return [pr.ox - x * pr.sx, pr.oy - z * pr.scale];
}

/**
 * Fit `b` into a w x h box with `margin` on every side, centred. Uniform by default; with
 * `maxStretch` > 1 the narrower axis may be stretched up to that factor to fill the box, as
 * schematic transit maps do with a long thin network.
 */
export function fitProjection(b: Bounds, w: number, h: number, margin: number, maxStretch = 1): Projection {
  const bw = Math.max(b.maxX - b.minX, 1e-3);
  const bh = Math.max(b.maxZ - b.minZ, 1e-3);
  const fx = Math.max(1e-6, (w - 2 * margin) / bw);
  const fz = Math.max(1e-6, (h - 2 * margin) / bh);
  const u = Math.min(fx, fz);
  const k = Math.max(1, maxStretch);
  const sx = Math.min(fx, u * k);
  const scale = Math.min(fz, u * k);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return { sx, scale, ox: w / 2 + cx * sx, oy: h / 2 + cz * scale };
}

/** SVG path data for a projected polyline. */
export function pathData(pr: Projection, poly: Poly): string {
  let d = '';
  for (let i = 0; i < poly.length; i += 2) {
    const [x, y] = project(pr, poly[i], poly[i + 1]);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
