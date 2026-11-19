/**
 * Haptics: `navigator.vibrate` where it exists (Android; iOS has none, so nothing happens), with a
 * pattern per effect, at most one call per 50 ms. `patternForFx` and `patternForEvents` are pure
 * functions from what happened to the pattern asked for; `Haptics` applies them with a clock and
 * a `vibrate` handed in.
 */
import { EV_CLEAN_HOP, type SimState } from '../sim/types';
import { FX_BOSS_DOWN, FX_BOSS_IN, FX_LEVEL_UP, FX_PLAYER_HIT, type World } from '../sim/world';

export const HAPTIC_MIN_GAP_MS = 50;

/** Milliseconds on, off, on... A single number is one buzz; 0 is none. */
export type Pattern = number | readonly number[];

export const PATTERN_HIT = 40;
export const PATTERN_HOP = 12;
export const PATTERN_LEVEL: readonly number[] = [30, 50, 30];
export const PATTERN_BOSS = 300;

/** The pattern for an effect type, or 0 for none. */
export function patternForFx(type: number): Pattern {
  if (type === FX_PLAYER_HIT) return PATTERN_HIT;
  if (type === FX_LEVEL_UP) return PATTERN_LEVEL;
  if (type === FX_BOSS_IN || type === FX_BOSS_DOWN) return PATTERN_BOSS;
  return 0;
}

/** The pattern for a step's movement events: a tick on a clean ollie. */
export function patternForEvents(events: number): Pattern {
  return (events & EV_CLEAN_HOP) !== 0 ? PATTERN_HOP : 0;
}

/** Total length, so that when two land in one tick the longer wins. */
function weight(p: Pattern): number {
  if (typeof p === 'number') return p;
  let t = 0;
  for (let i = 0; i < p.length; i++) t += p[i];
  return t;
}

export type VibrateFn = (pattern: Pattern) => boolean;

export class Haptics {
  /** The setting. */
  enabled = true;
  private lastMs = -Infinity;
  private pending: Pattern = 0;

  constructor(
    private readonly vibrate: VibrateFn | null,
    private readonly now: () => number,
  ) {}

  /** The browser's, or one that does nothing where there is no `vibrate`. */
  static browser(): Haptics {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const fn: VibrateFn | null =
      nav && typeof nav.vibrate === 'function' ? (p) => nav.vibrate(p as number | number[]) : null;
    return new Haptics(fn, () => performance.now());
  }

  private want(p: Pattern): void {
    if (weight(p) > weight(this.pending)) this.pending = p;
  }

  /** Once per sim tick, right after the step: the strongest pattern of the tick is played. */
  ingest(w: World, s: SimState): void {
    if (!this.enabled || this.vibrate === null) return;
    const f = w.fx;
    for (let i = 0; i < f.count; i++) this.want(patternForFx(f.type[i]));
    this.want(patternForEvents(s.events));
    this.flush();
  }

  /** Ask for a pattern directly. */
  play(p: Pattern): void {
    if (!this.enabled || this.vibrate === null) return;
    this.want(p);
    this.flush();
  }

  private flush(): void {
    const p = this.pending;
    if (p === 0) return;
    this.pending = 0;
    const t = this.now();
    if (t - this.lastMs < HAPTIC_MIN_GAP_MS) return;
    this.lastMs = t;
    try {
      this.vibrate?.(p);
    } catch (_err) {
      // A browser that refuses: nothing to do.
    }
  }
}
