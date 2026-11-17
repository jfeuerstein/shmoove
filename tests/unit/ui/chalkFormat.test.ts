import { describe, expect, it } from 'vitest';
import { CHALK_NAME_MAX, CHALK_PATH_STRIDE } from '../../../src/sim/game/chalk';
import { chalkClock, chalkDefaultName, chalkGap, chalkTime, ghostTicksAt, nearestPathIndex } from '../../../src/ui/chalkFormat';

describe('chalk times', () => {
  it('lengths read m:ss, floored to the second', () => {
    expect(chalkClock(0)).toBe('0:00');
    expect(chalkClock(59)).toBe('0:00');
    expect(chalkClock(60)).toBe('0:01');
    expect(chalkClock(8 * 60 + 30)).toBe('0:08');
    expect(chalkClock(125 * 60)).toBe('2:05');
    expect(chalkClock(4 * 3600)).toBe('4:00');
    expect(chalkClock(-5)).toBe('0:00');
  });

  it('race times read m:ss.t, floored to the tenth', () => {
    expect(chalkTime(0)).toBe('0:00.0');
    expect(chalkTime(5)).toBe('0:00.0');
    expect(chalkTime(6)).toBe('0:00.1');
    expect(chalkTime(479)).toBe('0:07.9');
    expect(chalkTime(480)).toBe('0:08.0');
    expect(chalkTime(61 * 60 + 30)).toBe('1:01.5');
  });

  it('the gap has one decimal and says behind with + and ahead with a minus', () => {
    expect(chalkGap(0)).toBe('0.0');
    expect(chalkGap(2)).toBe('0.0');
    expect(chalkGap(24)).toBe('+0.4');
    expect(chalkGap(-24)).toBe('−0.4');
    expect(chalkGap(90)).toBe('+1.5');
    expect(chalkGap(-600)).toBe('−10.0');
  });
});

describe('default names', () => {
  it('are the district and the clock, on the board in capitals', () => {
    expect(chalkDefaultName('Mercado Steps', 0.3)).toBe('MERCADO STEPS 07:10');
    expect(chalkDefaultName('Docks', 0.5)).toBe('DOCKS 12:00');
  });

  it('always fit a line name, cutting the district rather than the time', () => {
    const n = chalkDefaultName('An Extremely Long District Name Indeed', 0.75);
    expect(n.length).toBeLessThanOrEqual(CHALK_NAME_MAX);
    expect(n.endsWith(' 18:00')).toBe(true);
    expect(chalkDefaultName('', 0.5)).toBe('12:00');
  });
});

describe('ghost progress along a path', () => {
  // A path that goes out along +x and comes back along x again 2 m to the side (a hairpin).
  const pts: number[] = [];
  for (let i = 0; i <= 20; i++) pts.push(i, 0, 0);
  for (let i = 20; i >= 0; i--) pts.push(i, 0, 2);
  const path = Float32Array.from(pts);

  it('finds the nearest sample near the hint and follows a route that doubles back in order', () => {
    expect(nearestPathIndex(path, 5.2, 0.1, 0)).toBe(5);
    // On the way back, near x = 5 again: with the hint on the return leg it picks the return leg.
    expect(nearestPathIndex(path, 5.1, 1.6, 34)).toBe(36);
    // With a narrow window from the start it cannot jump to the return leg.
    expect(nearestPathIndex(path, 5.1, 1.6, 0, 20, 10)).toBe(5);
    expect(nearestPathIndex(new Float32Array(0), 0, 0, 3)).toBe(0);
  });

  it('turns a sample index into ghost time, capped at the ghost total', () => {
    expect(ghostTicksAt(10, 1000)).toBe(10 * CHALK_PATH_STRIDE);
    expect(ghostTicksAt(1000, 900)).toBe(900);
  });
});
