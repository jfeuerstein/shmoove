/**
 * The simulation: one world, one clock, one skater. Advances only through step().
 */
import { DAY_TICKS, START_DAY_FRAC } from './constants';
import { dayFrac } from './lines';
import { createPlayer, placePlayer, stepPlayer } from './player';
import { Rng } from './rng';
import type { InputFrame, PlayerState, SimCtx, SimEvent } from './types';
import type { World } from './world';

export interface SimOpts {
  seed?: number;
  /** Day fraction at tick zero of this session (0 = midnight). */
  startDayFrac?: number;
}

export class Sim implements SimCtx {
  readonly world: World;
  readonly seed: number;
  readonly rng: Rng;
  /** Absolute tick. tick % DAY_TICKS is the time of day. */
  tick: number;
  player: PlayerState;
  /** Events from the most recent step. */
  events: SimEvent[] = [];

  constructor(world: World, opts: SimOpts = {}) {
    if (!world.finalized) throw new Error('Sim needs a finalized world');
    this.world = world;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.tick = Math.round((opts.startDayFrac ?? START_DAY_FRAC) * DAY_TICKS);
    this.player = createPlayer();
    placePlayer(world, this.player, world.spawn.x, world.spawn.z, world.spawn.heading);
  }

  step(input: InputFrame): void {
    this.events.length = 0;
    this.tick++;
    stepPlayer(this, input);
  }

  /** Advance the clock one tick without stepping the skater (countdowns: the city moves, they wait). */
  tickOnly(): void {
    this.events.length = 0;
    this.tick++;
  }

  get dayFrac(): number {
    return dayFrac(this.tick);
  }

  /** Move the clock to a day fraction (keeps the day count). */
  setDayFrac(f: number): void {
    const day = Math.floor(this.tick / DAY_TICKS);
    this.tick = day * DAY_TICKS + Math.round((f - Math.floor(f)) * DAY_TICKS);
  }

  hash(): number {
    return hashPlayer(this.player, this.tick);
  }
}

const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

/** Bit-exact checksum of a skater and the clock. Equal hashes mean identical state. */
export function hashPlayer(p: PlayerState, tick: number): number {
  let h = 0x811c9dc5 ^ (tick | 0);
  const rec = p as unknown as Record<string, number>;
  for (const k in rec) {
    _f64[0] = rec[k];
    h = Math.imul(h ^ _u32[0], 0x01000193);
    h = Math.imul(h ^ _u32[1], 0x01000193);
  }
  return h >>> 0;
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}
