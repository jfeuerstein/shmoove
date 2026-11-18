/**
 * Night lights for buildings: where their windows go, and which are lit.
 *
 * Every window is a WINDOW_INK quad; a lit one carries `glow` 1, which the ink material turns
 * mango as night falls (src/render/look.ts), so lighting is baked into chunk geometry and costs
 * nothing per frame. Which windows are lit is a pure function of the solid's index (hash2).
 *
 * The plans here are shared by the near dressing (src/render/dress/solids.ts draws the facade
 * from them) and the far level of detail, which draws only the lit glass of the same windows, two
 * triangles each, on the plain silhouette box, so a far hill still reads as a lit town and a
 * chunk swapping far for near keeps its lights where they were.
 *
 * Besides the facade grid laid from the highest ground along a face, two kinds of window are
 * added for the night: windows laid from the ground under each column, down the slope where a
 * face runs along a stepped street (the facade grid starts above the top of the slope, so those
 * walls had none), and skylights on flat roofs, which are what the camera mostly sees of a city
 * below it.
 */
import { Surface, terrainHeight, type Solid, type World } from '../../sim/world';
import { type MeshBuilder, hash2 } from '../geom';
import {
  WINDOW_INK,
  dark,
  faceGround,
  facesByWidth,
  fquad,
  fx,
  fz,
  lx2x,
  lx2z,
  occluded,
  sh,
  solidFaces,
  streetSide,
  type Face,
} from './kit';

/** Building variants: 0 town building, 1 house, 2 clock tower, 3 church, 4 school. */
export type Variant = 0 | 1 | 2 | 3 | 4;

/**
 * How far window glass stands off the wall: between shutters, in a painted frame, on the ground
 * floor and in the shop window. The far level of detail draws its lit glass at exactly the near
 * glass's place, so its corners are near corners too and a swap moves no light.
 */
const GLASS_SHUTTERED = 0.03;
const GLASS_FRAMED = 0.045;
const GLASS_GROUND = 0.03;
const GLASS_SHOP = 0.035;

/** Height of a roof lantern (under ROOF_CLUTTER_MAX, 0.35 m, so it may stand anywhere on a roof). */
const LANTERN_H = 0.3;

/** Lit shares (thresholds on hash2): facade grid upper floors, ground floor, slope windows, skylights. */
const LIT_UPPER = 0.5;
const LIT_GROUND = 0.55;
const LIT_SLOPE = 0.45;
const LIT_SKY = 0.3;
const LIT_SHOP = 0.75;

export interface FacePlan {
  f: Face;
  /** Not hidden by a neighbour: only open faces are dressed. */
  open: boolean;
  /** Highest ground along the foot of the face (the facade grid starts from it). */
  gHi: number;
  /** Window columns and their pitch along the face. */
  cols: number;
  pitch: number;
  /** Mural rectangle; drawn when my1 > my0. */
  mu0: number;
  mu1: number;
  my0: number;
  my1: number;
  /** Front door: centre, ground at the door, and whether it is drawn. */
  door: boolean;
  du: number;
  dg: number;
  /** Shop window beside the door: ends, ground, whether drawn. */
  shop: boolean;
  s0: number;
  s1: number;
  sg: number;
  /** Span of the door, sign and shop window along u (empty when busy1 <= busy0). */
  busy0: number;
  busy1: number;
}

export interface BuildingPlan {
  variant: Variant;
  storey: number;
  winH: number;
  ww: number;
  front: number;
  muralFace: number;
  faces: FacePlan[];
}

/**
 * Where a building's facade goes: per face whether it is open, its ground, window grid, mural,
 * door and shop window. Exactly the numbers the near dressing has always used.
 */
