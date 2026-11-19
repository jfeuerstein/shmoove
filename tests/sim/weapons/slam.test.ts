/** What a player would notice about the Slam: landing from a flight sends out a shockwave. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_SLAM } from '../../../src/sim/arsenal';
import { gearPower } from '../../../src/sim/balance';
import { setPassiveLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { EV_LAND } from '../../../src/sim/types';
import { SLAM, slamRadius, slamScale } from '../../../src/sim/weapons/slam';
import {
  FX_SLAM,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  KINDS,
  MAX_FX,
} from '../../../src/sim/world';
import { FORWARD, HOP, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { countFx, placeRising, rideThroughCrowd, rig, tick } from './rig';

interface Landing {
  x: number;
  z: number;
  air: number;
  impact: number;
  gear: number;
  slams: number;
  radius: number;
}

/** Lift the mover `height` m off flat ground, still, and let it fall. Returns what the landing was. */
function drop(sim: Sim, height: number, before?: () => void): Landing {
  const m = sim.state.mover;
  m.grounded = false;
  m.y = height;
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
  m.airTicks = 0;
  let slams = 0;
  let radius = 0;
  for (let t = 0; t < 200; t++) {
    before?.();
    tick(sim, TUCK);
    const f = sim.world.fx;
    for (let i = 0; i < f.count; i++) {
      if (f.type[i] !== FX_SLAM) continue;
      slams++;
      radius = f.a[i];
    }
    if ((sim.state.events & EV_LAND) !== 0) break;
  }
  return { x: m.x, z: m.z, air: m.lastAir, impact: m.impact, gear: m.gear, slams, radius };
}

/** Where a drop from `height` lands and how, found on empty ground. */
function dryDrop(height: number): Landing {
  return drop(rig(W_SLAM, 0), height);
}

/** Damage a bollard standing next to the landing takes from a drop of `height` at `level`. */
function bollardDamage(height: number, level: number): number {
  const sim = rig(W_SLAM, level);
  const b = place(sim, KIND_BOLLARD, 2.5, 0);
  drop(sim, height);
  return KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[b];
}

describe('when it fires', () => {
  it('a landing after a long enough flight slams once, where the mover landed', () => {
    const sim = rig(W_SLAM, 1);
    const l = drop(sim, 3);
    expect(l.air).toBeGreaterThanOrEqual(SLAM.minAir);
    expect(l.slams).toBe(1);
    const f = sim.world.fx;
    let at = -1;
    for (let i = 0; i < f.count; i++) if (f.type[i] === FX_SLAM) at = i;
    expect(f.x[at]).toBeCloseTo(l.x, 4);
    expect(f.z[at]).toBeCloseTo(l.z, 4);
    expect(l.radius).toBeCloseTo(slamRadius(l.air, l.impact, 1), 5);
  });

  it('an ordinary hop on the flat is flight enough', () => {
    const sim = rig(W_SLAM, 1);
    let slams = tick(sim, HOP, {}, FX_SLAM);
    for (let t = 0; t < 60; t++) slams += tick(sim, TUCK, {}, FX_SLAM);
    expect(sim.state.mover.lastAir).toBeGreaterThanOrEqual(SLAM.minAir);
    expect(slams).toBe(1);
  });

  it('a flight shorter than the minimum does not slam', () => {
    // A short fall: under 12 ticks in the air, but long enough to be a landing.
    const l = drop(rig(W_SLAM, 5), 0.25);
    expect(l.air).toBeLessThan(SLAM.minAir);
    expect(l.slams).toBe(0);
  });

  it('nothing happens without a landing, or at level 0', () => {
    const riding = rig(W_SLAM, 5);
    const b = place(riding, KIND_BOLLARD, 2, 8);
    let slams = 0;
    for (let t = 0; t < 600; t++) slams += tick(riding, FORWARD, {}, FX_SLAM);
    expect(slams).toBe(0);
    expect(riding.world.horde.hp[b]).toBe(KINDS[KIND_BOLLARD].hp);

    const off = rig(W_SLAM, 0);
    const c = place(off, KIND_BOLLARD, 2.5, 0);
    expect(drop(off, 6).slams).toBe(0);
    expect(off.world.horde.hp[c]).toBe(KINDS[KIND_BOLLARD].hp);
  });
});

