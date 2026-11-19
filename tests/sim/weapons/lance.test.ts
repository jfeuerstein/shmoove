/** What a player would notice about the Lance: a beam, always on, burns whatever is ahead. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_LANCE } from '../../../src/sim/arsenal';
import { setPassiveLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { LANCE, lanceLength, stepLance } from '../../../src/sim/weapons/lance';
import { KIND_BOLLARD, KIND_SHUFFLER, KINDS, MAX_FX, rebuildGrid } from '../../../src/sim/world';
import { FORWARD, HOP, steer, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { haste, placeRising, pointAt, rig, tick, ticksIn } from './rig';

const STILL_CARVE = steer(0, 0);

/** Damage a bollard `d` m ahead takes over `ticks`, standing still in `gear` with `input`. */
function burn(sim: Sim, d: number, ticks: number, gear: number, input = TUCK, bearing = 0): number {
  const p = pointAt(sim, d, bearing);
  const b = place(sim, KIND_BOLLARD, p.x, p.z);
  // Tough enough to outlast any burn here.
  sim.world.horde.hp[b] = 1e4;
  for (let t = 0; t < ticks; t++) tick(sim, input, { gear });
  return 1e4 - sim.world.horde.hp[b];
}

describe('the beam', () => {
  it('is on all the time, tucked or carving, in any gear, as long as the level says', () => {
    for (let level = 1; level <= 5; level++) {
      const sim = rig(W_LANCE, level);
      for (let gear = 1; gear <= 5; gear++) {
        tick(sim, TUCK, { gear });
        expect(lanceLength(sim.world, sim.state)).toBe(LANCE.length[level - 1]);
        tick(sim, STILL_CARVE, { gear });
        expect(lanceLength(sim.world, sim.state)).toBe(LANCE.length[level - 1]);
      }
    }
    const off = rig(W_LANCE, 0);
    tick(off, TUCK, { gear: 4 });
    expect(lanceLength(off.world, off.state)).toBe(0);
  });

  it('is longer and wider with more area', () => {
    const sim = rig(W_LANCE, 1);
    setPassiveLevel(sim.world, P_WIDE_LOAD, 5);
    tick(sim, TUCK, { gear: 2 });
    const area = sim.world.player.stats.area;
    const len = lanceLength(sim.world, sim.state);
    expect(len).toBeCloseTo(LANCE.length[0] * area, 5);
    // Beside the beam by more than its plain half-width but less than the widened one.
    const side = KINDS[KIND_SHUFFLER].radius + LANCE.halfWidth * (1 + area) * 0.5;
    const p = pointAt(sim, 3);
    const m = sim.state.mover;
    const e = place(sim, KIND_SHUFFLER, p.x + Math.cos(m.heading) * side, p.z - Math.sin(m.heading) * side);
    const h = sim.world.horde;
    h.hp[e] = 1000;
    for (let t = 0; t < 12; t++) tick(sim, TUCK, { gear: 2 });
    expect(h.hp[e]).toBeLessThan(1000);
  });
});

