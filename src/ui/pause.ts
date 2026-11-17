/**
 * Pause: the small button in the corner stack (under the map and chalk buttons) and the pause
 * card it opens: RESUME, the MAP and CHALK screens, SETTINGS and QUIT TO TITLE. A ledger shortcut
 * joins them once a ledger screen exists. Play does not step while the card is open.
 */
import { el } from './dom';
import { FlapRow } from './flap';
import { shellButton } from './titleKit';
import type { Twos } from './twos';

const PAUSE_ICON =
  '<svg viewBox="0 0 30 30" aria-hidden="true">' +
  '<rect x="8.5" y="7.5" width="5" height="16" rx="1" fill="#1F3FBF"/>' +
  '<rect x="17.5" y="7.5" width="5" height="16" rx="1" fill="#1F3FBF"/>' +
  '<rect x="7.5" y="6.5" width="5" height="16" rx="1" fill="#FFAE1A"/>' +
  '<rect x="16.5" y="6.5" width="5" height="16" rx="1" fill="#FFAE1A"/>' +
  '</svg>';

export interface PauseHost {
  resume(): void;
  /** Shortcuts; each is offered only if present. */
  openMap: (() => void) | null;
  openChalk: (() => void) | null;
  openLedger: (() => void) | null;
  settings(): void;
  quit(): void;
  tap(): void;
}

/** The corner button. Acts on click (taps and keyboard), never reaches the game's gestures. */
export function pauseButton(onTap: () => void): HTMLButtonElement {
  const b = el('button', 'sk-pausebtn');
  b.type = 'button';
  b.innerHTML = PAUSE_ICON;
  b.dataset.sk = 'pauseBtn';
  b.setAttribute('aria-label', 'Pause');
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onTap();
  });
  return b;
}

export class PauseCard {
  readonly el: HTMLElement;
  private readonly word: FlapRow;
  private readonly clock: FlapRow;

  constructor(twos: Twos, host: PauseHost) {
    this.el = el('div', 'sk-pause');
    const card = el('div', 'sk-pcard');
    const board = el('div', 'sk-panel sk-pboard');
    this.word = new FlapRow(twos, 6);
    this.clock = new FlapRow(twos, 5, 'right');
    board.append(this.word.el, this.clock.el);
    const ticket = el('div', 'sk-ticket sk-big sk-pticket');
    const resume = shellButton('sk-tplay sk-presume', 'Resume', 'pauseResume', () => {
      host.tap();
      host.resume();
    });
    const shortcuts = el('div', 'sk-cacts sk-prow');
    const add = (label: string, key: string, fn: (() => void) | null): void => {
      if (!fn) return;
      shortcuts.appendChild(
        shellButton('', label, key, () => {
          host.tap();
          fn();
        }),
      );
    };
    add('Map', 'pauseMap', host.openMap);
    add('Chalk', 'pauseChalk', host.openChalk);
    add('Ledger', 'pauseLedger', host.openLedger);
    const settings = shellButton('sk-pline', 'Settings', 'pauseSettings', () => {
      host.tap();
      host.settings();
    });
    const quit = shellButton('sk-pline sk-pquit', 'Quit to title', 'pauseQuit', () => {
      host.tap();
      host.quit();
    });
    ticket.append(resume);
    if (shortcuts.childElementCount > 0) ticket.appendChild(shortcuts);
    ticket.append(settings, quit);
    card.append(board, ticket);
    this.el.appendChild(card);
  }

  /** Fill the board as the card opens: PAUSED and the game clock. */
  open(clock: string): void {
    this.word.set('PAUSED');
    this.clock.set(clock);
  }
}
