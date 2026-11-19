import { FEEL } from '../sim/constants';
import type { InputFrame } from '../sim/types';
import type { Scheme } from './source';

/** For drawing the floating stick: where the thumb landed (or was dragged to) and where it is now. */
export interface StickView {
  active: boolean;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

/** How far back a flick is measured, ms. */
const FLICK_WINDOW_MS = 120;
/** Ring capacity. Plenty for 120 ms even from a 1 kHz pointer; the oldest sample is dropped when full. */
const RING = 128;
const NO_POINTER = -1;

/**
 * Pure gesture logic: pointer events with explicit times in, one `InputFrame` per tick out.
 * No DOM, no clocks. Tunables are read from `FEEL` at use so the debug panel edits them live.
 */
export class Gestures {
  readonly stick: StickView = { active: false, ox: 0, oy: 0, x: 0, y: 0 };

  private scheme: Scheme;
  private thumb = NO_POINTER;
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private lastT = 0;
  /** tuck and swipe: the touch has stopped being a possible tap and is a carve. */
  private decided = false;
  private hopQueued = false;
  /** swipe: ready to detect a flick. Cleared by a flick, restored when the upward speed fades. */
  private armed = true;

  private readonly ringX = new Float64Array(RING);
  private readonly ringY = new Float64Array(RING);
  private readonly ringT = new Float64Array(RING);
  private ringHead = 0;
  private ringLen = 0;

  constructor(scheme: Scheme) {
    this.scheme = scheme;
  }

  setScheme(scheme: Scheme): void {
    if (scheme === this.scheme) return;
    this.scheme = scheme;
    // Carve is derived from the live thumb state on every sample, so nothing latched can stick.
    // Only the swipe tracker restarts from where the thumb is now.
    this.armed = true;
    this.ringLen = 0;
    if (this.thumb !== NO_POINTER) this.pushSample(this.stick.x, this.stick.y, this.lastT);
  }

  down(id: number, x: number, y: number, t: number): void {
    this.lastT = t;
    if (this.thumb !== NO_POINTER) {
      if (id !== this.thumb) this.hopQueued = true;
      return;
    }
    this.thumb = id;
    this.downX = x;
    this.downY = y;
    this.downT = t;
    this.decided = false;
    this.armed = true;
    this.ringLen = 0;
    this.pushSample(x, y, t);
    const s = this.stick;
    s.active = true;
    s.ox = x;
    s.oy = y;
    s.x = x;
    s.y = y;
  }

  move(id: number, x: number, y: number, t: number): void {
    if (id !== this.thumb) return;
    this.lastT = t;
    const s = this.stick;
    const dx = x - s.x;
    const dy = y - s.y;
    s.x = x;
    s.y = y;
    this.updateDecided(t);

    let shifted = false;
    if (this.scheme === 'swipe') {
      this.pushSample(x, y, t);
      shifted = this.trackFlick(x, y, t, dx, dy);
    }
    if (!shifted) this.dragOrigin();
  }

  up(id: number, t: number): void {
    if (id !== this.thumb) return;
    this.lastT = t;
    this.updateDecided(t);
    if (this.scheme === 'lift' || (this.scheme === 'tuck' && !this.decided)) this.hopQueued = true;
    this.release();
  }

  cancelAll(): void {
    this.release();
    this.hopQueued = false;
  }

  sample(out: InputFrame, t: number): void {
    this.lastT = t;
    out.hop = this.hopQueued;
    this.hopQueued = false;
    if (this.thumb === NO_POINTER) {
      out.steerX = 0;
      out.steerY = 0;
      out.carve = false;
      return;
    }
    this.updateDecided(t);
    if (this.scheme === 'swipe' && !this.armed && this.upwardSpeed(t) < FEEL.swipeSpeed * 0.5) {
      this.armed = true;
    }

    const s = this.stick;
    const rx = s.x - s.ox;
    const ry = s.oy - s.y;
    const len = Math.sqrt(rx * rx + ry * ry);
    const outside = len > FEEL.stickDeadPx;
    if (outside) {
      const k = (len > FEEL.stickRadiusPx ? FEEL.stickRadiusPx : len) / FEEL.stickRadiusPx / len;
      out.steerX = rx * k;
      out.steerY = ry * k;
    } else {
      out.steerX = 0;
      out.steerY = 0;
    }
    out.carve = this.scheme === 'lift' ? outside : this.decided;
  }

  private release(): void {
    this.thumb = NO_POINTER;
    this.decided = false;
    this.armed = true;
    this.ringLen = 0;
    this.stick.active = false;
  }

  /** Beyond the stick radius the origin trails the thumb, so reversing is immediate. */
  private dragOrigin(): void {
    const s = this.stick;
    const rx = s.x - s.ox;
    const ry = s.y - s.oy;
    const len = Math.sqrt(rx * rx + ry * ry);
    const r = FEEL.stickRadiusPx;
    if (len > r) {
      const k = (len - r) / len;
      s.ox += rx * k;
      s.oy += ry * k;
    }
  }

  private updateDecided(t: number): void {
    if (this.decided || this.thumb === NO_POINTER) return;
    const dx = this.stick.x - this.downX;
    const dy = this.stick.y - this.downY;
    const slop = FEEL.tapSlopPx;
    if (dx * dx + dy * dy > slop * slop || t - this.downT > FEEL.tapMaxMs) this.decided = true;
  }

  private pushSample(x: number, y: number, t: number): void {
    if (this.ringLen === RING) {
      this.ringHead = (this.ringHead + 1) % RING;
      this.ringLen--;
    }
    const i = (this.ringHead + this.ringLen) % RING;
    this.ringX[i] = x;
    this.ringY[i] = y;
    this.ringT[i] = t;
    this.ringLen++;
  }

  /** Greatest upward speed, px/ms, from any sample in the window to the thumb's position now. */
  private upwardSpeed(t: number): number {
    let best = 0;
    const y = this.stick.y;
    for (let n = 0; n < this.ringLen; n++) {
      const i = (this.ringHead + n) % RING;
      const dt = t - this.ringT[i];
      if (dt > FLICK_WINDOW_MS || dt <= 0) continue;
      const v = (this.ringY[i] - y) / dt;
      if (v > best) best = v;
    }
    return best;
  }

  /**
   * Swipe: detect a flick, and keep the stick origin moving with it so the deflection after the flick
   * is what it was before. Returns true when it moved the origin (so it is not also dragged).
   */
  private trackFlick(x: number, y: number, t: number, dx: number, dy: number): boolean {
    const s = this.stick;
    if (!this.armed) {
      if (this.upwardSpeed(t) < FEEL.swipeSpeed * 0.5) {
        this.armed = true;
      } else {
        s.ox += dx;
        s.oy += dy;
        return true;
      }
    }
    for (let n = 0; n < this.ringLen; n++) {
      const i = (this.ringHead + n) % RING;
      const dt = t - this.ringT[i];
      if (dt > FLICK_WINDOW_MS || dt <= 0) continue;
      const up = this.ringY[i] - y;
      if (up >= FEEL.swipeMinPx && up / dt > FEEL.swipeSpeed) {
        this.hopQueued = true;
        this.armed = false;
        // Put the origin back where it would be had the thumb never flicked.
        s.ox += x - this.ringX[i];
        s.oy += y - this.ringY[i];
        return true;
      }
    }
    return false;
  }
}
