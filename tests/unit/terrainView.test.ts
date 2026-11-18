import { Color, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { GROUND_NAME, PADS_NAME, makeTerrainView } from '../../src/render/terrainView';
import { flatTerrain, terrainFromHeight, type Terrain } from '../../src/sim/terrain';

const RADIUS = 170;
const TRIANGLE_BUDGET = 120_000;

/** A bowl-like test surface: rolling floor, a rim rising steeply past r = 130. */
function bowlish(): Terrain {
  const h = (x: number, z: number): number => {
    const r = Math.sqrt(x * x + z * z);
    const rim = r > 130 ? ((r - 130) / 40) * ((r - 130) / 40) * 32 : 0;
    return 4 * Math.sin(x / 13) * Math.cos(z / 17) + rim;
  };
  return terrainFromHeight(h, RADIUS, [
    { x: 20, z: 30, radius: 2.5 },
    { x: -60, z: -10, radius: 2.5 },
  ]);
}

function meshes(view: Object3D): Mesh[] {
  const out: Mesh[] = [];
  view.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function triangles(g: BufferGeometry): number {
  const idx = g.getIndex();
  return (idx ? idx.count : g.getAttribute('position').count) / 3;
}

function byName(view: Object3D, name: string): Mesh {
  const m = view.getObjectByName(name);
  if (!m || !(m as Mesh).isMesh) throw new Error(`no mesh named ${name}`);
  return m as Mesh;
}

describe('makeTerrainView', () => {
  const terrain = bowlish();
  const view = makeTerrainView(terrain);
  const ground = byName(view, GROUND_NAME);
  const pos = ground.geometry.getAttribute('position');

  it('is at most two draw calls', () => {
    expect(meshes(view).length).toBeLessThanOrEqual(2);
    expect(meshes(makeTerrainView(flatTerrain(RADIUS))).length).toBe(1);
  });

  it('stays within the triangle budget for radius 170', () => {
    let total = 0;
    for (const m of meshes(view)) total += triangles(m.geometry);
    expect(total).toBeLessThan(TRIANGLE_BUDGET);
    // And it really is a 2 m grid over the disc: about pi r^2 / 4 cells of two triangles.
    const cells = (Math.PI * RADIUS * RADIUS) / 4;
    expect(triangles(ground.geometry)).toBeGreaterThan(cells * 2 * 0.95);
  });

  it('puts every ground vertex on the surface', () => {
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.abs(pos.getY(i) - terrain.heightAt(pos.getX(i), pos.getZ(i)));
      if (d > worst) worst = d;
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('puts nothing outside the radius', () => {
    let far = 0;
    for (const m of meshes(view)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) far = Math.max(far, Math.hypot(p.getX(i), p.getZ(i)));
    }
    expect(far).toBeLessThanOrEqual(RADIUS + 1e-3);
    // And reaches the edge all the way round.
    expect(far).toBeGreaterThan(RADIUS - 1e-3);
  });

  it('faces up everywhere', () => {
    for (const m of meshes(view)) {
      const p = m.geometry.getAttribute('position');
      for (let t = 0; t < p.count; t += 3) {
        const ax = p.getX(t + 1) - p.getX(t);
        const az = p.getZ(t + 1) - p.getZ(t);
        const bx = p.getX(t + 2) - p.getX(t);
        const bz = p.getZ(t + 2) - p.getZ(t);
        // y of the face normal (a x b); degenerate edge slivers have none.
        expect(az * bx - ax * bz).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('colours the checker in the two ground colours, the 32 m lines and the rim', () => {
    /** sRGB hex of the 2 m cell with its low corner at (x, z). */
    const cellHex = (mesh: Mesh, x: number, z: number): number => {
      const p = mesh.geometry.getAttribute('position');
      const c = mesh.geometry.getAttribute('color');
      // The cell's first triangle runs (x, z), (x, z + 2), (x + 2, z).
      const at = (i: number, px: number, pz: number): boolean =>
        Math.abs(p.getX(i) - px) < 1e-3 && Math.abs(p.getZ(i) - pz) < 1e-3;
      for (let i = 0; i < p.count; i += 3) {
        if (at(i, x, z) && at(i + 1, x, z + 2) && at(i + 2, x + 2, z)) {
          // Vertex colours are in the linear working space; getHex converts back to sRGB.
          return new Color().setRGB(c.getX(i), c.getY(i), c.getZ(i)).getHex();
        }
      }
      throw new Error(`no cell at ${x},${z}`);
    };
    const flat = byName(makeTerrainView(flatTerrain(RADIUS)), GROUND_NAME);
    // Two neighbouring 8 m squares differ; squares two apart match.
    const a = cellHex(flat, 10, 10);
    const b = cellHex(flat, 18, 10);
    expect([PALETTE.groundA, PALETTE.groundB]).toContain(a);
    expect([PALETTE.groundA, PALETTE.groundB]).toContain(b);
    expect(a).not.toBe(b);
    expect(cellHex(flat, 26, 10)).toBe(a);
    expect(cellHex(flat, 10, 18)).toBe(b);
    expect(cellHex(flat, -6, -6)).toBe(a);
    // Cells on a 32 m line, either way, and on the axes.
    expect(cellHex(flat, 32, 10)).toBe(PALETTE.groundLine);
    expect(cellHex(flat, 10, -64)).toBe(PALETTE.groundLine);
    expect(cellHex(flat, 0, 10)).toBe(PALETTE.groundLine);
    // High up the rim of the bowl-like terrain the colour has moved toward the rim colour.
    const rim = new Color(cellHex(ground, 164, 2));
    const toRim = (c: Color): number => {
      const r = new Color(PALETTE.rim);
      return Math.abs(c.r - r.r) + Math.abs(c.g - r.g) + Math.abs(c.b - r.b);
    };
    const floorCell = new Color(cellHex(ground, 10, 10));
    expect(toRim(rim)).toBeLessThan(toRim(floorCell) * 0.5);
  });

  it('draws boost pads as discs just above the ground, in the pad colour', () => {
    const pads = byName(view, PADS_NAME);
    const p = pads.geometry.getAttribute('position');
    expect(p.count).toBeGreaterThan(0);
    for (let i = 0; i < p.count; i++) {
      const above = p.getY(i) - terrain.heightAt(p.getX(i), p.getZ(i));
      expect(above).toBeGreaterThan(0);
      expect(above).toBeLessThan(0.2);
      const near = terrain.pads.some((pad) => Math.hypot(p.getX(i) - pad.x, p.getZ(i) - pad.z) <= pad.radius + 1e-3);
      expect(near).toBe(true);
    }
    const mat = pads.material as { color?: { getHex(): number } };
    expect(mat.color?.getHex()).toBe(PALETTE.pad);
  });

  it('still fits the budget for a huge terrain', () => {
    const big = makeTerrainView(flatTerrain(2000));
    let total = 0;
    for (const m of meshes(big)) total += triangles(m.geometry);
    expect(total).toBeLessThan(TRIANGLE_BUDGET);
  });
});
