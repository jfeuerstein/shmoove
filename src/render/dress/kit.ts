/**
 * Shared dressing kit: district palettes, a face frame for drawing on the sides of a sim Solid,
 * and small printed shapes (seven-segment numbers, discs, prisms). Everything writes into a
 * MeshBuilder; nothing here runs per frame.
 */
import { District, districtAt, terrainHeight, type Solid, type World } from '../../sim/world';
import { type MeshBuilder, hash2, shade } from '../geom';
import { INK } from '../look';

/** Level of detail of a chunk: far is the plain silhouette, near is fully dressed. */
export const Lod = { NONE: 0, FAR: 1, NEAR: 2 } as const;
export type Lod = (typeof Lod)[keyof typeof Lod];

export interface Palette {
  /** Building inks, loud and flat; neighbours pick different ones. */
  walls: readonly number[];
  /** The district's two leaning inks: shutters, murals, signs. */
  accents: readonly number[];
  /** Roof tops: bleached, so the city reads as concrete from above. */
  roofs: readonly number[];
  /** Retaining walls and quays. */
  stone: number;
}

/** DESIGN section 7: Docks teal + mango, Mercado pink + mango, Terraces mango + cobalt, Antenna cobalt + pink. */
export const PALETTES: Record<District, Palette> = {
  [District.DOCKS]: {
    walls: [INK.teal, INK.mango, 0x63c9be, 0xf6c65c, 0x2b8f87, 0xe9e1cf],
    accents: [INK.mango, INK.teal, INK.paper],
    roofs: [0xe4dccb, 0xd3cab7, 0xcfe3dc],
    stone: 0xc9c1ae,
  },
  [District.MERCADO]: {
    walls: [INK.pink, INK.mango, 0xff86b5, 0xffc861, INK.brick, 0xf6e7d2],
    accents: [INK.mango, INK.pink, INK.paper],
    roofs: [0xe6d9c7, 0xd9c8b4, 0xf0dcd2],
    stone: 0xd3c3ad,
  },
  [District.TERRACES]: {
    walls: [INK.mango, INK.cobalt, 0x5a74e0, 0xffd27a, 0xf3ebdd, 0x9fb0f0],
    accents: [INK.cobalt, INK.mango, INK.paper],
    roofs: [0xe3dccd, 0xd6d0c4, 0xdfe2ee],
    stone: 0xcfc6b2,
  },
  [District.ANTENNA]: {
    walls: [INK.cobalt, INK.pink, 0x6d82e8, 0xff8fb8, 0xe2dccd, 0x34409a],
    accents: [INK.pink, INK.cobalt, INK.paper],
    roofs: [0xd9d4c8, 0xcfcbc4, 0xe5d6dc],
    stone: 0xc4c0b6,
  },
};

export const WINDOW_INK = 0x2a2f6e;

export function paletteAt(w: World, z: number): Palette {
  return PALETTES[districtAt(w, z)];
}

/** Stable per-solid random in [0, 1). */
export function sh(o: Solid, salt: number): number {
  return hash2(o.index * 97 + 13, salt);
}

/** Wall ink for a solid: consecutive solids (generators lay rows in order) never share one. */
export function wallInk(p: Palette, o: Solid): number {
  return p.walls[(o.index * 5 + (o.style % 3)) % p.walls.length];
}

/** An accent that is not the wall colour. */
export function accentFor(p: Palette, wall: number, k: number): number {
  for (let i = 0; i < p.accents.length; i++) {
    const a = p.accents[(k + i) % p.accents.length];
    if (a !== wall) return a;
  }
  return INK.paper;
}

export function roofInk(p: Palette, o: Solid): number {
  return p.roofs[o.index % p.roofs.length];
}

// ---------------------------------------------------------------------------------------------
// Faces

/**
 * One vertical side of a box, seen from outside: `u` runs to the viewer's right along the face,
 * `y` is world height, `off` pushes away from the wall. Quads drawn with u0 < u1 and y0 < y1 are
 * wound counter-clockwise from outside.
 */
