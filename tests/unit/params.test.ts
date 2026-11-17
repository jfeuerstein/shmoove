import { describe, expect, it } from 'vitest';
import { parseParams } from '../../src/app/params';

describe('parseParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parseParams('')).toEqual({
      e2e: false,
      debug: false,
      slice: false,
      world: null,
      route: null,
      seed: 1,
      t: null,
      mute: false,
    });
  });

  it('treats bare keys as set flags, with or without the leading ?', () => {
    const p = parseParams('?e2e&mute&debug&slice');
    expect(p.e2e).toBe(true);
    expect(p.mute).toBe(true);
    expect(p.debug).toBe(true);
    expect(p.slice).toBe(true);
    expect(parseParams('e2e').e2e).toBe(true);
  });

  it('reads a named world, and treats an empty one as unset', () => {
    expect(parseParams('?world=lineup').world).toBe('lineup');
    expect(parseParams('?world=').world).toBe(null);
  });

  it('lets a flag be switched off explicitly', () => {
    expect(parseParams('?debug=0').debug).toBe(false);
    expect(parseParams('?mute=false').mute).toBe(false);
    expect(parseParams('?mute=1').mute).toBe(true);
  });

  it('reads route as a string and treats an empty route as none', () => {
    expect(parseParams('?route=perf').route).toBe('perf');
    expect(parseParams('?route=').route).toBeNull();
  });

  it('parses integer seeds and falls back to 1 on junk', () => {
    expect(parseParams('?seed=42').seed).toBe(42);
    expect(parseParams('?seed=-7').seed).toBe(-7);
    expect(parseParams('?seed=abc').seed).toBe(1);
    expect(parseParams('?seed=1.5').seed).toBe(1);
    expect(parseParams('?seed=').seed).toBe(1);
  });

  it('parses t as a day fraction, wrapping into [0, 1)', () => {
    expect(parseParams('?t=0.25').t).toBe(0.25);
    expect(parseParams('?t=1.75').t).toBe(0.75);
    expect(parseParams('?t=-0.25').t).toBe(0.75);
    expect(parseParams('?t=noon').t).toBeNull();
    expect(parseParams('?t=').t).toBeNull();
  });

  it('combines e2e with route params the way the e2e runner builds them', () => {
    const p = parseParams('?e2e&mute&route=perf&seed=9&t=0.5');
    expect(p).toMatchObject({ e2e: true, mute: true, route: 'perf', seed: 9, t: 0.5 });
  });
});
