/**
 * The numbers of the fight: health, damage, growth. How things feel under the thumb is in
 * `constants.ts` (`FEEL`); how strong they are is here.
 */

/** Weapon power in each gear, 1..5. Standing still is a bad build. */
export const GEAR_POWER: readonly number[] = [0.6, 1, 1.3, 1.7, 2.2];

export function gearPower(gear: number): number {
  return GEAR_POWER[gear < 1 ? 0 : gear > 5 ? 4 : gear - 1];
}

/** The lowest gear that plows an enemy of each weight (light, medium, heavy) instead of being hurt. */
export const PLOW_GEAR: readonly number[] = [3, 4, 5];

/** Radius of the mover for contact, m. */
export const PLAYER_RADIUS = 0.5;

/** Ram damage per m/s of speed, before gear power. A shuffler has 10 health. */
export const RAM_DAMAGE_PER_SPEED = 0.7;

/** Sparks fly to the player from this far, by gear. */
export const MAGNET_BASE = 3.5;
export const MAGNET_PER_GEAR = 1;

/** The M2 slice: three minutes, then you have won. */
export const RUN_TICKS = 180 * 60;

/** XP needed to go from `level` to the next. */
export function xpForLevel(level: number): number {
  return 4 + level * 3;
}

/**
 * What each level gives until there are cards to choose from (M3): the weapon to raise on reaching
 * level 2, 3, 4 and so on. Past the end, nothing.
 */
export const LEVEL_GRANTS: readonly ('wake' | 'seekers')[] = [
  'seekers', 'wake', 'seekers', 'wake', 'seekers', 'wake', 'seekers', 'wake',
];
export const WEAPON_MAX_LEVEL = 5;

/** The Wake, by level 1..5. */
export const WAKE = {
  /** Damage per second to anything standing in the trail, before gear power. */
  burnDps: [10, 13, 16, 20, 24],
  /** Damage to everything inside a closed loop, before gear power. */
  popDamage: [40, 55, 70, 90, 110],
  /** Extra trail, m. */
  extraLength: [0, 5, 10, 16, 22],
} as const;