describe('what it hits', () => {
  it('everything ahead in its length and width, at its stated rate, every tenth of a second', () => {
    const sim = rig(W_LANCE, 2);
    const len = LANCE.length[1];
    const br = KINDS[KIND_BOLLARD].radius;
    const m = sim.state.mover;
    const right = (d: number, side: number): number => {
      const p = pointAt(sim, d);
      return place(sim, KIND_BOLLARD, p.x + Math.cos(m.heading) * side, p.z - Math.sin(m.heading) * side);
    };
    const near = right(2.5, 0);
    const end = right(len + br - 0.2, 0);
    const edge = right(5, LANCE.halfWidth + br - 0.1);
    const beyond = right(len + br + 0.3, 0);
    const beside = right(5, -(LANCE.halfWidth + br + 0.3));
    const back = right(-3, 0);
    const h = sim.world.horde;
    const hits: number[] = [];
    for (let t = 0; t < 60; t++) {
      const before = h.hp[near];
      tick(sim, TUCK, { gear: 2 });
      if (h.hp[near] < before) hits.push(t + 1);
    }
    // One second of beam: the stated damage a second, in ten even doses a tenth of a second apart,
    // the first after one full wait.
    const dps = LANCE.dps[1] * sim.world.player.stats.might;
    for (const i of [near, end, edge]) expect(KINDS[KIND_BOLLARD].hp - h.hp[i]).toBeCloseTo(dps, 3);
    for (const i of [beyond, beside, back]) expect(h.hp[i]).toBe(KINDS[KIND_BOLLARD].hp);
    const wait = ticksIn(LANCE.wait);
    expect(hits.length).toBe(10);
    expect(hits[0]).toBe(wait);
    for (let k = 1; k < hits.length; k++) expect(hits[k] - hits[k - 1]).toBe(wait);
  });

  it('the same carving, tucked, hopping, in gear 1 or 5; and nothing at level 0', () => {
    const held = burn(rig(W_LANCE, 3), 3, 120, 3);
    expect(held).toBeGreaterThan(0);
    expect(burn(rig(W_LANCE, 3), 3, 120, 3, STILL_CARVE)).toBeCloseTo(held, 2);
    expect(burn(rig(W_LANCE, 3), 3, 120, 1)).toBeCloseTo(held, 2);
    expect(burn(rig(W_LANCE, 3), 3, 120, 5)).toBeCloseTo(held, 2);
    expect(burn(rig(W_LANCE, 0), 3, 300, 3)).toBe(0);
    // Riding at a held speed with a hop in it, the bollard kept the same distance ahead.
    const sim = rig(W_LANCE, 3);
    const p = pointAt(sim, 3);
    const b = place(sim, KIND_BOLLARD, p.x, p.z);
    for (let t = 0; t < 120; t++) {
      tick(sim, t === 30 ? HOP : FORWARD, { speed: 14, gear: 4 });
      const q = pointAt(sim, 3);
      sim.world.horde.x[b] = q.x;
      sim.world.horde.z[b] = q.z;
    }
    expect(KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[b]).toBeCloseTo(held, 2);
  });

  it('Haste burns more often, in proportion', () => {
    const plain = burn(rig(W_LANCE, 3), 3, 600, 1);
    const sim = rig(W_LANCE, 3);
    const k = haste(sim, 5);
    const quick = burn(sim, 3, 600, 1);
    expect(quick / plain).toBeCloseTo(1 / k, 1);
  });

  it('never touches an enemy that is still rising', () => {
    const sim = rig(W_LANCE, 5);
    const p = pointAt(sim, 3);
    const e = placeRising(sim, KIND_SHUFFLER, p.x, p.z);
    const h = sim.world.horde;
    for (let t = 0; t < 120; t++) {
      h.age[e] = 0;
      tick(sim, TUCK, { gear: 4 });
    }
    expect(h.hp[e]).toBe(KINDS[KIND_SHUFFLER].hp);
  });

  it('a dead enemy in the beam stays as it is', () => {
    const sim = rig(W_LANCE, 5);
    const w = sim.world;
    tick(sim, TUCK, { gear: 4 });
    const p = pointAt(sim, 3);
    const dead = place(sim, KIND_SHUFFLER, p.x, p.z);
    w.horde.hp[dead] = -2;
    w.fx.count = 0;
    rebuildGrid(w);
    for (let t = 0; t < 12; t++) stepLance(w, sim.state, sim.terrain, 5);
    expect(w.horde.hp[dead]).toBe(-2);
    expect(w.horde.flash[dead]).toBe(0);
  });

  it('level 5 burns harder than level 1', () => {
    const one = burn(rig(W_LANCE, 1), 3, 120, 3);
    const five = burn(rig(W_LANCE, 5), 3, 120, 3);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeCloseTo((one * LANCE.dps[4]) / LANCE.dps[0], 1);
  });

  it('a packed crowd in the beam does not flood the effect queue', () => {
    const sim = rig(W_LANCE, 5);
    for (let k = 0; k < 400; k++) {
      const p = pointAt(sim, 1 + (k % 14), ((k * 0.37) % 1.2) - 0.6);
      place(sim, KIND_SHUFFLER, p.x, p.z);
    }
    for (let t = 0; t < 120; t++) {
      for (let i = 0; i < sim.world.horde.count; i++) sim.world.horde.hp[i] = 1e6;
      tick(sim, TUCK, { gear: 5 });
      expect(sim.world.fx.count).toBeLessThanOrEqual(MAX_FX);
    }
  });
});
