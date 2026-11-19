import type { InputFrame } from '../sim/types';
import { Gestures } from './gestures';
import type { InputSource, Scheme } from './source';

/** Binds pointer and key events on an element to `Gestures`. Keys are for desktop development. */
export class TouchInput implements InputSource {
  readonly gestures: Gestures;
  private readonly el: HTMLElement;
  private keyUp = false;
  private keyDown = false;
  private keyLeft = false;
  private keyRight = false;
  private keyHop = false;

  constructor(el: HTMLElement, scheme: Scheme) {
    this.el = el;
    this.gestures = new Gestures(scheme);
    el.addEventListener('pointerdown', this.onDown, { passive: false });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: false });
    el.addEventListener('pointercancel', this.onCancel, { passive: false });
    el.addEventListener('lostpointercapture', this.onLostCapture);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onLoseFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setScheme(scheme: Scheme): void {
    this.gestures.setScheme(scheme);
  }

  sample(out: InputFrame): void {
    this.gestures.sample(out, performance.now());
    const x = (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0);
    const y = (this.keyUp ? 1 : 0) - (this.keyDown ? 1 : 0);
    if ((this.keyRight || this.keyLeft || this.keyUp || this.keyDown) && !out.carve) {
      const len = Math.sqrt(x * x + y * y);
      out.steerX = len > 0 ? x / len : 0;
      out.steerY = len > 0 ? y / len : 0;
      out.carve = true;
    }
    if (this.keyHop) {
      out.hop = true;
      this.keyHop = false;
    }
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('lostpointercapture', this.onLostCapture);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onLoseFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.onLoseFocus();
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch (_err) {
      // Capture is a nicety: a synthetic or already-gone pointer may refuse it.
    }
    this.gestures.down(e.pointerId, e.clientX, e.clientY, performance.now());
  };

  private readonly onMove = (e: PointerEvent): void => {
    e.preventDefault();
    this.gestures.move(e.pointerId, e.clientX, e.clientY, performance.now());
  };

  private readonly onUp = (e: PointerEvent): void => {
    e.preventDefault();
    this.gestures.up(e.pointerId, performance.now());
  };

  /**
   * Capture was lost: if the pointerup never came, this is the only sign the touch ended. It is a
   * release of that id. When the normal pointerup did arrive, the thumb is already gone and
   * `Gestures.up` ignores the id, so nothing is counted twice (a `lift` release hops once).
   */
  private readonly onLostCapture = (e: PointerEvent): void => {
    this.gestures.up(e.pointerId, performance.now());
  };

  private readonly onCancel = (e: PointerEvent): void => {
    e.preventDefault();
    this.gestures.cancelAll();
  };

  private setKey(code: string, on: boolean): boolean {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        this.keyUp = on;
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.keyDown = on;
        return true;
      case 'ArrowLeft':
      case 'KeyA':
        this.keyLeft = on;
        return true;
      case 'ArrowRight':
      case 'KeyD':
        this.keyRight = on;
        return true;
      default:
        return false;
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      if (!e.repeat) this.keyHop = true;
      e.preventDefault();
    } else if (this.setKey(e.code, true)) {
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.setKey(e.code, false);
  };

  private readonly onLoseFocus = (): void => {
    this.keyUp = false;
    this.keyDown = false;
    this.keyLeft = false;
    this.keyRight = false;
    this.keyHop = false;
    this.gestures.cancelAll();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.onLoseFocus();
  };
}
