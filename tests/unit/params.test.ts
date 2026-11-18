import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/app/params';

describe('parseParams', () => {
  it('has defaults for an empty query', () => {
    for (const q of ['', '?']) {
      expect(parseParams(q)).toEqual({ debug: false, hook: false, perf: false, flat: false, seed: 1, scheme: 'tuck' });
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

  it('ignores parameters it does not know and works without the leading ?', () => {
    const p = parseParams('foo=bar&seed=3&hook');
    expect(p.seed).toBe(3);
    expect(p.hook).toBe(true);
  });
});
