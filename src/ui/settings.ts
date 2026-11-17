/**
 * The settings screen (paper, like the chalk screen): music and effects volumes as stepped
 * sliders drawn as rows of flaps (0-10), switches for haptics, hints, reduced motion and the
 * print pass, INSTALL when offered, RESET SAVE, and the credits line.
 *
 * Each slider is one control the height of a thumb: a tap or a drag across the row of flaps sets
 * the value from the touch's x, with − and + steps either side. RESET SAVE opens a tear-off ticket
 * (like NEW GAME's) for the two confirmations, each on its own control, the destructive one on the
 * other side the second time so a double tap cannot wipe; the confirmation lapses after
 * RESET_TIMEOUT_MS without input.
 */
import { el } from './dom';
import { FlapRow } from './flap';
import { shellButton } from './titleKit';
import type { Twos } from './twos';

/** Slider steps above zero (matches src/app/settings.ts VOLUME_STEPS). */
export const SLIDER_STEPS = 10;
/** The reset confirmation goes away after this long without input, ms. */
export const RESET_TIMEOUT_MS = 3000;
/** A drag this far (px) from where the touch landed sets the slider by position, not as a tap. */
const DRAG_PX = 6;

export interface SettingsValues {
  /** 0..1. */
  music: number;
  sfx: number;
  haptics: boolean;
  hints: boolean;
  reduced: boolean;
  riso: boolean;
}

export type SwitchKey = 'haptics' | 'hints' | 'reduced' | 'riso';

export interface SettingsHost {
  values(): SettingsValues;
  change(patch: Partial<SettingsValues>): void;
  close(): void;
  resetSave(): void;
  install(): void;
  installAvailable(): boolean;
  iosHint(): boolean;
  readonly version: string;
  tap(): void;
}

const stepOf = (v: number): number => Math.max(0, Math.min(SLIDER_STEPS, Math.round(v * SLIDER_STEPS)));

/**
 * The slider step under a point at `x` on a row of `steps` cells spanning [left, left + width]:
 * the cell's number (1..steps), 0 at or left of the row's start, `steps` past its end.
 */
export function sliderStepAt(x: number, left: number, width: number, steps: number): number {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  const f = (x - left) / width;
  if (f <= 0) return 0;
  return Math.max(1, Math.min(steps, Math.ceil(f * steps)));
}

/** A tap on cell `cell` with the slider at `current`: that cell, or one less if it is the lit top cell. */
export function sliderTap(cell: number, current: number): number {
  return cell === current ? Math.max(0, cell - 1) : cell;
}

/**
 * The RESET SAVE confirmation, pure (times are passed in, in ms): 0 idle, 1 the ticket asks,
 * 2 it asks again, 3 the save is wiped. Any input restarts the timeout; RESET_TIMEOUT_MS without
 * input while asking goes back to idle.
 */
export class ResetConfirm {
  stage: 0 | 1 | 2 | 3 = 0;
  private last = 0;

  get asking(): boolean {
    return this.stage === 1 || this.stage === 2;
  }

  /** The RESET SAVE button: open the ticket. */
  open(now: number): void {
    if (this.stage !== 0) return;
    this.stage = 1;
    this.last = now;
  }

  /** The ticket's first destructive control: ask again. Only acts at stage 1. */
  confirmFirst(now: number): void {
    if (this.stage !== 1) return;
    this.stage = 2;
    this.last = now;
  }

  /** The ticket's second destructive control: wipe. Returns true when this press wiped. */
  confirmSecond(now: number): boolean {
    if (this.stage !== 2) return false;
    this.stage = 3;
    this.last = now;
    return true;
  }

  /** KEEP, or the screen closing: back to idle (a wiped save stays wiped). */
  cancel(): void {
    if (this.asking) this.stage = 0;
  }

  /** Back to idle after the screen reopens, whatever happened before. */
  reset(): void {
    this.stage = 0;
  }

  /** Any touch on the screen while asking. */
  input(now: number): void {
    if (this.asking) this.last = now;
  }

