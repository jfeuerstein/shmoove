/**
 * The numbers of the fight: health, damage, growth. How things feel under the thumb is in
 * `constants.ts` (`FEEL`); how strong they are is here.
 */

/**
 * Weapon power by gear. Since the game became a standard survivor this is 1 in every gear: how
 * fast the player is moving has nothing to do with how hard they hit. Kept as a table so the one
 * place that reads it (`powerOf`) and the tests that quote it need not change shape.
 */
export const GEAR_POWER: readonly number[] = [1, 1, 1, 1, 1];

export function gearPower(gear: number): number {
  return GEAR_POWER[gear < 1 ? 0 : gear > 5 ? 4 : gear - 1];
}

/** Radius of the mover for contact, m. */
export const PLAYER_RADIUS = 0.5;

/** Sparks fly to the player from this far, m. (`MAGNET_PER_GEAR` is 0 since speed stopped mattering.) */
export const MAGNET_BASE = 4.5;
export const MAGNET_PER_GEAR = 0;

/**
 * When the bosses come, s into the run: the Bruiser, the Mortar, the Standstill. There is no win on
 * the clock: the run is won when the last of them falls, and past 9:00 the clock simply keeps
 * counting.
 */
export const BOSS_TIMES: readonly number[] = [180, 360, 540];

/** How many times an ordinary enemy's sparks an elite is worth. */
export const ELITE_XP = 8;

/** XP needed to go from `level` to the next. */
export function xpForLevel(level: number): number {
  return 2 + level * 3;
}

/** The Wake, by level 1..5. */
export const WAKE = {
  /** Damage per second to anything standing in the trail, before gear power. */
  burnDps: [10, 13, 16, 20, 24],
  /** Damage to everything inside a closed loop, before gear power. */
  popDamage: [40, 55, 70, 90, 110],
  /** Extra trail, m. */
  extraLength: [0, 5, 10, 16, 22],
} as const;
