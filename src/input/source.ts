import type { InputFrame } from '../sim/types';

/** Anything that can say what the player wants for the next tick: touch, keys, a bot, the test hook. */
export interface InputSource {
  /** Fill `out` with the intent for the next sim step. Called exactly once per step. */
  sample(out: InputFrame): void;
}

/** The three control schemes the feel slice compares. See docs/PITCH.md section 3. */
export type Scheme = 'tuck' | 'lift' | 'swipe';
export const SCHEMES: readonly Scheme[] = ['tuck', 'lift', 'swipe'];
