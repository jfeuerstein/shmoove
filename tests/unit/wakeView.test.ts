import { describe, expect, it } from 'vitest';
import { RIBBON_POINTS, WAKE_LIFT, WakeView, writeWakeRibbon } from '../../src/render/wakeView';
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
  return { pos: new Float32Array(RIBBON_POINTS * 6), col: new Float32Array(RIBBON_POINTS * 8) };
}

describe('writeWakeRibbon', () => {
  const straight: [number, number][] = [0, 1, 2, 3, 4].map((j) => [0, j * WAKE_STEP]);

  it('is as wide as it burns, square to the trail, on the ground', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1.1, ground, pos, col);
    expect(n).toBe(5);
    for (let j = 0; j < n; j++) {
      const lx = pos[j * 6], ly = pos[j * 6 + 1], lz = pos[j * 6 + 2];
      const rx = pos[j * 6 + 3], ry = pos[j * 6 + 4], rz = pos[j * 6 + 5];
      expect(Math.hypot(lx - rx, lz - rz)).toBeCloseTo(2.2, 5);
      // The trail runs along +z: the edges differ only across it, and straddle it evenly.
      expect(lz).toBeCloseTo(rz, 5);
      expect((lx + rx) / 2).toBeCloseTo(0, 5);
      expect(ly).toBeCloseTo(2 + WAKE_LIFT, 5);
      expect(ry).toBeCloseTo(2 + WAKE_LIFT, 5);
    }
  });

  it('runs oldest to newest, left edge first (left of travel along +z is +x)', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col);
    for (let j = 0; j < n; j++) {
      expect(pos[j * 6 + 2]).toBeCloseTo(j * WAKE_STEP, 5);
      expect(pos[j * 6]).toBeGreaterThan(pos[j * 6 + 3]);
    }
  });

  it('turns with a bending trail', () => {
    // Along +x: left of travel is -z.
    const k = trail([[0, 0], [1, 0], [2, 0]]);
    const { pos, col } = buffers();
    writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col);
    expect(pos[6 + 2]).toBeCloseTo(-1, 5);
    expect(pos[6 + 5]).toBeCloseTo(1, 5);
    expect(pos[6]).toBeCloseTo(1, 5);
  });

  it('fades from nothing at the tail to full at the head', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, false, 0, 0, 1, ground, pos, col, 0.8);
    expect(col[3]).toBe(0);
    expect(col[7]).toBe(0);
    expect(col[(n - 1) * 8 + 3]).toBeCloseTo(0.8, 6);
    for (let j = 1; j < n; j++) {
      expect(col[j * 8 + 3]).toBeGreaterThan(col[(j - 1) * 8 + 3]);
      expect(col[j * 8 + 7]).toBe(col[j * 8 + 3]);
    }
  });

  it('reaches the mover when it is past the last point', () => {
    const k = trail(straight);
    const { pos, col } = buffers();
    const n = writeWakeRibbon(k, true, 0, 5.8, 1, ground, pos, col);
    expect(n).toBe(6);
    expect(pos[5 * 6 + 2]).toBeCloseTo(5.8, 5);
    expect(col[5 * 8 + 3]).toBe(1);
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
    expect(view.mesh.geometry.drawRange.count).toBe(4 * 6);
    // As wide as FEEL.wakeWidth on either side.
    const p = view.mesh.geometry.getAttribute('position');
    expect(Math.abs(p.getX(0) - p.getX(1))).toBeCloseTo(2 * FEEL.wakeWidth, 5);
    // Bright at the mover, none at the tail.
    const c = view.mesh.geometry.getAttribute('color');
    expect(c.getW(0)).toBe(0);
    expect(c.getW(9)).toBeGreaterThan(0.5);
  });

  it('holds the longest trail the sim can lay', () => {
    const pts: [number, number][] = [];
    for (let j = 0; j < RIBBON_POINTS - 1; j++) pts.push([0, j * WAKE_STEP]);
    const view = new WakeView();
    view.update(trail(pts), 0, RIBBON_POINTS * WAKE_STEP, ground);
    expect(view.points).toBe(RIBBON_POINTS);
    expect(view.mesh.geometry.drawRange.count).toBe((RIBBON_POINTS - 1) * 6);
  });
});
