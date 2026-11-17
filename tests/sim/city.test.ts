/**
 * Santa Rampa: the whole-city generator. These tests skate the real city with the real
 * controller; they assert what a player would find, not how the generator builds it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { resetFeel } from '../../src/sim/constants';
import { angleDiff, clamp, datan2 } from '../../src/sim/math';
import { Sim } from '../../src/sim/sim';
import { CITY, buildCity, type City } from '../../src/sim/city';
import { Mode } from '../../src/sim/types';
import {
  Surface,
  collideSolids,
  findZone,
  makeWallHit,
  sampleTerrain,
  terrainHeight,
  topHeight,
  worldHash,
  type World,
} from '../../src/sim/world';
import { teleport } from './helpers';

let city: City;
let buildMs = 0;

beforeAll(() => {
  const t0 = performance.now();
  city = buildCity(1);
  buildMs = performance.now() - t0;
});

const WH = makeWallHit();
const TS = { y: 0, gx: 0, gz: 0, surface: 0 };

function newSim(w: World): Sim {
  resetFeel();
  return new Sim(w, { seed: 1, startDayFrac: 0.3 });
}

/** Max grade of the two triangles of a cell. */
function cellGrade(w: World, ix: number, iz: number): number {
  const row = w.nx + 1;
  const k = iz * row + ix;
  const h = w.heights;
  const h00 = h[k];
  const h10 = h[k + 1];
  const h01 = h[k + row];
  const h11 = h[k + row + 1];
  const g1 = Math.sqrt((h10 - h00) ** 2 + (h11 - h10) ** 2) / w.cell;
  const g2 = Math.sqrt((h11 - h01) ** 2 + (h01 - h00) ** 2) / w.cell;
  return Math.max(g1, g2);
}

/** Is the cell's footprint covered by a solid whose top is at or above the cell's highest corner? */
function cellCovered(w: World, ix: number, iz: number): boolean {
  const x = w.minX + (ix + 0.5) * w.cell;
  const z = w.minZ + (iz + 0.5) * w.cell;
  const row = w.nx + 1;
  const k = iz * row + ix;
  const top = Math.max(w.heights[k], w.heights[k + 1], w.heights[k + row], w.heights[k + row + 1]);
  for (const o of w.solids) {
    if (o.oneWay || o.yTop < top - 0.05) continue;
    const dx = x - o.cx;
    const dz = z - o.cz;
    const lx = dx * o.cosR + dz * o.sinR;
    const lz = -dx * o.sinR + dz * o.cosR;
    if (Math.abs(lx) <= o.hx + 0.01 && Math.abs(lz) <= o.hz + 0.01) return true;
  }
  return false;
}

describe('determinism and cost', () => {
  it('same seed builds the same world, another seed a different one, in under 500 ms', () => {
    const a = buildCity(7);
    const b = buildCity(7);
    const c = buildCity(8);
    expect(worldHash(a.world)).toBe(worldHash(b.world));
    expect(worldHash(a.world)).not.toBe(worldHash(c.world));
    expect(a.spine).toEqual(b.spine);
    const t0 = performance.now();
    buildCity(3);
    const ms = performance.now() - t0;
    expect(Math.min(ms, buildMs)).toBeLessThan(500);
  });
});

