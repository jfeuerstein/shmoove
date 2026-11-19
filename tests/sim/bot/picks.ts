/**
 * How a bot chooses a card. A picker sees the cards on the table and the build, as the player does.
 *
 * The default is what a sensible player does in a survivor: fill the weapon slots with things that
 * hurt, level what is carried, and take the passives that make every weapon better (Might, Haste,
 * Wide Load) or keep you alive (Heart, Regen, Hide) over the ones that only change the ride.
 */
import {
  MAX_LEVEL,
  P_HASTE,
  P_HEART,
  P_HIDE,
  P_LUCK,
  P_MAGNET,
  P_MIGHT,
  P_REGEN,
  P_SPRINGS,
  P_WAX,
  P_WIDE_LOAD,
  P_WINGS,
  PASSIVE_COUNT,
  W_BUMPER,
  W_SLIPSTREAM,
  WEAPON_COUNT,
} from '../../../src/sim/arsenal';
import { BOON_HEAL, BOON_MIGHT, BOON_REACH, BOON_TOKENS, BOON_VIGOUR, CARD_BOON, CARD_PASSIVE, CARD_WEAPON } from '../../../src/sim/offer';
import type { Picker } from '../../../src/sim/sim';
import type { World } from '../../../src/sim/world';

/** What a new weapon is worth to the default picker: the two that do not hurt anything on their own are last. */
const NEW_WEAPON = new Float64Array(WEAPON_COUNT).fill(10);
NEW_WEAPON[W_BUMPER] = 2;
NEW_WEAPON[W_SLIPSTREAM] = 1;

/** What a level of a passive is worth to the default picker. */
const PASSIVE = new Float64Array(PASSIVE_COUNT);
PASSIVE[P_MIGHT] = 8;
PASSIVE[P_HASTE] = 7.5;
PASSIVE[P_HEART] = 7;
PASSIVE[P_REGEN] = 6.5;
PASSIVE[P_WIDE_LOAD] = 6;
PASSIVE[P_HIDE] = 5.5;
PASSIVE[P_MAGNET] = 4;
PASSIVE[P_LUCK] = 2;
PASSIVE[P_WAX] = 1;
PASSIVE[P_SPRINGS] = 1;
PASSIVE[P_WINGS] = 0.5;

/** How much the default picker wants card `k` of the open offer. */
function worth(w: World, k: number): number {
  const o = w.offer;
  const l = w.player.loadout;
  const id = o.id[k];
  const by = o.by[k];
  if (o.type[k] === CARD_WEAPON) {
    const level = l.weaponLevel[id];
    if (level === 0) {
      // A third and fourth weapon are worth less than levelling the two already carried.
      let owned = 0;
      for (let w2 = 0; w2 < WEAPON_COUNT; w2++) if (l.weaponLevel[w2] > 0) owned++;
      return NEW_WEAPON[id] - (owned >= 2 ? 2 : 0) + by;
    }
    // Levelling what hurts is worth more than a new passive; the two that do not hurt, less.
    return (NEW_WEAPON[id] >= 10 ? 8.5 : 1.5) + 0.2 * level + by;
  }
  if (o.type[k] === CARD_PASSIVE) {
    const level = l.passiveLevel[id];
    return PASSIVE[id] - (level >= MAX_LEVEL - 1 ? 0.5 : 0) + by;
  }
  if (o.type[k] === CARD_BOON) {
    const p = w.player;
    if (id === BOON_HEAL) return p.hp < p.maxHp * 0.6 ? 10 : 1;
    if (id === BOON_MIGHT) return 6;
    if (id === BOON_VIGOUR) return 5;
    if (id === BOON_REACH) return 3;
    if (id === BOON_TOKENS) return 0.5;
  }
  return 0;
}

/** The default: the card worth most, the first of equals. */
export const preferDefault: Picker = (w) => {
  let best = 0;
  let bestWorth = -Infinity;
  for (let k = 0; k < w.offer.count; k++) {
    const v = worth(w, k);
    if (v > bestWorth) {
      bestWorth = v;
      best = k;
    }
  }
  return best;
};

/** Takes weapon `id` (new or a level) whenever it is dealt; otherwise the default. */
export function preferWeapon(id: number): Picker {
  return (w) => {
    const o = w.offer;
    for (let k = 0; k < o.count; k++) if (o.type[k] === CARD_WEAPON && o.id[k] === id) return k;
    return preferDefault(w);
  };
}
