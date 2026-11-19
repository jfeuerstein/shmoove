/** What a player would notice about the Lance: tucked in gear 2 or higher, a beam burns whatever is ahead. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_LANCE } from '../../../src/sim/arsenal';
import { gearPower } from '../../../src/sim/balance';
import { setPassiveLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { LANCE, lanceLength, stepLance } from '../../../src/sim/weapons/lance';
import { KIND_BOLLARD, KIND_SHUFFLER, KINDS, MAX_FX, rebuildGrid } from '../../../src/sim/world';
import { FORWARD, steer, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { placeRising, pointAt, rideThroughCrowd, rig, tick } from './rig';

const STILL_CARVE = steer(0, 0);

/** Damage a bollard `d` m ahead takes over `ticks`, standing still in `gear` with `input`. */
function burn(sim: Sim, d: number, ticks: number, gear: number, input = TUCK, bearing = 0): number {
  const p = pointAt(sim, d, bearing);
  const b = place(sim, KIND_BOLLARD, p.x, p.z);
  for (let t = 0; t < ticks; t++) tick(sim, input, { gear });
  return KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[b];
}

describe('the beam', () => {
  it('is on only while tucked in gear 2 or higher, and grows by 1.5 m a gear', () => {
    const sim = rig(W_LANCE, 3);
    tick(sim, TUCK, { gear: 1 });
    expect(lanceLength(sim.world, sim.state)).toBe(0);
    for (let gear = 2; gear <= 5; gear++) {
      tick(sim, TUCK, { gear });
      expect(lanceLength(sim.world, sim.state)).toBeCloseTo(LANCE.length[2] + LANCE.lengthPerGear * gear, 6);
      tick(sim, STILL_CARVE, { gear });
      expect(lanceLength(sim.world, sim.state)).toBe(0);
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
    expect(len).toBeCloseTo((LANCE.length[0] + LANCE.lengthPerGear * 2) * area, 5);
    // Beside the beam by more than its plain half-width but less than the widened one.
    const side = KINDS[KIND_SHUFFLER].radius + LANCE.halfWidth * (1 + area) * 0.5;
    const p = pointAt(sim, 3);
    const m = sim.state.mover;
    const e = place(sim, KIND_SHUFFLER, p.x + Math.cos(m.heading) * side, p.z - Math.sin(m.heading) * side);
    const h = sim.world.horde;
    for (let t = 0; t < 12; t++) {
      h.hp[e] = 1000;
      tick(sim, TUCK, { gear: 2 });
    }
    expect(h.hp[e]).toBeLessThan(1000);
  });
});

describe('what it hits', () => {
  it('everything ahead in its length and width, at its stated rate, every 6 ticks', () => {
    const sim = rig(W_LANCE, 2);
    const len = LANCE.length[1] + LANCE.lengthPerGear * 2;
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
      if (h.hp[near] < before) hits.push(t);
    }
    // One second of beam: the stated damage a second, in ten even doses six ticks apart.
    const dps = LANCE.dps[1] * gearPower(2);
    for (const i of [near, end, edge]) expect(KINDS[KIND_BOLLARD].hp - h.hp[i]).toBeCloseTo(dps, 3);
    for (const i of [beyond, beside, back]) expect(h.hp[i]).toBe(KINDS[KIND_BOLLARD].hp);
    expect(hits.length).toBe(10);
    for (let k = 1; k < hits.length; k++) expect(hits[k] - hits[k - 1]).toBe(LANCE.every);
  });

  it('nothing while carving, in gear 1, or at level 0', () => {
    expect(burn(rig(W_LANCE, 5), 3, 300, 3, STILL_CARVE)).toBe(0);
    expect(burn(rig(W_LANCE, 5), 3, 300, 1)).toBe(0);
    expect(burn(rig(W_LANCE, 0), 3, 300, 3)).toBe(0);
  });

  it('flicking the tuck on and off cannot burn faster than holding it', () => {
    const held = burn(rig(W_LANCE, 3), 3, 120, 3);
    const sim = rig(W_LANCE, 3);
    const p = pointAt(sim, 3);
    const b = place(sim, KIND_BOLLARD, p.x, p.z);
    for (let t = 0; t < 120; t++) tick(sim, t % 2 === 0 ? TUCK : STILL_CARVE, { gear: 3 });
    const flicked = KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[b];
    expect(flicked).toBeGreaterThan(0);
    expect(flicked).toBeLessThanOrEqual(held + 1e-6);
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
    expect(five).toBeCloseTo((one * LANCE.dps[4]) / LANCE.dps[0], 3);
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

describe('gears', () => {
  it('the same ride in a higher gear kills more', () => {
    const hp = LANCE.dps[2] * gearPower(2);
    const low = rideThroughCrowd(rig(W_LANCE, 3), 2, 60 * 30, hp);
    const high = rideThroughCrowd(rig(W_LANCE, 3), 4, 60 * 30, hp);
    expect(low.kills).toBeGreaterThan(5);
    expect(high.kills).toBeGreaterThan(low.kills * 1.2);
  });

  it('riding tucked through a line of enemies burns them; carving the same line does not', () => {
    const run = (input: typeof TUCK): number => {
      const sim = rig(W_LANCE, 3);
      for (let k = 0; k < 10; k++) {
        const p = pointAt(sim, 6 + k * 4);
        place(sim, KIND_SHUFFLER, p.x, p.z);
      }
      for (let t = 0; t < 300; t++) tick(sim, input, { speed: 12 });
      return sim.world.player.kills;
    };
    expect(run(TUCK)).toBe(10);
    expect(run(FORWARD)).toBe(0);
  });
});
