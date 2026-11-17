import { describe, expect, it } from 'vitest';
import { HALF_PI, PI, TAU, angleDiff, approachT, datan2, dcos, dsin, moveToward, wrapAngle } from '../../src/sim/math';
import { Rng, hashString } from '../../src/sim/rng';

describe('deterministic math', () => {
  it('dsin and dcos match the real functions closely over many turns', () => {
    let worst = 0;
    for (let i = -4000; i <= 4000; i++) {
      const x = i * 0.00517;
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it('datan2 matches the real function in every quadrant and on the axes', () => {
    let worst = 0;
    for (let i = -40; i <= 40; i++) {
      for (let j = -40; j <= 40; j++) {
        if (i === 0 && j === 0) continue;
        worst = Math.max(worst, Math.abs(datan2(i * 0.37, j * 0.91) - Math.atan2(i * 0.37, j * 0.91)));
      }
    }
    expect(worst).toBeLessThan(1e-9);
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(1, 0)).toBeCloseTo(HALF_PI, 12);
    expect(datan2(0, -1)).toBeCloseTo(PI, 12);
  });

  it('heading round-trips through sin/cos and atan2', () => {
    for (let h = -3; h <= 3; h += 0.25) expect(datan2(dsin(h), dcos(h))).toBeCloseTo(h, 8);
  });

  it('wrapAngle and angleDiff stay in [-PI, PI)', () => {
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-TAU - 0.5)).toBeCloseTo(-0.5, 12);
    expect(angleDiff(3, -3)).toBeCloseTo(6 - TAU, 12);
    for (let a = -20; a < 20; a += 0.7) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-PI);
      expect(w).toBeLessThan(PI);
    }
  });

  it('approachT and moveToward never overshoot', () => {
    expect(approachT(1000, 1 / 60)).toBeLessThan(1);
    expect(approachT(0, 1 / 60)).toBe(0);
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(9, 10, 3)).toBe(10);
    expect(moveToward(0, -10, 3)).toBe(-3);
  });
});

describe('Rng', () => {
  it('is reproducible from its seed and differs between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const xs = Array.from({ length: 50 }, () => a.next());
    const ys = Array.from({ length: 50 }, () => b.next());
    const zs = Array.from({ length: 50 }, () => c.next());
    expect(xs).toEqual(ys);
    expect(xs).not.toEqual(zs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('forks into independent streams without advancing the parent', () => {
    const a = new Rng(7);
    const f1 = a.fork('city').next();
    const f2 = a.fork('city').next();
    const g = a.fork('rides').next();
    expect(f1).toBe(f2);
    expect(f1).not.toBe(g);
    expect(new Rng(7).next()).toBe(a.next());
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('int and range respect their bounds', () => {
    const r = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const n = r.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      const f = r.range(-2, 5);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(5);
    }
  });
});
