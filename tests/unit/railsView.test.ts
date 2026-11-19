import { Color, Matrix4, Vector3, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { BAR_THICK, POST_EVERY, RailsView } from '../../src/render/railsView';
import { makeBowl } from '../../src/sim/bowl';
import { flatTerrain, railOver, terrainFromHeight, type Rail, type Terrain } from '../../src/sim/terrain';

const ground = (x: number, z: number): number => 0.05 * x - 0.08 * z + 0.3 * Math.sin(z * 0.2);
const LINES: [number, number, number, number][] = [
  [0, 0, 0, 20],
  [10, -5, 34, 3],
  [-6, 30, -6, 44.5],
];

function park(): Terrain {
  const rails: Rail[] = LINES.map(([x0, z0, x1, z1]) => railOver(ground, x0, z0, x1, z1, 1.2));
  return terrainFromHeight(ground, 200, [], 0, 0, 0, rails);
}

/** An instance's box as its middle and its three half-axes, in world space. */
function boxOf(m: Float32Array | ArrayLike<number>, i: number): { mid: Vector3; a: Vector3; b: Vector3; c: Vector3 } {
  const mat = new Matrix4().fromArray(Array.from(m).slice(i * 16, i * 16 + 16));
  const e = mat.elements;
  return {
    mid: new Vector3(e[12], e[13], e[14]),
    a: new Vector3(e[0], e[1], e[2]).multiplyScalar(0.5),
    b: new Vector3(e[4], e[5], e[6]).multiplyScalar(0.5),
    c: new Vector3(e[8], e[9], e[10]).multiplyScalar(0.5),
  };
}

describe('RailsView', () => {
  it('draws one bright bar per rail, from one end to the other, its top on the rail', () => {
    const t = park();
    const view = new RailsView(t);
    expect(view.bars.count).toBe(t.rails.length);
    t.rails.forEach((r, i) => {
      const { mid, b, c } = boxOf(view.bars.instanceMatrix.array, i);
      // The long axis spans the rail, end to end.
      const p0 = mid.clone().sub(c);
      const p1 = mid.clone().add(c);
      expect(p0.x).toBeCloseTo(r.x0, 6);
      expect(p0.z).toBeCloseTo(r.z0, 6);
      expect(p1.x).toBeCloseTo(r.x1, 6);
      expect(p1.z).toBeCloseTo(r.z1, 6);
      // Its top face is on the rail's line, where the board rides.
      const topMid = mid.clone().add(b.y > 0 ? b : b.clone().negate());
      expect(topMid.y).toBeCloseTo((r.y0 + r.y1) / 2, 2);
      expect(b.length() * 2).toBeCloseTo(BAR_THICK, 6);
    });
    const mat = view.bars.material as MeshLambertMaterial;
    expect(mat.color.getHex()).toBe(new Color(PALETTE.rail).getHex());
    // It glows: it has to be picked out against the dark ground from the edge of the fog.
    expect(mat.emissive.getHex()).toBe(new Color(PALETTE.rail).getHex());
    expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(0.5);
    expect((view.posts.material as MeshLambertMaterial).color.getHex()).toBe(new Color(PALETTE.railPost).getHex());
  });

  it('stands each bar on posts at both ends and no more than 6 m apart between, from the ground to its underside', () => {
    const t = park();
    const view = new RailsView(t);
    const posts = Array.from({ length: view.posts.count }, (_, i) => boxOf(view.posts.instanceMatrix.array, i));
    // Every post stands upright from below the ground to under a bar.
    for (const p of posts) {
      expect(Math.abs(p.c.x) + Math.abs(p.c.z)).toBeLessThan(1e-9);
      const lo = p.mid.y - Math.abs(p.c.y);
      expect(lo).toBeLessThanOrEqual(t.heightAt(p.mid.x, p.mid.z));
    }
    let used = 0;
    for (const r of t.rails) {
      const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      // The posts under this rail, by how far along it they stand.
      const along = posts
        .filter((p) => {
          const q = ((p.mid.x - r.x0) * (r.x1 - r.x0) + (p.mid.z - r.z0) * (r.z1 - r.z0)) / (len * len);
          const off = Math.hypot(p.mid.x - (r.x0 + (r.x1 - r.x0) * q), p.mid.z - (r.z0 + (r.z1 - r.z0) * q));
          return q > -1e-6 && q < 1 + 1e-6 && off < 1e-6;
        })
        .map((p) => {
          const q = ((p.mid.x - r.x0) * (r.x1 - r.x0) + (p.mid.z - r.z0) * (r.z1 - r.z0)) / (len * len);
          const hi = p.mid.y + Math.abs(p.c.y);
          // Its top meets the bar's underside.
          expect(hi).toBeCloseTo(r.y0 + (r.y1 - r.y0) * q - BAR_THICK, 6);
          return q * len;
        })
        .sort((a, b) => a - b);
      used += along.length;
      expect(along.length).toBeGreaterThanOrEqual(3);
      expect(along[0]).toBeCloseTo(0, 6);
      expect(along[along.length - 1]).toBeCloseTo(len, 6);
      for (let k = 1; k < along.length; k++) expect(along[k] - along[k - 1]).toBeLessThanOrEqual(POST_EVERY + 1e-6);
    }
    expect(used).toBe(view.posts.count);
  });

  it('is built once: two draw calls, static, with nothing to do per frame', () => {
    const view = new RailsView(park());
    expect(view.object.children).toEqual([view.bars, view.posts]);
    for (const mesh of [view.bars, view.posts]) {
      expect(mesh.visible).toBe(true);
      expect(mesh.matrixAutoUpdate).toBe(false);
      // Written once when built, and never again.
      expect(mesh.instanceMatrix.version).toBe(1);
      expect(mesh.instanceColor).toBeNull();
    }
    expect('update' in view).toBe(false);
  });

  it('draws every rail of a real bowl, and nothing on ground with none', () => {
    const b = makeBowl(1);
    const view = new RailsView(b);
    expect(view.bars.count).toBe(b.rails.length);
    expect(view.bars.count).toBeGreaterThanOrEqual(8);
    const none = new RailsView(flatTerrain());
    expect(none.bars.count).toBe(0);
    expect(none.posts.count).toBe(0);
    expect(none.bars.visible).toBe(false);
    expect(none.posts.visible).toBe(false);
  });
});