describe('shape of the hill', () => {
  it('bands sit at their altitudes', () => {
    const w = city.world;
    const B = CITY.bands;
    const at = (z: number): number => terrainHeight(w, -150, z);
    expect(at(10)).toBeGreaterThan(2);
    expect(at(10)).toBeLessThan(4);
    expect(at(270)).toBeGreaterThan(4.5);
    expect(at(270)).toBeLessThan(8);
    expect(at(B.terraces - 5)).toBeGreaterThan(60);
    expect(at(B.terraces - 5)).toBeLessThan(80);
    expect(at(B.antenna - 5)).toBeGreaterThan(135);
    expect(at(B.antenna - 5)).toBeLessThan(160);
    expect(terrainHeight(w, 0, 1262)).toBeGreaterThan(220);
    expect(terrainHeight(w, 0, 1262)).toBeLessThan(240);
    expect(w.bands.map((b) => b.zMin)).toEqual([-Infinity, B.mercado, B.terraces, B.antenna]);
    // The sea is water, below the quay.
    sampleTerrain(w, 0, -20, TS);
    expect(TS.surface).toBe(Surface.WATER);
    expect(TS.y).toBeLessThan(1);
  });

  it('the docks are flat enough that a skater at rest stays at rest', () => {
    const w = city.world;
    let worst = 0;
    for (let iz = 0; iz < w.nz; iz++) {
      const z0 = w.minZ + iz * w.cell;
      if (z0 < 0 || z0 + w.cell > CITY.bands.mercado) continue;
      for (let ix = 0; ix < w.nx; ix++) {
        if (w.surfaces[iz * w.nx + ix] === Surface.WATER) continue;
        worst = Math.max(worst, cellGrade(w, ix, iz));
      }
    }
    expect(worst).toBeLessThan(0.012);
  });

  it('no open terrain is steeper than 100%: every vertical face is a solid', () => {
    const w = city.world;
    const bad: string[] = [];
    for (let iz = 0; iz < w.nz; iz++) {
      for (let ix = 0; ix < w.nx; ix++) {
        if (w.surfaces[iz * w.nx + ix] === Surface.WATER) continue;
        if (cellGrade(w, ix, iz) > 1 && !cellCovered(w, ix, iz)) {
          bad.push(`${w.minX + ix * w.cell},${w.minZ + iz * w.cell}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('the spine', () => {
  it('runs downhill or level from the summit to the docks, 7 m wide and 2 m clear of solids', () => {
    const w = city.world;
    const s = city.spine;
    expect(s.length).toBeGreaterThan(30);
    expect(s[1]).toBeGreaterThan(200);
    expect(s[s.length - 1]).toBeLessThan(CITY.bands.mercado);
    let prev = Infinity;
    let rises = 0;
    const ok = new Set<number>([Surface.STREET, Surface.PLAZA, Surface.STAIRS]);
    for (let i = 0; i + 3 < s.length; i += 3) {
      const ax = s[i];
      const az = s[i + 2];
      const bx = s[i + 3];
      const bz = s[i + 5];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len));
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        const y = terrainHeight(w, x, z);
        if (y > prev + 0.02) rises++;
        prev = Math.min(prev, y);
        // 7 m wide: the ground 3.5 m either side is still street, plaza or stairs.
        for (const side of [-3.5, 0, 3.5]) {
          sampleTerrain(w, x - tz * side, z + tx * side, TS);
          expect(ok.has(TS.surface), `surface ${TS.surface} at ${x},${z} side ${side}`).toBe(true);
        }
        // Nothing solid within 2 m of that width.
        collideSolids(w, x, y, z, 3.5 + 2, 2.5, 0.05, WH);
        expect(WH.hit, `solid ${WH.solid} near spine at ${x},${z}`).toBe(false);
      }
    }
    expect(rises).toBe(0);
  });

  it('a bot that only steers along it reaches the docks in under 5 minutes without a bail', () => {
    const w = city.world;
    const s = city.spine;
    const n = s.length / 3;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(s[i * 3] - s[i * 3 - 3], s[i * 3 + 2] - s[i * 3 - 1]);
    const sim = newSim(w);
    teleport(sim, s[0], s[2], datan2(s[3] - s[0], s[5] - s[2]));
    let idx = 0;
    let bails = 0;
    let ticks = -1;
    for (let t = 0; t < 5 * 60 * 60; t++) {
      const p = sim.player;
      // Nearest spine point, searching forward.
      let best = Infinity;
      for (let j = idx; j < Math.min(n, idx + 40); j++) {
        const d = Math.hypot(s[j * 3] - p.x, s[j * 3 + 2] - p.z);
        if (d < best) {
          best = d;
          idx = j;
        }
      }
      let j = idx;
      while (j < n - 1 && cum[j] - cum[idx] < 12) j++;
      const want = datan2(s[j * 3] - p.x, s[j * 3 + 2] - p.z);
      const steer = clamp(-2 * angleDiff(want, p.heading), -1, 1);
      sim.step({ steer, hold: false, hop: false });
      for (const e of sim.events) if (e.type === 'bail') bails++;
      if (p.z < CITY.bands.mercado && p.mode !== Mode.BAIL) {
        ticks = t;
        break;
      }
    }
    expect(bails).toBe(0);
    expect(ticks).toBeGreaterThan(0);
  });
});

describe('zones', () => {
  it('the new-game spawn is a lookout on the spine facing downhill with a clear run', () => {
    const w = city.world;
    const z = findZone(w, 'spawn');
    expect(z).not.toBeNull();
    if (!z) return;
    expect(w.spawn.x).toBeCloseTo(z.x, 3);
    expect(w.spawn.z).toBeCloseTo(z.z, 3);
    expect(Math.abs(angleDiff(w.spawn.heading, Math.PI))).toBeLessThan(1e-6);
    expect(Math.abs(z.x)).toBeLessThan(3);
    expect(z.z).toBeGreaterThan(540);
    expect(z.z).toBeLessThan(CITY.bands.terraces);
    // 40 m straight downhill: no solid in the way, and the ground never rises.
    let prev = topHeight(w, z.x, z.z);
    for (let d = 1; d <= 40; d++) {
      const y = topHeight(w, z.x, z.z - d);
      expect(y).toBeLessThanOrEqual(prev + 0.02);
      prev = y;
      collideSolids(w, z.x, y, z.z - d, 1, 1.7, 0.4, WH);
      expect(WH.hit).toBe(false);
    }
  });

  it('every spawn sits on open ground, clear of water', () => {
    const w = city.world;
    for (const id of ['spawn', 'spawn_docks', 'spawn_mercado', 'spawn_terraces', 'spawn_antenna']) {
      const z = findZone(w, id);
      expect(z, id).not.toBeNull();
      if (!z) continue;
      expect(z.kind).toBe('spawn');
      expect(z.r).toBeGreaterThanOrEqual(4);
      expect(z.r).toBeLessThanOrEqual(10);
      expect(Math.abs(z.y - terrainHeight(w, z.x, z.z)), id).toBeLessThan(0.05);
      collideSolids(w, z.x, z.y, z.z, 1.5, 1.7, 0.4, WH);
      expect(WH.hit, id).toBe(false);
      for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
        sampleTerrain(w, z.x + dx, z.z + dz, TS);
        expect(TS.surface, id).not.toBe(Surface.WATER);
      }
    }
  });
});

