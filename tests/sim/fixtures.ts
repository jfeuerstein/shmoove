/** Analytic terrains and input helpers for mover tests. */
import { Sim } from '../../src/sim/sim';
import { terrainFromHeight, type Terrain } from '../../src/sim/terrain';
import { makeInputFrame, type InputFrame } from '../../src/sim/types';

/** A plane that falls `slope` metres per metre toward +z. */
export function slopeTerrain(slope: number, radius = 2000): Terrain {
  return terrainFromHeight((_x, z) => -slope * z, radius);
}

function ease(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Flat, then a table across the path: a smooth rise of `height` over `run` metres starting at
 * z = `at`, a flat top `top` metres long, and a smooth drop. Fast movers fly off the crest.
 */
export function tableTerrain(at: number, run: number, height: number, top: number, radius = 2000): Terrain {
  return terrainFromHeight((_x, z) => height * (ease((z - at) / run) - ease((z - at - run - top) / run)), radius);
}

/** A valley along z: a parabola across x, `depth` metres deep at the walls `halfWidth` away. */
export function halfPipeTerrain(halfWidth: number, depth: number, fall = 0, radius = 2000): Terrain {
  return terrainFromHeight((x, z) => {
    const u = Math.min(1, Math.abs(x) / halfWidth);
    return depth * u * u - fall * z;
  }, radius);
}

export const TUCK: InputFrame = makeInputFrame();
export const FORWARD: InputFrame = { steerX: 0, steerY: 1, carve: true, hop: false };
export const HOP: InputFrame = { steerX: 0, steerY: 0, carve: false, hop: true };

export function steer(x: number, y: number, hop = false): InputFrame {
  return { steerX: x, steerY: y, carve: true, hop };
}

export function run(sim: Sim, input: InputFrame, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step(input);
}

/** Give the mover a speed along its heading without going through the controls. */
export function launch(sim: Sim, speed: number): void {
  const m = sim.state.mover;
  m.vx = Math.sin(m.heading) * speed;
  m.vz = Math.cos(m.heading) * speed;
  m.speed = speed;
}
