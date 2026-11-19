import { describe, expect, it } from 'vitest';
import { isLow, LOW_FAINT, LOW_HEALTH, LOW_STRONG, LowHealthView, lowStrength } from '../../src/ui/lowHealth';

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

  it('is nothing when health is fine', () => {
    for (const f of [0.3, 0.5, 0.9, 1]) expect(lowStrength(f)).toBe(0);
  });

  it('grows stronger as health falls, from faint at the threshold to strong at none', () => {
    expect(lowStrength(0.2999)).toBeCloseTo(LOW_FAINT, 2);
    expect(lowStrength(0)).toBe(LOW_STRONG);
    expect(lowStrength(0.1)).toBeGreaterThan(lowStrength(0.2));
    expect(LOW_STRONG).toBeLessThanOrEqual(1);
  });
});

describe('LowHealthView', () => {
  it('is steady while low (it does not pulse like a hit), and gone the moment health is back above', () => {
    const { v, el } = view();
    const seen = new Set<number>();
    for (let i = 0; i < 240; i++) {
      v.update(0.1, 1 / 60);
      seen.add(v.strength);
    }
    expect([...seen]).toEqual([lowStrength(0.1)]);
    expect(Number(el.opacity)).toBeCloseTo(lowStrength(0.1), 1);
    v.update(0.5, 1 / 60);
    expect(v.strength).toBe(0);
    expect(el.opacity).toBe('0');
  });

  it('is the same with reduced motion', () => {
    const { v } = view();
    v.reduced = true;
    v.update(0.05, 1 / 60);
    expect(v.strength).toBe(lowStrength(0.05));
  });
});
