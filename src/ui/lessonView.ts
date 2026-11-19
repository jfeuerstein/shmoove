/**
 * The first-run lesson on screen: its current line in a band just under the top of the HUD (clear
 * of the middle of the screen and the thumb zone), a row of seven dots for progress, a short tick
 * when a step completes, and a SKIP button under the kills counter. DOM writes only when a value
 * changes. The button stops touches so they never reach the game.
 */
import { PALETTE } from '../render/look';
import { STEP_COUNT, type Lesson } from '../app/lesson';
import './lessonView.css';

export class LessonView {
  readonly element: HTMLElement;
  private readonly band: HTMLElement;
  private readonly text: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private line = '';
  private done = -1;
  private step = -1;
  private tickPhase = 0;
  private shown = false;

  /** `doc` is a seam so tests can build the view over a fake element tree. */
  constructor(root: HTMLElement, private readonly onSkip: () => void, options: { debug?: boolean } = {}, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = options.debug === true ? 'lesson lesson-debug' : 'lesson';
    el.setAttribute('aria-live', 'polite');
    this.band = doc.createElement('div');
    this.band.className = 'lesson-band';
    this.text = doc.createElement('div');
    this.text.className = 'lesson-text';
    this.band.appendChild(this.text);
    const row = doc.createElement('div');
    row.className = 'lesson-dots';
    for (let i = 0; i < STEP_COUNT; i++) {
      const d = doc.createElement('div');
      d.className = 'lesson-dot';
      row.appendChild(d);
      this.dots.push(d);
    }
    this.band.appendChild(row);
    el.appendChild(this.band);

    const skip = doc.createElement('button');
    skip.className = 'lesson-skip';
    skip.textContent = 'SKIP';
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      skip.addEventListener(type, (e) => e.stopPropagation());
    }
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSkip();
    });
    el.appendChild(skip);
    el.style.setProperty('--lesson-accent', `#${PALETTE.accent.toString(16).padStart(6, '0')}`);
    el.hidden = true;
    root.appendChild(el);
    this.element = el;
  }

  /** Show the lesson's state; call every frame while it runs. */
  update(lesson: Lesson): void {
    if (!this.shown) {
      this.shown = true;
      this.element.hidden = false;
    }
    if (lesson.line !== this.line) {
      this.line = lesson.line;
      this.text.textContent = lesson.line;
    }
    if (lesson.done !== this.done || lesson.step !== this.step) {
      if (this.done >= 0 && lesson.done > this.done) {
        // Alternate between two identical animations so each completion restarts the tick.
        this.tickPhase ^= 1;
        this.band.className = this.tickPhase ? 'lesson-band tick-a' : 'lesson-band tick-b';
      }
      this.done = lesson.done;
      this.step = lesson.step;
      for (let i = 0; i < this.dots.length; i++) {
        this.dots[i].className = i < lesson.done ? 'lesson-dot lesson-dot-done' : i === lesson.step ? 'lesson-dot lesson-dot-now' : 'lesson-dot';
      }
    }
  }

  /** The lesson is over: take it off the screen and forget what it showed. */
  hide(): void {
    this.shown = false;
    this.element.hidden = true;
    this.line = '';
    this.done = -1;
    this.step = -1;
    this.band.className = 'lesson-band';
  }
}
