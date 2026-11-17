/**
 * Solids dressed by kind. The far version of every solid is its plain box (walls in the base ink,
 * lid in the roof ink); the near version keeps exactly that box and adds trims, windows, murals,
 * props and roof clutter, so swapping far for near never changes the outline.
 *
 * Roof rule: anything standing more than ROOF_CLUTTER_MAX above a skateable top sits within
 * ROOF_EDGE of the roof's edge, so roofs stay rideable.
 */
import { Surface, terrainHeight, terrainSurface, topHeight, type Solid, type World } from '../../sim/world';
import { type MeshBuilder, hash2, shade } from '../geom';
import { INK } from '../look';
import {
  WINDOW_INK,
  accentFor,
  dark,
  disc2,
  faceGround,
  fbox,
  fdisc,
  fnumber,
  fquad,
  fquad4,
  ftri,
  fx,
  fz,
  light,
  numberWidth,
  paletteAt,
  prism,
  roofInk,
  sh,
  solidFaces,
  wallInk,
  type Face,
  type Palette,
} from './kit';

export const ROOF_CLUTTER_MAX = 0.35;
export const ROOF_EDGE = 0.5;

/** Kinds the dresser knows. Anything else is drawn as a plain box. */
export const SOLID_KINDS = [
  'building', 'house', 'tower', 'warehouse', 'container', 'crate', 'kiosk', 'stall', 'shed',
  'awning', 'wall', 'quay', 'mast', 'pylon', 'tank', 'platform',
] as const;

const CONTAINER_INKS = [INK.mango, INK.pink, INK.teal, INK.cobalt, INK.brick, 0x2b8f87, 0xe9e1cf, 0x7a4fc9];
const PROP_INKS = [INK.mango, INK.pink, INK.teal, INK.cobalt, INK.brick, INK.leaf];

/** Wall ink of a solid, shared by its far and near versions. */
export function baseInk(w: World, o: Solid): number {
  const p = paletteAt(w, o.cz);
  switch (o.kind) {
    case 'container':
      return CONTAINER_INKS[o.style % CONTAINER_INKS.length];
    case 'crate':
    case 'kiosk':
      return PROP_INKS[(o.style + o.index) % PROP_INKS.length];
    case 'stall':
      return 0xc98a55;
    case 'shed':
      return p.walls[(o.index + 2) % p.walls.length];
    case 'awning':
      return p.accents[o.style % 2];
    case 'wall':
    case 'quay':
      return p.stone;
    case 'mast':
      return INK.pink;
    case 'pylon':
      return INK.cobalt;
    case 'tank':
      return 0xe9e3d6;
    case 'platform':
      return INK.cobalt;
    default:
      return wallInk(p, o);
  }
}

/** Lid ink of a solid, shared by far and near. */
export function topInk(w: World, o: Solid): number {
  const p = paletteAt(w, o.cz);
  switch (o.kind) {
    case 'container':
    case 'crate':
    case 'kiosk':
      return light(baseInk(w, o), 1.08);
    case 'awning':
    case 'stall':
      return p.accents[o.style % 2];
    case 'wall':
    case 'quay':
      return light(p.stone, 1.1);
    case 'mast':
    case 'pylon':
      return INK.white;
    case 'tank':
      return 0xd9d2c3;
    default:
      return roofInk(p, o);
  }
}

/** Far: the plain silhouette box. */
export function meshSolidFar(b: MeshBuilder, w: World, o: Solid): void {
  const hy = (o.yTop - o.yBase) / 2;
  b.box(o.cx, o.yBase + hy, o.cz, o.hx, hy, o.hz, o.cosR, o.sinR, baseInk(w, o), { top: topInk(w, o), bottom: o.oneWay });
}

