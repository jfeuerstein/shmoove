/**
 * The city is lit at night (M6k). Every chunk of the city is built at both levels of detail, solid
 * by solid, and the windows counted: a window is a quad in WINDOW_INK, lit when it carries `glow`
 * (the ink material turns glow mango as night falls).
 *
 * - near: most buildings that have windows have a lit one, and about half of all windows are lit;
 * - far: a good share of buildings carry a glowing vertex, so the silhouettes read as a town;
 * - the lights only add geometry: without them every chunk's solids hash to what they were before
 *   the lights existed (positions, colours, triangles; the fixture was recorded from that code),
 *   and with them that geometry comes first, unchanged, followed by the added quads;
 * - which windows are lit is fixed: building a solid again gives the same glow.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bucketWorld, chunkGrid } from '../../src/render/cityView';
import { Lod, WINDOW_INK } from '../../src/render/dress/kit';
import { meshSolidFar, meshSolidNear } from '../../src/render/dress/solids';
import { MeshBuilder } from '../../src/render/geom';
import { buildCity } from '../../src/sim/city/index';
import type { Solid, World } from '../../src/sim/world';
import golden from './fixtures/night-day-golden.json';

const city: World = buildCity(1).world;
const grid = chunkGrid(city);
const buckets = bucketWorld(city, grid);
const CHUNKS = grid.ncx * grid.ncz;

/** Kinds that are buildings: things with rooms, which may have windows. */
const BUILDINGS = new Set(['building', 'house', 'tower', 'church', 'school', 'warehouse', 'market', 'shed']);

const WR = Math.fround(((WINDOW_INK >> 16) & 255) / 255);
const WG = Math.fround(((WINDOW_INK >> 8) & 255) / 255);
const WB = Math.fround((WINDOW_INK & 255) / 255);

function mesh(o: Solid, lod: Lod, lights: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  if (lod === Lod.NEAR) meshSolidNear(b, city, o, lights);
  else meshSolidFar(b, city, o, lights);
  return b.build();
}

function arr(g: THREE.BufferGeometry, name: string): ArrayLike<number> {
  return g.getAttribute(name).array as Float32Array;
}

function indices(g: THREE.BufferGeometry): ArrayLike<number> {
  return g.getIndex()?.array ?? [];
}

/** Window quads of a geometry and how many of them are lit. */
function windows(g: THREE.BufferGeometry): { all: number; lit: number } {
  const c = arr(g, 'color');
  const glow = g.getAttribute('glow')?.array;
  let all = 0;
  let lit = 0;
  for (let v = 0; v < c.length / 3; v++) {
    if (c[v * 3] !== WR || c[v * 3 + 1] !== WG || c[v * 3 + 2] !== WB) continue;
    all++;
    if (glow && glow[v] > 0) lit++;
  }
  // Every window is a quad of four vertices.
  expect(all % 4).toBe(0);
  return { all: all / 4, lit: lit / 4 };
}

function glows(g: THREE.BufferGeometry): boolean {
  const glow = g.getAttribute('glow')?.array;
  if (!glow) return false;
  for (let i = 0; i < glow.length; i++) if (glow[i] > 0) return true;
  return false;
}

describe('night lights in the city', () => {
  it('lights about half the windows of most near buildings, and some of every far skyline', () => {
    let buildings = 0;
    let withWindows = 0;
    let withLit = 0;
    let all = 0;
    let lit = 0;
    let farGlowing = 0;
    for (let ci = 0; ci < CHUNKS; ci++) {
      for (const si of buckets.solids[ci]) {
        const o = city.solids[si];
        if (!BUILDINGS.has(o.kind)) continue;
        buildings++;
        const n = windows(mesh(o, Lod.NEAR, true));
        all += n.all;
        lit += n.lit;
        if (n.all > 0) withWindows++;
        if (n.lit > 0) withLit++;
        if (glows(mesh(o, Lod.FAR, true))) farGlowing++;
      }
    }
    console.log(
      `night lights: ${buildings} buildings, ${withWindows} with windows, ${withLit} with a lit one (${((100 * withLit) / withWindows).toFixed(1)} %); ` +
        `${all} windows, ${lit} lit (${((100 * lit) / all).toFixed(1)} %); far: ${farGlowing} buildings glow (${((100 * farGlowing) / buildings).toFixed(1)} %)`,
    );
    expect(buildings).toBeGreaterThan(100);
    expect(withLit / withWindows).toBeGreaterThanOrEqual(0.6);
    expect(lit / all).toBeGreaterThanOrEqual(0.35);
    expect(lit / all).toBeLessThanOrEqual(0.65);
    expect(farGlowing / buildings).toBeGreaterThanOrEqual(0.25);
  });

  it('only adds geometry: the day dressing of every chunk is what it was, and comes first', () => {
    const want = golden as Record<string, string>;
    let checked = 0;
    for (const lod of [Lod.NEAR, Lod.FAR] as const) {
      for (let ci = 0; ci < CHUNKS; ci++) {
        if (buckets.solids[ci].length === 0) continue;
        let h = 0x811c9dc5;
        const mix = (v: number): void => {
          h = Math.imul(h ^ v, 0x01000193) >>> 0;
        };
        for (const si of buckets.solids[ci]) {
          const o = city.solids[si];
          const day = mesh(o, lod, false);
          for (const name of ['position', 'color']) {
            const a = arr(day, name) as Float32Array;
            const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
            mix(a.length);
            for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
          }
          const di = indices(day);
          mix(di.length);
          for (let i = 0; i < di.length; i++) mix(di[i]);
          // With the lights: the same vertices and triangles first, then only additions.
          const lit = mesh(o, lod, true);
          for (const name of ['position', 'color']) {
            const a = arr(day, name);
            const b = arr(lit, name);
            expect(b.length).toBeGreaterThanOrEqual(a.length);
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) expect.fail(`${o.kind} ${o.index}: ${name}[${i}] changed`);
          }
          const li = indices(lit);
          expect(li.length).toBeGreaterThanOrEqual(di.length);
          for (let i = 0; i < di.length; i++) if (di[i] !== li[i]) expect.fail(`${o.kind} ${o.index}: index ${i} changed`);
        }
        const key = `${lod === Lod.NEAR ? 'near' : 'far'}:${ci}`;
        expect(h.toString(16).padStart(8, '0'), key).toBe(want[key]);
        checked++;
      }
    }
    expect(checked).toBe(Object.keys(want).length);
  });

  it('lights the same windows every time a chunk is built', () => {
    for (let si = 0; si < city.solids.length; si += 7) {
      const o = city.solids[si];
      for (const lod of [Lod.NEAR, Lod.FAR] as const) {
        const a = mesh(o, lod, true).getAttribute('glow')?.array ?? [];
        const b = mesh(o, lod, true).getAttribute('glow')?.array ?? [];
        expect(Array.from(b)).toEqual(Array.from(a));
      }
    }
  });
});
