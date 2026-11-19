/** What a player would notice about the Slipstream: from gear 2 your draft pulls sparks and small fry into your line. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_SLIPSTREAM } from '../../../src/sim/arsenal';
import { setPassiveLevel } from '../../../src/sim/build';
import { DT } from '../../../src/sim/constants';
import type { Sim } from '../../../src/sim/sim';
import { SLIPSTREAM, slipstreamLength, stepSlipstream } from '../../../src/sim/weapons/slipstream';
import { KIND_BOLLARD, KIND_SHUFFLER, MAX_ENEMIES, MAX_SPARKS, rebuildGrid } from '../../../src/sim/world';
import { FORWARD, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { placeRising, pointAt, rig, tick } from './rig';

/** A point `back` m behind the mover and `side` m to its right. */
function behind(sim: Sim, back: number, side: number): { x: number; z: number } {
  const m = sim.state.mover;
  const fx = Math.sin(m.heading);
  const fz = Math.cos(m.heading);
  // Right of the heading is (cos h, -sin h).
  return { x: m.x - fx * back + fz * side, z: m.z - fz * back - fx * side };
}

/** Where an enemy is relative to the mover: how far back and how far right. */
function offset(sim: Sim, i: number): { back: number; side: number } {
  const m = sim.state.mover;
  const h = sim.world.horde;
  const fx = Math.sin(m.heading);
  const fz = Math.cos(m.heading);
  const dx = h.x[i] - m.x;
  const dz = h.z[i] - m.z;
  return { back: -(dx * fx + dz * fz), side: dx * fz - dz * fx };
}

function addSpark(sim: Sim, x: number, z: number): number {
  const s = sim.world.sparks;
  const i = s.count++;
  s.x[i] = x;
  s.y[i] = 0.4;
  s.z[i] = z;
  s.value[i] = 1;
  s.pull[i] = 0;
  return i;
}

/** Standing still, held in `gear` (speed has nothing to do with the draft; the gear does). */
function stand(sim: Sim, ticks: number, gear: number): void {
  for (let t = 0; t < ticks; t++) tick(sim, TUCK, { gear });
}

describe('the draft', () => {
  it('is there from gear 2 up, as long as the level says, times area', () => {
    for (let level = 1; level <= 5; level++) {
      const sim = rig(W_SLIPSTREAM, level);
      stand(sim, 1, 1);
      expect(slipstreamLength(sim.world, sim.state, level)).toBe(0);
      for (let gear = 2; gear <= 5; gear++) {
        stand(sim, 1, gear);
        expect(slipstreamLength(sim.world, sim.state, level)).toBe(SLIPSTREAM.length[level - 1]);
      }
    }
    const wide = rig(W_SLIPSTREAM, 2);
    setPassiveLevel(wide.world, P_WIDE_LOAD, 4);
    stand(wide, 1, 3);
    expect(slipstreamLength(wide.world, wide.state, 2)).toBeCloseTo(SLIPSTREAM.length[1] * wide.world.player.stats.area, 5);
    expect(slipstreamLength(wide.world, wide.state, 0)).toBe(0);
  });

  it('sets sparks behind the mover flying to it, and only those in the cone', () => {
    const sim = rig(W_SLIPSTREAM, 1);
    const len = SLIPSTREAM.length[0];
    const tan = Math.tan((SLIPSTREAM.halfAngleDegrees * Math.PI) / 180);
    const at = (back: number, side: number): number => {
      const p = behind(sim, back, side);
      return addSpark(sim, p.x, p.z);
    };
    const inCone = at(6, 6 * tan - 0.3);
    const wide = at(6, 6 * tan + 0.4);
    const beyond = at(len + 0.5, 0);
    const ahead = at(-6, 0);
    stand(sim, 1, 2);
    const s = sim.world.sparks;
    expect(s.pull[inCone]).toBe(1);
    expect(s.pull[wide]).toBe(0);
    expect(s.pull[beyond]).toBe(0);
    expect(s.pull[ahead]).toBe(0);
  });

  it('does nothing in gear 1 or at level 0', () => {
    for (const [level, gear] of [
      [3, 1],
      [0, 3],
    ]) {
      const sim = rig(W_SLIPSTREAM, level);
      const p = behind(sim, 6, 0);
      const spark = addSpark(sim, p.x, p.z);
      const q = behind(sim, 5, 1.5);
      const e = place(sim, KIND_SHUFFLER, q.x, q.z);
      const before = offset(sim, e);
      stand(sim, 60, gear);
      expect(sim.world.sparks.pull[spark]).toBe(0);
      expect(offset(sim, e).side).toBeCloseTo(before.side, 5);
    }
  });
});