/** Near: the same box, dressed by kind. */
export function meshSolidNear(b: MeshBuilder, w: World, o: Solid): void {
  switch (o.kind) {
    case 'building':
      return building(b, w, o, 0);
    case 'house':
      return building(b, w, o, 1);
    case 'tower':
      return building(b, w, o, 2);
    case 'warehouse':
      return warehouse(b, w, o, false);
    case 'shed':
      return warehouse(b, w, o, true);
    case 'container':
      return container(b, w, o);
    case 'crate':
      return crate(b, w, o);
    case 'kiosk':
      return kiosk(b, w, o);
    case 'stall':
      return stall(b, w, o);
    case 'awning':
      return awning(b, w, o);
    case 'wall':
      return retaining(b, w, o, false);
    case 'quay':
      return retaining(b, w, o, true);
    case 'mast':
      return mast(b, w, o, INK.pink);
    case 'pylon':
      return mast(b, w, o, INK.cobalt);
    case 'tank':
      return tank(b, w, o);
    case 'platform':
      return platform(b, w, o);
    default:
      return meshSolidFar(b, w, o);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

/** The body box, walls only (the lid comes from a cap or is added by the caller). */
function walls(b: MeshBuilder, o: Solid, ink: number, top?: number): void {
  const hy = (o.yTop - o.yBase) / 2;
  b.box(o.cx, o.yBase + hy, o.cz, o.hx, hy, o.hz, o.cosR, o.sinR, ink, top === undefined ? { noTop: true } : { top, bottom: o.oneWay });
}

/** A cap course: a slightly bigger slab whose lid is the skateable top. */
function cap(b: MeshBuilder, o: Solid, out: number, depth: number, side: number, lid: number): void {
  b.box(o.cx, o.yTop - depth / 2, o.cz, o.hx + out, depth / 2, o.hz + out, o.cosR, o.sinR, side, { top: lid, bottom: true });
}

/** World point at local (lx, lz) of a solid. */
function lx2x(o: Solid, lx: number, lz: number): number {
  return o.cx + lx * o.cosR - lz * o.sinR;
}
function lx2z(o: Solid, lx: number, lz: number): number {
  return o.cz + lx * o.sinR + lz * o.cosR;
}

/** Is a face hidden by a neighbour at least as tall (so dressing it is wasted)? */
function occluded(w: World, o: Solid, f: Face): boolean {
  const x = fx(f, 0, 0.9);
  const z = fz(f, 0, 0.9);
  return topHeight(w, x, z) > o.yTop - 1.2;
}

/** Is the ground just outside a face a walkway (where doors and shopfronts go)? */
function streetSide(w: World, f: Face): boolean {
  const s = terrainSurface(w, fx(f, 0, 2), fz(f, 0, 2));
  return s === Surface.STREET || s === Surface.PLAZA || s === Surface.STAIRS;
}

/** Faces sorted widest first, with their index. */
function facesByWidth(o: Solid): Face[] {
  return solidFaces(o).sort((a, c) => c.hw - a.hw);
}

// ---------------------------------------------------------------------------------------------
// Buildings, houses, towers

function building(b: MeshBuilder, w: World, o: Solid, variant: 0 | 1 | 2): void {
  const p = paletteAt(w, o.cz);
  const wall = baseInk(w, o);
  const roof = topInk(w, o);
  const acc = accentFor(p, wall, o.style + o.index);
  const acc2 = accentFor(p, wall, o.style + o.index + 1);
  const trim = dark(wall, 0.72);
  walls(b, o, wall);
  cap(b, o, 0.14, 0.32, acc === INK.paper ? dark(wall, 0.85) : acc, roof);

  const storey = variant === 1 ? 2.7 : 3.1;
  const faces = solidFaces(o);
  // Front: a street-side face that is not hidden; it gets the door, shopfront and signs.
  let front = -1;
  for (let i = 0; i < 4; i++) {
    if (!occluded(w, o, faces[i]) && faces[i].hw >= 1.4 && streetSide(w, faces[i]) && (front < 0 || faces[i].hw > faces[front].hw)) front = i;
  }
  // Mural: the widest open face with room for one (the front if it is as wide).
  let muralFace = -1;
  if (sh(o, 3) < 0.75) {
    for (let i = 0; i < 4; i++) {
      if (occluded(w, o, faces[i]) || faces[i].hw < 2.2) continue;
      if (muralFace < 0 || faces[i].hw > faces[muralFace].hw + 0.01 || (i === front && faces[i].hw >= faces[muralFace].hw - 0.01)) muralFace = i;
    }
  }
  const shutters = sh(o, 5) < 0.5;
  const winH = variant === 1 ? 1.1 : 1.35;
  const ww = variant === 1 ? 0.42 : 0.5;
  for (let i = 0; i < 4; i++) {
    const f = faces[i];
    if (occluded(w, o, f)) continue;
    const g = faceGround(w, f);
    // Base course: a darker plinth up to just above the highest ground along the face.
    const plinth = Math.min(o.yTop - 0.4, g.hi + 0.55);
    if (plinth > o.yBase) fquad(b, f, -f.hw, f.hw, o.yBase, plinth, 0.02, trim);
    const groundTop = g.hi;
    // Mural rectangle on this face, if any: most of the wall above the ground floor.
    let mu0 = 0;
    let mu1 = 0;
    let my0 = 0;
    let my1 = 0;
    if (i === muralFace) {
      my0 = groundTop + storey + 0.25;
      my1 = Math.min(o.yTop - 0.6, my0 + 4 + 3 * sh(o, 7));
      if (my1 - my0 >= 2.4) {
        const width = Math.min(2 * f.hw - 1.0, 4 + 6 * sh(o, 8));
        const centre = (sh(o, 9) - 0.5) * (2 * f.hw - 1.0 - width);
        mu0 = centre - width / 2;
        mu1 = centre + width / 2;
        mural(b, f, mu0, mu1, my0, my1, Math.floor(sh(o, 10) * 6), acc, acc2, wall, o.index);
      } else {
        my1 = my0;
      }
    }
    const cols = Math.floor((2 * f.hw - 0.6) / (variant === 1 ? 2.4 : 2.7));
    const pitch = cols >= 1 ? (2 * f.hw) / cols : 0;
    // Upper-floor windows.
    for (let r = 1; cols >= 1; r++) {
      const y0 = groundTop + r * storey + 0.6;
      const y1 = y0 + winH;
      if (y1 > o.yTop - 0.4) break;
      for (let c = 0; c < cols; c++) {
        const u = -f.hw + (c + 0.5) * pitch;
        if (my1 > my0 && u + 0.9 > mu0 && u - 0.9 < mu1 && y1 > my0 && y0 < my1) continue;
        const lit = hash2(o.index * 31 + r * 7 + c, i) > 0.5 ? 1 : 0;
        if (shutters) {
          fquad(b, f, u - ww, u + ww, y0, y1, 0.03, WINDOW_INK, lit);
          fquad(b, f, u - ww - 0.42, u - ww - 0.02, y0, y1, 0.04, acc);
          fquad(b, f, u + ww + 0.02, u + ww + 0.42, y0, y1, 0.04, acc);
        } else {
          fquad(b, f, u - ww - 0.12, u + ww + 0.12, y0 - 0.12, y1 + 0.12, 0.03, INK.paper);
          fquad(b, f, u - ww, u + ww, y0, y1, 0.045, WINDOW_INK, lit);
        }
        if (variant === 1 && (c + r + o.index) % 3 === 0) {
          // Flower box under a house window.
          fbox(b, f, u, y0 - 0.12, ww + 0.1, 0.1, 0.22, 0.02, INK.leaf, 0, INK.pink);
        }
      }
    }
    // Ground floor: door, shop window and signs on the front; windows elsewhere.
    let busy0 = 0;
    let busy1 = 0;
    if (i === front) {
      const du = (sh(o, 11) - 0.5) * Math.max(0, 2 * f.hw - 3);
      const dg = terrainHeight(w, fx(f, du, 0.3), fz(f, du, 0.3));
      if (dg > o.yBase + 0.02 && dg + 2.6 < o.yTop) {
        fquad(b, f, du - 0.72, du + 0.72, dg, dg + 2.35, 0.03, INK.paper);
        fquad(b, f, du - 0.58, du + 0.58, dg, dg + 2.2, 0.045, dark(acc2, 0.6));
        // Sign over the door.
        if (dg + 3.2 < o.yTop - 0.3) fbox(b, f, du, dg + 2.8, 1.25, 0.28, 0.14, 0.02, acc2, 0.6, acc);
        // Shop window on the wider side of the door.
        const side = du < 0 ? 1 : -1;
        const s0 = du + side * 1.1;
        const s1 = side > 0 ? Math.min(f.hw - 0.4, s0 + 2.6) : Math.max(-f.hw + 0.4, s0 - 2.6);
        busy0 = Math.min(du - 0.8, s0, s1);
        busy1 = Math.max(du + 0.8, s0, s1);
        if (Math.abs(s1 - s0) > 1) {
          const sg = terrainHeight(w, fx(f, (s0 + s1) / 2, 0.3), fz(f, (s0 + s1) / 2, 0.3));
          const lit = sh(o, 12) < 0.75 ? 1 : 0;
          fquad(b, f, Math.min(s0, s1), Math.max(s0, s1), sg + 0.7, sg + 2.2, 0.035, WINDOW_INK, lit);
          fquad(b, f, Math.min(s0, s1) - 0.1, Math.max(s0, s1) + 0.1, sg + 2.2, sg + 2.38, 0.04, acc);
        }
      }
      // A blade sign standing off the wall near a corner, read face-on from down the street.
      const bh = Math.min(1.4, (o.yTop - groundTop - storey - 0.8) / 2);
      if (bh > 0.5 && f.hw > 2.4 && sh(o, 13) < 0.8) {
        const bu = (sh(o, 14) < 0.5 ? -1 : 1) * (f.hw - 0.7);
        const by = groundTop + storey + 0.3 + bh;
        fbox(b, f, bu, by, 0.06, bh, 1.0, 0.02, acc, 0, acc);
        fbox(b, f, bu, by, 0.08, bh - 0.16, 0.76, 0.14, INK.paper, 0.7, INK.paper);
        fbox(b, f, bu, by, 0.1, (bh - 0.16) * 0.28, 0.5, 0.27, acc2, 0.7, acc2);
      }
    }
    if (cols >= 1 && groundTop + 2.4 < o.yTop - 0.5) {
      for (let c = 0; c < cols; c++) {
        const u = -f.hw + (c + 0.5) * pitch;
        if (busy1 > busy0 && u + 0.5 > busy0 && u - 0.5 < busy1) continue;
        if (i !== front && (c & 1) === 1) continue;
        const lit = hash2(o.index * 13 + c, i + 9) > 0.55 ? 1 : 0;
        fquad(b, f, u - 0.45, u + 0.45, groundTop + 0.95, groundTop + 2.15, 0.03, WINDOW_INK, lit);
      }
    }
    if (variant === 2 && o.yTop - groundTop > 9) {
      // Tower clock near the top of every open face.
      const cy = o.yTop - 1.9;
      const r = Math.min(1.3, f.hw * 0.7);
      fdisc(b, f, 0, cy, r + 0.12, 12, 0.03, acc);
      fdisc(b, f, 0, cy, r, 12, 0.045, INK.paper, 0.5);
      fquad(b, f, -0.06, 0.06, cy, cy + r * 0.8, 0.06, INK.ink);
      fquad(b, f, 0, r * 0.55, cy - 0.06, cy + 0.06, 0.06, INK.ink);
    }
  }
  if (o.surface === Surface.ROOF) roofClutter(b, w, o, p, acc, acc2);
}

/** Painted-bus murals made of a few flat shapes. */
function mural(b: MeshBuilder, f: Face, u0: number, u1: number, y0: number, y1: number, kind: number, a: number, c: number, wall: number, seed: number): void {
  const bg = a === wall ? INK.paper : a;
  const fg = c === bg ? (bg === INK.paper ? INK.ink : INK.paper) : c;
  const W = u1 - u0;
  const H = y1 - y0;
  const um = (u0 + u1) / 2;
  const ym = (y0 + y1) / 2;
  const o1 = 0.05;
  const o2 = 0.07;
  fquad(b, f, u0, u1, y0, y1, o1, bg);
  switch (kind) {
    case 0: {
      // Stripes.
      const n = 5;
      for (let k = 0; k < n; k += 2) fquad(b, f, u0, u1, y0 + (k * H) / n, y0 + ((k + 1) * H) / n, o2, fg);
      break;
    }
    case 1: {
      // Chevrons pointing up.
      const t = H * 0.12;
      for (let k = 0; k < 3; k++) {
        const yb = y0 + H * (0.12 + 0.27 * k);
        const yt = yb + H * 0.22;
        fquad4(b, f, u0 + W * 0.08, yb, um, yt, um, yt + t, u0 + W * 0.08, yb + t, o2, fg);
        fquad4(b, f, um, yt, u1 - W * 0.08, yb, u1 - W * 0.08, yb + t, um, yt + t, o2, fg);
      }
      break;
    }
    case 2: {
      // Sunburst rising from the bottom edge.
      const rays = 7;
      const R = Math.min(W * 0.5, H) * 0.98;
      for (let k = 0; k < rays; k += 2) {
        const a0 = (k / rays) * Math.PI;
        const a1 = ((k + 1) / rays) * Math.PI;
        ftri(b, f, um, y0, um + Math.cos(a0) * R, y0 + Math.sin(a0) * R, um + Math.cos(a1) * R, y0 + Math.sin(a1) * R, o2, fg);
      }
      fdisc(b, f, um, y0 + 0.02, R * 0.3, 10, o2 + 0.02, INK.mango === bg ? INK.pink : INK.mango);
      break;
    }
    case 3: {
      // A fish.
      const L = W * 0.7;
      const h = Math.min(H * 0.4, L * 0.35);
      const bx = um + W * 0.06;
      ftri(b, f, bx - L / 2, ym, bx, ym - h, bx + L / 2, ym, o2, fg);
      ftri(b, f, bx - L / 2, ym, bx + L / 2, ym, bx, ym + h, o2, fg);
      ftri(b, f, bx - L / 2 - L * 0.28, ym - h * 0.8, bx - L / 2 + 0.05, ym, bx - L / 2 - L * 0.28, ym + h * 0.8, o2, fg);
      fdisc(b, f, bx + L * 0.28, ym + h * 0.15, Math.max(0.12, h * 0.14), 6, o2 + 0.02, bg);
      break;
    }
    case 4: {
      // An open hand.
      const pw = Math.min(W * 0.45, H * 0.4);
      const px0 = um - pw / 2;
      const py0 = y0 + H * 0.12;
      const py1 = py0 + pw;
      fquad(b, f, px0, px0 + pw, py0, py1, o2, fg);
      const fw = pw / 4;
      for (let k = 0; k < 4; k++) {
        const len = pw * (0.75 + 0.18 * (k === 1 || k === 2 ? 1 : 0));
        fquad(b, f, px0 + k * fw + fw * 0.12, px0 + (k + 1) * fw - fw * 0.12, py1, Math.min(y1 - 0.1, py1 + len), o2, fg);
      }
      fquad4(b, f, px0 - pw * 0.45, py0 + pw * 0.55, px0, py0 + pw * 0.25, px0, py0 + pw * 0.6, px0 - pw * 0.45, py0 + pw * 0.85, o2, fg);
      break;
    }
    default: {
      // A big number on a sign block with a border.
      const n = 1 + (seed % 89);
      const h = Math.min(H * 0.7, (W * 0.8) / (String(n).length * 0.8));
      fquad(b, f, u0 + 0.12, u1 - 0.12, y0 + 0.12, y1 - 0.12, o1 + 0.01, fg === INK.paper ? INK.ink : INK.paper);
      const nw = numberWidth(n, h);
      fnumber(b, f, n, um - nw / 2, ym - h / 2, h, o2, bg, 0.3);
      break;
    }
  }
}

/** Water tanks, vents, dishes and laundry on a flat roof, obeying the roof rule. */
function roofClutter(b: MeshBuilder, w: World, o: Solid, p: Palette, acc: number, acc2: number): void {
  if (o.hx < 1.6 || o.hz < 1.6) return;
  const y = o.yTop;
  // Low stuff anywhere: cisterns and vents under ROOF_CLUTTER_MAX.
  const nLow = Math.floor(sh(o, 20) * 3);
  for (let k = 0; k < nLow; k++) {
    const lx = (sh(o, 21 + k) - 0.5) * (o.hx * 2 - 2.4);
    const lz = (sh(o, 31 + k) - 0.5) * (o.hz * 2 - 2.4);
    const big = k === 0;
    b.box(lx2x(o, lx, lz), y + 0.14, lx2z(o, lx, lz), big ? 0.6 : 0.2, 0.14, big ? 0.4 : 0.2, o.cosR, o.sinR, big ? INK.white : dark(p.stone, 0.8), { top: big ? INK.teal : INK.ink });
  }
  const sx = sh(o, 40) < 0.5 ? 1 : -1;
  const sz = sh(o, 41) < 0.5 ? 1 : -1;
  // Corner water tank: its far side is ROOF_EDGE in from both edges.
  if (sh(o, 42) < 0.55) {
    const r = 0.3;
    const lx = sx * (o.hx - (ROOF_EDGE - r) + 0.02);
    const lz = sz * (o.hz - (ROOF_EDGE - r) + 0.02);
    prism(b, lx2x(o, lx, lz), lx2z(o, lx, lz), r, y, y + 1.15, 8, sh(o, 43) < 0.5 ? INK.cobalt : INK.white, INK.ink);
  }
  // Satellite dish on the middle of an edge.
  if (sh(o, 44) < 0.45) {
    const lz = -sz * (o.hz - 0.2);
    const x = lx2x(o, 0, lz);
    const z = lx2z(o, 0, lz);
    b.beam(x, y, z, x, y + 0.75, z, 0.035, INK.ink);
    disc2(b, x, y + 0.95, z, sz * o.sinR, -sz * o.cosR, 0.42, 8, INK.white, shade(INK.white, 0.85));
  }
  // Laundry frame along an edge.
  if (sh(o, 45) < 0.5 && o.hx > 2.2) {
    const lz = sz * (o.hz - 0.25);
    const ax = lx2x(o, -o.hx + 0.6, lz);
    const az = lx2z(o, -o.hx + 0.6, lz);
    const bx = lx2x(o, o.hx - 0.6, lz);
    const bz = lx2z(o, o.hx - 0.6, lz);
    b.beam(ax, y, az, ax, y + 1.5, az, 0.035, INK.ink);
    b.beam(bx, y, bz, bx, y + 1.5, bz, 0.035, INK.ink);
    b.beam(ax, y + 1.45, az, bx, y + 1.45, bz, 0.015, INK.ink);
    const n = Math.min(5, Math.floor((o.hx * 2 - 1.6) / 0.9));
    const cloth = [acc, INK.white, acc2, INK.pink, INK.mango];
    for (let k = 0; k < n; k++) {
      const t0 = (k + 0.15) / n;
      const t1 = (k + 0.85) / n;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;
      const yb = y + 1.45 - 0.45 - 0.2 * hash2(o.index, k);
      const col = cloth[k % cloth.length];
      b.quad(x0, yb, z0, x1, yb, z1, x1, y + 1.44, z1, x0, y + 1.44, z0, col);
      b.quad(x1, yb, z1, x0, yb, z0, x0, y + 1.44, z0, x1, y + 1.44, z1, shade(col, 0.9));
    }
  }
  // A parapet on some roofs: low coloured kerbs along the edges.
  if (sh(o, 46) < 0.35) {
    const t = 0.12;
    const hy = 0.12;
    b.box(lx2x(o, 0, o.hz - t), y + hy, lx2z(o, 0, o.hz - t), o.hx, hy, t, o.cosR, o.sinR, acc2);
    b.box(lx2x(o, 0, -o.hz + t), y + hy, lx2z(o, 0, -o.hz + t), o.hx, hy, t, o.cosR, o.sinR, acc2);
    b.box(lx2x(o, o.hx - t, 0), y + hy, lx2z(o, o.hx - t, 0), t, hy, o.hz - 2 * t, o.cosR, o.sinR, acc2);
    b.box(lx2x(o, -o.hx + t, 0), y + hy, lx2z(o, -o.hx + t, 0), t, hy, o.hz - 2 * t, o.cosR, o.sinR, acc2);
  }
}

// ---------------------------------------------------------------------------------------------
// Warehouses and sheds

function warehouse(b: MeshBuilder, w: World, o: Solid, shed: boolean): void {
  const p = paletteAt(w, o.cz);
  const wall = baseInk(w, o);
  const acc = accentFor(p, wall, o.style);
  const fish = !shed && o.style % 5 === 4;
  walls(b, o, wall);
  cap(b, o, 0.1, 0.25, dark(wall, 0.7), topInk(w, o));
  const faces = facesByWidth(o);
  const band = shed ? 0.7 : 1.1;
  let doorDone = false;
  for (let i = 0; i < 4; i++) {
    const f = faces[i];
    if (occluded(w, o, f)) continue;
    const g = faceGround(w, f);
    const top = o.yTop - 0.35;
    // Big sliding door on the widest street-side face.
    let d0 = 0;
    let d1 = 0;
    if (!doorDone && (streetSide(w, f) || i === 3)) {
      doorDone = true;
      const dw = Math.min(shed ? 1.8 : 6, 2 * f.hw - 2);
      const dh = Math.min(shed ? 2.2 : 5, top - g.hi - 1.2);
      if (dw > 1 && dh > 1.8) {
        d0 = (sh(o, 50) - 0.5) * (2 * f.hw - dw - 1.5) - dw / 2;
        d1 = d0 + dw;
        const dg = terrainHeight(w, fx(f, (d0 + d1) / 2, 0.3), fz(f, (d0 + d1) / 2, 0.3));
        fquad(b, f, d0 - 0.2, d1 + 0.2, Math.max(o.yBase, dg - 0.2), dg + dh + 0.2, 0.025, INK.ink);
        fquad(b, f, d0, d1, Math.max(o.yBase, dg - 0.2), dg + dh, 0.04, fish ? INK.white : acc);
        // Slats.
        for (let k = 1; k < 4; k++) fquad(b, f, d0, d1, dg + (dh * k) / 4 - 0.05, dg + (dh * k) / 4 + 0.05, 0.05, dark(fish ? INK.white : acc, 0.75));
        if (!shed) {
          // Bay number above the door on a dark plate.
          const n = 1 + (o.index % 24);
          const nh = Math.min(1.4, top - (dg + dh) - 0.5);
          if (nh > 0.6) {
            const nw = numberWidth(n, nh);
            const um = (d0 + d1) / 2;
            fquad(b, f, um - nw / 2 - 0.3, um + nw / 2 + 0.3, dg + dh + 0.3, dg + dh + 0.5 + nh, 0.03, INK.ink);
            fnumber(b, f, n, um - nw / 2, dg + dh + 0.4, nh, 0.05, INK.mango, 0.4);
          }
        }
      }
    }
    // Corrugation: vertical bands, skipping the door.
    const n = Math.floor((2 * f.hw) / band);
    for (let k = 0; k < n; k += 2) {
      const u0 = -f.hw + k * band + band * 0.25;
      const u1 = u0 + band * 0.5;
      if (d1 > d0 && u1 > d0 - 0.25 && u0 < d1 + 0.25) continue;
      fquad(b, f, u0, u1, Math.max(o.yBase, g.lo - 0.1), top, 0.02, dark(wall, 0.88));
    }
    if (fish) {
      // Fish market: teal and white awning stripes along the top, a fish on the side.
      const yb = top - 1.1;
      const m = Math.max(2, Math.floor((2 * f.hw) / 0.9));
      for (let k = 0; k < m; k++) fquad(b, f, -f.hw + (k * 2 * f.hw) / m, -f.hw + ((k + 1) * 2 * f.hw) / m, yb, top, 0.035, k % 2 ? INK.white : INK.teal);
      if (i === 1 && f.hw > 3 && yb - g.hi > 3) mural(b, f, -f.hw + 1, -f.hw + 1 + Math.min(7, 2 * f.hw - 2), g.hi + 0.8, yb - 0.3, 3, INK.mango, INK.teal, wall, o.index);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Containers, crates, kiosks, stalls

function container(b: MeshBuilder, w: World, o: Solid): void {
  const ink = baseInk(w, o);
  walls(b, o, ink, topInk(w, o));
  const faces = solidFaces(o);
  const y0 = o.yBase;
  const y1 = o.yTop;
  const seam = dark(ink, 0.55);
  const rib = dark(ink, 0.82);
  const longX = o.hz >= o.hx; // the +-x faces are the long sides when hz is the long half
  for (let i = 0; i < 4; i++) {
    const f = faces[i];
    const isLong = (i < 2) === longX;
    // Frame seams top and bottom, so stacks read as stacks.
    fquad(b, f, -f.hw, f.hw, y0, y0 + 0.14, 0.015, seam);
    fquad(b, f, -f.hw, f.hw, y1 - 0.1, y1, 0.015, seam);
    if (isLong) {
      const n = Math.floor((2 * f.hw) / 0.8);
      for (let k = 1; k < n; k += 1) {
        const u = -f.hw + (k * 2 * f.hw) / n;
        fquad(b, f, u - 0.12, u + 0.12, y0 + 0.14, y1 - 0.1, 0.015, rib);
      }
      if (o.style % 3 === 0) fquad(b, f, -f.hw + 0.3, f.hw - 0.3, y0 + (y1 - y0) * 0.55, y0 + (y1 - y0) * 0.68, 0.03, o.style % 2 ? INK.white : INK.ink);
    } else if (i === 0 || i === 2) {
      // Door end: four locking bars and the door split.
      fquad(b, f, -0.03, 0.03, y0 + 0.14, y1 - 0.1, 0.025, seam);
      for (let k = 0; k < 4; k++) {
        const u = -f.hw * 0.75 + (k * f.hw * 1.5) / 3;
        fquad(b, f, u - 0.035, u + 0.035, y0 + 0.2, y1 - 0.16, 0.035, INK.paper);
      }
    }
  }
}

function crate(b: MeshBuilder, w: World, o: Solid): void {
  const ink = baseInk(w, o);
  walls(b, o, ink, topInk(w, o));
  const faces = solidFaces(o);
  const slat = dark(ink, 0.7);
  const y0 = o.yBase;
  const y1 = o.yTop;
  const t = 0.09;
  for (const f of faces) {
    fquad(b, f, -f.hw, f.hw, y1 - 0.16, y1, 0.015, slat);
    fquad(b, f, -f.hw, f.hw, y0, y0 + 0.16, 0.015, slat);
    const h = Math.max(0.2, y1 - y0 - 0.32);
    // An X brace between the slats.
    fquad4(b, f, -f.hw + 0.05, y0 + 0.16, -f.hw + 0.05 + t * 2, y0 + 0.16, f.hw - 0.05, y0 + 0.16 + h, f.hw - 0.05 - t * 2, y0 + 0.16 + h, 0.02, slat);
    fquad4(b, f, f.hw - 0.05 - t * 2, y0 + 0.16, f.hw - 0.05, y0 + 0.16, -f.hw + 0.05 + t * 2, y0 + 0.16 + h, -f.hw + 0.05, y0 + 0.16 + h, 0.025, slat);
  }
}

/** The face of a small prop that opens onto a walkway (falls back to the widest face). */
function frontFace(w: World, o: Solid): Face {
  const faces = facesByWidth(o);
  for (const f of faces) {
    const x = fx(f, 0, 1.5);
    const z = fz(f, 0, 1.5);
    if (streetSide(w, f) && topHeight(w, x, z) < o.yBase + 1) return f;
  }
  return faces[0];
}

function kiosk(b: MeshBuilder, w: World, o: Solid): void {
  const p = paletteAt(w, o.cz);
  const ink = baseInk(w, o);
  const acc = accentFor(p, ink, o.style);
  walls(b, o, ink);
  cap(b, o, 0.12, 0.22, dark(ink, 0.7), topInk(w, o));
  const f = frontFace(w, o);
  const g = faceGround(w, f).hi;
  const wy0 = Math.max(o.yBase + 0.3, g + 0.95);
  const wy1 = Math.min(o.yTop - 0.4, g + 2.1);
  if (wy1 - wy0 > 0.5 && f.hw > 0.8) {
    const ww = Math.min(f.hw - 0.3, 2.2);
    fquad(b, f, -ww, ww, wy0, wy1, 0.03, WINDOW_INK, 0.9);
    fbox(b, f, 0, wy0 - 0.05, ww + 0.1, 0.05, 0.3, 0.02, INK.paper);
    // Striped flap awning tilted out over the window, drawn both sides.
    const n = Math.max(2, Math.round((ww * 2) / 0.5));
    for (let k = 0; k < n; k++) {
      const u0 = -ww - 0.1 + (k * (2 * ww + 0.2)) / n;
      const u1 = -ww - 0.1 + ((k + 1) * (2 * ww + 0.2)) / n;
      const col = k % 2 ? INK.white : acc;
      const ax = fx(f, u0, 0.02);
      const az = fz(f, u0, 0.02);
      const bx = fx(f, u1, 0.02);
      const bz = fz(f, u1, 0.02);
      const cx = fx(f, u1, 0.75);
      const cz = fz(f, u1, 0.75);
      const dx = fx(f, u0, 0.75);
      const dz = fz(f, u0, 0.75);
      b.quad(dx, wy1 - 0.25, dz, cx, wy1 - 0.25, cz, bx, wy1 + 0.2, bz, ax, wy1 + 0.2, az, col);
      b.quad(ax, wy1 + 0.2, az, bx, wy1 + 0.2, bz, cx, wy1 - 0.25, cz, dx, wy1 - 0.25, dz, shade(col, 0.85));
    }
  }
  // A glowing sign board standing on the front edge of the roof (inside the edge band).
  if (f.hw > 0.6) {
    const sw = Math.min(f.hw - 0.1, 1.6);
    const sx = f.cx - f.nx * 0.12;
    const sz = f.cz - f.nz * 0.12;
    b.box(sx, o.yTop + 0.38, sz, sw, 0.36, 0.05, f.rx, f.rz, acc, { glow: 0.85, top: INK.ink });
  }
}

function stall(b: MeshBuilder, w: World, o: Solid): void {
  const p = paletteAt(w, o.cz);
  const wood = baseInk(w, o);
  const acc = p.accents[o.style % 2];
  walls(b, o, wood);
  // Striped canopy as the skateable lid: stripes across the long axis.
  const longX = o.hx >= o.hz;
  const L = longX ? o.hx : o.hz;
  const n = Math.max(2, Math.round((L * 2) / 0.6));
  for (let k = 0; k < n; k++) {
    const a0 = -L + (k * 2 * L) / n;
    const a1 = -L + ((k + 1) * 2 * L) / n;
    const col = k % 2 ? INK.white : acc;
    const [x0, z0, x1, z1] = longX ? [a0, -o.hz, a1, o.hz] : [-o.hx, a0, o.hx, a1];
    b.quad(
      lx2x(o, x0, z0), o.yTop, lx2z(o, x0, z0),
      lx2x(o, x0, z1), o.yTop, lx2z(o, x0, z1),
      lx2x(o, x1, z1), o.yTop, lx2z(o, x1, z1),
      lx2x(o, x1, z0), o.yTop, lx2z(o, x1, z0),
      col,
    );
  }
  const f = frontFace(w, o);
  const g = faceGround(w, f).hi;
  // Counter opening with goods on it.
  const cy0 = Math.max(o.yBase + 0.2, g + 0.9);
  const cy1 = o.yTop - 0.45;
  if (cy1 - cy0 > 0.4) {
    fquad(b, f, -f.hw + 0.25, f.hw - 0.25, cy0, cy1, 0.025, dark(wood, 0.45));
    const goods = Math.min(5, Math.floor((f.hw * 2 - 0.6) / 0.55));
    for (let k = 0; k < goods; k++) {
      const u = -f.hw + 0.55 + k * 0.55;
      fbox(b, f, u, cy0 + 0.13, 0.18, 0.13, 0.3, 0.03, PROP_INKS[(k + o.index) % PROP_INKS.length]);
    }
  }
  // Scalloped valance hanging under the canopy edge, with string bulbs.
  const m = Math.max(2, Math.round((f.hw * 2) / 0.5));
  for (let k = 0; k < m; k++) {
    const u0 = -f.hw + (k * 2 * f.hw) / m;
    const u1 = -f.hw + ((k + 1) * 2 * f.hw) / m;
    const col = k % 2 ? INK.white : acc;
    fquad(b, f, u0, u1, o.yTop - 0.2, o.yTop, 0.04, col);
    ftri(b, f, u0, o.yTop - 0.2, (u0 + u1) / 2, o.yTop - 0.38, u1, o.yTop - 0.2, 0.04, col);
    fquad(b, f, (u0 + u1) / 2 - 0.05, (u0 + u1) / 2 + 0.05, o.yTop - 0.5, o.yTop - 0.4, 0.06, 0xffe3a0, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Awnings

function awning(b: MeshBuilder, w: World, o: Solid): void {
  const ink = baseInk(w, o);
  const longX = o.hx >= o.hz;
  // The back edge is the side against a taller solid; the front edge hangs the scallops.
  const L = longX ? o.hx : o.hz;
  const D = longX ? o.hz : o.hx;
  const backSign = (() => {
    const px = longX ? 0 : D + 0.8;
    const pz = longX ? D + 0.8 : 0;
    const plus = topHeight(w, lx2x(o, px, pz), lx2z(o, px, pz));
    const minus = topHeight(w, lx2x(o, -px, -pz), lx2z(o, -px, -pz));
    return plus >= minus ? 1 : -1;
  })();
  const n = Math.max(2, Math.round((L * 2) / 0.7));
  const y0 = o.yBase;
  const y1 = o.yTop;
  // Local point from (along, across).
  const P = (a: number, c: number): [number, number] => (longX ? [lx2x(o, a, c), lx2z(o, a, c)] : [lx2x(o, c, a), lx2z(o, c, a)]);
  // The stripes run front to back; the box faces are drawn stripe by stripe so the edges stripe too.
  for (let k = 0; k < n; k++) {
    const a0 = -L + (k * 2 * L) / n;
    const a1 = -L + ((k + 1) * 2 * L) / n;
    const col = k % 2 ? INK.white : ink;
    const am = (a0 + a1) / 2;
    const ha = (a1 - a0) / 2;
    const [cx, cz] = P(am, 0);
    const [hx, hz] = longX ? [ha, D] : [D, ha];
    b.box(cx, (y0 + y1) / 2, cz, hx, (y1 - y0) / 2, hz, o.cosR, o.sinR, col, { bottom: true, top: col });
  }
  // Scallops along the front edge, double-sided.
  const front = -backSign * D;
  const m = Math.max(2, Math.round((L * 2) / 0.45));
  for (let k = 0; k < m; k++) {
    const a0 = -L + (k * 2 * L) / m;
    const a1 = -L + ((k + 1) * 2 * L) / m;
    const [ax, az] = P(a0, front);
    const [bx, bz] = P(a1, front);
    const [mx, mz] = P((a0 + a1) / 2, front);
    const col = k % 2 ? INK.white : ink;
    const v0 = b.vert(ax, y0, az, col);
    const v1 = b.vert(bx, y0, bz, col);
    const v2 = b.vert(mx, y0 - 0.22, mz, col);
    b.tri(v0, v1, v2);
    b.tri(v0, v2, v1);
  }
}

// ---------------------------------------------------------------------------------------------
// Retaining walls and quays

function retaining(b: MeshBuilder, w: World, o: Solid, quay: boolean): void {
  const p = paletteAt(w, o.cz);
  const stone = baseInk(w, o);
  walls(b, o, stone);
  cap(b, o, 0.06, 0.35, light(stone, 1.06), topInk(w, o));
  const faces = solidFaces(o);
  const longX = o.hz >= o.hx;
  // The exposed long face: the one with lower ground (or water) in front of it.
  const a = faces[longX ? 0 : 2];
  const c = faces[longX ? 1 : 3];
  const ga = faceGround(w, a);
  const gc = faceGround(w, c);
  const exposed = ga.lo <= gc.lo ? a : c;
  const g = exposed === a ? ga : gc;
  const course = dark(stone, 0.84);
  for (const f of [a, c]) {
    const fg = f === a ? ga : gc;
    for (let y = Math.max(o.yBase, fg.lo) + 1.2; y < o.yTop - 0.5; y += 1.2) fquad(b, f, -f.hw, f.hw, y, y + 0.05, 0.015, course);
  }
  const H = o.yTop - Math.max(o.yBase, g.lo);
  if (!quay) {
    // Stencilled numbers along the exposed face.
    if (H >= 2.6 && exposed.hw > 3) {
      const nh = Math.min(1.8, H - 1.2);
      const step = 22;
      const count = Math.max(1, Math.floor((2 * exposed.hw) / step));
      for (let k = 0; k < count; k++) {
        if (hash2(o.index, k) > 0.7) continue;
        const num = 1 + ((o.index * 7 + k * 3) % 98);
        const u = -exposed.hw + (k + 0.5) * ((2 * exposed.hw) / count);
        const nw = numberWidth(num, nh);
        fnumber(b, exposed, num, u - nw / 2, Math.max(o.yBase, g.lo) + 0.5, nh, 0.04, p.accents[(o.index + k) % 2]);
      }
    }
    return;
  }
  // Quay: tyre fenders on the sea face, hazard blocks along its top, bollards on the cap.
  const fenders = Math.floor((2 * exposed.hw) / 5);
  for (let k = 0; k < fenders; k++) {
    const u = -exposed.hw + (k + 0.5) * ((2 * exposed.hw) / fenders);
    const fy = Math.max(o.yBase + 0.4, o.yTop - 1.0);
    fbox(b, exposed, u, fy, 0.32, 0.36, 0.22, 0.01, INK.ink, 0, 0x34324a);
  }
  const blocks = Math.max(2, Math.floor((2 * exposed.hw) / 1.5));
  for (let k = 0; k < blocks; k += 2) {
    const u0 = -exposed.hw + (k * 2 * exposed.hw) / blocks;
    const u1 = -exposed.hw + ((k + 1) * 2 * exposed.hw) / blocks;
    fquad(b, exposed, u0, u1, o.yTop - 0.33, o.yTop - 0.02, 0.07, INK.mango);
  }
  const depth = exposed.hd;
  const bollards = Math.floor((2 * exposed.hw) / 7);
  for (let k = 0; k < bollards; k++) {
    const u = -exposed.hw + (k + 0.5) * ((2 * exposed.hw) / bollards);
    const inward = Math.min(0.3, depth);
    prism(b, fx(exposed, u, -inward), fz(exposed, u, -inward), 0.16, o.yTop, o.yTop + 0.28, 6, INK.mango, INK.ink);
  }
}

// ---------------------------------------------------------------------------------------------
// Masts, pylons, tanks, platforms

function mast(b: MeshBuilder, w: World, o: Solid, ink: number): void {
  const H = o.yTop - o.yBase;
  const bands = Math.max(1, Math.round(H / 3));
  const bh = H / bands;
  for (let k = 0; k < bands; k++) {
    const y0 = o.yBase + k * bh;
    const last = k === bands - 1;
    const col = k % 2 === 0 ? ink : INK.white;
    b.box(o.cx, y0 + bh / 2, o.cz, o.hx, bh / 2, o.hz, o.cosR, o.sinR, col, last ? { top: topInk(w, o) } : { noTop: true });
  }
  // Painted lattice: crossed braces on every face of every band.
  const faces = solidFaces(o);
  const t = Math.min(0.06, o.hx * 0.25, o.hz * 0.25);
  for (const f of faces) {
    if (f.hw < 0.15) continue;
    // Corner legs.
    fquad(b, f, -f.hw, -f.hw + t, o.yBase, o.yTop, 0.015, INK.ink);
    fquad(b, f, f.hw - t, f.hw, o.yBase, o.yTop, 0.015, INK.ink);
    for (let k = 0; k < bands; k++) {
      const y0 = o.yBase + k * bh;
      const y1 = y0 + bh;
      fquad4(b, f, -f.hw, y0, -f.hw + t * 1.5, y0, f.hw, y1, f.hw - t * 1.5, y1, 0.02, INK.ink);
      fquad4(b, f, f.hw - t * 1.5, y0, f.hw, y0, -f.hw + t * 1.5, y1, -f.hw, y1, 0.025, INK.ink);
    }
  }
  // Lamps: one on top, aviation lights every 9 m on two faces.
  const lamp = Math.min(0.14, o.hx, o.hz);
  b.box(o.cx, o.yTop + lamp, o.cz, lamp, lamp, lamp, o.cosR, o.sinR, INK.pink, { glow: 1, top: INK.mango });
  for (let y = o.yBase + 9; y < o.yTop - 2; y += 9) {
    fbox(b, faces[0], 0, y, 0.1, 0.1, 0.12, 0.01, INK.mango, 1);
    fbox(b, faces[1], 0, y, 0.1, 0.1, 0.12, 0.01, INK.mango, 1);
  }
}

function tank(b: MeshBuilder, w: World, o: Solid): void {
  const p = paletteAt(w, o.cz);
  const ink = baseInk(w, o);
  walls(b, o, ink);
  cap(b, o, 0.08, 0.2, dark(ink, 0.8), topInk(w, o));
  const faces = solidFaces(o);
  const H = o.yTop - o.yBase;
  for (let i = 0; i < 4; i++) {
    const f = faces[i];
    fquad(b, f, -f.hw, f.hw, o.yBase + H * 0.25, o.yBase + H * 0.32, 0.02, p.accents[0]);
    fquad(b, f, -f.hw, f.hw, o.yBase + H * 0.36, o.yBase + H * 0.4, 0.02, p.accents[1]);
  }
  // Ladder on one face, a painted number on the opposite.
  const f = faces[0];
  const lu = f.hw * 0.6;
  fquad(b, f, lu - 0.25, lu - 0.21, o.yBase, o.yTop, 0.06, INK.ink);
  fquad(b, f, lu + 0.21, lu + 0.25, o.yBase, o.yTop, 0.06, INK.ink);
  for (let y = o.yBase + 0.4; y < o.yTop - 0.2; y += 0.45) fquad(b, f, lu - 0.21, lu + 0.21, y, y + 0.04, 0.06, INK.ink);
  const g = faces[1];
  const nh = Math.min(H * 0.35, g.hw);
  if (nh > 0.5) {
    const num = 1 + (o.index % 9);
    const nw = numberWidth(num, nh);
    fnumber(b, g, num, -nw / 2, o.yBase + H * 0.5, nh, 0.03, p.accents[0]);
  }
}

function platform(b: MeshBuilder, w: World, o: Solid): void {
  const ink = baseInk(w, o);
  walls(b, o, ink, topInk(w, o));
  const faces = solidFaces(o);
  // Railings along every edge, just inside it; lamps on the corner posts.
  const inset = 0.1;
  const y = o.yTop;
  for (const f of faces) {
    const n = Math.max(1, Math.round((2 * f.hw) / 1.4));
    const off = -inset;
    for (let k = 0; k <= n; k++) {
      const u = -f.hw + inset + ((2 * f.hw - 2 * inset) * k) / n;
      const x = fx(f, u, off);
      const z = fz(f, u, off);
      b.beam(x, y, z, x, y + 1.0, z, 0.03, INK.white);
    }
    const ax = fx(f, -f.hw + inset, off);
    const az = fz(f, -f.hw + inset, off);
    const bx = fx(f, f.hw - inset, off);
    const bz = fz(f, f.hw - inset, off);
    b.beam(ax, y + 1.0, az, bx, y + 1.0, bz, 0.035, INK.pink);
    b.beam(ax, y + 0.5, az, bx, y + 0.5, bz, 0.025, INK.white);
    b.box(ax, y + 1.1, az, 0.08, 0.08, 0.08, 1, 0, INK.mango, { glow: 1 });
  }
}