export function planBuilding(w: World, o: Solid, variant: Variant): BuildingPlan {
  const storey = variant === 1 ? 2.7 : 3.1;
  const winH = variant === 1 ? 1.1 : 1.35;
  const ww = variant === 1 ? 0.42 : 0.5;
  const sides = solidFaces(o);
  const faces: FacePlan[] = [];
  for (let i = 0; i < 4; i++) {
    const f = sides[i];
    const open = !occluded(w, o, f);
    const gHi = open ? faceGround(w, f).hi : 0;
    const cols = Math.floor((2 * f.hw - 0.6) / (variant === 1 ? 2.4 : 2.7));
    const pitch = cols >= 1 ? (2 * f.hw) / cols : 0;
    faces.push({ f, open, gHi, cols, pitch, mu0: 0, mu1: 0, my0: 0, my1: 0, door: false, du: 0, dg: 0, shop: false, s0: 0, s1: 0, sg: 0, busy0: 0, busy1: 0 });
  }
  // Front: a street-side face that is not hidden; it gets the door, shopfront and signs.
  let front = -1;
  for (let i = 0; i < 4; i++) {
    const f = sides[i];
    if (faces[i].open && f.hw >= 1.4 && streetSide(w, f) && (front < 0 || f.hw > sides[front].hw)) front = i;
  }
  // Mural: the widest open face with room for one (the front if it is as wide).
  let muralFace = -1;
  if (variant !== 3 && (variant === 4 || sh(o, 3) < 0.75)) {
    for (let i = 0; i < 4; i++) {
      if (!faces[i].open || sides[i].hw < 2.2) continue;
      if (muralFace < 0 || sides[i].hw > sides[muralFace].hw + 0.01 || (i === front && sides[i].hw >= sides[muralFace].hw - 0.01)) muralFace = i;
    }
  }
  if (muralFace >= 0) {
    const p = faces[muralFace];
    const f = p.f;
    p.my0 = p.gHi + storey + 0.25;
    p.my1 = Math.min(o.yTop - 0.6, p.my0 + 4 + 3 * sh(o, 7));
    if (p.my1 - p.my0 >= 2.4) {
      const width = Math.min(2 * f.hw - 1.0, 4 + 6 * sh(o, 8));
      const centre = (sh(o, 9) - 0.5) * (2 * f.hw - 1.0 - width);
      p.mu0 = centre - width / 2;
      p.mu1 = centre + width / 2;
    } else {
      p.my1 = p.my0;
    }
  }
  if (front >= 0) {
    const p = faces[front];
    const f = p.f;
    p.du = (sh(o, 11) - 0.5) * Math.max(0, 2 * f.hw - 3);
    p.dg = terrainHeight(w, fx(f, p.du, 0.3), fz(f, p.du, 0.3));
    if (p.dg > o.yBase + 0.02 && p.dg + 2.6 < o.yTop) {
      p.door = true;
      const side = p.du < 0 ? 1 : -1;
      p.s0 = p.du + side * 1.1;
      p.s1 = side > 0 ? Math.min(f.hw - 0.4, p.s0 + 2.6) : Math.max(-f.hw + 0.4, p.s0 - 2.6);
      p.busy0 = Math.min(p.du - 0.8, p.s0, p.s1);
      p.busy1 = Math.max(p.du + 0.8, p.s0, p.s1);
      if (Math.abs(p.s1 - p.s0) > 1) {
        p.shop = true;
        p.sg = terrainHeight(w, fx(f, (p.s0 + p.s1) / 2, 0.3), fz(f, (p.s0 + p.s1) / 2, 0.3));
      }
    }
  }
  return { variant, storey, winH, ww, front, muralFace, faces };
}

/** Does this building's facade have shutters (else painted frames)? */
export function hasShutters(o: Solid): boolean {
  return sh(o, 5) < 0.5;
}

/** Is upper-floor window (r, c) on face i lit? */
export function litUpper(o: Solid, i: number, r: number, c: number): number {
  return hash2(o.index * 31 + r * 7 + c, i) > LIT_UPPER ? 1 : 0;
}

/** Is ground-floor window c on face i lit? */
export function litGround(o: Solid, i: number, c: number): number {
  return hash2(o.index * 13 + c, i + 9) > LIT_GROUND ? 1 : 0;
}

/** Is the shop window lit? */
export function litShop(o: Solid): number {
  return sh(o, 12) < LIT_SHOP ? 1 : 0;
}

/** A window: its span on a face (or on the roof, for skylights) and whether it is lit. */
type WindowFn = (u0: number, u1: number, y0: number, y1: number, lit: number) => void;

/**
 * Slope windows on face i: in each column, a storey grid laid from the ground under that column,
 * kept below the facade grid (or, on a wall too short for the facade grid, up to the cap), and
 * clear of the door, shop window and sign, and of the church front.
 */
