import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/app/params';

describe('parseParams', () => {
  it('has defaults for an empty query', () => {
    for (const q of ['', '?']) {
      expect(parseParams(q)).toEqual({ debug: false, hook: false, perf: false, flat: false, solo: false, seed: 1, scheme: 'tuck', horde: 0, sparks: 0, lesson: false, nolesson: false, arsenal: false });
    }
  });

  it('reads each flag on its own', () => {
    expect(parseParams('?debug').debug).toBe(true);
    expect(parseParams('?hook').hook).toBe(true);
    expect(parseParams('?perf').perf).toBe(true);
    const all = parseParams('?debug&hook&perf');
    expect(all.debug && all.hook && all.perf).toBe(true);
    const one = parseParams('?hook');
    expect(one.debug).toBe(false);
    expect(one.perf).toBe(false);
  });

  it('takes a flag with a value as on, unless the value says off', () => {
    expect(parseParams('?debug=1').debug).toBe(true);
    expect(parseParams('?debug=true').debug).toBe(true);
    expect(parseParams('?debug=').debug).toBe(true);
    expect(parseParams('?debug=0').debug).toBe(false);
    expect(parseParams('?debug=false').debug).toBe(false);
    expect(parseParams('?hook=off').hook).toBe(false);
  });

  it('reads the seed as an integer', () => {
    expect(parseParams('?seed=42').seed).toBe(42);
    expect(parseParams('?seed=-7').seed).toBe(-7);
    expect(parseParams('?seed=0').seed).toBe(0);
    expect(parseParams('?seed= 9 ').seed).toBe(9);
  });

  it('falls back to seed 1 for bad seeds', () => {
    for (const bad of ['abc', '1.5', '', '1e3', '0x10', 'NaN', 'Infinity', '99999999999999999999']) {
      expect(parseParams(`?seed=${encodeURIComponent(bad)}`).seed, bad).toBe(1);
    }
  });

  it('reads each scheme and falls back to tuck', () => {
    expect(parseParams('?scheme=tuck').scheme).toBe('tuck');
    expect(parseParams('?scheme=lift').scheme).toBe('lift');
    expect(parseParams('?scheme=swipe').scheme).toBe('swipe');
    expect(parseParams('?scheme=SWIPE').scheme).toBe('swipe');
    for (const bad of ['', 'tap', 'lifts', 'toString', '__proto__']) {
      expect(parseParams(`?scheme=${bad}`).scheme, bad).toBe('tuck');
    }
  });

  it('reads the crowd fixture counts as non-negative integers', () => {
    const p = parseParams('?horde=400&sparks=600');
    expect(p.horde).toBe(400);
    expect(p.sparks).toBe(600);
    expect(parseParams('?horde= 12 ').horde).toBe(12);
    expect(parseParams('?horde=+5').horde).toBe(5);
    expect(parseParams('?sparks=0').sparks).toBe(0);
    for (const bad of ['', '-3', '1.5', 'abc', '1e3', '0x10', 'Infinity', '99999999999999999999']) {
      expect(parseParams(`?horde=${encodeURIComponent(bad)}`).horde, bad).toBe(0);
      expect(parseParams(`?sparks=${encodeURIComponent(bad)}`).sparks, bad).toBe(0);
    }
  });

  it('reads the arsenal fixture as a flag, alone or with the crowd', () => {
    expect(parseParams('?arsenal').arsenal).toBe(true);
    expect(parseParams('?arsenal=0').arsenal).toBe(false);
    expect(parseParams('?hook').arsenal).toBe(false);
    const p = parseParams('?hook&arsenal&horde=120');
    expect(p.arsenal && p.hook).toBe(true);
    expect(p.horde).toBe(120);
  });

  it('ignores parameters it does not know and works without the leading ?', () => {
    const p = parseParams('foo=bar&seed=3&hook');
    expect(p.seed).toBe(3);
    expect(p.hook).toBe(true);
  });

  it('reads the lesson flags', () => {
    expect(parseParams('?lesson').lesson).toBe(true);
    expect(parseParams('?nolesson').nolesson).toBe(true);
    expect(parseParams('?hook').lesson).toBe(false);
    expect(parseParams('?lesson=0').lesson).toBe(false);
    expect(parseParams('?nolesson=off').nolesson).toBe(false);
  });
});
