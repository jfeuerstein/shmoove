/**
 * Sparks: what the dead leave behind. They wait on the ground until the mover comes within magnet
 * range, then fly in and become XP; XP becomes levels, and levels raise the two weapons.
 */
import { ELITE_XP, MAGNET_BASE, MAGNET_PER_GEAR, xpForLevel } from './balance';
import { queueOffer } from './build';
import { jammed } from './horde';
import { OFFER_LEVEL } from './offer';
import { DT } from './constants';
import type { Terrain } from './terrain';
import type { SimState } from './types';
import { emitFx, FX_LEVEL_UP, FX_SPARK, KINDS, MARK_ELITE,
  MARK_SWEPT, type World } from './world';

/** Living sparks never exceed this; further value merges into a neighbour. */
export const SPARK_CAP = 600;
/** Where a spark rests above the ground, m. */
const REST_HEIGHT = 0.5;
/** A pulled spark aims this far above the mover's feet, m. */
const AIM_HEIGHT = 1;
const FLY_MIN = 18;
const FLY_BONUS = 8;
const TAKE_RADIUS = 0.9;
const MERGE_RADIUS = 8;

function dropSpark(w: World, x: number, y: number, z: number, value: number, pull: number): void {
  const s = w.sparks;
  if (s.count >= SPARK_CAP) {
    let best = 0;
    let bestD = MERGE_RADIUS * MERGE_RADIUS;
    for (let i = 0; i < s.count; i++) {
      const dx = s.x[i] - x;
      const dy = s.y[i] - y;
      const dz = s.z[i] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    s.value[best] += value;
    if (pull !== 0) s.pull[best] = 1;
    return;
  }
  const i = s.count++;
  s.x[i] = x;
  s.y[i] = y;
  s.z[i] = z;
  s.value[i] = value;
  s.pull[i] = pull;
}

function removeSpark(w: World, i: number): void {
  const s = w.sparks;
  const j = --s.count;
  if (i === j) return;
  s.x[i] = s.x[j];
  s.y[i] = s.y[j];
  s.z[i] = s.z[j];
  s.value[i] = s.value[j];
  s.pull[i] = s.pull[j];
}

/** Drop sparks for this tick's deaths, run the magnet, take what reached the mover, level up. */
export function stepSparks(w: World, s: SimState, terrain: Terrain): void {
  const d = w.deaths;
  for (let k = 0; k < d.count; k++) {
    const swept = (d.mark[k] & MARK_SWEPT) !== 0 ? 1 : 0;
    dropSpark(w, d.x[k], terrain.heightAt(d.x[k], d.z[k]) + REST_HEIGHT, d.z[k], KINDS[d.kind[k]].xp * ((d.mark[k] & MARK_ELITE) !== 0 ? ELITE_XP : 1), swept);
  }

  const m = s.mover;
  const sp = w.sparks;
  const p = w.player;
  const magnet = MAGNET_BASE + MAGNET_PER_GEAR * (m.gear - 1) + p.stats.magnet;
  const magnet2 = magnet * magnet;
  const fly = Math.max(FLY_MIN, m.speed + FLY_BONUS) * DT;
  const ay = m.y + AIM_HEIGHT;

  for (let i = sp.count - 1; i >= 0; i--) {
    if (sp.pull[i] === 0) {
      const gx = sp.x[i] - m.x;
      const gz = sp.z[i] - m.z;
      // Not near a jam elite: what it guards stays put until it is gone or a loop sweeps it up.
      if (gx * gx + gz * gz <= magnet2 && !jammed(w, sp.x[i], sp.z[i])) sp.pull[i] = 1;
    }
    if (sp.pull[i] === 0) continue;
    const dx = m.x - sp.x[i];
    const dy = ay - sp.y[i];
    const dz = m.z - sp.z[i];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > fly) {
      const k = fly / dist;
      sp.x[i] += dx * k;
      sp.y[i] += dy * k;
      sp.z[i] += dz * k;
    } else {
      sp.x[i] = m.x;
      sp.y[i] = ay;
      sp.z[i] = m.z;
    }
    const tx = m.x - sp.x[i];
    const ty = ay - sp.y[i];
    const tz = m.z - sp.z[i];
    if (tx * tx + ty * ty + tz * tz <= TAKE_RADIUS * TAKE_RADIUS) {
      p.xp += sp.value[i];
      emitFx(w, FX_SPARK, sp.x[i], sp.y[i], sp.z[i], sp.value[i]);
      removeSpark(w, i);
    }
  }

  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpForLevel(p.level);
    // Every level is a card to choose.
    queueOffer(w, OFFER_LEVEL);
    emitFx(w, FX_LEVEL_UP, m.x, m.y, m.z, p.level);
  }
}
