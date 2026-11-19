/**
 * The first-run lesson: what step it is on and whether the step is done, from what the sim did.
 * Pure: it reads a `LessonSample` (filled by `main.ts` once per tick from the sim) and nothing else.
 * What the lesson does to the world (the director off, eight shufflers brought up at step 4, health
 * held up, the run clock held at 0, the XP top-up) is the app's job; this only decides.
 *
 * Seven steps, in a fixed order. A finished step stays on screen for a moment (`SETTLE_TICKS`)
 * before the next line replaces it. Nothing here allocates after construction.
 */
import { EV_HOP } from '../sim/types';

/** Every number the lesson judges by, in one place. */
export const LESSON = {
  /** Step 1: the thumb must have steered this long in total, s, and the rider gone this far, m. */
  steerSeconds: 2,
  steerMetres: 15,
  /** Step 3: faster than this, m/s, is "fast"; after `dipSeconds` the line points at the dip. */
  fastSpeed: 16,
  dipSeconds: 12,
  /** Step 4: how many come up, how far ahead of the rider, m, and how many must die. */
  crowd: 8,
  crowdNear: 25,
  crowdFar: 35,
  kills: 3,
  /** Step 5: after this long without a card offer the app gives the XP that is short, s. */
  sparkSeconds: 10,
  /** Step 7: how long the last line stays, s. */
  endSeconds: 2,
  /** Health held at or above this while the lesson runs. */
  minHp: 30,
} as const;

/** A finished step stays up this long, ticks. */
export const SETTLE_TICKS = 24;
const TPS = 60;

export const STEP_COUNT = 7;

/** The words the player reads, one per step (index 0 is step 1). */
export const LINES: readonly string[] = [
  'Drag to steer.',
  'Tap to ollie.',
  'Hills make you fast. Find one.',
  'Your weapons fire themselves. Stay out of reach.',
  'Pick up the sparks. They are your levels.',
  'Take a card.',
  "That is the game. Don't get touched.",
];

/** Step 3's line after `LESSON.dipSeconds` without going fast. */
export const LINE_DIP = 'Head for the dip in the middle.';

/** What the lesson reads each tick. The app owns one and refills it. */
export interface LessonSample {
  /** The thumb is steering this tick (the input frame's `carve`). */
  carve: boolean;
  /** Metres travelled, `SimState.distance`. */
  distance: number;
  speed: number;
  /** `SimState.events` of the step. */
  events: number;
  /** `Player.kills`. */
  kills: number;
  /** A card offer is open (the run is in `PHASE_CHOOSE`). */
  offerOpen: boolean;
}

export function makeLessonSample(): LessonSample {
  return { carve: false, distance: 0, speed: 0, events: 0, kills: 0, offerOpen: false };
}

export class Lesson {
  /** 0-based index of the step on screen; `STEP_COUNT - 1` is the last line. */
  step = 0;
  /** True once the lesson is over, by finishing or by `skip`. */
  ended = false;
  /** True when it ended by `skip`. */
  skipped = false;
  /** Steps finished so far (rises by one each time a dot fills). The view animates on a change. */
  done = 0;
  /** The line to show now. */
  line: string = LINES[0];

  // Per-step state, reset when a step begins.
  private ticks = 0;
  private steered = 0;
  private startDistance = NaN;
  private startKills = NaN;
  /** The app has been asked for the XP top-up and has not taken the request yet. */
  private topUp = false;
  private topUpAsked = false;
  /** Ticks left of a finished step's settle; 0 while the step is still being judged. */
  private settle = 0;

  /** Advance one tick. After the lesson has ended it does nothing. */
  update(s: LessonSample): void {
    if (this.ended) return;
    if (this.settle > 0) {
      this.settle--;
      if (this.settle === 0) this.next();
      return;
    }
    this.ticks++;
    switch (this.step) {
      case 0:
        if (Number.isNaN(this.startDistance)) this.startDistance = s.distance;
        if (s.carve) this.steered++;
        if (this.steered >= LESSON.steerSeconds * TPS && s.distance - this.startDistance >= LESSON.steerMetres) this.finish();
        break;
      case 1:
        if ((s.events & EV_HOP) !== 0) this.finish();
        break;
      case 2:
        if (s.speed > LESSON.fastSpeed) this.finish();
        else if (this.ticks >= LESSON.dipSeconds * TPS) this.line = LINE_DIP;
        break;
      case 3:
        if (Number.isNaN(this.startKills)) this.startKills = s.kills;
        if (s.kills - this.startKills >= LESSON.kills) this.finish();
        break;
      case 4:
        if (s.offerOpen) this.finish();
        else if (!this.topUpAsked && this.ticks >= LESSON.sparkSeconds * TPS) {
          this.topUpAsked = true;
          this.topUp = true;
        }
        break;
      case 5:
        // The offer opened to end step 5; it is taken once it is no longer open.
        if (!s.offerOpen) this.finish();
        break;
      default:
        if (this.ticks >= LESSON.endSeconds * TPS) this.ended = true;
        break;
    }
  }

  /** True once, when the app should give the player the XP they are short of a level. */
  takeTopUp(): boolean {
    const t = this.topUp;
    this.topUp = false;
    return t;
  }

  /** End the lesson now, from any step. */
  skip(): void {
    if (this.ended) return;
    this.ended = true;
    this.skipped = true;
  }

  /** The step's condition is met: fill a dot and hold the line a moment. */
  private finish(): void {
    this.done++;
    this.settle = SETTLE_TICKS;
  }

  private next(): void {
    this.step++;
    this.line = LINES[this.step];
    this.ticks = 0;
    this.steered = 0;
    this.startDistance = NaN;
    this.startKills = NaN;
  }
}

/** The things that decide whether the lesson shows. */
export interface LessonGate {
  /** `?lesson`: show it even when it has been done. */
  force: boolean;
  /** `?nolesson`. */
  skip: boolean;
  /** Saved: the player has finished or skipped it. */
  done: boolean;
  /** Fixtures and modes that have no place for a lesson. */
  flat: boolean;
  solo: boolean;
  horde: boolean;
  arsenal: boolean;
  perf: boolean;
}

/** Whether a run starts in the lesson. */
export function lessonWanted(g: LessonGate): boolean {
  if (g.skip || g.flat || g.solo || g.horde || g.arsenal || g.perf) return false;
  return g.force || !g.done;
}
