/**
 * Shared drawing helpers for ride vehicles: self-orienting faces and prisms (so nothing is wound
 * inside out), livery patterns as real geometry, grab bars, straps, wheels and little box people.
 * Everything here appends to a MeshBuilder in the vehicle's local frame (+z forward, +y up).
 */
import type { CompiledLine, Livery } from '../../sim/lines';
import { MeshBuilder } from '../geom';
import { INK } from '../look';

/** How far painted panels stand off the surface they decorate, m. */
export const OFF = 0.025;

/**
 * Convex polygon from xyz triplets, wound so its front faces away from (ix, iy, iz), a point
 * inside the solid it belongs to.
 */
export function face(
  b: MeshBuilder,
  pts: ArrayLike<number>,
  ix: number,
  iy: number,
  iz: number,
  color: number,
  glow = 0,
): void {
  const n = Math.floor(pts.length / 3);
  if (n < 3) return;
  // Newell normal and centroid.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[i * 3];
    const y0 = pts[i * 3 + 1];
    const z0 = pts[i * 3 + 2];
    const x1 = pts[j * 3];
    const y1 = pts[j * 3 + 1];
    const z1 = pts[j * 3 + 2];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
    cx += x0;
    cy += y0;
    cz += z0;
  }
  cx /= n;
  cy /= n;
  cz /= n;
  const flip = nx * (cx - ix) + ny * (cy - iy) + nz * (cz - iz) < 0;
  const first = b.vertexCount;
  for (let i = 0; i < n; i++) b.vert(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], color, glow);
  for (let i = 1; i < n - 1; i++) {
    if (flip) b.tri(first, first + i + 1, first + i);
    else b.tri(first, first + i, first + i + 1);
  }
}

const _pts: number[] = [];

/**
 * Prism: a convex profile in the (z, y) plane extruded along x from x0 to x1. Wedges, sloped
 * windscreens, wheels, fins. `profile` is [z, y] pairs. `capColor` recolours the two ends.
 */
export function prismX(
  b: MeshBuilder,
  profile: ArrayLike<number>,
  x0: number,
  x1: number,
  color: number,
  opts: { capColor?: number; glow?: number; noCaps?: boolean } = {},
): void {
  const n = Math.floor(profile.length / 2);
  let cz = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cz += profile[i * 2];
    cy += profile[i * 2 + 1];
  }
  cz /= n;
  cy /= n;
  const cx = (x0 + x1) / 2;
  const g = opts.glow ?? 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    _pts.length = 0;
    _pts.push(x0, profile[i * 2 + 1], profile[i * 2], x1, profile[i * 2 + 1], profile[i * 2]);
    _pts.push(x1, profile[j * 2 + 1], profile[j * 2], x0, profile[j * 2 + 1], profile[j * 2]);
    face(b, _pts, cx, cy, cz, color, g);
  }
  if (opts.noCaps) return;
  for (const x of [x0, x1]) {
    _pts.length = 0;
    for (let i = 0; i < n; i++) _pts.push(x, profile[i * 2 + 1], profile[i * 2]);
    face(b, _pts, cx, cy, cz, opts.capColor ?? color, g);
  }
}

/** Prism with a convex profile in the (x, y) plane extruded along z from z0 to z1. */
export function prismZ(
  b: MeshBuilder,
  profile: ArrayLike<number>,
  z0: number,
  z1: number,
  color: number,
  opts: { capColor?: number; glow?: number; noCaps?: boolean } = {},
): void {
  const n = Math.floor(profile.length / 2);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += profile[i * 2];
    cy += profile[i * 2 + 1];
  }
  cx /= n;
  cy /= n;
  const cz = (z0 + z1) / 2;
  const g = opts.glow ?? 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    _pts.length = 0;
    _pts.push(profile[i * 2], profile[i * 2 + 1], z0, profile[i * 2], profile[i * 2 + 1], z1);
    _pts.push(profile[j * 2], profile[j * 2 + 1], z1, profile[j * 2], profile[j * 2 + 1], z0);
    face(b, _pts, cx, cy, cz, color, g);
  }
  if (opts.noCaps) return;
  for (const z of [z0, z1]) {
    _pts.length = 0;
    for (let i = 0; i < n; i++) _pts.push(profile[i * 2], profile[i * 2 + 1], z);
    face(b, _pts, cx, cy, cz, opts.capColor ?? color, g);
  }
}

