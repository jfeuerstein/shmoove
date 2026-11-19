/**
 * How to play: one sheet of seven lines, opened from the end card and closed by a button on it, with
 * a second button that sends the player back into the lesson. It fits 390x844 without scrolling.
 * Like the end card it is a DOM sibling of the canvas and stops touches reaching the game.
 */
import { PALETTE } from '../render/look';
import './howTo.css';

export interface HowToLine {
  /** The bold word before the colon, if the line has one. */
  lead?: string;
  text: string;
}

/** The seven lines, in the order read. */
export const HOW_TO_LINES: readonly HowToLine[] = [
  { lead: 'Drag', text: 'steer. Let go: coast. Tap: ollie.' },
  { text: 'Tap again as you land and you keep your speed.' },
  { text: 'Hills, half-pipes and the green pads make you fast.' },
  { text: 'Your weapons fire themselves. You only have to move.' },
  { text: 'Touching an enemy hurts. An ollie clears the small ones.' },
  { text: 'Sparks are XP. A level is a card: a weapon, a level on one you carry, or a passive.' },
  { text: 'Ride into crates. Circle shrines. Thread the gates. Fly through hoops.' },
];

export class HowTo {
  readonly element: HTMLElement;
  private opened = false;

  /** `doc` is a seam so tests can build the sheet over a fake element tree. */
  constructor(root: HTMLElement, private readonly onReplay: () => void, doc: Document = document) {
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
  }

  close(): void {
    this.opened = false;
    this.element.hidden = true;
  }
}
