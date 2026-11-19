/**
 * The player's stats: one table of numbers that weapons, contact, sparks and the mover read, worked
 * out from the build whenever the build changes. Nothing else changes them.
 */
import { MAX_LEVEL, PASSIVE_COUNT, PASSIVE_INFO, W_BUMPER, type Loadout } from './arsenal';
import { gearPower } from './balance';

export interface Stats {
  // ---- the fight
  /** Weapon damage multiplier. */
  might: number;
  /** Size multiplier for everything with an area. */
  area: number;
  /** Extra magnet reach, m. */
  magnet: number;
  maxHp: number;
  /** Health per second regained while in gear 3 or higher. */
  regen: number;
  /** Taken off every hit, to a minimum of 1 damage. */
  armour: number;
  /** 0 and up: shifts card rarity and crate rewards. */
  luck: number;
  /** Added to gear power for each gear above 2. */
  gearBonus: number;
  /** Ram damage multiplier (Bumper). */
  ram: number;
  /** Speed given back for each enemy killed by ramming, m/s (Bumper). */
  ramRefund: number;
  // ---- movement (copied into SimState.mods for the mover)
  /** Multiplies tuck and air drag. */
  drag: number;
  /** Multiplies the speed carving costs. */
  scrub: number;
  /** Extra ticks in the clean-hop window. */
  hopWindow: number;
  /** Multiplies hop speed. */
  hopSpeed: number;
  /** Multiplies air-steer. */
  airTurn: number;
  /** Multiplies gravity while rising in the air (below 1 hangs longer). */
  hang: number;
}

/** What the mover reads from the build. Kept in `SimState` so it travels with the mover's state. */
export interface MoverMods {
  drag: number;
  scrub: number;
  hopWindow: number;
  hopSpeed: number;
  airTurn: number;
  hang: number;
  /** Extra drag from things holding on to the mover, 1/s. Set by the world each tick. */
  cling: number;
}

export function makeMoverMods(): MoverMods {
  return { drag: 1, scrub: 1, hopWindow: 0, hopSpeed: 1, airTurn: 1, hang: 1, cling: 0 };
}

export function copyMoverMods(dst: MoverMods, src: MoverMods): void {
  dst.drag = src.drag;
  dst.scrub = src.scrub;
  dst.hopWindow = src.hopWindow;
  dst.hopSpeed = src.hopSpeed;
  dst.airTurn = src.airTurn;
  dst.hang = src.hang;
  dst.cling = src.cling;
}

export const BASE_HP = 100;

/** Bumper, by level 1..5: ram damage multiplier and speed refunded per ram kill. */
export const BUMPER = {
  ram: [1.6, 2.1, 2.7, 3.4, 4.2],
  refund: [0.15, 0.25, 0.35, 0.45, 0.6],
} as const;

export function makeStats(): Stats {
  return {
    might: 1,
    area: 1,
    magnet: 0,
    maxHp: BASE_HP,
    regen: 0,
    armour: 0,
    luck: 0,
    gearBonus: 0,
    ram: 1,
    ramRefund: 0,
    drag: 1,
    scrub: 1,
    hopWindow: 0,
    hopSpeed: 1,
    airTurn: 1,
    hang: 1,
  };
}

/** Work the stats out again from the build. Call whenever the build changes. */
export function recomputeStats(st: Stats, l: Loadout): void {
  st.might = 1;
  st.area = 1;
  st.magnet = 0;
  st.maxHp = BASE_HP;
  st.regen = 0;
  st.armour = 0;
  st.luck = 0;
  st.gearBonus = 0;
  st.ram = 1;
  st.ramRefund = 0;
  st.drag = 1;
  st.scrub = 1;
  st.hopWindow = 0;
  st.hopSpeed = 1;
  st.airTurn = 1;
  st.hang = 1;

  for (let id = 0; id < PASSIVE_COUNT; id++) {
    const level = l.passiveLevel[id];
    if (level <= 0) continue;
    const effects = PASSIVE_INFO[id].effects;
    for (let e = 0; e < effects.length; e++) {
      const fx = effects[e];
      const v = fx.byLevel[(level > MAX_LEVEL ? MAX_LEVEL : level) - 1];
      if (fx.mode === 'mul') st[fx.stat] *= v;
      else st[fx.stat] += v;
    }
  }

  const bumper = l.weaponLevel[W_BUMPER];
  if (bumper > 0) {
    st.ram = BUMPER.ram[bumper - 1];
    st.ramRefund = BUMPER.refund[bumper - 1];
  }
}

export function modsFromStats(mods: MoverMods, st: Stats): void {
  mods.drag = st.drag;
  mods.scrub = st.scrub;
  mods.hopWindow = st.hopWindow;
  mods.hopSpeed = st.hopSpeed;
  mods.airTurn = st.airTurn;
  mods.hang = st.hang;
}

/**
 * How hard weapons hit right now: the gear's power, the build's bonus for each gear above 2, and
 * the build's might. Every weapon multiplies its damage by this.
 */
export function powerOf(st: Stats, gear: number): number {
  return (gearPower(gear) + (gear > 2 ? (gear - 2) * st.gearBonus : 0)) * st.might;
}