  /** Lapse the question if nothing happened for RESET_TIMEOUT_MS. Returns true if it lapsed now. */
  expire(now: number): boolean {
    if (!this.asking || now - this.last < RESET_TIMEOUT_MS) return false;
    this.stage = 0;
    return true;
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

class Slider {
  readonly el: HTMLElement;
  private readonly row: HTMLElement;
  private readonly cells: HTMLElement[] = [];
  private readonly value: FlapRow;
  private shown = -1;
  private pointer = -1;
  private downX = 0;
  private dragging = false;

  constructor(
    twos: Twos,
    label: string,
    key: string,
    private readonly set: (step: number) => void,
    private readonly get: () => number,
  ) {
    this.el = el('div', 'sk-srow sk-sslider');
    const head = el('div', 'sk-shead');
    this.value = new FlapRow(twos, 2, 'right', 'sk-sval');
    head.append(el('span', 'sk-slabel', label), this.value.el);
    const track = el('div', 'sk-strack');
    const down = shellButton('sk-sstep', '−', key + 'Down', () => this.set(this.get() - 1));
    down.setAttribute('aria-label', `${label} down`);
    // One control for the whole row of flaps: the touch's x picks the value.
    this.row = el('div', 'sk-scells');
    this.row.dataset.sk = key + 'Row';
    this.row.tabIndex = 0;
    this.row.setAttribute('role', 'slider');
    this.row.setAttribute('aria-label', label);
    this.row.setAttribute('aria-valuemin', '0');
    this.row.setAttribute('aria-valuemax', String(SLIDER_STEPS));
    for (let i = 1; i <= SLIDER_STEPS; i++) {
      // Not controls themselves; named for the e2e hook so a route can aim at a cell.
      const c = el('span', 'sk-scell');
      c.dataset.sk = key + i;
      this.row.appendChild(c);
      this.cells.push(c);
    }
    this.row.addEventListener('pointerdown', (e) => this.onDown(e));
    this.row.addEventListener('pointermove', (e) => this.onMove(e));
    this.row.addEventListener('pointerup', (e) => this.onEnd(e));
    this.row.addEventListener('pointercancel', (e) => this.onEnd(e));
    this.row.addEventListener('click', (e) => e.stopPropagation());
    this.row.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.set(this.get() - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.set(this.get() + 1);
      else return;
      e.preventDefault();
    });
    const up = shellButton('sk-sstep', '+', key + 'Up', () => this.set(this.get() + 1));
    up.setAttribute('aria-label', `${label} up`);
    track.append(down, this.row, up);
    this.el.append(head, track);
  }

  render(step: number): void {
    if (step === this.shown) return;
    this.shown = step;
    this.value.set(String(step));
    this.row.setAttribute('aria-valuenow', String(step));
    for (let i = 0; i < this.cells.length; i++) this.cells[i].classList.toggle('sk-lit', i < step);
  }

  /** The step under client x, measured on the first and last cells (the row's padding is not a cell). */
  private stepAt(x: number): number {
    const first = this.cells[0].getBoundingClientRect();
    const last = this.cells[this.cells.length - 1].getBoundingClientRect();
    return sliderStepAt(x, first.left, last.right - first.left, SLIDER_STEPS);
  }

  private onDown(e: PointerEvent): void {
    e.stopPropagation();
    if (this.pointer !== -1) return;
    this.pointer = e.pointerId;
    this.downX = e.clientX;
    this.dragging = false;
    try {
      this.row.setPointerCapture(e.pointerId);
    } catch (_e) {
      // Capture is a nicety: without it a drag that leaves the row just stops following.
    }
    const cur = this.get();
    const next = sliderTap(this.stepAt(e.clientX), cur);
    if (next !== cur) this.set(next);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    if (!this.dragging && Math.abs(e.clientX - this.downX) < DRAG_PX) return;
    this.dragging = true;
    const next = this.stepAt(e.clientX);
    if (next !== this.get()) this.set(next);
  }

  private onEnd(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.dragging = false;
  }
}

class Switch {
  readonly el: HTMLElement;
  private readonly flap: FlapRow;
  private readonly btn: HTMLButtonElement;