/** Regular polygon profile of `sides` around (a, c), radius r, rotated by `rot` rad. */
export function ngon(a: number, c: number, r: number, sides: number, rot = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < sides; i++) {
    const t = rot + (i / sides) * Math.PI * 2;
    out.push(a + r * Math.cos(t), c + r * Math.sin(t));
  }
  return out;
}

/** A wheel on an axle along x: hexagonal tyre with a light hub, turned by `rot`. */
export function wheel(b: MeshBuilder, x: number, y: number, z: number, r: number, halfW: number, rot = 0, sides = 6): void {
  prismX(b, ngon(z, y, r, sides, rot), x - halfW, x + halfW, INK.ink, { capColor: INK.ink });
  const s = x >= 0 ? 1 : -1;
  const hx = x + s * (halfW + 0.01);
  // Hub with a spoke mark, so a turning wheel reads as turning.
  face(b, [hx, y + r * 0.35, z, hx, y, z + r * 0.35, hx, y - r * 0.35, z, hx, y, z - r * 0.35], x, y, z, INK.concrete);
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const hx2 = hx + s * 0.005;
  face(
    b,
    [
      hx2, y + sa * r * 0.85 - ca * 0.05, z + ca * r * 0.85 + sa * 0.05,
      hx2, y + sa * r * 0.85 + ca * 0.05, z + ca * r * 0.85 - sa * 0.05,
      hx2, y + ca * 0.05, z - sa * 0.05,
      hx2, y - ca * 0.05, z + sa * 0.05,
    ],
    x,
    y,
    z,
    INK.concrete,
  );
}

/**
 * A flat painting plane: origin + u and v axes (unit), drawing on the side `n` points to. Panel
 * coordinates (u, v) map to o + u*U + v*V.
 */
export interface Plane {
  o: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  n: [number, number, number];
  /** Optional offset along n as a function of (u, v): paints onto a gently curved surface. */
  bend?: (u: number, v: number) => number;
}

/** Flank of a body at x = side * w; u runs forward (+z), v up. */
export function flank(side: number, w: number): Plane {
  return { o: [side * (w + OFF), 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [side, 0, 0] };
}

/** Roof at height h; u runs forward (+z), v to the left (+x). */
export function roof(h: number): Plane {
  return { o: [0, h + OFF, 0], u: [0, 0, 1], v: [1, 0, 0], n: [0, 1, 0] };
}

/** Rear face at z = -l; u runs across (+x), v up. */
export function rear(l: number): Plane {
  return { o: [0, 0, -l - OFF], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] };
}

