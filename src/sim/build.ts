/**
 * The build in motion: the one place the player's loadout changes, where stats are worked out
 * again when it does, and where card offers are queued, opened and answered.
 */
import {
  MAX_LEVEL,
  SLOTS,
  type Loadout,
} from './arsenal';
import {
  BOON_HEAL,
  BOON_HEAL_SHARE,
  BOON_MIGHT,
  BOON_MIGHT_SHARE,
  BOON_REACH,
  BOON_REACH_M,
  BOON_TOKEN_COUNT,
  BOON_TOKENS,
  BOON_VIGOUR,
  BOON_VIGOUR_HP,
  CARD_BOON,
  OFFER_SHRINE,
  OFFER_TOTEM,
  rollBoons,
  rollOffer,
  takeCard,
} from './offer';
import { modsFromStats, recomputeStats } from './stats';
import type { SimState } from './types';
import { emitFx, FX_CARD, FX_HEAL, FX_TOKEN, PHASE_CHOOSE, PHASE_PLAY, type World } from './world';

/**
 * Work the stats out again after the build changed. More maximum health is also that much more
 * health now; less never takes the player below 1.
 */
export function refreshBuild(w: World): void {
  const p = w.player;
  const before = p.stats.maxHp;
  recomputeStats(p.stats, p.loadout);
  // What shrines gave this run sits on top of the build.
  p.stats.might *= 1 + p.boonMight;
  p.stats.maxHp += p.boonMaxHp;
  p.stats.magnet += p.boonMagnet;
  p.maxHp = p.stats.maxHp;
  if (p.maxHp > before) p.hp += p.maxHp - before;
  if (p.hp > p.maxHp) p.hp = p.maxHp;
}

/** Copy what the build does to movement into the state the mover reads. Call before the mover steps. */
export function applyBuildToMover(w: World, s: SimState): void {
  modsFromStats(s.mods, w.player.stats);
  s.mods.cling = w.player.cling;
}

function setLevel(slots: Int8Array, levels: Uint8Array, id: number, level: number): void {
  const want = level < 0 ? 0 : level > MAX_LEVEL ? MAX_LEVEL : level;
  let at = -1;
  let free = -1;
  for (let i = 0; i < SLOTS; i++) {
    if (slots[i] === id) at = i;
    else if (slots[i] < 0 && free < 0) free = i;
  }
  if (want === 0) {
    if (at >= 0) slots[at] = -1;
    levels[id] = 0;
    return;
  }
  if (at < 0) {
    if (free < 0) return;
    slots[free] = id;
  }
  levels[id] = want;
}

/** Set a weapon's level outright (0 removes it). For fixtures, tests and unlock rewards. */
export function setWeaponLevel(w: World, id: number, level: number): void {
  const l: Loadout = w.player.loadout;
  setLevel(l.weapons, l.weaponLevel, id, level);
  refreshBuild(w);
}

export function setPassiveLevel(w: World, id: number, level: number): void {
  const l: Loadout = w.player.loadout;
  setLevel(l.passives, l.passiveLevel, id, level);
  refreshBuild(w);
}

/** Line up an offer. It opens when its turn comes (see `openOffer`). A full queue drops it. */
export function queueOffer(w: World, source: number): void {
  if (w.offerQueued >= w.offerQueue.length) return;
  w.offerQueue[w.offerQueued++] = source;
}

/** If offers are waiting and none is open, deal the next and hold the world. */
export function openOffer(w: World): void {
  if (w.offer.open || w.offerQueued === 0 || w.run.phase !== PHASE_PLAY) return;
  const source = w.offerQueue[0];
  w.offerQueue.copyWithin(0, 1, w.offerQueued);
  w.offerQueued--;
  if (source === OFFER_SHRINE) rollBoons(w.offer, w.rng);
  else rollOffer(w.offer, w.player.loadout, w.pool, w.player.stats.luck, w.rng, source, source === OFFER_TOTEM);
  w.run.phase = PHASE_CHOOSE;
}

/**
 * Take card `index` from the open offer. Returns false if there is no such card. After the last
 * queued offer is answered the run goes on.
 */
export function pickCard(w: World, s: SimState, index: number): boolean {
  const o = w.offer;
  if (!o.open || index < 0 || index >= o.count) return false;
  const id = o.id[index];
  const m = s.mover;
  const type = takeCard(o, index, w.player.loadout);
  if (type < 0) return false;

  const p = w.player;
  if (type === CARD_BOON) {
    if (id === BOON_HEAL) {
      const give = Math.min(p.maxHp - p.hp, p.maxHp * BOON_HEAL_SHARE);
      p.hp += give;
      emitFx(w, FX_HEAL, m.x, m.y, m.z, give);
    } else if (id === BOON_TOKENS) {
      p.tokens += BOON_TOKEN_COUNT;
      emitFx(w, FX_TOKEN, m.x, m.y, m.z, BOON_TOKEN_COUNT);
    } else {
      if (id === BOON_MIGHT) p.boonMight += BOON_MIGHT_SHARE;
      else if (id === BOON_VIGOUR) p.boonMaxHp += BOON_VIGOUR_HP;
      else if (id === BOON_REACH) p.boonMagnet += BOON_REACH_M;
      refreshBuild(w);
    }
  } else {
    refreshBuild(w);
  }
  emitFx(w, FX_CARD, m.x, m.y, m.z, type);

  w.run.phase = PHASE_PLAY;
  openOffer(w);
  return true;
}
