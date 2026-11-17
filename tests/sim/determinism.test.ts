import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/rng';
import { clonePlayer, hashPlayer } from '../../src/sim/sim';
import { stepPlayer } from '../../src/sim/player';
import type { InputFrame, SimCtx, SimEvent } from '../../src/sim/types';
import { newSim } from './helpers';

/** A busy, seeded input stream: carves, arms, releases and hops. */
function script(seed: number, ticks: number): InputFrame[] {
  const rng = new Rng(seed);
  const out: InputFrame[] = [];
  let steer = 0;
  let hold = false;
  for (let i = 0; i < ticks; i++) {
    if (rng.chance(0.03)) steer = rng.range(-1, 1);
    if (rng.chance(0.02)) hold = !hold;
    out.push({ steer, hold, hop: rng.chance(0.01) });
  }
  return out;
}

function play(inputs: InputFrame[]): { hashes: number[]; events: string[]; modes: Set<number> } {
  const sim = newSim();
  const hashes: number[] = [];
  const events: string[] = [];
  const modes = new Set<number>();
  for (let i = 0; i < inputs.length; i++) {
    sim.step(inputs[i]);
    for (const e of sim.events) events.push(`${i}:${e.type}`);
    modes.add(sim.player.mode);
    if (i % 300 === 0) hashes.push(sim.hash());
  }
  hashes.push(sim.hash());
  return { hashes, events, modes };
}

describe('determinism', () => {
  it('the same world, seed and inputs give bit-identical state and events', () => {
    const inputs = script(5, 60 * 150);
    const a = play(inputs);
    const b = play(inputs);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.events).toEqual(a.events);
    // The script is busy enough to mean something: it exercises most of the controller.
    expect(a.modes.size).toBeGreaterThanOrEqual(3);
    expect(a.events.some((e) => e.endsWith(':hop'))).toBe(true);
    expect(a.events.some((e) => e.endsWith(':land'))).toBe(true);
  });

  it('one changed input frame changes the outcome', () => {
    const inputs = script(99, 60 * 60);
    const a = play(inputs);
    const changed = inputs.map((f) => ({ ...f }));
    changed[100].steer = changed[100].steer > 0 ? -1 : 1;
    changed[101].steer = changed[100].steer;
    changed[102].steer = changed[100].steer;
    const b = play(changed);
    expect(b.hashes[b.hashes.length - 1]).not.toBe(a.hashes[a.hashes.length - 1]);
  });

  it('a second skater fed the recorded inputs shadows the first exactly (the ghost contract)', () => {
    const inputs = script(7, 60 * 90);
    const sim = newSim();
    const ghostEvents: SimEvent[] = [];
    const ghost: SimCtx = { world: sim.world, tick: sim.tick, player: clonePlayer(sim.player), events: ghostEvents };
    for (let i = 0; i < inputs.length; i++) {
      sim.step(inputs[i]);
      ghost.tick = sim.tick;
      ghostEvents.length = 0;
      stepPlayer(ghost, inputs[i]);
      if (i % 200 === 0) expect(hashPlayer(ghost.player, ghost.tick)).toBe(sim.hash());
    }
    expect(ghost.player).toEqual(sim.player);
  });

  it('stays finite and inside the world under any input', () => {
    for (const seed of [1, 2, 3]) {
      const inputs = script(seed, 60 * 120);
      const sim = newSim();
      for (const f of inputs) {
        sim.step(f);
        const p = sim.player;
        expect(Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz + p.heading + p.speed)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(sim.world.minX);
        expect(p.x).toBeLessThanOrEqual(sim.world.maxX);
        expect(p.z).toBeGreaterThanOrEqual(sim.world.minZ);
        expect(p.z).toBeLessThanOrEqual(sim.world.maxZ);
        expect(p.y).toBeGreaterThan(-1);
        expect(p.y).toBeLessThan(120);
      }
    }
  });
});
