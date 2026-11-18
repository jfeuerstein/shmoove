import { describe, expect, it } from 'vitest';
import { BOWL_RADIUS, makeBowl, type Bowl } from '../../src/sim/bowl';
import type { Vec3 } from '../../src/sim/types';

const SEEDS = [1, 2, 3, 4, 5];
const FLOOR_R = 130;

const bowls = new Map<number, Bowl>();
const buildMs = new Map<number, number>();
function bowl(seed: number): Bowl {
  let b = bowls.get(seed);
  if (!b) {
    const t0 = performance.now();
    b = makeBowl(seed);
    buildMs.set(seed, performance.now() - t0);
    bowls.set(seed, b);
  }
  return b;
}

const n: Vec3 = { x: 0, y: 1, z: 0 };
/** Height gradient (dh/dx, dh/dz) from the terrain's normal. */
function grad(b: Bowl, x: number, z: number): [number, number] {
  b.normalAt(x, z, n);
  return [-n.x / n.y, -n.z / n.y];
}
function slope(b: Bowl, x: number, z: number): number {
  const [gx, gz] = grad(b, x, z);
  return Math.hypot(gx, gz);
}

/** Largest slope over a disc, on rings every `step` metres. */
function discSlope(b: Bowl, x: number, z: number, radius: number, step = 0.5): number {
  let worst = slope(b, x, z);
  for (let r = step; r <= radius + 1e-9; r += step) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI;
      worst = Math.max(worst, slope(b, x + r * Math.sin(a), z + r * Math.cos(a)));
    }
  }
  return worst;
}

function meanFloor(b: Bowl): number {
  let sum = 0;
  let count = 0;
  for (let x = -FLOOR_R; x <= FLOOR_R; x += 2) {
    for (let z = -FLOOR_R; z <= FLOOR_R; z += 2) {
      if (x * x + z * z >= FLOOR_R * FLOOR_R) continue;
      sum += b.heightAt(x, z);
      count++;
    }
  }
  return sum / count;
}

