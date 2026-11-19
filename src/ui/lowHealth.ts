/**
 * Low health: under 30% a slim, steady line of red round the screen's edges, stronger the lower
 * health is; back above, gone at once. It never pulses, so it does not look like the flash of a hit
 * (a soft glow that comes and goes): one says "you are low", the other "you were hit". Drawn above
 * the threat glow without hiding it: a line at the very edge, clear inside.
 *
 * How strong it is, is a pure function of health; `LowHealthView` only writes the opacity when it
 * changes. Reduced motion changes nothing: there is no motion.
 */
import { PALETTE } from '../render/look';
import './lowHealth.css';

export const LOW_HEALTH = 0.3;
/** The line's strength just under the threshold, and at no health. */
export const LOW_FAINT = 0.5;
export const LOW_STRONG = 0.9;
const OPACITY_STEP = 0.02;

/** Whether the warning is on. */
export function isLow(frac: number): boolean {
  return frac < LOW_HEALTH;
}

/** Strength 0..1 of the line: 0 when not low, from `LOW_FAINT` at the threshold to `LOW_STRONG` at none. */
export function lowStrength(frac: number): number {
  if (!isLow(frac)) return 0;
  const k = Math.min(1, Math.max(0, 1 - frac / LOW_HEALTH));
  return LOW_FAINT + (LOW_STRONG - LOW_FAINT) * k;
}

function rgb(c: number): string {
  return `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;
}

export class LowHealthView {
  readonly element: HTMLElement;
  /** Whether reduced motion is on (the line is steady either way). */
  reduced = false;
  /** The strength computed last, 0..1. */
  strength = 0;
  private shown = -1;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'low-health';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.setProperty('--low-rgb', rgb(PALETTE.hpLow));
    this.element.style.opacity = '0';
    root.appendChild(this.element);
  }

  /**
   * Once per frame: health as a share of its maximum. The frame's real seconds are taken for the
   * caller's sake and not used: the line is steady.
   */
  update(hpFrac: number, dt = 0): void {
    void dt;
    this.strength = lowStrength(hpFrac);
    const q = Math.round(this.strength / OPACITY_STEP);
    if (q !== this.shown) {
      this.shown = q;
      this.element.style.opacity = String(q * OPACITY_STEP);
    }
  }

  reset(): void {
    this.strength = 0;
    this.shown = 0;
    this.element.style.opacity = '0';
  }
}
