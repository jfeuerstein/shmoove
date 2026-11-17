/**
 * Chain meter: ×N with one pip per link; in flight, a bar drains with the ground grace used.
 * A lost chain shows the count that was lost for a moment, then clears.
 */
import { FEEL } from '../sim/constants';
import type { Game } from '../sim/game/game';
import type { SimEvent } from '../sim/types';
import { ClassSlot, el } from './dom';
import { FlapRow } from './flap';

const LOST_SHOW = 1.3;
const MAX_PIPS = 8;
/** Bar is redrawn in steps of 1/BAR_STEPS so it is not written every frame for nothing. */
const BAR_STEPS = 40;

export class ChainMeter {
  readonly el: HTMLElement;
  private readonly flap = new FlapRow(4, 'right');
  private readonly pips: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly on: ClassSlot;
  private readonly lostCls: ClassSlot;
  private readonly barOn: ClassSlot;
  private readonly lostFlap: ClassSlot;
  private shown = 0;
  private pipCount = 0;
  private lost = 0;
  private lostTime = 0;
  private barStep = -1;

  constructor(private readonly game: Game) {
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
    for (const e of events) {
      if (e.type === 'chainEnd') {
        this.lost = e.chain;
        this.lostTime = LOST_SHOW;
      } else if (e.type === 'hitch') {
        this.lostTime = 0;
      }
    }
    if (this.lostTime > 0) this.lostTime -= dt;

    let n = p.chain;
    let lost = false;
    if (n === 0 && this.lostTime > 0) {
      n = this.lost;
      lost = true;
    }
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
    if (last && last !== prevLast) last.classList.add('sk-new');
  }
}
