/** What a player would notice about Crumbs: a mine at your feet every second or so goes off under whoever comes near. */
import { describe, expect, it } from 'vitest';
import { P_WIDE_LOAD, W_CRUMBS } from '../../../src/sim/arsenal';
import { setPassiveLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { CRUMBS, stepCrumbs } from '../../../src/sim/weapons/crumbs';
import {
  addZone,
  FX_BLAST,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  KINDS,
  MAX_ZONES,
  rebuildGrid,
  ZONE_MINE,
  ZONE_TAR } from '../../../src/sim/world';
import { FORWARD, TUCK } from '../fixtures';
import { place } from '../world-fixtures';
import { haste, placeRising, rig, tick, ticksIn } from './rig';

const SPEED = 10;

function mines(sim: Sim): number[] {
  const zn = sim.world.zones;
  const out: number[] = [];
  for (let i = 0; i < zn.count; i++) if (zn.kind[i] === ZONE_MINE) out.push(i);
  return out;
}

/** Ride until a mine is down, then stop dead. Returns where the mine is. */
function dropOne(sim: Sim): { x: number; z: number } {
  for (let t = 0; t < 600 && mines(sim).length === 0; t++) tick(sim, FORWARD, { speed: SPEED });
  const m = sim.state.mover;
  m.vx = 0;
  m.vz = 0;
  const [i] = mines(sim);
  return { x: sim.world.zones.x[i], z: sim.world.zones.z[i] };
}

describe('laying', () => {
  it('drops a mine on the ground at the mover\'s feet every wait, the first after a full wait, standing or riding', () => {
    for (const level of [1, 5]) {
      for (const speed of [0, SPEED]) {
        const sim = rig(W_CRUMBS, level);
        const at: number[] = [];
        let seen = 0;
        for (let t = 1; t <= 600; t++) {
          tick(sim, speed > 0 ? FORWARD : TUCK, { speed });
          const ms = mines(sim);
          if (ms.length > seen) {
            const i = ms[ms.length - 1];
            const zn = sim.world.zones;
            const m = sim.state.mover;
            expect(zn.y[i]).toBeCloseTo(sim.terrain.heightAt(zn.x[i], zn.z[i]), 5);
            expect(zn.x[i]).toBeCloseTo(m.x, 5);
            expect(zn.z[i]).toBeCloseTo(m.z, 5);
            at.push(t);
          }
          seen = ms.length;
        }
        const wait = ticksIn(CRUMBS.wait[level - 1]);
        expect(at.length).toBe(Math.floor(600 / wait));
        expect(at[0]).toBe(wait);
      }
    }
  });

  it('Haste drops them more often, in proportion', () => {
    const sim = rig(W_CRUMBS, 2);
    const k = haste(sim, 5);
    let laid = 0;
    let seen = 0;
    for (let t = 0; t < ticksIn(30); t++) {
      tick(sim, FORWARD, { speed: SPEED });
      const n = mines(sim).length;
      if (n > seen) laid++;
      seen = n;
    }
    expect(Math.abs(laid - 30 / (CRUMBS.wait[1] * k))).toBeLessThanOrEqual(1);
  });

  it('drops nothing at level 0', () => {
    const off = rig(W_CRUMBS, 0);
    for (let t = 0; t < 600; t++) tick(off, FORWARD, { speed: SPEED });
    expect(mines(off).length).toBe(0);
  });

  it('keeps at most 12 down: a new one takes the oldest one\'s place', () => {
    const sim = rig(W_CRUMBS, 5);
    haste(sim, 5);
    let first: { x: number; z: number } | null = null;
    let peak = 0;
    for (let t = 0; t < 900; t++) {
      tick(sim, FORWARD, { speed: SPEED });
      const ms = mines(sim);
      if (!first && ms.length === 1) first = { x: sim.world.zones.x[ms[0]], z: sim.world.zones.z[ms[0]] };
      peak = Math.max(peak, ms.length);
      expect(ms.length).toBeLessThanOrEqual(CRUMBS.maxMines);
    }
    expect(peak).toBe(CRUMBS.maxMines);
    const zn = sim.world.zones;
    const stillThere = mines(sim).some((i) => first && zn.x[i] === first.x && zn.z[i] === first.z);
    expect(stillThere).toBe(false);
  });

  it('a mine nobody steps near is gone after 600 ticks', () => {
    const sim = rig(W_CRUMBS, 1);
    const at = dropOne(sim);
    const there = (): boolean => {
      const zn = sim.world.zones;
      return mines(sim).some((i) => zn.x[i] === at.x && zn.z[i] === at.z);
    };
    // Riding on, so the mines laid since are elsewhere.
    for (let t = 0; t < CRUMBS.lifeTicks - 2; t++) tick(sim, FORWARD, { speed: SPEED });
    expect(there()).toBe(true);
    for (let t = 0; t < 3; t++) tick(sim, FORWARD, { speed: SPEED });
    expect(there()).toBe(false);
  });

  it('leaves zones that are not mines alone, and never overflows a nearly full pool', () => {
    const sim = rig(W_CRUMBS, 5);
    const w = sim.world;
    for (let k = 0; k < MAX_ZONES - 4; k++) addZone(w, ZONE_TAR, 400 + k, 0, 400, 2, 60000, 1);
    for (let t = 0; t < 600; t++) {
      tick(sim, FORWARD, { speed: 30 });
      expect(w.zones.count).toBeLessThanOrEqual(MAX_ZONES);
    }
    let tar = 0;
    for (let i = 0; i < w.zones.count; i++) if (w.zones.kind[i] === ZONE_TAR) tar++;
    expect(tar).toBe(MAX_ZONES - 4);
    expect(mines(sim).length).toBe(4);
  });
});

describe('going off', () => {
  it('only once armed, 20 ticks after it was dropped', () => {
    const sim = rig(W_CRUMBS, 1);
    const at = dropOne(sim);
    // Something walks onto it straight away.
    place(sim, KIND_BOLLARD, at.x, at.z);
    let ticks = 0;
    let blasts = 0;
    while (blasts === 0 && ticks < 100) {
      blasts = tick(sim, TUCK, {}, FX_BLAST);
      ticks++;
    }
    expect(blasts).toBe(1);
    expect(ticks).toBe(CRUMBS.armTicks);
    expect(mines(sim).length).toBe(0);
  });

  it('when a risen enemy comes within 1.2 m of it, not further', () => {
    const r = CRUMBS.trigger + KINDS[KIND_SHUFFLER].radius;
    const blastsWith = (d: number): number => {
      const sim = rig(W_CRUMBS, 1);
      const at = dropOne(sim);
      place(sim, KIND_SHUFFLER, at.x + d, at.z);
      let n = 0;
      for (let t = 0; t < 60; t++) n += tick(sim, TUCK, {}, FX_BLAST);
      return n;
    };
    expect(blastsWith(r - 0.1)).toBe(1);
    expect(blastsWith(r + 0.3)).toBe(0);
  });

  it('hurts everything in the blast, for the stated damage, and nothing beyond it', () => {
    const sim = rig(W_CRUMBS, 2);
    const at = dropOne(sim);
    const R = CRUMBS.radius[1];
    const br = KINDS[KIND_BOLLARD].radius;
    // Bollards survive the blast, so what it did to each can be read off.
    const trip = place(sim, KIND_BOLLARD, at.x, at.z + 0.5);
    const edge = place(sim, KIND_BOLLARD, at.x + R + br - 0.2, at.z);
    const beyond = place(sim, KIND_BOLLARD, at.x - (R + br + 0.3), at.z);
    let radius = -1;
    let blasts = 0;
    for (let t = 0; t < 30; t++) {
      tick(sim, TUCK);
      const f = sim.world.fx;
      for (let i = 0; i < f.count; i++) {
        if (f.type[i] !== FX_BLAST) continue;
        radius = f.a[i];
        blasts++;
      }
    }
    expect(blasts).toBe(1);
    expect(radius).toBeCloseTo(R, 5);
    const h = sim.world.horde;
    const dmg = CRUMBS.damage[1] * sim.world.player.stats.might;
    expect(KINDS[KIND_BOLLARD].hp - h.hp[trip]).toBeCloseTo(dmg, 4);
    expect(KINDS[KIND_BOLLARD].hp - h.hp[edge]).toBeCloseTo(dmg, 4);
    expect(h.hp[beyond]).toBe(KINDS[KIND_BOLLARD].hp);
    expect(mines(sim).length).toBe(0);
  });

  it('a wider blast with more area', () => {
    const sim = rig(W_CRUMBS, 1);
    setPassiveLevel(sim.world, P_WIDE_LOAD, 5);
    const at = dropOne(sim);
    place(sim, KIND_SHUFFLER, at.x, at.z);
    let radius = -1;
    for (let t = 0; t < 30; t++) {
      tick(sim, TUCK);
      const f = sim.world.fx;
      for (let i = 0; i < f.count; i++) if (f.type[i] === FX_BLAST) radius = f.a[i];
    }
    expect(radius).toBeCloseTo(CRUMBS.radius[0] * sim.world.player.stats.area, 5);
  });

  it('is not set off by, and does not hurt, an enemy still rising', () => {
    const sim = rig(W_CRUMBS, 1);
    const at = dropOne(sim);
    const rising = placeRising(sim, KIND_SHUFFLER, at.x, at.z);
    const h = sim.world.horde;
    let blasts = 0;
    for (let t = 0; t < 60; t++) {
      h.age[rising] = 0;
      blasts += tick(sim, TUCK, {}, FX_BLAST);
    }
    expect(blasts).toBe(0);
    expect(mines(sim).length).toBe(1);
    // A risen one sets it off; the rising one beside it takes nothing.
    place(sim, KIND_BOLLARD, at.x + 1, at.z);
    for (let t = 0; t < 5; t++) {
      h.age[rising] = 0;
      blasts += tick(sim, TUCK, {}, FX_BLAST);
    }
    expect(blasts).toBe(1);
    expect(h.hp[rising]).toBe(KINDS[KIND_SHUFFLER].hp);
  });

  it('is not set off by an enemy already dead', () => {
    const sim = rig(W_CRUMBS, 1);
    const w = sim.world;
    const at = dropOne(sim);
    for (let t = 0; t < CRUMBS.armTicks + 2; t++) tick(sim, TUCK);
    const dead = place(sim, KIND_SHUFFLER, at.x, at.z);
    w.horde.hp[dead] = 0;
    w.fx.count = 0;
    rebuildGrid(w);
    stepCrumbs(w, sim.state, sim.terrain, 1);
    expect(mines(sim).length).toBe(1);
  });

  it('level 5 blasts harder and wider than level 1', () => {
    const dealt = (level: number): number => {
      const sim = rig(W_CRUMBS, level);
      const at = dropOne(sim);
      const ring: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ring.push(place(sim, KIND_BOLLARD, at.x + Math.sin(a) * 5, at.z + Math.cos(a) * 5));
      }
      place(sim, KIND_SHUFFLER, at.x, at.z);
      for (let t = 0; t < 30; t++) tick(sim, TUCK);
      let lost = 0;
      for (let i = 0; i < sim.world.horde.count; i++) lost += KINDS[KIND_BOLLARD].hp - sim.world.horde.hp[i];
      return lost;
    };
    const one = dealt(1);
    const five = dealt(5);
    expect(one).toBe(0);
    expect(five).toBeGreaterThan(0);
  });
});
