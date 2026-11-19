/**
 * How to play: one sheet of eight lines, opened from the end card and closed by a button on it, with
 * a second button that sends the player back into the lesson and a third that switches the sound on
 * or off. It fits 390x844 without scrolling.
 * Like the end card it is a DOM sibling of the canvas and stops touches reaching the game.
 */
import type { SoundControls } from '../audio/audio';
import { PALETTE } from '../render/look';
import './howTo.css';

export interface HowToLine {
  /** The bold word before the colon, if the line has one. */
  lead?: string;
  text: string;
}

/** The eight lines, in the order read. */
export const HOW_TO_LINES: readonly HowToLine[] = [
  { lead: 'Drag', text: 'steer. Let go: coast. Tap: ollie.' },
  { text: 'Tap again as you land and you keep your speed.' },
  { text: 'Hills, half-pipes and the green pads make you fast.' },
  { text: 'Your weapons fire themselves. You only have to move.' },
  { text: 'Touching an enemy hurts. An ollie clears the small ones.' },
  { text: 'Sparks are XP. A level is a card: a weapon, a level on one you carry, or a passive.' },
  { text: 'Ollie onto a white rail to grind it. Ollie again to get off.' },
  { text: 'Ride into crates and shrines. Ride between the gates in order. Jump through hoops. Totems call elites.' },
];

export class HowTo {
  readonly element: HTMLElement;
  private opened = false;
  private readonly soundBtn: HTMLButtonElement | null = null;

  /**
   * `doc` is a seam so tests can build the sheet over a fake element tree. `sound` is the switch the
   * SOUND button flips; without one there is no button.
   */
  constructor(
    root: HTMLElement,
    private readonly onReplay: () => void,
    doc: Document = document,
    private readonly sound: SoundControls | null = null,
  ) {
    const el = doc.createElement('div');
    el.className = 'howto';
    el.hidden = true;
    const title = doc.createElement('div');
    title.className = 'howto-title';
    title.textContent = 'HOW TO PLAY';
    el.appendChild(title);
    for (const line of HOW_TO_LINES) {
      const row = doc.createElement('div');
      row.className = 'howto-line';
      if (line.lead !== undefined) {
        const lead = doc.createElement('b');
        lead.className = 'howto-lead';
        lead.textContent = `${line.lead}: `;
        row.appendChild(lead);
      }
      const text = doc.createElement('span');
      text.textContent = line.text;
      row.appendChild(text);
      el.appendChild(row);
    }
    const replay = doc.createElement('button');
    replay.className = 'howto-replay';
    replay.textContent = 'REPLAY THE LESSON';
    const close = doc.createElement('button');
    close.className = 'howto-close';
    close.textContent = 'CLOSE';
    close.style.backgroundColor = `#${PALETTE.accent.toString(16).padStart(6, '0')}`;
    if (sound) {
      const btn = doc.createElement('button');
      btn.className = 'howto-sound';
      el.appendChild(btn);
      this.soundBtn = btn;
      this.syncSound();
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        sound.setMuted(!sound.muted);
        this.syncSound();
      });
    }
    el.appendChild(replay);
    el.appendChild(close);

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    replay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.opened) return;
      this.close();
      this.onReplay();
    });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    root.appendChild(el);
    this.element = el;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.element.hidden = false;
    this.syncSound();
  }

  /** The button says what the sound is now: SOUND ON or SOUND OFF. */
  private syncSound(): void {
    const b = this.soundBtn;
    if (!b || !this.sound) return;
    const on = !this.sound.muted;
    b.textContent = on ? 'SOUND ON' : 'SOUND OFF';
    b.setAttribute('aria-pressed', String(on));
    b.className = on ? 'howto-sound' : 'howto-sound off';
  }

  close(): void {
    this.opened = false;
    this.element.hidden = true;
  }
}
