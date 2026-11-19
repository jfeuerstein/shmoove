import { RUN_TICKS } from './balance';
import { stepContact } from './contact';
import { stepGear } from './flow';
import { makeMover, stepMover } from './mover';
import type { Terrain } from './terrain';
import type { InputFrame, MoverState, SimState } from './types';
import { stepWake } from './wake';
import { makeWorld, PHASE_PLAY, PHASE_WON, reapHorde, rebuildGrid, resetWorld, type World } from './world';

function copyMover(dst: MoverState, src: MoverState): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.heading = src.heading;
  dst.speed = src.speed;
  dst.grounded = src.grounded;
  dst.tucked = src.tucked;
  dst.sliding = src.sliding;
  dst.latched = src.latched;
  dst.latchYaw = src.latchYaw;
  dst.airTicks = src.airTicks;
  dst.groundTicks = src.groundTicks;
  dst.hopBuffer = src.hopBuffer;
  dst.chain = src.chain;
  dst.landPending = src.landPending;
  dst.landSpeed = src.landSpeed;
  dst.impact = src.impact;
  dst.padCooldown = src.padCooldown;
  dst.gear = src.gear;
  dst.gearHold = src.gearHold;
  dst.nx = src.nx;
  dst.ny = src.ny;
  dst.nz = src.nz;
}

export function copySimState(dst: SimState, src: SimState): void {
  dst.tick = src.tick;
  dst.viewYaw = src.viewYaw;
  dst.events = src.events;
  dst.distance = src.distance;
  copyMover(dst.mover, src.mover);
}

function makeState(terrain: Terrain): SimState {
  return { tick: 0, viewYaw: terrain.spawnYaw, events: 0, distance: 0, mover: makeMover(terrain) };
}

export interface SimOptions {
  /** Seed for everything random in the run. */
  seed?: number;
  /** A run with the horde, health and a clock. Without it the sim is only the mover on the terrain. */
  horde?: boolean;
}

/**
 * One tick of everything that is not the mover. The order matters: the horde moves, the grid is
 * rebuilt, then everything that hurts enemies runs against stable indices, and only then are the
 * dead removed and their sparks dropped.
 */
function stepWorld(w: World, s: SimState, _terrain: Terrain): void {
  w.fx.count = 0;
  w.deaths.count = 0;

  // [director] spawns and recycles, if w.spawning
  // [horde] moves
  rebuildGrid(w);
  stepContact(w, s);
  if (w.run.phase !== PHASE_PLAY) return;
  stepWake(w, s);
  // [seekers] fires and flies shots
  reapHorde(w);
  // [sparks] drops, magnet, XP and levels

  w.run.ticks++;
  if (w.run.ticks >= RUN_TICKS) w.run.phase = PHASE_WON;
}

/**
 * The whole game state and the only way to advance it. One step is 1/60 s.
 *
 * `prev` is the mover's state before the last step, kept so the renderer can interpolate. The
 * world (horde, sparks, shots) is not copied; draw it from its velocities.
 */
export class Sim {
  readonly terrain: Terrain;
  readonly state: SimState;
  readonly prev: SimState;
  readonly world: World;
  /** True for a run with the horde; false for the mover alone. */
  readonly horde: boolean;

  constructor(terrain: Terrain, options: SimOptions = {}) {
    this.terrain = terrain;
    this.state = makeState(terrain);
    this.prev = makeState(terrain);
    this.world = makeWorld(options.seed ?? 1);
    this.horde = options.horde === true;
  }

  step(input: InputFrame): void {
    copySimState(this.prev, this.state);
    const s = this.state;
    s.events = 0;
    if (this.horde && this.world.run.phase !== PHASE_PLAY) {
      // The run is over: the world holds still until `reset`.
      this.world.fx.count = 0;
      this.world.deaths.count = 0;
      return;
    }
    stepMover(s, input, this.terrain);
    stepGear(s);
    if (this.horde) stepWorld(this.world, s, this.terrain);
    s.tick++;
  }

  /** Start the run again from the spawn, same seed, in place. */
  reset(): void {
    const fresh = makeState(this.terrain);
    copySimState(this.state, fresh);
    copySimState(this.prev, fresh);
    resetWorld(this.world);
  }
}

/** A cheap fingerprint of the state, for determinism tests. */
export function hashSimState(s: SimState): number {
  const m = s.mover;
  const f = new Float64Array([m.x, m.y, m.z, m.vx, m.vy, m.vz, s.viewYaw, s.distance]);
  const b = new Uint32Array(f.buffer);
  let h = (0x811c9dc5 ^ s.tick ^ (m.gear << 20) ^ (m.chain << 24)) >>> 0;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193) >>> 0;
  return h;
}
