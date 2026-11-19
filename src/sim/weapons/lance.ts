/**
 * Lance: a beam straight ahead of the mover, always on. Everything in it burns a little every tenth
 * of a second. Point it at a crowd; riding, standing or flying, it burns the same.
 */
import { W_LANCE } from '../arsenal';
import { DT } from '../constants';
import { dcos, dsin } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { damageEnemy, KINDS, MAX_ENEMY_RADIUS, queryEnemies, SPAWN_TICKS, WEAPON_MEM, type World } from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** The Lance's numbers. Arrays are by weapon level 1..5. */
export const LANCE = {
  /** Beam length, m, times area. */
  length: [7, 8, 9, 10, 11],
  /** Damage per second to everything in the beam, before might and Haste. */
  dps: [14, 18, 22, 27, 32],
  /** How far either side of the beam's line it reaches, m, times area. */
  halfWidth: 0.7,
  /** Damage lands once every this many seconds, before Haste (Haste makes it land more often). */
  wait: 0.1,
} as const;

/** mem: seconds waited since the beam last burned. */
const MEM_WAITED = 0;

/** The beam's length now, m: 0 when the player does not carry it. For the renderer and tests. */
export function lanceLength(w: World, _s?: SimState): number {
  const level = w.player.loadout.weaponLevel[W_LANCE];
  if (level <= 0) return 0;
  return LANCE.length[(level > 5 ? 5 : level) - 1] * w.player.stats.area;
}

export function stepLance(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const st = w.player.stats;
  const at = W_LANCE * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(LANCE.wait, st);
  w.mem[at] += DT;
  if (!isReady(w.mem[at], wait)) return;
  w.mem[at] = afterShot(w.mem[at], wait);

  const len = lanceLength(w, s);
  const m = s.mover;
  const half = LANCE.halfWidth * st.area;
  // Each burn is a tenth of a second's worth at the table rate; Haste burns more often.
  const dmg = LANCE.dps[level - 1] * powerOf(st, m.gear) * LANCE.wait;
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
