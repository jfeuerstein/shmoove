import { describe, expect, it } from 'vitest';
import {
  Surface,
  addRail,
  addSolid,
  collideSolids,
  createWorld,
  fillHeights,
  finalizeWorld,
  makeGroundSample,
  makeRailHit,
  makeWallHit,
  nearestRail,
  railAt,
  sampleGround,
  sampleTerrain,
  terrainHeight,
  topHeight,
  worldHash,
  type World,
} from '../../src/sim/world';

function flatWorld(): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -50, cell: 2, nx: 100, nz: 150 });
  fillHeights(w, (x, z) => 0.1 * z + 0.05 * x);
  return w;
}

describe('heightfield', () => {
  it('is exact at vertices and planar inside a planar field', () => {
    const w = flatWorld();
    finalizeWorld(w);
    expect(terrainHeight(w, 10, 20)).toBeCloseTo(2.5, 5);
    expect(terrainHeight(w, 11.3, 20.7)).toBeCloseTo(0.1 * 20.7 + 0.05 * 11.3, 5);
    const s = { y: 0, gx: 0, gz: 0, surface: 0 };
    sampleTerrain(w, 3.3, 7.7, s);
    expect(s.gx).toBeCloseTo(0.05, 5);
    expect(s.gz).toBeCloseTo(0.1, 5);
  });

  it('splits each cell along the diagonal from its low corner to its high corner', () => {
    const w = createWorld({ seed: 1, minX: 0, minZ: 0, cell: 2, nx: 2, nz: 2 });
    // Raise only the (1,1) corner of cell (0,0): the diagonal (0,0)->(1,1) is a ridge.
    w.heights[1 * 3 + 1] = 4;
    finalizeWorld(w);
    expect(terrainHeight(w, 1, 1)).toBeCloseTo(2, 6);
    // Off the ridge, toward the (1,0) corner: on the triangle (0,0),(1,0),(1,1).
    expect(terrainHeight(w, 1.5, 0.5)).toBeCloseTo(1, 6);
    expect(terrainHeight(w, 0.5, 1.5)).toBeCloseTo(1, 6);
  });

  it('clamps outside the grid instead of reading garbage', () => {
    const w = flatWorld();
    finalizeWorld(w);
    expect(Number.isFinite(terrainHeight(w, -1e4, 1e4))).toBe(true);
    expect(terrainHeight(w, -500, 0)).toBeCloseTo(terrainHeight(w, -100, 0), 6);
  });
});

