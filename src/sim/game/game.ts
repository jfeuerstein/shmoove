/**
 * The game layer above the sim: deterministic reducers over sim state and events (line-map
 * progress, chalk lines, errands, conductor challenges, secrets, onboarding and finds).
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
import { FindsReducer, type FindsState, type WearSlot } from './finds';
import { OnboardingReducer, type HintId, type OnboardingState, type OnboardingStep } from './onboarding';
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
  | { type: 'secretFound'; id: SecretId }
  /** An onboarding hint came up (a step, or a closing ticket). */
  | { type: 'hintShow'; step: HintId }
  /** An onboarding step was learnt. */
  | { type: 'hintDone'; step: OnboardingStep }
  /** The six lesson steps and the closing tickets are done. */
  | { type: 'onboardingComplete' }
  /** A painted tile taken: `count` of `total` now. */
  | { type: 'tile'; index: number; tier: number; district: number; count: number; total: number }
  /** A named spot found (passed through in the air or at speed). */
  | { type: 'spot'; id: string; name: string }
  /** A landmark reached for the first time. */
  | { type: 'postcard'; id: string; name: string }
  /** A new longest flow line in a district; `first` when it is the district's first. */
  | { type: 'bestLine'; district: number; count: number; first: boolean }
  /** A new fastest run of a named route, in ticks. */
  | { type: 'bestRun'; name: string; ticks: number; first: boolean }
  /** A deck or kit unlocked by finds. */
  | { type: 'unlock'; id: string; slot: WearSlot; name: string };

/** Game construction options: the sim's, plus the errand and conductor content (the city's by default). */
export interface GameOpts extends SimOpts {
  errands?: readonly ErrandDef[];
  conductors?: readonly ConductorDef[];
  /**
   * The hints setting, which the onboarding lesson follows. Off by default: a Game teaches only when
   * told to (the app turns it on from the player's setting for a real game).
   */
  hints?: boolean;
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
  brake: boolean;
}

export class Game {
  readonly sim: Sim;
  readonly progress: Progress;
  readonly chalk: ChalkState;
  readonly errands: ErrandState;
  readonly conductors: ConductorState;
  readonly secrets: SecretState;
  readonly onboarding: OnboardingState;
  readonly finds: FindsState;
  /** Events from the most recent step (cleared at the start of each step). */
  readonly events: GameEvent[] = [];
  /** The quantised input the last step applied. */
  readonly applied: AppliedInput = { steerQ: 0, hold: false, hop: false, brake: false };
  /** Reducers in step order. */
  readonly reducers: readonly GameReducer[];
  private readonly chalkReducer: ChalkReducer;
  /** Public for observers that need lookups (where an errand's target is); state changes only through commands. */
  readonly errandsReducer: ErrandsReducer;
  readonly conductorsReducer: ConductorsReducer;
  private readonly onboardingReducer: OnboardingReducer;
  private readonly findsReducer: FindsReducer;
  private readonly simInput: InputFrame = { steer: 0, hold: false, hop: false, brake: false };
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
    this.onboardingReducer = new OnboardingReducer(world);
    this.onboarding = this.onboardingReducer.state;
    this.onboardingReducer.setHints(opts.hints ?? false);
    this.findsReducer = new FindsReducer(world);
    this.finds = this.findsReducer.state;
    // Fixed order: later reducers may read what earlier ones did this step.
    this.reducers = [
      new ProgressReducer(this.progress, world.lines),
      this.chalkReducer,
      this.errandsReducer,
      this.conductorsReducer,
      secrets,
      // Last: it reads what every other reducer did this step (inked segments, errands, races).
      this.onboardingReducer,
      // After the lesson: nothing reads it, and the reducers before it keep their places.
      this.findsReducer,
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
    this.applied.brake = input.brake === true;
    this.simInput.steer = q / STEER_LEVELS;
    this.simInput.hold = input.hold;
    this.simInput.hop = input.hop;
    this.simInput.brake = input.brake === true;
    // A race countdown holds the skater still while the city keeps moving.
    if (this.chalkReducer.holdsSkater()) this.sim.tickOnly();
    else this.sim.step(this.simInput);
    for (const r of this.reducers) r.step(this);
  }

  /** May errands offer themselves? Not while the lesson runs and the hitch is still to learn. */
  get errandsOpen(): boolean {
    return this.onboardingReducer.errandsOpen();
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
  /** The hints setting: off, no hint shows and errands are open from the start. */
  onboardingSetHints(on: boolean): void {
    this.onboardingReducer.setHints(on);
  }
  /** Mark the whole lesson learnt: no hint shows again. */
  onboardingSkip(): void {
    this.onboardingReducer.skip(this);
  }
  /** Start the lesson over. */
  onboardingReset(): void {
    this.onboardingReducer.reset();
  }
  /** Put on an unlocked deck or kit (finds). */
  findsWear(id: string): CommandResult {
    return this.findsReducer.wear(id);
  }
  /** Why recording cannot start right now, or '' if it can. */
  chalkCannotRecord(): string {
    return this.chalkReducer.cannotRecord(this);
  }
}
