/**
 * The settings screen (paper, like the chalk screen): music and effects volumes as stepped
 * sliders drawn as rows of flaps (0-10), switches for haptics, hints, reduced motion and the
 * print pass, INSTALL when offered, RESET SAVE (confirmed twice), and the credits line.
 */
import { el } from './dom';
import { FlapRow } from './flap';
import { shellButton } from './titleKit';
import type { Twos } from './twos';

/** Slider steps above zero (matches src/app/settings.ts VOLUME_STEPS). */
export const SLIDER_STEPS = 10;

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

class Slider {
  readonly el: HTMLElement;
  private readonly cells: HTMLButtonElement[] = [];
  private readonly value: FlapRow;
  private shown = -1;

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
    const cells = el('div', 'sk-scells');
    for (let i = 1; i <= SLIDER_STEPS; i++) {
      const c = shellButton('sk-scell', '', key + i, () => this.set(this.get() === i ? i - 1 : i));
      c.setAttribute('aria-label', `${label} ${i}`);
      cells.appendChild(c);
      this.cells.push(c);
    }
    const up = shellButton('sk-sstep', '+', key + 'Up', () => this.set(this.get() + 1));
    up.setAttribute('aria-label', `${label} up`);
    track.append(down, cells, up);
    this.el.append(head, track);
  }

  render(step: number): void {
    if (step === this.shown) return;
    this.shown = step;
    this.value.set(String(step));
    for (let i = 0; i < this.cells.length; i++) this.cells[i].classList.toggle('sk-lit', i < step);
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
  private readonly resetNote: HTMLElement;
  /** 0: RESET SAVE, 1: SURE?, 2: REALLY?, 3: wiped. */
  private resetStage = 0;

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
    this.reset = shellButton('sk-sreset', 'Reset save', 'setReset', () => this.pressReset());
    this.resetNote = el('div', 'sk-snote', 'Wipes inked lines, chalk lines, play time and settings');
    const resetRow = el('div', 'sk-srow sk-sresetrow');
    resetRow.append(this.reset, this.resetNote);
    app.append(this.installRow, resetRow);

    const credits = el('div', 'sk-scredits');
    credits.append(
      el('div', 'sk-scredhead', `Skitch ${host.version}`),
      el('div', 'sk-scredbody', 'Santa Rampa Transit Authority. Every shape, colour and sound is made in code.'),
    );
    body.append(sound, play, app, credits);
    this.el.append(head, body);
  }

  /** Open afresh: the reset confirmation starts over. */
  open(): void {
    this.resetStage = 0;
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
    const labels = ['Reset save', 'Sure?', 'Really? Tap again', 'Save wiped'];
    this.reset.textContent = labels[this.resetStage];
    this.reset.classList.toggle('sk-sdanger', this.resetStage === 1 || this.resetStage === 2);
    this.reset.disabled = this.resetStage === 3;
  }

  private pressReset(): void {
    this.host.tap();
    this.resetStage++;
    if (this.resetStage === 3) this.host.resetSave();
    this.render();
  }

  private cardHead(title: string, serial: string): HTMLElement {
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', title), el('span', 'sk-serial', serial));
    return head;
  }
}