export interface Face {
  /** Face centre on the wall plane (x, z). */
  cx: number;
  cz: number;
  /** Outward normal and right vector. */
  nx: number;
  nz: number;
  rx: number;
  rz: number;
  /** Half width along u. */
  hw: number;
  /** Half depth of the box behind this face. */
  hd: number;
}

/** The four sides of an oriented box: +x, -x, +z, -z in its local frame. */
export function boxFaces(cx: number, cz: number, hx: number, hz: number, cosR: number, sinR: number): Face[] {
  const out: Face[] = [];
  const add = (nx: number, nz: number, hw: number, hd: number): void => {
    out.push({ cx: cx + nx * hd, cz: cz + nz * hd, nx, nz, rx: nz, rz: -nx, hw, hd });
  };
  add(cosR, sinR, hz, hx);
  add(-cosR, -sinR, hz, hx);
  add(-sinR, cosR, hx, hz);
  add(sinR, -cosR, hx, hz);
  return out;
}

export function solidFaces(o: Solid): Face[] {
  return boxFaces(o.cx, o.cz, o.hx, o.hz, o.cosR, o.sinR);
}

export function fx(f: Face, u: number, off: number): number {
  return f.cx + f.nx * off + f.rx * u;
}

export function fz(f: Face, u: number, off: number): number {
  return f.cz + f.nz * off + f.rz * u;
}

/** Flat quad on a face. */
export function fquad(b: MeshBuilder, f: Face, u0: number, u1: number, y0: number, y1: number, off: number, color: number, glow = 0): void {
  b.quad(fx(f, u0, off), y0, fz(f, u0, off), fx(f, u1, off), y0, fz(f, u1, off), fx(f, u1, off), y1, fz(f, u1, off), fx(f, u0, off), y1, fz(f, u0, off), color, glow);
}

/** Flat triangle on a face; give the corners counter-clockwise in (u, y). */
export function ftri(b: MeshBuilder, f: Face, u0: number, y0: number, u1: number, y1: number, u2: number, y2: number, off: number, color: number, glow = 0): void {
  const a = b.vert(fx(f, u0, off), y0, fz(f, u0, off), color, glow);
  const c = b.vert(fx(f, u1, off), y1, fz(f, u1, off), color, glow);
  const d = b.vert(fx(f, u2, off), y2, fz(f, u2, off), color, glow);
  b.tri(a, c, d);
}

/** Free quad on a face from four (u, y) corners, counter-clockwise. */
export function fquad4(
  b: MeshBuilder, f: Face,
  u0: number, y0: number, u1: number, y1: number, u2: number, y2: number, u3: number, y3: number,
  off: number, color: number, glow = 0,
): void {
  b.quad(fx(f, u0, off), y0, fz(f, u0, off), fx(f, u1, off), y1, fz(f, u1, off), fx(f, u2, off), y2, fz(f, u2, off), fx(f, u3, off), y3, fz(f, u3, off), color, glow);
}

/** A box stuck to a face: centred at (u, y), standing `out` proud of the wall (its back on the wall plus `off`). */
export function fbox(b: MeshBuilder, f: Face, u: number, y: number, hu: number, hy: number, out: number, off: number, color: number, glow = 0, top?: number): void {
  const ho = out / 2;
  b.box(fx(f, u, off + ho), y, fz(f, u, off + ho), hu, hy, ho, f.rx, f.rz, color, { glow, top, bottom: true });
}

