/**
 * The end of a run: a card that rises over the lower half of the screen, 0.6 s after the run stops,
 * with how it went, one big AGAIN button in the thumb zone and a smaller HOW TO PLAY under it. `endCard` is the pure "what to show
 * and when"; `EndScreen` is the DOM around it. The card is a DOM sibling of the canvas, so touches on
 * it never reach the game; they are also stopped here.
 */
import { PALETTE } from '../render/look';
import { BOSS_TIMES } from '../sim/balance';
import { PHASE_DEAD, PHASE_PLAY, PHASE_WON, type World } from '../sim/world';
import { formatTime } from './hud';
import './endScreen.css';

/** Seconds the last moment is left on screen before the card rises. */
export const END_PAUSE_SEC = 0.6;

export interface EndCard {
  title: string;
  /** Time survived, `m:ss`. */
  time: string;
  kills: number;
  level: number;
  pops: number;
  bestPop: number;
  /** Bosses brought down this run. */
  bosses: number;
}

/** The card to show `elapsed` seconds after the run ended, or null while it is playing or paused. */
export function endCard(w: World, elapsed: number): EndCard | null {
  const phase = w.run.phase;
  if (phase === PHASE_PLAY || elapsed < END_PAUSE_SEC) return null;
  if (phase !== PHASE_DEAD && phase !== PHASE_WON) return null;
  const p = w.player;
  return {
    // Won means the final boss fell.
    title: phase === PHASE_DEAD ? 'STOPPED' : 'CLEARED',
    time: formatTime(w.run.ticks / 60),
    kills: p.kills,
    level: p.level,
    pops: p.pops,
    bestPop: p.bestPop,
    bosses: w.boss.felled,
  };
}

function noop(): void {}

export class EndScreen {
  readonly element: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly button: HTMLElement;
  private readonly howToButton: HTMLElement;
  private elapsed = 0;
  private shown = false;

  /** `doc` is a seam so tests can build the card over a fake element tree. */
  constructor(
    root: HTMLElement,
    private readonly onAgain: () => void,
    doc: Document = document,
    private readonly onHowTo: () => void = noop,
  ) {
    const el = doc.createElement('div');
    el.className = 'end';
    el.setAttribute('aria-live', 'polite');
    this.titleEl = doc.createElement('div');
    this.titleEl.className = 'end-title';
    el.appendChild(this.titleEl);
    for (const cls of ['end-time', 'end-kills', 'end-level', 'end-bosses', 'end-pops']) {
      const row = doc.createElement('div');
      row.className = `end-row ${cls}`;
      el.appendChild(row);
      this.rows.push(row);
    }
    this.button = doc.createElement('button');
    this.button.className = 'end-again';
    this.button.textContent = 'AGAIN';
    this.button.style.backgroundColor = `#${PALETTE.accent.toString(16).padStart(6, '0')}`;
    el.appendChild(this.button);
    this.howToButton = doc.createElement('button');
    this.howToButton.className = 'end-howto';
    this.howToButton.textContent = 'HOW TO PLAY';
    el.appendChild(this.howToButton);

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.shown) this.onAgain();
    });
    this.howToButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.shown) this.onHowTo();
    });
    root.appendChild(el);
    this.element = el;
  }

  /** `dt` is the seconds since the last call. Only a run with a horde ever ends. */
  update(w: World, dt: number): void {
    if (w.run.phase === PHASE_PLAY) {
      this.elapsed = 0;
    } else {
      this.elapsed += dt;
    }
    const card = endCard(w, this.elapsed);
    if (card === null) {
      this.hide();
      return;
    }
    if (this.shown) return;
    this.shown = true;
    this.titleEl.textContent = card.title;
    this.rows[0].textContent = `Time  ${card.time}`;
    this.rows[1].textContent = `Kills  ${card.kills}`;
    this.rows[2].textContent = `Level  ${card.level}`;
    this.rows[3].textContent = `Bosses  ${card.bosses} / ${BOSS_TIMES.length}`;
    // Loops only mean something to a player who carried the Wake and closed one.
    this.rows[4].textContent = card.pops > 0 ? `Loops  ${card.pops}  (best ${card.bestPop})` : '';
    this.rows[4].hidden = card.pops === 0;
    this.element.className = 'end end-show';
  }

  /** Clear the card and the pause timer: a new run begins. */
  reset(): void {
    this.elapsed = 0;
    this.hide();
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.element.className = 'end';
  }
}
