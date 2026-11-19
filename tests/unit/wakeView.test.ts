import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import {
  flameShape,
  HEAD_CORE_ALPHA,
  HEAD_EDGE_ALPHA,
  POP_LIFE,
  RIBBON_POINTS,
  UNBURNT_HEAD,
  WAKE_CORE,
  WAKE_LIFT,
  WakeView,
  writeWakeRibbon,
} from '../../src/render/wakeView';
import { FEEL } from '../../src/sim/constants';
import { makeWake, WAKE_STEP, type Wake } from '../../src/sim/wake';

function trail(points: [number, number][]): Wake {
  const k = makeWake();
  for (const [x, z] of points) {
    const i = k.count++;
    k.x[i] = x;
    k.y[i] = 5; // the mover's height when laid: the ribbon ignores it and follows the ground
    k.z[i] = z;
  }
  return k;
}

const ground = (): number => 2;

function buffers(): { pos: Float32Array; col: Float32Array } {
  return { pos: new Float32Array(RIBBON_POINTS * 12), col: new Float32Array(RIBBON_POINTS * 16) };
}

describe('writeWakeRibbon', () => {
  const straight: [number, number][] = [0, 1, 2, 3, 4].map((j) => [0, j * WAKE_STEP]);

  it('is as wide as it burns, square to the trail, on the ground', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1.1, ground, pos, col);
    expect(n).toBe(5);
    for (let j = 0; j < n; j++) {
      const o = j * 12;
      // Outer edges: the full burn width, straddling the trail evenly.
      expect(Math.hypot(pos[o] - pos[o + 9], pos[o + 2] - pos[o + 11])).toBeCloseTo(2.2, 5);
      expect((pos[o] + pos[o + 9]) / 2).toBeCloseTo(0, 5);
      // Core edges: the middle WAKE_CORE of it.
      expect(Math.hypot(pos[o + 3] - pos[o + 6], pos[o + 5] - pos[o + 8])).toBeCloseTo(2.2 * WAKE_CORE, 5);
      expect((pos[o + 3] + pos[o + 6]) / 2).toBeCloseTo(0, 5);
      // The trail runs along +z: all four differ only across it, and sit on the ground.
      for (let v = 0; v < 4; v++) {
        expect(pos[o + v * 3 + 2]).toBeCloseTo(j * WAKE_STEP, 5);
        expect(pos[o + v * 3 + 1]).toBeCloseTo(2 + WAKE_LIFT, 5);
      }
    }
  });

  it('runs oldest to newest, left edge first (left of travel along +z is +x)', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col);
    for (let j = 0; j < n; j++) {
      const o = j * 12;
      expect(pos[o + 2]).toBeCloseTo(j * WAKE_STEP, 5);
      expect(pos[o]).toBeGreaterThan(pos[o + 3]);
      expect(pos[o + 3]).toBeGreaterThan(pos[o + 6]);
      expect(pos[o + 6]).toBeGreaterThan(pos[o + 9]);
    }
  });

  it('turns with a bending trail', () => {
    // Along +x: left of travel is -z.
    const k = trail([[0, 0], [1, 0], [2, 0]]);
    const { pos, col } = buffers();
    writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col);
    expect(pos[12 + 2]).toBeCloseTo(-1, 5);
    expect(pos[12 + 11]).toBeCloseTo(1, 5);
    expect(pos[12]).toBeCloseTo(1, 5);
  });

  it('fades from nothing at the tail to a bright core and faint edges at the head', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col, 0.5, 0.15);
    const alpha = (j: number, v: number): number => col[j * 16 + v * 4 + 3];
    for (let v = 0; v < 4; v++) expect(alpha(0, v)).toBe(0);
    expect(alpha(n - 1, 0)).toBeCloseTo(0.15, 6);
    expect(alpha(n - 1, 1)).toBeCloseTo(0.5, 6);
    expect(alpha(n - 1, 2)).toBeCloseTo(0.5, 6);
    expect(alpha(n - 1, 3)).toBeCloseTo(0.15, 6);
    for (let j = 1; j < n; j++) {
      for (let v = 0; v < 4; v++) expect(alpha(j, v)).toBeGreaterThan(alpha(j - 1, v));
      // The core is always brighter than the edges it sits between.
      expect(alpha(j, 1)).toBeGreaterThan(alpha(j, 0));
      expect(alpha(j, 2)).toBeGreaterThan(alpha(j, 3));
    }
  });

  it('reaches the mover when it is past the last point', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, true, 0, 5.8, 1, ground, pos, col);
    expect(n).toBe(6);
    expect(pos[5 * 12 + 2]).toBeCloseTo(5.8, 5);
    expect(col[5 * 16 + 7]).toBe(1);
    // ...and adds nothing when the mover is standing on it.
    expect(writeWakeRibbon(k, true, 0, 4 * WAKE_STEP, 1, ground, pos, col)).toBe(5);
  });

  it('draws nothing for an empty trail or a single point', () => {
    const { pos, col } = buffers();
    expect(writeWakeRibbon(trail([]), false, 0, 0, 1, ground, pos, col)).toBe(0);
    expect(writeWakeRibbon(trail([]), true, 3, 3, 1, ground, pos, col)).toBe(0);
    expect(writeWakeRibbon(trail([[1, 1]]), false, 0, 0, 1, ground, pos, col)).toBe(0);
  });
});

