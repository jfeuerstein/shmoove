/**
 * The stop board's arrival memo (performance pass) gives exactly what the full timetable scan
 * gives, as time runs on, jumps, goes back and wraps past midnight.
 */
import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/sim/city/index';
import { DAY_TICKS } from '../../src/sim/constants';
import { arrivalTicks, arrivalTicksMemo } from '../../src/ui/timetable';

describe('arrival memo', () => {
  const lines = buildCity(1).world.lines;

  it('matches arrivalTicks for every stop of every line along a wandering clock', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let tick = DAY_TICKS - 3000;
    let finite = 0;
    for (let n = 0; n < 600; n++) {
      const r = rand();
      if (r < 0.8) tick += 1 + Math.floor(rand() * 40);
      else if (r < 0.9) tick -= Math.floor(rand() * 500);
      else tick = Math.floor(rand() * 3 * DAY_TICKS);
      for (const L of lines) {
        for (let s = 0; s < L.allStops.length; s++) {
          const want = arrivalTicks(L, s, tick);
          expect(arrivalTicksMemo(L, s, tick), `${L.id} stop ${s} tick ${tick}`).toBe(want);
          if (Number.isFinite(want)) finite++;
        }
      }
    }
    expect(finite).toBeGreaterThan(1000);
  });
});
