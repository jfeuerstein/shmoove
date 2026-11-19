/**
 * Slipstream: from gear 2 up, a draft trails the mover. Sparks caught in it fly to the player, and
 * small enemies in it are dragged in toward the line straight behind the mover, which is where the
 * Wake burns. It does no damage of its own: it feeds the trail.
 */
import { DT } from '../constants';
import { dcos, dsin, PI } from '../math';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { KINDS, queryEnemies, SPAWN_TICKS, WEIGHT_LIGHT, type World } from '../world';

/** The Slipstream's numbers. Arrays are by weapon level 1..5. */
export const SLIPSTREAM = {
  /** Length of the draft behind the mover, m, times area. */
  length: [8, 10, 12, 14, 16],
  /** How fast light enemies in it are dragged toward the line behind the mover, m/s. */
  draw: [2, 2.5, 3, 3.5, 4],
  /** Half the cone's opening, degrees. */
  halfAngleDegrees: 25,
  /** The lowest gear with a draft. */
  minGear: 2,
} as const;

const HALF_ANGLE = (SLIPSTREAM.halfAngleDegrees * PI) / 180;
const TAN_HALF = dsin(HALF_ANGLE) / dcos(HALF_ANGLE);

/** The draft's length now, m: 0 when there is none. For the renderer and tests. */
export function slipstreamLength(w: World, s: SimState, level: number): number {
  if (level <= 0 || s.mover.gear < SLIPSTREAM.minGear) return 0;
  return SLIPSTREAM.length[level - 1] * w.player.stats.area;
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

  const h = w.horde;
  const step = SLIPSTREAM.draw[level - 1] * DT;
  const n = queryEnemies(w, m.x, m.z, len, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    if (KINDS[h.kind[i]].weight !== WEIGHT_LIGHT) continue;
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const along = dx * bx + dz * bz;
    if (along <= 0 || along > len) continue;
    const side = dx * px + dz * pz;
    const limit = along * TAN_HALF;
    if (side > limit || side < -limit) continue;
    // Sideways toward the line, never past it.
    const move = side > step ? step : side < -step ? -step : side;
    h.x[i] -= px * move;
    h.z[i] -= pz * move;
    h.y[i] = terrain.heightAt(h.x[i], h.z[i]);
  }
}
