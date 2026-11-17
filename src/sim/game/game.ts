/**
 * The game layer above the sim: deterministic reducers over sim state and events (line-map
 * progress, chalk lines, errands, conductor challenges and secrets).
 *
 * `Game.step` is the only way time advances: it steps the sim, then every reducer in a fixed order.
 * A reducer owns its own state, reads `game.sim` and `game.sim.events`, and pushes GameEvents.
 * To add a system, add its events to `GameEvent` and its reducer to the list in the constructor.
 * A reducer that has state worth keeping implements `exportState` / `importState`; the save code
 * stores whatever it exports under its `key` and never needs to know what is inside.
 *
 * Game state changes from outside (the UI) only through the plain command methods below.
 */
import { Sim, type SimOpts } from '../sim';
import type { InputFrame } from '../types';
import type { World } from '../world';
import { ChalkReducer, STEER_LEVELS, type ChalkState, type CommandResult } from './chalk';
import { ConductorsReducer, type ConductorDef, type ConductorState } from './conductors';
import { CONDUCTORS } from './content/conductors';
import { ERRANDS } from './content/errands';
import { ErrandsReducer, type ErrandDef, type ErrandFailReason, type ErrandState } from './errands';
import { ProgressReducer, createProgress, type Progress } from './progress';
import { SecretsReducer, type SecretId, type SecretState } from './secrets';

export type GameEvent =
  | { type: 'segmentInked'; line: number; segment: number }
  | { type: 'lineComplete'; line: number }
  /** A secret line ridden for the first time. */
  | { type: 'lineDiscovered'; line: number }
  | { type: 'mapComplete' }
  | { type: 'chalkRecordStart' }
  | { type: 'chalkRecordStop'; id: string; ticks: number }
  | { type: 'chalkRecordDiscard'; reason: string }
  /** Seconds left before GO: 3, 2, 1. */
  | { type: 'chalkCountdown'; secondsLeft: number }
  | { type: 'chalkGo' }
  /** A race ended. `ticks` is 0 when the player never reached the finish (timed out). */
  | { type: 'chalkFinish'; id: string; ticks: number; ghostTicks: number; won: boolean; best: boolean }
  | { type: 'chalkAbort' }
  /** An errand's offer appeared (the skater entered its giver's zone). */
  | { type: 'errandOffer'; id: string }
  | { type: 'errandStart'; id: string }
  /** Step `step` (index) of the active errand was completed. */
  | { type: 'errandStep'; id: string; step: number }
  /** `best`: a new best time for this errand. */
  | { type: 'errandDone'; id: string; ticks: number; best: boolean }
  | { type: 'errandFail'; id: string; reason: ErrandFailReason }
  /** `line` is the line index. */
  | { type: 'conductorStart'; line: number }
  | { type: 'conductorPunch'; line: number }
  | { type: 'conductorFail'; line: number }
  | { type: 'secretFound'; id: SecretId };

/** Game construction options: the sim's, plus the errand and conductor content (the city's by default). */
export interface GameOpts extends SimOpts {
  errands?: readonly ErrandDef[];
  conductors?: readonly ConductorDef[];
}

export interface GameReducer {
  /** Stable name of the reducer's section in a save. */
  readonly key: string;
  step(game: Game): void;
  exportState?(): unknown;
  /** Replace the reducer's state from saved data; malformed data must leave it fresh, never throw. */
  importState?(data: unknown): void;
}

/**
 * Steer levels each side of centre (defined beside the chalk frames that store them): the sim only
 * ever sees steer as a multiple of 1/31, 63 levels in all. Coarse enough that a thumb's jitter mostly
 * lands on one level, so chalk codes stay short; fine enough (1.6% of full lock) that no thumb can
 * feel the steps.
 */
export { STEER_LEVELS };

/** The steer the sim gets for a raw steer, as a signed integer level -31..31. */
export function quantiseSteer(steer: number): number {
  if (!(steer === steer) || steer === Infinity || steer === -Infinity) return 0;
  const s = steer < -1 ? -1 : steer > 1 ? 1 : steer;
  return Math.round(s * STEER_LEVELS);
}

