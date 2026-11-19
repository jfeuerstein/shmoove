/**
 * Slam: a shockwave where the mover lands. Short hops barely tickle; a long flight off a crest and
 * a hard landing flatten a crowd. Taking it is a reason to hunt air.
 */
import { clamp } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import { EV_LAND, type SimState } from '../types';
import {
  damageEnemy,
  emitFx,
  FX_SLAM,
  KINDS,
  MAX_ENEMY_RADIUS,
  queryEnemies,
  shoveEnemy,
  SPAWN_TICKS,
  WEIGHT_LIGHT,
  type World,
} from '../world';

/** The Slam's numbers. Arrays are by weapon level 1..5. */
export const SLAM = {
  /** Damage at the reference scale of 1, before the flight scale and gear power. */
  damage: [30, 40, 52, 66, 82],
  /** The shortest flight that slams, ticks. */
  minAir: 12,
  /** A flight this long hits at the full scale, ticks. */
  fullAir: 60,
  /** Damage scale at the shortest and at the full flight. */
  scaleMin: 0.6,
  scaleMax: 1.6,
  /** Radius: base (m), per tick of flight, per m/s of impact, all times area, and its cap (m). */
  radiusBase: 2.5,
  radiusPerAir: 0.06,
  radiusPerImpact: 0.15,
  radiusMax: 9,
  /** How hard light enemies are thrown out of the wave, m/s, and how long they stay harmless, ticks. */
  throwSpeed: 11,
  throwStun: 30,
} as const;

/** The shockwave's radius for a landing after `air` ticks at `impact` m/s, with `area`. */
export function slamRadius(air: number, impact: number, area: number): number {
  const r = (SLAM.radiusBase + SLAM.radiusPerAir * air + SLAM.radiusPerImpact * impact) * area;
  return r > SLAM.radiusMax ? SLAM.radiusMax : r;
}

/** The damage scale for a flight of `air` ticks: 0 below the shortest flight that slams. */
export function slamScale(air: number): number {
  if (air < SLAM.minAir) return 0;
  const t = clamp((air - SLAM.minAir) / (SLAM.fullAir - SLAM.minAir), 0, 1);
  return SLAM.scaleMin + (SLAM.scaleMax - SLAM.scaleMin) * t;
}

export function stepSlam(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0 || (s.events & EV_LAND) === 0) return;
  const m = s.mover;
  const scale = slamScale(m.lastAir);
  if (scale <= 0) return;
  const st = w.player.stats;
  const r = slamRadius(m.lastAir, m.impact, st.area);
  const dmg = SLAM.damage[level - 1] * scale * powerOf(st, m.gear);
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
      // Straight out from where the mover landed; one standing on the spot goes along the heading.
      const l2 = dx * dx + dz * dz;
      if (l2 > 1e-8) shoveEnemy(w, i, dx, dz, SLAM.throwSpeed, SLAM.throwStun);
      else shoveEnemy(w, i, m.vx, m.vz, SLAM.throwSpeed, SLAM.throwStun);
    }
  }
  emitFx(w, FX_SLAM, m.x, m.y, m.z, r);
}
