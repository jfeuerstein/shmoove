/**
 * Pause: a button in the HUD's top right corner and, while paused, a plain overlay that says PAUSED
 * with RESUME and HOW TO PLAY.
 *
 * The game also pauses itself when the page is hidden, on `pagehide`, and when the window loses
 * focus, and stays paused until RESUME is pressed. What pausing does to the game (the clock, the
 * sound) is the app's: this only keeps the state, shows it and calls back. The overlay sits above
 * the cards, the lesson and the end card and changes none of them, so RESUME comes back to exactly
 * the screen that was up. Like the other sheets it is a DOM sibling of the canvas, and neither it nor
 * the button lets a touch reach the game: pressing them never steers or ollies.
 */
import { PALETTE } from '../render/look';
import { PHASE_CHOOSE, PHASE_PLAY } from '../sim/world';
import './pause.css';

export interface PauseHost {
  /** The game has just paused: stop the clock and the sound. */
  onPause(): void;
  /** The player pressed RESUME: start them again. */
  onResume(): void;
  /** HOW TO PLAY on the overlay. */
  onHowTo(): void;
  /** REPORTS on the overlay (the kept run reports). No button without it. */
  onReports?(): void;
}

/**
 * Is the pause button offered: while the run is played or a card is being chosen, and not during
 * the lesson (which has its own SKIP where the button would sit, and cannot be lost).
 */
export function pauseButtonShown(phase: number, inLesson: boolean): boolean {
  return !inLesson && (phase === PHASE_PLAY || phase === PHASE_CHOOSE);
}

const STOP = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup'];

export class PauseView {
  readonly button: HTMLButtonElement;
  readonly overlay: HTMLElement;
  private on = false;
  private buttonOn = true;

  /**
   * `debug`: the feel panel's button holds the corner, so this one sits beside it. `doc` is a seam so
   * tests can build it over a fake element tree.
   */
  constructor(
    root: HTMLElement,
    private readonly host: PauseHost,
    options: { debug?: boolean; reports?: boolean } = {},
    doc: Document = document,
  ) {
    const button = doc.createElement('button');
    button.className = options.debug === true ? 'pause-btn pause-btn-debug' : 'pause-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Pause');
    const bars = doc.createElement('span');
    bars.className = 'pause-bars';
    button.appendChild(bars);

    const overlay = doc.createElement('div');
    overlay.className = 'pause';
    overlay.hidden = true;
    const sheet = doc.createElement('div');
    sheet.className = 'pause-sheet';
    const title = doc.createElement('div');
    title.className = 'pause-title';
    title.textContent = 'PAUSED';
    const resume = doc.createElement('button');
    resume.className = 'pause-resume';
    resume.type = 'button';
    resume.textContent = 'RESUME';
    resume.style.backgroundColor = `#${PALETTE.accent.toString(16).padStart(6, '0')}`;
    const howTo = doc.createElement('button');
    howTo.className = 'pause-howto';
    howTo.type = 'button';
    howTo.textContent = 'HOW TO PLAY';
    sheet.appendChild(title);
    sheet.appendChild(resume);
    sheet.appendChild(howTo);
    const reports = options.reports === true ? doc.createElement('button') : null;
    if (reports) {
      reports.className = 'pause-howto pause-reports';
      reports.type = 'button';
      reports.textContent = 'REPORTS';
      sheet.appendChild(reports);
      reports.addEventListener('click', (e) => {
        e.stopPropagation();
        reports.blur();
        if (this.on) this.host.onReports?.();
      });
    }
    overlay.appendChild(sheet);

    for (const type of STOP) {
      button.addEventListener(type, (e) => e.stopPropagation());
      overlay.addEventListener(type, (e) => e.stopPropagation());
    }
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      // Never left focused: a later Space (the desktop ollie) must not press it again.
      button.blur();
      this.pause();
    });
    resume.addEventListener('click', (e) => {
      e.stopPropagation();
      resume.blur();
      this.resume();
    });
    howTo.addEventListener('click', (e) => {
      e.stopPropagation();
      howTo.blur();
      if (this.on) this.host.onHowTo();
    });

    root.appendChild(button);
    root.appendChild(overlay);
    this.button = button;
    this.overlay = overlay;
  }

  get paused(): boolean {
    return this.on;
  }

  /** Pause, if not already. */
  pause(): void {
    if (this.on) return;
    this.on = true;
    this.overlay.hidden = false;
    this.button.hidden = true;
    this.host.onPause();
  }

  /** Resume, if paused. */
  resume(): void {
    if (!this.on) return;
    this.on = false;
    this.overlay.hidden = true;
    this.button.hidden = !this.buttonOn;
    this.host.onResume();
  }

  /** Once a frame: offer the button or not (see `pauseButtonShown`). Written only when it changes. */
  update(phase: number, inLesson: boolean): void {
    const show = pauseButtonShown(phase, inLesson);
    if (show === this.buttonOn) return;
    this.buttonOn = show;
    if (!this.on) this.button.hidden = !show;
  }
}

/**
 * The game pauses itself when the page is hidden, on `pagehide`, and when the window loses focus.
 * Returns a function that unbinds it.
 */
export function bindAutoPause(win: Window, doc: Document, pause: () => void): () => void {
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') pause();
  };
  const onLeave = (): void => pause();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onLeave);
  win.addEventListener('blur', onLeave);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onLeave);
    win.removeEventListener('blur', onLeave);
  };
}