export function slopeWindows(w: World, o: Solid, plan: BuildingPlan, i: number, fn: WindowFn): void {
  const p = plan.faces[i];
  if (!p.open || p.cols < 1) return;
  if (plan.variant === 3 && i === (plan.front >= 0 ? plan.front : 0)) return;
  const f = p.f;
  const oldGround = p.gHi + 2.4 < o.yTop - 0.5;
  const oldUpper = p.gHi + plan.storey + 0.6 + plan.winH <= o.yTop - 0.4;
  const limit = oldGround || oldUpper ? p.gHi + 0.6 : o.yTop - 0.4;
  for (let c = 0; c < p.cols; c++) {
    const u = -f.hw + (c + 0.5) * p.pitch;
    if (p.busy1 > p.busy0 && u + 0.9 > p.busy0 - 0.3 && u - 0.9 < p.busy1 + 0.3) continue;
    const ga = terrainHeight(w, fx(f, u - 0.6, 0.3), fz(f, u - 0.6, 0.3));
    const gb = terrainHeight(w, fx(f, u + 0.6, 0.3), fz(f, u + 0.6, 0.3));
    const gc = Math.max(ga, gb, o.yBase);
    for (let k = 0; ; k++) {
      const hw = k === 0 ? 0.45 : plan.ww;
      const y0 = k === 0 ? gc + 0.95 : gc + k * plan.storey + 0.6;
      const y1 = k === 0 ? gc + 2.15 : y0 + plan.winH;
      if (y1 > limit) break;
      fn(u - hw, u + hw, y0, y1, hash2(o.index * 53 + k * 5 + c, i + 17) > LIT_SLOPE ? 1 : 0);
    }
  }
}

/** Does this solid get skylights? Flat-roofed town buildings, houses and warehouses. */
function hasSkylights(o: Solid, variant: Variant | -1): boolean {
  if (o.surface !== Surface.ROOF || o.hx < 1.6 || o.hz < 1.6) return false;
  return variant === 0 || variant === 1 || variant === -1;
}

/**
 * Skylights (roof lanterns) along the long axis of a flat roof: (along0, along1, across0,
 * across1) in the solid's local frame.
 */
function skylights(o: Solid, fn: WindowFn): void {
  const longX = o.hx >= o.hz;
  const L = longX ? o.hx : o.hz;
  const D = longX ? o.hz : o.hx;
  const n = Math.max(1, Math.min(3, Math.floor(L / 3.2)));
  const ha = Math.min(0.9, L / n - 0.5);
  const hc = Math.min(0.55, D - 0.9);
  if (ha < 0.3 || hc < 0.3) return;
  for (let k = 0; k < n; k++) {
    const a = -L + ((k + 0.5) * 2 * L) / n;
    const c = (sh(o, 61 + k) - 0.5) * 2 * Math.max(0, D - 1.0 - hc);
    fn(a - ha, a + ha, c - hc, c + hc, hash2(o.index * 7 + k, 77) > LIT_SKY ? 1 : 0);
  }
}

/** An upward-facing quad over the roof at height y, from local (along, across) spans. */
function roofQuad(b: MeshBuilder, o: Solid, a0: number, a1: number, c0: number, c1: number, y: number, color: number): void {
  const longX = o.hx >= o.hz;
  const [x0, z0, x1, z1] = longX ? [a0, c0, a1, c1] : [c0, a0, c1, a1];
  b.quad(
    lx2x(o, x0, z0), y, lx2z(o, x0, z0),
    lx2x(o, x0, z1), y, lx2z(o, x0, z1),
    lx2x(o, x1, z1), y, lx2z(o, x1, z1),
    lx2x(o, x1, z0), y, lx2z(o, x1, z0),
    color,
  );
}

/**
 * A roof lantern: a low glass box standing on the roof (under ROOF_CLUTTER_MAX, so roofs stay
 * rideable), from local (along, across) spans. Its glass sides catch the eye even when the roof
 * is seen almost edge-on from up the hill.
 */
function lantern(b: MeshBuilder, o: Solid, a0: number, a1: number, c0: number, c1: number, glow: number): void {
  const longX = o.hx >= o.hz;
  const am = (a0 + a1) / 2;
  const cm = (c0 + c1) / 2;
  const ha = (a1 - a0) / 2;
  const hc = (c1 - c0) / 2;
  const [lx, lz, hx, hz] = longX ? [am, cm, ha, hc] : [cm, am, hc, ha];
  const hy = LANTERN_H / 2;
  b.box(lx2x(o, lx, lz), o.yTop + hy, lx2z(o, lx, lz), hx, hy, hz, o.cosR, o.sinR, WINDOW_INK, { glow });
}

