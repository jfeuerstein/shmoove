/**
 * A split-flap row: a fixed number of character cells, each with a hairline split. When a
 * character changes, only that cell is touched and it flips in two steps (on twos, see twos.ts).
 */
import { el } from './dom';
import type { Twos } from './twos';

export class FlapRow {
  readonly el: HTMLElement;
  private readonly cells: HTMLElement[] = [];
  private readonly chars: string[] = [];
  private text = '';

  constructor(
    private readonly twos: Twos,
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
      this.twos.play(c, 'sk-f1', 'sk-f2');
    }
  }
}
