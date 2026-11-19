/**
 * Cards. When the player levels up (or opens a crate) they are offered up to three: a new weapon,
 * a level on something they carry, or, when the build is nearly full, a boon. This module decides
 * what is on offer and applies the one taken. It knows nothing about the screen.
 */
import {
  canRaisePassive,
  canRaiseWeapon,
  MAX_LEVEL,
  PASSIVE_COUNT,
  raisePassive,
  raiseWeapon,
  WEAPON_COUNT,
  type Loadout,
} from './arsenal';
import type { Rng } from './rng';

export const CARD_WEAPON = 0;
export const CARD_PASSIVE = 1;
export const CARD_BOON = 2;

/** Boons: what a card can be when it is not part of the build. */
export const BOON_HEAL = 0;
export const BOON_TOKENS = 1;
export const BOON_COUNT = 2;
/** Share of maximum health a heal card gives back. */
export const BOON_HEAL_SHARE = 0.3;
export const BOON_TOKEN_COUNT = 3;

export const OFFER_SIZE = 3;

/** Where an offer came from; the screen words it differently. */
export const OFFER_LEVEL = 0;
export const OFFER_CRATE = 1;
export const OFFER_TOTEM = 2;

export interface Offer {
  open: boolean;
  /** Cards on offer, 1..3. */
  count: number;
  type: Uint8Array;
  id: Uint8Array;
  /** Levels the card gives: 1, or 2 for a rare one. Always 1 for a boon. */
  by: Uint8Array;
  source: number;
}

export function makeOffer(): Offer {
  return {
    open: false,
    count: 0,
    type: new Uint8Array(OFFER_SIZE),
    id: new Uint8Array(OFFER_SIZE),
    by: new Uint8Array(OFFER_SIZE),
    source: OFFER_LEVEL,
  };
}

/** How the roll is weighted. */
export const OFFER = {
  newWeapon: 1.2,
  newPassive: 1,
  raiseWeapon: 1,
  raisePassive: 0.8,
  /** Chance a card is rare (two levels at once), before luck. */
  rare: 0.06,
  /** Added to that chance per point of luck. */
  rarePerLuck: 0.5,
  /** While the player carries fewer weapons than this, one card is always a new weapon. */
  weaponsBeforeChoice: 2,
} as const;

const CANDIDATES = WEAPON_COUNT + PASSIVE_COUNT;
const candType = new Uint8Array(CANDIDATES);
const candId = new Uint8Array(CANDIDATES);
const candWeight = new Float64Array(CANDIDATES);
const candNew = new Uint8Array(CANDIDATES);

function levelOf(l: Loadout, type: number, id: number): number {
  return type === CARD_WEAPON ? l.weaponLevel[id] : l.passiveLevel[id];
}

/**
 * Fill `o` with up to three different cards and open it.
 *
 * `pool[id] === 1` marks the weapons that can be offered at all (built, and unlocked). `luck` is
 * the player's luck stat. `rareOnly` makes every build card a rare one (a totem's reward).
 */
export function rollOffer(
  o: Offer,
  l: Loadout,
  pool: Uint8Array,
  luck: number,
  rng: Rng,
  source: number,
  rareOnly = false,
): void {
  let n = 0;
  let owned = 0;
  for (let id = 0; id < WEAPON_COUNT; id++) {
    if (l.weaponLevel[id] > 0) owned++;
    if (pool[id] !== 1 || !canRaiseWeapon(l, id)) continue;
    const isNew = l.weaponLevel[id] === 0;
    candType[n] = CARD_WEAPON;
    candId[n] = id;
    candNew[n] = isNew ? 1 : 0;
    candWeight[n] = isNew ? OFFER.newWeapon : OFFER.raiseWeapon;
    n++;
  }
  for (let id = 0; id < PASSIVE_COUNT; id++) {
    if (!canRaisePassive(l, id)) continue;
    const isNew = l.passiveLevel[id] === 0;
    candType[n] = CARD_PASSIVE;
    candId[n] = id;
    candNew[n] = isNew ? 1 : 0;
    candWeight[n] = isNew ? OFFER.newPassive : OFFER.raisePassive;
    n++;
  }

  o.count = 0;
  o.source = source;
  const rareChance = OFFER.rare + OFFER.rarePerLuck * luck;

  // A player with one weapon is always shown another.
  let forceNewWeapon = owned < OFFER.weaponsBeforeChoice;

  while (o.count < OFFER_SIZE && n > 0) {
    let total = 0;
    for (let c = 0; c < n; c++) {
      if (forceNewWeapon && !(candType[c] === CARD_WEAPON && candNew[c] === 1)) continue;
      total += candWeight[c];
    }
    if (total <= 0) {
      // Nothing fits the forced slot: roll freely instead.
      forceNewWeapon = false;
      continue;
    }
    let r = rng.next() * total;
    let pick = -1;
    for (let c = 0; c < n; c++) {
      if (forceNewWeapon && !(candType[c] === CARD_WEAPON && candNew[c] === 1)) continue;
      pick = c;
      r -= candWeight[c];
      if (r < 0) break;
    }
    forceNewWeapon = false;

    const k = o.count++;
    o.type[k] = candType[pick];
    o.id[k] = candId[pick];
    const room = MAX_LEVEL - levelOf(l, candType[pick], candId[pick]);
    o.by[k] = room >= 2 && (rareOnly || rng.next() < rareChance) ? 2 : 1;

    // Without replacement.
    n--;
    candType[pick] = candType[n];
    candId[pick] = candId[n];
    candWeight[pick] = candWeight[n];
    candNew[pick] = candNew[n];
  }

  // A full build is offered boons instead.
  for (let b = 0; o.count < OFFER_SIZE && b < BOON_COUNT; b++) {
    const k = o.count++;
    o.type[k] = CARD_BOON;
    o.id[k] = b;
    o.by[k] = 1;
  }
  o.open = true;
}

/**
 * Take card `index` and close the offer. A build card is applied to the loadout here; for a boon
 * the caller does what it says. Returns the card's type, or -1 if there was no such card.
 */
export function takeCard(o: Offer, index: number, l: Loadout): number {
  if (!o.open || index < 0 || index >= o.count) return -1;
  const type = o.type[index];
  if (type === CARD_WEAPON) raiseWeapon(l, o.id[index], o.by[index]);
  else if (type === CARD_PASSIVE) raisePassive(l, o.id[index], o.by[index]);
  o.open = false;
  return type;
}
