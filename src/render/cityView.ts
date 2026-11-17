/**
 * The streaming city view. The world is cut into square chunks of CHUNK_CELLS cells; each chunk
 * is drawn as one merged mesh at one of two levels of detail: near (fully dressed) or far (the
 * plain silhouette: exact ground, the same boxes, no windows or props). Chunks are built lazily
 * from the sim data, nearest first, within a per-frame time budget; the chunk under a camera that
 * appears somewhere new (or teleports) is built at once with its neighbours. Chunks that leave
 * range are hidden and kept in a small LRU cache, and disposed once the cache overflows and they
 * have been out of range for a few seconds.
 *
 * The streaming policy (`ChunkStreamer`) is pure: it is driven by camera position and a clock,
 * and builds through hooks, so it is tested without WebGL.
 */
import * as THREE from 'three';
import type { World } from '../sim/world';
import { Lod } from './dress/kit';
import { createSea } from './dress/sea';
import { MeshBuilder } from './geom';
import { inkMaterial } from './look';
import { meshRail, meshSolid, meshTerrain, meshZoneProps } from './worldMesh';
import type { WorldView } from './worldView';

export const STREAM = {
  /** Chunk side in cells (60 m on the city's 3 m grid). */
  CHUNK_CELLS: 20,
  /** Chunks whose centre is nearer than this are drawn fully dressed, m. */
  NEAR_R: 170,
  /** Chunks whose centre is nearer than this are drawn at all (as silhouettes beyond NEAR_R), m. */
  FAR_R: 330,
  /** A chunk keeps its level of detail this far past the threshold before dropping, m. */
  HYST: 15,
  /** Most chunks shown at once: the world's share of the draw-call budget. */
  MAX_SHOWN: 56,
  /** Hidden chunk meshes kept for a quick return. */
  CACHE: 16,
  /** A hidden chunk beyond the cache is disposed after this long out of range, ms. */
  EVICT_MS: 4000,
  /** Build time allowed per frame, ms (the first build of a frame always runs). */
  BUILD_MS: 4,
  /** Most chunk builds per frame. */
  MAX_BUILDS: 2,
} as const;

export interface ChunkGrid {
  minX: number;
  minZ: number;
  /** Chunk side, m. */
  size: number;
  cells: number;
  ncx: number;
  ncz: number;
}

export function chunkGrid(w: World): ChunkGrid {
  const cells = STREAM.CHUNK_CELLS;
  return {
    minX: w.minX,
    minZ: w.minZ,
    size: cells * w.cell,
    cells,
    ncx: Math.max(1, Math.ceil(w.nx / cells)),
    ncz: Math.max(1, Math.ceil(w.nz / cells)),
  };
}

/** The chunk containing (x, z), clamped to the grid. */
export function chunkOf(g: ChunkGrid, x: number, z: number): number {
  let cx = Math.floor((x - g.minX) / g.size);
  let cz = Math.floor((z - g.minZ) / g.size);
  if (cx < 0) cx = 0;
  else if (cx >= g.ncx) cx = g.ncx - 1;
  if (cz < 0) cz = 0;
  else if (cz >= g.ncz) cz = g.ncz - 1;
  return cz * g.ncx + cx;
}

export interface ChunkBuckets {
  solids: number[][];
  rails: number[][];
  zones: number[][];
}

/**
 * Every solid, rail and zone in exactly one chunk: a solid by its centre, a rail by its first
 * point, a zone by its centre.
 */
export function bucketWorld(w: World, g: ChunkGrid): ChunkBuckets {
  const n = g.ncx * g.ncz;
  const out: ChunkBuckets = { solids: [], rails: [], zones: [] };
  for (let i = 0; i < n; i++) {
    out.solids.push([]);
    out.rails.push([]);
    out.zones.push([]);
  }
  for (const o of w.solids) out.solids[chunkOf(g, o.cx, o.cz)].push(o.index);
  for (const r of w.rails) out.rails[chunkOf(g, r.pts[0], r.pts[2])].push(r.index);
  for (let i = 0; i < w.zones.length; i++) out.zones[chunkOf(g, w.zones[i].x, w.zones[i].z)].push(i);
  return out;
}

/** Terrain rows meshed per piece of an incremental chunk build. */
const ROWS_PER_PIECE = 4;

/**
 * One chunk being built at one level of detail, in small pieces (a few terrain rows, one solid,
 * one rail, one zone), so the work can stop at a deadline and resume on a later frame.
 */
export class ChunkJob {
  readonly b = new MeshBuilder();
  /** Time spent on this chunk so far, ms (kept by the caller). */
  ms = 0;
  private readonly w: World;
  private readonly bk: ChunkBuckets;
  private readonly ci: number;
  private readonly lod: Lod;
  private readonly ix0: number;
  private readonly ix1: number;
  private readonly iz0: number;
  private readonly iz1: number;
  private phase = 0;
  private i = 0;

