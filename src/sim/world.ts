/**
 * The static world: a heightfield, boxes, rails, zones and ride lines, plus the queries the
 * controller needs. Generators build it through the functions here and call finalizeWorld().
 *
 * Conventions
 * - Metres. +y up. Uphill is +z, the sea is at z < 0.
 * - Heightfield: (nx+1) x (nz+1) vertices, `cell` apart, vertex (ix, iz) at
 *   (minX + ix*cell, minZ + iz*cell), stored at heights[iz*(nx+1) + ix]. Each cell is two triangles
 *   split along the diagonal from its (ix, iz) corner to its (ix+1, iz+1) corner. Meshers must use
 *   the same split so the drawn ground is exactly the collision ground.
 * - A solid is an oriented box. Its local +x axis is (cosR, sinR) in world (x, z); local +z is
 *   (-sinR, cosR). It spans yBase..yTop and its top is a rideable flat surface.
 */
import type { CompiledLine } from './lines';
import { datan2, dcos, dsin } from './math';

export const Surface = {
  STREET: 0,
  PLAZA: 1,
  STAIRS: 2,
  DIRT: 3,
  GRASS: 4,
  TRACK: 5,
  WATER: 6,
  ROOF: 7,
  AWNING: 8,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

export const District = { DOCKS: 0, MERCADO: 1, TERRACES: 2, ANTENNA: 3 } as const;
export type District = (typeof District)[keyof typeof District];
export const DISTRICT_NAMES = ['Docks', 'Mercado Steps', 'Terraces', 'Antenna Hill'] as const;

export interface Solid {
  index: number;
  cx: number;
  cz: number;
  /** Half extents along the local axes. */
  hx: number;
  hz: number;
  rot: number;
  cosR: number;
  sinR: number;
  yBase: number;
  yTop: number;
  /** Surface of the top. AWNING tops bounce. */
  surface: Surface;
  /** One-way platform: no side collision, can be hopped through from below (awnings, canopies). */
  oneWay: boolean;
  /** What it is, for the renderer: 'building', 'awning', 'container', 'crate', 'wall', ... */
  kind: string;
  /** Renderer hints (colour index, variant). Ignored by the sim. */
  style: number;
}

export interface Rail {
  index: number;
  /** xyz triplets. */
  pts: Float32Array;
  /** Cumulative length at each point; cum[0] = 0. */
  cum: Float32Array;
  length: number;
  /** For the renderer: 'handrail', 'ledge', 'wire', 'pipe', 'guy'. */
  kind: string;
}

export interface Zone {
  id: string;
  name: string;
  /** 'spawn', 'stop', 'errand', 'conductor', 'secret', 'landmark'. */
  kind: string;
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface Band {
  district: District;
  zMin: number;
  zMax: number;
}

export interface World {
  seed: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  cell: number;
  nx: number;
  nz: number;
  heights: Float32Array;
  /** One Surface per cell, surfaces[iz*nx + ix]. */
  surfaces: Uint8Array;
  solids: Solid[];
  rails: Rail[];
  zones: Zone[];
  lines: CompiledLine[];
  bands: Band[];
  spawn: { x: number; z: number; heading: number };

  // Spatial hash, built by finalizeWorld().
  finalized: boolean;
  bucket: number;
  nbx: number;
  nbz: number;
  solidStart: Int32Array;
  solidItems: Int32Array;
  /** Items are railIndex * RAIL_SEG_STRIDE + segmentIndex. */
  railStart: Int32Array;
  railItems: Int32Array;
}

export const RAIL_SEG_STRIDE = 65536;
const BUCKET = 16;
const SOLID_MARGIN = 1.5;
const RAIL_MARGIN = 3.5;

export interface WorldOpts {
  seed: number;
  minX: number;
  minZ: number;
  cell: number;
  nx: number;
  nz: number;
}

export function createWorld(o: WorldOpts): World {
  return {
    seed: o.seed,
    minX: o.minX,
    minZ: o.minZ,
    maxX: o.minX + o.nx * o.cell,
    maxZ: o.minZ + o.nz * o.cell,
    cell: o.cell,
    nx: o.nx,
    nz: o.nz,
    heights: new Float32Array((o.nx + 1) * (o.nz + 1)),
    surfaces: new Uint8Array(o.nx * o.nz),
    solids: [],
    rails: [],
    zones: [],
    lines: [],
    bands: [{ district: District.DOCKS, zMin: -Infinity, zMax: Infinity }],
    spawn: { x: 0, z: 0, heading: 0 },
    finalized: false,
    bucket: BUCKET,
    nbx: 0,
    nbz: 0,
    solidStart: new Int32Array(0),
    solidItems: new Int32Array(0),
    railStart: new Int32Array(0),
    railItems: new Int32Array(0),
  };
}

export interface SolidOpts {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  /** Orientation: either `rot` (radians; local +x = (cos rot, sin rot) in (x, z)) or cosR + sinR. */
  cosR?: number;
  sinR?: number;
  rot?: number;
  yBase: number;
  yTop: number;
  surface?: Surface;
  oneWay?: boolean;
  kind?: string;
  style?: number;
}

export function addSolid(w: World, o: SolidOpts): Solid {
  const cosR = o.cosR ?? dcos(o.rot ?? 0);
  const sinR = o.sinR ?? dsin(o.rot ?? 0);
  const s: Solid = {
    index: w.solids.length,
    cx: o.cx,
    cz: o.cz,
    hx: o.hx,
    hz: o.hz,
    rot: o.rot ?? datan2(sinR, cosR),
    cosR,
    sinR,
    yBase: o.yBase,
    yTop: o.yTop,
    surface: o.surface ?? Surface.ROOF,
    oneWay: o.oneWay ?? false,
    kind: o.kind ?? 'building',
    style: o.style ?? 0,
  };
  w.solids.push(s);
  w.finalized = false;
  return s;
}

/** `pts` is a flat xyz list with at least two points. */
export function addRail(w: World, pts: ArrayLike<number>, kind = 'handrail'): Rail {
  const n = Math.floor(pts.length / 3);
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) p[i] = pts[i];
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = p[i * 3] - p[i * 3 - 3];
    const dy = p[i * 3 + 1] - p[i * 3 - 2];
    const dz = p[i * 3 + 2] - p[i * 3 - 1];
    cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const r: Rail = { index: w.rails.length, pts: p, cum, length: cum[n - 1], kind };
  w.rails.push(r);
  w.finalized = false;
  return r;
}

export function addZone(w: World, z: Zone): Zone {
  w.zones.push(z);
  return z;
}

export function findZone(w: World, id: string): Zone | null {
  for (const z of w.zones) if (z.id === id) return z;
  return null;
}

export function districtAt(w: World, z: number): District {
  for (const b of w.bands) if (z >= b.zMin && z < b.zMax) return b.district;
  return w.bands[w.bands.length - 1].district;
}

// ---------------------------------------------------------------------------------------------
// Heightfield

export function setHeight(w: World, ix: number, iz: number, h: number): void {
  w.heights[iz * (w.nx + 1) + ix] = h;
}

export function vertexHeight(w: World, ix: number, iz: number): number {
  return w.heights[iz * (w.nx + 1) + ix];
}

/** Fill every vertex from a function of world (x, z). */
export function fillHeights(w: World, fn: (x: number, z: number) => number): void {
  for (let iz = 0; iz <= w.nz; iz++) {
    for (let ix = 0; ix <= w.nx; ix++) {
      w.heights[iz * (w.nx + 1) + ix] = fn(w.minX + ix * w.cell, w.minZ + iz * w.cell);
    }
  }
}

/** Fill every cell's surface from a function of the cell centre. */
export function fillSurfaces(w: World, fn: (x: number, z: number) => Surface): void {
  for (let iz = 0; iz < w.nz; iz++) {
    for (let ix = 0; ix < w.nx; ix++) {
      w.surfaces[iz * w.nx + ix] = fn(w.minX + (ix + 0.5) * w.cell, w.minZ + (iz + 0.5) * w.cell);
    }
  }
}

export interface TerrainSample {
  y: number;
  /** dy/dx and dy/dz of the triangle under the point. */
  gx: number;
  gz: number;
  surface: number;
}

const _ts: TerrainSample = { y: 0, gx: 0, gz: 0, surface: 0 };

/** Terrain only (no solids). Positions outside the grid clamp to the edge. */
export function sampleTerrain(w: World, x: number, z: number, out: TerrainSample): void {
  let fx = (x - w.minX) / w.cell;
  let fz = (z - w.minZ) / w.cell;
  if (fx < 0) fx = 0;
  else if (fx > w.nx) fx = w.nx;
  if (fz < 0) fz = 0;
  else if (fz > w.nz) fz = w.nz;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  if (ix >= w.nx) ix = w.nx - 1;
  if (iz >= w.nz) iz = w.nz - 1;
  const u = fx - ix;
  const v = fz - iz;
  const row = w.nx + 1;
  const i00 = iz * row + ix;
  const h00 = w.heights[i00];
  const h10 = w.heights[i00 + 1];
  const h01 = w.heights[i00 + row];
  const h11 = w.heights[i00 + row + 1];
  let dx: number;
  let dz: number;
  if (u >= v) {
    dx = h10 - h00;
    dz = h11 - h10;
  } else {
    dx = h11 - h01;
    dz = h01 - h00;
  }
  out.y = h00 + dx * u + dz * v;
  out.gx = dx / w.cell;
  out.gz = dz / w.cell;
  out.surface = w.surfaces[iz * w.nx + ix];
}

export function terrainHeight(w: World, x: number, z: number): number {
  sampleTerrain(w, x, z, _ts);
  return _ts.y;
}

// ---------------------------------------------------------------------------------------------
// Spatial hash

function bucketOf(w: World, x: number, z: number): number {
  let bx = Math.floor((x - w.minX) / w.bucket);
  let bz = Math.floor((z - w.minZ) / w.bucket);
  if (bx < 0) bx = 0;
  else if (bx >= w.nbx) bx = w.nbx - 1;
  if (bz < 0) bz = 0;
  else if (bz >= w.nbz) bz = w.nbz - 1;
  return bz * w.nbx + bx;
}

function buildCsr(
  w: World,
  count: number,
  bounds: (i: number, out: Float64Array) => void,
  item: (i: number) => number,
): { start: Int32Array; items: Int32Array } {
  const nb = w.nbx * w.nbz;
  const counts = new Int32Array(nb + 1);
  const bb = new Float64Array(4);
  const range = (i: number, fn: (b: number) => void): void => {
    bounds(i, bb);
    const x0 = Math.max(0, Math.floor((bb[0] - w.minX) / w.bucket));
    const x1 = Math.min(w.nbx - 1, Math.floor((bb[1] - w.minX) / w.bucket));
    const z0 = Math.max(0, Math.floor((bb[2] - w.minZ) / w.bucket));
    const z1 = Math.min(w.nbz - 1, Math.floor((bb[3] - w.minZ) / w.bucket));
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) fn(bz * w.nbx + bx);
  };
  for (let i = 0; i < count; i++) range(i, (b) => counts[b + 1]++);
  for (let b = 0; b < nb; b++) counts[b + 1] += counts[b];
  const items = new Int32Array(counts[nb]);
  const cursor = counts.slice(0, nb);
  for (let i = 0; i < count; i++) range(i, (b) => (items[cursor[b]++] = item(i)));
  return { start: counts, items };
}

