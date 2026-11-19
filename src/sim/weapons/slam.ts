/**
 * Slam: a shockwave round the mover every few seconds. Everything in the ring is hit and the light
 * ones are thrown outward. Where the mover is and nothing else: riding, standing or flying, the
 * wave is the same.
 */
import { W_SLAM } from '../arsenal';
import { DT } from '../constants';
import { dcos, dsin } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import {
  damageEnemy,
  emitFx,
  FX_SLAM,
  KINDS,
  MAX_ENEMY_RADIUS,
  queryEnemies,
  shoveEnemy,
  SPAWN_TICKS,
  WEAPON_MEM,
  WEIGHT_LIGHT,
  type World,
} from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** The Slam's numbers. Arrays are by weapon level 1..5. */
export const SLAM = {
  /** Seconds between waves, before Haste. */
  wait: [4, 3.6, 3.2, 2.9, 2.6],
  /** The wave's radius, m, times area. */
  radius: [4.5, 4.8, 5.1, 5.5, 6],
  /** Damage to everything in the wave, before might. */
  damage: [22, 28, 35, 43, 52],
  /** How hard light enemies are thrown out of the wave, m/s, and how long they stay harmless, ticks. */
  throwSpeed: 11,
  throwStun: 30,
} as const;

/** mem: seconds waited since the last wave. */
const MEM_WAITED = 0;

/** The wave's radius at `level` (1..5) with `area`, m. */
export function slamRadius(level: number, area: number): number {
  if (level <= 0) return 0;
  return SLAM.radius[(level > 5 ? 5 : level) - 1] * area;
}

function wave(w: World, s: SimState, level: number): void {
  const m = s.mover;
  const st = w.player.stats;
  const r = slamRadius(level, st.area);
  const dmg = SLAM.damage[level - 1] * powerOf(st, m.gear);
  const h = w.horde;
  const n = queryEnemies(w, m.x, m.z, r + MAX_ENEMY_RADIUS, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const kind = KINDS[h.kind[i]];
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const reach = r + kind.radius;
    if (dx * dx + dz * dz > reach * reach) continue;
    // The wave lands on many at once: its own effect marks it, not one hit number each.
    damageEnemy(w, i, dmg, true);
    if (h.hp[i] > 0 && kind.weight === WEIGHT_LIGHT) {
      // Straight out from the mover; one standing on the very spot goes along the heading.
      if (dx * dx + dz * dz > 1e-8) shoveEnemy(w, i, dx, dz, SLAM.throwSpeed, SLAM.throwStun);
      else shoveEnemy(w, i, dsin(m.heading), dcos(m.heading), SLAM.throwSpeed, SLAM.throwStun);
    }
  }
  emitFx(w, FX_SLAM, m.x, m.y, m.z, r);
}

export function stepSlam(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const at = W_SLAM * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(SLAM.wait[level - 1], w.player.stats);
  w.mem[at] += DT;
  if (!isReady(w.mem[at], wait)) return;
  w.mem[at] = afterShot(w.mem[at], wait);
  wave(w, s, level);
}