/** Front face at z = l; u runs across (+x), v up. */
export function front(l: number): Plane {
  return { o: [0, 0, l + OFF], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
}

const _pp: number[] = [];

/** Convex polygon on a plane from (u, v) pairs. */
export function poly(b: MeshBuilder, P: Plane, uv: ArrayLike<number>, color: number, glow = 0): void {
  _pp.length = 0;
  const n = Math.floor(uv.length / 2);
  for (let i = 0; i < n; i++) {
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
    const d = P.bend ? P.bend(u, v) : 0;
    _pp.push(
      P.o[0] + u * P.u[0] + v * P.v[0] + d * P.n[0],
      P.o[1] + u * P.u[1] + v * P.v[1] + d * P.n[1],
      P.o[2] + u * P.u[2] + v * P.v[2] + d * P.n[2],
    );
  }
  // The "inside" is just behind the plane.
  let cu = 0;
  let cv = 0;
  for (let i = 0; i < n; i++) {
    cu += uv[i * 2];
    cv += uv[i * 2 + 1];
  }
  cu /= n;
  cv /= n;
  const cd = (P.bend ? P.bend(cu, cv) : 0) - 1;
  const ix = P.o[0] + cu * P.u[0] + cv * P.v[0] + cd * P.n[0];
  const iy = P.o[1] + cu * P.u[1] + cv * P.v[1] + cd * P.n[1];
  const iz = P.o[2] + cu * P.u[2] + cv * P.v[2] + cd * P.n[2];
  face(b, _pp, ix, iy, iz, color, glow);
}

/** Axis-aligned rectangle on a plane. */
export function rect(b: MeshBuilder, P: Plane, u0: number, v0: number, u1: number, v1: number, color: number, glow = 0): void {
  // On a bent plane, long rectangles are cut into short pieces so they follow the surface.
  const pieces = P.bend ? Math.max(1, Math.ceil(Math.abs(u1 - u0) / 0.8)) : 1;
  for (let i = 0; i < pieces; i++) {
    const a = u0 + ((u1 - u0) * i) / pieces;
    const c = u0 + ((u1 - u0) * (i + 1)) / pieces;
    poly(b, P, [a, v0, c, v0, c, v1, a, v1], color, glow);
  }
}

/** Lift a plane a little further off its surface (for a second layer of paint). */
export function lift(P: Plane, d = OFF): Plane {
  return { o: [P.o[0] + P.n[0] * d, P.o[1] + P.n[1] * d, P.o[2] + P.n[2] * d], u: P.u, v: P.v, n: P.n, bend: P.bend };
}

/**
 * One of the six livery patterns as geometry, drawn in `color` inside the rectangle
 * [u0, u1] x [v0, v1] of a plane (the base colour is the surface behind it). `second`, if given,
 * adds a thin second-ink detail so the pattern carries two inks.
 */
export function pattern(
  b: MeshBuilder,
  P: Plane,
  kind: number,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  color: number,
  second?: number,
): void {
  const w = u1 - u0;
  const h = v1 - v0;
  if (w <= 0 || h <= 0) return;
  switch (((kind % 6) + 6) % 6) {
    case 0: {
      // Band: one broad stripe and a pinstripe.
      rect(b, P, u0, v0 + h * 0.18, u1, v0 + h * 0.58, color);
      rect(b, P, u0, v0 + h * 0.72, u1, v0 + h * 0.86, second ?? color);
      break;
    }
    case 1: {
      // Chevrons pointing forward (+u).
      const a = h * 0.5;
      const t = Math.min(h * 0.34, w * 0.12);
      const pitch = Math.max(h * 0.95, t * 2.4);
      const count = Math.max(1, Math.floor((w - a - t) / pitch) + 1);
      const span = (count - 1) * pitch + a + t;
      const start = u0 + (w - span) / 2 + a;
      const vm = v0 + h / 2;
      for (let i = 0; i < count; i++) {
        const c = start + i * pitch;
        const col = second !== undefined && i % 2 === 1 ? second : color;
        poly(b, P, [c - a, v0, c - a + t, v0, c + t, vm, c, vm], col);
        poly(b, P, [c, vm, c + t, vm, c - a + t, v1, c - a, v1], col);
      }
      break;
    }
    case 2: {
      // Checks: two rows of squares.
      const s = h / 2;
      const cols = Math.max(2, Math.floor(w / s));
      const cw = w / cols;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r + c) % 2 !== 0) continue;
          rect(b, P, u0 + c * cw, v0 + r * s, u0 + (c + 1) * cw, v0 + (r + 1) * s, color);
        }
      }
      if (second !== undefined) rect(b, lift(P), u0, v0 + h * 0.47, u1, v0 + h * 0.53, second);
      break;
    }
    case 3: {
      // Diagonal slashes leaning forward.
      const t = h * 0.38;
      const lean = h * 0.7;
      const pitch = h * 1.15;
      const count = Math.max(1, Math.floor((w - t - lean) / pitch) + 1);
      const span = (count - 1) * pitch + t + lean;
      const start = u0 + (w - span) / 2;
      for (let i = 0; i < count; i++) {
        const a = start + i * pitch;
        const col = second !== undefined && i % 3 === 2 ? second : color;
        poly(b, P, [a, v0, a + t, v0, a + t + lean, v1, a + lean, v1], col);
      }
      break;
    }
    case 4: {
      // Dots: two staggered rows of octagons.
      const r = h * 0.2;
      const pitch = r * 3.2;
      const count = Math.max(1, Math.floor((w - 2 * r) / pitch) + 1);
      const span = (count - 1) * pitch;
      const start = u0 + (w - span) / 2;
      for (let i = 0; i < count; i++) {
        const cu = start + i * pitch;
        const cv = i % 2 === 0 ? v0 + h * 0.3 : v0 + h * 0.7;
        const col = second !== undefined && i % 4 === 3 ? second : color;
        poly(b, P, ngon(cu, cv, r, 8, Math.PI / 8), col);
      }
      break;
    }
    case 5: {
      // Zigzag: one continuous saw line.
      const th = h * 0.3;
      const lo = v0 + th / 2;
      const hi = v1 - th / 2;
      const step = Math.max(h * 0.8, 0.2);
      const count = Math.max(2, Math.round(w / step));
      const du = w / count;
      for (let i = 0; i < count; i++) {
        const ua = u0 + i * du;
        const ub = ua + du;
        const va = i % 2 === 0 ? lo : hi;
        const vb = i % 2 === 0 ? hi : lo;
        poly(b, P, [ua, va - th / 2, ub, vb - th / 2, ub, vb + th / 2, ua, va + th / 2], color);
      }
      if (second !== undefined) rect(b, lift(P), u0, v0, u1, v0 + h * 0.08, second);
      break;
    }
  }
}

