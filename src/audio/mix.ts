/**
 * Which stems sound, from the mover's speed tier, and how each one fades. Pure.
 *
 * Gear 1 is the drums alone; each gear up adds one stem in order (bass, keys, guitar, horns), so
 * gear 5 is the whole band. A stem never jumps: it ramps linearly from wherever it is to its new
 * level over half a bar, so a gear change mid-note is never a click.
 */
import { HALF_BAR, STEM_COUNT } from './music';

/** 1 if stem `stem` plays in gear `gear` (clamped to 1..5), else 0. */
export function stemTarget(gear: number, stem: number): number {
  const g = Math.min(STEM_COUNT, Math.max(1, Math.floor(gear)));
  return stem < g ? 1 : 0;
}

/** Fill `out` with the target of every stem in gear `gear`. */
export function stemTargets(gear: number, out: Float32Array): void {
  for (let s = 0; s < STEM_COUNT; s++) out[s] = stemTarget(gear, s);
}

/** Where a linear fade from `from` to `to` that began at `t0` and lasts `dur` is at time `t`. */
export function fadeLevel(from: number, to: number, t0: number, dur: number, t: number): number {
  if (t <= t0) return from;
  if (dur <= 0 || t >= t0 + dur) return to;
  return from + ((to - from) * (t - t0)) / dur;
}

/**
 * Each stem's level over time. `setGear` starts a fade on every stem whose target changed and
 * returns a bit mask of them; `level` reads any stem at any time after its last change.
 */
export class StemMixer {
  readonly from = new Float32Array(STEM_COUNT);
  readonly to = new Float32Array(STEM_COUNT);
  readonly t0 = new Float64Array(STEM_COUNT);
  readonly fade: number;

  constructor(fade = HALF_BAR) {
    this.fade = fade;
  }

  /** Every stem silent, with no fade running. */
  reset(): void {
    this.from.fill(0);
    this.to.fill(0);
    this.t0.fill(0);
  }

  level(stem: number, t: number): number {
    return fadeLevel(this.from[stem], this.to[stem], this.t0[stem], this.fade, t);
  }

  /** The gear is `gear` at time `t`. Returns the stems whose target changed, as bits. */
  setGear(gear: number, t: number): number {
    let changed = 0;
    for (let s = 0; s < STEM_COUNT; s++) {
      const target = stemTarget(gear, s);
      if (target === this.to[s]) continue;
      this.from[s] = this.level(s, t);
      this.to[s] = target;
      this.t0[s] = t;
      changed |= 1 << s;
    }
    return changed;
  }

  /** Worth scheduling a note on: sounding now or heading somewhere that sounds. */
  audible(stem: number, t: number): boolean {
    return this.to[stem] > 0 || this.level(stem, t) > 0.001;
  }
}
