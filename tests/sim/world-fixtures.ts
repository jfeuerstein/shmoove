/** Helpers for tests that put the mover among hand-placed enemies. */
import { Sim } from '../../src/sim/sim';
import { flatTerrain, type Terrain } from '../../src/sim/terrain';
import type { InputFrame } from '../../src/sim/types';
import { FX_POP, SPAWN_TICKS, spawnEnemy, type World } from '../../src/sim/world';

/** A run on level ground with no spawn director: the only enemies are the ones a test places. */
export function arena(terrain: Terrain = flatTerrain()): Sim {
  const sim = new Sim(terrain, { seed: 7, horde: true });
  sim.world.spawning = false;
  return sim;
}

/** Place an enemy that has already risen. Returns its index (valid until something dies). */
export function place(sim: Sim, kind: number, x: number, z: number): number {
  const i = spawnEnemy(sim.world, kind, x, sim.terrain.heightAt(x, z), z);
  sim.world.horde.age[i] = SPAWN_TICKS;
  return i;
}

/** Keep every enemy rooted to the spot (thrown enemies do not steer), without changing what hurts them. */
export function root(w: World): void {
  for (let i = 0; i < w.horde.count; i++) {
    w.horde.stun[i] = 255;
    w.horde.vx[i] = 0;
    w.horde.vz[i] = 0;
  }
}

/** Step with `input`, counting FX of each type seen. */
export function stepCounting(sim: Sim, input: InputFrame, ticks: number, counts: Map<number, number>): void {
  for (let t = 0; t < ticks; t++) {
    sim.step(input);
    const f = sim.world.fx;
    for (let i = 0; i < f.count; i++) counts.set(f.type[i], (counts.get(f.type[i]) ?? 0) + 1);
  }
}

export { FX_POP };
