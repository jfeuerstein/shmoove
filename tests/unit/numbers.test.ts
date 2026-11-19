import { describe, expect, it } from 'vitest';
import { emitFx, FX_ENEMY_DIE, FX_ENEMY_HIT, FX_POP, FX_SPARK, makeWorld, type World } from '../../src/sim/world';
import { NUMBER_LIFE, NUMBER_POOL, Numbers } from '../../src/ui/numbers';

class FakeEl {
  className = '';
  hidden = false;
  textContent = '';
  readonly children: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function build(): { nums: Numbers; els: FakeEl[]; made: () => number } {
  let made = 0;
  const doc = {
    createElement: () => {
      made++;
      return new FakeEl();
    },
  } as unknown as Document;
  const root = new FakeEl();
  const nums = new Numbers(root as unknown as HTMLElement, doc);
  return { nums, els: root.children[0].children, made: () => made };
}

/** A fresh tick's effects queue holding one hit at screen-x `x` (identity projection). */
function tick(w: World, hits: { x: number; dmg: number }[]): void {
  w.fx.count = 0;
  for (const h of hits) emitFx(w, FX_ENEMY_HIT, h.x, 0, 0, h.dmg);
}

const SIZE = 800;
const upTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('Numbers', () => {
  it('makes a pool of 24 up front and nothing after', () => {
    const { nums, els, made } = build();
    expect(els).toHaveLength(NUMBER_POOL);
    expect(NUMBER_POOL).toBe(24);
    const w = makeWorld(1);
    const created = made();
    for (let i = 0; i < 200; i++) {
      tick(w, [{ x: (i % 10) / 20, dmg: 5 }]);
      nums.ingest(w);
      nums.update(0.01, IDENTITY, SIZE, SIZE);
    }
    expect(made()).toBe(created);
    expect(els).toHaveLength(NUMBER_POOL);
  });

  it('shows the damage of a hit at the hit place, rounded', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    tick(w, [{ x: 0, dmg: 12.4 }]);
    nums.ingest(w);
    nums.update(0, IDENTITY, SIZE, SIZE);
    const shown = els.filter((e) => !e.hidden);
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe('12');
    // The world point (0, 0.9, 0) under an identity projection sits at the middle, a little up.
    expect(shown[0].style.transform).toMatch(/^translate3d\(400px, /);
  });

  it('floats up and fades over about 0.6 s, then frees the slot', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    tick(w, [{ x: 0, dmg: 7 }]);
    nums.ingest(w);
    nums.update(0, IDENTITY, SIZE, SIZE);
    const e = els.find((x) => !x.hidden);
    expect(e).toBeDefined();
    if (!e) return;
    const y0 = Number(/, (-?\d+)px, 0/.exec(e.style.transform)?.[1]);
    const o0 = Number(e.style.opacity);
    nums.update(NUMBER_LIFE / 2, IDENTITY, SIZE, SIZE);
    const y1 = Number(/, (-?\d+)px, 0/.exec(e.style.transform)?.[1]);
    const o1 = Number(e.style.opacity);
    expect(y1).toBeLessThan(y0);
    expect(o1).toBeLessThan(o0);
    expect(nums.active).toBe(1);
    nums.update(NUMBER_LIFE / 2 + 0.01, IDENTITY, SIZE, SIZE);
    expect(e.hidden).toBe(true);
    expect(nums.active).toBe(0);
    expect(NUMBER_LIFE).toBeGreaterThan(0.5);
    expect(NUMBER_LIFE).toBeLessThan(0.7);
  });

  it('reuses the oldest for the 25th number', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    for (const i of upTo(NUMBER_POOL)) {
      tick(w, [{ x: 0, dmg: i + 1 }]);
      nums.ingest(w);
      nums.update(0.01, IDENTITY, SIZE, SIZE);
    }
    expect(nums.active).toBe(NUMBER_POOL);
    expect(els.map((e) => e.textContent)).toEqual(upTo(NUMBER_POOL).map((i) => String(i + 1)));
    tick(w, [{ x: 0, dmg: 99 }]);
    nums.ingest(w);
    nums.update(0.01, IDENTITY, SIZE, SIZE);
    expect(els[0].textContent).toBe('99');
    expect(els.slice(1).map((e) => e.textContent)).toEqual(upTo(NUMBER_POOL - 1).map((i) => String(i + 2)));
    expect(nums.active).toBe(NUMBER_POOL);
  });

  it('shows one larger number at the loop centre with how many died that tick', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    w.fx.count = 0;
    emitFx(w, FX_POP, 0.1, 0, 0, 6);
    emitFx(w, FX_ENEMY_DIE, 0.2, 0, 0, 0);
    emitFx(w, FX_ENEMY_DIE, 0.3, 0, 0, 1);
    emitFx(w, FX_ENEMY_DIE, 0.4, 0, 0, 0);
    nums.ingest(w);
    nums.update(0, IDENTITY, SIZE, SIZE);
    const shown = els.filter((e) => !e.hidden);
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe('3');
    expect(shown[0].className).toContain('num-big');
  });

  it('writes no number for a spark, a death or an empty tick', () => {
    const { nums } = build();
    const w = makeWorld(1);
    w.fx.count = 0;
    emitFx(w, FX_SPARK, 0, 0, 0, 1);
    emitFx(w, FX_ENEMY_DIE, 0, 0, 0, 0);
    nums.ingest(w);
    expect(nums.active).toBe(0);
  });

  it('hides a number that is off screen, and reset clears everything', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    tick(w, [
      { x: 0, dmg: 3 },
      { x: 5, dmg: 4 },
    ]);
    nums.ingest(w);
    nums.update(0, IDENTITY, SIZE, SIZE);
    expect(els.filter((e) => !e.hidden)).toHaveLength(1);
    nums.reset();
    expect(nums.active).toBe(0);
    expect(els.every((e) => e.hidden)).toBe(true);
  });
});
