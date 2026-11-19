/**
 * Slipstream: a draft always trails the mover, straight back from its heading. Sparks caught in it
 * fly to the player, and small enemies in it are dragged in toward the line straight behind the
 * mover, which is where the Wake burns. Every gust (a fixed beat, quicker with Haste) scours
 * everything in the draft for a little damage: what chases you is worn down.
 */
import { DT } from '../constants';
import { dcos, dsin, PI } from '../math';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { W_SLIPSTREAM } from '../arsenal';
import { damageEnemy, KINDS, queryEnemies, SPAWN_TICKS, WEAPON_MEM, WEIGHT_LIGHT, type World } from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** The Slipstream's numbers. Arrays are by weapon level 1..5. */
export const SLIPSTREAM = {
  /** Length of the draft behind the mover, m, times area. */
  length: [8, 11, 14, 18, 22],
  /** How fast light enemies in it are dragged toward the line behind the mover, m/s. */
  draw: [2, 2.5, 3, 3.5, 4],
  /** Half the cone's opening, degrees. */
  halfAngleDegrees: 25,
  /** Seconds between gusts, before Haste, and a gust's damage to everything in the draft, before might. */
  gustWait: 0.3,
  gustDamage: [1.5, 2, 2.5, 3.2, 4],
} as const;

/** mem: seconds waited since the last gust. */
const MEM_WAITED = 0;

const HALF_ANGLE = (SLIPSTREAM.halfAngleDegrees * PI) / 180;
const TAN_HALF = dsin(HALF_ANGLE) / dcos(HALF_ANGLE);

/** The draft's length at `level`, m: 0 when the player does not carry it. For the renderer and tests. */
export function slipstreamLength(w: World, _s: SimState, level: number): number {
  if (level <= 0) return 0;
  return SLIPSTREAM.length[(level > 5 ? 5 : level) - 1] * w.player.stats.area;
}

export function stepSlipstream(w: World, s: SimState, terrain: Terrain, level: number): void {
  const len = slipstreamLength(w, s, level);
  if (len <= 0) return;
  const m = s.mover;
  // Straight back from the mover, and the side to the right of that.
  const bx = -dsin(m.heading);
  const bz = -dcos(m.heading);
  const px = -bz;
  const pz = bx;

  const sp = w.sparks;
  for (let i = 0; i < sp.count; i++) {
    if (sp.pull[i] !== 0) continue;
    const dx = sp.x[i] - m.x;
    const dz = sp.z[i] - m.z;
    const along = dx * bx + dz * bz;
    if (along <= 0 || along > len) continue;
    const side = dx * px + dz * pz;
    if (side * side > along * along * TAN_HALF * TAN_HALF) continue;
    sp.pull[i] = 1;
  }

  // Is this tick a gust?
  const at = W_SLIPSTREAM * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(SLIPSTREAM.gustWait, w.player.stats);
  w.mem[at] += DT;
  const gust = isReady(w.mem[at], wait);
  if (gust) w.mem[at] = afterShot(w.mem[at], wait);
  const damage = SLIPSTREAM.gustDamage[level - 1] * w.player.stats.might;

  const h = w.horde;
  const step = SLIPSTREAM.draw[level - 1] * DT;
  const n = queryEnemies(w, m.x, m.z, len, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const along = dx * bx + dz * bz;
    if (along <= 0 || along > len) continue;
    const side = dx * px + dz * pz;
    const limit = along * TAN_HALF;
    if (side > limit || side < -limit) continue;
    if (gust) damageEnemy(w, i, damage, true);
    // Only the light ones are dragged.
    if (KINDS[h.kind[i]].weight !== WEIGHT_LIGHT) continue;
    // Sideways toward the line, never past it.
    const move = side > step ? step : side < -step ? -step : side;
    h.x[i] -= px * move;
    h.z[i] -= pz * move;
    h.y[i] = terrain.heightAt(h.x[i], h.z[i]);
  }
}