/** The livery on both flanks over z in [z0, z1], y in [y0, y1], at half width w. */
export function flanks(b: MeshBuilder, liv: Livery, w: number, z0: number, z1: number, y0: number, y1: number): void {
  for (const side of [1, -1]) pattern(b, flank(side, w), liv.pattern, z0, z1, y0, y1, liv.stripe, liv.accent);
}

/** The big accent roof mark: the line's pattern again, scaled up to the roof, in the accent ink. */
export function roofMark(b: MeshBuilder, liv: Livery, h: number, w: number, z0: number, z1: number): void {
  pattern(b, roof(h), liv.pattern, z0, z1, -w, w, liv.accent);
}

/**
 * The pink grab bar of a ground ride at (0, anchorY, -anchorBack), with struts forward to the body
 * at z = attachZ. `half` is the bar's half width.
 */
export function grabBar(b: MeshBuilder, line: CompiledLine, attachZ: number, attachY: number, half = 0.45): void {
  const z = -line.anchorBack;
  const y = line.anchorY;
  b.beam(-half, y, z, half, y, z, 0.055, INK.pink, 0.6);
  b.beam(-half, y, z, -half * 0.8, attachY, attachZ, 0.035, INK.pink);
  b.beam(half, y, z, half * 0.8, attachY, attachZ, 0.035, INK.pink);
}

/**
 * An overhead ride's strap: a line from (0, topY, -anchorBack) down to the pink handle at the grab
 * point (0, anchorY - hang, -anchorBack). `color` is the strap ink; the handle is always pink.
 */
export function strap(b: MeshBuilder, line: CompiledLine, color: number, half = 0.035, topY = line.anchorY): void {
  const z = -line.anchorBack;
  const gy = line.anchorY - line.hang;
  b.beam(0, topY, z, 0, gy + 0.32, z, half, color);
  handle(b, 0, gy, z);
}

