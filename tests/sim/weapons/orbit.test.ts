/** What a player would notice about the Orbit: discs circle you as fast as you move, and cut what they pass. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_ORBIT } from '../../../src/sim/arsenal';
import { gearPower } from '../../../src/sim/balance';
import { setPassiveLevel } from '../../../src/sim/build';
import { TAU } from '../../../src/sim/math';
import type { Sim } from '../../../src/sim/sim';
import type { Vec3 } from '../../../src/sim/types';
import { ORBIT, orbitDisc, stepOrbit } from '../../../src/sim/weapons/orbit';
import { KIND_SHUFFLER, KINDS, rebuildGrid, WEAPON_MEM } from '../../../src/sim/world';
import { FORWARD, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { placeRising, rideThroughCrowd, rig, tick } from './rig';

const SPEED = 10;
const v: Vec3 = { x: 0, y: 0, z: 0 };

function discs(sim: Sim): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < 8; k++) {
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    if (!orbitDisc(sim.world, sim.state, k, p)) break;
    out.push(p);
  }
  return out;
}

function angleOf(sim: Sim, k = 0): number {
  orbitDisc(sim.world, sim.state, k, v);
  return Math.atan2(v.x - sim.state.mover.x, v.z - sim.state.mover.z);
}

/**
 * Keep enemies at fixed offsets to the mover's right while riding forward at a held speed: (side
 * distance, along). Returns the health each lost over `ticks`.
 */
function sideRide(sim: Sim, offsets: [number, number][], ticks: number, gear?: number, rising = false): number[] {
  const h = sim.world.horde;
  const ids = offsets.map(() => (rising ? placeRising(sim, KIND_SHUFFLER, 0, 0) : place(sim, KIND_SHUFFLER, 0, 0)));
  const start = ids.map(() => 1e6);
  for (let t = 0; t < ticks; t++) {
    const m = sim.state.mover;
    offsets.forEach(([side, along], j) => {
      const i = ids[j];
      // The mover rides along +z; its right is -x.
      h.x[i] = m.x - side;
      h.z[i] = m.z + along;
      if (t === 0) h.hp[i] = start[j];
      if (rising) h.age[i] = 0;
    });
    tick(sim, FORWARD, { speed: SPEED, gear });
  }
  return ids.map((i, j) => start[j] - h.hp[i]);
}

describe('the discs', () => {
  it('are evenly spaced on a circle around the mover, as many as the level says', () => {
    for (let level = 1; level <= 5; level++) {
      const sim = rig(W_ORBIT, level);
      tick(sim, FORWARD, { speed: SPEED });
      const d = discs(sim);
      expect(d.length).toBe(ORBIT.discs[level - 1]);
      const m = sim.state.mover;
      for (let k = 0; k < d.length; k++) {
        expect(Math.hypot(d[k].x - m.x, d[k].z - m.z)).toBeCloseTo(ORBIT.radius, 5);
        const gap = (((angleOf(sim, (k + 1) % d.length) - angleOf(sim, k)) % TAU) + TAU) % TAU;
        expect(gap).toBeCloseTo(TAU / d.length, 5);
      }
    }
    expect(discs(rig(W_ORBIT, 0)).length).toBe(0);
  });

  it('sit further out with more area', () => {
    const sim = rig(W_ORBIT, 1);
    setPassiveLevel(sim.world, P_WIDE_LOAD, 3);
    const d = discs(sim);
    const m = sim.state.mover;
    expect(Math.hypot(d[0].x - m.x, d[0].z - m.z)).toBeCloseTo(ORBIT.radius * sim.world.player.stats.area, 5);
  });

  it('turn half a radian per metre travelled', () => {
    const sim = rig(W_ORBIT, 2);
    tick(sim, FORWARD, { speed: SPEED });
    const a0 = angleOf(sim);
    const d0 = sim.state.distance;
    for (let t = 0; t < 30; t++) tick(sim, FORWARD, { speed: SPEED });
    const turned = (((angleOf(sim) - a0) % TAU) + TAU) % TAU;
    const metres = sim.state.distance - d0;
    expect(metres).toBeGreaterThan(4);
    expect(turned).toBeCloseTo((metres * ORBIT.turnPerMetre) % TAU, 2);
  });

  it('stand still when the mover stands still, and hit nothing', () => {
    const sim = rig(W_ORBIT, 5);
    tick(sim, TUCK);
    const a0 = angleOf(sim);
    const m = sim.state.mover;
    // An enemy right on a disc.
    orbitDisc(sim.world, sim.state, 0, v);
    const e = place(sim, KIND_SHUFFLER, v.x, v.z);
    for (let t = 0; t < 300; t++) tick(sim, TUCK);
    expect(Math.hypot(m.vx, m.vz)).toBe(0);
    expect(angleOf(sim)).toBe(a0);
    expect(sim.world.horde.hp[e]).toBe(KINDS[KIND_SHUFFLER].hp);
  });
});

