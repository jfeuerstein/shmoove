/**
 * The things on the map, all of them ridden through, none of them a reason to stop: crates rammed
 * open, shrines orbited, slaloms ridden, hoops flown through, totems rammed to call a fight.
 *
 * They are placed from the bowl's sites when a run starts (`placeThings`) and stepped once a tick
 * after the sparks (`stepThings`). Spent ones stay in `w.things` at `THING_DONE` for the renderer.
 *
 * Per kind, the fields of `w.things` mean:
 * - crate, gold crate: `timer` ticks until it may rattle again.
 * - shrine: `state` SHRINE_IDLE, SHRINE_YAW_UP or SHRINE_YAW_DOWN (the way it is being ridden round);
 *   `progress` laps so far; `timer` ticks since the count started.
 * - gate: the gates of one slalom are contiguous in `w.things`, in the order they are ridden, and
 *   share a `group`. Every gate of a slalom holds the slalom's `state` (the index of the gate that is
 *   next, or SLALOM_MISSED while it waits to start again) and its `timer` (ticks since the last gate,
 *   or since the miss). `progress` is the gate's own: which side of its line the mover was on last
 *   tick, signed metres (0 before the first tick).
 * - hoop: `state` HOOP_TAKEN and `timer` ticks until it is back.
 * - totem: nothing until it is spent.
 */
import { HOOP_AHEAD, HOOP_RISE, type Bowl, type SiteKind } from './bowl';
import { queueOffer } from './build';
import { DT } from './constants';
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
  /** The lowest gear (counting plow grace) that breaks a crate, and a gold crate. */
  crateGear: 2,
  goldGear: 4,
  /** A crate too slow to break rattles at most this often. */
  rattleTicks: 60,
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
  /** The shrine's ring, m from its middle; laps; and the time they must be ridden in. */
  shrineInner: 4,
  shrineOuter: 11,
  shrineLaps: 3,
  shrineTicks: 600,
  /** A gate's posts stand this far either side of its middle, m. */
  gateHalf: 3,
  /** Each next gate must come within this of the last; a miss waits this long before a fresh start. */
  gateTicks: 144,
  missTicks: 180,
  slalomXp: 12,
  slalomTokens: 2,
  /** A hoop is taken within this distance of its middle, m; it comes back after `hoopTicks`. */
  hoopReach: 1.6,
  hoopTicks: 1200,
} as const;

/** `state` of a shrine. */
export const SHRINE_IDLE = 0;
/** Being ridden round with the yaw from the shrine to the mover growing, or shrinking. */
export const SHRINE_YAW_UP = 1;
export const SHRINE_YAW_DOWN = 2;
/** `state` of a slalom's gates after a miss, until it can start again. */
export const SLALOM_MISSED = 200;
/** `state` of a hoop that has been taken and is not back yet. */
export const HOOP_TAKEN = 1;

/** What a crate gave, by the roll. */
export const CRATE_CARD = 0;
export const CRATE_HEAL = 1;
export const CRATE_MAGNET = 2;
export const CRATE_BOMB = 3;

const TWO_PI = 6.283185307179586;
/** A turn about the shrine slower than this, rad per tick, is neither way: it neither counts nor reverses. */
const SHRINE_STILL = 1e-4;

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
 * Add one thing, waiting, at (x, z) on the ground (a hoop at height `y` instead). Returns its
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
    let y = terrain.heightAt(site.x, site.z);
    if (kind === THING_HOOP) {
      // Over the top of its kicker, which is behind it along the kicker's line.
      y = terrain.heightAt(site.x - dsin(site.yaw) * HOOP_AHEAD, site.z - dcos(site.yaw) * HOOP_AHEAD) + HOOP_RISE;
    }
    addThing(w, kind, site.x, y, site.z, site.yaw, site.group);
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
  if (t.timer[i] > 0) t.timer[i]--;
  const dx = m.x - t.x[i];
  const dz = m.z - t.z[i];
  if (dx * dx + dz * dz > THINGS.touch * THINGS.touch || m.y - t.y[i] > THINGS.touch) return;
  const p = w.player;
  const gear = p.graceGear > m.gear ? p.graceGear : m.gear;
  const need = t.kind[i] === THING_GOLD_CRATE ? THINGS.goldGear : THINGS.crateGear;
  if (gear >= need) {
    openCrate(w, s, i);
  } else if (t.timer[i] === 0) {
    // Too slow: it only rattles.
    used(w, i);
    t.timer[i] = THINGS.rattleTicks;
  }
}