  constructor(twos: Twos, label: string, note: string, key: string, onTap: () => void) {
    this.el = el('div', 'sk-srow sk-sswitch');
    const words = el('div', 'sk-swords');
    words.append(el('span', 'sk-slabel', label), el('span', 'sk-snote', note));
    this.flap = new FlapRow(twos, 3, 'left');
    this.btn = shellButton('sk-stoggle', '', key, onTap);
    this.btn.appendChild(this.flap.el);
    this.el.append(words, this.btn);
  }

  render(on: boolean): void {
    this.flap.set(on ? 'ON' : 'OFF');
    this.btn.classList.toggle('sk-lit', on);
    this.btn.setAttribute('aria-pressed', String(on));
  }
}

export class SettingsScreen {
  readonly el: HTMLElement;
  private readonly title: FlapRow;
  private readonly music: Slider;
  private readonly sfx: Slider;
  private readonly switches: Array<[SwitchKey, Switch]>;
  private readonly installRow: HTMLElement;
  private readonly installHint: HTMLElement;
  private readonly installBtn: HTMLButtonElement;
  private readonly reset: HTMLButtonElement;
  private readonly confirmEl: HTMLElement;
  private readonly askFirst: HTMLElement;
  private readonly askSecond: HTMLElement;
  private readonly confirmHead: HTMLElement;
  private readonly confirmBody: HTMLElement;
  private readonly resetConfirm = new ResetConfirm();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    twos: Twos,
    private readonly host: SettingsHost,
  ) {
    this.el = el('div', 'sk-settings');
    const head = el('div', 'sk-maphead sk-chalkhead');
    this.title = new FlapRow(twos, 8);
    const close = shellButton('sk-close', 'Close', 'setClose', () => {
      this.host.tap();
      this.host.close();
    });
    close.classList.remove('sk-sbtn');
    close.setAttribute('aria-label', 'Close the settings');
    head.append(this.title.el, close);

    const body = el('div', 'sk-chalkbody sk-sbody');
    const sound = el('div', 'sk-ticket sk-scard');
    sound.appendChild(this.cardHead('Sound', 'Nº 01'));
    const volume = (k: 'music' | 'sfx') => (step: number) => {
      this.host.tap();
      this.host.change({ [k]: Math.max(0, Math.min(SLIDER_STEPS, step)) / SLIDER_STEPS });
      this.render();
    };
    this.music = new Slider(twos, 'Music', 'setMusic', volume('music'), () => stepOf(this.host.values().music));
    this.sfx = new Slider(twos, 'Effects', 'setSfx', volume('sfx'), () => stepOf(this.host.values().sfx));
    sound.append(this.music.el, this.sfx.el);

    const play = el('div', 'sk-ticket sk-scard');
    play.appendChild(this.cardHead('Ride', 'Nº 02'));
    const sw = (k: SwitchKey, label: string, note: string, key: string): [SwitchKey, Switch] => [
      k,
      new Switch(twos, label, note, key, () => {
        this.host.tap();
        this.host.change({ [k]: !this.host.values()[k] });
        this.render();
      }),
    ];
    this.switches = [
      sw('haptics', 'Haptics', 'Feel hitches, landings and bails', 'setHapticsBtn'),
      sw('hints', 'Hints', 'Show tips while you learn', 'setHintsBtn'),
      sw('reduced', 'Reduced motion', 'No camera shake, no flips', 'setReducedBtn'),
      sw('riso', 'Print pass', 'Risograph ink, grain and misregistration', 'setRisoBtn'),
    ];
    for (const [, s] of this.switches) play.appendChild(s.el);

    const app = el('div', 'sk-ticket sk-scard');
    app.appendChild(this.cardHead('Ticket office', 'Nº 03'));
    this.installRow = el('div', 'sk-srow sk-sinstall');
    this.installBtn = shellButton('sk-crace', 'Install Skitch', 'setInstall', () => {
      this.host.tap();
      this.host.install();
      this.render();
    });
    this.installHint = el('div', 'sk-snote sk-shint', 'To install: Share → Add to Home Screen');
    this.installRow.append(this.installBtn, this.installHint);
    this.reset = shellButton('sk-sreset', 'Reset save', 'setReset', () => {
      this.host.tap();
      this.resetConfirm.open(now());
      this.armTimer();
      this.render();
    });
    const resetNote = el('div', 'sk-snote', 'Wipes inked lines, chalk lines, play time and settings');
    const resetRow = el('div', 'sk-srow sk-sresetrow');
    resetRow.append(this.reset, resetNote);
    app.append(this.installRow, resetRow);

    const credits = el('div', 'sk-scredits');
    credits.append(
      el('div', 'sk-scredhead', `Skitch v${host.version}`),
      el('div', 'sk-scredbody', 'Santa Rampa Transit Authority. Every shape, colour and sound is made in code.'),
    );
    body.append(sound, play, app, credits);

    // The tear-off ticket that confirms RESET SAVE, twice, on different controls.
    this.confirmEl = el('div', 'sk-tconfirm sk-sconfirm');
    const ticket = el('div', 'sk-ticket sk-big sk-ttear');
    const thead = el('div', 'sk-thead');
    this.confirmHead = el('span', 'sk-op');
    thead.append(this.confirmHead, el('span', 'sk-serial', 'Nº 03'));
    this.confirmBody = el('div', 'sk-ttearbody');
    const keep = (key: string): HTMLButtonElement =>
      shellButton('', 'Keep', key, () => {
        this.host.tap();
        this.resetConfirm.cancel();
        this.render();
      });
    this.askFirst = el('div', 'sk-cacts');
    this.askFirst.append(
      keep('setResetKeep1'),
      shellButton('sk-sdanger', 'Wipe it', 'setResetWipe1', () => {
        this.host.tap();
        this.resetConfirm.confirmFirst(now());
        this.armTimer();
        this.render();
      }),
    );
    this.askSecond = el('div', 'sk-cacts');
    this.askSecond.append(
      shellButton('sk-sdanger', 'Wipe for good', 'setResetWipe2', () => {
        this.host.tap();
        if (this.resetConfirm.confirmSecond(now())) this.host.resetSave();
        this.render();
      }),
      keep('setResetKeep2'),
    );
    ticket.append(thead, this.confirmBody, this.askFirst, this.askSecond);
    this.confirmEl.appendChild(ticket);
    // Any touch while asking keeps the question open a little longer.
    this.el.addEventListener(
      'pointerdown',
      () => {
        if (!this.resetConfirm.asking) return;
        this.resetConfirm.input(now());
        this.armTimer();
      },
      true,
    );

    this.el.append(head, body, this.confirmEl);
  }

