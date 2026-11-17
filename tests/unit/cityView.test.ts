import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ChunkStreamer,
  STREAM,
  bucketWorld,
  chunkGrid,
  meshChunk,
  wantLod,
  type ChunkGrid,
} from '../../src/render/cityView';
import { Lod } from '../../src/render/dress/kit';
import { RAIL_KINDS } from '../../src/render/dress/rails';
import { ROOF_CLUTTER_MAX, ROOF_EDGE, SOLID_KINDS } from '../../src/render/dress/solids';
import { PAINT_LIFT, TREAD_MAX, meshGround, meshGroundDecor } from '../../src/render/dress/terrain';
import { stopSpot, STOP_SHELTER_TOP, STOP_SIGN_TOP } from '../../src/render/dress/zones';
import { MeshBuilder } from '../../src/render/geom';
import { meshRail, meshSolid } from '../../src/render/worldMesh';
import { buildProptown } from '../../src/sim/proptown';
import { Rng } from '../../src/sim/rng';
import {
  Surface,
  addSolid,
  createWorld,
  fillHeights,
  finalizeWorld,
  terrainHeight,
  terrainSurface,
  type Solid,
  type World,
} from '../../src/sim/world';

const town = buildProptown(1);

function geometry(fill: (b: MeshBuilder) => void): THREE.BufferGeometry {
  const b = new MeshBuilder();
  fill(b);
  return b.build();
}

function positions(g: THREE.BufferGeometry): Float32Array {
  return g.getAttribute('position').array as Float32Array;
}

function triangles(g: THREE.BufferGeometry): ArrayLike<number> {
  const idx = g.getIndex();
  if (!idx) throw new Error('unindexed geometry');
  return idx.array;
}

/** A bumpy world: random vertex heights (non-planar cells), random surfaces, a flat corner. */
function bumpyWorld(seed: number): World {
  const rng = new Rng(seed);
  const w = createWorld({ seed, minX: -37, minZ: -11, cell: 3, nx: 36, nz: 28 });
  fillHeights(w, (x, z) => (x < -10 && z < 20 ? 4 + 0.05 * x : 3 + 0.04 * z + rng.range(-1.2, 1.2)));
  for (let i = 0; i < w.surfaces.length; i++) w.surfaces[i] = rng.int(7);
  finalizeWorld(w);
  return w;
}

/** Height of the drawn triangle under (x, z), or null if no triangle covers it. */
function drawnHeight(pos: Float32Array, tri: ArrayLike<number>, x: number, z: number): number | null {
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3;
    const b = tri[t + 1] * 3;
    const c = tri[t + 2] * 3;
    const ax = pos[a];
    const az = pos[a + 2];
    const bx = pos[b];
    const bz = pos[b + 2];
    const cx = pos[c];
    const cz = pos[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    return l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1];
  }
  return null;
}

