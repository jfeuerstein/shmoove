/**
 * A restart leaves nothing behind, and nothing the run remembers lives outside what is hashed:
 * a sim that was played and reset is the same as a new one, wherever the clock is then set.
 */
import { describe, expect, it } from 'vitest';
import { makeBowl } from '../../src/sim/bowl';
import { TICK_HZ } from '../../src/sim/constants';
import { hashSimState, Sim } from '../../src/sim/sim';
import type { InputFrame } from '../../src/sim/types';
import { hashWorld } from '../../src/sim/world';

const input: InputFrame = { steerX: 0.3, steerY: 1, carve: true, hop: false };

function play(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    input.hop = i % 90 === 0;
    sim.step(input);
  }
}

function hashes(sim: Sim): string {
  return `${hashWorld(sim.world)}:${hashSimState(sim.state)}`;
}

describe('a restart', () => {
  // Just before each boss, and mid-act when lobbers, sludge and elites are due.
  for (const seconds of [0, 100, 178, 358, 538]) {
    it(`then the clock set to ${seconds} s plays as a new run does`, () => {
      const terrain = makeBowl(3);
      const used = new Sim(terrain, { seed: 3, horde: true, autoPick: true });
      used.world.run.ticks = 170 * TICK_HZ;
      play(used, 20 * TICK_HZ);
      used.reset();
      const fresh = new Sim(terrain, { seed: 3, horde: true, autoPick: true });
      expect(hashes(used)).toBe(hashes(fresh));
      used.world.run.ticks = seconds * TICK_HZ;
      fresh.world.run.ticks = seconds * TICK_HZ;
      for (let k = 0; k < 6; k++) {
        play(used, 2 * TICK_HZ);
        play(fresh, 2 * TICK_HZ);
        expect(hashes(used)).toBe(hashes(fresh));
      }
    });
  }
});
