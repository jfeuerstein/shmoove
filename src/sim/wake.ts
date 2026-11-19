/**
 * The Wake: a burning trail behind the mover, and the loop.
 *
 * The trail is a string of points laid every WAKE_STEP metres. Anything standing in it burns. When
 * the mover comes back to its own trail far enough along, the trail between there and here is a
 * closed loop: everything inside it and on its ring takes the pop, sparks inside fly to the player, and the trail
 * starts again. Circling the horde is the attack.
 */
import { gearPower, WAKE } from './balance';
import { FEEL, TICK_HZ } from './constants';
import type { SimState } from './types';
import {
  damageEnemy,
  emitFx,
  FX_POP,
  KINDS,
  makeWake,
  MARK_SWEPT,
  MAX_ENEMIES,
  MAX_ENEMY_RADIUS,
  queryEnemies,
  SPAWN_TICKS,
  WAKE_MAX,
  type Wake,
  type World,
} from './world';

export { makeWake, WAKE_MAX, type Wake };

/** Metres between trail points. */
export const WAKE_STEP = 1.25;
/** The newest points are under the mover; they do not burn. */
const WAKE_SKIP_HEAD = 2;
/** The whole trail burns once every this many ticks. */
const BURN_EVERY = 4;
/** Which enemies the trail has already burnt this burn, so each burns once however many points reach it. */
const burnt = new Uint8Array(MAX_ENEMIES);

function drop(k: Wake, n: number): void {
  if (n <= 0) return;
  if (n >= k.count) {
    k.count = 0;
    return;
  }
  k.x.copyWithin(0, n, k.count);
  k.y.copyWithin(0, n, k.count);
  k.z.copyWithin(0, n, k.count);
  k.born.copyWithin(0, n, k.count);
  k.count -= n;
}

/** How long the trail is now, m. */
export function wakeLength(w: World, gear: number): number {
  const level = w.player.wakeLevel;
  if (level <= 0) return 0;
  return FEEL.wakeLength + FEEL.wakeLengthPerGear * (gear - 1) + WAKE.extraLength[level - 1];
}

