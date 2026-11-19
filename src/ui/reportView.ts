/**
 * Getting a report out: copy one to the clipboard (a text box to copy from by hand where the
 * clipboard is refused), and the REPORTS sheet that lists the kept ones. A DOM sibling of the
 * canvas, above the pause sheet and the how-to sheet, and it stops touches reaching the game.
 */
import type { ReportStore } from '../app/reports';
import { clock, reportText, type RunReport } from '../app/runLog';
import './reportView.css';

/** How long "Copied" stays on a button, ms. */
export const COPIED_MS = 1500;

const OUTCOME_LABEL: Record<RunReport['outcome'], string> = { running: 'RUNNING', dead: 'DIED', won: 'CLEARED', abandoned: 'LEFT' };

/** `Nov 19 14:05` from a start time in ms. */
export function whenLabel(ms: number): string {
  const d = new Date(ms);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${mon} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** One line of the list: when, outcome, run time. */
export function reportRowText(r: RunReport): string {
  return `${whenLabel(r.id)}  ${OUTCOME_LABEL[r.outcome]}  ${clock(r.seconds)}`;
}

/** Put text on the clipboard. False where that is not allowed. */
export async function writeClipboard(text: string, nav: Navigator = navigator): Promise<boolean> {
  try {
    if (!nav.clipboard) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch (_err) {
    return false;
  }
}

const STOP = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup'];

export class ReportView {
  readonly sheet: HTMLElement;
  readonly box: HTMLElement;
  private readonly list: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly flashTimers = new Map<HTMLElement, number>();

  constructor(
    root: HTMLElement,
    private readonly store: ReportStore,
    private readonly doc: Document = document,
  ) {
    const d = doc;
    // The list.
    const sheet = d.createElement('div');
    sheet.className = 'reports';
    sheet.hidden = true;
    const title = d.createElement('div');
    title.className = 'reports-title';
    title.textContent = 'REPORTS';
    const list = d.createElement('div');
    list.className = 'reports-list';
    const all = d.createElement('button');
    all.className = 'reports-all';
    all.type = 'button';
    all.textContent = 'COPY ALL';
    const close = d.createElement('button');
    close.className = 'reports-close';
    close.type = 'button';
    close.textContent = 'CLOSE';
    sheet.append(title, list, all, close);

    // The fallback: a box of text to select and copy by hand.
    const box = d.createElement('div');
    box.className = 'reports-box';
    box.hidden = true;
    const hint = d.createElement('div');
    hint.className = 'reports-hint';
    hint.textContent = 'Copy this text by hand';
    const ta = d.createElement('textarea');
    ta.className = 'reports-text';
    ta.readOnly = true;
    const boxClose = d.createElement('button');
    boxClose.className = 'reports-close';
    boxClose.type = 'button';
    boxClose.textContent = 'DONE';
    box.append(hint, ta, boxClose);

    for (const el of [sheet, box]) for (const type of STOP) el.addEventListener(type, (e) => e.stopPropagation());
    all.addEventListener('click', (e) => {
      e.stopPropagation();
      const items = this.store.list();
      if (items.length === 0) return;
      void this.copyText(items.map(reportText).join('\n\n'), all);
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    boxClose.addEventListener('click', (e) => {
      e.stopPropagation();
      box.hidden = true;
    });

    root.append(sheet, box);
    this.sheet = sheet;
    this.box = box;
    this.list = list;
    this.textarea = ta;
  }

  get isOpen(): boolean {
    return !this.sheet.hidden;
  }

  /** Show the kept reports, newest first. */
  open(): void {
    this.fill();
    this.sheet.hidden = false;
  }

  close(): void {
    this.sheet.hidden = true;
    this.box.hidden = true;
  }

  /** Copy one report; `button` shows "Copied" for a moment, or the box opens if the clipboard refuses. */
  copy(report: RunReport, button: HTMLElement | null = null): Promise<boolean> {
    return this.copyText(reportText(report), button);
  }

  private async copyText(text: string, button: HTMLElement | null): Promise<boolean> {
    const ok = await writeClipboard(text);
    if (ok) {
      if (button) this.flash(button, 'Copied');
      return true;
    }
    this.textarea.value = text;
    this.box.hidden = false;
    this.textarea.focus();
    this.textarea.select();
    return false;
  }

  private flash(button: HTMLElement, word: string): void {
    const prior = this.flashTimers.get(button);
    if (prior !== undefined) window.clearTimeout(prior);
    else button.dataset.label = button.textContent ?? '';
    button.textContent = word;
    const label = button.dataset.label ?? '';
    this.flashTimers.set(
      button,
      window.setTimeout(() => {
        button.textContent = label;
        this.flashTimers.delete(button);
      }, COPIED_MS),
    );
  }

  private fill(): void {
    const items = this.store.list();
    this.list.replaceChildren();
    if (items.length === 0) {
      const none = this.doc.createElement('div');
      none.className = 'reports-none';
      none.textContent = 'No runs kept yet.';
      this.list.appendChild(none);
      return;
    }
    for (const r of items) {
      const row = this.doc.createElement('div');
      row.className = 'reports-row';
      const text = this.doc.createElement('span');
      text.className = 'reports-when';
      text.textContent = reportRowText(r);
      const btn = this.doc.createElement('button');
      btn.className = 'reports-copy';
      btn.type = 'button';
      btn.textContent = 'COPY';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.copy(r, btn);
      });
      row.append(text, btn);
      this.list.appendChild(row);
    }
  }
}
