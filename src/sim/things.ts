/**
 * The things on the map, all of them ridden through, none of them a reason to stop, and each one
 * thing to do: crates rammed open, shrines ridden into, gates ridden between, hoops ridden through,
 * totems rammed to call a fight.
 *
 * They are placed from the bowl's sites when a run starts (`placeThings`) and stepped once a tick
 * after the sparks (`stepThings`). Spent ones stay in `w.things` at `THING_DONE` for the renderer.
 *
 * Per kind, the fields of `w.things` mean:
 * - crate, gold crate, shrine, totem: `state` 0 until it is used, then `THING_DONE`; nothing else.
 * - gate: the gates of one slalom are contiguous in `w.things`, in the order they are ridden, and
 *   share a `group`. Every gate of a slalom holds the slalom's `state`: the index of the gate that
 *   is next (so also how many are taken), kept however long the rider takes. `progress` is the
 *   gate's own: which side of its line the mover was on last tick, signed metres (0 before the
 *   first tick).
 * - hoop: `state` HOOP_TAKEN and `timer` ticks until it is back; `progress` as a gate's. It stands
 *   on its kicker's top and is taken by the mover's middle, a body radius above its feet, riding
 *   through it, on the ground or in the air.
 */
import { HOOP_AHEAD, type Bowl, type SiteKind } from './bowl';
import { queueOffer } from './build';
import { PLAYER_RADIUS } from './balance';
import { DT, FEEL } from './constants';
import { dcos, dsin } from './math';
import { OFFER_CRATE, OFFER_SHRINE, OFFER_TOTEM } from './offer';
import { powerOf } from './stats';
import type { Terrain } from './terrain';
import type { SimState } from './types';
import {
  damageEnemy,
  emitFx,
  FX_BLAST,
  FX_HEAL,
  FX_THING,
  FX_TOKEN,
  MARK_PACK,
  MAX_THINGS,
  SPAWN_TICKS,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from './world';

/** The numbers of the things on the map. Times are in ticks. */
export const THINGS = {
  /** A crate or totem is touched within this distance of its middle, m (and no higher above it). */
  touch: 1.4,
  /** What a crate gives, as shares of the roll before luck: a card, a heal, every spark, a bomb. */
  crateCard: 0.5,
  crateHeal: 0.2,
  crateMagnet: 0.15,
  crateBomb: 0.15,
  /** Each point of luck moves this share of the roll from the rest onto the card. */
  crateLuck: 0.5,
  /** The card's share never rises above this. */
  crateCardMax: 0.9,
  heal: 25,
  /** The bomb: damage before power, to every risen enemy within the radius, m. */
  bombDamage: 60,
  bombRadius: 22,
  goldTokens: 5,
  /** A shrine opens when the mover comes within this of its middle, m: the ring drawn round it. */
  shrineReach: 4,
  /** A gate's posts stand this far either side of its middle, m. */
  gateHalf: 4,
  slalomXp: 12,
  slalomTokens: 2,
  /**
   * A hoop stands on its kicker's top, its middle this high over it, and is taken by riding through
   * it within this of its middle, m (drawn that big); it comes back after `hoopTicks`.
   */
  hoopReach: 2.2,
  hoopTicks: 1200,
} as const;

/** `state` of a hoop that has been taken and is not back yet. */
export const HOOP_TAKEN = 1;

/** What a crate gave, by the roll. */
export const CRATE_CARD = 0;
export const CRATE_HEAL = 1;
export const CRATE_MAGNET = 2;
export const CRATE_BOMB = 3;

/**
 * A crossing of a gate's or hoop's line that moved further along it than this in one tick, as a
 * share of the hard speed limit's tick, is a jump of place (a reset, a test putting the mover down),
 * not a ride through.
 */
const STRIDE_SLACK = 2;

function kindOf(site: SiteKind): number {
  switch (site) {
    case 'crate':
      return THING_CRATE;
    case 'gold':
      return THING_GOLD_CRATE;
    case 'shrine':
      return THING_SHRINE;
    case 'gate':
      return THING_GATE;
    case 'hoop':
      return THING_HOOP;
    case 'totem':
      return THING_TOTEM;
  }
}

/**
 * Add one thing, waiting, at (x, z) on the ground (a hoop with its middle at height `y` instead). Returns its
 * index, or -1 if the pool is full. Tests place things by hand with this; the gates of one slalom
 * must be added one after another, first gate first.
 */
export function addThing(w: World, kind: number, x: number, y: number, z: number, yaw: number, group: number): number {
  const t = w.things;
  if (t.count >= MAX_THINGS) return -1;
  const i = t.count++;
  t.kind[i] = kind;
  t.x[i] = x;
  t.y[i] = y;
  t.z[i] = z;
  t.yaw[i] = yaw;
  t.state[i] = 0;
  t.progress[i] = 0;
  t.timer[i] = 0;
  t.group[i] = group;
  return i;
}

function isBowl(t: Terrain): t is Bowl {
  return 'features' in t;
}

/** Put the terrain's things on it, all waiting. A terrain that is not a bowl has none. */
export function placeThings(w: World, terrain: Terrain): void {
  w.things.count = 0;
  if (!isBowl(terrain)) return;
  const sites = terrain.features.sites;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    const kind = kindOf(site.kind);
    let x = site.x;
    let z = site.z;
    let y = terrain.heightAt(x, z);
    if (kind === THING_HOOP) {
      // The site is past the kicker's top, where a big jump would come down. Even at full speed the
      // kicker throws the mover less than a metre up, and at run speed not at all: the ring stands on
      // the top itself, where every straight run up the kicker goes, ollie or none.
      x = site.x - dsin(site.yaw) * HOOP_AHEAD;
      z = site.z - dcos(site.yaw) * HOOP_AHEAD;
      y = terrain.heightAt(x, z) + THINGS.hoopReach;
    }
    addThing(w, kind, x, y, z, site.yaw, site.group);
  }
}

