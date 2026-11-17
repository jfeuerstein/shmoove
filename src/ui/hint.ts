/**
 * The onboarding hint stub: one hint at a time as a small ticket low on the screen, a thumb glyph
 * animated on twos, a few words, and a punched hole that is punched through (with the punch sound)
 * when the step is learnt. It slides in and out on twos. Plus the one-time map pointer: a mango
 * ring pulsing round the map button while the 'map' ticket is up; and the edge arrow: when the world
 * pointer's target is off-screen, behind the camera, or hidden behind the top board or the stub
 * itself, a big mango arrow at the edge of the clear part of the screen turns toward it.
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

/** Titles longer than this many characters print a size smaller, to stay on one line. */
const LONG_TITLE = 18;
/** How long the punched stub stays up before it slides away, seconds. */
const PUNCH_HOLD = 0.6;
/** The least it stays up punched when another hint is waiting, seconds. */
const PUNCH_MIN = 0.25;
/** The edge arrow keeps this far inside the clear part of the screen (its own half size and a gap), px. */
const EDGE_INSET = 30;
/** Screen rects the arrow keeps clear of are measured again every this many frames. */
const MEASURE_EVERY = 15;

/** Where the world pointer's target is on screen (what the hint view projects each frame). */
export interface HintPointerScreen {
  readonly active: boolean;
  /** Normalised device coordinates, -1..1 across the view. */
  readonly nx: number;
  readonly ny: number;
  /** Behind the camera (the coordinates already mirrored to the side it is on). */
  readonly behind: boolean;
}

const EDGE_SVG =
  '<svg viewBox="-24 -24 48 48" aria-hidden="true">' +
  '<path d="M-14 -15 L16 0 L-14 15 L-6 0 Z" fill="#1B1A2E" transform="translate(2 2)"/>' +
  '<path d="M-14 -15 L16 0 L-14 15 L-6 0 Z" fill="#FFAE1A" stroke="#1B1A2E" stroke-width="2.5" stroke-linejoin="round"/>' +
  '</svg>';

type Phase = 'idle' | 'in' | 'punch' | 'out';

