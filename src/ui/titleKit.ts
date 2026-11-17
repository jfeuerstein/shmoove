/** Small pieces shared by the app-shell screens (title, pause, settings, complete, rotate). */
import { el } from './dom';

/**
 * A shell button: acts on click (a tap, or a keyboard press), never lets the press reach the game.
 * `key` names it in the e2e hook (`${key}X`, `${key}Y`).
 */
export function shellButton(cls: string, text: string, key: string, onTap: () => void): HTMLButtonElement {
  const b = el('button', 'sk-sbtn' + (cls ? ' ' + cls : ''), text);
  b.type = 'button';
  b.dataset.sk = key;
  const stop = (e: Event): void => e.stopPropagation();
  b.addEventListener('pointerdown', stop);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    onTap();
  });
  return b;
}

/** Centres of the visible `[data-sk]` controls under `root`, written as `${key}X` / `${key}Y`. */
export function writeCentres(root: HTMLElement, out: Record<string, string | number | boolean>): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-sk]')) {
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const k = node.dataset.sk ?? '';
    out[k + 'X'] = Math.round(r.left + r.width / 2);
    out[k + 'Y'] = Math.round(r.top + r.height / 2);
  }
}

/** Shows or hides an element by toggling `sk-on`, touching the DOM only on change. */
export class Shown {
  private on = false;
  constructor(readonly el: HTMLElement) {}
  get value(): boolean {
    return this.on;
  }
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('sk-on', on);
  }
}

/** h:mm:ss for a duration in seconds (m:ss under an hour). */
export function playTimeText(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number): string => (n < 10 ? '0' : '') + n;
  return h > 0 ? `${h}:${two(m)}:${two(ss)}` : `${m}:${two(ss)}`;
}
