/** What a player would notice about the Wake: the trail burns, and a closed loop pops. */
import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/sim/constants';
import type { Sim } from '../../src/sim/sim';
import { wakeLength, WAKE_STEP } from '../../src/sim/wake';
import { KIND_BOLLARD, KIND_SHUFFLER, KINDS } from '../../src/sim/world';
import { FORWARD, run, steer } from './fixtures';
import { arena, FX_POP, place, root, stepCounting } from './world-fixtures';

/** A steady left-hand circle with a circumference inside the trail's length. */
const CIRCLE = steer(-0.6, 0.8);

/** Run the circle with nothing in it and report its centre and radius. */
function traceCircle(): { cx: number; cz: number; r: number } {
  const sim = arena();
  sim.world.player.wakeLevel = 0;
  run(sim, FORWARD, 60);
  run(sim, CIRCLE, 240);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < 400; i++) {
    sim.step(CIRCLE);
    const m = sim.state.mover;
    minX = Math.min(minX, m.x);
    maxX = Math.max(maxX, m.x);
    minZ = Math.min(minZ, m.z);
    maxZ = Math.max(maxZ, m.z);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: (maxX - minX) / 2 };
}

/** The same ride with the Wake on: straight, then the circle. */
function rideCircle(sim: Sim, ticks: number, counts: Map<number, number>): void {
  for (let t = 0; t < 60; t++) {
    root(sim.world);
    sim.step(FORWARD);
  }
  for (let t = 0; t < ticks; t++) {
    root(sim.world);
    stepCounting(sim, CIRCLE, 1, counts);
  }
}

