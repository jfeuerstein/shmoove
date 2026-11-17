/**
 * The onboarding hint stub: one hint at a time as a small ticket low on the screen, a thumb glyph
 * animated on twos, a few words, and a punched hole that is punched through (with the punch sound)
 * when the step is learnt. It slides in and out on twos. Plus the one-time map pointer: a mango
 * chevron bobbing beside the map button while the 'map' ticket is up.
 *
 * An observer: it reads `game.onboarding` and game events and never writes game state.
 */
import type { Game, GameEvent } from '../sim/game/game';
import { ONBOARDING_STEPS, type HintId } from '../sim/game/onboarding';
import { ClassSlot, TextSlot, el } from './dom';
import { GLYPH_FRAMES, glyphFrame, hintCopy, type GlyphKind } from './hintCopy';
import { glyphSvg } from './hintGlyphs';
import type { UiSound } from './index';
import { TWOS_STEP, type Twos } from './twos';

/** How long the punched stub stays up before it slides away, seconds. */
const PUNCH_HOLD = 0.6;

const MAP_POINTER =
  '<svg viewBox="0 0 30 30" aria-hidden="true">' +
  '<path d="M20 5 L9 15 L20 25" stroke="#1B1A2E" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M20 5 L9 15 L20 25" stroke="#FFAE1A" stroke-width="4.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

type Phase = 'idle' | 'in' | 'punch' | 'out';

export class HintStub {
  readonly el: HTMLElement;
  readonly mapPointer: HTMLElement;
  private readonly ticket: HTMLElement;
  private readonly glyphBox: HTMLElement;
  private readonly title: TextSlot;
  private readonly sub: TextSlot;
  private readonly hole: HTMLElement;
  private readonly on: ClassSlot;
  private readonly pointerOn: ClassSlot;
  private readonly bob: ClassSlot;
  /** The hint on the stub ('' when none), and what the stub is doing. */
  private shownId: HintId | '' = '';
  private phase: Phase = 'idle';
  private punchLeft = 0;
  private glyph: GlyphKind | '' = '';
  private frame = -1;
  private steps = 0;
  private stepClock = 0;
  private lastRetry = false;
  private lastStop = '';

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
    private readonly sound: UiSound | null,
  ) {
    this.el = el('div', 'sk-hint');
    this.el.dataset.sk = 'hint';
    this.el.setAttribute('role', 'status');
    this.ticket = el('div', 'sk-ticket sk-hticket');
    this.glyphBox = el('div', 'sk-hglyph');
    const text = el('div', 'sk-htext');
    const t = el('span', 'sk-htitle');
    const s = el('span', 'sk-hsub');
    text.append(t, s);
    this.hole = el('i', 'sk-hhole');
    this.ticket.append(this.glyphBox, text, this.hole);
    this.el.appendChild(this.ticket);
    this.title = new TextSlot(t);
    this.sub = new TextSlot(s);
    this.on = new ClassSlot(this.el, 'sk-on');
    this.mapPointer = el('div', 'sk-hmapptr');
    this.mapPointer.innerHTML = MAP_POINTER;
    this.pointerOn = new ClassSlot(this.mapPointer, 'sk-on');
    this.bob = new ClassSlot(this.mapPointer, 'sk-b1');
  }

  /** The hint the player can see now ('' while none is up or the stub is leaving). */
  get hint(): HintId | '' {
    return this.phase === 'out' ? '' : this.shownId;
  }

  /** Steps learnt so far, the chain included. */
  get doneCount(): number {
    let n = 0;
    for (const s of ONBOARDING_STEPS) if (this.game.onboarding.done[s]) n++;
    return n;
  }

  onEvent(e: GameEvent): void {
    if (e.type !== 'hintDone' || e.step !== this.shownId || this.phase === 'out') return;
    // Punch the hole through, hold a moment, then slide away.
    this.phase = 'punch';
    this.punchLeft = PUNCH_HOLD;
    this.ticket.classList.add('sk-hdone');
    this.twos.play(this.hole, 'sk-p1', 'sk-p2');
    this.sound?.ui('punch');
  }

  /** `hidden`: a screen is open (or the UI otherwise wants the stub away). */
  update(dt: number, hidden: boolean): void {
    const ob = this.game.onboarding;
    const want: HintId | '' = hidden ? '' : ob.shown;
    if (this.phase === 'punch') {
      this.punchLeft -= dt;
      if (this.punchLeft <= 0 || hidden) this.leave();
    } else if (this.phase !== 'out' && want !== this.shownId) {
      if (this.shownId !== '') this.leave();
      else if (want !== '') this.enter(want);
    } else if (this.phase === 'in' && (ob.slingRetry !== this.lastRetry || ob.stopName !== this.lastStop)) {
      this.fill(this.shownId);
    }
    this.animate(dt);
  }

  private enter(id: HintId): void {
    this.shownId = id;
    this.phase = 'in';
    this.ticket.classList.remove('sk-hdone');
    this.el.dataset.hint = id;
    this.fill(id);
    this.on.set(true);
    this.twos.play(this.el, 'sk-in1', 'sk-in2');
    this.pointerOn.set(id === 'map');
  }

  private leave(): void {
    this.phase = 'out';
    this.pointerOn.set(false);
    this.twos.play(this.el, 'sk-out1', 'sk-out2', () => {
      this.on.set(false);
      this.shownId = '';
      this.phase = 'idle';
      this.ticket.classList.remove('sk-hdone');
    });
  }

  private fill(id: HintId | ''): void {
    if (id === '') return;
    const ob = this.game.onboarding;
    this.lastRetry = ob.slingRetry;
    this.lastStop = ob.stopName;
    const c = hintCopy(id, ob);
    this.title.set(c.title);
    this.sub.set(c.sub);
    if (c.glyph !== this.glyph) {
      if (this.frame >= 0) this.glyphBox.classList.remove('sk-g' + this.frame);
      this.glyph = c.glyph;
      this.glyphBox.innerHTML = glyphSvg(c.glyph);
      this.frame = -1;
      this.steps = 0;
      this.stepClock = 0;
    }
  }

  /** Glyph frames and the map pointer's bob, stepped on twos from the frame clock. */
  private animate(dt: number): void {
    if (this.shownId === '' || this.glyph === '') return;
    this.stepClock += dt;
    while (this.stepClock >= TWOS_STEP) {
      this.stepClock -= TWOS_STEP;
      this.steps++;
    }
    const f = Math.min(glyphFrame(this.glyph, this.steps), GLYPH_FRAMES[this.glyph] - 1);
    if (f !== this.frame) {
      if (this.frame >= 0) this.glyphBox.classList.remove('sk-g' + this.frame);
      this.glyphBox.classList.add('sk-g' + f);
      this.frame = f;
    }
    this.bob.set(this.shownId === 'map' && Math.floor(this.steps / 3) % 2 === 1);
  }
}
