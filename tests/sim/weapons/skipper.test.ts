/** What a player would notice about the Skipper: every hop throws a stone that skips through the crowd. */
import { describe, expect, it } from 'vitest';
import { W_SKIPPER } from '../../../src/sim/arsenal';
import { gearPower } from '../../../src/sim/balance';
import type { Sim } from '../../../src/sim/sim';
import { EV_CLEAN_HOP, EV_HOP } from '../../../src/sim/types';
import { SKIPPER, stepSkipper } from '../../../src/sim/weapons/skipper';
import {
  FX_STONE,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  KINDS,
  MAX_SHOTS,
  rebuildGrid,
  SHOT_DART,
  SHOT_STONE,
} from '../../../src/sim/world';
import { FORWARD, HOP, steer, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { placeRising, pointAt, rideThroughCrowd, rig, tick } from './rig';

const SPEED = 10;
const HOP_FORWARD = steer(0, 1, true);

function stones(sim: Sim): number[] {
  const sh = sim.world.shots;
  const out: number[] = [];
  for (let i = 0; i < sh.count; i++) if (sh.kind[i] === SHOT_STONE) out.push(i);
  return out;
}

/** Ride up to speed, then hop once. Returns the stones' FX count on the hop tick. */
function rideAndHop(sim: Sim): number {
  for (let t = 0; t < 30; t++) tick(sim, FORWARD, { speed: SPEED });
  return tick(sim, HOP_FORWARD, { speed: SPEED }, FX_STONE);
}

/** Hop once standing still, then let the stone fly. Returns each enemy's damage taken, in `ids` order. */
function throwAt(sim: Sim, ids: number[], ticks = 90): number[] {
  const h = sim.world.horde;
  const full = ids.map((i) => h.hp[i]);
  tick(sim, HOP);
  for (let t = 0; t < ticks; t++) tick(sim, TUCK);
  return ids.map((i, k) => full[k] - h.hp[i]);
}

describe('throwing', () => {
  it('a hop throws one stone along the heading, at the speed plus 14 m/s, low over the ground', () => {
    const sim = rig(W_SKIPPER, 1);
    expect(rideAndHop(sim)).toBe(1);
    expect(sim.state.events & EV_CLEAN_HOP).toBe(0);
    const [i] = stones(sim);
    const sh = sim.world.shots;
    const m = sim.state.mover;
    const v = Math.hypot(sh.vx[i], sh.vz[i]);
    expect(v).toBeCloseTo(Math.hypot(m.vx, m.vz) + SKIPPER.speedBonus, 0);
    expect(Math.atan2(sh.vx[i], sh.vz[i])).toBeCloseTo(m.heading, 3);
    expect(sh.y[i]).toBeCloseTo(sim.terrain.heightAt(sh.x[i], sh.z[i]) + SKIPPER.height, 5);
  });

  it('a clean hop throws two, fanned 12 degrees apart about the heading', () => {
    const sim = rig(W_SKIPPER, 1);
    rideAndHop(sim);
    let thrown = 0;
    let clean = false;
    for (let t = 0; t < 80 && !clean; t++) {
      // Tap every tick: the tap buffered before landing hops clean on touchdown.
      thrown = tick(sim, HOP_FORWARD, { speed: SPEED }, FX_STONE);
      clean = (sim.state.events & EV_CLEAN_HOP) !== 0;
    }
    expect(clean).toBe(true);
    expect(thrown).toBe(2);
    const sh = sim.world.shots;
    // Thrown this tick (and flown one tick already).
    const fresh = stones(sim).filter((i) => sh.life[i] === SKIPPER.life - 1);
    expect(fresh.length).toBe(2);
    const a0 = Math.atan2(sh.vx[fresh[0]], sh.vz[fresh[0]]);
    const a1 = Math.atan2(sh.vx[fresh[1]], sh.vz[fresh[1]]);
    expect(Math.abs(a0 - a1)).toBeCloseTo((SKIPPER.fanDegrees * Math.PI) / 180, 4);
    expect((a0 + a1) / 2).toBeCloseTo(sim.state.mover.heading, 4);
  });

  it('no hop, no stone; and nothing at level 0', () => {
    const riding = rig(W_SKIPPER, 5);
    let thrown = 0;
    for (let t = 0; t < 600; t++) thrown += tick(riding, FORWARD, { speed: SPEED }, FX_STONE);
    expect(thrown).toBe(0);
    expect(stones(riding).length).toBe(0);

    const off = rig(W_SKIPPER, 0);
    const p = pointAt(off, 6);
    const e = place(off, KIND_BOLLARD, p.x, p.z);
    thrown = 0;
    for (let t = 0; t < 300; t++) thrown += tick(off, t % 40 === 0 ? HOP : TUCK, {}, FX_STONE);
    expect(thrown).toBe(0);
    expect(off.world.horde.hp[e]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('a stone that finds nothing is gone after 90 ticks', () => {
    const sim = rig(W_SKIPPER, 1);
    tick(sim, HOP);
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
    expect(dn).toBeCloseTo(SKIPPER.damage[0] * gearPower(1), 4);
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
    const hit = SKIPPER.damage[0] * gearPower(1);
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
    tick(sim, HOP);
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
    tick(sim, HOP);
    for (let t = 0; t < 60; t++) {
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
    tick(sim, HOP);
    const d = pointAt(sim, 4);
    const b = pointAt(sim, 9);
    const dead = place(sim, KIND_SHUFFLER, d.x, d.z);
    const behind = place(sim, KIND_BOLLARD, b.x, b.z);
    w.horde.hp[dead] = 0;
    // Step the stones alone, so the dead one is never reaped.
    s.events = 0;
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
  it('hopping clean as fast as possible with the shot pool nearly full never overflows it', () => {
    const sim = rig(W_SKIPPER, 5);
    const sh = sim.world.shots;
    // Someone else's shots taking most of the pool (darts nobody flies, so they stay).
    for (let i = 0; i < MAX_SHOTS - 3; i++) {
      sh.kind[i] = SHOT_DART;
      sh.life[i] = 200;
      sh.x[i] = 500;
      sh.z[i] = 500;
    }
    sh.count = MAX_SHOTS - 3;
    let hops = 0;
    for (let t = 0; t < 600; t++) {
      tick(sim, HOP_FORWARD, { speed: SPEED });
      if (sim.state.events & EV_HOP) hops++;
      expect(sh.count).toBeLessThanOrEqual(MAX_SHOTS);
    }
    expect(hops).toBeGreaterThan(10);
    expect(stones(sim).length).toBeGreaterThan(0);
  });

  it('alone, the fastest hopping keeps only a handful of stones in the air', () => {
    const sim = rig(W_SKIPPER, 5);
    let peak = 0;
    for (let t = 0; t < 600; t++) {
      tick(sim, HOP_FORWARD, { speed: SPEED });
      peak = Math.max(peak, stones(sim).length);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(MAX_SHOTS / 4);
  });
});

describe('gears', () => {
  it('the same ride in a higher gear kills more', () => {
    const hp = SKIPPER.damage[2] * gearPower(2) * 1.5;
    const low = rideThroughCrowd(rig(W_SKIPPER, 3), 2, 60 * 30, hp);
    const high = rideThroughCrowd(rig(W_SKIPPER, 3), 4, 60 * 30, hp);
    expect(low.kills).toBeGreaterThan(3);
    expect(high.kills).toBeGreaterThan(low.kills * 1.2);
  });
});
