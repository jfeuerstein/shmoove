/**
 * Low health: under 30% the screen's edges pulse red, slowly at first and faster as health falls;
 * back above, gone at once. Drawn over the threat glow without hiding it: its own layer above, red
 * at the edges only and clear in the middle, so the glow shows through.
 *
 * With reduced motion the pulse is a steady tint. The thresholds and the pulse are pure functions;
 * `LowHealthView` only writes the opacity when it changes.
 */
import { PALETTE } from '../render/look';
import './lowHealth.css';

export const LOW_HEALTH = 0.3;
/** Pulses per second at the threshold, and at zero health. */
export const PULSE_SLOW = 0.8;
export const PULSE_FAST = 3;
/** The steady tint used with reduced motion. */
export const STEADY = 0.5;
const OPACITY_STEP = 0.02;

/** Whether the warning is on. */
export function isLow(frac: number): boolean {
  return frac < LOW_HEALTH;
}

/** Pulses per second: slow at the threshold, fast at zero. */
export function pulseRate(frac: number): number {
  const k = Math.min(1, Math.max(0, 1 - frac / LOW_HEALTH));
  return PULSE_SLOW + (PULSE_FAST - PULSE_SLOW) * k;
}

/** Strength 0..1 of the red at `phase` (cycles). 0 when not low; steady when reduced. */
export function lowStrength(frac: number, phase: number, reduced: boolean): number {
  if (!isLow(frac)) return 0;
  if (reduced) return STEADY;
  const p = phase - Math.floor(phase);
  const tri = p < 0.5 ? p * 2 : 2 - p * 2;
  return 0.25 + 0.75 * tri * tri * (3 - 2 * tri);
}

function rgb(c: number): string {
  return `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;
}

export class LowHealthView {
  readonly element: HTMLElement;
  /** Whether reduced motion is on. */
  reduced = false;
  /** The strength computed last, 0..1. */
  strength = 0;
  private phase = 0;
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

  /** Once per frame: health as a share of its maximum, and real seconds. */
  update(hpFrac: number, dt: number): void {
    if (!isLow(hpFrac)) {
      this.phase = 0;
    } else if (dt > 0) {
      this.phase += pulseRate(hpFrac) * dt;
      this.phase -= Math.floor(this.phase);
    }
    this.strength = lowStrength(hpFrac, this.phase, this.reduced);
    const q = Math.round(this.strength / OPACITY_STEP);
    if (q !== this.shown) {
      this.shown = q;
      this.element.style.opacity = String(q * OPACITY_STEP);
    }
  }

  reset(): void {
    this.phase = 0;
    this.strength = 0;
    this.shown = 0;
    this.element.style.opacity = '0';
  }
}
