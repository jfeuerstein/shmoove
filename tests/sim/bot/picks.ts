/** How a bot chooses a card. */
import type { Picker } from '../../../src/sim/sim';
import { W_WAKE } from '../../../src/sim/arsenal';
import { CARD_PASSIVE, CARD_WEAPON } from '../../../src/sim/offer';

/** Weapons first (a new one or a level, whichever is dealt first), then passives, then whatever is left. */
export const preferWeapons: Picker = (w) => {
  const o = w.offer;
  for (let k = 0; k < o.count; k++) if (o.type[k] === CARD_WEAPON) return k;
  for (let k = 0; k < o.count; k++) if (o.type[k] === CARD_PASSIVE) return k;
  return 0;
};

/** A player building round the loop: the Wake whenever it is dealt, otherwise as above. */
export const preferWake: Picker = (w) => {
  const o = w.offer;
  for (let k = 0; k < o.count; k++) if (o.type[k] === CARD_WEAPON && o.id[k] === W_WAKE) return k;
  return preferWeapons(w);
};