  constructor(w: World, g: ChunkGrid, bk: ChunkBuckets, ci: number, lod: Lod) {
    this.w = w;
    this.bk = bk;
    this.ci = ci;
    this.lod = lod;
    this.ix0 = (ci % g.ncx) * g.cells;
    this.iz0 = Math.floor(ci / g.ncx) * g.cells;
    this.ix1 = Math.min(w.nx, this.ix0 + g.cells);
    this.iz1 = Math.min(w.nz, this.iz0 + g.cells);
  }

  /** Do one piece of work; true when the chunk is complete. */
  step(): boolean {
    const w = this.w;
    const ci = this.ci;
    switch (this.phase) {
      case 0: {
        const z0 = this.iz0 + this.i;
        const z1 = Math.min(this.iz1, z0 + ROWS_PER_PIECE);
        meshTerrain(this.b, w, this.ix0, z0, this.ix1, z1, this.lod);
        this.i += ROWS_PER_PIECE;
        if (z1 >= this.iz1) this.next();
        return false;
      }
      case 1:
        if (this.i < this.bk.solids[ci].length) meshSolid(this.b, w, w.solids[this.bk.solids[ci][this.i++]], this.lod);
        else this.next();
        return false;
      case 2:
        if (this.i < this.bk.rails[ci].length) meshRail(this.b, w, w.rails[this.bk.rails[ci][this.i++]], this.lod);
        else this.next();
        return false;
      case 3:
        if (this.i < this.bk.zones[ci].length) meshZoneProps(this.b, w, w.zones[this.bk.zones[ci][this.i++]], this.lod);
        else this.next();
        return false;
      default:
        return true;
    }
  }

  /** Work until done (true) or until `clock()` reaches `deadline` (false). Always does one piece. */
  run(clock: () => number, deadline: number): boolean {
    for (;;) {
      if (this.step()) return true;
      if (clock() >= deadline) return false;
    }
  }

  private next(): void {
    this.phase++;
    this.i = 0;
  }
}

/** Everything in one chunk at one level of detail, into one builder, in one go. */
export function meshChunk(b: MeshBuilder, w: World, g: ChunkGrid, bk: ChunkBuckets, ci: number, lod: Lod): void {
  const cx = ci % g.ncx;
  const cz = Math.floor(ci / g.ncx);
  const ix0 = cx * g.cells;
  const iz0 = cz * g.cells;
  meshTerrain(b, w, ix0, iz0, Math.min(w.nx, ix0 + g.cells), Math.min(w.nz, iz0 + g.cells), lod);
  for (const s of bk.solids[ci]) meshSolid(b, w, w.solids[s], lod);
  for (const r of bk.rails[ci]) meshRail(b, w, w.rails[r], lod);
  for (const z of bk.zones[ci]) meshZoneProps(b, w, w.zones[z], lod);
}

/** The level of detail a chunk at distance `d` should have, given what it shows now. */
export function wantLod(d: number, current: Lod): Lod {
  if (d < STREAM.NEAR_R || (current === Lod.NEAR && d < STREAM.NEAR_R + STREAM.HYST)) return Lod.NEAR;
  if (d < STREAM.FAR_R || (current !== Lod.NONE && d < STREAM.FAR_R + STREAM.HYST)) return Lod.FAR;
  return Lod.NONE;
}

export interface StreamHooks<T> {
  /**
   * Build (or keep building) a chunk. Work may be split across calls: return null when `clock()`
   * passes `deadline` before the chunk is done, and the streamer calls again on a later frame.
   * The first piece of work of a call always runs.
   */
  build(chunk: number, lod: Lod, clock: () => number, deadline: number): T | null;
  /** Make a built item visible / invisible. */
  show(item: T): void;
  hide(item: T): void;
  dispose(item: T): void;
}

/**
 * The streaming policy. Pure apart from the hooks: camera position and clock in, builds out.
 * No allocation per update once its arrays exist.
 */
export class ChunkStreamer<T> {
  readonly n: number;
  /** Level of detail each chunk shows now. */
  readonly shown: Int8Array;
  /** Built items: index chunk * 2 + (lod - 1). */
  readonly items: (T | null)[];
  private readonly hiddenAt: Float64Array;
  private readonly isShown: Uint8Array;
  private readonly cand: Int32Array;
  private readonly candD: Float64Array;
  private readonly stamp: Int32Array;
  private frame = 0;
  private lastChunk = -1;
  private nCand = 0;
  /** Chunks finished in the most recent update, and in total. */
  builtLast = 0;
  builtTotal = 0;
  /** Longest time spent building in one update, ms. */
  worstFrameBuildMs = 0;