/** Near: roof lanterns on a framed curb, lit or dark. */
export function nearSkylights(b: MeshBuilder, o: Solid, variant: Variant | -1, roof: number): void {
  if (!hasSkylights(o, variant)) return;
  const frame = dark(roof, 0.62);
  skylights(o, (a0, a1, c0, c1, lit) => {
    roofQuad(b, o, a0 - 0.14, a1 + 0.14, c0 - 0.14, c1 + 0.14, o.yTop + 0.04, frame);
    lantern(b, o, a0, a1, c0, c1, lit);
  });
}

/** Near: the slope windows of a building, framed like the rest of its facade. */
export function nearSlopeWindows(b: MeshBuilder, w: World, o: Solid, plan: BuildingPlan, acc: number, frame: number): void {
  const shutters = hasShutters(o);
  for (let i = 0; i < 4; i++) {
    const f = plan.faces[i].f;
    slopeWindows(w, o, plan, i, (u0, u1, y0, y1, lit) => {
      if (shutters) {
        fquad(b, f, u0, u1, y0, y1, GLASS_SHUTTERED, WINDOW_INK, lit);
        fquad(b, f, u0 - 0.42, u0 - 0.02, y0, y1, 0.04, acc);
        fquad(b, f, u1 + 0.02, u1 + 0.42, y0, y1, 0.04, acc);
      } else {
        fquad(b, f, u0 - 0.12, u1 + 0.12, y0 - 0.12, y1 + 0.12, 0.03, frame);
        fquad(b, f, u0, u1, y0, y1, GLASS_FRAMED, WINDOW_INK, lit);
      }
    });
  }
}

/**
 * Far: the lit glass of a building's windows (facade grid, ground floor, shop window, slope
 * windows and skylights), two triangles each, on the silhouette box.
 */