describe('solids', () => {
  function withBox(): World {
    const w = createWorld({ seed: 1, minX: -100, minZ: -50, cell: 2, nx: 100, nz: 150 });
    addSolid(w, { cx: 40, cz: 100, hx: 5, hz: 3, yBase: 0, yTop: 6 });
    addSolid(w, { cx: 40, cz: 120, hx: 4, hz: 4, yBase: 2.6, yTop: 2.8, surface: Surface.AWNING, oneWay: true });
    addSolid(w, { cx: -40, cz: 0, hx: 6, hz: 1, rot: Math.PI / 4, yBase: 0, yTop: 3 });
    finalizeWorld(w);
    return w;
  }

  it('a top supports you only from above (within step-up)', () => {
    const w = withBox();
    const g = makeGroundSample();
    sampleGround(w, 40, 0, 100, 0.4, g);
    expect(g.y).toBe(0);
    expect(g.solid).toBe(-1);
    sampleGround(w, 40, 5.7, 100, 0.4, g);
    expect(g.y).toBe(6);
    expect(g.solid).toBe(0);
    expect(g.surface).toBe(Surface.ROOF);
    expect(topHeight(w, 40, 100)).toBe(6);
    expect(topHeight(w, 60, 100)).toBe(0);
  });

  it('walls push a cylinder out along the nearest face', () => {
    const w = withBox();
    const h = makeWallHit();
    collideSolids(w, 34.8, 0, 100, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(true);
    expect(h.nx).toBeCloseTo(-1, 6);
    expect(h.nz).toBeCloseTo(0, 6);
    expect(h.depth).toBeCloseTo(0.15, 6);
    // Standing on the roof, or passing clear of the side, is not a wall contact.
    collideSolids(w, 40, 6, 100, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(false);
    collideSolids(w, 34.5, 0, 100, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(false);
    // Dropped inside: comes out through the nearest face, fully clear.
    collideSolids(w, 40, 0, 102.5, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(true);
    expect(h.nz).toBeCloseTo(1, 6);
    expect(h.depth).toBeCloseTo(0.85, 6);
  });

  it('one-way slabs never block sideways or from below, and catch you from above', () => {
    const w = withBox();
    const h = makeWallHit();
    collideSolids(w, 40, 1.5, 120, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(false);
    const g = makeGroundSample();
    sampleGround(w, 40, 0, 120, 0.4, g);
    expect(g.y).toBe(0);
    sampleGround(w, 40, 3.5, 120, 0.4, g);
    expect(g.y).toBeCloseTo(2.8, 6);
    expect(g.surface).toBe(Surface.AWNING);
  });

  it('rotated boxes collide along their own axes', () => {
    const w = withBox();
    const h = makeWallHit();
    // Local +z of the box is (-sin, cos) = (-0.707, 0.707): a point just off that face.
    const d = 1 + 0.2;
    collideSolids(w, -40 - 0.7071 * d, 0, 0.7071 * d, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(true);
    expect(h.nx).toBeCloseTo(-0.7071, 3);
    expect(h.nz).toBeCloseTo(0.7071, 3);
    expect(h.depth).toBeCloseTo(0.15, 3);
    // The same distance along world +z from the centre is inside the long axis: still a hit;
    // far along the short axis is not.
    collideSolids(w, -40 - 3, 0, 3, 0.35, 1.7, 0.4, h);
    expect(h.hit).toBe(false);
  });
});

describe('rails', () => {
  it('finds the nearest rail point, respects the height window, and can skip a rail', () => {
    const w = createWorld({ seed: 1, minX: -100, minZ: -50, cell: 2, nx: 100, nz: 150 });
    const r0 = addRail(w, [0, 1, 0, 0, 1, 20, 0, 5, 40]);
    addRail(w, [3, 1, 0, 3, 1, 40]);
    finalizeWorld(w);
    const hit = makeRailHit();
    nearestRail(w, 0.5, 1.2, 10, 0.9, 0.7, 0.4, -1, hit);
    expect(hit.hit).toBe(true);
    expect(hit.rail).toBe(r0.index);
    expect(hit.s).toBeCloseTo(10, 5);
    expect(hit.dist).toBeCloseTo(0.5, 5);
    expect(hit.tz).toBeCloseTo(1, 6);
    nearestRail(w, 0.5, 3, 10, 0.9, 0.7, 0.4, -1, hit);
    expect(hit.hit).toBe(false);
    nearestRail(w, 0.5, 1.2, 10, 0.9, 0.7, 0.4, r0.index, hit);
    expect(hit.hit).toBe(false);
    nearestRail(w, 2.4, 1.2, 10, 3.5, 0.7, 0.4, r0.index, hit);
    expect(hit.rail).toBe(1);
  });

  it('railAt walks the polyline by arc length', () => {
    const w = createWorld({ seed: 1, minX: -100, minZ: -50, cell: 2, nx: 100, nz: 150 });
    const r = addRail(w, [0, 1, 0, 0, 1, 20, 0, 5, 40]);
    const hit = makeRailHit();
    railAt(r, 20, hit);
    expect(hit.z).toBeCloseTo(20, 5);
    railAt(r, r.length, hit);
    expect(hit.y).toBeCloseTo(5, 5);
    expect(hit.z).toBeCloseTo(40, 5);
    railAt(r, 25, hit);
    expect(hit.ty).toBeGreaterThan(0.1);
    expect(Math.hypot(hit.tx, hit.ty, hit.tz)).toBeCloseTo(1, 6);
  });
});

describe('world hash', () => {
  it('changes when the world changes', () => {
    const a = flatWorld();
    const b = flatWorld();
    finalizeWorld(a);
    addSolid(b, { cx: 0, cz: 0, hx: 1, hz: 1, yBase: 0, yTop: 2 });
    finalizeWorld(b);
    expect(worldHash(a)).not.toBe(worldHash(b));
    expect(worldHash(flatWorld())).toBe(worldHash(flatWorld()));
  });
});
