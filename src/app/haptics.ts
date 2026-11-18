/**
 * Haptics: a pure mapping from sim and game events to vibration patterns, and a thin wrapper over
 * `navigator.vibrate` (feature-detected; a silent no-op where it is missing, when the setting is
 * off, or while the page is hidden).
 *
 * Patterns are in milliseconds, alternating on / off, kept short: felt, not buzzing. At most one
 * pattern comes out per frame: the most important of that frame's events. A pattern never queues
 * behind another; while one is still playing, a new one replaces it only if it is more important.
 * While grinding, a light tick plays every GRIND_TICK_MS when nothing else is.
 */
import type { GameEvent } from '../sim/game/game';
import type { SimEvent } from '../sim/types';

export interface HapticPattern {
  name: string;
  /** on, off, on, ... in ms. */
  pattern: readonly number[];
  /** Higher wins. */
  priority: number;
  /** The same pattern does not play again sooner than this after it started, ms (events the sim repeats). */
  repeatMs?: number;
}

/** Extra pulses a hitch adds for chain links beyond the first, at most. */
export const CHAIN_PULSE_CAP = 4;
export const GRIND_TICK_MS = 150;
/** Impact (m/s into the surface) at which a landing thud is at its longest. */
export const LAND_FULL_IMPACT = 18;

const P = (name: string, priority: number, ...pattern: number[]): HapticPattern => ({ name, priority, pattern });

const HOP = P('hop', 1, 6);
const GRIND = P('grind', 2, 12);
const GRIND_TICK = P('grindTick', 0, 4);
const BOUNCE = P('bounce', 3, 15);
/** The sim repeats `denied` every tick while you hold under a ride you cannot take yet. */
const DENIED: HapticPattern = { ...P('denied', 4, 8, 60, 8), repeatMs: 800 };
const INKED = P('inked', 5, 12, 40, 12);
const RELEASE = P('release', 6, 10, 30, 22);
const WALL_HIT = P('wallHit', 7, 25);
const DISCOVERED = P('discovered', 7, 10, 40, 10, 40, 30);
const LINE_COMPLETE = P('lineComplete', 8, 14, 30, 14, 30, 14, 30, 40);
const BAIL = P('bail', 9, 60, 40, 60);
const MAP_COMPLETE = P('mapComplete', 10, 20, 40, 20, 40, 20, 40, 80, 60, 120);
const CHALK_GO = P('chalkGo', 6, 30);
const CHALK_WON = P('chalkWon', 8, 14, 30, 14, 30, 40);
const CHALK_LOST = P('chalkLost', 5, 20, 60, 20);
const ERRAND_START = P('errandStart', 5, 10, 30, 18);
const ERRAND_STEP = P('errandStep', 4, 12);
const ERRAND_DONE = P('errandDone', 8, 14, 30, 14, 30, 40);
const ERRAND_FAIL = P('errandFail', 5, 30, 60, 12);
const CONDUCTOR_START = P('conductorStart', 4, 8, 30, 8);
const CONDUCTOR_PUNCH = P('conductorPunch', 8, 24, 30, 10);
const SECRET_FOUND = P('secretFound', 9, 10, 40, 10, 40, 10, 40, 60);
/** Finds: a light tap per tile, a stamp for a spot, a card for a postcard, a run of taps for an unlock. */
const TILE = P('tile', 2, 7);
const SPOT = P('spot', 7, 28, 30, 8);
const POSTCARD = P('postcard', 6, 10, 40, 10);
const UNLOCK = P('unlock', 8, 10, 40, 10, 40, 10, 40, 40);

/** The hitch thud, plus one short pulse per chain link beyond the first (capped). */
export function hitchPattern(chain: number): HapticPattern {
  const extra = Math.min(CHAIN_PULSE_CAP, Math.max(0, Math.floor(chain) - 1));
  const pattern = [18];
  for (let i = 0; i < extra; i++) pattern.push(40, 10);
  return { name: 'hitch', priority: 6, pattern };
}

/** Landing thud length scales with the impact: 8 ms for a kiss, 30 ms at LAND_FULL_IMPACT. */
export function landPattern(impact: number): HapticPattern {
  const k = Number.isFinite(impact) ? Math.min(1, Math.max(0, impact / LAND_FULL_IMPACT)) : 0;
  return { name: 'land', priority: 3, pattern: [Math.round(8 + 22 * k)] };
}

