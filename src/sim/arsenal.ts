/**
 * What a build is made of: the ten weapons and eleven passives, by id, with what a card says about
 * them. The numbers each weapon uses live with the weapon (`src/sim/weapons/`); what each passive
 * does to the player's stats is the table here.
 */

export const SLOTS = 4;
export const MAX_LEVEL = 5;

// ---- weapons --------------------------------------------------------------------------------

export const W_WAKE = 0;
export const W_SEEKERS = 1;
export const W_BUMPER = 2;
export const W_SLAM = 3;
export const W_ORBIT = 4;
export const W_STATIC = 5;
export const W_SKIPPER = 6;
export const W_SLIPSTREAM = 7;
export const W_CRUMBS = 8;
export const W_LANCE = 9;
export const WEAPON_COUNT = 10;

export interface WeaponInfo {
  /** Two letters for the build icon. */
  code: string;
  name: string;
  /** One line for the card of a weapon you do not have yet. */
  blurb: string;
  /** Small print under the blurb. Empty since weapons stopped being fed by movement; the card hides it. */
  fedBy: string;
}

export const WEAPON_INFO: readonly WeaponInfo[] = [
  { code: 'WK', name: 'Wake', blurb: 'A burning trail behind you. Ride a loop round a crowd and it pops.', fedBy: '' },
  { code: 'SK', name: 'Seekers', blurb: 'Homing darts at whatever is nearest.', fedBy: '' },
  { code: 'BU', name: 'Bumper', blurb: 'When you are hit, everything near you is hurt and thrown back.', fedBy: '' },
  { code: 'SL', name: 'Slam', blurb: 'A shockwave round you, every few seconds.', fedBy: '' },
  { code: 'OR', name: 'Orbit', blurb: 'Discs circling you.', fedBy: '' },
  { code: 'ST', name: 'Static', blurb: 'A bolt that chains from enemy to enemy.', fedBy: '' },
  { code: 'SP', name: 'Skipper', blurb: 'Stones that skip from one enemy to the next.', fedBy: '' },
  { code: 'DR', name: 'Slipstream', blurb: 'Your draft drags sparks and small enemies in behind you.', fedBy: '' },
  { code: 'CR', name: 'Crumbs', blurb: 'Mines dropped behind you.', fedBy: '' },
  { code: 'LA', name: 'Lance', blurb: 'A beam straight ahead.', fedBy: '' },
];

// ---- passives -------------------------------------------------------------------------------

export const P_WAX = 0;
export const P_HASTE = 1;
export const P_SPRINGS = 2;
export const P_WINGS = 3;
export const P_MAGNET = 4;
export const P_HEART = 5;
export const P_REGEN = 6;
export const P_MIGHT = 7;
export const P_HIDE = 8;
export const P_LUCK = 9;
export const P_WIDE_LOAD = 10;
export const PASSIVE_COUNT = 11;

/** The stats a passive can change. See `Stats` in stats.ts for what each means. */
export type StatKey =
  | 'drag'
  | 'haste'
  | 'might'
  | 'hopWindow'
  | 'hopSpeed'
  | 'airTurn'
  | 'hang'
  | 'magnet'
  | 'maxHp'
  | 'regen'
  | 'armour'
  | 'luck'
  | 'area';

export interface PassiveEffect {
  stat: StatKey;
  /** `mul` multiplies the stat by the value, `add` adds it. */
  mode: 'mul' | 'add';
  /** The value at level 1..5. */
  byLevel: readonly [number, number, number, number, number];
}

export interface PassiveInfo {
  code: string;
  name: string;
  blurb: string;
  effects: readonly PassiveEffect[];
}