function resetShrine(w: World, i: number): void {
  const t = w.things;
  t.state[i] = SHRINE_IDLE;
  t.progress[i] = 0;
  t.timer[i] = 0;
}

function stepShrine(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  const dx = m.x - t.x[i];
  const dz = m.z - t.z[i];
  const r2 = dx * dx + dz * dz;
  if (r2 < THINGS.shrineInner * THINGS.shrineInner || r2 > THINGS.shrineOuter * THINGS.shrineOuter) {
    // Out of the ring: the count starts again.
    if (t.state[i] !== SHRINE_IDLE) resetShrine(w, i);
    return;
  }
  // The angle swept this tick, from the mover's motion about the shrine.
  const turn = ((dz * m.vx - dx * m.vz) / r2) * DT;
  if (turn > -SHRINE_STILL && turn < SHRINE_STILL) {
    if (t.state[i] !== SHRINE_IDLE) t.timer[i]++;
  } else {
    const way = turn > 0 ? SHRINE_YAW_UP : SHRINE_YAW_DOWN;
    if (t.state[i] !== way) {
      // Reversed (or just started): the count starts from here.
      resetShrine(w, i);
      t.state[i] = way;
    }
    t.progress[i] += (turn > 0 ? turn : -turn) / TWO_PI;
    t.timer[i]++;
  }
  if (t.state[i] === SHRINE_IDLE) return;
  if (t.progress[i] >= THINGS.shrineLaps) {
    t.state[i] = THING_DONE;
    t.progress[i] = THINGS.shrineLaps;
    used(w, i);
    queueOffer(w, OFFER_SHRINE);
  } else if (t.timer[i] >= THINGS.shrineTicks) {
    // Too slow.
    resetShrine(w, i);
  }
}

/** Step the slalom whose gates are [first, first + n). */
function stepSlalom(w: World, s: SimState, first: number, n: number): void {
  const t = w.things;
  const m = s.mover;
  const state = t.state[first];
  if (state === THING_DONE) return;
  let timer = t.timer[first];
  let next = state;
  if (timer < 65535) timer++;
  if (state === SLALOM_MISSED) {
    if (timer >= THINGS.missTicks) {
      next = 0;
      timer = 0;
    }
  } else if (state > 0 && timer > THINGS.gateTicks) {
    // Too slow to the next gate.
    next = SLALOM_MISSED;
    timer = 0;
  }
  for (let k = 0; k < n; k++) {
    const i = first + k;
    // Along the gate's facing and across it.
    const fx = dsin(t.yaw[i]);
    const fz = dcos(t.yaw[i]);
    const dx = m.x - t.x[i];
    const dz = m.z - t.z[i];
    const along = dx * fx + dz * fz;
    const across = dx * fz - dz * fx;
    const before = t.progress[i];
    // 0 means "no side yet", so a mover exactly on the line counts as past it.
    t.progress[i] = along === 0 ? 1e-6 : along;
    if (k !== next || before === 0) continue;
    if (before < 0 === along < 0 || across > THINGS.gateHalf || across < -THINGS.gateHalf) continue;
    used(w, i);
    next = k + 1;
    timer = 0;
  }
  if (next === n) {
    next = THING_DONE;
    w.player.xp += THINGS.slalomXp;
    giveTokens(w, s, THINGS.slalomTokens);
  }
  for (let k = 0; k < n; k++) {
    t.state[first + k] = next;
    t.timer[first + k] = timer;
  }
}

function stepHoop(w: World, s: SimState, i: number): void {
  const t = w.things;
  const m = s.mover;
  if (t.state[i] === HOOP_TAKEN) {
    if (t.timer[i] > 0) t.timer[i]--;
    if (t.timer[i] === 0) t.state[i] = 0;
    return;
  }
  if (m.grounded) return;
  const dx = m.x - t.x[i];
  const dy = m.y - t.y[i];
  const dz = m.z - t.z[i];
  if (dx * dx + dy * dy + dz * dz > THINGS.hoopReach * THINGS.hoopReach) return;
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