/** Is (px, pz) inside the polygon of trail points [from, to]? */
function inLoop(k: Wake, from: number, to: number, px: number, pz: number): boolean {
  let inside = false;
  for (let i = from, j = to; i <= to; j = i++) {
    const xi = k.x[i];
    const zi = k.z[i];
    const xj = k.x[j];
    const zj = k.z[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Is (px, pz) within `reach` of the loop's own line, trail points [from, to]? */
function onLoop(k: Wake, from: number, to: number, px: number, pz: number, reach: number): boolean {
  const r2 = reach * reach;
  for (let i = from; i <= to; i++) {
    const dx = k.x[i] - px;
    const dz = k.z[i] - pz;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** Area enclosed by trail points [from, to], m2. */
function loopArea(k: Wake, from: number, to: number): number {
  let twice = 0;
  for (let i = from, j = to; i <= to; j = i++) twice += k.x[j] * k.z[i] - k.x[i] * k.z[j];
  return twice < 0 ? -twice / 2 : twice / 2;
}

/** The trail point the newest point has come back to, closing a loop; -1 if none. */
function closure(k: Wake): number {
  const n = k.count - 1;
  const hx = k.x[n];
  const hz = k.z[n];
  const close2 = FEEL.wakeCloseDist * FEEL.wakeCloseDist;
  let path = 0;
  let best = -1;
  let bestD = close2;
  for (let j = n - 1; j >= 0; j--) {
    const sx = k.x[j + 1] - k.x[j];
    const sz = k.z[j + 1] - k.z[j];
    path += Math.sqrt(sx * sx + sz * sz);
    if (path < FEEL.wakeLoopMin) continue;
    const dx = k.x[j] - hx;
    const dz = k.z[j] - hz;
    const d = dx * dx + dz * dz;
    if (d <= bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

function pop(w: World, from: number, power: number): void {
  const k = w.wake;
  const to = k.count - 1;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = from; i <= to; i++) {
    cx += k.x[i];
    cy += k.y[i];
    cz += k.z[i];
  }
  const inv = 1 / (to - from + 1);
  cx *= inv;
  cy *= inv;
  cz *= inv;
  let r2 = 0;
  for (let i = from; i <= to; i++) {
    const dx = k.x[i] - cx;
    const dz = k.z[i] - cz;
    const d = dx * dx + dz * dz;
    if (d > r2) r2 = d;
  }
  const radius = Math.sqrt(r2);

  const h = w.horde;
  const damage = WAKE.popDamage[w.player.wakeLevel - 1] * power;
  // The pop takes what is inside the loop and what is on the ring itself: the horde that chased
  // the mover round is strung along the trail, not standing in the middle.
  const edge = FEEL.wakePopEdge;
  const n = queryEnemies(w, cx, cz, radius + edge + MAX_ENEMY_RADIUS, w.nearA);
  let killed = 0;
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    if (
      !inLoop(k, from, to, h.x[i], h.z[i]) &&
      !onLoop(k, from, to, h.x[i], h.z[i], edge + KINDS[h.kind[i]].radius)
    ) {
      continue;
    }
    h.mark[i] |= MARK_SWEPT;
    damageEnemy(w, i, damage, true);
    if (h.hp[i] <= 0) killed++;
  }

  const s = w.sparks;
  for (let i = 0; i < s.count; i++) {
    if (s.pull[i] === 0 && inLoop(k, from, to, s.x[i], s.z[i])) s.pull[i] = 1;
  }

  w.player.pops++;
  if (killed > w.player.bestPop) w.player.bestPop = killed;
  emitFx(w, FX_POP, cx, cy, cz, radius);

  // The loop is spent: the trail starts again from here.
  drop(k, to);
}

/** Lay trail, burn what stands in it, and pop a loop if the mover has just closed one. */
export function stepWake(w: World, s: SimState): void {
  const level = w.player.wakeLevel;
  const k = w.wake;
  if (level <= 0) {
    k.count = 0;
    return;
  }
  const m = s.mover;
  const power = gearPower(m.gear);
  const now = w.run.ticks;

  // Lay.
  let laid = false;
  if (k.count === 0) {
    laid = true;
  } else {
    const dx = m.x - k.x[k.count - 1];
    const dz = m.z - k.z[k.count - 1];
    k.acc = Math.sqrt(dx * dx + dz * dz);
    if (k.acc >= WAKE_STEP) laid = true;
  }
  if (laid) {
    if (k.count === WAKE_MAX) drop(k, 1);
    const i = k.count++;
    k.x[i] = m.x;
    k.y[i] = m.y;
    k.z[i] = m.z;
    k.born[i] = now;
    k.acc = 0;
  }

  // Fade: too long, or too old.
  const maxPoints = Math.min(WAKE_MAX, Math.max(2, Math.floor(wakeLength(w, m.gear) / WAKE_STEP)));
  let stale = k.count - maxPoints;
  if (stale < 0) stale = 0;
  while (stale < k.count - 1 && now - k.born[stale] > FEEL.wakeLifeTicks) stale++;
  drop(k, stale);

  // Close.
  if (laid && k.count >= 4) {
    const j = closure(k);
    if (j >= 0 && loopArea(k, j, k.count - 1) >= FEEL.wakeLoopMinArea) pop(w, j, power);
  }

  // Burn, once every BURN_EVERY ticks: everything within the trail's width takes one burn, however
  // many trail points it is near, so the rate is the stated one at any speed.
  if (now % BURN_EVERY !== 0) return;
  const h = w.horde;
  const burn = (WAKE.burnDps[level - 1] * power * BURN_EVERY) / TICK_HZ;
  const last = k.count - WAKE_SKIP_HEAD;
  burnt.fill(0, 0, h.count);
  for (let p = 0; p < last; p++) {
    const px = k.x[p];
    const pz = k.z[p];
    const n = queryEnemies(w, px, pz, FEEL.wakeWidth + MAX_ENEMY_RADIUS, w.nearA);
    for (let q = 0; q < n; q++) {
      const i = w.nearA[q];
      if (burnt[i] !== 0 || h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
      const reach = FEEL.wakeWidth + KINDS[h.kind[i]].radius;
      const dx = h.x[i] - px;
      const dz = h.z[i] - pz;
      if (dx * dx + dz * dz > reach * reach) continue;
      burnt[i] = 1;
      damageEnemy(w, i, burn, true);
    }
  }
}
