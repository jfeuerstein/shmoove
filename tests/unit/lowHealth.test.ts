import { describe, expect, it } from 'vitest';
import {
  isLow,
  LOW_HEALTH,
  LowHealthView,
  lowStrength,
  PULSE_FAST,
  PULSE_SLOW,
  pulseRate,
  STEADY,
} from '../../src/ui/lowHealth';

/** Just enough of an element for the view to build and write to. */
class FakeEl {
  className = '';
  opacity = '';
  readonly ownerDocument = { createElement: (): FakeEl => new FakeEl() };
  get style(): FakeEl {
    return this;
  }
  setProperty(): void {}
  setAttribute(): void {}
  appendChild<T>(c: T): T {
    return c;
  }
}

function view(): { v: LowHealthView; el: FakeEl } {
  const v = new LowHealthView(new FakeEl() as unknown as HTMLElement);
  return { v, el: v.element as unknown as FakeEl };
}

describe('low health thresholds', () => {
  it('is on under 30% and off at or above it', () => {
    expect(LOW_HEALTH).toBe(0.3);
    expect(isLow(0.29)).toBe(true);
    expect(isLow(0)).toBe(true);
    expect(isLow(0.3)).toBe(false);
    expect(isLow(1)).toBe(false);
  });

  it('pulses faster as health falls', () => {
    expect(pulseRate(0.299)).toBeCloseTo(PULSE_SLOW, 1);
    expect(pulseRate(0)).toBe(PULSE_FAST);
    expect(pulseRate(0.1)).toBeGreaterThan(pulseRate(0.2));
  });

  it('is nothing when health is fine, whatever the phase', () => {
    for (let p = 0; p < 1; p += 0.1) expect(lowStrength(0.5, p, false)).toBe(0);
  });

  it('pulses between a trough and a peak when low', () => {
    let lo = 1;
    let hi = 0;
    for (let p = 0; p < 1; p += 0.01) {
      const s = lowStrength(0.1, p, false);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    expect(hi).toBeCloseTo(1, 1);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0.4);
  });

  it('is a steady tint with reduced motion, and only while low', () => {
    for (let p = 0; p < 1; p += 0.1) expect(lowStrength(0.1, p, true)).toBe(STEADY);
    expect(lowStrength(0.9, 0.3, true)).toBe(0);
  });
});

describe('LowHealthView', () => {
  it('pulses while low, and is gone the moment health is back above', () => {
    const { v, el } = view();
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      v.update(0.1, 1 / 60);
      seen.add(v.strength);
    }
    expect(seen.size).toBeGreaterThan(5);
    v.update(0.5, 1 / 60);
    expect(v.strength).toBe(0);
    expect(el.opacity).toBe('0');
  });

  it('holds still in reduced motion', () => {
    const { v } = view();
    v.reduced = true;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      v.update(0.1, 1 / 60);
      seen.add(v.strength);
    }
    expect([...seen]).toEqual([STEADY]);
  });
});
