/**
 * The card offer: when a level up, crate, shrine or totem hands the player a choice, up to three
 * cards stack in the lower half of the screen over the dimmed game, each a big target for one thumb.
 * The world holds still behind them (the sim does that by itself) until one is tapped.
 *
 * `describeOffer` is the pure "what do the cards say" (from the offer and the loadout, by id out of
 * `WEAPON_INFO`, `PASSIVE_INFO` and `BOON_INFO`, so any weapon the sim knows has a card);
 * `autoPickCard` is the policy auto-pick answers with; `Cards` is the DOM around them. The overlay is
 * a DOM sibling of the canvas, so touches on it never reach the game; they are also stopped here.
 *
 * Each card is its icon (large, on the left), the name, the line of what it does and level pips.
 * A weapon, a passive and a boon wear their own frame colour; a thing not yet carried has its icon
 * on a solid tile and a NEW tag, a level on something carried has its icon on a dark tile.
 */
import { PALETTE } from '../render/look';
import { MAX_LEVEL, PASSIVE_INFO, WEAPON_INFO, type Loadout } from '../sim/arsenal';
import {
  BOON_INFO,
  CARD_PASSIVE,
  CARD_WEAPON,
  OFFER_BOSS,
  OFFER_CRATE,
  OFFER_LEVEL,
  OFFER_SHRINE,
  OFFER_SIZE,
  OFFER_TOTEM,
  type Offer,
} from '../sim/offer';
import { PHASE_CHOOSE, type World } from '../sim/world';
import { cssHex, iconSvg } from './icons';
import './cards.css';

/** Seconds after a tap during which further taps are ignored, so a double tap cannot answer the next offer unseen. */
export const PICK_LOCK_SEC = 0.35;

export type CardKind = 'weapon' | 'passive' | 'boon';

export interface CardText {
  kind: CardKind;
  /** The icon's SVG markup (see icons.ts), tinted by the card. */
  icon: string;
  /** Not carried yet: a new weapon or passive. Never true for a boon. */
  isNew: boolean;
  name: string;
  /** `NEW`, `NEW  Lv 2`, `Lv 2 > 3` or `BOON`. */
  tag: string;
  blurb: string;
  /** What feeds the weapon; empty for everything else. */
  fedBy: string;
  /** A rare card gives two levels at once. */
  rare: boolean;
  /** `+2` for a rare card, else empty. */
  bonus: string;
  /** The level carried now (0 when new or a boon) and after taking the card (0 for a boon). */
  from: number;
  to: number;
}

export interface OfferText {
  header: string;
  cards: CardText[];
}

/** Where the offer came from, as the header words it. */
export function sourceHeader(source: number): string {
  if (source === OFFER_LEVEL) return 'LEVEL UP';
  if (source === OFFER_CRATE) return 'CRATE';
  if (source === OFFER_SHRINE) return 'SHRINE';
  if (source === OFFER_TOTEM) return 'TOTEM';
  if (source === OFFER_BOSS) return 'BOSS DOWN';
  return 'CHOOSE';
}

function levelTag(current: number, by: number): string {
  if (current === 0) return by > 1 ? `NEW  Lv ${by}` : 'NEW';
  return `Lv ${current} > ${Math.min(MAX_LEVEL, current + by)}`;
}

/** The text of card `index` of the offer, given what the player carries. Pure. */
export function describeCard(o: Offer, index: number, l: Loadout): CardText {
  const type = o.type[index];
  const id = o.id[index];
  const by = o.by[index];
  if (type === CARD_WEAPON) {
    const info = WEAPON_INFO[id];
    const rare = by > 1;
    const from = l.weaponLevel[id];
    return {
      kind: 'weapon',
      icon: iconSvg('weapon', id),
      isNew: from === 0,
      name: info.name,
      tag: levelTag(from, by),
      blurb: info.blurb,
      fedBy: info.fedBy,
      rare,
      bonus: rare ? `+${by}` : '',
      from,
      to: Math.min(MAX_LEVEL, from + by),
    };
  }
  if (type === CARD_PASSIVE) {
    const info = PASSIVE_INFO[id];
    const rare = by > 1;
    const from = l.passiveLevel[id];
    return {
      kind: 'passive',
      icon: iconSvg('passive', id),
      isNew: from === 0,
      name: info.name,
      tag: levelTag(from, by),
      blurb: info.blurb,
      fedBy: '',
      rare,
      bonus: rare ? `+${by}` : '',
      from,
      to: Math.min(MAX_LEVEL, from + by),
    };
  }
  const boon = BOON_INFO[id];
  return {
    kind: 'boon',
    icon: iconSvg('boon', id),
    isNew: false,
    name: boon.name,
    tag: 'BOON',
    blurb: boon.blurb,
    fedBy: '',
    rare: false,
    bonus: '',
    from: 0,
    to: 0,
  };
}

/** Everything the cards say for an open offer. Pure. */
export function describeOffer(o: Offer, l: Loadout): OfferText {
  const cards: CardText[] = [];
  for (let i = 0; i < o.count; i++) cards.push(describeCard(o, i, l));
  return { header: sourceHeader(o.source), cards };
}

/**
 * What auto-pick takes: a new weapon if one is offered, else the first weapon card, else the first
 * card. Always a valid index for an open offer.
 */
