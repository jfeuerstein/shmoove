/** What a player would notice about Static: travel charges it, and a full charge arcs through a chain. */
import { describe, expect, it } from 'vitest';
import { W_STATIC } from '../../../src/sim/arsenal';
import { gearPower } from '../../../src/sim/balance';
import type { Sim } from '../../../src/sim/sim';
import { STATIC, staticCharge, stepStatic } from '../../../src/sim/weapons/static';
import { FX_ARC, KIND_BOLLARD, KIND_SHUFFLER, KINDS, MAX_FX, rebuildGrid, WEAPON_MEM } from '../../../src/sim/world';
import { FORWARD, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { placeRising, pointAt, rig, tick } from './rig';

const SPEED = 10;

/** Fill the charge so the next step discharges if it can. */
function charge(sim: Sim): void {
  sim.world.mem[W_STATIC * WEAPON_MEM] = STATIC.interval[sim.world.player.loadout.weaponLevel[W_STATIC] - 1];
}

interface Arc {
  x: number;
  z: number;
  a: number;
}

function arcs(sim: Sim): Arc[] {
  const f = sim.world.fx;
  const out: Arc[] = [];
  for (let i = 0; i < f.count; i++) if (f.type[i] === FX_ARC) out.push({ x: f.x[i], z: f.z[i], a: f.a[i] });
  return out;
}

/** Bollards in a line ahead of the mover, `gap` apart from `first` m out. Returns their indices. */
function line(sim: Sim, count: number, first: number, gap: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const p = pointAt(sim, first + k * gap);
    ids.push(place(sim, KIND_BOLLARD, p.x, p.z));
  }
  return ids;
}

describe('the charge', () => {
  it('builds with distance and discharges once every interval', () => {
    for (const level of [1, 5]) {
      const sim = rig(W_STATIC, level);
      const h = sim.world.horde;
      const e = place(sim, KIND_BOLLARD, 0, 0);
      let discharges = 0;
      for (let t = 0; t < 60 * 20; t++) {
        // A tough target keeping pace just ahead, so there is always something in reach.
        const p = pointAt(sim, 6);
        h.x[e] = p.x;
        h.z[e] = p.z;
        h.hp[e] = 1e6;
        tick(sim, FORWARD, { speed: SPEED });
        discharges += arcs(sim).filter((a) => a.a === 0).length;
      }
      const metres = sim.state.distance;
      expect(discharges).toBe(Math.floor(metres / STATIC.interval[level - 1]));
      expect(discharges).toBeGreaterThan(5);
    }
  });

  it('builds nothing standing still, and nothing at level 0', () => {
    const still = rig(W_STATIC, 5);
    const p = pointAt(still, 4);
    const a = place(still, KIND_BOLLARD, p.x, p.z);
    let seen = 0;
    for (let t = 0; t < 600; t++) seen += tick(still, TUCK, {}, FX_ARC);
    expect(staticCharge(still.world)).toBe(0);
    expect(seen).toBe(0);
    expect(still.world.horde.hp[a]).toBe(KINDS[KIND_BOLLARD].hp);

    const off = rig(W_STATIC, 0);
    const b = place(off, KIND_BOLLARD, 0, 0);
    seen = 0;
    for (let t = 0; t < 600; t++) {
      const q = pointAt(off, 5);
      off.world.horde.x[b] = q.x;
      off.world.horde.z[b] = q.z;
      seen += tick(off, FORWARD, { speed: SPEED }, FX_ARC);
    }
    expect(seen).toBe(0);
    expect(staticCharge(off.world)).toBe(0);
  });

  it('waits, full, with nothing in reach, and goes off the moment something comes close', () => {
    const sim = rig(W_STATIC, 1);
    let seen = 0;
    for (let t = 0; t < 60 * 6; t++) seen += tick(sim, FORWARD, { speed: SPEED }, FX_ARC);
    expect(seen).toBe(0);
    expect(staticCharge(sim.world)).toBe(STATIC.interval[0]);
    const far = pointAt(sim, STATIC.reach + KINDS[KIND_SHUFFLER].radius + 2, Math.PI);
    place(sim, KIND_SHUFFLER, far.x, far.z);
    expect(tick(sim, TUCK, {}, FX_ARC)).toBe(0);
    const near = pointAt(sim, STATIC.reach - 1);
    place(sim, KIND_SHUFFLER, near.x, near.z);
    expect(tick(sim, TUCK, {}, FX_ARC)).toBe(1);
    expect(staticCharge(sim.world)).toBeLessThan(STATIC.interval[0]);
  });
});