  /** Open afresh: the reset confirmation starts over. */
  open(): void {
    this.resetConfirm.reset();
    this.clearTimer();
    this.title.set('SETTINGS');
    this.render();
    const body = this.el.querySelector('.sk-sbody');
    if (body) body.scrollTop = 0;
  }

  render(): void {
    const v = this.host.values();
    this.music.render(stepOf(v.music));
    this.sfx.render(stepOf(v.sfx));
    for (const [k, s] of this.switches) s.render(v[k]);
    const offer = this.host.installAvailable();
    const hint = this.host.iosHint();
    this.installRow.style.display = offer || hint ? '' : 'none';
    this.installBtn.style.display = offer ? '' : 'none';
    this.installHint.style.display = hint && !offer ? '' : 'none';
    const stage = this.resetConfirm.stage;
    this.reset.textContent = stage === 3 ? 'Save wiped' : 'Reset save';
    this.reset.disabled = stage === 3;
    this.confirmEl.classList.toggle('sk-on', stage === 1 || stage === 2);
    this.askFirst.style.display = stage === 1 ? '' : 'none';
    this.askSecond.style.display = stage === 2 ? '' : 'none';
    this.confirmHead.textContent = stage === 2 ? 'Really?' : 'Wipe the save?';
    this.confirmBody.textContent =
      stage === 2 ? 'No undo. The skater goes back to the start.' : 'Inked lines, chalk lines, play time and settings are torn up.';
    if (stage !== 1 && stage !== 2) this.clearTimer();
  }

  private armTimer(): void {
    this.clearTimer();
    if (!this.resetConfirm.asking || typeof setTimeout === 'undefined') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.resetConfirm.expire(now())) this.render();
      else this.armTimer();
    }, RESET_TIMEOUT_MS + 20);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private cardHead(title: string, serial: string): HTMLElement {
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', title), el('span', 'sk-serial', serial));
    return head;
  }
}