describe('what it drags', () => {
  it('light enemies in the cone, sideways to the line behind the mover at the stated speed, and no further', () => {
    const sim = rig(W_SLIPSTREAM, 1);
    const q = behind(sim, 5, 1.5);
    const e = place(sim, KIND_SHUFFLER, q.x, q.z);
    // Far enough apart along the line that they never jostle when both are on it.
    const l = behind(sim, 7.5, -1.2);
    const left = place(sim, KIND_SHUFFLER, l.x, l.z);
    stand(sim, 30, 2);
    const rate = SLIPSTREAM.draw[0];
    expect(offset(sim, e).side).toBeCloseTo(1.5 - 30 * DT * rate, 3);
    expect(offset(sim, e).back).toBeCloseTo(5, 3);
    expect(offset(sim, left).side).toBeCloseTo(-1.2 + 30 * DT * rate, 3);
    stand(sim, 60, 2);
    // On the line, and not dragged past it.
    expect(offset(sim, e).side).toBeCloseTo(0, 5);
    expect(offset(sim, left).side).toBeCloseTo(0, 5);
  });

  it('leaves heavy enemies, enemies outside the cone and enemies still rising where they are', () => {
    const sim = rig(W_SLIPSTREAM, 5);
    const h = sim.world.horde;
    const b = behind(sim, 6, 1.5);
    const heavy = place(sim, KIND_BOLLARD, b.x, b.z);
    const o = behind(sim, 3, 3);
    const outside = place(sim, KIND_SHUFFLER, o.x, o.z);
    const f = pointAt(sim, 4, 0.3);
    const ahead = place(sim, KIND_SHUFFLER, f.x, f.z);
    const r = behind(sim, 5, 1);
    const rising = placeRising(sim, KIND_SHUFFLER, r.x, r.z);
    const start = [heavy, outside, ahead, rising].map((i) => offset(sim, i));
    for (let t = 0; t < 60; t++) {
      h.age[rising] = 0;
      tick(sim, TUCK, { gear: 3 });
    }
    [heavy, outside, ahead, rising].forEach((i, k) => {
      expect(offset(sim, i).side).toBeCloseTo(start[k].side, 5);
      expect(offset(sim, i).back).toBeCloseTo(start[k].back, 5);
    });
  });

  it('leaves the dead where they fell', () => {
    const sim = rig(W_SLIPSTREAM, 5);
    const w = sim.world;
    stand(sim, 1, 3);
    const q = behind(sim, 5, 1.5);
    const dead = place(sim, KIND_SHUFFLER, q.x, q.z);
    w.horde.hp[dead] = 0;
    rebuildGrid(w);
    stepSlipstream(w, sim.state, sim.terrain, 5);
    expect(w.horde.x[dead]).toBe(Math.fround(q.x));
    expect(w.horde.z[dead]).toBe(Math.fround(q.z));
  });

  it('level 5 reaches further and drags harder than level 1', () => {
    const moved = (level: number): number => {
      const sim = rig(W_SLIPSTREAM, level);
      const near = behind(sim, 6, 2);
      const far = behind(sim, 13, 4);
      const a = place(sim, KIND_SHUFFLER, near.x, near.z);
      const b = place(sim, KIND_SHUFFLER, far.x, far.z);
      stand(sim, 20, 2);
      return 2 - offset(sim, a).side + (4 - offset(sim, b).side);
    };
    const one = moved(1);
    const five = moved(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one * 2);
  });

  it('a full horde and a full field of sparks in the draft stay within their pools', () => {
    const sim = rig(W_SLIPSTREAM, 5);
    for (let k = 0; k < 400; k++) {
      const p = behind(sim, 1 + (k % 15), ((k * 7) % 13) - 6);
      place(sim, KIND_SHUFFLER, p.x, p.z);
    }
    for (let k = 0; k < MAX_SPARKS - 10; k++) {
      const p = behind(sim, 6 + (k % 10), ((k * 3) % 9) - 4);
      addSpark(sim, p.x, p.z);
    }
    for (let t = 0; t < 120; t++) {
      tick(sim, FORWARD, { speed: 8, gear: 5 });
      expect(sim.world.horde.count).toBeLessThanOrEqual(MAX_ENEMIES);
      expect(sim.world.sparks.count).toBeLessThanOrEqual(MAX_SPARKS);
    }
    expect(sim.world.horde.count).toBe(400);
  });
});