/** Build the spatial hash. Call after the last addSolid/addRail and before any query. */
export function finalizeWorld(w: World): void {
  w.nbx = Math.max(1, Math.ceil((w.maxX - w.minX) / w.bucket));
  w.nbz = Math.max(1, Math.ceil((w.maxZ - w.minZ) / w.bucket));

  const s = buildCsr(
    w,
    w.solids.length,
    (i, bb) => {
      const o = w.solids[i];
      const ex = Math.abs(o.cosR) * o.hx + Math.abs(o.sinR) * o.hz + SOLID_MARGIN;
      const ez = Math.abs(o.sinR) * o.hx + Math.abs(o.cosR) * o.hz + SOLID_MARGIN;
      bb[0] = o.cx - ex;
      bb[1] = o.cx + ex;
      bb[2] = o.cz - ez;
      bb[3] = o.cz + ez;
    },
    (i) => i,
  );
  w.solidStart = s.start;
  w.solidItems = s.items;

  // One entry per rail segment.
  const segRail: number[] = [];
  const segIdx: number[] = [];
  for (const r of w.rails) {
    const n = r.pts.length / 3;
    for (let k = 0; k < n - 1; k++) {
      segRail.push(r.index);
      segIdx.push(k);
    }
  }
  const r = buildCsr(
    w,
    segRail.length,
    (i, bb) => {
      const p = w.rails[segRail[i]].pts;
      const k = segIdx[i] * 3;
      bb[0] = Math.min(p[k], p[k + 3]) - RAIL_MARGIN;
      bb[1] = Math.max(p[k], p[k + 3]) + RAIL_MARGIN;
      bb[2] = Math.min(p[k + 2], p[k + 5]) - RAIL_MARGIN;
      bb[3] = Math.max(p[k + 2], p[k + 5]) + RAIL_MARGIN;
    },
    (i) => segRail[i] * RAIL_SEG_STRIDE + segIdx[i],
  );
  w.railStart = r.start;
  w.railItems = r.items;
  w.finalized = true;
}

