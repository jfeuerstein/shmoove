/**
 * A split-flap row: a fixed number of character cells, each with a hairline split. When a
 * character changes, only that cell is touched and it flips in two steps (animated on twos).
 */
import { el } from './dom';

export class FlapRow {
  readonly el: HTMLElement;
  private readonly cells: HTMLElement[] = [];
  private readonly chars: string[] = [];
  private readonly flipB: boolean[] = [];
  private text = '';

  constructor(
    readonly size: number,
    readonly align: 'left' | 'right' = 'left',
    cls = '',
  ) {
    this.el = el('span', 'sk-flap' + (cls ? ' ' + cls : ''));
    for (let i = 0; i < size; i++) {
      const c = el('span', 'sk-cell');
      this.el.appendChild(c);
      this.cells.push(c);
      this.chars.push(' ');
      this.flipB.push(false);
    }
  }

  get value(): string {
    return this.text;
  }

  /** Show `text`, truncated or padded to the row. Cheap when nothing changed. */
  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const n = this.size;
    const t = text.length > n ? text.slice(0, n) : text;
    const pad = n - t.length;
    for (let i = 0; i < n; i++) {
      const j = this.align === 'right' ? i - pad : i;
      const ch = j >= 0 && j < t.length ? t[j] : ' ';
      if (ch === this.chars[i]) continue;
      this.chars[i] = ch;
      const c = this.cells[i];
      c.textContent = ch === ' ' ? '' : ch;
      // Alternate between two identical animations so a change restarts it without a reflow.
      const b = !this.flipB[i];
      this.flipB[i] = b;
      c.classList.toggle('sk-fa', !b);
      c.classList.toggle('sk-fb', b);
    }
  }
}
