import { beforeEach, describe, expect, it } from 'vitest';
import { Gestures } from '../../src/input/gestures';
import { FEEL, resetFeel } from '../../src/sim/constants';

const ticks = (g: Gestures, n: number): { steer: number; hold: boolean; hops: number } => {
  let hops = 0;
  let last = { steer: 0, hold: false };
  for (let i = 0; i < n; i++) {
    const f = g.sample();
    if (f.hop) hops++;
    last = { steer: f.steer, hold: f.hold };
  }
  return { ...last, hops };
};

describe('one-thumb gestures', () => {
  beforeEach(() => resetFeel());

  it('a touch held still arms the hitch after the arm time, not before', () => {
    const g = new Gestures();
    g.down(200, 600);
    const armTicks = Math.ceil(FEEL.HOLD_ARM_TIME * 60);
    expect(ticks(g, armTicks - 2).hold).toBe(false);
    expect(ticks(g, 3).hold).toBe(true);
    g.up();
    expect(ticks(g, 1).hold).toBe(false);
  });

  it('a touch that drags sideways first is a pure carve and never arms', () => {
    const g = new Gestures();
    g.down(200, 600);
    g.move(200 + FEEL.DRAG_DEADZONE_PX + 4, 600);
    const r = ticks(g, 60);
    expect(r.hold).toBe(false);
    expect(r.steer).toBeGreaterThan(0);
  });

  it('small jitter inside the dead zone still arms', () => {
    const g = new Gestures();
    g.down(200, 600);
    g.move(200 + FEEL.DRAG_DEADZONE_PX - 3, 604);
    expect(ticks(g, 20).hold).toBe(true);
  });

  it('dragging after arming steers and stays armed', () => {
    const g = new Gestures();
    g.down(200, 600);
    ticks(g, 20);
    g.move(200 - FEEL.STEER_RANGE_PX / 2, 600);
    const r = ticks(g, 1);
    expect(r.hold).toBe(true);
    expect(r.steer).toBeCloseTo(-0.5, 6);
  });

  it('steer is proportional to the drag and clamps at full lock', () => {
    const g = new Gestures();
    g.down(100, 600);
    g.move(100 + FEEL.STEER_RANGE_PX * 0.25, 600);
    expect(ticks(g, 1).steer).toBeCloseTo(0.25, 6);
    g.move(100 + FEEL.STEER_RANGE_PX * 3, 600);
    expect(ticks(g, 1).steer).toBe(1);
  });

  it('the anchor follows a finger past full lock, so reversing responds at once', () => {
    const g = new Gestures();
    g.down(100, 600);
    g.move(100 + FEEL.STEER_RANGE_PX * 3, 600);
    ticks(g, 1);
    // Come back by half the range: without a moving anchor this would still be full lock.
    g.move(100 + FEEL.STEER_RANGE_PX * 2.5, 600);
    expect(ticks(g, 1).steer).toBeCloseTo(0.5, 6);
  });

  it('a fast upward flick is exactly one hop', () => {
    const g = new Gestures();
    g.down(200, 700);
    ticks(g, 1);
    g.move(200, 700 - FEEL.SWIPE_UP_PX * 0.5);
    const a = ticks(g, 1);
    g.move(200, 700 - FEEL.SWIPE_UP_PX * 1.1);
    const b = ticks(g, 1);
    g.move(200, 700 - FEEL.SWIPE_UP_PX * 1.3);
    const c = ticks(g, 3);
    expect(a.hops + b.hops + c.hops).toBe(1);
    expect(b.hops).toBe(1);
  });

  it('a slow upward drag is not a hop', () => {
    const g = new Gestures();
    g.down(200, 700);
    let hops = 0;
    for (let i = 1; i <= 60; i++) {
      g.move(200, 700 - i * 3);
      hops += ticks(g, 1).hops;
    }
    expect(hops).toBe(0);
  });

  it('swipe up and keep holding: the hop fires and the touch still arms', () => {
    const g = new Gestures();
    g.down(200, 700);
    ticks(g, 1);
    g.move(200, 620);
    const r = ticks(g, 1);
    expect(r.hops).toBe(1);
    expect(ticks(g, 20).hold).toBe(true);
  });

  it('a second flick on the same touch hops again', () => {
    const g = new Gestures();
    g.down(200, 700);
    ticks(g, 1);
    g.move(200, 620);
    expect(ticks(g, 1).hops).toBe(1);
    ticks(g, 30);
    g.move(200, 540);
    expect(ticks(g, 1).hops).toBe(1);
  });

  it('keyboard: arrows steer, space holds at once, up hops once per press', () => {
    const g = new Gestures();
    g.key('ArrowRight', true);
    expect(ticks(g, 1).steer).toBe(1);
    g.key('ArrowRight', false);
    g.key('KeyA', true);
    expect(ticks(g, 1).steer).toBe(-1);
    g.key('KeyA', false);
    g.key('Space', true);
    expect(ticks(g, 1).hold).toBe(true);
    g.key('Space', false);
    g.key('ArrowUp', true);
    expect(ticks(g, 3).hops).toBe(1);
    expect(g.key('KeyQ', true)).toBe(false);
  });
});
