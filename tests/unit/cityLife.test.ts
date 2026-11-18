/**
 * City life (brief M7b): printed pattern on the ground, people, props and birds, all decoration.
 *
 * - every near chunk of the Mercado, Terraces and Docks with streets, plazas or stairs in it has
 *   printed paint, and that paint lies within 3 cm of the ground;
 * - no figure (standing, sitting, leaning or on a walker's beat) is within 2 m of a ride's lane,
 *   on a rail or its run-in, or in the middle third of a stair street; checked here from the world
 *   data directly, not through the planner's own test;
 * - a chunk rebuilt gives the same geometry and the same people;
 * - decoration stays inside a per-chunk triangle bound set from the budget;
 * - the crowd thins at night, figures are drawn only near the camera, and birds scatter when the
 *   skater comes within SCATTER_R.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkJob, bucketWorld, chunkGrid } from '../../src/render/cityView';
import { Lod } from '../../src/render/dress/kit';
import { meshLanePaint, meshLifePaint } from '../../src/render/dress/life';
import { meshBuntingRow, meshSolidProps } from '../../src/render/dress/props';
import { PAINT_LIFT } from '../../src/render/dress/terrain';
import { MeshBuilder } from '../../src/render/geom';
import {
  FIGURE_TRIS,
  Kind,
  PEOPLE_R,
  RAIL_CLEAR,
  RUN_IN,
  SCATTER_R,
  createLifeLayer,
  liveChunk,
  meshFigure,
  outShare,
  routeCtx,
  type ChunkLife,
  type Figure,
} from '../../src/render/people';
import { buildCity } from '../../src/sim/city/index';
import { District, Surface, terrainHeight, type World } from '../../src/sim/world';

const city = buildCity(1).world;
const grid = chunkGrid(city);
const buckets = bucketWorld(city, grid);
const N = grid.ncx * grid.ncz;

/** Decoration triangles a near chunk may add (printed paint, lane paint, props, bunting). */
const DECOR_TRIS_MAX = 2000;

function chunkCells(ci: number): [number, number, number, number] {
  const ix0 = (ci % grid.ncx) * grid.cells;
  const iz0 = Math.floor(ci / grid.ncx) * grid.cells;
  return [ix0, iz0, Math.min(city.nx, ix0 + grid.cells), Math.min(city.nz, iz0 + grid.cells)];
}

const lives: (ChunkLife | null)[] = [];
const hashes: string[] = [];
for (let ci = 0; ci < N; ci++) {
  const job = new ChunkJob(city, grid, buckets, ci, Lod.NEAR);
  job.finish();
  lives.push(job.life);
  hashes.push(hashGeometry(job.geometry));
  job.geometry?.dispose();
}

function hashGeometry(g: THREE.BufferGeometry | null): string {
  if (!g) return 'none';
  let h = 0x811c9dc5;
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name).array as Float32Array;
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Distance from (x, z) to the edge of the nearest ground ride's lane (its path widened by its body). */
function laneEdgeDist(w: World, x: number, z: number): number {
  let best = Infinity;
  for (const l of w.lines) {
    if (l.overhead || l.bodyHeight <= 0) continue;
    const p = l.pathPts;
    for (let i = 3; i < p.length; i += 3) best = Math.min(best, segDist(x, z, p[i - 3], p[i - 1], p[i], p[i + 2]) - l.bodyHalfWid);
  }
  return best;
}

/** Distance from (x, z) to the nearest ground-level rail or the run-in past its ends. */
function railDist(w: World, x: number, z: number): number {
  let best = Infinity;
  for (const r of w.rails) {
    const p = r.pts;
    const n = p.length / 3;
    let low = Infinity;
    for (let i = 0; i < n; i++) low = Math.min(low, p[i * 3 + 1] - terrainHeight(w, p[i * 3], p[i * 3 + 2]));
    if (low > 3) continue;
    for (let i = 1; i < n; i++) best = Math.min(best, segDist(x, z, p[i * 3 - 3], p[i * 3 - 1], p[i * 3], p[i * 3 + 2]));
    for (const [a, b] of [[0, 1], [n - 1, n - 2]]) {
      const dx = p[a * 3] - p[b * 3];
      const dz = p[a * 3 + 2] - p[b * 3 + 2];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      best = Math.min(best, segDist(x, z, p[a * 3], p[a * 3 + 2], p[a * 3] + (dx / l) * RUN_IN, p[a * 3 + 2] + (dz / l) * RUN_IN));
    }
  }
  return best;
}

