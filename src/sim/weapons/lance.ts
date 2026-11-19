/**
 * Lance: a beam ahead of the mover, on only while it is tucked in gear 2 or higher, longer the
 * higher the gear. Carving turns it off: the way to use it is to point at a crowd and commit.
 */
import { W_LANCE } from '../arsenal';
import { TICK_HZ } from '../constants';
import { dcos, dsin } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { damageEnemy, KINDS, MAX_ENEMY_RADIUS, queryEnemies, SPAWN_TICKS, WEAPON_MEM, type World } from '../world';

/** The Lance's numbers. Arrays are by weapon level 1..5. */
export const LANCE = {
  /** Beam length before the gear's share, m, times area. */
  length: [6, 7, 8, 9, 10],
  /** Damage per second to everything in the beam, before gear power. */
  dps: [14, 18, 22, 27, 32],
  /** Beam length added per gear (gear 2 adds twice this), m, times area. */
  lengthPerGear: 1.5,
  /** How far either side of the beam's line it reaches, m, times area. */
  halfWidth: 0.7,
  /** Damage lands once every this many ticks. */
  every: 6,
  /** The lowest gear the beam works in. */
  minGear: 2,
} as const;

const MEM_WAIT = 0;

/** The beam's length now, m: 0 when it is off. For the renderer and tests. */
export function lanceLength(w: World, s: SimState): number {
  const level = w.player.loadout.weaponLevel[W_LANCE];
  const m = s.mover;
  if (level <= 0 || !m.tucked || m.gear < LANCE.minGear) return 0;
  return (LANCE.length[(level > 5 ? 5 : level) - 1] + LANCE.lengthPerGear * m.gear) * w.player.stats.area;
}

export function stepLance(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0) return;
  // The clock runs whether the beam is on or not, so flicking the tuck cannot hit faster.
  const at = W_LANCE * WEAPON_MEM + MEM_WAIT;
  if (w.mem[at] > 0) w.mem[at]--;
  const len = lanceLength(w, s);
  if (len <= 0 || w.mem[at] > 0) return;
  w.mem[at] = LANCE.every;

  const m = s.mover;
  const st = w.player.stats;
  const half = LANCE.halfWidth * st.area;
  const dmg = (LANCE.dps[level - 1] * powerOf(st, m.gear) * LANCE.every) / TICK_HZ;
  const fx = dsin(m.heading);
  const fz = dcos(m.heading);
  const cx = m.x + fx * len * 0.5;
  const cz = m.z + fz * len * 0.5;
  const h = w.horde;
  const n = queryEnemies(w, cx, cz, len * 0.5 + half + MAX_ENEMY_RADIUS, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const r = KINDS[h.kind[i]].radius;
    const along = dx * fx + dz * fz;
    if (along < 0 || along > len + r) continue;
    const side = dx * fz - dz * fx;
    if (side > half + r || side < -half - r) continue;
    // A steady beam on many at once: quiet, like the Wake's burn.
    damageEnemy(w, i, dmg, true);
  }
}
