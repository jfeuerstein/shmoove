import { stepGear } from './flow';
import { makeMover, stepMover } from './mover';
import type { Terrain } from './terrain';
import type { InputFrame, MoverState, SimState } from './types';

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

/**
 * The whole game state and the only way to advance it. One step is 1/60 s.
 *
 * `prev` is the state before the last step, kept so the renderer can interpolate.
 */
export class Sim {
  readonly terrain: Terrain;
  readonly state: SimState;
  readonly prev: SimState;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.state = makeState(terrain);
    this.prev = makeState(terrain);
  }

  step(input: InputFrame): void {
    copySimState(this.prev, this.state);
    const s = this.state;
    s.events = 0;
    stepMover(s, input, this.terrain);
    stepGear(s);
    s.tick++;
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