export function farBuildingLights(b: MeshBuilder, w: World, o: Solid, variant: Variant): void {
  const plan = planBuilding(w, o, variant);
  const glass = hasShutters(o) ? GLASS_SHUTTERED : GLASS_FRAMED;
  for (let i = 0; i < 4; i++) {
    const p = plan.faces[i];
    if (!p.open) continue;
    const f = p.f;
    if (p.cols >= 1) {
      for (let r = 1; ; r++) {
        const y0 = p.gHi + r * plan.storey + 0.6;
        const y1 = y0 + plan.winH;
        if (y1 > o.yTop - 0.4) break;
        for (let c = 0; c < p.cols; c++) {
          const u = -f.hw + (c + 0.5) * p.pitch;
          if (p.my1 > p.my0 && u + 0.9 > p.mu0 && u - 0.9 < p.mu1 && y1 > p.my0 && y0 < p.my1) continue;
          if (litUpper(o, i, r, c)) fquad(b, f, u - plan.ww, u + plan.ww, y0, y1, glass, WINDOW_INK, 1);
        }
      }
      if (p.gHi + 2.4 < o.yTop - 0.5) {
        for (let c = 0; c < p.cols; c++) {
          const u = -f.hw + (c + 0.5) * p.pitch;
          if (p.busy1 > p.busy0 && u + 0.5 > p.busy0 && u - 0.5 < p.busy1) continue;
          if (i !== plan.front && (c & 1) === 1) continue;
          if (litGround(o, i, c)) fquad(b, f, u - 0.45, u + 0.45, p.gHi + 0.95, p.gHi + 2.15, GLASS_GROUND, WINDOW_INK, 1);
        }
      }
    }
    if (p.shop && litShop(o)) fquad(b, f, Math.min(p.s0, p.s1), Math.max(p.s0, p.s1), p.sg + 0.7, p.sg + 2.2, GLASS_SHOP, WINDOW_INK, 1);
    slopeWindows(w, o, plan, i, (u0, u1, y0, y1, lit) => {
      if (lit) fquad(b, f, u0, u1, y0, y1, glass, WINDOW_INK, 1);
    });
  }
  if (hasSkylights(o, variant)) {
    skylights(o, (a0, a1, c0, c1, lit) => {
      if (lit) lantern(b, o, a0, a1, c0, c1, 1);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Warehouses and sheds

export interface ShedFacePlan {
  f: Face;
  open: boolean;
  gHi: number;
  gLo: number;
  /** The sliding door's span along u; none when d1 <= d0. */
  d0: number;
  d1: number;
  /** This face got the door (even when it was too small to draw). */
  doorFace: boolean;
}

/** Where a warehouse, market or shed puts its door: faces widest first, as it has always done. */
export function planShed(w: World, o: Solid, shed: boolean): ShedFacePlan[] {
  const faces = facesByWidth(o);
  const out: ShedFacePlan[] = [];
  let doorDone = false;
  const top = o.yTop - 0.35;
  for (let i = 0; i < 4; i++) {
    const f = faces[i];
    const open = !occluded(w, o, f);
    const p: ShedFacePlan = { f, open, gHi: 0, gLo: 0, d0: 0, d1: 0, doorFace: false };
    out.push(p);
    if (!open) continue;
    const g = faceGround(w, f);
    p.gHi = g.hi;
    p.gLo = g.lo;
    if (!doorDone && (streetSide(w, f) || i === 3)) {
      doorDone = true;
      p.doorFace = true;
      const dw = Math.min(shed ? 1.8 : 6, 2 * f.hw - 2);
      const dh = Math.min(shed ? 2.2 : 5, top - g.hi - 1.2);
      if (dw > 1 && dh > 1.8) {
        p.d0 = (sh(o, 50) - 0.5) * (2 * f.hw - dw - 1.5) - dw / 2;
        p.d1 = p.d0 + dw;
      }
    }
  }
  return out;
}

/**
 * Warehouse clerestory windows high on every open face (clear of the door and its bay number),
 * and one window on each open side of a shed that is not its door side.
 */
function shedWindows(o: Solid, faces: ShedFacePlan[], shed: boolean, fn: (f: Face, u0: number, u1: number, y0: number, y1: number, lit: number) => void): void {
  const top = o.yTop - 0.35;
  for (let i = 0; i < 4; i++) {
    const p = faces[i];
    if (!p.open) continue;
    const f = p.f;
    if (shed) {
      if (p.doorFace || f.hw < 0.9) continue;
      const y0 = p.gHi + 1.1;
      const y1 = p.gHi + 1.8;
      if (y1 > top - 0.2) continue;
      fn(f, -0.42, 0.42, y0, y1, hash2(o.index * 41 + i, 29) > LIT_SLOPE ? 1 : 0);
      continue;
    }
    if (top - p.gHi < 4.6) continue;
    const m = Math.floor((2 * f.hw - 1) / 3.2);
    if (m < 1) continue;
    const pitch = (2 * f.hw) / m;
    // Keep clear of the door and the bay number plate over it (at least 3 m wide).
    const dm = (p.d0 + p.d1) / 2;
    const dh = Math.max((p.d1 - p.d0) / 2, 1.5) + 0.4;
    for (let k = 0; k < m; k++) {
      const u = -f.hw + (k + 0.5) * pitch;
      if (p.d1 > p.d0 && Math.abs(u - dm) < dh + 0.6) continue;
      fn(f, u - 0.6, u + 0.6, top - 1.75, top - 0.75, hash2(o.index * 41 + k, i + 23) > LIT_SLOPE ? 1 : 0);
    }
  }
}

/** Near: warehouse and shed windows, framed in the wall's dark, plus skylights on warehouses. */
export function nearShedLights(b: MeshBuilder, w: World, o: Solid, shed: boolean, wall: number, roof: number): void {
  const faces = planShed(w, o, shed);
  const frame = dark(wall, 0.55);
  shedWindows(o, faces, shed, (f, u0, u1, y0, y1, lit) => {
    fquad(b, f, u0 - 0.1, u1 + 0.1, y0 - 0.1, y1 + 0.1, 0.03, frame);
    fquad(b, f, u0, u1, y0, y1, GLASS_FRAMED, WINDOW_INK, lit);
  });
  if (!shed) nearSkylights(b, o, -1, roof);
}

/** Far: the lit glass of warehouse and shed windows and warehouse skylights. */
export function farShedLights(b: MeshBuilder, w: World, o: Solid, shed: boolean): void {
  const faces = planShed(w, o, shed);
  shedWindows(o, faces, shed, (f, u0, u1, y0, y1, lit) => {
    if (lit) fquad(b, f, u0, u1, y0, y1, GLASS_FRAMED, WINDOW_INK, 1);
  });
  if (!shed && hasSkylights(o, -1)) {
    skylights(o, (a0, a1, c0, c1, lit) => {
      if (lit) lantern(b, o, a0, a1, c0, c1, 1);
    });
  }
}
