/**
 * Hit-stop: when something big lands the game runs at a crawl for a moment, then goes back to what
 * it was. It is a multiplier on the stepper's scale, so it composes with the ramp that follows a
 * card: `scale = ramp * hitstop`, neither cancels the other. Real time is passed in, so the logic
 * is pure and testable.
 */
import { FX_BOSS_DOWN, FX_PLAYER_HIT, type World } from '../sim/world';

/** Game speed during a stop, as a share of the speed it would have. */
export const HITSTOP_SCALE = 0.05;
/** Real seconds. */
export const HITSTOP_HIT = 0.07;
export const HITSTOP_BOSS = 0.25;

export class HitStop {
  /** False when reduced motion is on. */
  enabled = true;
  private left = 0;

  /** Start (or lengthen) a stop of `seconds` real seconds. A longer one in progress is kept. */
  trigger(seconds: number): void {
    if (!this.enabled) return;
    if (seconds > this.left) this.left = seconds;
  }

  /** Once per sim tick, right after the step. */
  ingest(w: World): void {
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      if (type === FX_PLAYER_HIT) this.trigger(HITSTOP_HIT);
      else if (type === FX_BOSS_DOWN) this.trigger(HITSTOP_BOSS);
    }
  }

  /** Once per frame with real seconds. */
  update(dt: number): void {
    if (!this.enabled) this.left = 0;
    if (dt > 0 && this.left > 0) this.left = Math.max(0, this.left - dt);
  }

  get active(): boolean {
    return this.left > 0;
  }

  /** 1 normally, `HITSTOP_SCALE` during a stop. */
  get scale(): number {
    return this.left > 0 ? HITSTOP_SCALE : 1;
  }

  reset(): void {
    this.left = 0;
  }
}