describe('WakeView', () => {
  it('hides an empty trail and draws a full one in one range of quads', () => {
    const view = new WakeView();
    view.update(trail([]), 0, 0, ground);
    expect(view.mesh.visible).toBe(false);
    expect(view.mesh.geometry.drawRange.count).toBe(0);

    const k = trail([0, 1, 2, 3].map((j) => [0, j * WAKE_STEP] as [number, number]));
    view.update(k, 0, 3 * WAKE_STEP + 1, ground);
    expect(view.mesh.visible).toBe(true);
    expect(view.points).toBe(5);
    // Four segments, three quads each (left edge, core, right edge).
    expect(view.mesh.geometry.drawRange.count).toBe(4 * 3 * 6);
    // As wide as FEEL.wakeWidth on either side.
    const p = view.mesh.geometry.getAttribute('position');
    expect(Math.abs(p.getX(0) - p.getX(3))).toBeCloseTo(2 * FEEL.wakeWidth, 5);
    // Bright core at the mover, never above the head alpha, fainter edges, none at the tail.
    const c = view.mesh.geometry.getAttribute('color');
    expect(c.getW(0)).toBe(0);
    expect(c.getW(1)).toBe(0);
    expect(c.getW(16 + 0)).toBeCloseTo(HEAD_EDGE_ALPHA, 6);
    expect(c.getW(16 + 1)).toBeCloseTo(HEAD_CORE_ALPHA, 6);
    expect(HEAD_CORE_ALPHA).toBeLessThanOrEqual(0.5);
    expect(HEAD_EDGE_ALPHA).toBeLessThanOrEqual(0.15);
  });

  it('holds the longest trail the sim can lay', () => {
    const pts: [number, number][] = [];
    for (let j = 0; j < RIBBON_POINTS - 1; j++) pts.push([0, j * WAKE_STEP]);
    const view = new WakeView();
    view.update(trail(pts), 0, RIBBON_POINTS * WAKE_STEP, ground);
    expect(view.points).toBe(RIBBON_POINTS);
    expect(view.mesh.geometry.drawRange.count).toBe((RIBBON_POINTS - 1) * 3 * 6);
  });
});

