/**
 * The first-run lesson: what step it is on and whether the step is done, from what the sim did.
 * Pure: it reads a `LessonSample` (filled by `main.ts` once per tick from the sim) and nothing else.
 * What the lesson does to the world (the horde held back, twelve shufflers at step 5, health held
 * up, the run clock held at 0) is the app's job; this only decides.
 *
 * Seven steps, in a fixed order. A finished step stays on screen for a moment (`SETTLE_TICKS`, the
 * view ticks it) before the next line replaces it. Nothing here allocates after construction.
 */
import { EV_CLEAN_HOP, EV_HOP, EV_LAND } from '../sim/types';

/** Every number the lesson judges by, in one place. */
export const LESSON = {
  /** Step 1: the thumb must have carved this long in total, s, and the mover gone this far, m. */
  carveSeconds: 2,
  carveMetres: 15,
  /** Step 2: gear at which a tuck counts. */
  tuckGear: 3,
  /** Step 2: tucked and slower than this, m/s, on ground flatter than `flatNormalY`, is "stuck". */
  slowSpeed: 6,
  flatNormalY: 0.985,
  /** Step 2: seconds stuck before the line changes. */
  stuckSeconds: 3,
  /** Step 4: hops that were not clean before the line adds a hint. */
  missesForHint: 3,
  /** Step 5: gear that plows, and hits taken before the lesson explains. */
  plowGear: 3,
  hitsToExplain: 2,
  /** Step 5: ticks the explanation stays up before the next step. */
  explainTicks: 180,
  /** Step 5: how many come up, and how far ahead of the mover, m. */
  crowd: 12,
  crowdNear: 25,
  crowdFar: 35,
  /** Step 6: gives up waiting for a pop after this long, s. */
  popSeconds: 25,
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
  'Now let go on a downhill. Letting go is how you get fast.',
  'Tap to hop.',
  'Tap again the moment you land.',
  'The big number is your gear. Under 3, everything hurts.',
  'Your trail burns. Circle back onto it to pop everything inside.',
  'That is the game. Stay fast.',
];

export const LINE_STUCK = 'Steer to a slope first, then let go.';
export const LINE_EARLIER = 'Tap again the moment you land. A little earlier.';
export const LINE_LATER = 'Tap again the moment you land. A little later.';
export const LINE_EXPLAIN = 'That is why. Find a downhill, let go, and go through them in 3.';

/** What the lesson reads each tick. The app owns one and refills it. */
export interface LessonSample {
  /** The thumb is carving this tick (the input frame's `carve`). */
  carve: boolean;
  /** A tap arrived this tick (the input frame's `hop`). */
  tap: boolean;
  /** Metres travelled, `SimState.distance`. */
  distance: number;
  tucked: boolean;
  grounded: boolean;
  gear: number;
  speed: number;
  /** Ground normal's y: 1 on level ground. */
  normalY: number;
  /** `SimState.events` of the step. */
  events: number;
  /** The player was hurt this tick. */
  hurt: boolean;
  /** The mover plowed something this tick. */
  plowed: boolean;
  /** `Player.pops`. */
  pops: number;
}

export function makeLessonSample(): LessonSample {
  return { carve: false, tap: false, distance: 0, tucked: false, grounded: true, gear: 1, speed: 0, normalY: 1, events: 0, hurt: false, plowed: false, pops: 0 };
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
  private carved = 0;
  private startDistance = NaN;
  private stuck = 0;
  private misses = 0;
  private lastMissLate = false;
  private tappedInFlight = false;
  private hits = 0;
  private startPops = NaN;
  private explaining = false;
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
        this.stepSteer(s);
        break;
      case 1:
        this.stepTuck(s);
        break;
      case 2:
        if ((s.events & EV_HOP) !== 0) this.finish();
        break;
      case 3:
        this.stepClean(s);
        break;
      case 4:
        this.stepGear(s);
        break;
      case 5:
        this.stepLoop(s);
        break;
      default:
        if (this.ticks >= LESSON.endSeconds * TPS) this.ended = true;
        break;
    }
  }

  /** End the lesson now, from any step. */
  skip(): void {
    if (this.ended) return;
    this.ended = true;
    this.skipped = true;
  }

  private stepSteer(s: LessonSample): void {
    if (Number.isNaN(this.startDistance)) this.startDistance = s.distance;
    if (s.carve) this.carved++;
    if (this.carved >= LESSON.carveSeconds * TPS && s.distance - this.startDistance >= LESSON.carveMetres) this.finish();
  }

  private stepTuck(s: LessonSample): void {
    if (s.tucked && s.gear >= LESSON.tuckGear) {
      this.finish();
      return;
    }
    if (s.tucked && s.grounded && s.speed < LESSON.slowSpeed && s.normalY >= LESSON.flatNormalY) {
      this.stuck++;
    } else {
      this.stuck = 0;
    }
    this.line = this.stuck >= LESSON.stuckSeconds * TPS ? LINE_STUCK : LINES[1];
  }

  private stepClean(s: LessonSample): void {
    if ((s.events & EV_CLEAN_HOP) !== 0) {
      this.finish();
      return;
    }
    // A tap made in the air stays live only a few ticks: made earlier than that it is lost.
    if (s.tap && !s.grounded) this.tappedInFlight = true;
    let miss = false;
    if ((s.events & EV_HOP) !== 0) {
      // A hop that was not clean was made after the landing window closed: too late.
      miss = true;
      this.lastMissLate = true;
    } else if ((s.events & EV_LAND) !== 0 && this.tappedInFlight) {
      // Landed with a tap spent in the air and no hop: too early.
      miss = true;
      this.lastMissLate = false;
    }
    if ((s.events & EV_LAND) !== 0) this.tappedInFlight = false;
    if (miss) {
      this.misses++;
      if (this.misses >= LESSON.missesForHint) this.line = this.lastMissLate ? LINE_EARLIER : LINE_LATER;
    }
  }

  private stepGear(s: LessonSample): void {
    if (s.gear >= LESSON.plowGear && s.plowed) {
      this.finish();
      return;
    }
    if (this.explaining) {
      // Hurt twice: the lesson says why and moves on once it has been read.
      if (this.ticks >= LESSON.explainTicks) this.finish();
      return;
    }
    if (s.hurt) this.hits++;
    if (this.hits >= LESSON.hitsToExplain) {
      this.explaining = true;
      this.ticks = 0;
      this.line = LINE_EXPLAIN;
    }
  }

  private stepLoop(s: LessonSample): void {
    if (Number.isNaN(this.startPops)) this.startPops = s.pops;
    if (s.pops > this.startPops || this.ticks >= LESSON.popSeconds * TPS) this.finish();
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
    this.stuck = 0;
    this.misses = 0;
    this.tappedInFlight = false;
    this.hits = 0;
    this.explaining = false;
    this.carved = 0;
    this.startDistance = NaN;
    this.startPops = NaN;
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
