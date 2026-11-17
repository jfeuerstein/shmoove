/**
 * The title screen, over the paused game: a SKITCH wordmark in big split-flap cells that flip in
 * letter by letter, the strapline, and the menu: PLAY (CONTINUE with the map percentage when a
 * save exists), NEW GAME (with a save; confirmed on a tear-off ticket), SETTINGS and INSTALL when
 * the browser offers it (or the iOS Share hint).
 */
import { el } from './dom';
import { FlapRow } from './flap';
import { shellButton } from './titleKit';
import { TWOS_STEP, type Twos } from './twos';

export const WORDMARK = 'SKITCH';
/** Time between letters of the wordmark: two steps on twos. */
const LETTER_EVERY = 2 * TWOS_STEP;
const FIRST_LETTER = 2 * TWOS_STEP;

export interface TitleHost {
  play(): void;
  newGame(): void;
  settings(): void;
  install(): void;
  tap(): void;
}

export interface TitleFacts {
  hasSave: boolean;
  mapPercent: number;
  installAvailable: boolean;
  iosHint: boolean;
}

export class TitleScreen {
  readonly el: HTMLElement;
  private readonly word: FlapRow;
  private readonly play: HTMLButtonElement;
  private readonly playSub: HTMLElement;
  private readonly newGame: HTMLButtonElement;
  private readonly install: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly confirm: HTMLElement;
  private t = 0;
  private confirming = false;
  private facts: TitleFacts = { hasSave: false, mapPercent: 0, installAvailable: false, iosHint: false };

  constructor(
    twos: Twos,
    private readonly host: TitleHost,
  ) {
    this.el = el('div', 'sk-title');
    const top = el('div', 'sk-ttop');
    const board = el('div', 'sk-panel sk-tboard');
    this.word = new FlapRow(twos, WORDMARK.length, 'left', 'sk-tword');
    board.appendChild(this.word.el);
    const strap = el('div', 'sk-tstrap', 'Santa Rampa Transit · No pushing');
    top.append(board, strap);

    const menu = el('div', 'sk-tmenu');
    this.play = shellButton('sk-tplay', '', 'titlePlay', () => {
      this.host.tap();
      this.host.play();
    });
    const playLabel = el('span', 'sk-tplaylabel');
    this.playSub = el('span', 'sk-tplaysub');
    this.play.append(playLabel, this.playSub);
    this.newGame = shellButton('sk-tline', 'New game', 'titleNew', () => {
      this.host.tap();
      this.setConfirm(true);
    });
    const settings = shellButton('sk-tline', 'Settings', 'titleSettings', () => {
      this.host.tap();
      this.host.settings();
    });
    this.install = shellButton('sk-tinstall', 'Install', 'titleInstall', () => {
      this.host.tap();
      this.host.install();
    });
    this.hint = el('div', 'sk-thint', 'Share → Add to Home Screen');
    const row = el('div', 'sk-trow');
    row.append(this.newGame, settings);
    menu.append(this.play, row, this.install, this.hint);

    // The tear-off ticket that confirms a new game.
    this.confirm = el('div', 'sk-tconfirm');
    const ticket = el('div', 'sk-ticket sk-big sk-ttear');
    const head = el('div', 'sk-thead');
    head.append(el('span', 'sk-op', 'Start over?'), el('span', 'sk-serial', 'Nº 000000'));
    const body = el('div', 'sk-ttearbody', 'Inked lines, chalk lines and play time are torn up. Settings stay.');
    const acts = el('div', 'sk-cacts');
    acts.append(
      shellButton('sk-sdanger', 'Tear it up', 'titleTear', () => {
        this.host.tap();
        this.setConfirm(false);
        this.host.newGame();
      }),
      shellButton('', 'Keep', 'titleKeep', () => {
        this.host.tap();
        this.setConfirm(false);
      }),
    );
    ticket.append(head, body, acts);
    this.confirm.appendChild(ticket);

    this.el.append(top, menu, this.confirm);
    playLabel.textContent = 'Play';
  }

  get confirmOpen(): boolean {
    return this.confirming;
  }

  /** The wordmark as it reads now (it fills in letter by letter). */
  get wordmark(): string {
    return this.word.value;
  }

  /** Show the screen afresh: the wordmark flips in again. */
  open(facts: TitleFacts, instant: boolean): void {
    this.t = instant ? 99 : 0;
    this.word.set('');
    this.setConfirm(false);
    this.refresh(facts);
    this.step(0, instant);
  }

  refresh(facts: TitleFacts): void {
    this.facts = facts;
    const label = this.play.querySelector('.sk-tplaylabel');
    if (label) label.textContent = facts.hasSave ? 'Continue' : 'Play';
    this.playSub.textContent = facts.hasSave ? `${facts.mapPercent}% of the map inked` : '';
    this.playSub.style.display = facts.hasSave ? '' : 'none';
    this.newGame.style.display = facts.hasSave ? '' : 'none';
    this.install.style.display = facts.installAvailable ? '' : 'none';
    this.hint.style.display = facts.iosHint ? '' : 'none';
  }

  get playLabel(): string {
    return this.facts.hasSave ? 'CONTINUE' : 'PLAY';
  }

  step(dt: number, instant: boolean): void {
    this.t += dt;
    const n = instant ? WORDMARK.length : Math.max(0, Math.min(WORDMARK.length, Math.floor((this.t - FIRST_LETTER) / LETTER_EVERY) + 1));
    this.word.set(WORDMARK.slice(0, n));
  }

  private setConfirm(on: boolean): void {
    this.confirming = on;
    this.confirm.classList.toggle('sk-on', on);
  }
}
