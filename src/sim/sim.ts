import { applyBuildToMover, openOffer, pickCard } from './build';
import { stepBosses } from './bosses';
import { stepContact } from './contact';
import { stepDirector } from './director';
import { stepGear } from './flow';
import { stepHazards } from './hazards';
import { stepHorde } from './horde';
import { makeMover, stepMover } from './mover';
import { copyMoverMods, makeMoverMods } from './stats';
import type { Terrain } from './terrain';
import type { InputFrame, MoverState, SimState } from './types';
import { stepSparks } from './sparks';
import { placeThings, stepThings } from './things';
import { builtWeapons, stepWeapons } from './weapons';
import {
  makeWorld,
  PHASE_CHOOSE,
  PHASE_DEAD,
  PHASE_PLAY,
  PHASE_WON,
  reapHorde,
  rebuildGrid,
  resetWorld,
  type World,
} from './world';

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
  dst.lastAir = src.lastAir;
  dst.padCooldown = src.padCooldown;
  dst.rail = src.rail;
  dst.railT = src.railT;
  dst.railDir = src.railDir;
  dst.railCooldown = src.railCooldown;
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
  copyMoverMods(dst.mods, src.mods);
  copyMover(dst.mover, src.mover);
}

/** A fresh state at the spawn. */
export function makeSimState(terrain: Terrain): SimState {
  return { tick: 0, viewYaw: terrain.spawnYaw, events: 0, distance: 0, mods: makeMoverMods(), mover: makeMover(terrain) };
}

export interface SimOptions {
  /** Seed for everything random in the run. */
  seed?: number;
  /** A run with the horde, health and a clock. Without it the sim is only the mover on the terrain. */
  horde?: boolean;
  /**
   * Answer every offer at once, without holding the world: `true` takes the first card, a function
   * chooses (it is given the world, with the offer open, and returns the card's index). For bots
   * and tests; the game leaves it off and sends `InputFrame.pick`.
   */
  autoPick?: boolean | Picker;
}

/** Chooses a card from `w.offer`. Must return an index below `w.offer.count`. */
export type Picker = (w: World) => number;

const firstCard: Picker = () => 0;

/**
 * One tick of everything that is not the mover. The order matters: the horde moves, the grid is
 * rebuilt, then everything that hurts enemies runs against stable indices, and only then are the
 * dead removed and their sparks dropped.
 */
function stepWorld(w: World, s: SimState, terrain: Terrain): void {
  w.fx.count = 0;
  w.deaths.count = 0;

  stepDirector(w, s, terrain);
  stepHorde(w, s, terrain);
  rebuildGrid(w);
  stepContact(w, s);
  if (w.run.phase !== PHASE_PLAY) {
    // The player's last tick: what they killed on it still counts.
    reapHorde(w);
    return;
  }
  stepHazards(w, s, terrain);
  stepWeapons(w, s, terrain);
  reapHorde(w);
  stepBosses(w, s, terrain);
  stepSparks(w, s, terrain);
  stepThings(w, s, terrain);
  openOffer(w);

  // No win on the clock: the run is won when the last boss falls (see bosses.ts), and the clock
  // keeps counting past it.
  w.run.ticks++;
}

/** The run is over: the mover stands where it is. */
function stopMover(m: MoverState): void {
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
  m.speed = 0;
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
  /** See `SimOptions.autoPick`: who answers offers, or null to wait for `InputFrame.pick`. */
  picker: Picker | null;

  constructor(terrain: Terrain, options: SimOptions = {}) {
    this.terrain = terrain;
    this.state = makeSimState(terrain);
    this.prev = makeSimState(terrain);
    this.world = makeWorld(options.seed ?? 1);
    this.horde = options.horde === true;
    const auto = options.autoPick;
    this.picker = auto === true ? firstCard : typeof auto === 'function' ? auto : null;
    builtWeapons(this.world.pool);
    placeThings(this.world, terrain);
  }

  step(input: InputFrame): void {
    copySimState(this.prev, this.state);
    const s = this.state;
    s.events = 0;
    const w = this.world;
    if (this.horde && w.run.phase === PHASE_CHOOSE) {
      // Cards are on the table: nothing moves until one is taken, and then everything carries on
      // exactly as it was, speed and heading included.
      w.fx.count = 0;
      w.deaths.count = 0;
      const pick = this.picker ? this.picker(w) : (input.pick ?? -1);
      if (pick >= 0 && !pickCard(w, s, pick) && this.picker) pickCard(w, s, 0);
      return;
    }
    if (this.horde && w.run.phase !== PHASE_PLAY) {
      // The run is over: the world holds still until `reset`.
      stopMover(s.mover);
      w.fx.count = 0;
      w.deaths.count = 0;
      return;
    }
    if (this.horde) applyBuildToMover(w, s);
    stepMover(s, input, this.terrain);
    stepGear(s);
    if (this.horde) {
      stepWorld(w, s, this.terrain);
      if (w.run.phase === PHASE_DEAD || w.run.phase === PHASE_WON) stopMover(s.mover);
      // With auto-pick an offer never holds the world: answer it, and any queued behind it, now.
      while (this.picker && w.run.phase === PHASE_CHOOSE) {
        if (!pickCard(w, s, this.picker(w))) pickCard(w, s, 0);
      }
    }
    s.tick++;
  }

  /** Start the run again from the spawn, same seed, in place. */
  reset(): void {
    const fresh = makeSimState(this.terrain);
    copySimState(this.state, fresh);
    copySimState(this.prev, fresh);
    resetWorld(this.world);
    placeThings(this.world, this.terrain);
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