/** On a stair cell, is (x, z) in the middle third of the stair street's width (its run of stair cells across x)? */
function stairMiddle(w: World, x: number, z: number): boolean {
  const ix = Math.floor((x - w.minX) / w.cell);
  const iz = Math.floor((z - w.minZ) / w.cell);
  if (w.surfaces[iz * w.nx + ix] !== Surface.STAIRS) return false;
  let a = ix;
  let b = ix + 1;
  while (a > 0 && w.surfaces[iz * w.nx + a - 1] === Surface.STAIRS) a--;
  while (b < w.nx && w.surfaces[iz * w.nx + b] === Surface.STAIRS) b++;
  if (b - a > 10) return false;
  const lo = w.minX + a * w.cell;
  const third = ((b - a) * w.cell) / 3;
  return x > lo + third && x < lo + 2 * third;
}

function everyFigure(): { f: Figure; walker: boolean }[] {
  const out: { f: Figure; walker: boolean }[] = [];
  for (const life of lives) {
    if (!life) continue;
    for (const f of life.figures) out.push({ f, walker: false });
    for (const wk of life.walkers) {
      for (let k = 0; k <= 10; k++) {
        const x = wk.ax + ((wk.bx - wk.ax) * k) / 10;
        const z = wk.az + ((wk.bz - wk.az) * k) / 10;
        out.push({ f: { ...wk.fig, x, z }, walker: true });
      }
    }
  }
  return out;
}

