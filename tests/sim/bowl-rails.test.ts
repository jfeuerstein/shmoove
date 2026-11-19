/**
 * The rails on real bowls, ridden with the real mover: every one can be hopped onto from its run-up
 * at run speed, a falling one gives speed back, a chain carries you from one rail to the next, and a
 * rider who never hops never grinds.
 */
import { describe, expect, it } from 'vitest';
import { makeBowl, type Bowl, type RailSite } from '../../src/sim/bowl';
import { FEEL } from '../../src/sim/constants';
import { Sim } from '../../src/sim/sim';
import type { Terrain } from '../../src/sim/terrain';
import { EV_GRIND_END, EV_GRIND_START, EV_LAND, type InputFrame } from '../../src/sim/types';
import { FORWARD, launch, steer, TUCK } from './fixtures';

const SEEDS = [1, 2, 3];
/** The clear run-up the generator leaves beyond each end, m. */
const RUN_UP = 3;

const bowls = new Map<number, Bowl>();
function bowl(seed: number): Bowl {
  let b = bowls.get(seed);
  if (!b) {
    b = makeBowl(seed);
    bowls.set(seed, b);
  }
  return b;
}

/** The same ground with the mover starting somewhere else, facing `yaw`. */
function startAt(b: Bowl, x: number, z: number, yaw: number): Terrain {
  return {
    radius: b.radius,
    spawnX: x,
    spawnZ: z,
    spawnYaw: yaw,
    pads: b.pads,
    rails: b.rails,
    heightAt: (px, pz) => b.heightAt(px, pz),
    normalAt: (px, pz, out) => b.normalAt(px, pz, out),
  };
}

/** Unit direction of a rail from its first end to its second, seen from above, and its length. */
function dirOf(r: RailSite): { ux: number; uz: number; len: number } {
  const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
  return { ux: (r.x1 - r.x0) / len, uz: (r.z1 - r.z0) / len, len };
}

/** A rider at run speed at the start of a rail's run-up, heading along it. */
function onRunUp(b: Bowl, r: RailSite): Sim {
  const { ux, uz } = dirOf(r);
  const sim = new Sim(startAt(b, r.x0 - ux * RUN_UP, r.z0 - uz * RUN_UP, Math.atan2(ux, uz)));
  launch(sim, FEEL.runSpeed);
  return sim;
}

/** How far past the rail's first end the rider is, along it, m. */
function alongRail(sim: Sim, r: RailSite): number {
  const { ux, uz } = dirOf(r);
  return (sim.state.mover.x - r.x0) * ux + (sim.state.mover.z - r.z0) * uz;
}

interface Catch {
  /** The rail caught, or -1. */
  rail: number;
  /** Horizontal speed the tick before the catch. */
  arrived: number;
}

/** Ride the run-up pushing, hop a metre short of the rail's end, and see what is caught. */
function hopOn(sim: Sim, r: RailSite): Catch {
  for (let t = 0; t < 120 && alongRail(sim, r) < -1; t++) sim.step(FORWARD);
  const hop: InputFrame = { ...TUCK, hop: true };
  sim.step(hop);
  for (let t = 0; t < 60; t++) {
    const m = sim.state.mover;
    const arrived = Math.hypot(m.vx, m.vz);
    sim.step(TUCK);
    if ((sim.state.events & EV_GRIND_START) !== 0) return { rail: sim.state.mover.rail, arrived };
    if ((sim.state.events & EV_LAND) !== 0) break;
  }
  return { rail: -1, arrived: 0 };
}

/** Grind on with no input until the board leaves the rail; the horizontal speed it leaves with. */
function grindOff(sim: Sim): number {
  for (let t = 0; t < 600; t++) {
    sim.step(TUCK);
    if ((sim.state.events & EV_GRIND_END) !== 0) return Math.hypot(sim.state.mover.vx, sim.state.mover.vz);
  }
  return -1;
}

