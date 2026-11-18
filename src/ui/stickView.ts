/**
 * The faint stick under the thumb: a ring where the thumb landed (sized to the stick's full-travel
 * radius) and a dot where it is now. Visible only while a touch is active, never takes pointer
 * events, and is moved by transform only.
 */
import type { Gestures } from '../input/gestures';
import { FEEL } from '../sim/constants';
import './stickView.css';

/** The ring is laid out at this size, CSS px, and scaled to the stick radius. */
const RING_BASE_PX = 100;

export class StickView {
  readonly element: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly dot: HTMLElement;
  private shown = false;

  constructor(root: HTMLElement, private readonly gestures: Gestures) {
    const el = document.createElement('div');
    el.className = 'stick-view';
    el.setAttribute('aria-hidden', 'true');
    this.ring = document.createElement('div');
    this.ring.className = 'stick-ring';
    this.dot = document.createElement('div');
    this.dot.className = 'stick-dot';
    el.appendChild(this.ring);
    el.appendChild(this.dot);
    el.style.visibility = 'hidden';
    root.appendChild(el);
    this.element = el;
  }

  update(): void {
    const s = this.gestures.stick;
    if (s.active !== this.shown) {
      this.shown = s.active;
      this.element.style.visibility = s.active ? 'visible' : 'hidden';
    }
    if (!s.active) return;
    const scale = (FEEL.stickRadiusPx * 2) / RING_BASE_PX;
    this.ring.style.transform = `translate(${s.ox}px, ${s.oy}px) scale(${scale})`;
    this.dot.style.transform = `translate(${s.x}px, ${s.y}px)`;
  }
}