/**
 * Which reward a crate's roll gives, with `luck` moving share from the rest onto the card. `roll`
 * is in [0, 1).
 */
export function crateReward(roll: number, luck: number): number {
  let card = THINGS.crateCard + THINGS.crateLuck * luck * (1 - THINGS.crateCard);
  if (card > THINGS.crateCardMax) card = THINGS.crateCardMax;
  if (card < THINGS.crateCard) card = THINGS.crateCard;
  if (roll < card) return CRATE_CARD;
  // The rest keep their proportions in what is left.
  const rest = (1 - card) / (THINGS.crateHeal + THINGS.crateMagnet + THINGS.crateBomb);
  let r = roll - card;
  if (r < THINGS.crateHeal * rest) return CRATE_HEAL;
  r -= THINGS.crateHeal * rest;
  if (r < THINGS.crateMagnet * rest) return CRATE_MAGNET;
  return CRATE_BOMB;
}

// ---- the step: nothing from here down allocates ---------------------------------------------

function giveTokens(w: World, s: SimState, n: number): void {
  const m = s.mover;
  w.player.tokens += n;
  emitFx(w, FX_TOKEN, m.x, m.y, m.z, n);
}

function used(w: World, i: number): void {
  const t = w.things;
  emitFx(w, FX_THING, t.x[i], t.y[i], t.z[i], t.kind[i]);
}

function openCrate(w: World, s: SimState, i: number): void {
  const t = w.things;
  const p = w.player;
  const m = s.mover;
  t.state[i] = THING_DONE;
  used(w, i);
  if (t.kind[i] === THING_GOLD_CRATE) {
    queueOffer(w, OFFER_CRATE);
    giveTokens(w, s, THINGS.goldTokens);
    return;
  }
  const reward = crateReward(w.rng.next(), p.stats.luck);
  if (reward === CRATE_CARD) {
    queueOffer(w, OFFER_CRATE);
  } else if (reward === CRATE_HEAL) {
    const give = Math.min(THINGS.heal, p.maxHp - p.hp);
    p.hp += give;
    emitFx(w, FX_HEAL, m.x, m.y, m.z, give);
  } else if (reward === CRATE_MAGNET) {
    const sp = w.sparks;
    for (let k = 0; k < sp.count; k++) sp.pull[k] = 1;
  } else {
    // The grid is stale after the reap, so the bomb looks at every enemy.
    const h = w.horde;
    const damage = THINGS.bombDamage * powerOf(p.stats, m.gear);
    const r2 = THINGS.bombRadius * THINGS.bombRadius;
    for (let k = 0; k < h.count; k++) {
      if (h.hp[k] <= 0 || h.age[k] < SPAWN_TICKS) continue;
      const dx = h.x[k] - t.x[i];
      const dz = h.z[k] - t.z[i];
      if (dx * dx + dz * dz <= r2) damageEnemy(w, k, damage, true);
    }
    emitFx(w, FX_BLAST, t.x[i], t.y[i], t.z[i], THINGS.bombRadius);
  }
}

function stepCrate(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  const dx = m.x - t.x[i];
  const dz = m.z - t.z[i];
  if (dx * dx + dz * dz > THINGS.touch * THINGS.touch || m.y - t.y[i] > THINGS.touch) return;
  openCrate(w, s, i);
}

function stepShrine(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  const dx = m.x - t.x[i];
  const dz = m.z - t.z[i];
  const r = THINGS.shrineReach;
  // Into the ring drawn round it, on the ground or flying low over it: its boons open at once.
  if (dx * dx + dz * dz > r * r || m.y - t.y[i] > r) return;
  t.state[i] = THING_DONE;
  used(w, i);
  queueOffer(w, OFFER_SHRINE);
}