describe('what they hit', () => {
  const r = ORBIT.radius;
  const reach = ORBIT.reach + KINDS[KIND_SHUFFLER].radius;

  it('what the circle passes over, for the stated damage a strike, and nothing well inside or outside it', () => {
    const sim = rig(W_ORBIT, 2);
    const [onRing, inside, outside] = sideRide(
      sim,
      [
        [r, 0],
        [r - reach - 0.3, 0],
        [r + reach + 0.3, 0],
      ],
      600,
    );
    const hit = ORBIT.damage[1] * gearPower(sim.state.mover.gear);
    expect(onRing).toBeGreaterThan(0);
    // Whole strikes only.
    expect(onRing / hit).toBeCloseTo(Math.round(onRing / hit), 5);
    expect(inside).toBe(0);
    expect(outside).toBe(0);
  });

  it('each disc strikes at most once every 12 ticks, the discs taking turns', () => {
    const sim = rig(W_ORBIT, 5);
    const n = ORBIT.discs[4];
    // A ring of enemies all round the circle, so every disc always has something to strike.
    const ring: [number, number][] = [];
    for (let k = 0; k < 18; k++) ring.push([Math.sin((k / 18) * TAU) * r, Math.cos((k / 18) * TAU) * r]);
    const h = sim.world.horde;
    const ids = ring.map(() => place(sim, KIND_SHUFFLER, 0, 0));
    let strikeTicks = 0;
    const ticks = 600;
    for (let t = 0; t < ticks; t++) {
      const m = sim.state.mover;
      ring.forEach(([dx, dz], j) => {
        h.x[ids[j]] = m.x + dx;
        h.z[ids[j]] = m.z + dz;
        h.hp[ids[j]] = 1e6;
      });
      tick(sim, FORWARD, { speed: SPEED });
      let struck = false;
      for (const i of ids) if (h.hp[i] < 1e6) struck = true;
      if (struck) strikeTicks++;
    }
    // At most one disc a tick, each at most once in 12: n strikes per 12 ticks at the most...
    expect(strikeTicks).toBeLessThanOrEqual(Math.ceil((ticks * n) / ORBIT.cooldown) + n);
    // ...and with something always in reach, close to that.
    expect(strikeTicks).toBeGreaterThan(((ticks * n) / ORBIT.cooldown) * 0.9);
  });

  it('never touches an enemy that is still rising', () => {
    const sim = rig(W_ORBIT, 5);
    const [lost] = sideRide(sim, [[r, 0]], 600, undefined, true);
    expect(lost).toBe(0);
  });

  it('a dead enemy under a disc does not use up its strike', () => {
    const sim = rig(W_ORBIT, 1);
    const w = sim.world;
    const s = sim.state;
    const h = w.horde;
    // Moving, so the discs strike; one disc stands on a dead enemy, the other on nothing.
    tick(sim, FORWARD, { speed: SPEED });
    orbitDisc(w, s, 0, v);
    const dead = place(sim, KIND_SHUFFLER, v.x, v.z);
    h.hp[dead] = 0;
    rebuildGrid(w);
    stepOrbit(w, s, sim.terrain, 1);
    // The next tick a live one is under the same disc: if the dead one had used the strike, the
    // disc would still be cooling down.
    orbitDisc(w, s, 0, v);
    const live = place(sim, KIND_SHUFFLER, v.x, v.z);
    rebuildGrid(w);
    stepOrbit(w, s, sim.terrain, 1);
    expect(h.hp[live]).toBeLessThan(KINDS[KIND_SHUFFLER].hp);
    expect(h.hp[dead]).toBe(0);
  });

  it('nothing happens at level 0', () => {
    const sim = rig(W_ORBIT, 0);
    const [lost] = sideRide(sim, [[r, 0]], 600);
    expect(lost).toBe(0);
  });

  it('level 5 cuts more than level 1', () => {
    const ring: [number, number][] = [];
    for (let k = 0; k < 12; k++) ring.push([Math.sin((k / 12) * TAU) * r, Math.cos((k / 12) * TAU) * r]);
    const total = (level: number): number => sideRide(rig(W_ORBIT, level), ring, 600).reduce((a, b) => a + b, 0);
    const one = total(1);
    const five = total(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one * 3);
  });

  it('keeps to its own memory', () => {
    const sim = rig(W_ORBIT, 5);
    sideRide(sim, [[r, 0]], 300);
    for (let i = 0; i < sim.world.mem.length; i++) {
      if (Math.floor(i / WEAPON_MEM) !== W_ORBIT) expect(sim.world.mem[i]).toBe(0);
    }
  });
});

describe('gears', () => {
  it('the same ride in a higher gear kills more', () => {
    const hp = ORBIT.damage[2] * gearPower(2) * 2;
    const low = rideThroughCrowd(rig(W_ORBIT, 3), 2, 60 * 30, hp);
    const high = rideThroughCrowd(rig(W_ORBIT, 3), 4, 60 * 30, hp);
    expect(low.kills).toBeGreaterThan(5);
    expect(high.kills).toBeGreaterThan(low.kills * 1.2);
    expect(high.damage).toBeGreaterThan(low.damage);
  });
});
