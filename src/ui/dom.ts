/** Tiny DOM helpers shared by the UI components. */
import type { CompiledLine } from '../sim/lines';
import { hexColor, textOn } from './format';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Sets text only when it changed (no DOM write otherwise). */
export class TextSlot {
  private v = '';
  constructor(readonly el: HTMLElement) {}
  set(v: string): void {
    if (v === this.v) return;
    this.v = v;
    this.el.textContent = v;
  }
}

/** Toggles a class only when the state changed. */
export class ClassSlot {
  private on = false;
  constructor(
    readonly el: HTMLElement,
    readonly cls: string,
  ) {}
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** A line badge: the id on a chip in the livery base colour, with the stripe colour as a band. */
export function makeBadge(line: CompiledLine, cls = ''): HTMLElement {
  const b = el('span', 'sk-badge' + (cls ? ' ' + cls : ''), line.id);
  styleBadge(b, line);
  return b;
}

export function styleBadge(b: HTMLElement, line: CompiledLine): void {
  b.textContent = line.id;
  b.style.setProperty('--sk-base', hexColor(line.livery.base));
  b.style.setProperty('--sk-stripe', hexColor(line.livery.stripe));
  b.style.color = textOn(line.livery.base);
}
