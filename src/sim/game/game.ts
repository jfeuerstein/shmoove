/**
 * The game layer above the sim: deterministic reducers over sim state and events (line-map
 * progress now; errands, conductors, secrets, chalk lines and saves later).
 *
 * `Game.step` is the only way time advances: it steps the sim, then every reducer in a fixed order.
 * A reducer owns its own state, reads `game.sim` and `game.sim.events`, and pushes GameEvents.
 * To add a system, add its events to `GameEvent` and its reducer to the list in the constructor.
 */
import { Sim, type SimOpts } from '../sim';
import type { InputFrame } from '../types';
import type { World } from '../world';
import { ProgressReducer, createProgress, type Progress } from './progress';

export type GameEvent =
  | { type: 'segmentInked'; line: number; segment: number }
  | { type: 'lineComplete'; line: number }
  /** A secret line ridden for the first time. */
  | { type: 'lineDiscovered'; line: number }
  | { type: 'mapComplete' };

export interface GameReducer {
  step(game: Game): void;
}

export class Game {
  readonly sim: Sim;
  readonly progress: Progress;
  /** Events from the most recent step (cleared at the start of each step). */
  readonly events: GameEvent[] = [];
  private readonly reducers: readonly GameReducer[];

  constructor(world: World, opts: SimOpts = {}) {
    this.sim = new Sim(world, opts);
    this.progress = createProgress(world.lines);
    // Fixed order: later reducers may read what earlier ones did this step.
    this.reducers = [new ProgressReducer(this.progress, world.lines)];
  }

  /** One tick: steps the sim, then every game reducer in a fixed order. The only way time advances. */
  step(input: InputFrame): void {
    this.events.length = 0;
    this.sim.step(input);
    for (const r of this.reducers) r.step(this);
  }
}
