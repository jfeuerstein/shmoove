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

describe('review fixes', () => {
  beforeEach(() => resetFeel());

  it('a diagonal flick that drifts sideways still arms when held', () => {
    const g = new Gestures();
    g.down(200, 700);
    g.sample();
    g.move(200 + FEEL.DRAG_DEADZONE_PX + 8, 700 - FEEL.SWIPE_UP_PX * 1.3);
    expect(g.sample().hop).toBe(true);
    let hold = false;
    for (let i = 0; i < 20; i++) hold = g.sample().hold;
    expect(hold).toBe(true);
  });
});

describe('the brake: pulling the finger down', () => {
  beforeEach(() => resetFeel());

  /** Sample `n` ticks; whether every one braked, whether any did, and the hops. */
  const brakes = (g: Gestures, n: number): { all: boolean; any: boolean; hold: boolean; hops: number } => {
    let all = true;
    let any = false;
    let hold = false;
    let hops = 0;
    for (let i = 0; i < n; i++) {
      const f = g.sample();
      all = all && f.brake === true;
      any = any || f.brake === true;
      hold = f.hold;
      if (f.hop) hops++;
    }
    return { all, any, hold, hops };
  };

  it('pulling down past the threshold brakes for as long as the finger stays down there', () => {
    const g = new Gestures();
    g.down(200, 600);
    brakes(g, 2);
    // Short of the threshold: nothing.
    for (let i = 1; i <= 8; i++) {
      g.move(200, 600 + (FEEL.BRAKE_PULL_PX - 4) * (i / 8));
      expect(brakes(g, 1).any).toBe(false);
    }
    g.move(200, 600 + FEEL.BRAKE_PULL_PX + 6);
    expect(brakes(g, 1).all).toBe(true);
    expect(brakes(g, 120).all).toBe(true);
    // A little wobble back up does not let go.
    g.move(200, 600 + FEEL.BRAKE_PULL_PX * 0.8);
    expect(brakes(g, 10).all).toBe(true);
  });

  it('coming back up releases the brake, without a hop', () => {
    const g = new Gestures();
    g.down(200, 600);
    brakes(g, 2);
    g.move(200, 600 + FEEL.BRAKE_PULL_PX + 10);
    expect(brakes(g, 30).all).toBe(true);
    // Back up toward where it landed, over half a second.
    let hops = 0;
    for (let i = 1; i <= 30; i++) {
      g.move(200, 600 + (FEEL.BRAKE_PULL_PX + 10) * (1 - i / 30));
      hops += brakes(g, 1).hops;
    }
    expect(brakes(g, 5).any).toBe(false);
    expect(hops).toBe(0);
    // And lifting the finger always lets go.
    g.move(200, 600 + FEEL.BRAKE_PULL_PX + 10);
    expect(brakes(g, 1).all).toBe(true);
    g.up();
    expect(brakes(g, 1).any).toBe(false);
  });

  it('a thumb resting on the glass never brakes, however long it rests', () => {
    const g = new Gestures();
    g.down(200, 600);
    // A resting thumb drifts a few pixels.
    let any = false;
    for (let i = 0; i < 600; i++) {
      g.move(200 + (i % 7) - 3, 600 + (i % 5) - 2);
      any = brakes(g, 1).any || any;
    }
    expect(any).toBe(false);
  });

  it('a carving thumb never brakes, even swinging wide and a little low', () => {
    const g = new Gestures();
    g.down(200, 600);
    let any = false;
    for (let i = 0; i < 600; i++) {
      const k = (i % 120) / 120;
      const x = 200 + 110 * (k < 0.5 ? 4 * k - 1 : 3 - 4 * k);
      // The thumb's arc dips as it swings out, well short of a pull.
      const y = 600 + 0.4 * FEEL.BRAKE_PULL_PX * Math.abs(x - 200) / 110;
      g.move(x, y);
      any = brakes(g, 1).any || any;
    }
    expect(any).toBe(false);
  });

  it('a swipe up still hops, and does not brake', () => {
    const g = new Gestures();
    g.down(200, 700);
    brakes(g, 1);
    g.move(200, 700 - FEEL.SWIPE_UP_PX * 1.3);
    const r = brakes(g, 1);
    expect(r.hops).toBe(1);
    expect(r.any).toBe(false);
  });

  it('brake and hold together: waiting at a stop with a hand out', () => {
    const g = new Gestures();
    g.down(200, 600);
    g.move(200, 600 + FEEL.BRAKE_PULL_PX + 8);
    const r = brakes(g, Math.ceil(FEEL.HOLD_ARM_TIME * 60) + 4);
    expect(r.all).toBe(true);
    expect(r.hold).toBe(true);
    expect(g.isArmed).toBe(true);
  });

  it('keyboard: the down arrow and S brake while pressed', () => {
    for (const code of ['ArrowDown', 'KeyS']) {
      const g = new Gestures();
      expect(g.key(code, true)).toBe(true);
      expect(brakes(g, 3).all).toBe(true);
      g.key(code, false);
      expect(brakes(g, 1).any).toBe(false);
    }
  });
});

