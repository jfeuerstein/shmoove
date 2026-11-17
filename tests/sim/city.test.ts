/**
 * Santa Rampa: the whole-city generator. These tests skate the real city with the real
 * controller; they assert what a player would find, not how the generator builds it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { resetFeel } from '../../src/sim/constants';
import { angleDiff, clamp, datan2 } from '../../src/sim/math';
import { Rng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/sim';
import { CITY, buildCity, type City } from '../../src/sim/city';
import { Mode, type SimEvent } from '../../src/sim/types';
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

// ---------------------------------------------------------------------------------------------
// What is built on the ground.

interface Region {
  cells: Set<number>;
  zMid: number;
  medianGrade: number;
}

/** Connected (4-neighbour) regions of STAIRS cells. */
function stairRegions(w: World): Region[] {
  const seen = new Uint8Array(w.nx * w.nz);
  const out: Region[] = [];
  for (let i = 0; i < w.nx * w.nz; i++) {
    if (seen[i] || w.surfaces[i] !== Surface.STAIRS) continue;
    const cells: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop() as number;
      cells.push(c);
      const ix = c % w.nx;
      const iz = (c - ix) / w.nx;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= w.nx || jz >= w.nz) continue;
        const j = jz * w.nx + jx;
        if (!seen[j] && w.surfaces[j] === Surface.STAIRS) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const grades = cells.map((c) => cellGrade(w, c % w.nx, Math.floor(c / w.nx))).sort((a, b) => a - b);
    let zs = 0;
    for (const c of cells) zs += w.minZ + (Math.floor(c / w.nx) + 0.5) * w.cell;
    out.push({ cells: new Set(cells), zMid: zs / cells.length, medianGrade: grades[Math.floor(grades.length / 2)] });
  }
  return out;
}

function railMidZ(r: { pts: Float32Array }): number {
  const n = r.pts.length / 3;
  return (r.pts[2] + r.pts[(n - 1) * 3 + 2]) / 2;
}

/** Does the rail pass over any cell of the region (checked every metre along it)? */
function railOver(w: World, r: { pts: Float32Array }, cells: Set<number>): boolean {
  const n = r.pts.length / 3;
  for (let i = 0; i + 1 < n; i++) {
    const ax = r.pts[i * 3];
    const az = r.pts[i * 3 + 2];
    const bx = r.pts[i * 3 + 3];
    const bz = r.pts[i * 3 + 5];
    const len = Math.max(1e-6, Math.hypot(bx - ax, bz - az));
    for (let t = 0; t <= len; t += 1) {
      const x = ax + ((bx - ax) * t) / len;
      const z = az + ((bz - az) * t) / len;
      if (cells.has(Math.floor((z - w.minZ) / w.cell) * w.nx + Math.floor((x - w.minX) / w.cell))) return true;
    }
  }
  return false;
}

