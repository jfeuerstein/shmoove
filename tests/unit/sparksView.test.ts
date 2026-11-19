import { Color, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE, tone } from '../../src/render/look';
import { BIG_SPARK, sparkScale, SparksView, STRETCH_MAX } from '../../src/render/sparksView';
import { makeWorld, type World } from '../../src/sim/world';

function spark(w: World, i: number, x: number, y: number, z: number, value: number, pull: number): void {
  const s = w.sparks;
  s.x[i] = x;
  s.y[i] = y;
  s.z[i] = z;
  s.value[i] = value;
  s.pull[i] = pull;
}

function matrix(view: SparksView, i: number): number[] {
  return Array.from(view.mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16));
}

describe('SparksView', () => {
  it('hovers each spark where it lies, bigger, paler and brighter for a bigger value', () => {
    const w = makeWorld(1);
    w.sparks.count = 2;
    spark(w, 0, 1, 0, 2, 1, 0);
    spark(w, 1, -3, 0, 4, BIG_SPARK + 7, 0);
    const view = new SparksView();
    view.update(w, 0);
    expect(view.mesh.count).toBe(2);
    const small = matrix(view, 0);
    const big = matrix(view, 1);
    expect([small[12], small[14]]).toEqual([1, 2]);
    expect(small[13]).toBeGreaterThan(0.3);
    expect(Math.hypot(big[4], big[5], big[6]) / Math.hypot(small[4], small[5], small[6])).toBeCloseTo(sparkScale(BIG_SPARK + 7) / sparkScale(1), 5);
    const c = view.mesh.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getX(0)).toBeCloseTo(new Color(PALETTE.spark).r, 5);
    expect(c.getX(1)).toBeCloseTo(new Color(tone(PALETTE.spark, 0.4)).r, 5);
    const glow = view.mesh.geometry.getAttribute('aGlow') as InstancedBufferAttribute;
    expect(glow.getX(1)).toBeGreaterThan(glow.getX(0));
    // At rest, not stretched.
    expect(view.stretch[0]).toBe(1);
    w.sparks.count = 0;
    view.update(w, 0.1);
    expect(view.mesh.visible).toBe(false);
  });

  it('stretches a spark flying to the player along the way it flies, the faster the longer', () => {
    const w = makeWorld(1);
    w.sparks.count = 2;
    spark(w, 0, 0, 0, 0, 1, 1);
    spark(w, 1, 5, 0, 0, 1, 1);
    const view = new SparksView();
    w.run.ticks = 1;
    view.update(w, 0);
    // One tick on: spark 0 flew 0.2 m along +x (12 m/s), spark 1 0.5 m (30 m/s) along +x.
    spark(w, 0, 0.2, 0, 0, 1, 1);
    spark(w, 1, 5.5, 0, 0, 1, 1);
    w.run.ticks = 2;
    view.update(w, 1 / 60);
    expect(view.stretch[0]).toBeGreaterThan(1.3);
    expect(view.stretch[1]).toBeGreaterThan(view.stretch[0]);
    expect(view.stretch[1]).toBeLessThanOrEqual(STRETCH_MAX / 0.75 + 1e-6);
    // Its long axis lies along +x.
    const m = matrix(view, 1);
    const l = Math.hypot(m[4], m[5], m[6]);
    expect(m[4] / l).toBeCloseTo(1, 5);
  });

  it('does not stretch a slot the pool filled with another spark', () => {
    const w = makeWorld(1);
    w.sparks.count = 1;
    spark(w, 0, 0, 0, 0, 1, 1);
    const view = new SparksView();
    w.run.ticks = 1;
    view.update(w, 0);
    // A spark 20 m away now sits in slot 0: no spark flies that far in a tick.
    spark(w, 0, 20, 0, 0, 1, 1);
    w.run.ticks = 2;
    view.update(w, 1 / 60);
    expect(view.stretch[0]).toBe(1);
  });
});
