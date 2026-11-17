/**
 * Chain meter: ×N with one pip per link; in flight, a bar drains with the ground grace used.
 * A lost chain shows the count that was lost for a moment, then clears. A single ride (one link)
 * is not a chain, so when it ends nothing is shown as lost.
 */
import { FEEL } from '../sim/constants';
import type { Game } from '../sim/game/game';
import type { SimEvent } from '../sim/types';
import { ClassSlot, el } from './dom';
import { FlapRow } from './flap';
import type { Twos } from './twos';

const LOST_SHOW = 1.3;
/** The fewest links that make a chain worth showing as lost when it ends. */
const MIN_LOST = 2;
const MAX_PIPS = 8;
/** Bar is redrawn in steps of 1/BAR_STEPS so it is not written every frame for nothing. */
const BAR_STEPS = 40;

/** What the meter shows this frame: a count and whether it is the count of a chain just lost. */
export interface ChainShown {
  n: number;
  lost: boolean;
}

/**
 * The meter's decision, apart from the DOM: which number to show and whether it is a lost chain.
 * `chain` is the live chain on the player; `events` are this frame's sim events.
 */
export class ChainDisplay {
  private lost = 0;
  private lostTime = 0;
  private readonly out: ChainShown = { n: 0, lost: false };

  update(events: readonly SimEvent[], chain: number, dt: number): ChainShown {
    for (const e of events) {
      if (e.type === 'chainEnd') {
        this.lost = e.chain;
        this.lostTime = e.chain >= MIN_LOST ? LOST_SHOW : 0;
      } else if (e.type === 'hitch') {
        this.lostTime = 0;
      }
    }
    if (this.lostTime > 0) this.lostTime -= dt;
    const out = this.out;
    out.n = chain;
    out.lost = false;
    if (chain === 0 && this.lostTime > 0) {
      out.n = this.lost;
      out.lost = true;
    }
    return out;
  }
}

export class ChainMeter {
  readonly el: HTMLElement;
  private readonly flap: FlapRow;
  private readonly pips: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly on: ClassSlot;
  private readonly lostCls: ClassSlot;
  private readonly barOn: ClassSlot;
  private readonly lostFlap: ClassSlot;
  private readonly display = new ChainDisplay();
  private shown = 0;
  private pipCount = 0;
  private barStep = -1;

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
  ) {
    this.flap = new FlapRow(twos, 3, 'right');
    this.el = el('div', 'sk-chain sk-panel');
    this.pips = el('div', 'sk-pips');
    this.bar = el('div', 'sk-bar');
    this.fill = el('i');
    this.bar.appendChild(this.fill);
    this.el.append(this.flap.el, this.pips, this.bar);
    this.on = new ClassSlot(this.el, 'sk-on');
    this.lostCls = new ClassSlot(this.el, 'sk-lost');
    this.barOn = new ClassSlot(this.bar, 'sk-on');
    this.lostFlap = new ClassSlot(this.flap.el, 'sk-pinkflap');
  }

  /** Number currently displayed (0 when hidden). */
  get count(): number {
    return this.shown;
  }

  update(events: readonly SimEvent[], dt: number): void {
    const p = this.game.sim.player;
    const { n, lost } = this.display.update(events, p.chain, dt);
    this.on.set(n > 0);
    this.lostCls.set(lost);
    this.lostFlap.set(lost);
    if (n !== this.shown) {
      this.shown = n;
      if (n > 0) this.flap.set('×' + n);
      this.setPips(n);
    }
    // Ground grace left while a released chain is still alive.
    const alive = !lost && p.chainAlive === 1 && FEEL.CHAIN_GROUND_GRACE > 0;
    this.barOn.set(alive);
    if (alive) {
      const left = Math.max(0, 1 - p.chainGround / FEEL.CHAIN_GROUND_GRACE);
      const step = Math.round(left * BAR_STEPS);
      if (step !== this.barStep) {
        this.barStep = step;
        this.fill.style.transform = `scaleX(${step / BAR_STEPS})`;
      }
    }
  }

  private setPips(n: number): void {
    const want = Math.min(n, MAX_PIPS);
    while (this.pipCount > want) {
      this.pips.lastChild?.remove();
      this.pipCount--;
    }
    const prevLast = this.pips.lastElementChild;
    while (this.pipCount < want) {
      this.pips.appendChild(el('span', 'sk-pip'));
      this.pipCount++;
    }
    const last = this.pips.lastElementChild;
    if (last instanceof HTMLElement && last !== prevLast) this.twos.play(last, 'sk-f1', 'sk-f2');
  }
}