export const PASSIVE_INFO: readonly PassiveInfo[] = [
  {
    code: 'WX',
    name: 'Wax',
    blurb: 'Less drag. You roll further and faster.',
    effects: [{ stat: 'drag', mode: 'mul', byLevel: [0.88, 0.78, 0.69, 0.61, 0.54] }],
  },
  {
    code: 'HS',
    name: 'Haste',
    blurb: 'Everything you carry fires faster.',
    effects: [{ stat: 'haste', mode: 'mul', byLevel: [0.95, 0.9, 0.85, 0.8, 0.74] }],
  },
  {
    code: 'SG',
    name: 'Springs',
    blurb: 'Higher hops and more time to hop clean.',
    effects: [
      { stat: 'hopWindow', mode: 'add', byLevel: [1, 2, 3, 4, 5] },
      { stat: 'hopSpeed', mode: 'mul', byLevel: [1.06, 1.12, 1.18, 1.24, 1.3] },
    ],
  },
  {
    code: 'WG',
    name: 'Wings',
    blurb: 'More steer and more hang in the air.',
    effects: [
      { stat: 'airTurn', mode: 'mul', byLevel: [1.3, 1.6, 1.9, 2.2, 2.5] },
      { stat: 'hang', mode: 'mul', byLevel: [0.94, 0.88, 0.83, 0.78, 0.74] },
    ],
  },
  {
    code: 'MG',
    name: 'Magnet',
    blurb: 'Sparks fly to you from further away.',
    effects: [{ stat: 'magnet', mode: 'add', byLevel: [1.5, 3, 4.5, 6, 8] }],
  },
  {
    code: 'HT',
    name: 'Heart',
    blurb: 'More health.',
    effects: [{ stat: 'maxHp', mode: 'add', byLevel: [10, 20, 30, 40, 50] }],
  },
  {
    code: 'RG',
    name: 'Regen',
    blurb: 'Health comes back slowly, all the time.',
    effects: [{ stat: 'regen', mode: 'add', byLevel: [0.1, 0.2, 0.3, 0.4, 0.5] }],
  },
  {
    code: 'MT',
    name: 'Might',
    blurb: 'Everything you carry hits harder.',
    effects: [{ stat: 'might', mode: 'mul', byLevel: [1.06, 1.12, 1.18, 1.24, 1.3] }],
  },
  {
    code: 'HD',
    name: 'Hide',
    blurb: 'Every hit hurts a little less.',
    effects: [{ stat: 'armour', mode: 'add', byLevel: [0.5, 1, 1.5, 2, 2.5] }],
  },
  {
    code: 'LK',
    name: 'Luck',
    blurb: 'Better cards and better crates.',
    effects: [{ stat: 'luck', mode: 'add', byLevel: [0.1, 0.2, 0.3, 0.4, 0.5] }],
  },
  {
    code: 'WL',
    name: 'Wide Load',
    blurb: 'Everything you do covers more ground.',
    effects: [{ stat: 'area', mode: 'mul', byLevel: [1.08, 1.16, 1.24, 1.33, 1.42] }],
  },
];

// ---- the build ------------------------------------------------------------------------------

/**
 * What the player carries. Levels are looked up by id (`weaponLevel[W_WAKE]`, 0 = not owned); the
 * slot arrays only record the order things were taken in and enforce the limit of four of each.
 */
export interface Loadout {
  /** Weapon ids in the order taken; -1 for an empty slot. */
  weapons: Int8Array;
  weaponLevel: Uint8Array;
  passives: Int8Array;
  passiveLevel: Uint8Array;
}

export function makeLoadout(): Loadout {
  return {
    weapons: new Int8Array(SLOTS).fill(-1),
    weaponLevel: new Uint8Array(WEAPON_COUNT),
    passives: new Int8Array(SLOTS).fill(-1),
    passiveLevel: new Uint8Array(PASSIVE_COUNT),
  };
}

export function clearLoadout(l: Loadout): void {
  l.weapons.fill(-1);
  l.weaponLevel.fill(0);
  l.passives.fill(-1);
  l.passiveLevel.fill(0);
}

function freeSlot(slots: Int8Array): number {
  for (let i = 0; i < slots.length; i++) if (slots[i] < 0) return i;
  return -1;
}

/** Can this weapon go up a level (or be taken, if there is a free slot)? */
export function canRaiseWeapon(l: Loadout, id: number): boolean {
  const level = l.weaponLevel[id];
  if (level >= MAX_LEVEL) return false;
  return level > 0 || freeSlot(l.weapons) >= 0;
}

export function canRaisePassive(l: Loadout, id: number): boolean {
  const level = l.passiveLevel[id];
  if (level >= MAX_LEVEL) return false;
  return level > 0 || freeSlot(l.passives) >= 0;
}

/** Raise a weapon by `by` levels, taking a slot if it is new. Returns false if it could not. */
export function raiseWeapon(l: Loadout, id: number, by = 1): boolean {
  if (!canRaiseWeapon(l, id)) return false;
  if (l.weaponLevel[id] === 0) l.weapons[freeSlot(l.weapons)] = id;
  l.weaponLevel[id] = Math.min(MAX_LEVEL, l.weaponLevel[id] + by);
  return true;
}

export function raisePassive(l: Loadout, id: number, by = 1): boolean {
  if (!canRaisePassive(l, id)) return false;
  if (l.passiveLevel[id] === 0) l.passives[freeSlot(l.passives)] = id;
  l.passiveLevel[id] = Math.min(MAX_LEVEL, l.passiveLevel[id] + by);
  return true;
}
