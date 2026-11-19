/**
 * Crumbs: a mine dropped at the mover's feet every second or so. It arms after a moment and goes
 * off when an enemy steps near it. The horde chasing you walks into what you left behind.
 */
import { W_CRUMBS } from '../arsenal';
import { DT } from '../constants';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import {
  addZone,
  damageEnemy,
  emitFx,
  FX_BLAST,
  KINDS,
  MAX_ENEMY_RADIUS,
  queryEnemies,
  removeZone,
  SPAWN_TICKS,
  WEAPON_MEM,
  ZONE_MINE,
  type World,
} from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** The Crumbs' numbers. Arrays are by weapon level 1..5. */
export const CRUMBS = {
  /** Seconds between mines, before Haste. */
  wait: [1.6, 1.4, 1.2, 1.05, 0.9],
  /** Damage of a blast, before might (the might when the mine was dropped). */
  damage: [20, 25, 31, 38, 46],
  /** Blast radius, m, times area. */
  radius: [3, 3.3, 3.6, 4, 4.5],
  /** A mine is armed this many ticks after it is dropped. */
  armTicks: 20,
  /** A mine is gone this many ticks after it is dropped. */
  lifeTicks: 600,
  /** Most mines down at once: a new one takes the oldest one's place. */
  maxMines: 12,
  /** An enemy this close to an armed mine (plus its radius) sets it off, m. */
  trigger: 1.2,
} as const;

/** mem: seconds waited since the last mine. */
const MEM_WAITED = 0;

/** Remove the oldest mine. */
function dropOldest(w: World): void {
  const zn = w.zones;
  let oldest = -1;
  for (let i = 0; i < zn.count; i++) {
    if (zn.kind[i] !== ZONE_MINE) continue;
    if (oldest < 0 || zn.age[i] > zn.age[oldest]) oldest = i;
  }
  if (oldest >= 0) removeZone(w, oldest);
}

function layMine(w: World, s: SimState, terrain: Terrain, level: number): void {
  const zn = w.zones;
  let mines = 0;
  for (let i = 0; i < zn.count; i++) if (zn.kind[i] === ZONE_MINE) mines++;
  if (mines >= CRUMBS.maxMines) dropOldest(w);
  const m = s.mover;
  const st = w.player.stats;
  addZone(
    w,
    ZONE_MINE,
    m.x,
    terrain.heightAt(m.x, m.z),
    m.z,
    CRUMBS.radius[level - 1] * st.area,
    CRUMBS.lifeTicks,
    CRUMBS.damage[level - 1] * powerOf(st, m.gear),
  );
}

/** Is a living, risen enemy close enough to set off the mine at (x, z)? */
function tripped(w: World, x: number, z: number): boolean {
  const h = w.horde;
  const n = queryEnemies(w, x, z, CRUMBS.trigger + MAX_ENEMY_RADIUS, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const r = CRUMBS.trigger + KINDS[h.kind[i]].radius;
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}

function blast(w: World, k: number): void {
  const zn = w.zones;
  const h = w.horde;
  const x = zn.x[k];
  const z = zn.z[k];
  const r = zn.r[k];
  const n = queryEnemies(w, x, z, r + MAX_ENEMY_RADIUS, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const reach = r + KINDS[h.kind[i]].radius;
    if (dx * dx + dz * dz > reach * reach) continue;
    damageEnemy(w, i, zn.power[k], true);
  }
  emitFx(w, FX_BLAST, x, zn.y[k], z, r);
}

export function stepCrumbs(w: World, s: SimState, terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const zn = w.zones;
  for (let i = zn.count - 1; i >= 0; i--) {
    if (zn.kind[i] !== ZONE_MINE) continue;
    if (zn.age[i] < 65535) zn.age[i]++;
    if (zn.life[i] <= 1) {
      removeZone(w, i);
      continue;
    }
    zn.life[i]--;
    if (zn.age[i] >= CRUMBS.armTicks && tripped(w, zn.x[i], zn.z[i])) {
      blast(w, i);
      removeZone(w, i);
    }
  }

  const at = W_CRUMBS * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(CRUMBS.wait[level - 1], w.player.stats);
  w.mem[at] += DT;
  if (isReady(w.mem[at], wait)) {
    w.mem[at] = afterShot(w.mem[at], wait);
    layMine(w, s, terrain, level);
  }
}