/** Distance from a point to a segment. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

describe('makeBowl', () => {
  it('is deterministic: the same seed gives bit-identical heights and features', () => {
    for (const seed of SEEDS) {
      const a = bowl(seed);
      const b = makeBowl(seed);
      expect(b.features).toEqual(a.features);
      expect(b.pads).toEqual(a.pads);
      expect([b.spawnX, b.spawnZ, b.spawnYaw]).toEqual([a.spawnX, a.spawnZ, a.spawnYaw]);
      for (let i = 0; i < 4000; i++) {
        const x = ((i * 7919) % 3400) / 10 - 170;
        const z = ((i * 104729) % 3400) / 10 - 170;
        expect(Object.is(b.heightAt(x, z), a.heightAt(x, z))).toBe(true);
      }
    }
  });

  it('gives different maps for different seeds', () => {
    for (let i = 0; i < SEEDS.length; i++) {
      for (let j = i + 1; j < SEEDS.length; j++) {
        const a = bowl(SEEDS[i]);
        const b = bowl(SEEDS[j]);
        let differ = 0;
        for (let x = -120; x <= 120; x += 10) {
          for (let z = -120; z <= 120; z += 10) if (Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) > 0.5) differ++;
        }
        expect(differ).toBeGreaterThan(100);
        expect(a.features.pipes[0].x0).not.toBe(b.features.pipes[0].x0);
      }
    }
  });

  it('builds in under 500 ms', () => {
    for (const seed of SEEDS) {
      bowl(seed);
      expect(buildMs.get(seed) ?? Infinity).toBeLessThan(500);
    }
    const t0 = performance.now();
    makeBowl(99);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('is finite everywhere within radius + 5 m, heights and normals', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(b.radius).toBe(BOWL_RADIUS);
      const R = BOWL_RADIUS + 5;
      for (let x = -R; x <= R; x += 1.3) {
        for (let z = -R; z <= R; z += 1.3) {
          if (x * x + z * z > R * R) continue;
          expect(Number.isFinite(b.heightAt(x, z))).toBe(true);
          b.normalAt(x, z, n);
          expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
          expect(n.y).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps the floor no steeper than a 0.9 slope', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      let worst = 0;
      for (let x = -FLOOR_R; x <= FLOOR_R; x += 0.5) {
        for (let z = -FLOOR_R; z <= FLOOR_R; z += 0.5) {
          if (x * x + z * z >= FLOOR_R * FLOOR_R) continue;
          worst = Math.max(worst, slope(b, x, z));
        }
      }
      expect(worst).toBeLessThan(0.9);
    }
  });

  it('has no creases: along scan lines in 0.1 m steps the slope never jumps by more than 0.08', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const lines: [number, number, number, number][] = [];
      // A grid of lines in both directions, offset off the 1 m sample lattice, plus diagonals.
      for (let c = -168.3; c <= 168; c += 8.4) {
        lines.push([-175, c, 1, 0], [c, -175, 0, 1]);
      }
      for (let c = -160; c <= 160; c += 20) lines.push([c - 120, -120, Math.SQRT1_2, Math.SQRT1_2]);
      // Every feature along its own line: pipes, kickers and the spawn ramp.
      for (const p of b.features.pipes) {
        const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
        const dx = (p.x1 - p.x0) / L;
        const dz = (p.z1 - p.z0) / L;
        for (const off of [0, 5, 10, 15]) lines.push([p.x0 - dx * 30 + dz * off, p.z0 - dz * 30 - dx * off, dx, dz]);
        lines.push([p.x0 + dx * L * 0.5 - dz * 45, p.z0 + dz * L * 0.5 + dx * 45, dz, -dx]);
      }
      for (const k of b.features.kickers) {
        const fx = Math.sin(k.yaw);
        const fz = Math.cos(k.yaw);
        lines.push([k.x - fx * 30, k.z - fz * 30, fx, fz], [k.x - fz * 20, k.z + fx * 20, fz, -fx]);
      }
      const fx = Math.sin(b.spawnYaw);
      const fz = Math.cos(b.spawnYaw);
      lines.push([b.spawnX - fx * 30, b.spawnZ - fz * 30, fx, fz]);
      let worst = 0;
      for (const [x0, z0, dx, dz] of lines) {
        let prev: [number, number] | null = null;
        for (let i = 0; i <= 3500; i++) {
          const x = x0 + dx * i * 0.1;
          const z = z0 + dz * i * 0.1;
          if (x * x + z * z > (BOWL_RADIUS + 5) * (BOWL_RADIUS + 5)) {
            prev = null;
            continue;
          }
          const g = grad(b, x, z);
          if (prev) worst = Math.max(worst, Math.hypot(g[0] - prev[0], g[1] - prev[1]));
          prev = g;
        }
      }
      expect(worst).toBeLessThan(0.08);
    }
  });

  it('rings the floor with a bank that rises at least 28 m and keeps rising, steepening to about 60 degrees', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const mean = meanFloor(b);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * 2 * Math.PI;
        const sx = Math.sin(a);
        const cz = Math.cos(a);
        expect(b.heightAt(sx * BOWL_RADIUS, cz * BOWL_RADIUS) - mean).toBeGreaterThanOrEqual(28);
        let prev = b.heightAt(sx * 135, cz * 135);
        for (let r = 135.5; r <= BOWL_RADIUS; r += 0.5) {
          const h = b.heightAt(sx * r, cz * r);
          expect(h).toBeGreaterThan(prev);
          prev = h;
        }
        // Steep at the top but never vertical: between 50 and 65 degrees.
        const top = slope(b, sx * BOWL_RADIUS, cz * BOWL_RADIUS);
        expect(top).toBeGreaterThan(Math.tan((50 * Math.PI) / 180));
        expect(top).toBeLessThan(Math.tan((65 * Math.PI) / 180));
      }
    }
  });

  it('sinks a crater about 35 m across and 9 m deep near the middle, with a raised lip', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const c = b.features.crater;
      expect(Math.hypot(c.x, c.z)).toBeLessThan(15);
      expect(c.radius).toBeGreaterThanOrEqual(30);
      expect(c.radius).toBeLessThanOrEqual(40);
      let outerMean = 0;
      let lipMean = 0;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * 2 * Math.PI;
        const sx = Math.sin(a);
        const cz = Math.cos(a);
        const outer = b.heightAt(c.x + sx * (c.radius + 12), c.z + cz * (c.radius + 12));
        let lip = -Infinity;
        for (let r = c.radius - 5; r <= c.radius + 5; r += 0.25) lip = Math.max(lip, b.heightAt(c.x + sx * r, c.z + cz * r));
        // Raised all the way round: the lip stands above the ground outside it.
        expect(lip - outer).toBeGreaterThan(0.3);
        outerMean += outer / 36;
        lipMean += (lip - outer) / 36;
      }
      const depth = outerMean - b.heightAt(c.x, c.z);
      expect(depth).toBeGreaterThan(8);
      expect(depth).toBeLessThan(10.5);
      expect(lipMean).toBeGreaterThan(1.4);
      expect(lipMean).toBeLessThan(3);
    }
  });

  it('cuts two half-pipes: 120 m or longer, about 16 m half-width and 7 m deep, falling evenly', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const c = b.features.crater;
      expect(b.features.pipes).toHaveLength(2);
      for (const p of b.features.pipes) {
        const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
        expect(L).toBeGreaterThanOrEqual(120);
        expect(p.halfWidth).toBeGreaterThanOrEqual(14);
        expect(p.halfWidth).toBeLessThanOrEqual(18);
        // On the floor, and off the centre: the axis passes well clear of the crater.
        expect(Math.hypot(p.x0, p.z0)).toBeLessThan(FLOOR_R);
        expect(Math.hypot(p.x1, p.z1)).toBeLessThan(FLOOR_R);
        expect(segDist(c.x, c.z, p.x0, p.z0, p.x1, p.z1)).toBeGreaterThan(c.radius + 20);
        const dx = (p.x1 - p.x0) / L;
        const dz = (p.z1 - p.z0) / L;
        const h0 = b.heightAt(p.x0, p.z0);
        const h1 = b.heightAt(p.x1, p.z1);
        expect((h0 - h1) / L).toBeGreaterThanOrEqual(0.06);
        let prev = Infinity;
        let depthSum = 0;
        let stations = 0;
        for (let s = 0; s <= L; s += 5) {
          const ax = p.x0 + dx * s;
          const az = p.z0 + dz * s;
          const axis = b.heightAt(ax, az);
          // The floor falls all the way along.
          expect(axis).toBeLessThan(prev);
          prev = axis;
          const left = b.heightAt(ax + dz * p.halfWidth, az - dx * p.halfWidth);
          const right = b.heightAt(ax - dz * p.halfWidth, az + dx * p.halfWidth);
          const depth = (left + right) / 2 - axis;
          expect(depth).toBeGreaterThan(5);
          expect(depth).toBeLessThan(9);
          // It is a trough: the axis is the lowest point across it.
          for (let t = -p.halfWidth; t <= p.halfWidth; t += 2) {
            expect(b.heightAt(ax + dz * t, az - dx * t)).toBeGreaterThanOrEqual(axis - 1);
          }
          depthSum += depth;
          stations++;
        }
        const meanDepth = depthSum / stations;
        expect(meanDepth).toBeGreaterThan(6);
        expect(meanDepth).toBeLessThan(8);
      }
    }
  });

  it('places 6 to 10 kickers where lines arrive: past each pipe, outside the crater lip, on the floor', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const { kickers, pipes, crater } = b.features;
      expect(kickers.length).toBeGreaterThanOrEqual(6);
      expect(kickers.length).toBeLessThanOrEqual(10);
      for (const p of pipes) {
        const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
        const dx = (p.x1 - p.x0) / L;
        const dz = (p.z1 - p.z0) / L;
        const atEnd = kickers.filter((k) => {
          const s = (k.x - p.x1) * dx + (k.z - p.z1) * dz;
          const t = (k.x - p.x1) * dz - (k.z - p.z1) * dx;
          return s > 0 && s < 60 && Math.abs(t) < 4 && Math.sin(k.yaw) * dx + Math.cos(k.yaw) * dz > 0.95;
        });
        expect(atEnd.length).toBeGreaterThanOrEqual(1);
      }
      const atLip = kickers.filter((k) => {
        const rx = k.x - crater.x;
        const rz = k.z - crater.z;
        const r = Math.hypot(rx, rz);
        return r > crater.radius && r < crater.radius + 35 && (Math.sin(k.yaw) * rx + Math.cos(k.yaw) * rz) / r > 0.95;
      });
      expect(atLip.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < kickers.length; i++) {
        const k = kickers[i];
        expect(Math.hypot(k.x, k.z)).toBeLessThan(125);
        for (let j = i + 1; j < kickers.length; j++) {
          expect(Math.hypot(k.x - kickers[j].x, k.z - kickers[j].z)).toBeGreaterThan(25);
        }
        const fx = Math.sin(k.yaw);
        const fz = Math.cos(k.yaw);
        // A raised table across its line...
        const sides = (b.heightAt(k.x + fz * 13, k.z - fx * 13) + b.heightAt(k.x - fz * 13, k.z + fx * 13)) / 2;
        const relief = b.heightAt(k.x, k.z) - sides;
        expect(relief).toBeGreaterThan(1);
        expect(relief).toBeLessThan(4.5);
        // ...whose ramp ends in a lip just behind the top: far sharper than any hill.
        let sharpest = 0;
        for (let q = -8; q <= 0; q += 0.25) {
          const h = (d: number): number => b.heightAt(k.x + fx * (q + d), k.z + fz * (q + d));
          sharpest = Math.min(sharpest, (h(1) - 2 * h(0) + h(-1)) / 1);
        }
        expect(sharpest).toBeLessThan(-0.12);
      }
    }
  });

  it('lays 6 to 10 boost pads of radius 2.5 m on gentle runs, none within 12 m of the spawn', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(b.pads.length).toBeGreaterThanOrEqual(6);
      expect(b.pads.length).toBeLessThanOrEqual(10);
      for (let i = 0; i < b.pads.length; i++) {
        const p = b.pads[i];
        expect(p.radius).toBe(2.5);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(FLOOR_R);
        expect(Math.hypot(p.x - b.spawnX, p.z - b.spawnZ)).toBeGreaterThan(12);
        expect(discSlope(b, p.x, p.z, p.radius, 0.25)).toBeLessThan(0.15);
        for (let j = i + 1; j < b.pads.length; j++) {
          expect(Math.hypot(p.x - b.pads[j].x, p.z - b.pads[j].z)).toBeGreaterThan(2 * p.radius);
        }
      }
    }
  });

  it('spawns 60 to 100 m from the centre on ground under 0.05 slope within 6 m, facing the centre', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const r = Math.hypot(b.spawnX, b.spawnZ);
      expect(r).toBeGreaterThanOrEqual(60);
      expect(r).toBeLessThanOrEqual(100);
      expect(discSlope(b, b.spawnX, b.spawnZ, 6, 0.25)).toBeLessThan(0.05);
      const facing = (Math.sin(b.spawnYaw) * -b.spawnX + Math.cos(b.spawnYaw) * -b.spawnZ) / r;
      expect(facing).toBeGreaterThan(Math.cos((15 * Math.PI) / 180));
    }
  });

  it('keeps a downhill close: from every floor point, ground 4 m lower (or a 4 m bank above a hollow) within 40 m', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      let lowerClose = 0;
      let total = 0;
      for (let x = -128; x <= 128; x += 4) {
        for (let z = -128; z <= 128; z += 4) {
          if (x * x + z * z >= 128 * 128) continue;
          const h = b.heightAt(x, z);
          let lo = Infinity;
          let hi = -Infinity;
          for (let rr = 2; rr <= 40; rr += 2) {
            const count = Math.ceil((2 * Math.PI * rr) / 3);
            for (let i = 0; i < count; i++) {
              const a = (i / count) * 2 * Math.PI;
              const v = b.heightAt(x + rr * Math.sin(a), z + rr * Math.cos(a));
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
          total++;
          if (lo <= h - 4) lowerClose++;
          // In a hollow nothing is lower, so its downhill is the bank around it: it must be close.
          else expect(hi).toBeGreaterThanOrEqual(h + 4);
        }
      }
      // And most of the floor has the drop right there.
      expect(lowerClose / total).toBeGreaterThan(0.8);
    }
  });
});
