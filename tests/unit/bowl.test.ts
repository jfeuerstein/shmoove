import { describe, expect, it } from 'vitest';
import { BOWL_RADIUS, makeBowl, type Bowl, type RailSite, type Site, type SiteKind } from '../../src/sim/bowl';
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

/**
 * Heights recorded from the generator before the map's sites were added to it, at the points
 * `heightProbe(i)` for i in 0..59. Choosing the sites must never move the ground.
 */
const HEIGHTS_BEFORE_SITES: Record<number, number[]> = {
  1: [52.44522476489648, 9.157420155727749, 76.73865856335338, 35.17226142255189, 6.272539509467918, 38.58981090373135, 5.110287607705434, 28.03319867735187, 89.1996706117119, 10.598258706254459, 34.764148202706515, 2.670743566551963, 13.628396703529479, 86.979408016386, 15.145223724398328, 40.36434312658092, 3.1836606251440385, 3.4747400461687628, 48.03129767494965, 39.085895000236434, 57.96356099974565, 5.021047518940769, 5.170187470154703, 28.796189694627632, 18.894664297402137, 93.1124977150139, 8.874010857484082, 3.335324374442836, 21.790859419468756, 6.8540061067161675, 143.4596283824314, 15.957672342116135, 5.820231711026023, 21.608879132111714, 1.7958357700537593, 67.95424236105123, 42.5462976422025, 6.741915854492586, 28.05922553502793, 1.5763479053847775, 27.138742598485535, 70.08687926911524, 14.396085266535042, 46.293875375838454, -0.9560739868786078, 15.016959181048867, 31.632137974883555, 31.995587428684942, 83.76522151962686, 2.017316270916097, 10.362857038132985, 16.834175678163906, 29.632416843547187, 134.91911709645402, 1.6608346689762545, 8.967571494062055, 13.440580361158931, 12.819884854057092, 191.5402042757769, 7.6617964151569975],
  2: [52.44522476489648, 8.606160556589407, 76.73865856335338, 35.17226142255189, 3.5462303790236955, 38.58981090373135, -0.42020517058200735, 28.03319867735187, 89.1996706117119, 9.010744751716796, 34.764148202706515, 2.804463132654458, 10.677583172742915, 86.979408016386, 15.127306176563147, 40.36434312658092, 2.9076505367819765, 8.278639422060763, 48.03129767494965, 39.085895000236434, 57.96356099974565, 3.737079350647747, 5.751337492026768, 28.796189694627632, 18.894664297402137, 93.1124977150139, 9.539557015479208, 1.7798184936412107, 21.790859419468756, 10.399733132186025, 143.4596283824314, 15.839956617933094, 3.1372285776019204, 21.608879132111714, -0.8656786171057235, 67.95424236105123, 42.5462976422025, 3.1943060681235793, 28.05922553502793, 2.6154933082194107, 27.138742598485535, 70.08687926911524, 14.426019394653858, 46.293875375838454, -1.7447330854041732, 14.545591341537925, 31.632137974883555, 31.995587428684942, 83.76522151962686, 2.27851940686396, 11.309113526105238, 16.834175678163906, 29.632416843547187, 134.91911709645402, 7.084300044661608, 10.854534429920673, 13.396808543864001, 13.050203661630787, 191.5402042757769, 11.920703793192075],
  3: [52.44522476489648, 9.382563632723736, 76.73865856335338, 35.17226142255189, 1.4838422142983594, 38.58981090373135, 5.582479359600622, 28.03319867735187, 89.1996706117119, 8.632308038099882, 34.764148202706515, 5.848173430948424, 13.741637255734254, 86.979408016386, 14.665040544251063, 40.36434312658092, 2.7478578652106083, 9.784875997931834, 48.03129767494965, 39.085895000236434, 57.96356099974565, -1.7799210490626949, 7.106707891127648, 28.796189694627632, 18.894664297402137, 93.1124977150139, 9.832291870812819, 5.513060279134749, 21.790859419468756, 10.20188009199911, 143.4596283824314, 15.957672415925922, 5.347182094839294, 21.608879132111714, 3.4386338013844986, 67.95424236105123, 42.5462976422025, 10.125202506978443, 28.05922553502793, 1.7634633010558527, 27.138742598485535, 70.08687926911524, 14.442286426982136, 46.293875375838454, -0.6748670708951814, 14.598915240918483, 31.632137974883555, 31.995587428684942, 83.76522151962686, 1.723517482542804, 8.606322891495717, 16.834175678163906, 29.632416843547187, 134.91911709645402, 0.9683016968918786, 8.772990199824543, 12.980483245534018, 12.996186158947172, 191.5402042757769, 11.710436403013558],
  4: [52.44522476489648, 5.729919558599242, 76.73865856335338, 35.17226142255189, 8.412896720772876, 38.58981090373135, 4.714100719646899, 28.03319867735187, 89.1996706117119, 9.419644096591854, 34.764148202706515, 2.950710232171909, 13.622366397344912, 86.979408016386, 14.740497006589965, 40.36434312658092, 2.996362925133412, -1.4734600648076526, 48.03129767494965, 39.085895000236434, 57.96356099974565, 0.5371324266182166, 5.085192806276905, 28.796189694627632, 18.894664297402137, 93.1124977150139, 9.444983730813425, 3.3921437307972697, 21.790859419468756, 12.461112908190243, 143.4596283824314, 15.957671999427832, 4.3257955724022255, 21.608879132111714, 7.066076822808234, 67.95424236105123, 42.5462976422025, 9.117690027552387, 28.05922553502793, 2.55643672843064, 27.138742598485535, 70.08687926911524, 14.442286426982136, 46.293875375838454, -1.637619307717412, 14.545591242698872, 31.632137974883555, 31.995587428684942, 83.76522151962686, 3.374068422030973, 10.347781028955282, 16.834175678163906, 29.632416843547187, 134.91911709645402, 0.7780679913728589, 8.883200601936496, 13.582435781842602, 12.994786904585549, 191.5402042757769, 11.254376603837871],
  5: [52.44522476489648, 8.16058915023228, 76.73865856335338, 35.17226142255189, 3.148997646536616, 38.58981090373135, -0.0292908351958089, 28.03319867735187, 89.1996706117119, 5.382373673088764, 34.764148202706515, 2.786659518818063, 9.190125977548503, 86.979408016386, 15.133577335451864, 40.36434312658092, 3.4705524288825482, 8.2537212808884, 48.03129767494965, 39.085895000236434, 57.96356099974565, 5.165246061930859, 8.788022755353975, 28.796189694627632, 18.894664297402137, 93.1124977150139, 11.427114692199478, 4.19590696706931, 21.790859419468756, 10.3635741186466, 143.4596283824314, 15.957672381036838, 2.1897307213402613, 21.608879132111714, -1.0144407023306994, 67.95424236105123, 42.5462976422025, 9.508876320919349, 28.05922553502793, 3.3173857582864548, 27.138742598485535, 70.08687926911524, 14.443005597510114, 46.293875375838454, -2.0348928378834663, 14.545591242698872, 31.632137974883555, 31.995587428684942, 83.76522151962686, 3.3583180078248263, 11.969905451649115, 16.834175678163906, 29.632416843547187, 134.91911709645402, 4.539784736898148, 8.748848628132423, 13.386604663444718, 13.008942695412578, 191.5402042757769, 10.687270096008632],
};