describe('the chain', () => {
  it('starts at the nearest enemy and runs link to link, in order, as long as the level allows', () => {
    const sim = rig(W_STATIC, 2);
    const want = STATIC.chain[1];
    // Six in a line 5 m apart, each within a jump of the one before: the chain stops at the level's length.
    const ids = line(sim, 6, 3, 5);
    const h = sim.world.horde;
    const pos = ids.map((i) => ({ x: h.x[i], z: h.z[i] }));
    charge(sim);
    tick(sim, TUCK);
    const got = arcs(sim);
    expect(got.length).toBe(want);
    got.forEach((a, k) => {
      expect(a.a).toBe(k);
      expect(a.x).toBeCloseTo(pos[k].x, 4);
      expect(a.z).toBeCloseTo(pos[k].z, 4);
    });
    const dmg = STATIC.damage[1] * gearPower(sim.state.mover.gear);
    ids.forEach((i, k) => {
      if (k < want) expect(KINDS[KIND_BOLLARD].hp - h.hp[i]).toBeCloseTo(dmg, 4);
      else expect(h.hp[i]).toBe(KINDS[KIND_BOLLARD].hp);
    });
  });

  it('breaks where the next enemy is out of a jump', () => {
    const sim = rig(W_STATIC, 5);
    const near = line(sim, 2, 3, 5);
    const beyond = pointAt(sim, 8 + STATIC.jump + 0.5);
    const b = place(sim, KIND_BOLLARD, beyond.x, beyond.z);
    charge(sim);
    tick(sim, TUCK);
    expect(arcs(sim).length).toBe(2);
    const h = sim.world.horde;
    for (const i of near) expect(h.hp[i]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
    expect(h.hp[b]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('never strikes the same enemy twice in one discharge', () => {
    const sim = rig(W_STATIC, 5);
    // Two close together and nothing else: the chain is two long, not eight.
    line(sim, 2, 3, 2);
    charge(sim);
    tick(sim, TUCK);
    const got = arcs(sim);
    expect(got.length).toBe(2);
    expect(Math.hypot(got[0].x - got[1].x, got[0].z - got[1].z)).toBeGreaterThan(1);
  });

  it('passes over an enemy that is still rising', () => {
    const sim = rig(W_STATIC, 3);
    const r = pointAt(sim, 2);
    const rising = placeRising(sim, KIND_SHUFFLER, r.x, r.z);
    const [first] = line(sim, 1, 5, 0);
    charge(sim);
    tick(sim, TUCK);
    const got = arcs(sim);
    expect(got.length).toBe(1);
    const h = sim.world.horde;
    expect(h.hp[rising]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(h.hp[first]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
  });

  it('passes over an enemy that is already dead', () => {
    const sim = rig(W_STATIC, 3);
    const w = sim.world;
    const d = pointAt(sim, 2);
    const dead = place(sim, KIND_SHUFFLER, d.x, d.z);
    const [first] = line(sim, 1, 5, 0);
    w.horde.hp[dead] = 0;
    charge(sim);
    w.fx.count = 0;
    rebuildGrid(w);
    stepStatic(w, sim.state, sim.terrain, 3);
    const got = arcs(sim);
    expect(got.length).toBe(1);
    expect(got[0].x).toBeCloseTo(w.horde.x[first], 4);
    expect(got[0].z).toBeCloseTo(w.horde.z[first], 4);
  });

  it('level 5 does more than level 1', () => {
    const dealt = (level: number): number => {
      const sim = rig(W_STATIC, level);
      const ids = line(sim, 8, 3, 4);
      for (let t = 0; t < 600; t++) {
        tick(sim, FORWARD, { speed: SPEED });
        // Keep the line just ahead and alive.
        ids.forEach((i, k) => {
          const p = pointAt(sim, 3 + 4 * k);
          sim.world.horde.x[i] = p.x;
          sim.world.horde.z[i] = p.z;
        });
      }
      return ids.reduce((a, i) => a + KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[i], 0);
    };
    const one = dealt(1);
    const five = dealt(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one * 3);
  });

  it('discharging every tick into a packed crowd never overflows the effect queue', () => {
    const sim = rig(W_STATIC, 5);
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399;
      const r = 1.5 + Math.sqrt(k) * 0.5;
      place(sim, KIND_SHUFFLER, Math.sin(a) * r, Math.cos(a) * r);
    }
    for (let t = 0; t < 300; t++) {
      for (let i = 0; i < sim.world.horde.count; i++) sim.world.horde.hp[i] = 1e6;
      charge(sim);
      tick(sim, TUCK);
      expect(sim.world.fx.count).toBeLessThanOrEqual(MAX_FX);
      expect(arcs(sim).length).toBe(STATIC.chain[4]);
    }
  });
});