/**
 * Did the mover cross the line through thing i, square to its yaw, this tick: from the side it was
 * on last tick, by a ride and not a jump of place? Remembers the side in `progress`.
 */
function crossed(w: World, s: SimState, i: number): boolean {
  const t = w.things;
  const m = s.mover;
  const along = (m.x - t.x[i]) * dsin(t.yaw[i]) + (m.z - t.z[i]) * dcos(t.yaw[i]);
  const before = t.progress[i];
  // 0 means "no side yet", so a mover exactly on the line counts as past it.
  t.progress[i] = along === 0 ? 1e-6 : along;
  if (before === 0 || before < 0 === along < 0) return false;
  const moved = before > along ? before - along : along - before;
  return moved <= STRIDE_SLACK * FEEL.maxSpeed * DT;
}

/** How far the mover is across the line through thing i, signed metres. */
function across(w: World, s: SimState, i: number): number {
  const t = w.things;
  const m = s.mover;
  return (m.x - t.x[i]) * dcos(t.yaw[i]) - (m.z - t.z[i]) * dsin(t.yaw[i]);
}

/** Step the slalom whose gates are [first, first + n). */
function stepSlalom(w: World, s: SimState, first: number, n: number): void {
  const t = w.things;
  const state = t.state[first];
  if (state === THING_DONE) return;
  let next = state;
  for (let k = 0; k < n; k++) {
    const i = first + k;
    // Every gate keeps its side, so the next one knows where the mover came from.
    if (!crossed(w, s, i) || k !== next) continue;
    const a = across(w, s, i);
    if (a > THINGS.gateHalf || a < -THINGS.gateHalf) continue;
    used(w, i);
    next = k + 1;
  }
  if (next === n) {
    next = THING_DONE;
    w.player.xp += THINGS.slalomXp;
    giveTokens(w, s, THINGS.slalomTokens);
  }
  for (let k = 0; k < n; k++) t.state[first + k] = next;
}

function stepHoop(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  const through = crossed(w, s, i);
  if (t.state[i] === HOOP_TAKEN) {
    if (t.timer[i] > 0) t.timer[i]--;
    if (t.timer[i] === 0) t.state[i] = 0;
    return;
  }
  if (!through) return;
  // The mover is a ball on its feet: its middle is a radius above them.
  const a = across(w, s, i);
  const dy = m.y + PLAYER_RADIUS - t.y[i];
  if (a * a + dy * dy > THINGS.hoopReach * THINGS.hoopReach) return;
  // A streak: one more token for every other hoop taken in the last 20 s (the ones not back yet).
  let streak = 0;
  for (let k = 0; k < t.count; k++) if (k !== i && t.kind[k] === THING_HOOP && t.state[k] === HOOP_TAKEN) streak++;
  t.state[i] = HOOP_TAKEN;
  t.timer[i] = THINGS.hoopTicks;
  used(w, i);
  giveTokens(w, s, 1 + streak);
}

function stepTotem(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  const dx = m.x - t.x[i];
  const dz = m.z - t.z[i];
  if (dx * dx + dz * dz > THINGS.touch * THINGS.touch || m.y - t.y[i] > THINGS.touch) return;
  t.state[i] = THING_DONE;
  used(w, i);
  if (w.packs < w.packX.length) {
    w.packX[w.packs] = t.x[i];
    w.packZ[w.packs] = t.z[i];
    w.packs++;
  }
}

/**
 * One tick of the things on the map. Runs after the sparks: `w.deaths` holds this tick's dead, and
 * an offer queued here opens on this tick.
 */
export function stepThings(w: World, s: SimState, _terrain: Terrain): void {
  // The elite of a pack a totem called has fallen: its reward.
  const d = w.deaths;
  for (let k = 0; k < d.count; k++) if ((d.mark[k] & MARK_PACK) !== 0) queueOffer(w, OFFER_TOTEM);

  const t = w.things;
  let i = 0;
  while (i < t.count) {
    const kind = t.kind[i];
    if (kind === THING_GATE) {
      let n = 1;
      while (i + n < t.count && t.kind[i + n] === THING_GATE && t.group[i + n] === t.group[i]) n++;
      stepSlalom(w, s, i, n);
      i += n;
      continue;
    }
    if (t.state[i] !== THING_DONE) {
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) stepCrate(w, s, i);
      else if (kind === THING_SHRINE) stepShrine(w, s, i);
      else if (kind === THING_HOOP) stepHoop(w, s, i);
      else if (kind === THING_TOTEM) stepTotem(w, s, i);
    }
    i++;
  }
}