describe('what stands on the hill', () => {
  it('has the stair streets, awnings, rails and budgets the districts promise', () => {
    const w = city.world;
    const B = CITY.bands;
    const stairs = stairRegions(w).filter((r) => r.zMid >= B.mercado && r.zMid < B.terraces && r.medianGrade >= 0.25);
    expect(stairs.length).toBeGreaterThanOrEqual(8);

    const awnings = w.solids.filter((o) => o.kind === 'awning');
    expect(awnings.length).toBeGreaterThanOrEqual(40);
    for (const a of awnings) {
      expect(a.oneWay).toBe(true);
      expect(a.surface).toBe(Surface.AWNING);
      expect(a.yTop - a.yBase).toBeCloseTo(0.2, 3);
      for (const [sx, sz] of [[0, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) {
        const x = a.cx + sx * a.hx * a.cosR - sz * a.hz * a.sinR;
        const z = a.cz + sx * a.hx * a.sinR + sz * a.hz * a.cosR;
        const clear = a.yBase - terrainHeight(w, x, z);
        expect(clear).toBeGreaterThanOrEqual(2.3 - 0.05);
        expect(clear).toBeLessThanOrEqual(3.0 + 0.05);
      }
    }

    expect(w.solids.length).toBeLessThanOrEqual(2600);
    expect(w.rails.length).toBeGreaterThanOrEqual(150);
    expect(w.rails.length).toBeLessThanOrEqual(700);
    expect(w.rails.filter((r) => railMidZ(r) < B.mercado).length).toBeGreaterThanOrEqual(25);
    expect(w.rails.filter((r) => railMidZ(r) >= B.terraces && railMidZ(r) < B.antenna).length).toBeGreaterThanOrEqual(30);
    const guys = w.rails.filter((r) => r.kind === 'guy');
    expect(guys.filter((r) => r.length >= 30).length).toBeGreaterThanOrEqual(12);
    for (const g of guys) {
      const dy = Math.abs(g.pts[1] - g.pts[g.pts.length - 2]);
      expect(dy / g.length).toBeGreaterThan(0.4);
    }

    // Every Mercado flight has a handrail over it.
    const rails = w.rails.filter((r) => r.kind === 'handrail');
    for (const reg of stairs) {
      expect(rails.some((r) => railOver(w, r, reg.cells)), `stairs near z ${reg.zMid.toFixed(0)} x ${[...reg.cells].map((c) => w.minX + (c % w.nx) * w.cell).join(",")}`).toBe(true);
    }
  });

  it('has a quay wall with exactly two slipways, and the needle is out of reach', () => {
    const w = city.world;
    // Walk along the quay: blocked except in two 10 m gaps.
    const gaps: number[] = [];
    let run = 0;
    for (let x = CITY.minX + 2; x <= CITY.maxX - 2; x += 1) {
      collideSolids(w, x, terrainHeight(w, x, 1.0), 0.3, 0.35, 1.7, 0.4, WH);
      if (!WH.hit) run++;
      else if (run > 0) {
        gaps.push(run);
        run = 0;
      }
    }
    expect(gaps.length).toBe(2);
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(8);
      expect(g).toBeLessThanOrEqual(12);
    }

    const n = findZone(w, 'needle');
    expect(n).not.toBeNull();
    if (!n) return;
    expect(n.kind).toBe('secret');
    expect(n.y - terrainHeight(w, n.x, n.z)).toBeGreaterThanOrEqual(20);
    expect(topHeight(w, n.x, n.z)).toBeCloseTo(n.y, 2);
    for (const r of w.rails) {
      for (let i = 0; i < r.pts.length; i += 3) {
        expect(Math.hypot(r.pts[i] - n.x, r.pts[i + 1] - n.y, r.pts[i + 2] - n.z)).toBeGreaterThan(8);
      }
    }
    for (const o of w.solids) {
      const d = Math.hypot(o.cx - n.x, o.cz - n.z);
      if (d < 1) continue; // the antenna itself
      if (d < 40) expect(o.yTop, `${o.kind} at ${o.cx},${o.cz}`).toBeLessThan(n.y - 6);
    }
  });

  it('every named place exists and sits where it says', () => {
    const w = city.world;
    const landmarks = [
      'fish_market', 'crane_yard', 'container_yard', 'ferry_pier', 'mercado_gate', 'plaza_boda', 'clock_tower',
      'spice_row', 'funicular_base', 'funicular_top', 'tram_depot', 'laundry_terrace', 'bus_garage', 'school_roof',
      'hill_station', 'radio_shack', 'kite_field', 'summit',
    ];
    for (const id of landmarks) {
      const z = findZone(w, id);
      expect(z, id).not.toBeNull();
      if (!z) continue;
      expect(z.kind, id).toBe('landmark');
      expect(z.r).toBeGreaterThanOrEqual(4);
      expect(z.r).toBeLessThanOrEqual(10);
      expect(Math.abs(z.y - topHeight(w, z.x, z.z)), id).toBeLessThan(0.05);
      sampleTerrain(w, z.x, z.z, TS);
      if (id !== 'ferry_pier') expect(TS.surface, id).not.toBe(Surface.WATER);
      // Standing there, nothing solid is around your feet.
      collideSolids(w, z.x, z.y, z.z, 0.5, 1.7, 0.4, WH);
      expect(WH.hit, id).toBe(false);
    }
    const school = findZone(w, 'school_roof');
    if (school) {
      expect(school.y - terrainHeight(w, school.x, school.z)).toBeGreaterThan(3);
      expect(w.solids.some((o) => o.kind === 'school' && Math.abs(o.yTop - school.y) < 0.01)).toBe(true);
    }
    const pier = findZone(w, 'ferry_pier');
    if (pier) expect(pier.y).toBeGreaterThan(2.5);
    const hs = findZone(w, 'hill_station');
    if (hs) {
      expect(hs.z).toBeGreaterThan(1020);
      expect(hs.z).toBeLessThan(1060);
    }
  });
});

describe('no traps', () => {
  it('a skater left anywhere above the docks rolls somewhere sensible', () => {
    const w = city.world;
    const rng = new Rng(4242);
    const ok = new Set<number>([Surface.STREET, Surface.PLAZA, Surface.STAIRS]);
    const starts: [number, number][] = [];
    while (starts.length < 60) {
      const ix = rng.int(w.nx);
      const iz = rng.int(w.nz);
      const x = w.minX + (ix + 0.5) * w.cell;
      const z = w.minZ + (iz + 0.5) * w.cell;
      if (z < CITY.bands.mercado || !ok.has(w.surfaces[iz * w.nx + ix])) continue;
      if (topHeight(w, x, z) > terrainHeight(w, x, z) + 0.05) continue;
      collideSolids(w, x, terrainHeight(w, x, z), z, 0.4, 1.7, 0.4, WH);
      if (WH.hit) continue;
      starts.push([x, z]);
    }
    let good = 0;
    const report: string[] = [];
    const problems: string[] = [];
    for (const [x0, z0] of starts) {
      const sim = newSim(w);
      teleport(sim, x0, z0, rng.range(-Math.PI, Math.PI));
      const y0 = sim.player.y;
      let bails = 0;
      const hist: [number, number][] = [];
      for (let t = 0; t < 90 * 60; t++) {
        sim.step({ steer: 0, hold: false, hop: false });
        for (const e of sim.events) if (e.type === 'bail') bails++;
        const p = sim.player;
        if (t % 60 === 59) {
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          expect(p.x).toBeGreaterThanOrEqual(w.minX);
          expect(p.x).toBeLessThanOrEqual(w.maxX);
          expect(p.z).toBeGreaterThanOrEqual(w.minZ);
          expect(p.z).toBeLessThanOrEqual(w.maxZ);
          if (p.mode !== Mode.BAIL) {
            collideSolids(w, p.x, p.y + 0.05, p.z, 1e-3, 1.0, 0, WH);
            if (WH.hit) problems.push(`inside solid ${WH.solid} at ${p.x.toFixed(0)},${p.z.toFixed(0)} from ${x0},${z0}`);
          }
          hist.push([p.x, p.z]);
        }
      }
      const p = sim.player;
      if (bails > 1) problems.push(`${bails} bails from ${x0},${z0}`);
      const back = hist[hist.length - 11];
      const moved = Math.hypot(p.x - back[0], p.z - back[1]);
      if (p.speed > 0.5 && moved < 1) problems.push(`oscillating at ${p.x.toFixed(0)},${p.z.toFixed(0)} from ${x0},${z0}`);
      sampleTerrain(w, p.x, p.z, TS);
      const grade = p.onSolid >= 0 ? 0 : Math.hypot(TS.gx, TS.gz);
      const descended = y0 - p.y >= 15;
      const rests = p.mode === Mode.GROUND && p.speed < 0.3 && grade < 0.015;
      if (descended || rests) good++;
      else report.push(`${x0.toFixed(0)},${z0.toFixed(0)} -> ${p.x.toFixed(0)},${p.z.toFixed(0)} v${p.speed.toFixed(1)} g${grade.toFixed(3)}`);
    }
    expect(problems).toEqual([]);
    expect(good / starts.length, report.join('\n')).toBeGreaterThanOrEqual(0.85);
  }, 60_000);
});

describe('stairs and rails in the real city', () => {
  it('handrails take a hop from the landing above and carry you down the flight', () => {
    const w = city.world;
    const rails = w.rails.filter((r) => r.kind === 'handrail');
    // A spread of handrails across the city.
    const step = Math.max(1, Math.floor(rails.length / 12));
    const picks = rails.filter((_, i) => i % step === 0).slice(0, 12);
    let passed = 0;
    const fails: string[] = [];
    for (const r of picks) {
      const x = r.pts[0];
      const zTop = r.pts[2];
      const sim = newSim(w);
      teleport(sim, x, zTop + 3, Math.PI, 6);
      let hopped = false;
      const events: SimEvent[] = [];
      let yIn = 0;
      let yOut = 0;
      for (let t = 0; t < 8 * 60; t++) {
        const p = sim.player;
        const hop = !hopped && p.z <= zTop + 0.5;
        if (hop) hopped = true;
        const want = datan2(x - p.x, -6);
        const steer = p.mode === Mode.GROUND ? clamp(-2 * angleDiff(want, p.heading), -1, 1) : 0;
        sim.step({ steer, hold: false, hop });
        for (const e of sim.events) {
          events.push(e);
          if (e.type === 'grindStart' && e.rail === r.index) yIn = sim.player.y;
          if (e.type === 'grindEnd' && e.rail === r.index) yOut = sim.player.y;
        }
        if (events.some((e) => e.type === 'grindEnd' && e.rail === r.index)) break;
      }
      const iStart = events.findIndex((e) => e.type === 'grindStart' && e.rail === r.index);
      const iEnd = events.findIndex((e) => e.type === 'grindEnd' && e.rail === r.index);
      if (iStart >= 0 && iEnd > iStart && yOut < yIn - 1) passed++;
      else fails.push(`rail ${r.index} at ${x.toFixed(0)},${zTop.toFixed(0)}: start ${iStart} end ${iEnd} ${yIn.toFixed(1)}->${yOut.toFixed(1)}`);
    }
    expect(passed, fails.join('\n')).toBeGreaterThanOrEqual(Math.max(6, picks.length - 2));
  });
});

describe('roofs are play space', () => {
  it('at least 60 roofs can be entered from higher ground without a hop over 1.2 m', () => {
    const w = city.world;
    const roofKinds = new Set(['building', 'house', 'school', 'warehouse', 'market', 'container', 'crate', 'stall', 'shed', 'kiosk', 'church']);
    let count = 0;
    for (const o of w.solids) {
      if (o.oneWay || !roofKinds.has(o.kind)) continue;
      let enterable = false;
      for (const [ex, ez] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const f of [-0.8, -0.4, 0, 0.4, 0.8]) {
          // A point just outside this edge.
          const lx = ex !== 0 ? ex * (o.hx + 0.6) : f * o.hx;
          const lz = ez !== 0 ? ez * (o.hz + 0.6) : f * o.hz;
          const x = o.cx + lx * o.cosR - lz * o.sinR;
          const z = o.cz + lx * o.sinR + lz * o.cosR;
          sampleTerrain(w, x, z, TS);
          if (TS.surface === Surface.WATER) continue;
          if (topHeight(w, x, z) >= o.yTop - 1.2) enterable = true;
        }
      }
      if (enterable) count++;
    }
    expect(count).toBeGreaterThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------------------------
// Routes.

const LINE_IDS = ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4', 'A1', 'A2', 'A3', 'S1', 'S2', 'S3'];
/** Steepest grade a ground line may climb. */
const MAX_GRADE: Record<string, number> = { T1: 0.45 };
/** Tightest corner radius a ground line may take. */
const MIN_RADIUS: Record<string, number> = { M1: 6, M2: 6, D2: 6 };
/** Height bands above whatever is below, for overhead lines. */
const BANDS: Record<string, [number, number]> = {
  D1: [10, 12],
  A1: [9, 13],
  A2: [9, 13],
  A3: [12, 22],
  S2: [30, 45],
  S3: [5, 45],
};

function pathLength(p: number[]): number {
  let s = 0;
  for (let i = 3; i < p.length; i += 3) s += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]);
  return s;
}

function circumradius(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const a = Math.hypot(bx - cx, bz - cz);
  const b = Math.hypot(ax - cx, az - cz);
  const c = Math.hypot(ax - bx, az - bz);
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return area2 < 1e-9 ? Infinity : (a * b * c) / (2 * area2);
}

describe('routes', () => {
  it('all 16 lines exist, loops are closed, points are close together, stops start at 0', () => {
    for (const id of LINE_IDS) {
      const r = city.routes[id];
      expect(r, id).toBeDefined();
      if (!r) continue;
      expect(r.id).toBe(id);
      const p = r.path;
      expect(p.length % 3).toBe(0);
      expect(p.length / 3).toBeGreaterThan(4);
      for (let i = 3; i < p.length; i += 3) {
        expect(Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2], p[i + 2] - p[i - 1]), id).toBeLessThanOrEqual(4.05);
      }
      if (r.loop) {
        const n = p.length;
        expect([p[n - 3], p[n - 2], p[n - 1]]).toEqual([p[0], p[1], p[2]]);
      }
      expect(r.stops.length, id).toBeGreaterThanOrEqual(2);
      expect(r.stops[0].s).toBe(0);
      const len = pathLength(p);
      for (let k = 1; k < r.stops.length; k++) {
        expect(r.stops[k].s, `${id} stop ${k}`).toBeGreaterThan(r.stops[k - 1].s);
        expect(r.stops[k].s).toBeLessThanOrEqual(len + 1e-6);
      }
    }
    const overhead = LINE_IDS.filter((id) => city.routes[id]?.overhead);
    expect(overhead.sort()).toEqual(['A1', 'A2', 'A3', 'D1', 'S2', 'S3']);
    expect(city.routes.D1.loop).toBe(false);
  });

  it('ground lines are draped, gentle, round enough and clear of solids, on street, track or plaza', () => {
    const w = city.world;
    const ok = new Set<number>([Surface.STREET, Surface.TRACK, Surface.PLAZA]);
    const problems: string[] = [];
    for (const id of LINE_IDS) {
      const r = city.routes[id];
      if (!r || r.overhead) continue;
      const p = r.path;
      const n = p.length / 3;
      const maxG = MAX_GRADE[id] ?? 0.14;
      const minR = MIN_RADIUS[id] ?? 12;
      let worstG = 0;
      let worstR = Infinity;
      for (let i = 0; i < n; i++) {
        const x = p[i * 3];
        const y = p[i * 3 + 1];
        const z = p[i * 3 + 2];
        if (Math.abs(y - terrainHeight(w, x, z)) >= 0.05) problems.push(`${id} not draped at ${x.toFixed(0)},${z.toFixed(0)}`);
        if (i > 0) {
          const dx = x - p[i * 3 - 3];
          const dz = z - p[i * 3 - 1];
          const plan = Math.hypot(dx, dz);
          if (plan > 0.5) worstG = Math.max(worstG, Math.abs(y - p[i * 3 - 2]) / plan);
          // Every 2 m along the segment: surface and clearance.
          const steps = Math.max(1, Math.ceil(plan / 2));
          for (let k = 0; k < steps; k++) {
            const sx = p[i * 3 - 3] + (dx * k) / steps;
            const sz = p[i * 3 - 1] + (dz * k) / steps;
            sampleTerrain(w, sx, sz, TS);
            if (!ok.has(TS.surface)) problems.push(`${id} on surface ${TS.surface} at ${sx.toFixed(0)},${sz.toFixed(0)}`);
            collideSolids(w, sx, TS.y, sz, 2.6, 3.0, 0.4, WH);
            if (WH.hit) {
              const o = w.solids[WH.solid];
              problems.push(`${id} within 2.6 m of ${o.kind} at ${sx.toFixed(0)},${sz.toFixed(0)}`);
            }
          }
        }
        // Corner radius over points about 6 m apart.
        if (i >= 2 && i < n - 2) {
          const R = circumradius(p[i * 3 - 6], p[i * 3 - 4], x, z, p[i * 3 + 6], p[i * 3 + 8]);
          worstR = Math.min(worstR, R);
        }
      }
      if (worstG > maxG + 0.005) problems.push(`${id} grade ${worstG.toFixed(3)} > ${maxG}`);
      if (worstR < minR - 0.3) problems.push(`${id} corner radius ${worstR.toFixed(1)} < ${minR}`);
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('overhead lines ride in their height bands, and the king kite passes just over the needle', () => {
    const w = city.world;
    for (const id of LINE_IDS) {
      const r = city.routes[id];
      if (!r || !r.overhead) continue;
      const [lo, hi] = BANDS[id];
      const p = r.path;
      for (let i = 0; i < p.length; i += 3) {
        const above = p[i + 1] - topHeight(w, p[i], p[i + 2]);
        expect(above, `${id} at ${p[i].toFixed(0)},${p[i + 2].toFixed(0)}`).toBeGreaterThanOrEqual(lo);
        expect(above, `${id} at ${p[i].toFixed(0)},${p[i + 2].toFixed(0)}`).toBeLessThanOrEqual(hi);
      }
    }
    const n = findZone(w, 'needle');
    expect(n).not.toBeNull();
    if (!n) return;
    const s3 = city.routes.S3.path;
    let best = Infinity;
    let above = 0;
    for (let i = 0; i < s3.length; i += 3) {
      const d = Math.hypot(s3[i] - n.x, s3[i + 2] - n.z);
      if (d < best) {
        best = d;
        above = s3[i + 1] - n.y;
      }
    }
    expect(best).toBeLessThan(1);
    expect(above).toBeGreaterThanOrEqual(5);
    expect(above).toBeLessThanOrEqual(7);
    // Cable cars have pylons, and none stands on a street.
    const pylons = w.solids.filter((o) => o.kind === 'pylon');
    expect(pylons.length).toBeGreaterThanOrEqual(4);
    for (const o of pylons) {
      sampleTerrain(w, o.cx, o.cz, TS);
      expect(TS.surface).not.toBe(Surface.STREET);
      expect(Math.max(o.hx, o.hz)).toBeLessThan(1);
    }
  });

  it('at least 8 chain spots, each where two lines really pass within 12 m at compatible heights', () => {
    const w = city.world;
    const chains = w.zones.filter((z) => z.kind === 'chain');
    expect(chains.length).toBeGreaterThanOrEqual(8);
    for (const c of chains) {
      const m = /^chain_([A-Z]\d)_([A-Z]\d)$/.exec(c.id);
      expect(m, c.id).not.toBeNull();
      if (!m) continue;
      const A = city.routes[m[1]];
      const B = city.routes[m[2]];
      expect(m[1]).not.toBe(m[2]);
      const tol = A.overhead && B.overhead ? 8 : 3;
      let found = false;
      for (let i = 0; i < A.path.length && !found; i += 3) {
        if (Math.hypot(A.path[i] - c.x, A.path[i + 2] - c.z) > c.r + 12) continue;
        for (let j = 0; j < B.path.length; j += 3) {
          const d = Math.hypot(A.path[i] - B.path[j], A.path[i + 2] - B.path[j + 2]);
          if (d <= 12 && Math.abs(A.path[i + 1] - B.path[j + 1]) <= tol) {
            found = true;
            break;
          }
        }
      }
      expect(found, c.id).toBe(true);
    }
  });

  it('every stop has a zone at it', () => {
    const w = city.world;
    for (const id of LINE_IDS) {
      const r = city.routes[id];
      r.stops.forEach((_st, n) => {
        const z = findZone(w, `stop_${id}_${n}`);
        expect(z, `stop_${id}_${n}`).not.toBeNull();
        if (z) {
          expect(z.kind).toBe('stop');
          expect(z.r).toBeGreaterThanOrEqual(4);
          expect(z.r).toBeLessThanOrEqual(10);
        }
      });
    }
    const g = findZone(w, 'ghost_tunnel');
    expect(g?.kind).toBe('secret');
  });
});

