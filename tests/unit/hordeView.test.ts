import type { InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { bollardGeometry, gnatGeometry, HordeView, shufflerGeometry } from '../../src/render/hordeView';
import { DT } from '../../src/sim/constants';
import { KIND_BOLLARD, KIND_GNAT, KIND_SHUFFLER, makeWorld, removeEnemy, SPAWN_TICKS, spawnEnemy, type World } from '../../src/sim/world';

/** Column-major instance matrix `n` of a mesh. */
function matrix(mesh: InstancedMesh, n: number): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(n * 16, n * 16 + 16));
}

function len(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Where the model's +z (its face) points, normalised. */
function facing(m: number[]): [number, number, number] {
  const l = len(m[8], m[9], m[10]);
  return [m[8] / l, m[9] / l, m[10] / l];
}

function add(w: World, kind: number, x: number, y: number, z: number, vx = 0, vz = 0, age = SPAWN_TICKS): number {
  const i = spawnEnemy(w, kind, x, y, z);
  w.horde.vx[i] = vx;
  w.horde.vz[i] = vz;
  w.horde.age[i] = age;
  return i;
}

describe('enemy geometry', () => {
  it('stays inside the triangle budgets and stands as tall as the brief says', () => {
    const cases = [
      { g: shufflerGeometry(), max: 40, height: 1.7 },
      { g: gnatGeometry(), max: 12, height: null },
      { g: bollardGeometry(), max: 40, height: 2.4 },
    ];
    for (const c of cases) {
      const tris = c.g.getAttribute('position').count / 3;
      expect(tris).toBeLessThanOrEqual(c.max);
      c.g.computeBoundingBox();
      const box = c.g.boundingBox;
      expect(box).not.toBeNull();
      if (box && c.height !== null) {
        expect(box.min.y).toBeCloseTo(0, 5);
        expect(box.max.y).toBeCloseTo(c.height, 5);
      }
    }
  });

  it('has every face pointing outward', () => {
    for (const g of [shufflerGeometry(), gnatGeometry(), bollardGeometry()]) {
      g.computeBoundingBox();
      const p = g.getAttribute('position');
      const box = g.boundingBox;
      if (!box) throw new Error('no bounding box');
      const cy = (box.min.y + box.max.y) / 2;
      let outward = 0;
      for (let t = 0; t < p.count; t += 3) {
        const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
        const ux = p.getX(t + 1) - ax, uy = p.getY(t + 1) - ay, uz = p.getZ(t + 1) - az;
        const vx = p.getX(t + 2) - ax, vy = p.getY(t + 2) - ay, vz = p.getZ(t + 2) - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const mx = (ax + p.getX(t + 1) + p.getX(t + 2)) / 3;
        const my = (ay + p.getY(t + 1) + p.getY(t + 2)) / 3 - cy;
        const mz = (az + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
        if (nx * mx + ny * my + nz * mz > 0) outward++;
      }
      // Faces of stacked blocks are tested against the figure's centre, so allow the odd one.
      expect(outward / (p.count / 3)).toBeGreaterThan(0.85);
    }
  });
});

describe('HordeView', () => {
  it('draws each living enemy in its kind mesh at its place, facing and rise', () => {
    const w = makeWorld(3);
    add(w, KIND_SHUFFLER, 3, 0.5, 4, 3, 4);
    add(w, KIND_GNAT, -5, 1, 2, 0, 0, SPAWN_TICKS / 2);
    add(w, KIND_BOLLARD, 10, 2, -10, 0, -1.2);
    add(w, KIND_SHUFFLER, 0, 0, -6, -2, 0);
    const view = new HordeView();
    // The mover is due +z of the gnat, which stands still and so turns to face it.
    view.update(w, 1, 0, -5, 12);

    const [shuf, gnat, boll] = view.meshes;
    expect(shuf.count).toBe(2);
    expect(gnat.count).toBe(1);
    expect(boll.count).toBe(1);
    expect(view.shadows.count).toBe(4);
    expect(shuf.visible && gnat.visible && boll.visible && view.shadows.visible).toBe(true);

    const a = matrix(shuf, 0);
    expect([a[12], a[13], a[14]]).toEqual([3, 0.5, 4]);
    const fa = facing(a);
    expect(fa[0]).toBeCloseTo(0.6, 5);
    expect(fa[1]).toBeCloseTo(0, 5);
    expect(fa[2]).toBeCloseTo(0.8, 5);
    expect(len(a[4], a[5], a[6])).toBeCloseTo(1, 5);

    const b = matrix(shuf, 1);
    expect(b[12]).toBeCloseTo(0, 5);
    expect(b[14]).toBeCloseTo(-6, 5);
    expect(facing(b)[0]).toBeCloseTo(-1, 5);

    const g = matrix(gnat, 0);
    expect(len(g[0], g[1], g[2])).toBeCloseTo(0.5, 5);
    expect(len(g[4], g[5], g[6])).toBeCloseTo(0.5, 5);
    expect(len(g[8], g[9], g[10])).toBeCloseTo(0.5, 5);
    expect(facing(g)[2]).toBeCloseTo(1, 5);

    const c = matrix(boll, 0);
    expect(facing(c)[2]).toBeCloseTo(-1, 5);
    expect([c[12], c[13], c[14]]).toEqual([10, 2, -10]);
  });

  it('draws the world as it was between ticks: back along the velocity by (1 - alpha) of a tick', () => {
    const w = makeWorld(3);
    add(w, KIND_SHUFFLER, 3, 0, 4, 6, -3);
    const view = new HordeView();
    view.update(w, 0.25, 0, 0, 0);
    const m = matrix(view.meshes[KIND_SHUFFLER], 0);
    expect(m[12]).toBeCloseTo(3 - 6 * 0.75 * DT, 5);
    expect(m[14]).toBeCloseTo(4 + 3 * 0.75 * DT, 5);
    const s = matrix(view.shadows, 0);
    expect(s[12]).toBeCloseTo(m[12], 5);
    expect(s[14]).toBeCloseTo(m[14], 5);
  });

  it('starts an enemy at nothing and grows it out of the ground while it rises', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_BOLLARD, 0, 0, 0, 0, 0, 0);
    const view = new HordeView();
    const scales: number[] = [];
    for (const age of [0, 9, 18, SPAWN_TICKS, SPAWN_TICKS + 100]) {
      w.horde.age[i] = age;
      view.update(w, 1, 0, 5, 5);
      const m = matrix(view.meshes[KIND_BOLLARD], 0);
      scales.push(len(m[4], m[5], m[6]));
    }
    expect(scales[0]).toBe(0);
    expect(scales[1]).toBeCloseTo(0.25, 5);
    expect(scales[2]).toBeCloseTo(0.5, 5);
    expect(scales[3]).toBeCloseTo(1, 5);
    expect(scales[4]).toBeCloseTo(1, 5);
  });

  it('follows the horde as it shrinks and grows: count is always the living enemies of each kind', () => {
    const w = makeWorld(3);
    for (let n = 0; n < 30; n++) add(w, n % 3, n, 0, -n);
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.map((m) => m.count)).toEqual([10, 10, 10]);
    // Take out every gnat; the last enemies move into the gaps.
    for (let i = w.horde.count - 1; i >= 0; i--) if (w.horde.kind[i] === KIND_GNAT) removeEnemy(w, i);
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.map((m) => m.count)).toEqual([10, 0, 10]);
    expect(view.meshes[KIND_GNAT].visible).toBe(false);
    expect(view.shadows.count).toBe(20);
    w.horde.count = 0;
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.every((m) => m.count === 0 && !m.visible)).toBe(true);
    expect(view.shadows.visible).toBe(false);
  });

  it('passes phase, speed and the hit flash to the shader per instance', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_SHUFFLER, 0, 0, 0, 2.25, 0);
    w.horde.flash[i] = 6;
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    const anim = view.meshes[KIND_SHUFFLER].geometry.getAttribute('aAnim');
    expect(anim.getX(0)).toBeCloseTo(w.horde.phase[i], 6);
    expect(anim.getY(0)).toBeCloseTo(0.5, 5); // half the shuffler's 4.5 m/s
    expect(anim.getZ(0)).toBe(1);
    w.horde.flash[i] = 0;
    view.update(w, 1, 0, 0, 0);
    expect(anim.getZ(0)).toBe(0);
  });

  it('never lets the meshes be culled by a stale bounding sphere', () => {
    const view = new HordeView();
    for (const m of [...view.meshes, view.shadows]) expect(m.frustumCulled).toBe(false);
  });
});