export function autoPickCard(w: World): number {
  const o = w.offer;
  const l = w.player.loadout;
  let firstWeapon = -1;
  for (let i = 0; i < o.count; i++) {
    if (o.type[i] !== CARD_WEAPON) continue;
    if (l.weaponLevel[o.id[i]] === 0) return i;
    if (firstWeapon < 0) firstWeapon = i;
  }
  return firstWeapon >= 0 ? firstWeapon : 0;
}

/** A number that changes when the offer on the table does (0 when none is open). */
function offerKey(o: Offer): number {
  if (!o.open) return 0;
  let k = 1 + o.source * 7 + o.count;
  for (let i = 0; i < o.count; i++) k = (Math.imul(k, 31) + o.type[i] * 97 + o.id[i] * 13 + o.by[i]) | 0;
  return k === 0 ? 1 : k;
}

interface CardEls {
  button: HTMLElement;
  tile: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  bonus: HTMLElement;
  blurb: HTMLElement;
  fed: HTMLElement;
  pipRow: HTMLElement;
  pips: HTMLElement[];
}

/** The class of level pip `p` (0-based) on a card that raises a level from `from` to `to`. */
export function pipClass(p: number, from: number, to: number): string {
  if (p < from) return 'card-pip on';
  if (p < to) return 'card-pip gain';
  return 'card-pip';
}

export class Cards {
  readonly element: HTMLElement;
  private readonly head: HTMLElement;
  private readonly els: CardEls[] = [];
  private shown = false;
  private key = 0;
  private lock = 0;

  /** `doc` is a seam so tests can build the overlay over a fake element tree. */
  constructor(root: HTMLElement, private readonly onPick: (index: number) => void, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'cards';
    el.setAttribute('aria-live', 'polite');
    el.style.setProperty('--card-weapon', cssHex(PALETTE.accent));
    el.style.setProperty('--card-passive', cssHex(PALETTE.pad));
    el.style.setProperty('--card-boon', cssHex(PALETTE.mover));
    el.style.setProperty('--card-rare', cssHex(PALETTE.elite));
    const stack = doc.createElement('div');
    stack.className = 'cards-stack';
    this.head = doc.createElement('div');
    this.head.className = 'cards-head';
    stack.appendChild(this.head);
    for (let i = 0; i < OFFER_SIZE; i++) {
      const button = doc.createElement('button');
      button.className = 'card';
      button.setAttribute('type', 'button');
      const tile = part(doc, button, 'card-tile');
      const body = part(doc, button, 'card-body');
      const top = part(doc, body, 'card-top');
      const name = part(doc, top, 'card-name');
      const tag = part(doc, top, 'card-tag');
      const bonus = part(doc, top, 'card-bonus');
      const blurb = part(doc, body, 'card-blurb');
      const fed = part(doc, body, 'card-fed');
      const pipRow = part(doc, body, 'card-pips');
      const pips: HTMLElement[] = [];
      for (let p = 0; p < MAX_LEVEL; p++) pips.push(part(doc, pipRow, 'card-pip'));
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.tap(i);
      });
      stack.appendChild(button);
      this.els.push({ button, tile, name, tag, bonus, blurb, fed, pipRow, pips });
    }
    el.appendChild(stack);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
    root.appendChild(el);
    this.element = el;
  }

  /** Once per frame, with the real seconds since the last one. Writes only when the offer changes. */
  update(w: World, dt: number): void {
    if (this.lock > 0) this.lock = Math.max(0, this.lock - dt);
    const o = w.offer;
    const open = w.run.phase === PHASE_CHOOSE && o.open;
    const key = open ? offerKey(o) : 0;
    if (key === this.key) return;
    this.key = key;
    this.lock = 0;
    if (!open) {
      this.shown = false;
      this.element.className = 'cards';
      return;
    }
    this.fill(describeOffer(o, w.player.loadout));
    if (!this.shown) {
      this.shown = true;
      this.element.className = 'cards cards-show';
    }
  }

  /** Is the overlay up? */
  get visible(): boolean {
    return this.shown;
  }

  private tap(index: number): void {
    if (!this.shown || this.lock > 0) return;
    this.lock = PICK_LOCK_SEC;
    this.onPick(index);
  }

  private fill(t: OfferText): void {
    this.head.textContent = t.header;
    for (let i = 0; i < this.els.length; i++) {
      const e = this.els[i];
      const c = t.cards[i];
      e.button.hidden = c === undefined;
      if (c === undefined) continue;
      e.button.className = `card card-${c.kind}${c.isNew ? ' card-new' : ''}${c.rare ? ' card-rare' : ''}`;
      e.tile.innerHTML = c.icon;
      e.name.textContent = c.name;
      e.tag.textContent = c.tag;
      e.bonus.textContent = c.bonus;
      e.bonus.hidden = c.bonus === '';
      e.blurb.textContent = c.blurb;
      e.fed.textContent = c.fedBy === '' ? '' : `fed by ${c.fedBy}`;
      e.fed.hidden = c.fedBy === '';
      // A boon is not part of the build: no levels to show.
      e.pipRow.hidden = c.kind === 'boon';
      for (let p = 0; p < e.pips.length; p++) e.pips[p].className = pipClass(p, c.from, c.to);
    }
  }
}

function part(doc: Document, parent: HTMLElement, cls: string): HTMLElement {
  const e = doc.createElement('div');
  e.className = cls;
  parent.appendChild(e);
  return e;
}
