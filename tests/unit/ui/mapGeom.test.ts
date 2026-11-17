import { describe, expect, it } from 'vitest';
import { lineSegments } from '../../../src/sim/game/progress';
import { buildSlice } from '../../../src/sim/slice';
import { fitProjection, pointSegDist, polyBounds, project, simplify, subPath, type Poly } from '../../../src/ui/mapGeom';

const world = buildSlice(1);

/** Max distance of any point of `orig` from the polyline `simp`. */
function maxDeviation(orig: Poly, simp: Poly): number {
  let worst = 0;
  for (let i = 0; i < orig.length; i += 2) {
    let best = Infinity;
    for (let j = 0; j + 3 < simp.length; j += 2) {
      best = Math.min(best, pointSegDist(orig[i], orig[i + 1], simp[j], simp[j + 1], simp[j + 2], simp[j + 3]));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('polyline simplification', () => {
  it('keeps the endpoints and stays within tolerance', () => {
    // A noisy wave.
    const pts: Poly = [];
    for (let i = 0; i <= 200; i++) pts.push(i, Math.sin(i / 9) * 20 + ((i * 7919) % 13) / 13);
    for (const tol of [0.5, 3, 10]) {
      const s = simplify(pts, tol);
      expect(s.slice(0, 2)).toEqual(pts.slice(0, 2));
      expect(s.slice(-2)).toEqual(pts.slice(-2));
      expect(s.length).toBeLessThan(pts.length);
      expect(maxDeviation(pts, s)).toBeLessThanOrEqual(tol + 1e-9);
    }
  });

  it('collapses a straight run to its two ends and leaves tiny polylines alone', () => {
    expect(simplify([0, 0, 1, 1, 2, 2, 3, 3], 0.01)).toEqual([0, 0, 3, 3]);
    expect(simplify([5, 5], 1)).toEqual([5, 5]);
    expect(simplify([0, 0, 4, 0], 1)).toEqual([0, 0, 4, 0]);
  });

  it('simplifies real line paths, segment by segment, within 3 m', () => {
    for (const line of world.lines) {
      for (const g of lineSegments(line)) {
        const raw = subPath(line, g.s0, g.s1);
        const s = simplify(raw, 3);
        expect(s.slice(0, 2)).toEqual(raw.slice(0, 2));
        expect(s.slice(-2)).toEqual(raw.slice(-2));
        expect(maxDeviation(raw, s)).toBeLessThanOrEqual(3 + 1e-9);
      }
    }
  });
});

describe('map projection', () => {
  const allPolys = (): Poly[] => world.lines.flatMap((l) => lineSegments(l).map((g) => simplify(subPath(l, g.s0, g.s1), 3)));

  for (const [w, h] of [
    [320, 400],
    [390, 600],
    [430, 700],
    [700, 300],
  ]) {
    for (const stretch of [1, 3]) {
      it(`fits every line inside a ${w}x${h} box with the margin (stretch ${stretch})`, () => {
        const polys = allPolys();
        const m = 26;
        const pr = fitProjection(polyBounds(polys), w, h, m, stretch);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of polys) {
          for (let i = 0; i < p.length; i += 2) {
            const [x, y] = project(pr, p[i], p[i + 1]);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
        const eps = 1e-6;
        expect(minX).toBeGreaterThanOrEqual(m - eps);
        expect(maxX).toBeLessThanOrEqual(w - m + eps);
        expect(minY).toBeGreaterThanOrEqual(m - eps);
        expect(maxY).toBeLessThanOrEqual(h - m + eps);
        // It fills the box along at least one axis.
        expect(Math.max((maxX - minX) / (w - 2 * m), (maxY - minY) / (h - 2 * m))).toBeCloseTo(1, 6);
        if (stretch === 1) expect(pr.sx).toBe(pr.scale);
        else expect(pr.sx / pr.scale).toBeLessThanOrEqual(stretch + 1e-9);
      });
    }
  }

  it('puts uphill at the top and +x on the left, as the chase camera sees the city facing uphill', () => {
    const pr = fitProjection({ minX: -10, maxX: 10, minZ: 0, maxZ: 100 }, 200, 400, 10);
    expect(project(pr, 0, 100)[1]).toBeLessThan(project(pr, 0, 0)[1]);
    expect(project(pr, 10, 50)[0]).toBeLessThan(project(pr, -10, 50)[0]);
  });
});