// ---------------------------------------------------------------------------------------------
// Queries

export interface GroundSample {
  y: number;
  gx: number;
  gz: number;
  surface: number;
  /** Index of the solid whose top this is, or -1 for terrain. */
  solid: number;
}

export function makeGroundSample(): GroundSample {
  return { y: 0, gx: 0, gz: 0, surface: 0, solid: -1 };
}

function insideSolid(o: Solid, x: number, z: number): boolean {
  const dx = x - o.cx;
  const dz = z - o.cz;
  const lx = dx * o.cosR + dz * o.sinR;
  const lz = -dx * o.sinR + dz * o.cosR;
  return lx >= -o.hx && lx <= o.hx && lz >= -o.hz && lz <= o.hz;
}

/**
 * The surface that would support something at (x, z) coming from height `y`: the highest of the
 * terrain and any solid top at most `stepUp` above `y`. Terrain always supports.
 */
export function sampleGround(
  w: World,
  x: number,
  y: number,
  z: number,
  stepUp: number,
  out: GroundSample,
): void {
  sampleTerrain(w, x, z, _ts);
  out.y = _ts.y;
  out.gx = _ts.gx;
  out.gz = _ts.gz;
  out.surface = _ts.surface;
  out.solid = -1;
  const b = bucketOf(w, x, z);
  const limit = y + stepUp;
  for (let k = w.solidStart[b]; k < w.solidStart[b + 1]; k++) {
    const o = w.solids[w.solidItems[k]];
    if (o.yTop > out.y && o.yTop <= limit && insideSolid(o, x, z)) {
      out.y = o.yTop;
      out.gx = 0;
      out.gz = 0;
      out.surface = o.surface;
      out.solid = o.index;
    }
  }
}