  private readonly g: ChunkGrid;
  private readonly hooks: StreamHooks<T>;

  constructor(g: ChunkGrid, hooks: StreamHooks<T>) {
    this.g = g;
    this.hooks = hooks;
    this.n = g.ncx * g.ncz;
    this.shown = new Int8Array(this.n);
    this.items = new Array<T | null>(this.n * 2).fill(null);
    this.hiddenAt = new Float64Array(this.n * 2);
    this.isShown = new Uint8Array(this.n * 2);
    this.cand = new Int32Array(this.n);
    this.candD = new Float64Array(this.n);
    this.stamp = new Int32Array(this.n);
  }

  /** Chunks currently shown. */
  shownCount(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.shown[i] !== Lod.NONE) k++;
    return k;
  }

  /** Built items held (shown or cached). */
  residentCount(): number {
    let k = 0;
    for (let i = 0; i < this.items.length; i++) if (this.items[i] !== null) k++;
    return k;
  }

  /** Distance from (x, z) to a chunk's centre. */
  dist(ci: number, x: number, z: number): number {
    const g = this.g;
    const cx = g.minX + ((ci % g.ncx) + 0.5) * g.size;
    const cz = g.minZ + (Math.floor(ci / g.ncx) + 0.5) * g.size;
    const dx = cx - x;
    const dz = cz - z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  update(camX: number, camZ: number, nowMs: number, clock: () => number): void {
    const g = this.g;
    this.frame++;
    const frame = this.frame;
    this.builtLast = 0;

    // Candidates: chunks within reach, nearest first (insertion sort on preallocated arrays).
    const reach = STREAM.FAR_R + STREAM.HYST + g.size;
    const cx0 = Math.max(0, Math.floor((camX - reach - g.minX) / g.size));
    const cx1 = Math.min(g.ncx - 1, Math.floor((camX + reach - g.minX) / g.size));
    const cz0 = Math.max(0, Math.floor((camZ - reach - g.minZ) / g.size));
    const cz1 = Math.min(g.ncz - 1, Math.floor((camZ + reach - g.minZ) / g.size));
    let nc = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cz * g.ncx + cx;
        const d = this.dist(ci, camX, camZ);
        if (d >= STREAM.FAR_R + STREAM.HYST) continue;
        let j = nc++;
        while (j > 0 && this.candD[j - 1] > d) {
          this.cand[j] = this.cand[j - 1];
          this.candD[j] = this.candD[j - 1];
          j--;
        }
        this.cand[j] = ci;
        this.candD[j] = d;
      }
    }
    this.nCand = nc;

    // Appearing somewhere new: the chunk under the camera and its neighbours, right now.
    const here = chunkOf(g, camX, camZ);
    const hx = here % g.ncx;
    const hz = Math.floor(here / g.ncx);
    const teleport = this.lastChunk < 0 || Math.abs((this.lastChunk % g.ncx) - hx) > 1 || Math.abs(Math.floor(this.lastChunk / g.ncx) - hz) > 1;
    this.lastChunk = here;

    const t0 = clock();
    const deadline = t0 + STREAM.BUILD_MS;
    let spent = false; // the frame's build budget is used up
    for (let k = 0; k < nc; k++) {
      const ci = this.cand[k];
      const d = this.candD[k];
      this.stamp[ci] = frame;
      const cur = this.shown[ci] as Lod;
      const want = k < STREAM.MAX_SHOWN ? wantLod(d, cur) : Lod.NONE;
      if (want === cur) continue;
      if (want === Lod.NONE) {
        this.hideChunk(ci, nowMs);
        continue;
      }
      const slot = ci * 2 + want - 1;
      if (this.items[slot] === null) {
        const cxk = ci % g.ncx;
        const czk = Math.floor(ci / g.ncx);
        const urgent = teleport && Math.abs(cxk - hx) <= 1 && Math.abs(czk - hz) <= 1;
        if (!urgent && (spent || this.builtLast >= STREAM.MAX_BUILDS)) continue; // keep showing what it has
        const item = this.hooks.build(ci, want, clock, urgent ? Infinity : deadline);
        if (item === null) {
          spent = true;
          continue;
        }
        this.items[slot] = item;
        this.builtLast++;
        this.builtTotal++;
        if (clock() >= deadline) spent = true;
      }
      this.hideChunk(ci, nowMs);
      const item = this.items[slot];
      if (item !== null) {
        this.hooks.show(item);
        this.isShown[slot] = 1;
        this.shown[ci] = want;
      }
    }
    const ms = clock() - t0;
    if (ms > this.worstFrameBuildMs) this.worstFrameBuildMs = ms;
    // Shown chunks that fell out of reach.
    for (let ci = 0; ci < this.n; ci++) {
      if (this.shown[ci] !== Lod.NONE && this.stamp[ci] !== frame) this.hideChunk(ci, nowMs);
    }
    this.evict(nowMs);
  }

  private hideChunk(ci: number, nowMs: number): void {
    const cur = this.shown[ci];
    if (cur === Lod.NONE) return;
    const slot = ci * 2 + cur - 1;
    const item = this.items[slot];
    if (item !== null && this.isShown[slot]) this.hooks.hide(item);
    this.isShown[slot] = 0;
    this.hiddenAt[slot] = nowMs;
    this.shown[ci] = Lod.NONE;
  }

  /** Keep at most CACHE hidden items; beyond that drop the oldest once they are EVICT_MS stale. */
  private evict(nowMs: number): void {
    for (;;) {
      let hidden = 0;
      let oldest = -1;
      for (let s = 0; s < this.items.length; s++) {
        if (this.items[s] === null || this.isShown[s]) continue;
        hidden++;
        if (oldest < 0 || this.hiddenAt[s] < this.hiddenAt[oldest]) oldest = s;
      }
      if (hidden <= STREAM.CACHE || oldest < 0) return;
      const hard = hidden > STREAM.CACHE * 2;
      if (!hard && nowMs - this.hiddenAt[oldest] < STREAM.EVICT_MS) return;
      const item = this.items[oldest];
      if (item !== null) this.hooks.dispose(item);
      this.items[oldest] = null;
    }
  }

  /** The candidate order of the last update (nearest first), for tests and debugging. */
  candidates(out: number[]): number[] {
    out.length = 0;
    for (let k = 0; k < this.nCand; k++) out.push(this.cand[k]);
    return out;
  }

  /** Drop everything. */
  clear(): void {
    for (let s = 0; s < this.items.length; s++) {
      const item = this.items[s];
      if (item !== null) {
        if (this.isShown[s]) this.hooks.hide(item);
        this.hooks.dispose(item);
      }
      this.items[s] = null;
      this.isShown[s] = 0;
    }
    this.shown.fill(0);
    this.lastChunk = -1;
  }
}