/** The input actually applied on the last step, quantised (what a chalk recording stores). */
export interface AppliedInput {
  steerQ: number;
  hold: boolean;
  hop: boolean;
}

export class Game {
  readonly sim: Sim;
  readonly progress: Progress;
  readonly chalk: ChalkState;
  readonly errands: ErrandState;
  readonly conductors: ConductorState;
  readonly secrets: SecretState;
  /** Events from the most recent step (cleared at the start of each step). */
  readonly events: GameEvent[] = [];
  /** The quantised input the last step applied. */
  readonly applied: AppliedInput = { steerQ: 0, hold: false, hop: false };
  /** Reducers in step order. */
  readonly reducers: readonly GameReducer[];
  private readonly chalkReducer: ChalkReducer;
  /** Public for observers that need lookups (where an errand's target is); state changes only through commands. */
  readonly errandsReducer: ErrandsReducer;
  readonly conductorsReducer: ConductorsReducer;
  private readonly simInput: InputFrame = { steer: 0, hold: false, hop: false };
  /** Events raised by commands between steps; they come out with the next step's events. */
  private readonly queued: GameEvent[] = [];

  constructor(world: World, opts: GameOpts = {}) {
    this.sim = new Sim(world, opts);
    this.progress = createProgress(world.lines);
    this.chalkReducer = new ChalkReducer(world);
    this.chalk = this.chalkReducer.state;
    this.errandsReducer = new ErrandsReducer(world, opts.errands ?? ERRANDS);
    this.errands = this.errandsReducer.state;
    this.conductorsReducer = new ConductorsReducer(world, opts.conductors ?? CONDUCTORS);
    this.conductors = this.conductorsReducer.state;
    const secrets = new SecretsReducer(world);
    this.secrets = secrets.state;
    // Fixed order: later reducers may read what earlier ones did this step.
    this.reducers = [
      new ProgressReducer(this.progress, world.lines),
      this.chalkReducer,
      this.errandsReducer,
      this.conductorsReducer,
      secrets,
    ];
  }

  /** One tick: steps the sim, then every game reducer in a fixed order. The only way time advances. */
  step(input: InputFrame): void {
    this.events.length = 0;
    for (const e of this.queued) this.events.push(e);
    this.queued.length = 0;
    const q = quantiseSteer(input.steer);
    this.applied.steerQ = q;
    this.applied.hold = input.hold;
    this.applied.hop = input.hop;
    this.simInput.steer = q / STEER_LEVELS;
    this.simInput.hold = input.hold;
    this.simInput.hop = input.hop;
    // A race countdown holds the skater still while the city keeps moving.
    if (this.chalkReducer.holdsSkater()) this.sim.tickOnly();
    else this.sim.step(this.simInput);
    for (const r of this.reducers) r.step(this);
  }

  /** Queue an event raised by a command; it is delivered with the next step's events. */
  queueEvent(e: GameEvent): void {
    this.queued.push(e);
  }

  // ------------------------------------------------------------------------------------------
  // Commands: the only way the UI changes game state.

  chalkStartRecording(): CommandResult {
    return this.chalkReducer.startRecording(this);
  }
  chalkStopRecording(name: string): CommandResult {
    return this.chalkReducer.stopRecording(this, name);
  }
  chalkCancel(): CommandResult {
    return this.chalkReducer.cancel(this);
  }
  chalkStartRace(id: string): CommandResult {
    return this.chalkReducer.startRace(this, id);
  }
  chalkAbortRace(): CommandResult {
    return this.chalkReducer.abortRace(this);
  }
  chalkImport(code: string): CommandResult {
    return this.chalkReducer.importCode(code);
  }
  chalkDelete(id: string): CommandResult {
    return this.chalkReducer.deleteLine(id);
  }
  chalkRename(id: string, name: string): CommandResult {
    return this.chalkReducer.renameLine(id, name);
  }
  /** Give up the errand in progress (it fails with reason 'abandon'). */
  errandAbandon(): CommandResult {
    return this.errandsReducer.abandon(this);
  }
  /** Why recording cannot start right now, or '' if it can. */
  chalkCannotRecord(): string {
    return this.chalkReducer.cannotRecord(this);
  }
}