function heightProbe(i: number): [number, number] {
  return [((i * 7907) % 3300) / 10 - 165 + 0.37, ((i * 6007 + 1301) % 3300) / 10 - 165 + 0.61];
}

function sitesOf(b: Bowl, kind: SiteKind): Site[] {
  return b.features.sites.filter((s) => s.kind === kind);
}

/** Distance from a point to the nearest pipe axis or the crater's edge. */
function offCircuit(b: Bowl, x: number, z: number): number {
  const c = b.features.crater;
  let d = Math.hypot(x - c.x, z - c.z) - c.radius;
  for (const p of b.features.pipes) d = Math.min(d, segDist(x, z, p.x0, p.z0, p.x1, p.z1));
  return d;
}

describe('the sites of the things on the map', () => {
  it('leave the ground exactly as it was before there were sites', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const want = HEIGHTS_BEFORE_SITES[seed];
      expect(want).toHaveLength(60);
      for (let i = 0; i < want.length; i++) {
        const [x, z] = heightProbe(i);
        expect(Object.is(b.heightAt(x, z), want[i])).toBe(true);
      }
    }
  });

  it('are the same for the same seed and differ between seeds', () => {
    for (const seed of SEEDS) expect(makeBowl(seed).features.sites).toEqual(bowl(seed).features.sites);
    expect(bowl(1).features.sites).not.toEqual(bowl(2).features.sites);
  });

  it('come in the right numbers: 12 crates, 2 gold, 2 shrines, 2 slaloms of 5 gates, a hoop for each of up to 4 kickers, 2 totems', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(sitesOf(b, 'crate')).toHaveLength(12);
      expect(sitesOf(b, 'gold')).toHaveLength(2);
      expect(sitesOf(b, 'shrine')).toHaveLength(2);
      expect(sitesOf(b, 'totem')).toHaveLength(2);
      const gates = sitesOf(b, 'gate');
      expect(gates).toHaveLength(10);
      const groups = [...new Set(gates.map((g) => g.group))];
      expect(groups).toHaveLength(2);
      for (const g of groups) {
        expect(g).toBeGreaterThan(0);
        expect(gates.filter((s) => s.group === g)).toHaveLength(5);
      }
      const hoops = sitesOf(b, 'hoop').length;
      expect(hoops).toBeGreaterThanOrEqual(1);
      expect(hoops).toBeLessThanOrEqual(Math.min(4, b.features.kickers.length));
      // Only gates belong to a group.
      for (const s of b.features.sites) if (s.kind !== 'gate') expect(s.group).toBe(0);
    }
  });

  it('stand on the floor, on slope under 0.35, at least 14 m from the spawn, the pads and each other', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const sites = b.features.sites;
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        expect(Math.hypot(s.x, s.z)).toBeLessThan(125);
        // A hoop hangs in the air over a kicker's landing: the ground it answers for is the kicker's top.
        const [gx, gz] = s.kind === 'hoop' ? [s.x - Math.sin(s.yaw) * 5, s.z - Math.cos(s.yaw) * 5] : [s.x, s.z];
        expect(slope(b, gx, gz)).toBeLessThan(0.35);
        expect(Math.hypot(s.x - b.spawnX, s.z - b.spawnZ)).toBeGreaterThanOrEqual(14);
        for (const p of b.pads) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThanOrEqual(14);
        for (let j = i + 1; j < sites.length; j++) {
          const o = sites[j];
          if (s.group !== 0 && s.group === o.group) continue;
          expect({ seed, a: s.kind, b: o.kind, apart: Math.hypot(s.x - o.x, s.z - o.z) >= 14 }).toEqual({
            seed,
            a: s.kind,
            b: o.kind,
            apart: true,
          });
        }
      }
    }
  });

  it('keep crates 25 m apart, at least half of them more than 20 m off the pipes and the crater', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const crates = [...sitesOf(b, 'crate'), ...sitesOf(b, 'gold')];
      for (let i = 0; i < crates.length; i++) {
        for (let j = i + 1; j < crates.length; j++) {
          expect(Math.hypot(crates[i].x - crates[j].x, crates[i].z - crates[j].z)).toBeGreaterThanOrEqual(25);
        }
      }
      const off = crates.filter((c) => offCircuit(b, c.x, c.z) > 20).length;
      expect(off).toBeGreaterThanOrEqual(crates.length / 2);
    }
  });

  it('give each shrine open ground with room for a 7 m circle round it', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      for (const s of sitesOf(b, 'shrine')) {
        expect(discSlope(b, s.x, s.z, 7)).toBeLessThan(0.35);
        for (const p of b.pads) expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThan(7 + p.radius);
        for (const k of b.features.kickers) expect(Math.hypot(s.x - k.x, s.z - k.z)).toBeGreaterThan(7);
        // Not in a pipe nor on the crater's lip.
        expect(offCircuit(b, s.x, s.z)).toBeGreaterThan(7);
      }
    }
  });

  it('lay each slalom as 5 gates 18 m apart down a line that falls on average, alternating 3 m either side, facing along it', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const gates = sitesOf(b, 'gate');
      for (const g of new Set(gates.map((s) => s.group))) {
        const line = gates.filter((s) => s.group === g);
        const yaw = line[0].yaw;
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        // The line's own points: each gate's centre moved back across onto the line.
        const across = line.map((s) => (s.x - line[0].x) * fz - (s.z - line[0].z) * fx);
        const along = line.map((s) => (s.x - line[0].x) * fx + (s.z - line[0].z) * fz);
        for (let k = 0; k < line.length; k++) {
          expect(line[k].yaw).toBe(yaw);
          expect(along[k]).toBeCloseTo(18 * k, 6);
          // Alternating: every other gate 6 m across from the one before, back and forth.
          if (k > 0) expect(Math.abs(across[k] - across[k - 1])).toBeCloseTo(6, 6);
          if (k > 1) expect(across[k]).toBeCloseTo(across[k - 2], 6);
        }
        const mid = across[1] / 2;
        const onLine = (k: number): [number, number] => [line[0].x + fz * mid + fx * 18 * k, line[0].z - fx * mid + fz * 18 * k];
        for (let k = 0; k < line.length; k++) {
          expect(Math.abs(across[k] - mid)).toBeCloseTo(3, 6);
        }
        const [x0, z0] = onLine(0);
        const [x4, z4] = onLine(4);
        expect(b.heightAt(x0, z0)).toBeGreaterThan(b.heightAt(x4, z4));
      }
    }
  });

  it('hang each hoop over a kicker: 5 m past its top along its line, facing the way it is ridden', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const used = new Set<number>();
      for (const h of sitesOf(b, 'hoop')) {
        const k = b.features.kickers.findIndex(
          (kk) => Math.hypot(kk.x + Math.sin(kk.yaw) * 5 - h.x, kk.z + Math.cos(kk.yaw) * 5 - h.z) < 1e-6,
        );
        expect(k).toBeGreaterThanOrEqual(0);
        expect(used.has(k)).toBe(false);
        used.add(k);
        expect(h.yaw).toBe(b.features.kickers[k].yaw);
      }
    }
  });

  it('keep the two totems at least 60 m apart', () => {
    for (const seed of SEEDS) {
      const [a, c] = sitesOf(bowl(seed), 'totem');
      expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThanOrEqual(60);
    }
  });
});