/** Highest surface at (x, z) regardless of where you come from (camera, spawning, shadows). */
export function topHeight(w: World, x: number, z: number): number {
  sampleTerrain(w, x, z, _ts);
  let y = _ts.y;
  const b = bucketOf(w, x, z);
  for (let k = w.solidStart[b]; k < w.solidStart[b + 1]; k++) {
    const o = w.solids[w.solidItems[k]];
    if (o.yTop > y && insideSolid(o, x, z)) y = o.yTop;
  }
  return y;
}

export interface WallHit {
  hit: boolean;
  /** Push-out direction (unit, horizontal), pointing out of the solid. */
  nx: number;
  nz: number;
  depth: number;
  solid: number;
}

export function makeWallHit(): WallHit {
  return { hit: false, nx: 0, nz: 0, depth: 0, solid: -1 };
}

/**
 * Deepest side contact between a vertical cylinder (feet at y) and the solids. A solid is a wall
 * to you if your feet are more than `stepUp` below its top and your head is above its base.
 * One-way solids never block.
 */
export function collideSolids(
  w: World,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  stepUp: number,
  out: WallHit,
): void {
  out.hit = false;
  out.depth = 0;
  out.solid = -1;
  const b = bucketOf(w, x, z);
  for (let k = w.solidStart[b]; k < w.solidStart[b + 1]; k++) {
    const o = w.solids[w.solidItems[k]];
    if (o.oneWay) continue;
    if (y >= o.yTop - stepUp || y + height <= o.yBase) continue;
    const dx = x - o.cx;
    const dz = z - o.cz;
    const lx = dx * o.cosR + dz * o.sinR;
    const lz = -dx * o.sinR + dz * o.cosR;
    const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
    const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
    let nlx: number;
    let nlz: number;
    let depth: number;
    if (qx === lx && qz === lz) {
      // Centre is inside: leave through the nearest face.
      const px = o.hx - Math.abs(lx);
      const pz = o.hz - Math.abs(lz);
      if (px < pz) {
        nlx = lx >= 0 ? 1 : -1;
        nlz = 0;
        depth = px + radius;
      } else {
        nlx = 0;
        nlz = lz >= 0 ? 1 : -1;
        depth = pz + radius;
      }
    } else {
      const ex = lx - qx;
      const ez = lz - qz;
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d >= radius) continue;
      nlx = ex / d;
      nlz = ez / d;
      depth = radius - d;
    }
    if (depth > out.depth) {
      out.hit = true;
      out.depth = depth;
      out.nx = nlx * o.cosR - nlz * o.sinR;
      out.nz = nlx * o.sinR + nlz * o.cosR;
      out.solid = o.index;
    }
  }
}

