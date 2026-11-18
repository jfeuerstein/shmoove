/** Real rides over the generated bowl: the shapes have to make (and give back) speed. */
import { describe, expect, it } from 'vitest';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { gearFloor } from '../../src/sim/flow';
import { Rng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/sim';
import type { Terrain } from '../../src/sim/terrain';
import type { InputFrame, MoverState } from '../../src/sim/types';
import { TUCK, launch, run, steer } from './fixtures';

const SEEDS = [1, 2, 3, 4, 5];
const FLOOR_R = 130;

const bowls = new Map<number, Bowl>();
function bowl(seed: number): Bowl {
  let b = bowls.get(seed);
  if (!b) {
    b = makeBowl(seed);
    bowls.set(seed, b);
  }
  return b;
}

/** The same ground with the mover starting somewhere else. */
function startAt(b: Bowl, x: number, z: number, yaw: number): Terrain {
  return {
    radius: b.radius,
    spawnX: x,
    spawnZ: z,
    spawnYaw: yaw,
    pads: b.pads,
    heightAt: (px, pz) => b.heightAt(px, pz),
    normalAt: (px, pz, out) => b.normalAt(px, pz, out),
  };
}

function allFinite(m: MoverState): boolean {
  return [m.x, m.y, m.z, m.vx, m.vy, m.vz, m.heading, m.speed, m.nx, m.ny, m.nz].every(Number.isFinite);
}

describe('riding the bowl', () => {
  it('a mover tucked from the high end of each pipe reaches gear 3 before the low end', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      for (const p of b.features.pipes) {
        const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
        const dx = (p.x1 - p.x0) / L;
        const dz = (p.z1 - p.z0) / L;
        const sim = new Sim(startAt(b, p.x0, p.z0, Math.atan2(dx, dz)));
        const m = sim.state.mover;
        let gear3At = -1;
        let along = 0;
        let top = 0;
        for (let t = 0; t < 60 * 40 && along < L; t++) {
          sim.step(TUCK);
          along = (m.x - p.x0) * dx + (m.z - p.z0) * dz;
          top = Math.max(top, m.speed);
          if (gear3At < 0 && m.gear >= 3) gear3At = along;
        }
        expect({ seed, top: Math.round(top * 10) / 10, reachedGear3: gear3At >= 0 && gear3At < L }).toEqual({
          seed,
          top: Math.round(top * 10) / 10,
          reachedGear3: true,
        });
        expect(top).toBeGreaterThanOrEqual(gearFloor(3));
      }
    }
  });

  it('movers launched at 25 m/s into the rim at 16 angles stay inside and are back on the floor within 10 s', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        const sim = new Sim(startAt(b, Math.sin(a) * 126, Math.cos(a) * 126, a));
        launch(sim, 25);
        const m = sim.state.mover;
        let onRim = false;
        let back = false;
        for (let t = 0; t < 600; t++) {
          sim.step(TUCK);
          const r = Math.hypot(m.x, m.z);
          expect(r).toBeLessThanOrEqual(b.radius + 1e-9);
          if (r > FLOOR_R + 5) onRim = true;
          if (onRim && r < FLOOR_R) {
            back = true;
            break;
          }
        }
        expect({ seed, angle: i, onRim, back }).toEqual({ seed, angle: i, onRim: true, back: true });
      }
    }
  });

  it('60 s of seeded random stick and hops never leaves the radius or produces a non-finite number', () => {
    for (const seed of SEEDS) {
      const b = bowl(seed);
      const sim = new Sim(b);
      const rng = new Rng(seed * 7919 + 13);
      const m = sim.state.mover;
      let input: InputFrame = TUCK;
      let hold = 0;
      for (let t = 0; t < 60 * 60; t++) {
        if (hold <= 0) {
          hold = 10 + rng.int(60);
          if (rng.chance(0.25)) input = TUCK;
          else {
            const ang = rng.range(-Math.PI, Math.PI);
            const mag = rng.range(0.2, 1);
            input = steer(Math.sin(ang) * mag, Math.cos(ang) * mag);
          }
        }
        hold--;
        const hop = rng.chance(1 / 30);
        sim.step(hop ? { ...input, hop: true } : input);
        expect(allFinite(m)).toBe(true);
        expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(b.radius + 1e-9);
      }
    }
  });

  it('the spawn is not a dead spot: a tucked mover is past 3 m/s within 5 s', () => {
    for (const seed of SEEDS) {
      const sim = new Sim(bowl(seed));
      let best = 0;
      for (let t = 0; t < 5 * 60; t++) {
        run(sim, TUCK, 1);
        best = Math.max(best, sim.state.mover.speed);
      }
      expect(best).toBeGreaterThan(3);
    }
  });
});