/** A pink triangular strap handle whose bar is centred on (x, y, z). */
export function handle(b: MeshBuilder, x: number, y: number, z: number): void {
  b.beam(x - 0.26, y, z, x + 0.26, y, z, 0.05, INK.pink, 0.7);
  b.beam(x - 0.26, y, z, x, y + 0.34, z, 0.04, INK.pink, 0.7);
  b.beam(x + 0.26, y, z, x, y + 0.34, z, 0.04, INK.pink, 0.7);
}

export interface FigureOpts {
  /** Torso ink, legs ink, cap/hat ink. */
  shirt: number;
  legs: number;
  hat: number;
  /** -1..1 stride: which leg is forward. */
  stride: number;
  /** Seated: thighs forward instead of down. */
  seated?: boolean;
  /** Hand targets relative to the figure origin, or null to hang at the sides. */
  handL?: [number, number, number] | null;
  handR?: [number, number, number] | null;
  /** Overall scale (1 = skater sized). */
  scale?: number;
  /** Turned to face +x (1) or -x (-1) instead of +z. */
  face?: number;
}

const SKIN = 0xc98a5e;

/**
 * A little box person in the skater's style standing at (x, y, z), facing +z: legs, torso, head and
 * a hat, arms reaching to the given hand points. About 1.7 m tall at scale 1.
 */
export function figure(b: MeshBuilder, x: number, y: number, z: number, o: FigureOpts): void {
  const s = o.scale ?? 1;
  const hip = y + (o.seated ? 0.5 : 0.85) * s;
  const fx = o.face ?? 0;
  // Forward axis of the figure in local xz.
  const ax = fx;
  const az = fx === 0 ? 1 : 0;
  // Side axis (figure's left).
  const sx = az;
  const sz = -ax;
  for (const side of [1, -1]) {
    const lx = x + sx * side * 0.1 * s;
    const lz = z + sz * side * 0.1 * s;
    if (o.seated) {
      const kx = lx + ax * 0.42 * s;
      const kz = lz + az * 0.42 * s;
      b.beam(lx, hip, lz, kx, hip, kz, 0.065 * s, o.legs);
      b.beam(kx, hip, kz, kx + ax * 0.05 * s, y + 0.05, kz + az * 0.05 * s, 0.06 * s, o.legs);
    } else {
      const k = o.stride * side * 0.22 * s;
      b.beam(lx, hip, lz, lx + ax * k, y + 0.04, lz + az * k, 0.07 * s, o.legs);
      b.box(lx + ax * (k + 0.05 * s), y + 0.04, lz + az * (k + 0.05 * s), 0.07 * s, 0.04, 0.07 * s, 1, 0, INK.ink, { bottom: true });
    }
  }
  const tb = hip + 0.28 * s;
  b.box(x, tb, z, (fx === 0 ? 0.19 : 0.12) * s, 0.3 * s, (fx === 0 ? 0.12 : 0.19) * s, 1, 0, o.shirt, {});
  const hy = hip + 0.72 * s;
  b.box(x, hy, z, 0.11 * s, 0.12 * s, 0.11 * s, 1, 0, SKIN, {});
  b.box(x, hy + 0.15 * s, z, 0.13 * s, 0.04 * s, 0.13 * s, 1, 0, o.hat, {});
  const shY = hip + 0.52 * s;
  for (const side of [1, -1]) {
    const shx = x + sx * side * 0.24 * s;
    const shz = z + sz * side * 0.24 * s;
    const hand = side === 1 ? o.handL : o.handR;
    let hx: number;
    let hyy: number;
    let hz: number;
    if (hand) {
      hx = x + hand[0];
      hyy = y + hand[1];
      hz = z + hand[2];
    } else {
      hx = shx + sx * side * 0.06 * s + ax * -o.stride * side * 0.15 * s;
      hyy = shY - 0.5 * s;
      hz = shz + sz * side * 0.06 * s + az * -o.stride * side * 0.15 * s;
    }
    b.beam(shx, shY, shz, hx, hyy, hz, 0.05 * s, o.shirt);
    b.box(hx, hyy, hz, 0.055 * s, 0.055 * s, 0.055 * s, 1, 0, SKIN, { bottom: true });
  }
}