describe('rails on the bowl', () => {
  it('every rail can be hopped onto from its run-up at run speed', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      expect(b.rails.length).toBeGreaterThanOrEqual(8);
      b.features.rails.forEach((r, i) => {
        const got = hopOn(onRunUp(b, r), r);
        expect(got.rail, `seed ${seed} rail ${i}`).toBe(i);
      });
    }
  });

  it('a level rail can be hopped onto from either end', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      b.features.rails.forEach((r, i) => {
        const fall = (b.heightAt(r.x0, r.z0) - b.heightAt(r.x1, r.z1)) / dirOf(r).len;
        if (Math.abs(fall) > 0.02) return;
        const back: RailSite = { ...r, x0: r.x1, z0: r.z1, x1: r.x0, z1: r.z0 };
        expect(hopOn(onRunUp(b, back), back).rail, `seed ${seed} rail ${i}, ridden backwards`).toBe(i);
      });
    }
  });

  it('a falling rail sends you off its end faster than you got on', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      b.features.rails.forEach((r, i) => {
        const fall = (b.heightAt(r.x0, r.z0) - b.heightAt(r.x1, r.z1)) / dirOf(r).len;
        if (fall < 0.03) return;
        const sim = onRunUp(b, r);
        const got = hopOn(sim, r);
        expect(got.rail, `seed ${seed} rail ${i}`).toBe(i);
        const left = grindOff(sim);
        expect(left, `seed ${seed} rail ${i}`).toBeGreaterThan(got.arrived + 1);
        // It ran the whole rail: it left at the far end.
        expect(Math.hypot(sim.state.mover.x - r.x1, sim.state.mover.z - r.z1)).toBeLessThan(0.5);
      });
    }
  });

  it('in a chain, riding off one rail without touching anything lands on the next', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const chains = [...new Set(b.features.rails.filter((r) => r.chain > 0).map((r) => r.chain))];
      expect(chains.length).toBeGreaterThanOrEqual(2);
      for (const c of chains) {
        const members = b.features.rails.map((r, i) => ({ r, i })).filter(({ r }) => r.chain === c);
        const sim = onRunUp(b, members[0].r);
        expect(hopOn(sim, members[0].r).rail, `seed ${seed} chain ${c}`).toBe(members[0].i);
        for (let k = 1; k < members.length; k++) {
          expect(grindOff(sim)).toBeGreaterThan(0);
          let caught = -1;
          let landed = false;
          for (let t = 0; t < 120 && caught < 0 && !landed; t++) {
            sim.step(TUCK);
            if ((sim.state.events & EV_GRIND_START) !== 0) caught = sim.state.mover.rail;
            if ((sim.state.events & EV_LAND) !== 0) landed = true;
          }
          expect(landed, `seed ${seed} chain ${c}: touched the ground before rail ${k + 1}`).toBe(false);
          expect(caught, `seed ${seed} chain ${c} rail ${k + 1}`).toBe(members[k].i);
        }
      }
    }
  });

  it('a rider who never hops never catches one', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      // Straight along every rail from its run-up, pushing, and on past its end.
      b.features.rails.forEach((r, i) => {
        const sim = onRunUp(b, r);
        const len = dirOf(r).len;
        for (let t = 0; t < 600 && alongRail(sim, r) < len + RUN_UP; t++) {
          sim.step(FORWARD);
          expect(sim.state.mover.rail, `seed ${seed} rail ${i}`).toBe(-1);
        }
      });
      // A long ride all over the bowl, weaving, never tapping.
      const sim = new Sim(b);
      let grinds = 0;
      for (let t = 0; t < 60 * 120; t++) {
        const phase = Math.floor(t / 150) % 4;
        sim.step(phase === 0 ? FORWARD : phase === 1 ? steer(0.7, 0.7) : phase === 2 ? TUCK : steer(-0.6, 0.8));
        if ((sim.state.events & EV_GRIND_START) !== 0) grinds++;
      }
      expect(grinds, `seed ${seed}`).toBe(0);
    }
  });
});