export interface CityView extends WorldView {
  /** Streaming statistics, for the perf report. */
  stats(): { shown: number; resident: number; builtTotal: number; worstChunkMs: number; worstFrameBuildMs: number; triangles: number };
}

/** Partly built chunks kept while nearer ones jump the queue. */
const MAX_PARTIAL = 6;

const now = (): number => performance.now();

/** The streaming, dressed world view for a big world. */
export function createCityView(world: World): CityView {
  const group = new THREE.Group();
  group.name = 'city';
  const mat = inkMaterial();
  const g = chunkGrid(world);
  const bk = bucketWorld(world, g);
  const jobs: (ChunkJob | null)[] = new Array<ChunkJob | null>(g.ncx * g.ncz * 2).fill(null);
  const partial: number[] = [];
  let triangles = 0;
  let worstChunkMs = 0;
  const streamer = new ChunkStreamer<THREE.Mesh>(g, {
    build(ci, lod, clock, deadline) {
      const slot = ci * 2 + lod - 1;
      let job = jobs[slot];
      if (job === null) {
        if (partial.length >= MAX_PARTIAL) {
          const drop = partial.shift();
          if (drop !== undefined) jobs[drop] = null;
        }
        job = new ChunkJob(world, g, bk, ci, lod);
        jobs[slot] = job;
        partial.push(slot);
      }
      const t0 = clock();
      const done = job.run(clock, deadline);
      job.ms += clock() - t0;
      if (!done) return null;
      jobs[slot] = null;
      partial.splice(partial.indexOf(slot), 1);
      if (job.ms > worstChunkMs) worstChunkMs = job.ms;
      const b = job.b;
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.name = `chunk_${ci}_${lod === Lod.NEAR ? 'near' : 'far'}`;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      triangles += b.triangleCount;
      mesh.userData.tris = b.triangleCount;
      group.add(mesh);
      return mesh;
    },
    show(m) {
      m.visible = true;
    },
    hide(m) {
      m.visible = false;
    },
    dispose(m) {
      group.remove(m);
      triangles -= m.userData.tris as number;
      m.geometry.dispose();
    },
  });
  const sea = createSea(world);
  if (sea) group.add(sea.mesh);

  return {
    group,
    update(camX, camZ, dayFrac) {
      streamer.update(camX, camZ, now(), now);
      sea?.setTime(dayFrac * 720);
    },
    stats() {
      return {
        shown: streamer.shownCount(),
        resident: streamer.residentCount(),
        builtTotal: streamer.builtTotal,
        worstChunkMs,
        worstFrameBuildMs: streamer.worstFrameBuildMs,
        triangles,
      };
    },
    dispose() {
      streamer.clear();
      sea?.dispose();
    },
  };
}
