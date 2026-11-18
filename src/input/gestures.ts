/**
 * One thumb -> InputFrame.
 *
 * - Drag left/right: steer, measured from where the finger went down (the anchor follows a finger
 *   that drags past full lock, so reversing responds at once).
 * - A touch that stays within the dead zone for HOLD_ARM_TIME arms `hold`. A touch that moves
 *   sideways first is a pure carve and never arms. Dragging after arming still steers.
 * - A fast upward flick is a hop (one tick). It does not end or disarm the touch.
 * - Pulling the finger down past BRAKE_PULL_PX from where it landed drags a foot (brake) until it
 *   comes back up. A thumb that just rests on the glass never brakes.
 *
 * The recogniser is clocked by sim ticks (call `sample()` once per tick), so scripted touches
 * replay identically in the e2e harness. Pointer events only feed positions in.
 */
import { DT, FEEL } from '../sim/constants';
import type { InputFrame } from '../sim/types';

interface Sample {
  t: number;
  y: number;
}

export class Gestures {
  private now = 0;
  private touching = false;
  private downT = 0;
  private downX = 0;
  private downY = 0;
  private anchorX = 0;
  private x = 0;
  private braking = false;
  private armed = false;
  private carveOnly = false;
  private hopQueued = false;
  private trail: Sample[] = [];

  // Keyboard (desktop and debugging).
  private keyLeft = false;
  private keyRight = false;
  private keyHold = false;
  private keyHop = false;
  private keyBrake = false;

  private readonly frame: InputFrame = { steer: 0, hold: false, hop: false, brake: false };

  /** True while a finger is on the glass (for UI hints). */
  get isTouching(): boolean {
    return this.touching;
  }

  /** True once the current touch can hitch. */
  get isArmed(): boolean {
    return (this.touching && this.armed) || this.keyHold;
  }

  down(x: number, y: number): void {
    this.touching = true;
    this.downT = this.now;
    this.downX = x;
    this.downY = y;
    this.anchorX = x;
    this.x = x;
    this.braking = false;
    this.armed = false;
    this.carveOnly = false;
    this.trail.length = 0;
    this.trail.push({ t: this.now, y });
  }

  move(x: number, y: number): void {
    if (!this.touching) return;
    this.x = x;
    // Pulled down far enough: brake, until the finger comes most of the way back.
    const pull = y - this.downY;
    if (pull > FEEL.BRAKE_PULL_PX) this.braking = true;
    else if (pull < FEEL.BRAKE_PULL_PX * 0.6) this.braking = false;
    // Sideways travel before arming makes this touch a pure carve. A mostly-vertical flick does
    // not: swipe-up-and-hold has to stay able to arm.
    const dx = Math.abs(x - this.downX);
    if (!this.armed && dx > FEEL.DRAG_DEADZONE_PX && dx > Math.abs(y - this.downY)) this.carveOnly = true;
    const range = FEEL.STEER_RANGE_PX;
    if (x - this.anchorX > range) this.anchorX = x - range;
    else if (x - this.anchorX < -range) this.anchorX = x + range;

    // Swipe up: enough upward travel inside the time window.
    this.trail.push({ t: this.now, y });
    // Keep one sample from before the window: where the finger was when the window opened.
    while (this.trail.length > 2 && this.now - this.trail[1].t > FEEL.SWIPE_UP_TIME) this.trail.shift();
    let top = this.trail[0].y;
    for (const s of this.trail) if (s.y > top) top = s.y;
    if (top - y >= FEEL.SWIPE_UP_PX) {
      this.hopQueued = true;
      // Start measuring again from here, so a second flick on the same touch counts.
      this.trail.length = 0;
      this.trail.push({ t: this.now, y });
    }
  }

  up(): void {
    this.touching = false;
    this.braking = false;
    this.armed = false;
    this.carveOnly = false;
    this.trail.length = 0;
  }

  key(code: string, pressed: boolean): boolean {
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keyLeft = pressed;
        return true;
      case 'ArrowRight':
      case 'KeyD':
        this.keyRight = pressed;
        return true;
      case 'Space':
        this.keyHold = pressed;
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.keyBrake = pressed;
        return true;
      case 'ArrowUp':
      case 'KeyW':
        if (pressed) this.keyHop = true;
        return true;
      default:
        return false;
    }
  }

  /** Advance one sim tick and return the input for it. The returned object is reused. */
  sample(): InputFrame {
    this.now += DT;
    if (this.touching && !this.armed && !this.carveOnly && this.now - this.downT >= FEEL.HOLD_ARM_TIME) {
      this.armed = true;
    }
    let steer = 0;
    if (this.touching) steer = (this.x - this.anchorX) / FEEL.STEER_RANGE_PX;
    if (this.keyLeft) steer -= 1;
    if (this.keyRight) steer += 1;
    this.frame.steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
    this.frame.hold = (this.touching && this.armed) || this.keyHold;
    this.frame.hop = this.hopQueued || this.keyHop;
    this.frame.brake = (this.touching && this.braking) || this.keyBrake;
    this.hopQueued = false;
    this.keyHop = false;
    return this.frame;
  }
}

/** Wire pointer and key events on `el` into a recogniser. Returns a function that unhooks them. */
export function attachGestures(el: HTMLElement, g: Gestures): () => void {
  let active = -1;
  const onDown = (e: PointerEvent): void => {
    if (active !== -1) return;
    active = e.pointerId;
    g.down(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    g.move(e.clientX, e.clientY);
    e.preventDefault();
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    active = -1;
    g.up();
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!e.repeat && g.key(e.code, true)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (g.key(e.code, false)) e.preventDefault();
  };
  const onBlur = (): void => {
    active = -1;
    g.up();
    for (const c of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'KeyA', 'KeyD', 'KeyS', 'Space']) g.key(c, false);
  };
  const opts: AddEventListenerOptions = { passive: false };
  el.addEventListener('pointerdown', onDown, opts);
  window.addEventListener('pointermove', onMove, opts);
  window.addEventListener('pointerup', onUp, opts);
  window.addEventListener('pointercancel', onUp, opts);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