export class HintStub {
  readonly el: HTMLElement;
  readonly mapPointer: HTMLElement;
  /** The edge arrow, turned toward a world target the player cannot see. */
  readonly edge: HTMLElement;
  private readonly ticket: HTMLElement;
  private readonly glyphBox: HTMLElement;
  private readonly title: TextSlot;
  private readonly sub: TextSlot;
  private readonly hole: HTMLElement;
  private readonly on: ClassSlot;
  private readonly long: ClassSlot;
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
  private lastCatch = false;
  private lastHop = false;
  private readonly edgeOn: ClassSlot;
  /** Where the arrow is now ('' hidden), as last written, to touch the DOM only on change. */
  private edgeX = -1;
  private edgeY = -1;
  private edgeA = 0;
  /** What the arrow is doing: '' no target, 'world' target in sight, 'edge' arrow showing. */
  private pointerState: '' | 'world' | 'edge' = '';
  private measureIn = 0;
  private clearTop = 0;
  private clearBottom = 0;

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
    this.long = new ClassSlot(this.ticket, 'sk-hlong');
    this.mapPointer = el('div', 'sk-hmapptr');
    this.pointerOn = new ClassSlot(this.mapPointer, 'sk-on');
    this.bob = new ClassSlot(this.mapPointer, 'sk-b1');
    this.edge = el('div', 'sk-hedge');
    this.edge.innerHTML = EDGE_SVG;
    this.edgeOn = new ClassSlot(this.edge, 'sk-on');
  }

  /** The world pointer as the player sees it: '' none, 'world' its target in sight, 'edge' the arrow showing. */
  get pointer(): '' | 'world' | 'edge' {
    return this.pointerState;
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

  /** `hidden`: a screen is open (or the UI otherwise wants the stub away). `pointer`: the world target on screen. */
  update(dt: number, hidden: boolean, pointer: HintPointerScreen | null = null): void {
    const ob = this.game.onboarding;
    const want: HintId | '' = hidden ? '' : ob.shown;
    if (this.phase === 'punch') {
      this.punchLeft -= dt;
      // Another hint waiting cuts the hold short, once the punch has been seen.
      const waiting = want !== '' && want !== this.shownId && PUNCH_HOLD - this.punchLeft >= PUNCH_MIN;
      if (this.punchLeft <= 0 || hidden || waiting) this.leave();
    } else if (this.phase !== 'out' && want !== this.shownId) {
      if (this.shownId !== '') this.leave();
      else if (want !== '') this.enter(want);
    } else if (this.phase === 'in' && (ob.slingRetry !== this.lastRetry || ob.stopName !== this.lastStop || ob.inkCatch !== this.lastCatch || ob.target.hop !== this.lastHop)) {
      this.fill(this.shownId);
    }
    this.animate(dt);
    this.aimEdge(pointer, hidden);
  }

  /**
   * Show the edge arrow when the world pointer's target cannot be seen: off-screen, behind the
   * camera, above the bottom of the top board or below the top of the stub. It sits where the line
   * from the middle of the clear part of the screen to the target leaves it, turned toward the target.
   */
  private aimEdge(pointer: HintPointerScreen | null, hidden: boolean): void {
    const up = !hidden && pointer !== null && pointer.active && (this.phase === 'in' || this.phase === 'punch');
    if (!up) {
      this.pointerState = '';
      this.edgeOn.set(false);
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (--this.measureIn <= 0) {
      this.measureIn = MEASURE_EVERY;
      const board = this.el.parentElement?.querySelector('.sk-board');
      const b = board ? board.getBoundingClientRect() : null;
      this.clearTop = b && b.height > 0 ? b.bottom : 0;
      const t = this.ticket.getBoundingClientRect();
      this.clearBottom = t.height > 0 ? t.top : H;
    }
    const top = this.clearTop + EDGE_INSET;
    const bottom = this.clearBottom - EDGE_INSET;
    const left = EDGE_INSET;
    const right = W - EDGE_INSET;
    const sx = ((pointer.nx + 1) / 2) * W;
    const sy = ((1 - pointer.ny) / 2) * H;
    if (!pointer.behind && sx >= left && sx <= right && sy >= top && sy <= bottom) {
      this.pointerState = 'world';
      this.edgeOn.set(false);
      return;
    }
    // From the middle of the clear area toward the target, out to its inset edge.
    const cx = W / 2;
    const cy = (top + bottom) / 2;
    const dx = sx - cx;
    let dy = sy - cy;
    // Behind the camera: the arrow points down, to the side the target is on.
    if (pointer.behind) dy = Math.max(Math.abs(dy), H);
    if (dx === 0 && dy === 0) dy = 1;
    let k = Infinity;
    if (dx > 0) k = Math.min(k, (right - cx) / dx);
    else if (dx < 0) k = Math.min(k, (left - cx) / dx);
    if (dy > 0) k = Math.min(k, (bottom - cy) / dy);
    else if (dy < 0) k = Math.min(k, (top - cy) / dy);
    if (!(k >= 0) || k === Infinity) k = 0;
    const x = Math.round(cx + dx * k);
    const y = Math.round(cy + dy * k);
    const a = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 5) * 5;
    this.pointerState = 'edge';
    this.edgeOn.set(true);
    if (x !== this.edgeX || y !== this.edgeY || a !== this.edgeA) {
      this.edgeX = x;
      this.edgeY = y;
      this.edgeA = a;
      this.edge.style.transform = `translate(${x}px,${y}px) rotate(${a}deg)`;
    }
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
    this.lastCatch = ob.inkCatch;
    this.lastHop = ob.target.hop;
    const c = hintCopy(id, ob);
    this.title.set(c.title);
    this.long.set(c.title.length > LONG_TITLE);
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

  /** Glyph frames and the map pointer's pulse, stepped on twos from the frame clock. */
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