describe('what it hits', () => {
  it('everything whose body is inside the wave, and nothing beyond it', () => {
    const dry = dryDrop(3);
    const r = slamRadius(dry.air, dry.impact, 1);
    const br = KINDS[KIND_BOLLARD].radius;
    const sim = rig(W_SLAM, 2);
    const inside = place(sim, KIND_BOLLARD, dry.x + r + br - 0.3, dry.z);
    const outside = place(sim, KIND_BOLLARD, dry.x, dry.z - (r + br + 0.4));
    const l = drop(sim, 3);
    expect(l.air).toBe(dry.air);
    const h = sim.world.horde;
    const expected = SLAM.damage[1] * slamScale(l.air) * gearPower(l.gear);
    expect(KINDS[KIND_BOLLARD].hp - h.hp[inside]).toBeCloseTo(expected, 3);
    expect(h.hp[outside]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('kills a crowd of shufflers around the landing in one blow', () => {
    const sim = rig(W_SLAM, 3);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      place(sim, KIND_SHUFFLER, Math.sin(a) * 3, Math.cos(a) * 3);
    }
    const l = drop(sim, 3);
    expect(l.slams).toBe(1);
    expect(sim.world.player.kills).toBe(8);
  });

  it('never touches an enemy that is still rising', () => {
    const sim = rig(W_SLAM, 5);
    const e = placeRising(sim, KIND_SHUFFLER, 2, 0);
    drop(sim, 6, () => {
      // Keep it rising for the whole fall.
      sim.world.horde.age[e] = 0;
    });
    const h = sim.world.horde;
    expect(h.hp[e]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(h.vx[e]).toBe(0);
    expect(h.vz[e]).toBe(0);
  });

  it('a dead enemy in the wave is counted dead once and takes nothing more', () => {
    const sim = rig(W_SLAM, 5);
    const alive = place(sim, KIND_BOLLARD, -2.5, 0);
    const dead = place(sim, KIND_SHUFFLER, 2.5, 0);
    const h = sim.world.horde;
    drop(sim, 6, () => {
      // Killed on the tick of the landing by something else: it must not soak up the wave.
      if (sim.state.mover.y < 0.6) h.hp[dead] = 0;
    });
    expect(sim.world.player.kills).toBe(1);
    expect(h.count).toBe(1);
    expect(h.hp[0]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
    expect(alive).toBe(0);
  });
});

describe('its effect', () => {
  it('more flight hits harder: 0.6x at the shortest flight, rising to 1.6x at 60 ticks and staying there', () => {
    expect(slamScale(SLAM.minAir - 1)).toBe(0);
    expect(slamScale(SLAM.minAir)).toBeCloseTo(SLAM.scaleMin, 6);
    expect(slamScale(SLAM.fullAir)).toBeCloseTo(SLAM.scaleMax, 6);
    expect(slamScale(SLAM.fullAir + 40)).toBeCloseTo(SLAM.scaleMax, 6);

    const short = dryDrop(0.55);
    const long = dryDrop(14);
    expect(short.air).toBeGreaterThanOrEqual(SLAM.minAir);
    expect(short.air).toBeLessThanOrEqual(SLAM.minAir + 2);
    expect(long.air).toBeGreaterThanOrEqual(SLAM.fullAir);
    // Standing still the mover is in gear 1.
    const unit = SLAM.damage[0] * gearPower(1);
    expect(bollardDamage(0.55, 1)).toBeCloseTo(unit * slamScale(short.air), 3);
    expect(bollardDamage(0.55, 1) / unit).toBeLessThan(0.7);
    expect(bollardDamage(14, 1)).toBeCloseTo(unit * SLAM.scaleMax, 3);
  });

  it('the wave grows with flight and impact and with area, and never beyond 9 m', () => {
    const low = dryDrop(1);
    const high = dryDrop(3);
    const rl = slamRadius(low.air, low.impact, 1);
    const rh = slamRadius(high.air, high.impact, 1);
    expect(rh).toBeGreaterThan(rl);
    expect(rl).toBeCloseTo(SLAM.radiusBase + SLAM.radiusPerAir * low.air + SLAM.radiusPerImpact * low.impact, 6);

    const wide = rig(W_SLAM, 1);
    setPassiveLevel(wide.world, P_WIDE_LOAD, 5);
    const lw = drop(wide, 1);
    expect(lw.radius).toBeCloseTo(rl * wide.world.player.stats.area, 4);
    expect(wide.world.player.stats.area).toBeGreaterThan(1.4);

    const huge = drop(rig(W_SLAM, 1), 14);
    expect(huge.radius).toBe(SLAM.radiusMax);
  });

  it('throws light enemies outward from the landing, and not heavy ones', () => {
    const sim = rig(W_SLAM, 1);
    const light = place(sim, KIND_SHUFFLER, 3, 0);
    const back = place(sim, KIND_SHUFFLER, 0, -3);
    const heavy = place(sim, KIND_BOLLARD, -3, 0);
    const h = sim.world.horde;
    drop(sim, 3, () => {
      h.hp[light] = 1000;
      h.hp[back] = 1000;
    });
    // Read straight after the landing tick, before anything roots them again.
    expect(h.vx[light]).toBeCloseTo(SLAM.throwSpeed, 3);
    expect(Math.abs(h.vz[light])).toBeLessThan(0.5);
    expect(h.vz[back]).toBeCloseTo(-SLAM.throwSpeed, 3);
    expect(h.stun[light]).toBeGreaterThan(0);
    expect(h.vx[heavy]).toBe(0);
    expect(h.vz[heavy]).toBe(0);
  });

  it('level 5 hits harder than level 1', () => {
    const one = bollardDamage(3, 1);
    const five = bollardDamage(3, 5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeCloseTo((one * SLAM.damage[4]) / SLAM.damage[0], 3);
  });

  it('the same ride in a higher gear kills more', () => {
    // Shufflers around as tough as a gear-2 slam from a hop, so the gear's power shows in kills.
    const hp = SLAM.damage[2] * slamScale(34) * gearPower(2);
    const low = rideThroughCrowd(rig(W_SLAM, 3), 2, 60 * 30, hp);
    const high = rideThroughCrowd(rig(W_SLAM, 3), 4, 60 * 30, hp);
    expect(low.kills).toBeGreaterThan(5);
    expect(high.kills).toBeGreaterThan(low.kills * 1.3);
  });

  it('hopping clean as fast as possible in a packed crowd never overflows the effect queue', () => {
    const sim = rig(W_SLAM, 5);
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399;
      const r = 1.5 + Math.sqrt(k) * 0.4;
      place(sim, KIND_SHUFFLER, Math.sin(a) * r, Math.cos(a) * r);
    }
    let slams = 0;
    let landings = 0;
    for (let t = 0; t < 600; t++) {
      for (let i = 0; i < sim.world.horde.count; i++) sim.world.horde.hp[i] = 1e6;
      // A tap every tick: each landing is hopped out of at once, clean.
      slams += tick(sim, HOP, {}, FX_SLAM);
      if ((sim.state.events & EV_LAND) !== 0) landings++;
      expect(sim.world.fx.count).toBeLessThanOrEqual(MAX_FX);
      expect(countFx(sim.world, FX_SLAM)).toBeLessThanOrEqual(1);
    }
    expect(landings).toBeGreaterThan(10);
    expect(slams).toBe(landings);
  });
});
