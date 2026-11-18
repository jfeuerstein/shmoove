/**
 * People in the city (brief M7b), drawn and never simulated: chunky box figures in the skater's
 * style, standing at stops and stalls, sitting on steps and crates, leaning in doorways, carrying
 * things, and a few walking short beats on plazas. Nothing collides, and no figure stands where the
 * skater's routes run: not within 2 m of a ride's lane, not on a rail or its run-in, not in the
 * middle third of a stair street (nor on the landings that continue it), not on a street.
 *
 * Static figures are baked into their chunk's mesh twice, once per pose; the chunk's draw range
 * picks the pose (12 Hz, "on twos") and, by trimming figures off its ends in a fixed order, how
 * many are out at this hour. Walkers and birds move, so they live in one small dynamic mesh for
 * the whole city view (`LifeLayer`), rewritten in place each frame.
 *
 * Everything is deterministic from the world and cell indices (`hash2`).
 */
import * as THREE from 'three';
import { District, Surface, districtAt, terrainHeight, topHeight, type Rail, type Solid, type World } from '../sim/world';
import { streetSide, solidFaces, fx, fz } from './dress/kit';
import { stopSpot } from './dress/zones';
import { type MeshBuilder, hash2 } from './geom';
import { INK, inkMaterial } from './look';

// ---------------------------------------------------------------------------------------------
// Where the skater goes

/** A figure keeps this far from a ride's lane edge, m (brief: 2 m). */
export const LANE_CLEAR = 2;
/** ... this far from a rail, m, and from the run-in past either end of it. */
export const RAIL_CLEAR = 1.2;
export const RUN_IN = 6;

/** Segments the skater's routes run along near one area: lanes (with clearance) and rails. */
export interface RouteCtx {
  /** ax, az, bx, bz, clearance per segment. */
  segs: Float64Array;
  n: number;
}

/**
 * The ride lanes and rails near [x0, x1] x [z0, z1] (grown by `pad`) as segments with the
 * clearance a figure must keep from them. Rails get their run-ins: the rail's ends extended
 * RUN_IN metres along their direction.
 */
export function routeCtx(w: World, x0: number, z0: number, x1: number, z1: number, pad = 12): RouteCtx {
  const out: number[] = [];
  const near = (ax: number, az: number, bx: number, bz: number): boolean =>
    Math.max(ax, bx) >= x0 - pad && Math.min(ax, bx) <= x1 + pad && Math.max(az, bz) >= z0 - pad && Math.min(az, bz) <= z1 + pad;
  for (const line of w.lines) {
    if (line.overhead || line.bodyHeight <= 0) continue;
    if (line.maxX < x0 - pad || line.minX > x1 + pad || line.maxZ < z0 - pad || line.minZ > z1 + pad) continue;
    const p = line.pathPts;
    const clear = LANE_CLEAR + line.bodyHalfWid;
    for (let i = 3; i < p.length; i += 3) {
      if (near(p[i - 3], p[i - 1], p[i], p[i + 2])) out.push(p[i - 3], p[i - 1], p[i], p[i + 2], clear);
    }
  }
  for (const r of w.rails) railSegs(w, r, near, out);
  return { segs: Float64Array.from(out), n: out.length / 5 };
}

