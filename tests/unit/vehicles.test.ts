import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compileLine, type CompiledLine, type RideKind } from '../../src/sim/lines';
import { LINEUP_RIDES, LIVERIES } from '../../src/sim/lineup';
import { buildVehicleGeometry, vehicleVariants } from '../../src/render/vehicles';
import { testLine } from '../sim/helpers';

const ALL_KINDS: RideKind[] = [
  'tram', 'funicular', 'forklift', 'truck', 'crane', 'moped', 'handcart', 'parade', 'bus', 'cablecar', 'kite', 'blimp', 'ghosttram',
];
const ANIMATED: RideKind[] = ['forklift', 'moped', 'handcart', 'parade', 'kite', 'blimp'];
const BIG: RideKind[] = ['parade', 'blimp'];

/** The line-up's proposal for each ride, as a test line (the king kite included as its own case). */
function rideLines(): CompiledLine[] {
  return LINEUP_RIDES.map((r, i) =>
    compileLine(
      testLine({
        id: r.id,
        kind: r.kind,
        overhead: r.overhead,
        anchorBack: r.anchorBack,
        anchorY: r.anchorY,
        hang: r.hang,
        rope: r.rope,
        bodyHalfLen: r.bodyHalfLen,
        bodyHalfWid: r.bodyHalfWid,
        bodyHeight: r.bodyHeight,
        minChain: r.minChain,
        name: r.name,
        livery: LIVERIES[r.id],
      }),
      i,
    ),
  );
}

function tris(g: THREE.BufferGeometry): number {
  const idx = g.getIndex();
  return idx ? idx.count / 3 : g.getAttribute('position').count / 3;
}

/** Distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriDist(p: number[], a: number[], b: number[], c: number[]): number {
  const sub = (u: number[], v: number[]): number[] => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const at = (q: number[]): number => Math.sqrt(dot(sub(p, q), sub(p, q)));
  const lerp3 = (u: number[], v: number[], t: number): number[] => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t];
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(lerp3(a, b, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(lerp3(a, c, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(lerp3(b, c, (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

function nearestSurface(g: THREE.BufferGeometry, p: number[]): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const n = idx ? idx.count : pos.count;
  const v = (i: number): number[] => {
    const k = idx ? idx.getX(i) : i;
    return [pos.getX(k), pos.getY(k), pos.getZ(k)];
  };
  let best = Infinity;
  for (let i = 0; i < n; i += 3) best = Math.min(best, pointTriDist(p, v(i), v(i + 1), v(i + 2)));
  return best;
}

function sameGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  const pa = a.getAttribute('position').array;
  const pb = b.getAttribute('position').array;
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
  return true;
}

describe('vehicle geometry', () => {
  const lines = rideLines();

  it('the line-up covers every ride kind', () => {
    const kinds = new Set(lines.map((l) => l.kind));
    for (const k of ALL_KINDS) expect(kinds.has(k), k).toBe(true);
  });

  for (const line of rideLines()) {
    describe(`${line.id} (${line.kind}${line.minChainN > 1 ? ', king' : ''})`, () => {
      const n = vehicleVariants(line);
      const geos = Array.from({ length: n }, (_, v) => buildVehicleGeometry(line, v));

      it('has matching, finite position and colour attributes in every variant', () => {
        for (const g of geos) {
          const pos = g.getAttribute('position');
          const col = g.getAttribute('color');
          expect(pos.count).toBeGreaterThan(0);
          expect(col.count).toBe(pos.count);
          for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
          for (let i = 0; i < col.array.length; i++) {
            expect(col.array[i]).toBeGreaterThanOrEqual(0);
            expect(col.array[i]).toBeLessThanOrEqual(1);
          }
          const glow = g.getAttribute('glow');
          if (glow) expect(glow.count).toBe(pos.count);
        }
      });

      it('stays within its triangle budget', () => {
        const budget = BIG.includes(line.kind) ? 1200 : 700;
        for (const g of geos) expect(tris(g)).toBeLessThanOrEqual(budget);
      });

      it('has a handle exactly where the hand grabs it', () => {
        const grab = [0, line.anchorY - line.hang, -line.anchorBack];
        for (const g of geos) {
          g.computeBoundingBox();
          const bb = g.boundingBox;
          expect(bb).not.toBeNull();
          if (!bb) return;
          expect(grab[0]).toBeGreaterThanOrEqual(bb.min.x - 0.3);
          expect(grab[1]).toBeGreaterThanOrEqual(bb.min.y - 0.3);
          expect(grab[2]).toBeGreaterThanOrEqual(bb.min.z - 0.3);
          expect(grab[0]).toBeLessThanOrEqual(bb.max.x + 0.3);
          expect(grab[1]).toBeLessThanOrEqual(bb.max.y + 0.3);
          expect(grab[2]).toBeLessThanOrEqual(bb.max.z + 0.3);
          expect(nearestSurface(g, grab)).toBeLessThan(0.3);
        }
      });

      if (!line.overhead) {
        it('stays inside its lane and above the road', () => {
          for (const g of geos) {
            g.computeBoundingBox();
            const bb = g.boundingBox;
            if (!bb) throw new Error('no bounding box');
            expect(Math.max(-bb.min.x, bb.max.x)).toBeLessThanOrEqual(line.bodyHalfWid + 0.5);
            expect(bb.min.y).toBeGreaterThanOrEqual(-1e-4);
          }
        });
      }

      if (ANIMATED.includes(line.kind)) {
        it('animates: different frames differ, the same frame is the same', () => {
          expect(n).toBeGreaterThanOrEqual(2);
          for (let v = 0; v < n; v++) {
            expect(sameGeometry(geos[v], geos[(v + 1) % n])).toBe(false);
            expect(sameGeometry(geos[v], buildVehicleGeometry(line, v))).toBe(true);
            expect(sameGeometry(geos[v], buildVehicleGeometry(line, v + n))).toBe(true);
          }
        });
      } else if (line.kind !== 'funicular') {
        it('is static: one variant', () => {
          expect(n).toBe(1);
        });
      }
    });
  }

  it('the funicular has a climbing and a descending step, mirror images of each other', () => {
    const funi = lines.find((l) => l.kind === 'funicular');
    if (!funi) throw new Error('no funicular');
    expect(vehicleVariants(funi)).toBe(2);
    const up = buildVehicleGeometry(funi, 0);
    const down = buildVehicleGeometry(funi, 1);
    expect(sameGeometry(up, down)).toBe(false);
    // Climbing, the front compartment roof sits lower in the track frame (so it is level on the hill).
    const roofAt = (g: THREE.BufferGeometry, zMin: number, zMax: number): number => {
      const pos = g.getAttribute('position');
      let top = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        if (z > zMin && z < zMax) top = Math.max(top, pos.getY(i));
      }
      return top;
    };
    const L = funi.bodyHalfLen;
    expect(roofAt(up, L * 0.75, L)).toBeLessThan(roofAt(up, -L, -L * 0.75));
    expect(roofAt(down, L * 0.75, L)).toBeGreaterThan(roofAt(down, -L, -L * 0.75));
  });

  it('the king kite is much bigger than a plain kite', () => {
    const plain = lines.find((l) => l.kind === 'kite' && l.minChainN === 1);
    const king = lines.find((l) => l.kind === 'kite' && l.minChainN > 1);
    if (!plain || !king) throw new Error('kites missing');
    const width = (g: THREE.BufferGeometry): number => {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      return bb ? bb.max.x - bb.min.x : 0;
    };
    expect(width(buildVehicleGeometry(king, 0))).toBeGreaterThan(1.8 * width(buildVehicleGeometry(plain, 0)));
  });
});

describe('liveries', () => {
  /** DESIGN section 7 inks. */
  const PALETTE = [0xffae1a, 0xff2e88, 0x00a99d, 0x1f3fbf, 0xd9d2c3, 0xf3ebdd, 0x1b1a2e];
  /**
   * A livery colour counts as "of the palette" when its nearest ink is within this RGB distance
   * (Euclidean over 0..255 channels): generous enough for a light mix, far below the ~150 that
   * separates the inks from each other.
   */
  const MAX_INK_DIST = 48;
  const dist = (a: number, b: number): number => {
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
    const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
    const db = (a & 255) - (b & 255);
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  it('there is one per line-up ride, sixteen in all', () => {
    expect(Object.keys(LIVERIES).sort()).toEqual(LINEUP_RIDES.map((r) => r.id).sort());
    expect(Object.keys(LIVERIES)).toHaveLength(16);
  });

  it('no two lines share a base colour and pattern', () => {
    const seen = new Set<string>();
    for (const [id, l] of Object.entries(LIVERIES)) {
      const key = `${l.base}:${l.pattern}`;
      expect(seen.has(key), `${id} repeats ${key}`).toBe(false);
      seen.add(key);
      expect(l.pattern).toBeGreaterThanOrEqual(0);
      expect(l.pattern).toBeLessThanOrEqual(5);
      expect(Number.isInteger(l.pattern)).toBe(true);
    }
  });

  it('every livery colour is a palette ink or close to one', () => {
    for (const [id, l] of Object.entries(LIVERIES)) {
      for (const c of [l.base, l.stripe, l.accent]) {
        const near = Math.min(...PALETTE.map((p) => dist(c, p)));
        expect(near, `${id} colour ${c.toString(16)}`).toBeLessThanOrEqual(MAX_INK_DIST);
      }
    }
  });

  it('a line\'s stripe and roof mark stand out from its base', () => {
    for (const [id, l] of Object.entries(LIVERIES)) {
      expect(dist(l.base, l.stripe), `${id} stripe`).toBeGreaterThan(100);
      expect(dist(l.base, l.accent), `${id} accent`).toBeGreaterThan(100);
    }
  });
});
