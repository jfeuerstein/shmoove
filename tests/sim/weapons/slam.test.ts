/** What a player would notice about the Slam: a shockwave round you every few seconds, moving or not. */
import { describe, expect, it } from 'vitest';
import { P_MIGHT, P_WIDE_LOAD, W_SLAM } from '../../../src/sim/arsenal';
import { setPassiveLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { SLAM, slamRadius } from '../../../src/sim/weapons/slam';
import { FX_SLAM, KIND_BOLLARD, KIND_SHUFFLER, KINDS, MAX_FX } from '../../../src/sim/world';
import { FORWARD, HOP, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { countFx, haste, placeRising, rig, tick, ticksIn } from './rig';

/** Step until the first wave (at most one wait and a tick); returns the tick's FX index, or -1. */
function untilWave(sim: Sim, level: number): number {
  for (let t = 0; t <= ticksIn(SLAM.wait[level - 1]); t++) {
    tick(sim, TUCK);
    const f = sim.world.fx;
    for (let i = 0; i < f.count; i++) if (f.type[i] === FX_SLAM) return i;
  }
  return -1;
}

describe('when it fires', () => {
  it('one wave every wait, the first after a full wait, centred on the mover', () => {
    const sim = rig(W_SLAM, 1);
    const wait = ticksIn(SLAM.wait[0]);
    let first = -1;
    let waves = 0;
    for (let t = 1; t <= wait * 3; t++) {
      const n = tick(sim, TUCK, {}, FX_SLAM);
      if (n > 0 && first < 0) {
        first = t;
        const f = sim.world.fx;
        for (let i = 0; i < f.count; i++) {
          if (f.type[i] !== FX_SLAM) continue;
          expect(f.x[i]).toBeCloseTo(sim.state.mover.x, 5);
          expect(f.z[i]).toBeCloseTo(sim.state.mover.z, 5);
          expect(f.a[i]).toBeCloseTo(SLAM.radius[0], 5);
        }
      }
      waves += n;
    }
    expect(first).toBe(wait);
    expect(waves).toBe(3);
  });

  it('riding, hopping and landing make no extra waves', () => {
    const sim = rig(W_SLAM, 3);
    let waves = 0;
    for (let t = 0; t < ticksIn(10); t++) waves += tick(sim, t % 40 === 0 ? HOP : FORWARD, { speed: 12 }, FX_SLAM);
    expect(waves).toBe(Math.floor(10 / SLAM.wait[2]));
  });

  it('a faster wait with Haste', () => {
    const sim = rig(W_SLAM, 1);
    const k = haste(sim, 3);
    let waves = 0;
    for (let t = 0; t < ticksIn(40); t++) waves += tick(sim, TUCK, {}, FX_SLAM);
    expect(Math.abs(waves - 40 / (SLAM.wait[0] * k))).toBeLessThanOrEqual(1);
  });

  it('nothing at level 0', () => {
    const sim = rig(W_SLAM, 0);
    const b = place(sim, KIND_BOLLARD, 2.5, 0);
    let waves = 0;
    for (let t = 0; t < ticksIn(10); t++) waves += tick(sim, TUCK, {}, FX_SLAM);
    expect(waves).toBe(0);
    expect(sim.world.horde.hp[b]).toBe(KINDS[KIND_BOLLARD].hp);
  });
});

describe('what it hits', () => {
  it('everything whose body is inside the wave, for the stated damage, and nothing beyond it', () => {
    const r = slamRadius(2, 1);
    const br = KINDS[KIND_BOLLARD].radius;
    const sim = rig(W_SLAM, 2);
    const inside = place(sim, KIND_BOLLARD, r + br - 0.3, 0);
    const outside = place(sim, KIND_BOLLARD, 0, -(r + br + 0.4));
    expect(untilWave(sim, 2)).toBeGreaterThanOrEqual(0);
    const h = sim.world.horde;
    expect(KINDS[KIND_BOLLARD].hp - h.hp[inside]).toBeCloseTo(SLAM.damage[1], 4);
    expect(h.hp[outside]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('kills a ring of shufflers round the mover in one blow', () => {
    const sim = rig(W_SLAM, 3);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      place(sim, KIND_SHUFFLER, Math.sin(a) * 3, Math.cos(a) * 3);
    }
    expect(untilWave(sim, 3)).toBeGreaterThanOrEqual(0);
    expect(sim.world.player.kills).toBe(8);
  });

  it('hits harder with might', () => {
    const sim = rig(W_SLAM, 1);
    setPassiveLevel(sim.world, P_MIGHT, 3);
    const b = place(sim, KIND_BOLLARD, 2.5, 0);
    untilWave(sim, 1);
    expect(KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[b]).toBeCloseTo(SLAM.damage[0] * sim.world.player.stats.might, 4);
    expect(sim.world.player.stats.might).toBeGreaterThan(1);
  });

  it('never touches an enemy that is still rising', () => {
    const sim = rig(W_SLAM, 5);
    const e = placeRising(sim, KIND_SHUFFLER, 2, 0);
    const h = sim.world.horde;
    for (let t = 0; t < ticksIn(SLAM.wait[4]) + 2; t++) {
      h.age[e] = 0;
      tick(sim, TUCK);
    }
    expect(h.hp[e]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(h.vx[e]).toBe(0);
    expect(h.vz[e]).toBe(0);
  });

  it('a dead enemy in the wave is counted dead once and takes nothing more', () => {
    const sim = rig(W_SLAM, 5);
    place(sim, KIND_BOLLARD, -2.5, 0);
    const dead = place(sim, KIND_SHUFFLER, 2.5, 0);
    const h = sim.world.horde;
    const wait = ticksIn(SLAM.wait[4]);
    for (let t = 0; t < wait - 1; t++) tick(sim, TUCK);
    // Killed on the tick of the wave by something else: it must not soak up the wave.
    h.hp[dead] = 0;
    expect(tick(sim, TUCK, {}, FX_SLAM)).toBe(1);
    expect(sim.world.player.kills).toBe(1);
    expect(h.count).toBe(1);
    expect(h.hp[0]).toBeCloseTo(KINDS[KIND_BOLLARD].hp - SLAM.damage[4], 4);
  });
});

describe('its wave', () => {
  it('is as wide as the level says, times area', () => {
    for (let level = 1; level <= 5; level++) expect(slamRadius(level, 1)).toBe(SLAM.radius[level - 1]);
    expect(slamRadius(0, 1)).toBe(0);
    const wide = rig(W_SLAM, 4);
    setPassiveLevel(wide.world, P_WIDE_LOAD, 5);
    const area = wide.world.player.stats.area;
    expect(area).toBeGreaterThan(1.4);
    const at = untilWave(wide, 4);
    expect(wide.world.fx.a[at]).toBeCloseTo(SLAM.radius[3] * area, 4);
    expect(slamRadius(4, area)).toBeCloseTo(SLAM.radius[3] * area, 6);
  });

  it('throws light enemies straight out from the mover, and not heavy ones', () => {
    const sim = rig(W_SLAM, 1);
    const light = place(sim, KIND_SHUFFLER, 3, 0);
    const back = place(sim, KIND_SHUFFLER, 0, -3);
    const heavy = place(sim, KIND_BOLLARD, -3, 0);
    const h = sim.world.horde;
    for (let t = 0; t < ticksIn(SLAM.wait[0]); t++) {
      h.hp[light] = 1000;
      h.hp[back] = 1000;
      tick(sim, TUCK);
    }
    // Read straight after the wave's tick, before anything roots them again.
    expect(h.vx[light]).toBeCloseTo(SLAM.throwSpeed, 3);
    expect(Math.abs(h.vz[light])).toBeLessThan(0.5);
    expect(h.vz[back]).toBeCloseTo(-SLAM.throwSpeed, 3);
    expect(h.stun[light]).toBeGreaterThan(0);
    expect(h.vx[heavy]).toBe(0);
    expect(h.vz[heavy]).toBe(0);
  });

  it('one standing right on the mover is thrown along the heading', () => {
    const sim = rig(W_SLAM, 1);
    const m = sim.state.mover;
    const e = place(sim, KIND_SHUFFLER, m.x, m.z);
    const h = sim.world.horde;
    for (let t = 0; t < ticksIn(SLAM.wait[0]); t++) {
      h.hp[e] = 1000;
      h.x[e] = m.x;
      h.z[e] = m.z;
      tick(sim, TUCK);
    }
    const hs = Math.hypot(h.vx[e], h.vz[e]);
    expect(hs).toBeCloseTo(SLAM.throwSpeed, 3);
    expect(h.vx[e] / hs).toBeCloseTo(Math.sin(m.heading), 4);
    expect(h.vz[e] / hs).toBeCloseTo(Math.cos(m.heading), 4);
  });

  it('level 5 hits harder, wider and more often than level 1', () => {
    expect(SLAM.damage[4]).toBeGreaterThan(SLAM.damage[0]);
    expect(SLAM.radius[4]).toBeGreaterThan(SLAM.radius[0]);
    expect(SLAM.wait[4]).toBeLessThan(SLAM.wait[0]);
    const hurt = (level: number): number => {
      const sim = rig(W_SLAM, level);
      const b = place(sim, KIND_BOLLARD, 2.5, 0);
      const h = sim.world.horde;
      let lost = 0;
      for (let t = 0; t < ticksIn(20); t++) {
        tick(sim, TUCK);
        lost += KINDS[KIND_BOLLARD].hp - h.hp[b];
        h.hp[b] = KINDS[KIND_BOLLARD].hp;
      }
      return lost;
    };
    expect(hurt(5)).toBeGreaterThan(hurt(1) * 2);
  });

  it('a wave through a packed crowd never overflows the effect queue', () => {
    const sim = rig(W_SLAM, 5);
    haste(sim, 5);
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399;
      const r = 1.5 + Math.sqrt(k) * 0.3;
      place(sim, KIND_SHUFFLER, Math.sin(a) * r, Math.cos(a) * r);
    }
    let waves = 0;
    for (let t = 0; t < 600; t++) {
      for (let i = 0; i < sim.world.horde.count; i++) sim.world.horde.hp[i] = 1e6;
      waves += tick(sim, TUCK, {}, FX_SLAM);
      expect(sim.world.fx.count).toBeLessThanOrEqual(MAX_FX);
      expect(countFx(sim.world, FX_SLAM)).toBeLessThanOrEqual(1);
    }
    expect(waves).toBeGreaterThan(3);
  });
});
