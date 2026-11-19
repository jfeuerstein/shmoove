/** What a player would notice about the Skipper: every couple of seconds, stones at the nearest enemies that skip through the crowd. */
import { describe, expect, it } from 'vitest';
import { W_SKIPPER } from '../../../src/sim/arsenal';
import type { Sim } from '../../../src/sim/sim';
import { SKIPPER, stepSkipper } from '../../../src/sim/weapons/skipper';
import {
  FX_STONE,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  KINDS,
  MAX_SHOTS,
  rebuildGrid,
  SHOT_DART,
  SHOT_STONE } from '../../../src/sim/world';
import { FORWARD, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { haste, placeRising, pointAt, rig, tick, ticksIn } from './rig';

const SPEED = 10;

function stones(sim: Sim): number[] {
  const sh = sim.world.shots;
  const out: number[] = [];
  for (let i = 0; i < sh.count; i++) if (sh.kind[i] === SHOT_STONE) out.push(i);
  return out;
}

/** Stand until the first throw (one full wait). Returns the stones' FX count on that tick. */
function firstThrow(sim: Sim): number {
  const level = sim.world.player.loadout.weaponLevel[W_SKIPPER];
  let n = 0;
  for (let t = 0; t < ticksIn(SKIPPER.wait[level - 1]); t++) n = tick(sim, TUCK, {}, FX_STONE);
  return n;
}

/** Throw once standing still, then let the stones fly. Returns each enemy's damage taken, in `ids` order. */
function throwAt(sim: Sim, ids: number[], ticks = 90): number[] {
  const h = sim.world.horde;
  const full = ids.map((i) => h.hp[i]);
  firstThrow(sim);
  for (let t = 0; t < ticks; t++) tick(sim, TUCK);
  return ids.map((i, k) => full[k] - h.hp[i]);
}

/** The yaw a stone flies on. */
function yaw(sim: Sim, i: number): number {
  return Math.atan2(sim.world.shots.vx[i], sim.world.shots.vz[i]);
}

describe('throwing', () => {
  it('every wait, the first after a full wait, as many stones as the level says, standing or riding', () => {
    for (let level = 1; level <= 5; level++) {
      for (const speed of [0, SPEED]) {
        const sim = rig(W_SKIPPER, level);
        const e = place(sim, KIND_BOLLARD, 0, 0);
        const wait = ticksIn(SKIPPER.wait[level - 1]);
        const at: number[] = [];
        let thrown = 0;
        for (let t = 1; t <= 600; t++) {
          // A tough target keeping pace ahead.
          const p = pointAt(sim, 8);
          sim.world.horde.x[e] = p.x;
          sim.world.horde.z[e] = p.z;
          sim.world.horde.hp[e] = 1e6;
          const n = tick(sim, speed > 0 ? FORWARD : TUCK, { speed }, FX_STONE);
          if (n > 0) at.push(t);
          thrown += n;
        }
        expect(at.length).toBe(Math.floor(600 / wait));
        expect(at[0]).toBe(wait);
        expect(thrown).toBe(at.length * SKIPPER.stones[level - 1]);
      }
    }
  });

  it('at the nearest enemy within 20 m, at 22 m/s, low over the ground', () => {
    const sim = rig(W_SKIPPER, 1);
    const near = pointAt(sim, 9, 1.1);
    const far = pointAt(sim, 15, -0.5);
    place(sim, KIND_BOLLARD, near.x, near.z);
    place(sim, KIND_BOLLARD, far.x, far.z);
    expect(firstThrow(sim)).toBe(1);
    const [i] = stones(sim);
    const sh = sim.world.shots;
    const m = sim.state.mover;
    expect(Math.hypot(sh.vx[i], sh.vz[i])).toBeCloseTo(SKIPPER.stoneSpeed, 5);
    expect(yaw(sim, i)).toBeCloseTo(Math.atan2(near.x - m.x, near.z - m.z), 4);
    expect(sh.y[i]).toBeCloseTo(sim.terrain.heightAt(sh.x[i], sh.z[i]) + SKIPPER.height, 5);
  });

  it('along the heading with nothing within 20 m; spare stones fan 12 degrees apart', () => {
    const sim = rig(W_SKIPPER, 5);
    const out = pointAt(sim, SKIPPER.aimRange + 3, 1.2);
    place(sim, KIND_BOLLARD, out.x, out.z);
    expect(firstThrow(sim)).toBe(3);
    const fan = (SKIPPER.fanDegrees * Math.PI) / 180;
    const h = sim.state.mover.heading;
    const ys = stones(sim)
      .map((i) => yaw(sim, i) - h)
      .sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-fan, 4);
    expect(ys[1]).toBeCloseTo(0, 4);
    expect(ys[2]).toBeCloseTo(fan, 4);
  });

  it('at different enemies when there are enough, the nearest first', () => {
    const sim = rig(W_SKIPPER, 5);
    const spots = [pointAt(sim, 6, -1), pointAt(sim, 8, 1), pointAt(sim, 10, 2.5), pointAt(sim, 18, 0)];
    for (const p of spots) place(sim, KIND_BOLLARD, p.x, p.z);
    expect(firstThrow(sim)).toBe(3);
    const m = sim.state.mover;
    const ys = stones(sim).map((i) => yaw(sim, i));
    for (let k = 0; k < 3; k++) {
      const want = Math.atan2(spots[k].x - m.x, spots[k].z - m.z);
      expect(ys.some((y) => Math.abs(y - want) < 1e-4)).toBe(true);
    }
  });

  it('nothing at level 0', () => {
    const off = rig(W_SKIPPER, 0);
    const p = pointAt(off, 6);
    const e = place(off, KIND_BOLLARD, p.x, p.z);
    let thrown = 0;
    for (let t = 0; t < 600; t++) thrown += tick(off, TUCK, {}, FX_STONE);
    expect(thrown).toBe(0);
    expect(off.world.horde.hp[e]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('a stone that finds nothing is gone after 90 ticks', () => {
    const sim = rig(W_SKIPPER, 1);
    firstThrow(sim);
    expect(stones(sim).length).toBe(1);
    for (let t = 0; t < SKIPPER.life - 2; t++) tick(sim, TUCK);
    expect(stones(sim).length).toBe(1);
    for (let t = 0; t < 3; t++) tick(sim, TUCK);
    expect(stones(sim).length).toBe(0);
  });
});

describe('what a stone hits', () => {
  it('the first enemy in its way, for the stated damage', () => {
    const sim = rig(W_SKIPPER, 1);
    const far = pointAt(sim, 30);
    const near = pointAt(sim, 12);
    // Far apart, so the skip from the near one cannot reach the far one.
    const f = place(sim, KIND_BOLLARD, far.x, far.z);
    const n = place(sim, KIND_BOLLARD, near.x, near.z);
    const [df, dn] = throwAt(sim, [f, n]);
    expect(dn).toBeCloseTo(SKIPPER.damage[0] * sim.world.player.stats.might, 4);
    expect(df).toBe(0);
    expect(stones(sim).length).toBe(0);
  });

  it('then skips on to the nearest other enemy within 8 m, never back the way it came, up to its skips', () => {
    const sim = rig(W_SKIPPER, 1);
    const skips = SKIPPER.skips[0];
    // A zig-zag off to the right of the line, each 5 m from the one before, more than the skips can reach.
    const ids: number[] = [];
    const first = pointAt(sim, 8);
    ids.push(place(sim, KIND_BOLLARD, first.x, first.z));
    for (let k = 1; k < skips + 3; k++) {
      const m = sim.state.mover;
      ids.push(place(sim, KIND_BOLLARD, m.x - 4 * k, m.z + 8 + (k % 2) * 3));
    }
    // Further than a skip from all of them.
    const lone = place(sim, KIND_BOLLARD, sim.state.mover.x + 30, sim.state.mover.z + 8);
    const dealt = throwAt(sim, [...ids, lone]);
    const hit = SKIPPER.damage[0] * sim.world.player.stats.might;
    dealt.forEach((d, k) => {
      if (k <= skips) expect(d).toBeCloseTo(hit, 4);
      else expect(d).toBe(0);
    });
  });

  it('skips to the nearest, not the first placed', () => {
    const sim = rig(W_SKIPPER, 3);
    const first = pointAt(sim, 8);
    const a = place(sim, KIND_BOLLARD, first.x, first.z);
    // Both within 8 m of the first, one nearer.
    const further = place(sim, KIND_BOLLARD, first.x + 7, first.z + 1);
    const nearer = place(sim, KIND_BOLLARD, first.x - 4, first.z + 2);
    const h = sim.world.horde;
    firstThrow(sim);
    let order: number[] = [];
    for (let t = 0; t < 60; t++) {
      tick(sim, TUCK);
      for (const i of [a, nearer, further]) {
        if (h.hp[i] < KINDS[KIND_BOLLARD].hp && !order.includes(i)) order = [...order, i];
      }
    }
    expect(order.slice(0, 2)).toEqual([a, nearer]);
  });

  it('passes through an enemy that is still rising', () => {
    const sim = rig(W_SKIPPER, 1);
    const r = pointAt(sim, 6);
    const b = pointAt(sim, 14);
    const rising = placeRising(sim, KIND_SHUFFLER, r.x, r.z);
    const behind = place(sim, KIND_BOLLARD, b.x, b.z);
    const h = sim.world.horde;
    for (let t = 0; t < ticksIn(SKIPPER.wait[0]) + 60; t++) {
      h.age[rising] = 0;
      tick(sim, TUCK);
    }
    expect(h.hp[rising]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(h.hp[behind]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
  });

  it('passes through an enemy that is already dead', () => {
    const sim = rig(W_SKIPPER, 1);
    const w = sim.world;
    const s = sim.state;
    // A stone along the heading, thrown with nothing about.
    firstThrow(sim);
    const d = pointAt(sim, 4);
    const b = pointAt(sim, 9);
    const dead = place(sim, KIND_SHUFFLER, d.x, d.z);
    const behind = place(sim, KIND_BOLLARD, b.x, b.z);
    w.horde.hp[dead] = 0;
    // Step the stones alone, so the dead one is never reaped.
    for (let t = 0; t < 60; t++) {
      rebuildGrid(w);
      stepSkipper(w, s, sim.terrain, 1);
    }
    expect(w.horde.hp[dead]).toBe(0);
    expect(w.horde.hp[behind]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
  });

  it('level 5 does more with one stone than level 1', () => {
    const dealt = (level: number): number => {
      const sim = rig(W_SKIPPER, level);
      const ids: number[] = [];
      for (let k = 0; k < 8; k++) {
        const m = sim.state.mover;
        ids.push(place(sim, KIND_BOLLARD, m.x - 4 * k, m.z + 8 + (k % 2) * 3));
      }
      return throwAt(sim, ids).reduce((a, b) => a + b, 0);
    };
    const one = dealt(1);
    const five = dealt(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one * 3);
  });
});

describe('the pool', () => {
  it('throwing at the fastest rate with the shot pool nearly full never overflows it', () => {
    const sim = rig(W_SKIPPER, 5);
    haste(sim, 5);
    const sh = sim.world.shots;
    // Someone else's shots taking most of the pool (darts nobody flies, so they stay).
    for (let i = 0; i < MAX_SHOTS - 2; i++) {
      sh.kind[i] = SHOT_DART;
      sh.life[i] = 200;
      sh.x[i] = 500;
      sh.z[i] = 500;
    }
    sh.count = MAX_SHOTS - 2;
    let thrown = 0;
    for (let t = 0; t < 600; t++) {
      thrown += tick(sim, FORWARD, { speed: SPEED }, FX_STONE);
      expect(sh.count).toBeLessThanOrEqual(MAX_SHOTS);
    }
    expect(thrown).toBeGreaterThan(5);
    expect(stones(sim).length).toBeGreaterThan(0);
  });

  it('alone, the fastest rate keeps only a handful of stones in the air', () => {
    const sim = rig(W_SKIPPER, 5);
    haste(sim, 5);
    let peak = 0;
    for (let t = 0; t < 600; t++) {
      tick(sim, FORWARD, { speed: SPEED });
      peak = Math.max(peak, stones(sim).length);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(MAX_SHOTS / 4);
  });
});