/**
 * FNV-1a over the JSON of each seed's sites and pads, recorded before the map had rails. Choosing
 * the rails must never move what was already there.
 */
const SITES_BEFORE_RAILS: Record<number, { sites: string; pads: string }> = {
  1: { sites: '8cdfc0bb', pads: '1296ade0' },
  2: { sites: 'd9842aca', pads: 'a2f89278' },
  3: { sites: '6d90959f', pads: '929fc65e' },
  4: { sites: 'a2929c0b', pads: '8d97dc08' },
  5: { sites: 'a502ec67', pads: '7d277a24' },
};

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const LIFT = 1.2;
const RUN_UP = 3;
type Seg = [number, number, number, number];

function railLen(r: RailSite): number {
  return Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
}

/** The rail with 3 m carried on beyond each end. */
function withRunUps(r: RailSite): Seg {
  const l = railLen(r);
  const ux = ((r.x1 - r.x0) / l) * RUN_UP;
  const uz = ((r.z1 - r.z0) / l) * RUN_UP;
  return [r.x0 - ux, r.z0 - uz, r.x1 + ux, r.z1 + uz];
}

/** Least distance between two segments, by walking one in 5 cm steps against the other. */
function segSegDist(a: Seg, b: Seg): number {
  let best = Infinity;
  const n = Math.ceil(Math.hypot(a[2] - a[0], a[3] - a[1]) / 0.05);
  for (let k = 0; k <= n; k++) {
    const q = k / n;
    best = Math.min(best, segDist(a[0] + (a[2] - a[0]) * q, a[1] + (a[3] - a[1]) * q, b[0], b[1], b[2], b[3]));
  }
  return best;
}