describe('the trail', () => {
  it('is laid behind the mover and never longer than its length for the gear', () => {
    const sim = arena();
    run(sim, FORWARD, 600);
    const k = sim.world.wake;
    const length = (k.count - 1) * WAKE_STEP;
    expect(length).toBeGreaterThan(wakeLength(sim.world, 2) - 2 * WAKE_STEP);
    expect(length).toBeLessThanOrEqual(wakeLength(sim.world, 2));
    // Oldest first, ending at the mover.
    expect(k.z[0]).toBeLessThan(k.z[k.count - 1]);
    expect(Math.abs(k.z[k.count - 1] - sim.state.mover.z)).toBeLessThan(WAKE_STEP + 0.2);
  });

  it('fades when the mover stops', () => {
    const sim = arena();
    run(sim, FORWARD, 300);
    expect(sim.world.wake.count).toBeGreaterThan(20);
    run(sim, steer(0, 0), FEEL.wakeLifeTicks + 120);
    expect(sim.world.wake.count).toBeLessThanOrEqual(2);
  });

  it('burns what stands in it', () => {
    const sim = arena();
    // Beside the line, clear of the mover's body, inside the trail's width.
    place(sim, KIND_SHUFFLER, 1.25, 14);
    const far = place(sim, KIND_SHUFFLER, 6, 14);
    for (let t = 0; t < 400; t++) {
      root(sim.world);
      sim.step(FORWARD);
    }
    expect(sim.world.player.hp).toBe(100);
    expect(sim.world.player.kills).toBe(1);
    expect(sim.world.horde.count).toBe(1);
    expect(sim.world.horde.hp[0]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(far).toBe(1);
  });

  it('a straight line never pops', () => {
    const sim = arena();
    const counts = new Map<number, number>();
    stepCounting(sim, FORWARD, 900, counts);
    expect(counts.get(FX_POP) ?? 0).toBe(0);
  });
});

describe('the loop', () => {
  const c = traceCircle();

  it('fits inside the trail (the test circle is a fair one)', () => {
    expect(2 * Math.PI * c.r).toBeLessThan(wakeLength(arena().world, 2) - 4);
    expect(2 * Math.PI * c.r).toBeGreaterThan(FEEL.wakeLoopMin + 2);
  });

  it('pops everything inside it at once, and nothing outside', () => {
    const sim = arena();
    const inside = 7;
    for (let i = 0; i < inside; i++) {
      const a = (i / inside) * Math.PI * 2;
      place(sim, KIND_SHUFFLER, c.cx + Math.cos(a) * c.r * 0.4, c.cz + Math.sin(a) * c.r * 0.4);
    }
    place(sim, KIND_SHUFFLER, c.cx + c.r + 6, c.cz);
    place(sim, KIND_SHUFFLER, c.cx, c.cz - c.r - 6);
    const counts = new Map<number, number>();

    let killsBefore = 0;
    let popTickKills = -1;
    for (let t = 0; t < 60; t++) {
      root(sim.world);
      sim.step(FORWARD);
    }
    for (let t = 0; t < 420 && popTickKills < 0; t++) {
      root(sim.world);
      killsBefore = sim.world.player.kills;
      stepCounting(sim, CIRCLE, 1, counts);
      if ((counts.get(FX_POP) ?? 0) > 0) popTickKills = sim.world.player.kills - killsBefore;
    }
    expect(popTickKills).toBe(inside);
    expect(sim.world.player.pops).toBe(1);
    expect(sim.world.player.bestPop).toBe(inside);
    expect(sim.world.horde.count).toBe(2);
    expect(sim.world.horde.hp[0]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(sim.world.horde.hp[1]).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(sim.world.player.hp).toBe(100);
  });

  it('spends the trail: one lap, one pop', () => {
    const sim = arena();
    const counts = new Map<number, number>();
    rideCircle(sim, 60 * 12, counts);
    const laps = (12 * FEEL.runSpeed) / (2 * Math.PI * c.r);
    const pops = counts.get(FX_POP) ?? 0;
    expect(pops).toBeGreaterThanOrEqual(Math.floor(laps) - 1);
    expect(pops).toBeLessThanOrEqual(Math.ceil(laps));
  });

  it('sweeps the sparks inside it to the player and leaves the rest', () => {
    const sim = arena();
    const s = sim.world.sparks;
    // One in the middle of the loop, far outside the magnet; one well outside the loop.
    s.count = 2;
    s.x[0] = c.cx;
    s.z[0] = c.cz;
    s.value[0] = 3;
    s.x[1] = c.cx + c.r + 12;
    s.z[1] = c.cz;
    s.value[1] = 2;
    const counts = new Map<number, number>();
    rideCircle(sim, 480, counts);
    expect(counts.get(FX_POP) ?? 0).toBeGreaterThan(0);
    // The swept one flew in and was taken; the other has not moved.
    expect(sim.world.player.xp).toBe(3);
    expect(s.count).toBe(1);
    expect(s.value[0]).toBe(2);
    expect(s.pull[0]).toBe(0);
    expect(s.x[0]).toBeCloseTo(c.cx + c.r + 12, 3);
  });

  it('hits harder in a higher gear', () => {
    const left = (gear: number): number => {
      const sim = arena();
      const b = place(sim, KIND_BOLLARD, c.cx, c.cz);
      const counts = new Map<number, number>();
      for (let t = 0; t < 60; t++) {
        root(sim.world);
        sim.step(FORWARD);
      }
      for (let t = 0; t < 420 && (counts.get(FX_POP) ?? 0) === 0; t++) {
        root(sim.world);
        // Hold the gear without changing the ride: the pop reads the gear, not the speed.
        sim.state.mover.gear = gear;
        sim.state.mover.gearHold = 0;
        stepCounting(sim, CIRCLE, 1, counts);
      }
      expect(counts.get(FX_POP) ?? 0).toBe(1);
      return sim.world.horde.hp[b];
    };
    const slow = KINDS[KIND_BOLLARD].hp - left(2);
    const fast = KINDS[KIND_BOLLARD].hp - left(4);
    expect(slow).toBeGreaterThan(20);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });
});
