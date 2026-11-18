/**
 * The feel panel, only with `?debug`. A button at the top right opens a sheet over the right two
 * thirds of the screen (the game keeps running on the left): the control scheme switch, then one
 * collapsible section per group with a slider per `FEEL` constant. Edits write `FEEL` directly and
 * are saved through `Settings`. `update()` keeps the rows in step with `FEEL` when it changes under
 * them (reset all) and does nothing while the sheet is closed.
 */
import type { Settings } from '../app/settings';
import { PALETTE } from '../render/look';
import { FEEL, FEEL_DEFS, FEEL_KEYS, resetFeel, type FeelDef, type FeelKey } from '../sim/constants';
import { SCHEMES, type Scheme } from '../input/source';
import './debugPanel.css';

const SCHEME_LABELS: Record<Scheme, string> = { tuck: 'Tuck', lift: 'Lift', swipe: 'Swipe' };
const SCHEME_HINTS: Record<Scheme, string> = {
  tuck: 'Touch down tucks and rolls',
  lift: 'Touch down runs, lift off tucks',
  swipe: 'Flick up to hop',
};

type Group = FeelDef['group'];

interface Row {
  key: FeelKey;
  root: HTMLElement;
  value: HTMLElement;
  slider: HTMLInputElement;
  reset: HTMLButtonElement;
  group: Group;
  shown: number;
}

interface Section {
  details: HTMLDetailsElement;
  badge: HTMLElement;
  changed: number;
}

function cssHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class DebugPanel {
  readonly element: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private readonly schemeButtons = new Map<Scheme, HTMLButtonElement>();
  private readonly rows: Row[] = [];
  private readonly sections = new Map<Group, Section>();
  private readonly copyBox: HTMLElement;
  private readonly copyText: HTMLTextAreaElement;
  private readonly copyBtn: HTMLButtonElement;
  private open = false;

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
    private readonly onScheme: (s: Scheme) => void,
  ) {
    const wrap = el('div', 'dbg');
    wrap.style.setProperty('--dbg-accent', cssHex(PALETTE.accent));
    wrap.style.setProperty('--dbg-pad', cssHex(PALETTE.pad));
    wrap.style.setProperty('--dbg-bg', cssHex(PALETTE.sky));
    wrap.style.setProperty('--dbg-line', cssHex(PALETTE.groundLine));
    wrap.style.setProperty('--dbg-card', cssHex(PALETTE.groundA));

    this.toggle = el('button', 'dbg-toggle', 'FEEL');
    this.toggle.type = 'button';
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-label', 'Feel panel');
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));

    this.sheet = el('div', 'dbg-sheet');
    this.sheet.hidden = true;
    // Nothing typed or touched here is the game's: keys do not reach the window-level steering.
    this.sheet.addEventListener('keydown', (e) => e.stopPropagation());
    this.sheet.addEventListener('keyup', (e) => e.stopPropagation());

    const head = el('div', 'dbg-head');
    const resetAll = el('button', 'dbg-btn', 'Reset all');
    resetAll.type = 'button';
    resetAll.addEventListener('click', () => {
      resetFeel();
      this.settings.saveFeel();
      this.sync();
    });
    this.copyBtn = el('button', 'dbg-btn', 'Copy changes');
    this.copyBtn.type = 'button';
    this.copyBtn.addEventListener('click', () => void this.copy());
    head.appendChild(resetAll);
    head.appendChild(this.copyBtn);
    this.sheet.appendChild(head);

    this.copyBox = el('div', 'dbg-copybox');
    this.copyBox.hidden = true;
    this.copyText = el('textarea', 'dbg-copytext');
    this.copyText.readOnly = true;
    this.copyText.rows = 6;
    this.copyBox.appendChild(this.copyText);
    this.sheet.appendChild(this.copyBox);

    const schemeBox = el('div', 'dbg-schemes');
    for (const s of SCHEMES) {
      const b = el('button', 'dbg-scheme');
      b.type = 'button';
      b.appendChild(el('span', 'dbg-scheme-name', SCHEME_LABELS[s]));
      b.appendChild(el('span', 'dbg-scheme-hint', SCHEME_HINTS[s]));
      b.addEventListener('click', () => {
        this.settings.chooseScheme(s);
        this.onScheme(s);
        this.syncScheme();
      });
      this.schemeButtons.set(s, b);
      schemeBox.appendChild(b);
    }
    this.sheet.appendChild(schemeBox);

    const groupOrder: Group[] = [];
    for (const k of FEEL_KEYS) {
      const g = FEEL_DEFS[k].group;
      if (!groupOrder.includes(g)) groupOrder.push(g);
    }
    for (const g of groupOrder) {
      const details = document.createElement('details');
      details.className = 'dbg-group';
      const summary = document.createElement('summary');
      summary.className = 'dbg-group-title';
      summary.appendChild(el('span', 'dbg-group-name', g));
      const badge = el('span', 'dbg-group-badge');
      badge.hidden = true;
      summary.appendChild(badge);
      details.appendChild(summary);
      this.sections.set(g, { details, badge, changed: 0 });
      this.sheet.appendChild(details);
    }
    for (const k of FEEL_KEYS) this.addRow(k);

    wrap.appendChild(this.sheet);
    wrap.appendChild(this.toggle);
    root.appendChild(wrap);
    this.element = wrap;
    this.syncScheme();
    this.sync();
  }

  /** Once per frame: pick up changes made to `FEEL` by anything else. Free while closed. */
  update(): void {
    if (!this.open) return;
    for (const r of this.rows) if (r.shown !== FEEL[r.key]) this.refreshRow(r);
    this.refreshBadges();
  }

  private setOpen(on: boolean): void {
    this.open = on;
    this.sheet.hidden = !on;
    this.toggle.setAttribute('aria-expanded', String(on));
    this.toggle.classList.toggle('on', on);
    if (on) this.sync();
  }

  private addRow(key: FeelKey): void {
    const def = FEEL_DEFS[key];
    const root = el('div', 'dbg-row');
    const top = el('div', 'dbg-row-top');
    top.appendChild(el('span', 'dbg-name', key));
    const value = el('span', 'dbg-value');
    top.appendChild(value);
    const reset = el('button', 'dbg-reset', 'Reset');
    reset.type = 'button';
    reset.hidden = true;
    reset.setAttribute('aria-label', `Reset ${key}`);
    top.appendChild(reset);
    root.appendChild(top);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'dbg-slider';
    slider.min = String(def.min);
    slider.max = String(def.max);
    slider.step = String(def.step);
    slider.setAttribute('aria-label', key);
    slider.dataset.key = key;
    root.appendChild(slider);
    root.appendChild(el('div', 'dbg-note', def.note));

    const row: Row = { key, root, value, slider, reset, group: def.group, shown: Number.NaN };
    slider.addEventListener('input', () => {
      const digits = decimalsOf(def.step);
      const v = Number(Number(slider.value).toFixed(digits));
      if (!Number.isFinite(v)) return;
      FEEL[key] = Math.min(def.max, Math.max(def.min, v));
      this.settings.saveFeel();
      this.refreshRow(row);
      this.refreshBadges();
    });
    reset.addEventListener('click', () => {
      FEEL[key] = def.v;
      this.settings.saveFeel();
      this.refreshRow(row);
      this.refreshBadges();
    });
    this.rows.push(row);
    const section = this.sections.get(def.group);
    if (section) section.details.appendChild(root);
  }

  private refreshRow(r: Row): void {
    const def = FEEL_DEFS[r.key];
    const v = FEEL[r.key];
    r.shown = v;
    r.value.textContent = v.toFixed(decimalsOf(def.step));
    if (document.activeElement !== r.slider || Number(r.slider.value) !== v) r.slider.value = String(v);
    const changed = v !== def.v;
    r.root.classList.toggle('changed', changed);
    r.reset.hidden = !changed;
  }

  private refreshBadges(): void {
    for (const s of this.sections.values()) s.changed = 0;
    for (const r of this.rows) {
      if (r.shown !== FEEL_DEFS[r.key].v) {
        const s = this.sections.get(r.group);
        if (s) s.changed++;
      }
    }
    for (const s of this.sections.values()) {
      s.badge.hidden = s.changed === 0;
      s.badge.textContent = `${s.changed} changed`;
    }
  }

  private sync(): void {
    for (const r of this.rows) this.refreshRow(r);
    this.refreshBadges();
  }

  private syncScheme(): void {
    for (const [s, b] of this.schemeButtons) {
      const on = s === this.settings.scheme;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  private async copy(): Promise<void> {
    const text = this.settings.text();
    try {
      await navigator.clipboard.writeText(text);
      this.copyBox.hidden = true;
      this.copyBtn.textContent = 'Copied';
      window.setTimeout(() => {
        this.copyBtn.textContent = 'Copy changes';
      }, 1500);
    } catch (_err) {
      // No clipboard (insecure page, permission refused): show the text to select by hand.
      this.copyText.value = text;
      this.copyBox.hidden = false;
      this.copyText.focus();
      this.copyText.select();
    }
  }
}
