/**
 * Bumper: a hoop of plates round the rider. Every few seconds it pulses: everything within reach
 * is hurt, and the light ones are thrown back and left harmless for a moment. Its other half (what
 * a hit on the player throws back is hurt too) is in the player's stats and happens in contact.
 *
 * The defensive weapon: less damage than the Slam, in a smaller ring, more often, with a harder
 * shove.
 */
import { W_BUMPER } from '../arsenal';
import { DT } from '../constants';
import { BUMPER } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import {
  damageEnemy,
  emitFx,
  FX_BUMP,
  KINDS,
  queryEnemies,
  shoveEnemy,
  SPAWN_TICKS,
  WEAPON_MEM,
  WEIGHT_HEAVY,
  type World,
} from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** mem: seconds waited since the last pulse. */
const MEM_WAITED = 0;

/** The pulse's reach at `level` with the build's area, m: 0 when the player does not carry it. */
export function bumperReach(level: number, area: number): number {
  if (level <= 0) return 0;
  return BUMPER.pulseReach[(level > 5 ? 5 : level) - 1] * area;
}

function pulse(w: World, s: SimState, level: number): void {
  const m = s.mover;
  const h = w.horde;
  const st = w.player.stats;
  const reach = bumperReach(level, st.area);
  const damage = BUMPER.pulseDamage[level - 1] * st.might;
  emitFx(w, FX_BUMP, m.x, m.y, m.z, reach);
  const n = queryEnemies(w, m.x, m.z, reach, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const kind = KINDS[h.kind[i]];
    damageEnemy(w, i, damage, true);
    if (kind.weight === WEIGHT_HEAVY || kind.boss === true) continue;
    shoveEnemy(w, i, h.x[i] - m.x, h.z[i] - m.z, BUMPER.pulseThrow, BUMPER.pulseStun);
  }
}

export function stepBumper(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const at = W_BUMPER * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(BUMPER.pulseWait[level - 1], w.player.stats);
  w.mem[at] += DT;
  if (!isReady(w.mem[at], wait)) return;
  w.mem[at] = afterShot(w.mem[at], wait);
  pulse(w, s, level);
}