describe('terrain mesher', () => {
  for (const far of [false, true]) {
    it(`reproduces terrainHeight exactly (${far ? 'far, merged' : 'near'})`, () => {
      const w = bumpyWorld(7);
      const g = geometry((b) => meshGround(b, w, 0, 0, w.nx, w.nz, far));
      const pos = positions(g);
      const tri = triangles(g);
      const rng = new Rng(99);
      for (let i = 0; i < 500; i++) {
        const x = rng.range(w.minX, w.maxX);
        const z = rng.range(w.minZ, w.maxZ);
        const h = drawnHeight(pos, tri, x, z);
        expect(h, `no ground drawn at ${x}, ${z}`).not.toBeNull();
        expect(Math.abs((h ?? 0) - terrainHeight(w, x, z))).toBeLessThan(1e-4);
      }
    });
  }

  it('merges coplanar cells when far, so far ground is cheaper', () => {
    const w = bumpyWorld(7);
    const near = new MeshBuilder();
    meshGround(near, w, 0, 0, w.nx, w.nz, false);
    const far = new MeshBuilder();
    meshGround(far, w, 0, 0, w.nx, w.nz, true);
    expect(far.triangleCount).toBeLessThan(near.triangleCount);
    // Upward facing everywhere.
    const g = geometry((b) => meshGround(b, w, 0, 0, w.nx, w.nz, true));
    const pos = positions(g);
    const tri = triangles(g);
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3;
      const b = tri[t + 1] * 3;
      const c = tri[t + 2] * 3;
      const ny = (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('keeps painted decoration within 3 cm of the ground, and stair treads within 12 cm', () => {
    for (const [w, hasStairs] of [[town, true], [bumpyWorld(3), false], [stairWorld(), true]] as const) {
      const g = geometry((b) => meshGroundDecor(b, w, 0, 0, w.nx, w.nz));
      const pos = positions(g);
      expect(pos.length).toBeGreaterThan(0);
      let treads = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];
        const above = y - terrainHeight(w, x, z);
        let stairs = false;
        for (const [dx, dz] of [[0, 0], [0.011, 0.011], [-0.011, 0.011], [0.011, -0.011], [-0.011, -0.011]]) {
          if (terrainSurface(w, x + dx, z + dz) === Surface.STAIRS) stairs = true;
        }
        if (stairs) {
          if (above > PAINT_LIFT + 1e-3) treads++;
          expect(above, `tread at ${x}, ${z}`).toBeLessThanOrEqual(TREAD_MAX + 1e-4);
        } else {
          expect(above, `paint at ${x}, ${z}`).toBeLessThanOrEqual(PAINT_LIFT + 1e-4);
        }
      }
      if (hasStairs) expect(treads).toBeGreaterThan(0);
    }
  });
});

/** Flat ground with stair flights of several grades in both directions. */
function stairWorld(): World {
  const w = createWorld({ seed: 1, minX: 0, minZ: 0, cell: 3, nx: 30, nz: 30 });
  fillHeights(w, (x, z) => {
    if (x < 30) return z * [0.1, 0.35, 0.8][Math.min(2, Math.floor(x / 10))];
    return 40 - (x - 30) * 0.5 + (z > 60 ? (z - 60) * 0.2 : 0);
  });
  for (let iz = 0; iz < w.nz; iz++) for (let ix = 0; ix < w.nx; ix++) w.surfaces[iz * w.nx + ix] = (ix + iz) % 4 === 0 ? Surface.PLAZA : Surface.STAIRS;
  finalizeWorld(w);
  return w;
}

// ---------------------------------------------------------------------------------------------

function local(o: Solid, x: number, z: number): [number, number] {
  const dx = x - o.cx;
  const dz = z - o.cz;
  return [dx * o.cosR + dz * o.sinR, -dx * o.sinR + dz * o.cosR];
}

/** Solids of every kind: the fixture's, plus a synthetic row of all kinds at varied sizes and angles. */
function kindWorld(): World {
  const w = createWorld({ seed: 5, minX: -120, minZ: -60, cell: 3, nx: 80, nz: 40 });
  fillHeights(w, (x, z) => 2 + 0.03 * z + 0.01 * x);
  w.surfaces.fill(Surface.PLAZA);
  let x = -110;
  let k = 0;
  for (const kind of [...SOLID_KINDS, 'mystery']) {
    for (let v = 0; v < 3; v++) {
      const hx = [0.6, 3, 7][v];
      const hz = [0.6, 2.5, 5][(v + k) % 3];
      const g = terrainHeight(w, x, 0);
      addSolid(w, {
        cx: x,
        cz: v * 18 - 18,
        hx,
        hz,
        rot: 0.3 * k + v,
        yBase: g - 1,
        yTop: g + [2.4, 7, 13][v],
        kind,
        style: k + v,
        oneWay: kind === 'awning',
        surface: kind === 'awning' ? Surface.AWNING : Surface.ROOF,
      });
      k++;
    }
    x += 12;
  }
  finalizeWorld(w);
  return w;
}

describe('solid dressing', () => {
  const kw = kindWorld();

  it('the fixture has every solid kind, rail kind and surface', () => {
    for (const kind of SOLID_KINDS) expect(town.solids.some((o) => o.kind === kind), kind).toBe(true);
    for (const kind of RAIL_KINDS) expect(town.rails.some((r) => r.kind === kind), kind).toBe(true);
    for (const s of [Surface.STREET, Surface.PLAZA, Surface.STAIRS, Surface.DIRT, Surface.GRASS, Surface.TRACK, Surface.WATER]) {
      expect(town.surfaces.includes(s), `surface ${s}`).toBe(true);
    }
    expect(town.solids.some((o) => !(SOLID_KINDS as readonly string[]).includes(o.kind))).toBe(true);
    expect(town.zones.filter((z) => z.kind === 'stop').length).toBeGreaterThanOrEqual(3);
  });

  it('every kind builds finite geometry with colours and glow in 0..1, at both levels of detail', () => {
    for (const w of [town, kw]) {
      for (const o of w.solids) {
        for (const lod of [Lod.NEAR, Lod.FAR]) {
          const g = geometry((b) => meshSolid(b, w, o, lod));
          const pos = positions(g);
          expect(pos.length, o.kind).toBeGreaterThan(0);
          for (const v of pos) expect(Number.isFinite(v)).toBe(true);
          for (const v of g.getAttribute('color').array) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          const glow = g.getAttribute('glow');
          if (glow) for (const v of glow.array) expect(v >= 0 && v <= 1).toBe(true);
        }
      }
    }
  });

  it('winds every wall and roof face of the box outward', () => {
    for (const w of [town, kw]) {
      for (const o of w.solids) {
        const g = geometry((b) => meshSolid(b, w, o, Lod.NEAR));
        const pos = positions(g);
        const tri = triangles(g);
        let checked = 0;
        for (let t = 0; t < tri.length; t += 3) {
          const a = tri[t] * 3;
          const b = tri[t + 1] * 3;
          const c = tri[t + 2] * 3;
          const e1x = pos[b] - pos[a];
          const e1y = pos[b + 1] - pos[a + 1];
          const e1z = pos[b + 2] - pos[a + 2];
          const e2x = pos[c] - pos[a];
          const e2y = pos[c + 1] - pos[a + 1];
          const e2z = pos[c + 2] - pos[a + 2];
          const nx = e1y * e2z - e1z * e2y;
          const ny = e1z * e2x - e1x * e2z;
          const nz = e1x * e2y - e1y * e2x;
          const mx = (pos[a] + pos[b] + pos[c]) / 3;
          const my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
          const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
          const [lx, lz] = local(o, mx, mz);
          const inY = my > o.yBase - 1e-4 && my < o.yTop + 1e-4;
          const onX = Math.abs(Math.abs(lx) - o.hx) < 1e-3 && Math.abs(lz) <= o.hz + 1e-3 && inY;
          const onZ = Math.abs(Math.abs(lz) - o.hz) < 1e-3 && Math.abs(lx) <= o.hx + 1e-3 && inY;
          const onTop = Math.abs(my - o.yTop) < 1e-4 && Math.abs(lx) <= o.hx && Math.abs(lz) <= o.hz;
          if (onTop && Math.abs(ny) > 1e-9 && Math.abs(nx) + Math.abs(nz) < 1e-6 * Math.abs(ny)) {
            expect(ny, `${o.kind} roof`).toBeGreaterThan(0);
            checked++;
          } else if ((onX || onZ) && Math.abs(ny) < 1e-6 * (Math.abs(nx) + Math.abs(nz))) {
            // Outward = away from the solid's centre, along the face normal.
            const ox = mx - o.cx;
            const oz = mz - o.cz;
            expect(nx * ox + nz * oz, `${o.kind} wall`).toBeGreaterThan(0);
            checked++;
          }
        }
        expect(checked, `${o.kind} has box faces`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('draws an unknown kind as its plain box', () => {
    const o = kw.solids.find((s) => s.kind === 'mystery');
    expect(o).toBeDefined();
    if (!o) return;
    const near = new MeshBuilder();
    meshSolid(near, kw, o, Lod.NEAR);
    const far = new MeshBuilder();
    meshSolid(far, kw, o, Lod.FAR);
    expect(near.triangleCount).toBe(10);
    expect(Array.from(positions(near.build()))).toEqual(Array.from(positions(far.build())));
  });

  it('keeps roofs skateable: clutter away from the edge stays under the height limit', () => {
    for (const w of [town, kw]) {
      for (const o of w.solids) {
        if (o.surface !== Surface.ROOF && o.surface !== Surface.AWNING) continue;
        const pos = positions(geometry((b) => meshSolid(b, w, o, Lod.NEAR)));
        for (let i = 0; i < pos.length; i += 3) {
          const [lx, lz] = local(o, pos[i], pos[i + 2]);
          const inner = Math.abs(lx) < o.hx - ROOF_EDGE - 1e-6 && Math.abs(lz) < o.hz - ROOF_EDGE - 1e-6;
          if (inner) expect(pos[i + 1] - o.yTop, `${o.kind} roof clutter`).toBeLessThanOrEqual(ROOF_CLUTTER_MAX + 1e-4);
        }
      }
    }
  });
});

describe('rail dressing', () => {
  it('every rail kind builds finite geometry whose beam follows the sim polyline exactly', () => {
    const kinds = new Set<string>();
    for (const r of town.rails) {
      kinds.add(r.kind);
      for (const lod of [Lod.NEAR, Lod.FAR]) {
        const g = geometry((b) => meshRail(b, town, r, lod));
        const pos = positions(g);
        for (const v of pos) expect(Number.isFinite(v)).toBe(true);
        for (const v of g.getAttribute('color').array) expect(v >= 0 && v <= 1).toBe(true);
        // The rail's own beams come first, 16 vertices per segment, centred on the segment.
        const n = r.pts.length / 3;
        for (let s = 0; s < n - 1; s++) {
          let sx = 0;
          let sy = 0;
          let sz = 0;
          for (let v = 0; v < 16; v++) {
            sx += pos[(s * 16 + v) * 3];
            sy += pos[(s * 16 + v) * 3 + 1];
            sz += pos[(s * 16 + v) * 3 + 2];
          }
          expect(sx / 16).toBeCloseTo((r.pts[s * 3] + r.pts[s * 3 + 3]) / 2, 4);
          expect(sy / 16).toBeCloseTo((r.pts[s * 3 + 1] + r.pts[s * 3 + 4]) / 2, 4);
          expect(sz / 16).toBeCloseTo((r.pts[s * 3 + 2] + r.pts[s * 3 + 5]) / 2, 4);
        }
      }
    }
    for (const k of RAIL_KINDS) expect(kinds.has(k), k).toBe(true);
  });
});

describe('stops', () => {
  it('puts the pole beside the stop, off the street, with a shelter lower than the sign', () => {
    expect(STOP_SHELTER_TOP).toBeLessThan(STOP_SIGN_TOP);
    for (const z of town.zones.filter((zn) => zn.kind === 'stop')) {
      const s = stopSpot(town, z);
      expect(s, z.id).not.toBeNull();
      if (!s) continue;
      expect(Math.hypot(s.x - z.x, s.z - z.z)).toBeGreaterThanOrEqual(1);
      expect(terrainSurface(town, s.x, s.z)).not.toBe(Surface.STREET);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(terrainSurface(town, s.x + Math.cos(a), s.z + Math.sin(a))).not.toBe(Surface.STREET);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('chunks', () => {
  it('buckets every solid, rail and zone into exactly one chunk', () => {
    const g = chunkGrid(town);
    expect(g.size).toBe(STREAM.CHUNK_CELLS * town.cell);
    const bk = bucketWorld(town, g);
    for (const [list, total] of [
      [bk.solids, town.solids.length],
      [bk.rails, town.rails.length],
      [bk.zones, town.zones.length],
    ] as const) {
      const seen = new Map<number, number>();
      for (const chunk of list) for (const i of chunk) seen.set(i, (seen.get(i) ?? 0) + 1);
      expect(seen.size).toBe(total);
      for (const c of seen.values()) expect(c).toBe(1);
    }
  });

  it('far and near versions of a chunk draw the same boxes (no outline change on swap)', () => {
    const g = chunkGrid(town);
    const bk = bucketWorld(town, g);
    for (let ci = 0; ci < g.ncx * g.ncz; ci++) {
      const near = positions(geometry((b) => meshChunk(b, town, g, bk, ci, Lod.NEAR)));
      const far = positions(geometry((b) => meshChunk(b, town, g, bk, ci, Lod.FAR)));
      const has = (pos: Float32Array, x: number, y: number, z: number): boolean => {
        for (let i = 0; i < pos.length; i += 3) {
          if (Math.abs(pos[i] - x) < 1e-3 && Math.abs(pos[i + 1] - y) < 1e-3 && Math.abs(pos[i + 2] - z) < 1e-3) return true;
        }
        return false;
      };
      for (const s of bk.solids[ci]) {
        const o = town.solids[s];
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const x = o.cx + sx * o.hx * o.cosR - sz * o.hz * o.sinR;
          const z = o.cz + sx * o.hx * o.sinR + sz * o.hz * o.cosR;
          for (const y of [o.yBase, o.yTop]) {
            expect(has(far, x, y, z), `far ${o.kind} corner`).toBe(true);
            expect(has(near, x, y, z), `near ${o.kind} corner`).toBe(true);
          }
        }
      }
      // A dense near chunk stays inside its triangle budget; far chunks are much cheaper.
      expect(near.length / 3).toBeLessThan(65535);
    }
  });
});

describe('streaming policy', () => {
  const grid: ChunkGrid = { minX: 0, minZ: 0, size: 60, cells: 20, ncx: 8, ncz: 25 };
  const centre = (ci: number): [number, number] => [((ci % grid.ncx) + 0.5) * grid.size, (Math.floor(ci / grid.ncx) + 0.5) * grid.size];

  interface Item {
    ci: number;
    lod: Lod;
    visible: boolean;
    disposed: boolean;
  }
  function harness(buildMs: number) {
    let t = 0;
    const built: Item[] = [];
    const s = new ChunkStreamer<Item>(grid, {
      build(ci, lod) {
        t += buildMs;
        const it: Item = { ci, lod, visible: false, disposed: false };
        built.push(it);
        return it;
      },
      show(it) {
        it.visible = true;
      },
      hide(it) {
        it.visible = false;
      },
      dispose(it) {
        it.disposed = true;
      },
    });
    const clock = (): number => t;
    let now = 0;
    const step = (x: number, z: number, dtMs = 16): void => {
      now += dtMs;
      t = now;
      s.update(x, z, now, clock);
    };
    return { s, built, step };
  }

  it('wants near inside NEAR_R, far out to FAR_R, nothing beyond, with hysteresis', () => {
    expect(wantLod(10, Lod.NONE)).toBe(Lod.NEAR);
    expect(wantLod(STREAM.NEAR_R + 1, Lod.NONE)).toBe(Lod.FAR);
    expect(wantLod(STREAM.NEAR_R + 1, Lod.NEAR)).toBe(Lod.NEAR);
    expect(wantLod(STREAM.FAR_R + 1, Lod.NONE)).toBe(Lod.NONE);
    expect(wantLod(STREAM.FAR_R + 1, Lod.FAR)).toBe(Lod.FAR);
    expect(wantLod(STREAM.FAR_R + STREAM.HYST + 1, Lod.FAR)).toBe(Lod.NONE);
  });

  it('shows the chunk under a new camera and its neighbours at once, even when builds are slow', () => {
    const { s, step } = harness(20);
    step(250, 700);
    const cx = Math.floor(250 / 60);
    const cz = Math.floor(700 / 60);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) expect(s.shown[(cz + dz) * grid.ncx + cx + dx]).toBe(Lod.NEAR);
    // A teleport does the same at the new place.
    step(250, 100);
    expect(s.shown[Math.floor(100 / 60) * grid.ncx + cx]).toBe(Lod.NEAR);
  });

  it('builds nearest first, within the per-frame budget', () => {
    for (const ms of [5, 1]) {
      const { s, built, step } = harness(ms);
      step(250, 700);
      const first = built.length;
      let frames = 0;
      while (frames < 400) {
        const before = built.length;
        step(250, 700);
        frames++;
        const n = built.length - before;
        // One build per frame when a build blows the budget, at most MAX_BUILDS otherwise.
        expect(n).toBeLessThanOrEqual(ms >= STREAM.BUILD_MS ? 1 : STREAM.MAX_BUILDS);
        if (n === 0) break;
      }
      const d = built.slice(first).map((it) => {
        const [x, z] = centre(it.ci);
        return Math.hypot(x - 250, z - 700);
      });
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] - 1e-9);
      // Settled: every chunk has the level of detail its distance asks for (or the cap stopped it).
      for (let ci = 0; ci < s.n; ci++) {
        const [x, z] = centre(ci);
        const dist = Math.hypot(x - 250, z - 700);
        if (dist < STREAM.NEAR_R) expect(s.shown[ci]).toBe(Lod.NEAR);
        else if (dist >= STREAM.FAR_R + STREAM.HYST) expect(s.shown[ci]).toBe(Lod.NONE);
      }
      expect(s.shownCount()).toBeLessThanOrEqual(STREAM.MAX_SHOWN);
    }
  });

  it('never keeps more chunks than its caps, and never pops a chunk within 150 m', () => {
    const { s, built, step } = harness(1);
    // Settle, then ride the length of the grid and back, slowly, with a teleport in the middle.
    for (let i = 0; i < 300; i++) step(240, 80);
    let x = 240;
    let z = 80;
    const ride = (tx: number, tz: number, speed: number): void => {
      while (Math.hypot(tx - x, tz - z) > speed) {
        const d = Math.hypot(tx - x, tz - z);
        x += ((tx - x) / d) * speed;
        z += ((tz - z) / d) * speed;
        step(x, z);
        expect(s.shownCount()).toBeLessThanOrEqual(STREAM.MAX_SHOWN);
        expect(s.residentCount()).toBeLessThanOrEqual(STREAM.MAX_SHOWN + 2 * STREAM.CACHE);
        for (let ci = 0; ci < s.n; ci++) {
          const [cx, cz] = centre(ci);
          if (Math.hypot(cx - x, cz - z) < 150) expect(s.shown[ci], `chunk ${ci} popped`).not.toBe(Lod.NONE);
        }
      }
    };
    ride(240, 1400, 0.5);
    ride(400, 900, 0.5);
    for (let i = 0; i < 20; i++) step(60, 120); // teleport: settle again
    x = 60;
    z = 120;
    ride(60, 600, 0.5);
    // Old chunks get disposed once out of range for a while.
    expect(built.some((it) => it.disposed)).toBe(true);
    // Disposed items are never shown again.
    for (const it of built) if (it.disposed) expect(it.visible).toBe(false);
    // Visible items are exactly the shown chunks.
    const visible = built.filter((it) => it.visible);
    expect(visible.length).toBe(s.shownCount());
    for (const it of visible) expect(s.shown[it.ci]).toBe(it.lod);
  });

  it('reuses cached chunks when the camera comes back instead of rebuilding', () => {
    const { built, step } = harness(1);
    for (let i = 0; i < 300; i++) step(240, 700);
    const settled = built.length;
    // Step across a chunk boundary and back a few times.
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 40; i++) step(240, 700 + i * 0.5);
      for (let i = 0; i < 40; i++) step(240, 720 - i * 0.5);
    }
    const rebuilds = built.length - settled;
    expect(rebuilds).toBeLessThan(12);
  });
});