describe('WakeView flames and the pop', () => {
  it('stands a flame on every trail point that burns, none on the newest under the board', () => {
    const k = trail([0, 1, 2, 3, 4, 5, 6, 7].map((j) => [0, j * WAKE_STEP] as [number, number]));
    const view = new WakeView();
    view.update(k, 0, 7 * WAKE_STEP + 0.5, ground, 1, 0);
    expect(view.trailFlames).toBe(8 - UNBURNT_HEAD);
    expect(view.flames.count).toBe(8 - UNBURNT_HEAD);
    const m = view.flames.instanceMatrix.array;
    for (let j = 0; j < view.trailFlames; j++) {
      // On its point, on the ground, standing up.
      expect(m[j * 16 + 12]).toBeCloseTo(0, 5);
      expect(m[j * 16 + 14]).toBeCloseTo(j * WAKE_STEP, 5);
      expect(m[j * 16 + 13]).toBeCloseTo(2, 5);
      expect(m[j * 16 + 5]).toBeGreaterThan(0.1);
    }
    // They flicker.
    const h0 = m[5];
    view.update(k, 0, 7 * WAKE_STEP + 0.5, ground, 1, 0.137);
    expect(view.flames.instanceMatrix.array[5]).not.toBeCloseTo(h0, 4);
    // Fullest most of the way along, lower at the tail and under the board.
    expect(flameShape(0.7)).toBeGreaterThan(flameShape(0));
    expect(flameShape(0.7)).toBeGreaterThan(flameShape(1));
  });

  it('burns as wide as the build makes it', () => {
    const k = trail([0, 1, 2, 3].map((j) => [0, j * WAKE_STEP] as [number, number]));
    const view = new WakeView();
    view.update(k, 0, 3 * WAKE_STEP + 1, ground, 1.5, 0);
    const p = view.mesh.geometry.getAttribute('position');
    expect(Math.abs(p.getX(0) - p.getX(3))).toBeCloseTo(2 * FEEL.wakeWidth * 1.5, 5);
  });

  it('flashes the loop when the trail is cut back to the board by a pop, and only then', () => {
    // A loop: round a circle of radius 5, back to where it started.
    const pts: [number, number][] = [];
    const n = Math.ceil((2 * Math.PI * 5) / WAKE_STEP);
    for (let j = 0; j < n; j++) pts.push([5 * Math.sin((j / n) * Math.PI * 2), 5 - 5 * Math.cos((j / n) * Math.PI * 2)]);
    const k = trail(pts);
    const view = new WakeView();
    view.update(k, pts[n - 1][0], pts[n - 1][1], ground, 1, 0);
    expect(view.popping).toBe(false);
    // The sim pops it: only the newest point is left, back near the start.
    const after = trail([[0.3, 0.1]]);
    view.update(after, 0.3, 0.1, ground, 1, 0.02);
    expect(view.popping).toBe(true);
    view.update(after, 0.3, 0.1, ground, 1, 0.1);
    expect(view.popFlames).toBeGreaterThan(n / 2);
    expect(view.mesh.visible).toBe(true);
    // Its flames stand round the loop, in the pop's colour.
    const m = view.flames.instanceMatrix.array;
    for (let i = view.trailFlames; i < view.flames.count; i++) {
      const r = Math.hypot(m[i * 16 + 12], m[i * 16 + 14] - 5);
      expect(r).toBeGreaterThan(4.5);
      expect(r).toBeLessThan(5.5);
    }
    const c = view.flames.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getZ(view.trailFlames)).toBeCloseTo(new Color(PALETTE.pop).b, 5);
    for (let t = 0.2; t < 0.2 + POP_LIFE + 0.2; t += 0.1) view.update(after, 0.3, 0.1, ground, 1, t);
    expect(view.popping).toBe(false);
    expect(view.mesh.visible).toBe(false);

    // A trail that only ages away, or a rider put somewhere else (a restart), does not pop.
    const again = new WakeView();
    again.update(k, pts[n - 1][0], pts[n - 1][1], ground, 1, 0);
    again.update(trail([[60, 60]]), 60, 60, ground, 1, 0.02);
    expect(again.popping).toBe(false);
    const short = trail(pts.slice(n - 10));
    again.update(k, pts[n - 1][0], pts[n - 1][1], ground, 1, 0.04);
    again.update(short, pts[n - 1][0], pts[n - 1][1], ground, 1, 0.06);
    expect(again.popping).toBe(false);
  });
});
