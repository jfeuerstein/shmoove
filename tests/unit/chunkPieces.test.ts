/**
 * Chunk builds in pieces (M6f). The streaming city view builds a chunk a small piece at a time and
 * looks at the clock between pieces, so a frame overruns its 2 ms build budget by one piece at
 * most. These tests build every chunk of the city, at both levels of detail, piece by piece:
 *
 * - no piece costs more than PIECE_BOUND_MS. Each piece is timed over RUNS whole-city passes and
 *   its best time kept, so a loaded machine cannot fail the test; the bound is generous (the worst
 *   best piece is printed: about 0.3-0.5 ms here, the typed-array build of the biggest near chunks);
 * - the finished geometry is identical, attribute array by attribute array, to the same chunk
 *   meshed in one go (`meshChunk`), so streaming cannot change a pixel;
 * - after a teleport the streamer builds, at once, every chunk within the near radius the camera
 *   can see, and still only the 3x3 under it when it is not told what the camera sees.
 */
import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ChunkJob, ChunkStreamer, STREAM, bucketWorld, chunkGrid, chunkOf, meshChunk, type ChunkGrid } from '../../src/render/cityView';
import { Lod } from '../../src/render/dress/kit';
import { MeshBuilder } from '../../src/render/geom';
import { buildCity } from '../../src/sim/city/index';

const PIECE_BOUND_MS = 2;
const RUNS = 5;

const city = buildCity(1).world;
const grid = chunkGrid(city);
const buckets = bucketWorld(city, grid);
const LODS = [Lod.NEAR, Lod.FAR] as const;

/** FNV-1a over the bytes of every attribute array and the index, with their names and lengths. */
function hashGeometry(g: THREE.BufferGeometry): string {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193) >>> 0;
  };
  const names = Object.keys(g.attributes).sort();
  const arrays: [string, ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }][] = names.map((n) => [
    n,
    g.getAttribute(n).array as Float32Array,
  ]);
  const index = g.getIndex();
  if (index) arrays.push(['index', index.array as Uint16Array]);
  for (const [name, a] of arrays) {
    for (let i = 0; i < name.length; i++) mix(name.charCodeAt(i));
    mix(a.length);
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
  }
  return h.toString(16).padStart(8, '0');
}