/** The pattern for one event, or null for events that are not felt. */
export function patternFor(e: SimEvent | GameEvent): HapticPattern | null {
  switch (e.type) {
    case 'hitch':
      return hitchPattern(e.chain);
    case 'release':
      return RELEASE;
    case 'land':
      return landPattern(e.impact);
    case 'hop':
      return HOP;
    case 'grindStart':
      return GRIND;
    case 'wallHit':
      return WALL_HIT;
    case 'bail':
      return BAIL;
    case 'bounce':
      return BOUNCE;
    case 'denied':
      return DENIED;
    case 'segmentInked':
      return INKED;
    case 'lineComplete':
      return LINE_COMPLETE;
    case 'lineDiscovered':
      return DISCOVERED;
    case 'mapComplete':
      return MAP_COMPLETE;
    case 'chalkGo':
      return CHALK_GO;
    case 'chalkFinish':
      return e.won ? CHALK_WON : CHALK_LOST;
    case 'errandStart':
      return ERRAND_START;
    case 'errandStep':
      return ERRAND_STEP;
    case 'errandDone':
      return ERRAND_DONE;
    case 'errandFail':
      return ERRAND_FAIL;
    case 'conductorStart':
      return CONDUCTOR_START;
    case 'conductorPunch':
      return CONDUCTOR_PUNCH;
    case 'secretFound':
      return SECRET_FOUND;
    case 'tile':
      return TILE;
    case 'spot':
      return SPOT;
    case 'postcard':
      return POSTCARD;
    case 'unlock':
      return UNLOCK;
    default:
      return null;
  }
}

const duration = (p: HapticPattern): number => {
  let t = 0;
  for (const v of p.pattern) t += v;
  return t;
};

/** Pure: events in, at most one pattern out per frame, with priorities and no queueing. */
export class HapticMapper {
  private busyUntil = -Infinity;
  private running: HapticPattern | null = null;
  private grinding = false;
  private lastTick = -Infinity;
  private lastName = '';
  private lastStart = -Infinity;

  /** Whether the skater is on a rail (ticks play). */
  get isGrinding(): boolean {
    return this.grinding;
  }

  /**
   * One frame: `nowMs` is a clock that only moves forward. Returns the pattern to start now, or
   * null. With `enabled` false nothing plays (grind state is still followed).
   */
  frame(sim: readonly SimEvent[], game: readonly GameEvent[], nowMs: number, enabled = true): HapticPattern | null {
    let best: HapticPattern | null = null;
    for (const e of sim) {
      if (e.type === 'grindStart') this.grinding = true;
      else if (e.type === 'grindEnd' || e.type === 'bail' || e.type === 'hitch') this.grinding = false;
      const p = patternFor(e);
      if (p && (!best || p.priority > best.priority)) best = p;
    }
    for (const e of game) {
      const p = patternFor(e);
      if (p && (!best || p.priority > best.priority)) best = p;
    }
    if (!enabled) return null;
    const busy = nowMs < this.busyUntil;
    if (best) {
      const tooSoon = best.repeatMs !== undefined && best.name === this.lastName && nowMs - this.lastStart < best.repeatMs;
      if (!tooSoon && !(busy && this.running && best.priority <= this.running.priority)) return this.start(best, nowMs);
      return null;
    }
    if (this.grinding && !busy && nowMs - this.lastTick >= GRIND_TICK_MS) return this.start(GRIND_TICK, nowMs);
    return null;
  }

  private start(p: HapticPattern, nowMs: number): HapticPattern {
    this.running = p;
    this.busyUntil = nowMs + duration(p);
    if (p !== GRIND_TICK) {
      this.lastName = p.name;
      this.lastStart = nowMs;
    }
    if (this.grinding) this.lastTick = nowMs;
    return p;
  }
}

export interface Haptics {
  /** Once per rendered frame with that frame's events and its length in seconds. */
  frame(sim: readonly SimEvent[], game: readonly GameEvent[], dtSeconds: number): void;
  /** Name of the last pattern started ('' if none yet), for the e2e hook. */
  readonly last: string;
  /** navigator.vibrate exists. */
  readonly supported: boolean;
}

export interface HapticsOpts {
  /** The haptics setting. */
  enabled(): boolean;
  /** Defaults to navigator.vibrate when present. */
  vibrate?: ((pattern: number[]) => void) | null;
  /** Defaults to document.visibilityState === 'visible'. */
  visible?: () => boolean;
}

function defaultVibrate(): ((pattern: number[]) => void) | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  return (pattern) => {
    // Before the first tap Chrome refuses (and logs an error): nothing can be felt yet anyway.
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
    try {
      navigator.vibrate(pattern);
    } catch (_e) {
      /* some browsers throw without a user gesture: nothing to feel */
    }
  };
}

function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function createHaptics(opts: HapticsOpts): Haptics {
  const vibrate = opts.vibrate === undefined ? defaultVibrate() : opts.vibrate;
  const visible = opts.visible ?? defaultVisible;
  const mapper = new HapticMapper();
  let clock = 0;
  let last = '';
  const buf: number[] = [];
  return {
    frame(sim, game, dtSeconds) {
      clock += Math.max(0, dtSeconds) * 1000;
      const on = vibrate !== null && opts.enabled() && visible();
      const p = mapper.frame(sim, game, clock, on);
      if (!p || !vibrate) return;
      last = p.name;
      buf.length = 0;
      for (const v of p.pattern) buf.push(v);
      vibrate(buf);
    },
    get last() {
      return last;
    },
    get supported() {
      return vibrate !== null;
    },
  };
}
