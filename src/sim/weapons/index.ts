/**
 * The weapons, by id. A weapon is a step function run once a tick for as long as the player
 * carries it, after contact and before the dead are reaped: indices are stable and the grid is
 * fresh. A weapon with no step works through the player's stats instead (the Bumper).
 *
 * Every weapon but the Wake fires on its own clock (`./timer`): how the mover moves (its speed,
 * gear, hops, landings, tuck) never changes when, how hard or how far a weapon hits.
 *
 * A weapon that is not in this table yet is never offered.
 */
import {
  W_BUMPER,
  W_CRUMBS,
  W_LANCE,
  W_ORBIT,
  W_SEEKERS,
  W_SKIPPER,
  W_SLAM,
  W_SLIPSTREAM,
  W_STATIC,
  W_WAKE,
  WEAPON_COUNT,
} from '../arsenal';
import { stepSeekers } from '../seekers';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { stepWake } from '../wake';
import { SRC_OTHER, type World } from '../world';
import { stepCrumbs } from './crumbs';
import { stepLance } from './lance';
import { stepOrbit } from './orbit';
import { stepSkipper } from './skipper';
import { stepSlam } from './slam';
import { stepSlipstream } from './slipstream';
import { stepStatic } from './static';

export interface Weapon {
  id: number;
  /** One tick of the weapon at `level` (1..5). */
  step?(w: World, s: SimState, terrain: Terrain, level: number): void;
}

export const WEAPONS: (Weapon | null)[] = new Array<Weapon | null>(WEAPON_COUNT).fill(null);

export function registerWeapon(weapon: Weapon): void {
  WEAPONS[weapon.id] = weapon;
}

registerWeapon({ id: W_WAKE, step: (w, s) => stepWake(w, s) });
registerWeapon({ id: W_SEEKERS, step: stepSeekers });
registerWeapon({ id: W_BUMPER });
registerWeapon({ id: W_SLAM, step: stepSlam });
registerWeapon({ id: W_ORBIT, step: stepOrbit });
registerWeapon({ id: W_STATIC, step: stepStatic });
registerWeapon({ id: W_SKIPPER, step: stepSkipper });
registerWeapon({ id: W_SLIPSTREAM, step: stepSlipstream });
registerWeapon({ id: W_CRUMBS, step: stepCrumbs });
registerWeapon({ id: W_LANCE, step: stepLance });

/** Mark in `pool` the weapons that exist. */
export function builtWeapons(pool: Uint8Array): void {
  for (let id = 0; id < WEAPON_COUNT; id++) pool[id] = WEAPONS[id] ? 1 : 0;
}

/** Run every weapon the player carries. */
export function stepWeapons(w: World, s: SimState, terrain: Terrain): void {
  const levels = w.player.loadout.weaponLevel;
  for (let id = 0; id < WEAPON_COUNT; id++) {
    const level = levels[id];
    if (level === 0) continue;
    const weapon = WEAPONS[id];
    if (weapon && weapon.step) {
      w.source = id;
      weapon.step(w, s, terrain, level);
    }
  }
  w.source = SRC_OTHER;
}