describe('printed life on the ground', () => {
  it('every near chunk of the Mercado, Terraces and Docks with ground to walk on has paint, within 3 cm of the ground', () => {
    let checked = 0;
    for (let ci = 0; ci < N; ci++) {
      const life = lives[ci];
      if (!life || life.district === District.ANTENNA) continue;
      const [ix0, iz0, ix1, iz1] = chunkCells(ci);
      let walkable = 0;
      for (let iz = iz0; iz < iz1; iz++) {
        for (let ix = ix0; ix < ix1; ix++) {
          const s = city.surfaces[iz * city.nx + ix];
          if (s === Surface.STREET || s === Surface.PLAZA || s === Surface.STAIRS) walkable++;
        }
      }
      if (walkable < 20) continue;
      const b = new MeshBuilder();
      meshLifePaint(b, city, ix0, iz0, ix1, iz1);
      const c = city.cell;
      for (let li = 0; li < city.lines.length; li++) meshLanePaint(b, city, li, city.minX + ix0 * c, city.minZ + iz0 * c, city.minX + ix1 * c, city.minZ + iz1 * c);
      expect(b.triangleCount, `chunk ${ci} (district ${life.district}) has no ground paint`).toBeGreaterThan(0);
      const g = b.build();
      const pos = g.getAttribute('position').array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        const above = pos[i + 1] - terrainHeight(city, pos[i], pos[i + 2]);
        expect(Math.abs(above), `paint at ${pos[i]}, ${pos[i + 2]}`).toBeLessThanOrEqual(PAINT_LIFT + 1e-3);
      }
      g.dispose();
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe('people', () => {
  const all = everyFigure();

  it('the city has people in every district, crowded in the Mercado and sparse on the summit', () => {
    const by = [0, 0, 0, 0];
    for (const life of lives) if (life) by[life.district] += life.figures.length;
    for (const n of by) expect(n).toBeGreaterThan(20);
    expect(by[District.MERCADO]).toBeGreaterThan(by[District.ANTENNA] * 2);
  });

  it('never stands within 2 m of a ride lane, on a rail or its run-in, or in the middle third of a stair street', () => {
    expect(all.length).toBeGreaterThan(300);
    for (const { f, walker } of all) {
      const where = `${walker ? 'walker' : 'figure'} at ${f.x.toFixed(1)}, ${f.z.toFixed(1)}`;
      expect(laneEdgeDist(city, f.x, f.z), where).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(railDist(city, f.x, f.z), where).toBeGreaterThanOrEqual(RAIL_CLEAR - 1e-6);
      expect(stairMiddle(city, f.x, f.z), where).toBe(false);
      const ix = Math.floor((f.x - city.minX) / city.cell);
      const iz = Math.floor((f.z - city.minZ) / city.cell);
      expect(city.surfaces[iz * city.nx + ix], where).not.toBe(Surface.STREET);
    }
  });

  it('a chunk rebuilt has identical geometry and identical people', () => {
    for (let ci = 0; ci < N; ci += 3) {
      const job = new ChunkJob(city, grid, buckets, ci, Lod.NEAR);
      job.finish();
      expect(hashGeometry(job.geometry), `chunk ${ci}`).toBe(hashes[ci]);
      expect(JSON.stringify(job.life), `chunk ${ci}`).toBe(JSON.stringify(lives[ci]));
      job.geometry?.dispose();
    }
  });

  it('figures stay inside their triangle bound in every pose', () => {
    for (let k = 0; k < 5; k++) {
      for (let p = 0; p < 2; p++) {
        const b = new MeshBuilder();
        meshFigure(b, { x: 0, y: 0, z: 0, fx: 0, fz: 1, kind: k as Kind, shirt: 1, legs: 2, skin: 3, hair: 4, load: 5, keep: 0 }, p);
        expect(b.triangleCount).toBeLessThanOrEqual(FIGURE_TRIS);
      }
    }
  });

  it('thins at night: fewer out after dark in every district, by day all of them', () => {
    for (const d of [District.DOCKS, District.MERCADO, District.TERRACES, District.ANTENNA]) {
      expect(outShare(d, 0.45)).toBe(1);
      expect(outShare(d, 0.95)).toBeLessThan(0.5);
    }
  });
});

describe('decoration budget', () => {
  it(`no near chunk adds more than ${DECOR_TRIS_MAX} triangles of decoration`, () => {
    let worst = 0;
    for (let ci = 0; ci < N; ci++) {
      if (!lives[ci]) continue;
      const [ix0, iz0, ix1, iz1] = chunkCells(ci);
      const c = city.cell;
      const b = new MeshBuilder();
      const ctx = routeCtx(city, city.minX + ix0 * c, city.minZ + iz0 * c, city.minX + ix1 * c, city.minZ + iz1 * c);
      meshLifePaint(b, city, ix0, iz0, ix1, iz1);
      for (let li = 0; li < city.lines.length; li++) meshLanePaint(b, city, li, city.minX + ix0 * c, city.minZ + iz0 * c, city.minX + ix1 * c, city.minZ + iz1 * c);
      for (const s of buckets.solids[ci]) meshSolidProps(b, city, ctx, city.solids[s]);
      for (let iz = iz0; iz < iz1; iz++) meshBuntingRow(b, city, ix0, ix1, iz);
      worst = Math.max(worst, b.triangleCount);
      expect(b.triangleCount, `chunk ${ci}`).toBeLessThanOrEqual(DECOR_TRIS_MAX);
    }
    console.log(`worst decoration in a near chunk: ${worst} triangles`);
  });
});

describe('the life layer', () => {
  it('draws only the people near the camera, in one mesh, and birds scatter from the skater', () => {
    const layer = createLifeLayer(city, () => new MeshBuilder());
    const live = lives.map((l, ci) => (l ? liveChunk(l, grid.minX + ((ci % grid.ncx) + 0.5) * grid.size, grid.minZ + (Math.floor(ci / grid.ncx) + 0.5) * grid.size) : null)).filter((l) => l !== null);
    // A bird to stand by.
    const withBirds = live.find((l) => l.life.birds.length > 0);
    expect(withBirds).toBeDefined();
    if (!withBirds) return;
    const bx = withBirds.life.birds[0];
    const by = withBirds.life.birds[1];
    const bz = withBirds.life.birds[2];
    // Camera beside the bird, skater far away: perched.
    layer.update(live, live.length, 1, bx + 5, bz + 5, bx + 100, bz + 100, 0.45);
    const pos = (): Float32Array => layer.mesh.geometry.getAttribute('position').array as Float32Array;
    const range = (): number => layer.mesh.geometry.drawRange.count;
    expect(layer.counts().people).toBeGreaterThan(0);
    let maxD = 0;
    const idx = layer.mesh.geometry.getIndex();
    if (!idx) throw new Error('no index');
    for (let i = 0; i < range(); i++) {
      const v = idx.array[i] * 3;
      maxD = Math.max(maxD, Math.hypot(pos()[v] - (bx + 5), pos()[v + 2] - (bz + 5)));
    }
    expect(maxD).toBeLessThan(PEOPLE_R + 10);
    const near = (): number => {
      let n = 0;
      for (let i = 0; i < range(); i++) {
        const v = idx.array[i] * 3;
        if (Math.hypot(pos()[v] - bx, pos()[v + 1] - by, pos()[v + 2] - bz) < 0.4) n++;
      }
      return n;
    };
    expect(near()).toBeGreaterThan(0);
    // The skater rolls up within SCATTER_R: a moment later the bird has left its perch.
    layer.update(live, live.length, 1, bx + 5, bz + 5, bx + SCATTER_R * 0.5, bz, 0.45 + 5 / 43200);
    layer.update(live, live.length, 1, bx + 5, bz + 5, bx + SCATTER_R * 0.5, bz, 0.45 + 60 / 43200);
    expect(near()).toBe(0);
    layer.dispose();
  });
});
