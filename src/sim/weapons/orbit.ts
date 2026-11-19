/**
 * Orbit: discs circling the mover at a steady turn, all the time. Each disc strikes what it passes,
 * then waits a moment before it can strike again. Riding or standing, they sweep the same.
 */
import { W_ORBIT } from '../arsenal';
import { DT } from '../constants';
import { dcos, dsin, TAU } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState, Vec3 } from '../types';
import { damageEnemy, KINDS, MAX_ENEMY_RADIUS, queryEnemies, SPAWN_TICKS, WEAPON_MEM, type World } from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** The Orbit's numbers. Arrays are by weapon level 1..5. */
export const ORBIT = {
  discs: [2, 2, 3, 3, 4],
  /** Damage per strike, before might. */
  damage: [8, 10, 12, 15, 18],
  /** Distance from the mover to each disc, m, times area. */
  radius: 2.6,
  /** How fast the discs turn round the mover, rad/s. */
  turnRate: 2.2,
  /** A disc strikes what is within this of it, plus the enemy's radius, m. */
  reach: 0.7,
  /** Each disc waits this long after a strike before it can strike again, s, before Haste. */
  wait: 0.2,
  /** The discs ride this high above the mover's feet, m (for drawing). */
  height: 0.8,
} as const;

const MAX_DISCS = 4;
/** mem: the discs' angle, the disc whose turn it is, then the seconds each disc has waited since it last struck. */
const MEM_ANGLE = 0;
const MEM_TURN = 1;
const MEM_WAITED = 2;
const TURN_PER_TICK = ORBIT.turnRate * DT;

function base(): number {
  return W_ORBIT * WEAPON_MEM;
}

/** The disc count at `level` (0 at level 0). */
export function orbitDiscCount(level: number): number {
  return level <= 0 ? 0 : ORBIT.discs[(level > 5 ? 5 : level) - 1];
}

/**
 * The position of disc `k` into `out`, for the renderer and tests. Returns false (and leaves `out`
 * alone) if the player does not carry that many discs.
 */
export function orbitDisc(w: World, s: SimState, k: number, out: Vec3): boolean {
  const n = orbitDiscCount(w.player.loadout.weaponLevel[W_ORBIT]);
  if (k < 0 || k >= n) return false;
  const m = s.mover;
  const a = w.mem[base() + MEM_ANGLE] + (k * TAU) / n;
  const r = ORBIT.radius * w.player.stats.area;
  out.x = m.x + dsin(a) * r;
  out.y = m.y + ORBIT.height;
  out.z = m.z + dcos(a) * r;
  return true;
}

/** Strike everything within reach of the point; returns how many were struck. */
function strike(w: World, x: number, z: number, dmg: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, ORBIT.reach + MAX_ENEMY_RADIUS, w.nearA);
  let hit = 0;
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const reach = ORBIT.reach + KINDS[h.kind[i]].radius;
    if (dx * dx + dz * dz > reach * reach) continue;
    damageEnemy(w, i, dmg);
    hit++;
  }
  return hit;
}

export function stepOrbit(w: World, s: SimState, _terrain: Terrain, level: number): void {
  const n = orbitDiscCount(level);
  if (n === 0) return;
  const mem = w.mem;
  const b = base();
  const st = w.player.stats;
  const wait = waitOf(ORBIT.wait, st);
  // A disc that has waited its time stays ready until it has something to strike, banking at most
  // the tick that ran over (so a wait that is not a whole number of ticks still averages out).
  const most = wait + DT;
  for (let k = 0; k < MAX_DISCS; k++) {
    const t = mem[b + MEM_WAITED + k] + DT;
    mem[b + MEM_WAITED + k] = t > most ? most : t;
  }

  let a = mem[b + MEM_ANGLE] + TURN_PER_TICK;
  if (a >= TAU) a -= TAU * Math.floor(a / TAU);
  mem[b + MEM_ANGLE] = a;

  // The discs take turns: the first to look is the one after the last that struck, and at most one
  // strikes in a tick. Each then waits out its own time.
  const m = s.mover;
  const dmg = ORBIT.damage[level - 1] * powerOf(st, m.gear);
  const r = ORBIT.radius * st.area;
  const first = mem[b + MEM_TURN] % n;
  for (let j = 0; j < n; j++) {
    const k = (first + j) % n;
    const at = b + MEM_WAITED + k;
    if (!isReady(mem[at], wait)) continue;
    const da = a + (k * TAU) / n;
    if (strike(w, m.x + dsin(da) * r, m.z + dcos(da) * r, dmg) > 0) {
      mem[at] = afterShot(mem[at], wait);
      mem[b + MEM_TURN] = (k + 1) % n;
      break;
    }
  }
}