/** Is there a wall of `solid` within `reach` of (x, z) on the side opposite to (nx, nz)? */
export function wallBeside(o: Solid, x: number, z: number, nx: number, nz: number, reach: number): boolean {
  return insideSolid(o, x - nx * reach, z - nz * reach);
}

export interface RailHit {
  hit: boolean;
  rail: number;
  /** Arc position of the closest point. */
  s: number;
  x: number;
  y: number;
  z: number;
  /** Unit tangent in the +s direction. */
  tx: number;
  ty: number;
  tz: number;
  /** Horizontal distance to the closest point. */
  dist: number;
}

export function makeRailHit(): RailHit {
  return { hit: false, rail: -1, s: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 1, dist: 0 };
}

/**
 * Closest rail whose nearest point is within `radius` horizontally and between `down` below and
 * `up` above... of the query height (query y - rail y in [-down, up]). `skip` excludes one rail.
 */
export function nearestRail(
  w: World,
  x: number,
  y: number,
  z: number,
  radius: number,
  up: number,
  down: number,
  skip: number,
  out: RailHit,
): void {
  out.hit = false;
  let best = radius;
  const b = bucketOf(w, x, z);
  for (let k = w.railStart[b]; k < w.railStart[b + 1]; k++) {
    const item = w.railItems[k];
    const ri = Math.floor(item / RAIL_SEG_STRIDE);
    if (ri === skip) continue;
    const si = item - ri * RAIL_SEG_STRIDE;
    const r = w.rails[ri];
    const p = r.pts;
    const i = si * 3;
    const ax = p[i];
    const ay = p[i + 1];
    const az = p[i + 2];
    const ex = p[i + 3] - ax;
    const ey = p[i + 4] - ay;
    const ez = p[i + 5] - az;
    const hl2 = ex * ex + ez * ez;
    // Project horizontally: rails are ridden from above, so plan distance is what matters.
    let t = hl2 > 1e-9 ? ((x - ax) * ex + (z - az) * ez) / hl2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = ax + ex * t;
    const qy = ay + ey * t;
    const qz = az + ez * t;
    const dy = y - qy;
    if (dy > up || dy < -down) continue;
    const ddx = x - qx;
    const ddz = z - qz;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    if (d < best) {
      best = d;
      const segLen = r.cum[si + 1] - r.cum[si];
      out.hit = true;
      out.rail = ri;
      out.s = r.cum[si] + segLen * t;
      out.x = qx;
      out.y = qy;
      out.z = qz;
      out.tx = ex / segLen;
      out.ty = ey / segLen;
      out.tz = ez / segLen;
      out.dist = d;
    }
  }
}

/** Point and unit tangent on a rail at arc position s (clamped). */
export function railAt(r: Rail, s: number, out: RailHit): void {
  const n = r.cum.length;
  if (s < 0) s = 0;
  else if (s > r.length) s = r.length;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const segLen = r.cum[lo + 1] - r.cum[lo];
  const t = segLen > 0 ? (s - r.cum[lo]) / segLen : 0;
  const p = r.pts;
  const i = lo * 3;
  const ex = p[i + 3] - p[i];
  const ey = p[i + 4] - p[i + 1];
  const ez = p[i + 5] - p[i + 2];
  out.rail = r.index;
  out.s = s;
  out.x = p[i] + ex * t;
  out.y = p[i + 1] + ey * t;
  out.z = p[i + 2] + ez * t;
  out.tx = ex / segLen;
  out.ty = ey / segLen;
  out.tz = ez / segLen;
}

/** Deterministic checksum of the static world, for generator regression tests. */
export function worldHash(w: World): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < w.heights.length; i++) mix(w.heights[i]);
  for (let i = 0; i < w.surfaces.length; i++) mix(w.surfaces[i]);
  for (const o of w.solids) {
    mix(o.cx);
    mix(o.cz);
    mix(o.hx);
    mix(o.hz);
    mix(o.cosR);
    mix(o.sinR);
    mix(o.yBase);
    mix(o.yTop);
    mix(o.surface);
  }
  for (const r of w.rails) for (let i = 0; i < r.pts.length; i++) mix(r.pts[i]);
  for (const l of w.lines) {
    mix(l.period);
    for (let i = 0; i < l.path.length; i++) mix(l.path[i]);
  }
  return h >>> 0;
}