describe('chunk builds in pieces', () => {
  it(`never spends more than ${PIECE_BOUND_MS} ms on one piece of any chunk of the city (best of ${RUNS} passes)`, () => {
    const n = grid.ncx * grid.ncz;
    // best[(chunk * 2 + lod - 1)][piece]
    const best: number[][] = [];
    for (let s = 0; s < n * 2; s++) best.push([]);
    for (let run = 0; run < RUNS; run++) {
      for (let ci = 0; ci < n; ci++) {
        for (const lod of LODS) {
          const job = new ChunkJob(city, grid, buckets, ci, lod);
          const times = best[ci * 2 + lod - 1];
          let k = 0;
          for (;;) {
            const t0 = performance.now();
            const done = job.step();
            const dt = performance.now() - t0;
            times[k] = run === 0 ? dt : Math.min(times[k], dt);
            k++;
            if (done) break;
          }
          job.geometry?.dispose();
        }
      }
    }
    let worst = 0;
    let where = '';
    let pieces = 0;
    // The last piece of each chunk is the typed-array build; report the worst meshing piece too.
    let worstMesh = 0;
    for (let s = 0; s < best.length; s++) {
      pieces += best[s].length;
      for (let k = 0; k < best[s].length; k++) {
        if (k < best[s].length - 1) worstMesh = Math.max(worstMesh, best[s][k]);
        if (best[s][k] > worst) {
          worst = best[s][k];
          where = `chunk ${s >> 1} ${(s & 1) === 1 ? 'near' : 'far'}, piece ${k + 1} of ${best[s].length}`;
        }
      }
    }
    console.log(
      `chunk pieces: ${pieces} over ${n * 2} chunk builds; worst best-of-${RUNS} piece ${worst.toFixed(3)} ms (${where}); worst meshing piece ${worstMesh.toFixed(3)} ms`,
    );
    expect(pieces).toBeGreaterThan(n * 2 * 20);
    expect(worst, where).toBeLessThan(PIECE_BOUND_MS);
  }, 120_000);

  it('builds geometry identical, array for array, to the chunk meshed in one go', () => {
    for (let ci = 0; ci < grid.ncx * grid.ncz; ci++) {
      for (const lod of LODS) {
        const job = new ChunkJob(city, grid, buckets, ci, lod);
        // A deadline already passed: one piece per call, as on the slowest frames.
        let calls = 1;
        while (!job.run(() => 1, 0)) calls++;
        expect(job.geometry).not.toBeNull();
        expect(calls).toBe(job.pieces);
        const whole = new MeshBuilder();
        meshChunk(whole, city, grid, buckets, ci, lod);
        const g = whole.build();
        if (job.geometry) expect(hashGeometry(job.geometry), `chunk ${ci} lod ${lod}`).toBe(hashGeometry(g));
        expect(job.b.triangleCount).toBe(whole.triangleCount);
      }
    }
  }, 120_000);

  it('runs piece after piece until the deadline, then stops between pieces', () => {
    const ci = chunkOf(grid, 0, 410);
    const job = new ChunkJob(city, grid, buckets, ci, Lod.NEAR);
    let t = 0;
    // Each clock read advances 0.1 ms: run() reads it once per piece (plus once at the start).
    const clock = (): number => (t += 0.1);
    expect(job.run(clock, 1)).toBe(false);
    expect(job.pieces).toBe(10);
    while (!job.run(clock, t + 1)) {
      /* resume on later frames */
    }
    expect(job.geometry).not.toBeNull();
  });
});

describe('after a teleport', () => {
  const g: ChunkGrid = { minX: 0, minZ: 0, size: 60, cells: 20, ncx: 12, ncz: 12 };
  function streamer(inView?: (ci: number) => boolean) {
    let t = 0;
    const s = new ChunkStreamer<{ ci: number }>(g, {
      // Slow builds: the per-frame budget alone would allow one chunk a frame.
      build(ci) {
        t += 10;
        return { ci };
      },
      inView,
      show() {},
      hide() {},
      dispose() {},
    });
    return { s, update: (x: number, z: number) => s.update(x, z, t, () => t) };
  }
  const dist = (ci: number, x: number, z: number): number => Math.hypot((ci % g.ncx) * 60 + 30 - x, Math.floor(ci / g.ncx) * 60 + 30 - z);

  it('builds every chunk the camera can see within the near radius at once, and only those beyond the 3x3', () => {
    const x = 370;
    const z = 370;
    // The camera looks toward +z: it sees chunks whose centre is ahead of it.
    const ahead = (ci: number): boolean => Math.floor(ci / g.ncx) * 60 + 30 > z;
    const { s, update } = streamer(ahead);
    update(x, z);
    const here = chunkOf(g, x, z);
    let seen = 0;
    for (let ci = 0; ci < g.ncx * g.ncz; ci++) {
      const nb = Math.abs((ci % g.ncx) - (here % g.ncx)) <= 1 && Math.abs(Math.floor(ci / g.ncx) - Math.floor(here / g.ncx)) <= 1;
      const want = nb || (dist(ci, x, z) < STREAM.NEAR_R && ahead(ci));
      if (want) {
        expect(s.shown[ci], `chunk ${ci}`).toBe(Lod.NEAR);
        if (!nb) seen++;
      } else {
        // The first build already spent the frame's budget: nothing else was built.
        expect(s.shown[ci], `chunk ${ci}`).toBe(Lod.NONE);
      }
    }
    expect(seen).toBeGreaterThan(4);
    expect(s.builtLast).toBe(9 + seen);
  });

  it('builds only the 3x3 at once when it is not told what the camera sees', () => {
    const { s, update } = streamer();
    update(370, 370);
    expect(s.builtLast).toBe(9);
  });
});
