import { describe, expect, it } from 'vitest';
import { emitFx, FX_ENEMY_DIE, FX_ENEMY_HIT, FX_POP, FX_SPARK, makeWorld, type World } from '../../src/sim/world';
import { MERGE_DIST, MERGE_TIME, NUMBER_LIFE, NUMBER_POOL, Numbers, RIDER_KEEP_MIN } from '../../src/ui/numbers';

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

/** Screen x (px) and y of a shown number, from its transform. */
function at(e: FakeEl): { x: number; y: number } {
  const m = /translate3d\((-?\d+)px, (-?\d+)px, 0\)/.exec(e.style.transform);
  if (!m) throw new Error(`no transform: ${e.style.transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Hits at x = 0, 1.3, 2.6, ... m: each far enough from the others not to merge. */
const apart = (i: number): number => i * (MERGE_DIST + 0.1);
/** A projection that fits 20 m across the screen, so hits metres apart are all on it. */
const WIDE = [0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 1];

describe('Numbers', () => {
  it('makes its small pool up front and nothing after', () => {
    const { nums, els, made } = build();
    expect(els).toHaveLength(NUMBER_POOL);
    expect(NUMBER_POOL).toBeLessThanOrEqual(10);
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
    const y0 = at(e).y;
    const o0 = Number(e.style.opacity);
    nums.update(NUMBER_LIFE / 2, IDENTITY, SIZE, SIZE);
    const y1 = at(e).y;
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

  it('adds hits on the same enemy in a short time into one number', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    // An enemy hit every tick for a fifth of a second, drifting a little: one number with the sum.
    for (let t = 0; t < 12; t++) {
      tick(w, [{ x: t * 0.01, dmg: 3 }]);
      nums.ingest(w);
      nums.update(1 / 60, IDENTITY, SIZE, SIZE);
    }
    expect(MERGE_TIME).toBeGreaterThan(12 / 60);
    const shown = els.filter((e) => !e.hidden);
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe('36');
    expect(nums.merged).toBe(11);
  });

  it('starts a new number for the same place once the first is old, and for another enemy at once', () => {
    const { nums } = build();
    const w = makeWorld(1);
    tick(w, [{ x: 0, dmg: 3 }]);
    nums.ingest(w);
    nums.update(MERGE_TIME + 0.01, IDENTITY, SIZE, SIZE);
    tick(w, [{ x: 0, dmg: 3 }]);
    nums.ingest(w);
    expect(nums.active).toBe(2);
    tick(w, [{ x: MERGE_DIST + 0.2, dmg: 3 }]);
    nums.ingest(w);
    expect(nums.active).toBe(3);
  });

  it('never shows more than its cap; a bigger hit takes the place of the least, a smaller one is not shown', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    for (let i = 0; i < NUMBER_POOL; i++) {
      tick(w, [{ x: apart(i), dmg: 10 + i }]);
      nums.ingest(w);
      nums.update(0.01, WIDE, SIZE, SIZE);
    }
    expect(nums.active).toBe(NUMBER_POOL);
    // A small hit elsewhere: the screen is full of bigger ones; it is not shown.
    tick(w, [{ x: apart(NUMBER_POOL + 1), dmg: 2 }]);
    nums.ingest(w);
    nums.update(0.01, WIDE, SIZE, SIZE);
    expect(nums.active).toBe(NUMBER_POOL);
    expect(nums.dropped).toBe(1);
    expect(els.map((e) => e.textContent)).not.toContain('2');
    // A big hit takes the place of the least (10).
    tick(w, [{ x: apart(NUMBER_POOL + 2), dmg: 99 }]);
    nums.ingest(w);
    nums.update(0.01, WIDE, SIZE, SIZE);
    const texts = els.map((e) => e.textContent);
    expect(texts).toContain('99');
    expect(texts).not.toContain('10');
    expect(nums.active).toBe(NUMBER_POOL);
  });

  it('marks a hit that killed, and a kill wins the cap over a bigger plain hit', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    for (let i = 0; i < NUMBER_POOL; i++) {
      tick(w, [{ x: apart(i), dmg: 50 }]);
      nums.ingest(w);
      nums.update(0.01, WIDE, SIZE, SIZE);
    }
    w.fx.count = 0;
    emitFx(w, FX_ENEMY_HIT, apart(NUMBER_POOL + 1), 0, 0, 4);
    emitFx(w, FX_ENEMY_DIE, apart(NUMBER_POOL + 1), 0, 0, 0);
    nums.ingest(w);
    nums.update(0.01, WIDE, SIZE, SIZE);
    const kill = els.find((e) => e.textContent === '4');
    expect(kill).toBeDefined();
    expect(kill?.className).toContain('num-kill');
    expect(els.filter((e) => e.textContent === '50')).toHaveLength(NUMBER_POOL - 1);
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

  it('draws no number over the rider: one landing there is pushed out to the edge of its room', () => {
    const { nums, els } = build();
    const w = makeWorld(1);
    tick(w, [{ x: 0, dmg: 9 }]);
    nums.ingest(w);
    // The rider sits right where the number would be drawn.
    const keep = { x: 400, y: 400 - 0.9 * 400, r: 50, known: true };
    nums.update(0, IDENTITY, SIZE, SIZE, keep);
    const p = at(els.filter((e) => !e.hidden)[0]);
    expect(Math.hypot(p.x - keep.x, p.y - keep.y)).toBeGreaterThanOrEqual(keep.r - 1);
    // A far rider leaves the room at its least.
    nums.reset();
    tick(w, [{ x: 0, dmg: 9 }]);
    nums.ingest(w);
    const small = { ...keep, r: 1 };
    nums.update(0, IDENTITY, SIZE, SIZE, small);
    const q = at(els.filter((e) => !e.hidden)[0]);
    expect(Math.hypot(q.x - keep.x, q.y - keep.y)).toBeGreaterThanOrEqual(RIDER_KEEP_MIN - 1);
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