/** Ground height along the foot of a face: the highest of its ends and middle. */
export function faceGround(w: World, f: Face): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = -1; k <= 1; k++) {
    const g = terrainHeight(w, fx(f, k * f.hw * 0.98, 0.3), fz(f, k * f.hw * 0.98, 0.3));
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------------------------
// Printed shapes

/** Seven-segment digits: bits a b c d e f g. */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** A painted number on a face, `h` tall, starting at u (left) and y (bottom). Returns its width. */
export function fnumber(b: MeshBuilder, f: Face, n: number, u: number, y: number, h: number, off: number, color: number, glow = 0): number {
  const s = String(Math.max(0, Math.floor(n)));
  const w = h * 0.55;
  const t = h * 0.14;
  const gap = h * 0.22;
  for (let i = 0; i < s.length; i++) {
    const bits = SEG[s.charCodeAt(i) - 48];
    const x0 = u + i * (w + gap);
    const x1 = x0 + w;
    const ym = y + h / 2;
    const y1 = y + h;
    if (bits & 1) fquad(b, f, x0, x1, y1 - t, y1, off, color, glow);
    if (bits & 2) fquad(b, f, x1 - t, x1, ym, y1, off, color, glow);
    if (bits & 4) fquad(b, f, x1 - t, x1, y, ym, off, color, glow);
    if (bits & 8) fquad(b, f, x0, x1, y, y + t, off, color, glow);
    if (bits & 16) fquad(b, f, x0, x0 + t, y, ym, off, color, glow);
    if (bits & 32) fquad(b, f, x0, x0 + t, ym, y1, off, color, glow);
    if (bits & 64) fquad(b, f, x0, x1, ym - t / 2, ym + t / 2, off, color, glow);
  }
  return s.length * w + (s.length - 1) * gap;
}

export function numberWidth(n: number, h: number): number {
  const len = String(Math.max(0, Math.floor(n))).length;
  return len * h * 0.55 + (len - 1) * h * 0.22;
}

/** A disc (polygon) on a face centred at (u, y). */
export function fdisc(b: MeshBuilder, f: Face, u: number, y: number, r: number, sides: number, off: number, color: number, glow = 0): void {
  const c = b.vert(fx(f, u, off), y, fz(f, u, off), color, glow);
  let prev = -1;
  let first = -1;
  for (let i = 0; i <= sides; i++) {
    if (i === sides) {
      b.tri(c, prev, first);
      break;
    }
    const a = (i / sides) * Math.PI * 2;
    const uu = u + Math.cos(a) * r;
    const yy = y + Math.sin(a) * r;
    const v = b.vert(fx(f, uu, off), yy, fz(f, uu, off), color, glow);
    if (prev >= 0) b.tri(c, prev, v);
    else first = v;
    prev = v;
  }
}

/** An upright polygonal prism (tanks, posts with a round look) with a lid. */
export function prism(b: MeshBuilder, x: number, z: number, r: number, y0: number, y1: number, sides: number, color: number, lid: number, glow = 0): void {
  const ring: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push(x + Math.cos(a) * r, z + Math.sin(a) * r);
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    // Angle runs from +x toward +z: a -> b, up, back: counter-clockwise seen from outside.
    b.quad(ax, y0, az, ax, y1, az, bx, y1, bz, bx, y0, bz, color, glow);
  }
  const c = b.vert(x, y1, z, lid, glow);
  const first = b.vert(ring[0], y1, ring[1], lid, glow);
  let prev = first;
  for (let i = 1; i <= sides; i++) {
    const v = i === sides ? first : b.vert(ring[i * 2], y1, ring[i * 2 + 1], lid, glow);
    b.tri(c, v, prev);
    prev = v;
  }
}

/** A flat double-sided polygon in a vertical plane through (x, y, z) facing (nx, nz): signs, discs. */
export function disc2(b: MeshBuilder, x: number, y: number, z: number, nx: number, nz: number, r: number, sides: number, color: number, back: number, glow = 0): void {
  const f: Face = { cx: x, cz: z, nx, nz, rx: nz, rz: -nx, hw: r, hd: 0 };
  fdisc(b, f, 0, y, r, sides, 0.012, color, glow);
  const g: Face = { cx: x, cz: z, nx: -nx, nz: -nz, rx: -nz, rz: nx, hw: r, hd: 0 };
  fdisc(b, g, 0, y, r, sides, 0.012, back, glow);
}

/** Darken for shadowed trims, lighten for caps. */
export const dark = (c: number, k = 0.78): number => shade(c, k);
export const light = (c: number, k = 1.12): number => shade(c, k);