function railSegs(w: World, r: Rail, near: (ax: number, az: number, bx: number, bz: number) => boolean, out: number[]): void {
  const p = r.pts;
  const n = p.length / 3;
  if (n < 2) return;
  // Wires and guys high overhead are not ridden from the ground near people; anything whose
  // lowest point is within 3 m of the ground counts.
  let low = Infinity;
  for (let i = 0; i < n; i++) low = Math.min(low, p[i * 3 + 1] - terrainHeight(w, p[i * 3], p[i * 3 + 2]));
  if (low > 3) return;
  for (let i = 1; i < n; i++) {
    if (near(p[i * 3 - 3], p[i * 3 - 1], p[i * 3], p[i * 3 + 2])) out.push(p[i * 3 - 3], p[i * 3 - 1], p[i * 3], p[i * 3 + 2], RAIL_CLEAR);
  }
  // Run-ins past both ends.
  for (const [a, b] of [[0, 1], [n - 1, n - 2]] as const) {
    const ex = p[a * 3];
    const ez = p[a * 3 + 2];
    let dx = ex - p[b * 3];
    let dz = ez - p[b * 3 + 2];
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    dx /= l;
    dz /= l;
    if (near(ex, ez, ex + dx * RUN_IN, ez + dz * RUN_IN)) out.push(ex, ez, ex + dx * RUN_IN, ez + dz * RUN_IN, RAIL_CLEAR);
  }
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

function surfaceAt(w: World, ix: number, iz: number): number {
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return -1;
  return w.surfaces[iz * w.nx + ix];
}

/**
 * Is (x, z) in the middle third of a stair street? On a stair cell, of its own run across the
 * fall; on a plaza or street cell, of a stair run within four cells uphill or downhill of it in
 * either axis (the landings and crossings that continue the stair street).
 */
export function inStairMiddle(w: World, x: number, z: number): boolean {
  const ix = Math.floor((x - w.minX) / w.cell);
  const iz = Math.floor((z - w.minZ) / w.cell);
  for (let d = 0; d <= 4; d++) {
    for (const s of d === 0 ? [0] : [-d, d]) {
      // A stair street falling along z: its run across is along x.
      if (surfaceAt(w, ix, iz + s) === Surface.STAIRS && middleOfRun(w, ix, iz + s, x - w.minX, 0)) return true;
      // ... and one falling along x.
      if (surfaceAt(w, ix + s, iz) === Surface.STAIRS && middleOfRun(w, ix + s, iz, z - w.minZ, 1)) return true;
    }
  }
  return false;
}

/** Is local coordinate `u` (along `axis`, m from the world's min) in the middle third of the stair run through the cell? */
function middleOfRun(w: World, ix: number, iz: number, u: number, axis: 0 | 1): boolean {
  let a = axis === 0 ? ix : iz;
  let b = a + 1;
  if (axis === 0) {
    while (surfaceAt(w, a - 1, iz) === Surface.STAIRS) a--;
    while (surfaceAt(w, b, iz) === Surface.STAIRS) b++;
  } else {
    while (surfaceAt(w, ix, a - 1) === Surface.STAIRS) a--;
    while (surfaceAt(w, ix, b) === Surface.STAIRS) b++;
  }
  // A long run along the "across" axis is a flight seen side-on, not a street: only streets up to 30 m wide.
  if (b - a > 10) return false;
  const lo = a * w.cell;
  const hi = b * w.cell;
  const third = (hi - lo) / 3;
  return u > lo + third - 0.4 && u < hi - third + 0.4;
}

/** May a figure stand (or a prop sit on the ground) at (x, z)? */
export function clearForFigure(w: World, ctx: RouteCtx, x: number, z: number): boolean {
  if (x < w.minX + 1 || z < w.minZ + 1 || x > w.maxX - 1 || z > w.maxZ - 1) return false;
  const ix = Math.floor((x - w.minX) / w.cell);
  const iz = Math.floor((z - w.minZ) / w.cell);
  const s = w.surfaces[iz * w.nx + ix];
  if (s === Surface.STREET || s === Surface.WATER || s === Surface.TRACK) return false;
  const seg = ctx.segs;
  for (let i = 0; i < ctx.n; i++) {
    const k = i * 5;
    if (segDist(x, z, seg[k], seg[k + 1], seg[k + 2], seg[k + 3]) < seg[k + 4]) return false;
  }
  if (inStairMiddle(w, x, z)) return false;
  return true;
}

/**
 * Ground clear of solids around (x, z), within `r`, and clear of the places the game puts the
 * skater or a character: spawns (the camera stands there) and errand givers.
 */
function openGround(w: World, x: number, z: number, r: number): boolean {
  for (const zn of w.zones) {
    const pad = zn.kind === 'spawn' ? 4 : zn.kind === 'giver' ? 2 : -1;
    if (pad < 0) continue;
    const dx = x - zn.x;
    const dz = z - zn.z;
    if (dx * dx + dz * dz < (zn.r + pad) * (zn.r + pad)) return false;
  }
  const g = terrainHeight(w, x, z);
  if (topHeight(w, x, z) > g + 0.05) return false;
  for (let k = 0; k < 4; k++) {
    const a = k * 1.5708 + 0.4;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    if (topHeight(w, px, pz) > terrainHeight(w, px, pz) + 0.05) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Figures

export const Kind = { STAND: 0, SIT: 1, LEAN: 2, CARRY: 3, WALK: 4 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface Figure {
  x: number;
  y: number;
  z: number;
  /** Facing, unit (x, z). */
  fx: number;
  fz: number;
  kind: Kind;
  shirt: number;
  legs: number;
  skin: number;
  hair: number;
  /** What is carried (CARRY), or 0. */
  load: number;
  /** In [0, 1): figures with a higher value go home first in the evening. */
  keep: number;
}

const SKINS = [0xc98a5e, 0x8d5a3b, 0xe0ac85, 0x6b4430, 0xb57650];
const HAIR = [INK.ink, 0x4a2c1d, 0xcfc8bb, 0x7a3b1d, INK.ink, INK.pink, INK.mango, INK.cobalt];
const LEGS = [INK.ink, INK.cobalt, 0x3b4f9a, 0x6b5a4a, 0xe8cf9e, 0x2b8f87, 0x34409a];
const SHIRTS: Record<District, readonly number[]> = {
  [District.DOCKS]: [INK.mango, INK.mango, INK.teal, 0x63c9be, INK.paper, INK.cobalt, 0xffd27a, INK.pink],
  [District.MERCADO]: [INK.pink, INK.mango, 0xff86b5, 0xffc861, INK.teal, INK.paper, INK.cobalt, INK.leaf, INK.brick],
  [District.TERRACES]: [INK.mango, INK.cobalt, 0x9fb0f0, 0xffd27a, INK.paper, INK.pink, INK.teal],
  [District.ANTENNA]: [INK.cobalt, INK.pink, 0x6d82e8, 0xff8fb8, INK.paper, INK.mango],
};
const LOADS = [0xc98a55, INK.mango, INK.teal, INK.pink, 0xe0b27a, INK.leaf];

function dress(f: Figure, d: District, seed: number): void {
  const sh = SHIRTS[d];
  f.shirt = sh[Math.floor(hash2(seed, 1) * sh.length)];
  f.legs = LEGS[Math.floor(hash2(seed, 2) * LEGS.length)];
  f.skin = SKINS[Math.floor(hash2(seed, 3) * SKINS.length)];
  f.hair = HAIR[Math.floor(hash2(seed, 4) * HAIR.length)];
  f.load = LOADS[Math.floor(hash2(seed, 5) * LOADS.length)];
  f.keep = hash2(seed, 6);
}

function figure(x: number, y: number, z: number, fx0: number, fz0: number, kind: Kind, d: District, seed: number): Figure {
  const l = Math.hypot(fx0, fz0) || 1;
  const f: Figure = { x, y, z, fx: fx0 / l, fz: fz0 / l, kind, shirt: 0, legs: 0, skin: 0, hair: 0, load: 0, keep: 0 };
  dress(f, d, seed);
  return f;
}

/** Triangles of one pose of one figure (an upper bound, for budgets). */
export const FIGURE_TRIS = 68;

/**
 * One figure in one pose (0 or 1) into a builder. Local frame: forward (fx, fz), side (fz, -fx),
 * origin at the feet. Walking figures scissor their legs between the poses.
 */
export function meshFigure(b: MeshBuilder, f: Figure, pose: number): void {
  const fwx = f.fx;
  const fwz = f.fz;
  const sx = fwz;
  const sz = -fwx;
  const X = (u: number, v: number): number => f.x + sx * u + fwx * v;
  const Z = (u: number, v: number): number => f.z + sz * u + fwz * v;
  const y = f.y;
  const beam = (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, half: number, c: number): void => {
    b.beam(X(u0, v0), y + y0, Z(u0, v0), X(u1, v1), y + y1, Z(u1, v1), half, c);
  };
  const box = (u: number, yy: number, v: number, hu: number, hy: number, hv: number, c: number, top?: number, turn = 0): void => {
    // Box axes: local +x along the side vector, turned by `turn` (rad) for a head looking about.
    const ct = Math.cos(turn);
    const st = Math.sin(turn);
    const ax = sx * ct + fwx * st;
    const az = sz * ct + fwz * st;
    b.box(X(u, v), y + yy, Z(u, v), hu, hy, hv, ax, az, c, { top });
  };
  const p = pose & 1;
  switch (f.kind) {
    case Kind.SIT: {
      // Seat at y, thighs forward, shins down to the step below.
      box(0, 0.06, 0.22, 0.19, 0.07, 0.22, f.legs);
      for (const s of [-1, 1]) beam(s * 0.1, 0.02, 0.42, s * 0.11, -0.4, 0.5, 0.065, f.legs);
      box(0, 0.4, 0.02, 0.19, 0.27, 0.11, f.shirt);
      box(0, 0.8, 0.03, 0.105, 0.11, 0.105, f.skin, f.hair, p ? 0.35 : -0.1);
      beam(0.24, 0.6, 0.02, 0.2, 0.2, 0.36, 0.05, f.shirt);
      if (p) beam(-0.24, 0.6, 0.02, -0.22, 0.86, 0.2, 0.05, f.shirt);
      else beam(-0.24, 0.6, 0.02, -0.2, 0.2, 0.36, 0.05, f.shirt);
      break;
    }
    case Kind.WALK: {
      const st = p ? 1 : -1;
      for (const s of [-1, 1]) beam(s * 0.1, 0.88, 0, s * 0.1, 0.04, s * st * 0.24, 0.072, f.legs);
      box(0, 1.17, 0, 0.19, 0.29, 0.115, f.shirt);
      box(0, 1.58, 0.01, 0.105, 0.11, 0.105, f.skin, f.hair);
      for (const s of [-1, 1]) beam(s * 0.25, 1.4, 0, s * 0.27, 0.92, -s * st * 0.22, 0.05, f.shirt);
      break;
    }
    case Kind.LEAN: {
      // Back against a wall behind the figure: feet forward, shoulders back.
      for (const s of [-1, 1]) beam(s * 0.1, 0.86, -0.08, s * 0.12, 0.04, 0.16, 0.072, f.legs);
      box(0, 1.15, -0.14, 0.19, 0.29, 0.11, f.shirt);
      box(0, 1.56, -0.16, 0.105, 0.11, 0.105, f.skin, f.hair, p ? 0.4 : 0);
      if (p) {
        beam(0.24, 1.38, -0.14, 0.16, 1.2, 0.12, 0.05, f.shirt);
        beam(-0.24, 1.38, -0.14, -0.1, 1.5, 0.08, 0.05, f.shirt);
      } else {
        // Arms crossed.
        beam(0.24, 1.38, -0.14, -0.12, 1.12, 0.0, 0.05, f.shirt);
        beam(-0.24, 1.38, -0.14, 0.12, 1.18, 0.0, 0.05, f.shirt);
      }
      break;
    }
    case Kind.CARRY: {
      const bob = p ? 0.03 : 0;
      for (const s of [-1, 1]) beam(s * 0.1, 0.88, 0, s * 0.1, 0.04, s * (p ? 0.06 : -0.06), 0.072, f.legs);
      box(0, 1.17 + bob, 0, 0.19, 0.29, 0.115, f.shirt);
      box(0, 1.58 + bob, 0.01, 0.105, 0.11, 0.105, f.skin, f.hair);
      // A crate or basket on the head, steadied by both hands.
      box(0, 1.84 + bob, 0, 0.24, 0.12, 0.2, f.load);
      for (const s of [-1, 1]) beam(s * 0.25, 1.4 + bob, 0, s * 0.22, 1.78 + bob, 0.02, 0.05, f.shirt);
      break;
    }
    default: {
      // Standing: weight on one leg, then the other; one arm at the side, the other at the hip or a phone.
      const hip = p ? 0.03 : -0.03;
      for (const s of [-1, 1]) beam(s * 0.1 + hip, 0.88, 0, s * 0.12, 0.04, 0, 0.072, f.legs);
      box(hip, 1.17, 0, 0.19, 0.29, 0.115, f.shirt);
      box(hip, 1.58, 0.01, 0.105, 0.11, 0.105, f.skin, f.hair, p ? 0.3 : -0.2);
      beam(0.25 + hip, 1.4, 0, 0.28 + hip, 0.92, 0.02, 0.05, f.shirt);
      if (p) beam(-0.25 + hip, 1.4, 0, -0.14 + hip, 1.5, 0.16, 0.05, f.shirt);
      else beam(-0.25 + hip, 1.4, 0, -0.34 + hip, 1.02, -0.02, 0.05, f.shirt);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Placement

/** Daytime crowding by district: chance a free cell gets a figure, and figures per stall / stop. */
const DENSITY: Record<District, { cell: number; stair: number; stall: number; stop: number; door: number; walkers: number }> = {
  [District.DOCKS]: { cell: 0.03, stair: 0.04, stall: 2, stop: 2, door: 0.25, walkers: 2 },
  [District.MERCADO]: { cell: 0.06, stair: 0.14, stall: 3, stop: 3, door: 0.4, walkers: 3 },
  [District.TERRACES]: { cell: 0.018, stair: 0.06, stall: 1, stop: 2, door: 0.25, walkers: 1 },
  [District.ANTENNA]: { cell: 0.008, stair: 0.03, stall: 1, stop: 1, door: 0.15, walkers: 1 },
};

/** Share of a district's figures out at night (by day all of them are). */
const NIGHT_SHARE: Record<District, number> = {
  [District.DOCKS]: 0.4,
  [District.MERCADO]: 0.35,
  [District.TERRACES]: 0.2,
  [District.ANTENNA]: 0.15,
};

/** 0 by day, 1 at night, ramping through dawn and dusk (the look's ramps, src/render/look.ts). */
export function nightness(dayFrac: number): number {
  const f = dayFrac - Math.floor(dayFrac);
  if (f < 0.22 || f >= 0.8) return 1;
  if (f < 0.3) return 1 - (f - 0.22) / 0.08;
  if (f < 0.7) return 0;
  return (f - 0.7) / 0.1;
}

/** The share of a district's figures out at a day fraction. */
export function outShare(d: District, dayFrac: number): number {
  return 1 - (1 - NIGHT_SHARE[d]) * nightness(dayFrac);
}

/** A walker's beat: back and forth between two points. */
export interface Walker {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Seconds for one leg of the beat, and the phase offset, s. */
  leg: number;
  phase: number;
  fig: Figure;
}

/** Everything alive in one chunk: static figures, walkers, and bird perches. */
export interface ChunkLife {
  figures: Figure[];
  walkers: Walker[];
  /** x, y, z, flock per bird. */
  birds: number[];
  district: District;
}

export function emptyLife(d: District): ChunkLife {
  return { figures: [], walkers: [], birds: [], district: d };
}

const SIT_LIFT = 0.04;

/**
 * Plan one row of cells of a chunk: figures on plazas, dirt and grass, sitters on the side thirds
 * of stair streets. Rows are independent of each other.
 */
export function planRow(w: World, ctx: RouteCtx, life: ChunkLife, ix0: number, ix1: number, iz: number): void {
  const c = w.cell;
  const z0 = w.minZ + iz * c;
  const d = districtAt(w, z0 + c / 2);
  const den = DENSITY[d];
  for (let ix = ix0; ix < ix1; ix++) {
    const s = w.surfaces[iz * w.nx + ix];
    const x0 = w.minX + ix * c;
    const h = hash2(ix * 41 + 11, iz * 43 + 17);
    if (s === Surface.STAIRS) {
      if (h >= den.stair) continue;
      const x = x0 + 0.5 + 2 * hash2(ix, iz * 3 + 1);
      const z = z0 + 0.6 + 1.8 * hash2(ix * 3 + 1, iz);
      if (!clearForFigure(w, ctx, x, z) || !openGround(w, x, z, 0.4)) continue;
      // Sit facing downhill: the fall direction of the ground here.
      const gx = terrainHeight(w, x + 0.5, z) - terrainHeight(w, x - 0.5, z);
      const gz = terrainHeight(w, x, z + 0.5) - terrainHeight(w, x, z - 0.5);
      const seed = ix * 7919 + iz * 104729;
      life.figures.push(figure(x, terrainHeight(w, x, z) + 0.45 + SIT_LIFT, z, -gx, -gz, Kind.SIT, d, seed));
      continue;
    }
    if (s !== Surface.PLAZA && s !== Surface.DIRT && s !== Surface.GRASS) continue;
    if (h >= den.cell) continue;
    const x = x0 + 0.5 + 2 * hash2(ix * 5 + 2, iz);
    const z = z0 + 0.5 + 2 * hash2(ix, iz * 5 + 2);
    if (!clearForFigure(w, ctx, x, z) || !openGround(w, x, z, 0.5)) continue;
    const seed = ix * 15485863 + iz * 32452843;
    const a = hash2(seed, 9) * Math.PI * 2;
    const kind = hash2(seed, 10) < 0.2 ? Kind.CARRY : Kind.STAND;
    life.figures.push(figure(x, terrainHeight(w, x, z), z, Math.cos(a), Math.sin(a), kind, d, seed));
    // Chatting pairs: a second figure facing the first.
    if (hash2(seed, 11) < 0.45) {
      const x2 = x + Math.cos(a) * 0.9;
      const z2 = z + Math.sin(a) * 0.9;
      if (clearForFigure(w, ctx, x2, z2) && openGround(w, x2, z2, 0.4)) {
        life.figures.push(figure(x2, terrainHeight(w, x2, z2), z2, -Math.cos(a), -Math.sin(a), Kind.STAND, d, seed + 1));
      }
    }
  }
}

/** Figures that belong to one solid: shoppers at stalls and kiosks, leaners in doorways, sitters on crates. */
export function planSolid(w: World, ctx: RouteCtx, life: ChunkLife, o: Solid): void {
  const d = districtAt(w, o.cz);
  const den = DENSITY[d];
  const seed0 = o.index * 2654435 + 7;
  if (o.kind === 'stall' || o.kind === 'kiosk' || o.kind === 'market') {
    const faces = solidFaces(o);
    let placed = 0;
    for (let fi = 0; fi < faces.length && placed < den.stall; fi++) {
      const f = faces[fi];
      if (!streetSide(w, f) && o.kind !== 'market') continue;
      const n = Math.min(den.stall - placed, Math.max(1, Math.floor(f.hw)));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5 - n / 2) * Math.min(1.1, (f.hw * 2) / n) + (hash2(seed0 + k, fi) - 0.5) * 0.3;
        const off = 0.8 + 0.4 * hash2(seed0, fi * 7 + k);
        const x = fx(f, u, off);
        const z = fz(f, u, off);
        if (!clearForFigure(w, ctx, x, z) || !openGround(w, x, z, 0.3)) continue;
        const kind = hash2(seed0 + k, 3) < 0.25 ? Kind.CARRY : Kind.STAND;
        life.figures.push(figure(x, terrainHeight(w, x, z), z, -f.nx, -f.nz, kind, d, seed0 + k * 31 + fi));
        placed++;
      }
    }
    return;
  }
  if (o.kind === 'building' || o.kind === 'house' || o.kind === 'warehouse') {
    const faces = solidFaces(o);
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      if (f.hw < 2 || hash2(seed0, fi + 20) >= den.door || !streetSide(w, f)) continue;
      const u = (hash2(seed0, fi + 30) - 0.5) * (f.hw * 2 - 2);
      const x = fx(f, u, 0.35);
      const z = fz(f, u, 0.35);
      if (!clearForFigure(w, ctx, x, z)) continue;
      // The wall stops the leaner's back; only the feet must stand on open ground.
      const px = fx(f, u, 0.7);
      const pz = fz(f, u, 0.7);
      if (topHeight(w, px, pz) > terrainHeight(w, px, pz) + 0.05) continue;
      const g = terrainHeight(w, px, pz);
      if (Math.abs(g - terrainHeight(w, x, z)) > 0.25) continue;
      life.figures.push(figure(x, g, z, f.nx, f.nz, Kind.LEAN, d, seed0 + fi * 13));
    }
    return;
  }
  if (o.kind === 'crate') {
    const g = terrainHeight(w, o.cx, o.cz);
    const hgt = o.yTop - g;
    if (hgt < 0.4 || hgt > 1.2 || hash2(seed0, 40) > 0.5) return;
    if (!clearForFigure(w, ctx, o.cx, o.cz)) return;
    const a = hash2(seed0, 41) * Math.PI * 2;
    // Sat on the crate's edge, facing out.
    const x = o.cx + Math.cos(a) * Math.min(o.hx, o.hz) * 0.5;
    const z = o.cz + Math.sin(a) * Math.min(o.hx, o.hz) * 0.5;
    life.figures.push(figure(x, o.yTop + 0.02, z, Math.cos(a), Math.sin(a), Kind.SIT, d, seed0 + 41));
  }
}

/** Figures waiting at a stop: around the pole, facing the street. */
export function planStop(w: World, ctx: RouteCtx, life: ChunkLife, zi: number): void {
  const zn = w.zones[zi];
  if (zn.kind !== 'stop') return;
  const spot = stopSpot(w, zn);
  if (!spot) return;
  const d = districtAt(w, zn.z);
  const n = DENSITY[d].stop;
  for (let k = 0; k < n; k++) {
    const seed = zi * 7727 + k * 131;
    const along = (k - (n - 1) / 2) * 0.9 + (hash2(seed, 1) - 0.5) * 0.3;
    const out = 0.9 + 0.5 * hash2(seed, 2);
    const x = spot.x + spot.ax * out - spot.az * along;
    const z = spot.z + spot.az * out + spot.ax * along;
    if (!clearForFigure(w, ctx, x, z) || !openGround(w, x, z, 0.3)) continue;
    life.figures.push(figure(x, terrainHeight(w, x, z), z, -spot.ax, -spot.az, Kind.STAND, d, seed));
  }
}

/** Walkers' beats: short straight walks on open plaza, every point of the beat clear of routes. */
export function planWalkers(w: World, ctx: RouteCtx, life: ChunkLife, ix0: number, iz0: number, ix1: number, iz1: number): void {
  const zc = w.minZ + ((iz0 + iz1) / 2) * w.cell;
  const d = districtAt(w, zc);
  const want = DENSITY[d].walkers;
  let made = 0;
  for (let t = 0; t < 24 && made < want; t++) {
    const seed = iz0 * 977 + ix0 * 131 + t * 7;
    const ix = ix0 + Math.floor(hash2(seed, 1) * (ix1 - ix0));
    const iz = iz0 + Math.floor(hash2(seed, 2) * (iz1 - iz0));
    const s = surfaceAt(w, ix, iz);
    if (s !== Surface.PLAZA && s !== Surface.DIRT) continue;
    const ax = w.minX + (ix + 0.5) * w.cell;
    const az = w.minZ + (iz + 0.5) * w.cell;
    const a = hash2(seed, 3) * Math.PI * 2;
    const len = 4 + 4 * hash2(seed, 4);
    const bx = ax + Math.cos(a) * len;
    const bz = az + Math.sin(a) * len;
    let ok = true;
    for (let k = 0; k <= 8 && ok; k++) {
      const x = ax + ((bx - ax) * k) / 8;
      const z = az + ((bz - az) * k) / 8;
      const sk = surfaceAt(w, Math.floor((x - w.minX) / w.cell), Math.floor((z - w.minZ) / w.cell));
      ok = (sk === Surface.PLAZA || sk === Surface.DIRT) && clearForFigure(w, ctx, x, z) && openGround(w, x, z, 0.4);
    }
    if (!ok) continue;
    const fig = figure(ax, 0, az, bx - ax, bz - az, Kind.WALK, d, seed);
    life.walkers.push({ ax, az, bx, bz, leg: len / (1.1 + 0.3 * hash2(seed, 5)), phase: hash2(seed, 6) * 20, fig });
    made++;
  }
}

/** Birds on the laundry lines and wires of a chunk: small flocks perched along a rail. */
export function planBirds(w: World, life: ChunkLife, r: Rail): void {
  if (r.kind !== 'wire' && r.kind !== 'ledge') return;
  const seed = r.index * 9176 + 5;
  if (hash2(seed, 1) > (r.kind === 'wire' ? 0.75 : 0.25)) return;
  const n = 3 + Math.floor(hash2(seed, 2) * 5);
  const L = r.length;
  if (L < 3) return;
  const flock = r.index;
  const s0 = L * (0.15 + 0.5 * hash2(seed, 3));
  for (let k = 0; k < n; k++) {
    const s = Math.min(L - 0.2, s0 + k * (0.3 + 0.25 * hash2(seed, k + 10)));
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < s) i++;
    const t = (s - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]);
    const p = r.pts;
    const x = p[i * 3 - 3] + (p[i * 3] - p[i * 3 - 3]) * t;
    const y = p[i * 3 - 2] + (p[i * 3 + 1] - p[i * 3 - 2]) * t;
    const z = p[i * 3 - 1] + (p[i * 3 + 2] - p[i * 3 - 1]) * t;
    life.birds.push(x, y + 0.05, z, flock);
  }
}

// ---------------------------------------------------------------------------------------------
// The moving layer: walkers and birds

/** Sim ticks per animation frame (12 Hz), and ticks in a day (src/sim/lines.ts DAY_TICKS). */
const TWOS = 5;
const DAY_TICKS = 43200;
/** Birds scatter when the skater comes this close, m, fly off for FLY_S, and come back after AWAY_S. */
export const SCATTER_R = 6;
const FLY_S = 2.4;
const AWAY_S = 14;
/** Most walkers and birds drawn at once, and how far from the camera they are drawn, m. */
const MAX_WALKERS = 18;
const MAX_BIRDS = 100;
const WALKER_R = 80;
const BIRD_R = 60;

/** A chunk's life as the layer reads it each frame. */
export interface LiveChunk {
  life: ChunkLife;
  /** Seconds (game clock) each flock last scattered, by bird index; -1e9 never. */
  scattered: Float64Array;
}

export function liveChunk(life: ChunkLife): LiveChunk {
  return { life, scattered: new Float64Array(life.birds.length / 4).fill(-1e9) };
}

export interface LifeLayer {
  mesh: THREE.Mesh;
  /**
   * Draw the walkers and birds of `chunks` for the camera at (camX, camZ) and the skater at
   * (skX, skZ). Everything moves on twos, so the buffers are rewritten only when the 12 Hz frame
   * or `version` (bumped by the caller whenever the chunk list changes) is new.
   */
  update(chunks: readonly LiveChunk[], nChunks: number, version: number, camX: number, camZ: number, skX: number, skZ: number, dayFrac: number): void;
  dispose(): void;
}

const WALK_POSES = 2;

export function createLifeLayer(w: World, makeBuilder: () => MeshBuilder): LifeLayer {
  // Walker templates: one per pose, white-shirted; colours are written per walker.
  const walkT: { pos: Float32Array; part: Uint8Array; idx: Uint32Array; nv: number }[] = [];
  for (let p = 0; p < WALK_POSES; p++) {
    const b = makeBuilder();
    // Part colours are encoded in the template colour: 1 shirt, 2 legs, 3 skin, 4 hair.
    const fig: Figure = { x: 0, y: 0, z: 0, fx: 0, fz: 1, kind: Kind.WALK, shirt: 0x010101, legs: 0x020202, skin: 0x030303, hair: 0x040404, load: 0, keep: 0 };
    meshFigure(b, fig, p);
    const g = b.build();
    const pos = g.getAttribute('position').array as Float32Array;
    const col = g.getAttribute('color').array as Float32Array;
    const nv = pos.length / 3;
    const part = new Uint8Array(nv);
    for (let i = 0; i < nv; i++) part[i] = Math.round(col[i * 3] * 255);
    const index = g.getIndex();
    const idx = new Uint32Array(index ? (index.array as ArrayLike<number>) : []);
    walkT.push({ pos: Float32Array.from(pos), part, idx, nv });
    g.dispose();
  }
  // Bird templates: perched (pose 0), and two flying wing beats.
  const birdT: { pos: Float32Array; col: Float32Array; idx: Uint32Array; nv: number }[] = [];
  for (let p = 0; p < 3; p++) {
    const b = makeBuilder();
    const ink = 0x3a3a52;
    if (p === 0) {
      b.box(0, 0.07, 0, 0.05, 0.05, 0.09, 1, 0, ink, { top: 0x6b6b85 });
      b.box(0, 0.15, 0.07, 0.035, 0.035, 0.035, 1, 0, ink);
    } else {
      b.box(0, 0, 0, 0.05, 0.04, 0.1, 1, 0, ink, { top: 0x6b6b85 });
      const up = p === 1 ? 0.18 : -0.08;
      // Two wing triangles, double-sided.
      for (const s of [-1, 1]) {
        const a = b.vert(s * 0.04, 0.02, -0.06, ink);
        const c = b.vert(s * 0.04, 0.02, 0.07, ink);
        const d = b.vert(s * 0.3, 0.02 + up, 0, 0x6b6b85);
        b.tri(a, c, d);
        b.tri(a, d, c);
      }
    }
    const g = b.build();
    const pos = Float32Array.from(g.getAttribute('position').array as Float32Array);
    const col = Float32Array.from(g.getAttribute('color').array as Float32Array);
    const index = g.getIndex();
    birdT.push({ pos, col, idx: new Uint32Array(index ? (index.array as ArrayLike<number>) : []), nv: pos.length / 3 });
    g.dispose();
  }
  const maxWalkV = Math.max(...walkT.map((t) => t.nv));
  const maxWalkI = Math.max(...walkT.map((t) => t.idx.length));
  const maxBirdV = Math.max(...birdT.map((t) => t.nv));
  const maxBirdI = Math.max(...birdT.map((t) => t.idx.length));
  const capV = MAX_WALKERS * maxWalkV + MAX_BIRDS * maxBirdV;
  const capI = MAX_WALKERS * maxWalkI + MAX_BIRDS * maxBirdI;
  const pos = new Float32Array(capV * 3);
  const col = new Float32Array(capV * 3);
  const idx = new Uint32Array(capI);
  const geo = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(pos, 3);
  const colA = new THREE.BufferAttribute(col, 3);
  posA.setUsage(THREE.DynamicDrawUsage);
  colA.setUsage(THREE.DynamicDrawUsage);
  const idxA = new THREE.BufferAttribute(idx, 1);
  idxA.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posA);
  geo.setAttribute('color', colA);
  geo.setIndex(idxA);
  geo.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geo, inkMaterial());
  mesh.name = 'life';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;

  let nv = 0;
  let ni = 0;
  let lastFrame = -1;
  let lastVersion = -1;
  const put = (tp: Float32Array, tidx: Uint32Array, tnv: number, x: number, y: number, z: number, cs: number, sn: number, colour: (i: number, k: number) => void): void => {
    const base = nv;
    for (let i = 0; i < tnv; i++) {
      const lx = tp[i * 3];
      const ly = tp[i * 3 + 1];
      const lz = tp[i * 3 + 2];
      const k = (base + i) * 3;
      // Yaw: local +z goes to (sn, cs), local +x to (cs, -sn).
      pos[k] = x + lx * cs + lz * sn;
      pos[k + 1] = y + ly;
      pos[k + 2] = z - lx * sn + lz * cs;
      colour(i, k);
    }
    for (let j = 0; j < tidx.length; j++) idx[ni + j] = tidx[j] + base;
    ni += tidx.length;
    nv += tnv;
  };
  const setRGB = (k: number, c: number): void => {
    col[k] = ((c >> 16) & 255) / 255;
    col[k + 1] = ((c >> 8) & 255) / 255;
    col[k + 2] = (c & 255) / 255;
  };
  let curFig: Figure | null = null;
  let curPart: Uint8Array | null = null;
  const walkColour = (i: number, k: number): void => {
    const f = curFig;
    const part = curPart;
    if (f === null || part === null) return;
    const pc = part[i];
    setRGB(k, pc === 1 ? f.shirt : pc === 2 ? f.legs : pc === 3 ? f.skin : f.hair);
  };
  let curBird: Float32Array | null = null;
  const birdColour = (i: number, k: number): void => {
    const c = curBird;
    if (c === null) return;
    col[k] = c[i * 3];
    col[k + 1] = c[i * 3 + 1];
    col[k + 2] = c[i * 3 + 2];
  };

  return {
    mesh,
    update(chunks, nChunks, version, camX, camZ, skX, skZ, dayFrac) {
      const ticks = dayFrac * DAY_TICKS;
      const frame = Math.floor(ticks / TWOS);
      if (frame === lastFrame && version === lastVersion) return;
      lastFrame = frame;
      lastVersion = version;
      nv = 0;
      ni = 0;
      // Positions step on twos too: the clock of the frame, not of the moment.
      const t = (frame * TWOS) / 60;
      let walkers = 0;
      let birds = 0;
      for (let c = 0; c < nChunks; c++) {
        const lc = chunks[c];
        const life = lc.life;
        const share = outShare(life.district, dayFrac);
        for (let wi = 0; wi < life.walkers.length && walkers < MAX_WALKERS; wi++) {
          const wk = life.walkers[wi];
          if (wk.fig.keep >= share) continue;
          const dx = wk.ax - camX;
          const dz = wk.az - camZ;
          if (dx * dx + dz * dz > WALKER_R * WALKER_R) continue;
          // Back and forth along the beat, a short pause at each end.
          const u = (t + wk.phase) / (wk.leg + 0.8);
          const lap = Math.floor(u);
          const fr = Math.min(1, ((u - lap) * (wk.leg + 0.8)) / wk.leg);
          const back = (lap & 1) === 1;
          const s = back ? 1 - fr : fr;
          const x = wk.ax + (wk.bx - wk.ax) * s;
          const z = wk.az + (wk.bz - wk.az) * s;
          let hx = wk.bx - wk.ax;
          let hz = wk.bz - wk.az;
          if (back) {
            hx = -hx;
            hz = -hz;
          }
          const hl = Math.sqrt(hx * hx + hz * hz) || 1;
          const tp = walkT[fr >= 1 ? 0 : (frame + wi) & 1];
          curFig = wk.fig;
          curPart = tp.part;
          put(tp.pos, tp.idx, tp.nv, x, terrainHeight(w, x, z), z, hz / hl, hx / hl, walkColour);
          walkers++;
        }
        const bd = life.birds;
        for (let bi = 0; bi < bd.length && birds < MAX_BIRDS; bi += 4) {
          const bx = bd[bi];
          const by = bd[bi + 1];
          const bz = bd[bi + 2];
          const dx = bx - camX;
          const dz = bz - camZ;
          if (dx * dx + dz * dz > BIRD_R * BIRD_R) continue;
          const k = bi >> 2;
          const sx = bx - skX;
          const sz = bz - skZ;
          let since = t - lc.scattered[k];
          if (sx * sx + sz * sz < SCATTER_R * SCATTER_R && (since > AWAY_S || since < 0)) {
            // The whole flock goes at once.
            for (let j = 0; j < bd.length; j += 4) if (bd[j + 3] === bd[bi + 3]) lc.scattered[j >> 2] = t;
            since = 0;
          }
          const yaw = hash2(k, bd[bi + 3]) * 6.283;
          const cs = Math.cos(yaw);
          const sn = Math.sin(yaw);
          if (since >= 0 && since < FLY_S) {
            // Up and away, wings beating on twos.
            const tp = birdT[1 + ((frame + k) & 1)];
            curBird = tp.col;
            const d = since * (3 + 2 * hash2(k, 3));
            put(tp.pos, tp.idx, tp.nv, bx + sn * d, by + since * 2.5, bz + cs * d, cs, sn, birdColour);
          } else if (since >= FLY_S && since < AWAY_S) {
            continue;
          } else {
            const tp = birdT[0];
            curBird = tp.col;
            put(tp.pos, tp.idx, tp.nv, bx, by, bz, cs, sn, birdColour);
          }
          birds++;
        }
      }
      curFig = null;
      curPart = null;
      curBird = null;
      geo.setDrawRange(0, ni);
      if (ni > 0) {
        posA.clearUpdateRanges();
        posA.addUpdateRange(0, nv * 3);
        posA.needsUpdate = true;
        colA.clearUpdateRanges();
        colA.addUpdateRange(0, nv * 3);
        colA.needsUpdate = true;
        idxA.clearUpdateRanges();
        idxA.addUpdateRange(0, ni);
        idxA.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
    },
  };
}