/** Height lost from the first end to the second, per metre of length. */
function fallOf(b: Bowl, r: RailSite): number {
  return (b.heightAt(r.x0, r.z0) - b.heightAt(r.x1, r.z1)) / railLen(r);
}

function chainsOf(b: Bowl): RailSite[][] {
  const ids = [...new Set(b.features.rails.filter((r) => r.chain > 0).map((r) => r.chain))];
  return ids.map((c) => b.features.rails.filter((r) => r.chain === c));
}

describe('the rails', () => {
  it('leave the ground, the sites and the pads exactly as they were before there were rails', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(fnv(JSON.stringify(b.features.sites))).toBe(SITES_BEFORE_RAILS[seed].sites);
      expect(fnv(JSON.stringify(b.pads))).toBe(SITES_BEFORE_RAILS[seed].pads);
    }
  });

  it('are the same for the same seed and differ between seeds', () => {
    for (const seed of SEEDS) {
      const again = makeBowl(seed);
      expect(again.features.rails).toEqual(bowl(seed).features.rails);
      expect(again.rails).toEqual(bowl(seed).rails);
    }
    expect(bowl(1).features.rails).not.toEqual(bowl(2).features.rails);
  });

  it('number 8 to 12, each a straight bar 14 to 32 m long standing 1.2 m above the ground at both ends', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(b.rails.length).toBeGreaterThanOrEqual(8);
      expect(b.rails.length).toBeLessThanOrEqual(12);
      expect(b.features.rails).toHaveLength(b.rails.length);
      b.features.rails.forEach((r, i) => {
        const bar = b.rails[i];
        expect([bar.x0, bar.z0, bar.x1, bar.z1]).toEqual([r.x0, r.z0, r.x1, r.z1]);
        expect(bar.y0).toBeCloseTo(b.heightAt(r.x0, r.z0) + LIFT, 9);
        expect(bar.y1).toBeCloseTo(b.heightAt(r.x1, r.z1) + LIFT, 9);
        expect(railLen(r)).toBeGreaterThanOrEqual(14);
        expect(railLen(r)).toBeLessThanOrEqual(32);
      });
    }
  });

  it('stand on the floor, with the ground under them 0.7 to 2.4 m below along their whole length', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      b.features.rails.forEach((r, i) => {
        const bar = b.rails[i];
        const [ax, az, cx, cz] = withRunUps(r);
        expect(Math.hypot(ax, az)).toBeLessThan(125);
        expect(Math.hypot(cx, cz)).toBeLessThan(125);
        const len = railLen(r);
        for (let d = 0; d <= len; d += 1) {
          const q = d / len;
          const under = bar.y0 + (bar.y1 - bar.y0) * q - b.heightAt(r.x0 + (r.x1 - r.x0) * q, r.z0 + (r.z1 - r.z0) * q);
          expect(under, `seed ${seed} rail ${i} at ${d} m`).toBeGreaterThanOrEqual(0.7 - 1e-9);
          expect(under, `seed ${seed} rail ${i} at ${d} m`).toBeLessThanOrEqual(2.4 + 1e-9);
        }
      });
    }
  });

  it('fall from their first end by at least 0.03 of their length, or are within 0.02 of level', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      let falling = 0;
      b.features.rails.forEach((r, i) => {
        const f = fallOf(b, r);
        // The first end is the high one, unless the rail is level.
        expect(f, `seed ${seed} rail ${i}`).toBeGreaterThanOrEqual(-0.02);
        expect(f <= 0.02 || f >= 0.03, `seed ${seed} rail ${i}: fall ${f}`).toBe(true);
        if (f >= 0.03) falling++;
      });
      // Most of them fall: the map runs downhill.
      expect(falling).toBeGreaterThanOrEqual(b.rails.length / 2);
    }
  });

  it('have 3 m of gentle run-up at each end, 4 m clear of sites, pads and other rails, and keep 14 m from the spawn', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const rails = b.features.rails;
      rails.forEach((r, i) => {
        const len = railLen(r);
        const ux = (r.x1 - r.x0) / len;
        const uz = (r.z1 - r.z0) / len;
        for (let d = 0; d <= RUN_UP; d += 0.25) {
          expect(slope(b, r.x0 - ux * d, r.z0 - uz * d)).toBeLessThan(0.35);
          expect(slope(b, r.x1 + ux * d, r.z1 + uz * d)).toBeLessThan(0.35);
        }
        const e = withRunUps(r);
        expect(segDist(b.spawnX, b.spawnZ, ...e)).toBeGreaterThanOrEqual(14);
        for (const s of b.features.sites) {
          if (s.kind !== 'hoop') expect(segDist(s.x, s.z, ...e), `seed ${seed} rail ${i} by a ${s.kind}`).toBeGreaterThanOrEqual(4);
        }
        for (const p of b.pads) expect(segDist(p.x, p.z, ...e) - p.radius).toBeGreaterThanOrEqual(4);
        rails.forEach((o, j) => {
          if (j === i) return;
          const bare: Seg = [o.x0, o.z0, o.x1, o.z1];
          // Rails of one chain lie end to end on one line: there only the bars keep apart.
          const near = o.chain > 0 && o.chain === r.chain ? segSegDist([r.x0, r.z0, r.x1, r.z1], bare) : segSegDist(e, bare);
          expect(near, `seed ${seed} rails ${i} and ${j}`).toBeGreaterThanOrEqual(4 - 1e-6);
        });
      });
    }
  });

  it('lay at least two chains of two or three rails end to end along one line, 5 to 8 m apart', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const chains = chainsOf(b);
      expect(chains.length).toBeGreaterThanOrEqual(2);
      for (const chain of chains) {
        expect(chain.length).toBeGreaterThanOrEqual(2);
        expect(chain.length).toBeLessThanOrEqual(3);
        for (const r of chain) expect(r.kind).toBe('chain');
        const first = chain[0];
        const ux = (first.x1 - first.x0) / railLen(first);
        const uz = (first.z1 - first.z0) / railLen(first);
        for (let k = 1; k < chain.length; k++) {
          const a = chain[k - 1];
          const c = chain[k];
          // The same heading, both ends on the first one's line, starting ahead of the last one's end.
          expect(((c.x1 - c.x0) * ux + (c.z1 - c.z0) * uz) / railLen(c)).toBeCloseTo(1, 9);
          expect(Math.abs((c.x0 - first.x0) * uz - (c.z0 - first.z0) * ux)).toBeLessThan(1e-6);
          expect(Math.abs((c.x1 - first.x0) * uz - (c.z1 - first.z0) * ux)).toBeLessThan(1e-6);
          const gap = (c.x0 - a.x1) * ux + (c.z0 - a.z1) * uz;
          expect(gap).toBeGreaterThanOrEqual(5 - 1e-9);
          expect(gap).toBeLessThanOrEqual(8 + 1e-9);
        }
      }
      for (const r of b.features.rails) if (r.kind !== 'chain') expect(r.chain).toBe(0);
    }
  });

  it('put at least two down the fall line of a hillside', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const hills = b.features.rails.filter((r) => r.kind === 'hill');
      expect(hills.length).toBeGreaterThanOrEqual(2);
      for (const r of hills) {
        const [gx, gz] = grad(b, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
        const s = Math.hypot(gx, gz);
        expect(s).toBeGreaterThanOrEqual(0.1);
        // Heading within a few degrees of straight down the slope at its middle.
        const down = -(gx * (r.x1 - r.x0) + gz * (r.z1 - r.z0)) / (s * railLen(r));
        expect(down).toBeGreaterThan(Math.cos(0.05));
        expect(fallOf(b, r)).toBeGreaterThanOrEqual(0.03);
      }
    }
  });

  it('put at least one down the floor of each half-pipe, beside its centre line, falling the way the pipe does', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      for (const p of b.features.pipes) {
        const pl = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
        const ux = (p.x1 - p.x0) / pl;
        const uz = (p.z1 - p.z0) / pl;
        const inPipe = b.features.rails.filter((r) => {
          if (r.kind !== 'pipe') return false;
          const par = ((r.x1 - r.x0) * ux + (r.z1 - r.z0) * uz) / railLen(r);
          const off0 = (r.x0 - p.x0) * uz - (r.z0 - p.z0) * ux;
          const off1 = (r.x1 - p.x0) * uz - (r.z1 - p.z0) * ux;
          const s0 = (r.x0 - p.x0) * ux + (r.z0 - p.z0) * uz;
          const s1 = (r.x1 - p.x0) * ux + (r.z1 - p.z0) * uz;
          return (
            par > 1 - 1e-9 &&
            Math.abs(off0 - off1) < 1e-6 &&
            Math.abs(off0) >= 1.5 - 1e-9 &&
            Math.abs(off0) <= 3.5 + 1e-9 &&
            s0 >= 0 &&
            s1 <= pl
          );
        });
        expect(inPipe.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
        for (const r of inPipe) expect(fallOf(b, r)).toBeGreaterThanOrEqual(0.03);
      }
    }
  });
});
