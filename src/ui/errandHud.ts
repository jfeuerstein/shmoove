/**
 * Errands in play: the offer ticket that slides up at the bottom while the skater stands in a
 * giver's zone (title, brief, time limit, a punch circle filling as the skater stops for it, PULL
 * DOWN TO TAKE), and the active errand's stub under the destination board (title, the current step as a
 * short imperative, a progress figure where there is one, the time left, pink under 20 s).
 * Results (stamped DELIVERED or torn) come out as ticket toasts.
 */
import type { Game } from '../sim/game/game';
import type { ErrandDef } from '../sim/game/errands';
import { DISTRICT_NAMES } from '../sim/world';
import { ClassSlot, TextSlot, el } from './dom';
import { hoursText, progressText, stepText, ticksClock } from './errandFormat';
import { boardText } from './format';
import type { Twos } from './twos';

/** Under this many seconds the clock on the stub turns pink. */
const HURRY_S = 20;
/** The punch fills in twelve steps, like everything else on twos. */
const FILL_STEPS = 12;

export class ErrandHud {
  /** The offer ticket (bottom) and the active stub (top), mounted separately. */
  readonly offerEl: HTMLElement;
  readonly stubEl: HTMLElement;
  private readonly offerOn: ClassSlot;
  private readonly stubOn: ClassSlot;
  private readonly oTitle: TextSlot;
  private readonly oBrief: TextSlot;
  private readonly oLimit: TextSlot;
  private readonly oSerial: TextSlot;
  private readonly oHours: TextSlot;
  private readonly oHoursRow: HTMLElement;
  private readonly oHold: HTMLElement;
  private readonly oPunch: HTMLElement;
  private readonly sTitle: TextSlot;
  private readonly sStep: TextSlot;
  private readonly sProg: TextSlot;
  private readonly sLeft: TextSlot;
  private readonly sCount: TextSlot;
  private readonly sHurry: ClassSlot;
  private offerId = '';
  private stubKey = '';
  private fillStep = -1;
  private readonly defs = new Map<string, ErrandDef>();

  constructor(
    private readonly game: Game,
    private readonly twos: Twos,
  ) {
    for (const d of game.errands.list) this.defs.set(d.id, d);

    this.offerEl = el('div', 'sk-offer');
    const t = el('div', 'sk-ticket sk-big sk-oticket');
    const head = el('div', 'sk-thead');
    const serial = el('span', 'sk-serial');
    head.append(el('span', 'sk-op', 'ERRAND'), serial);
    this.oSerial = new TextSlot(serial);
    const title = el('div', 'sk-otitle');
    this.oTitle = new TextSlot(title);
    const brief = el('div', 'sk-obrief');
    this.oBrief = new TextSlot(brief);
    const facts = el('div', 'sk-cfacts sk-ofacts');
    const limit = el('b');
    this.oLimit = new TextSlot(limit);
    const hours = el('b');
    this.oHours = new TextSlot(hours);
    this.oHoursRow = el('span', 'sk-ohours');
    this.oHoursRow.append(el('span', 'sk-cfact', 'Hours'), hours);
    facts.append(el('span', 'sk-cfact', 'Limit'), limit, this.oHoursRow);
    this.oHold = el('div', 'sk-ohold', 'PULL DOWN TO TAKE');
    this.oPunch = el('span', 'sk-opunch');
    this.oPunch.dataset.sk = 'errandPunch';
    t.append(head, title, brief, facts, this.oHold, this.oPunch);
    this.offerEl.appendChild(t);
    this.offerOn = new ClassSlot(this.offerEl, 'sk-on');

    this.stubEl = el('div', 'sk-ticket sk-estub');
    const sh = el('div', 'sk-thead');
    const sTitle = el('span', 'sk-op');
    const sLeft = el('span', 'sk-eleft');
    sh.append(sTitle, sLeft);
    this.sTitle = new TextSlot(sTitle);
    this.sLeft = new TextSlot(sLeft);
    this.sHurry = new ClassSlot(sLeft, 'sk-hurry');
    const row = el('div', 'sk-erow');
    const count = el('span', 'sk-ecount');
    const step = el('span', 'sk-estep');
    const prog = el('span', 'sk-eprog');
    row.append(count, step, prog);
    this.sCount = new TextSlot(count);
    this.sStep = new TextSlot(step);
    this.sProg = new TextSlot(prog);
    this.stubEl.append(sh, row);
    this.stubOn = new ClassSlot(this.stubEl, 'sk-on');
  }

  /** The offer is on screen. */
  get offering(): boolean {
    return this.offerId !== '';
  }

  /** The active stub is on screen. */
  get active(): boolean {
    return this.stubKey !== '';
  }

  /** `hints`: show the PULL DOWN TO TAKE line. */
  update(hints: boolean): void {
    const st = this.game.errands;
    const w = this.game.sim.world;

    // Offer.
    const oid = st.offered ?? '';
    if (oid !== this.offerId) {
      this.offerId = oid;
      const def = this.defs.get(oid);
      this.offerOn.set(def !== undefined);
      if (def) {
        this.oTitle.set(boardText(def.title));
        this.oBrief.set(boardText(def.brief));
        this.oLimit.set(ticksClock(def.limitTicks));
        this.oSerial.set(boardText(DISTRICT_NAMES[def.district]));
        const h = hoursText(def);
        this.oHours.set(h);
        this.oHoursRow.style.display = h ? '' : 'none';
        this.fillStep = -1;
        this.twos.play(this.offerEl, 'sk-up1', 'sk-up2');
      } else this.twos.cancel(this.offerEl);
    }
    if (this.offerId) {
      const k = Math.floor(st.offerFill * FILL_STEPS + 1e-6);
      if (k !== this.fillStep) {
        this.fillStep = k;
        this.oPunch.style.setProperty('--sk-fill', `${Math.round((k / FILL_STEPS) * 360)}deg`);
        this.oPunch.classList.toggle('sk-full', k >= FILL_STEPS);
      }
      this.oHold.style.display = hints ? '' : 'none';
    }

    // Active stub.
    const a = st.active;
    const def = a ? this.defs.get(a.id) : undefined;
    const key = a && def ? `${a.id}:${a.step}` : '';
    if (key !== this.stubKey) {
      const was = this.stubKey !== '';
      this.stubKey = key;
      this.stubOn.set(key !== '');
      if (a && def) {
        this.sTitle.set(boardText(def.title));
        this.sStep.set(stepText(w, def.steps[a.step]));
        this.sCount.set(`${a.step + 1}/${def.steps.length}`);
        if (!was) this.twos.play(this.stubEl, 'sk-in1', 'sk-in2');
        else this.twos.play(this.stubEl, 'sk-pop1', 'sk-pop2');
      }
    }
    if (a && def) {
      this.sLeft.set(ticksClock(a.ticksLeft));
      this.sHurry.set(a.ticksLeft < HURRY_S * 60);
      this.sProg.set(progressText(def.steps[a.step], a.progress));
    }
  }
}
