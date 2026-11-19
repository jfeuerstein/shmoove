/**
 * Skipper: every hop throws a stone along the heading, and a clean hop throws two. A stone hits the
 * first enemy in its way, then skips on to the nearest other one ahead of it (never back the way it
 * came), and again, until its skips run out. Hop rhythm is the fire rate.
 */
import { DT } from '../constants';
import { dcos, dsin, PI } from '../math';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import { EV_CLEAN_HOP, EV_HOP, type SimState } from '../types';
import {
  damageEnemy,
  emitFx,
  FX_STONE,
  KINDS,
  MAX_ENEMY_RADIUS,
  MAX_SHOTS,
  queryEnemies,
  removeShot,
  SHOT_STONE,
  SPAWN_TICKS,
  type World,
} from '../world';

/** The Skipper's numbers. Arrays are by weapon level 1..5. */
export const SKIPPER = {
  /** Damage per hit, before gear power. */
  damage: [12, 15, 19, 24, 30],
  /** Skips after the first hit. */
  skips: [2, 3, 3, 4, 5],
  /** A stone flies at the mover's speed plus this, m/s. */
  speedBonus: 14,
  /** Height above the ground, m. */
  height: 0.6,
  /** Most ticks a stone flies. */
  life: 90,
  /** A skip looks for the nearest other enemy within this of the one just hit, and not behind, m. */
  skipRange: 8,
  /** The angle between the two stones of a clean hop, degrees. */
  fanDegrees: 12,
  /** A stone touches an enemy this far outside its body, m. */
  pad: 0.3,
} as const;

const HALF_FAN = ((SKIPPER.fanDegrees / 2) * PI) / 180;
/** Gap left between a stone that skips and the body it skipped off, m. */
const CLEAR = 0.05;

function throwStone(w: World, s: SimState, terrain: Terrain, yaw: number, dmg: number, skips: number): void {
  const sh = w.shots;
  if (sh.count >= MAX_SHOTS) return;
  const m = s.mover;
  const speed = Math.sqrt(m.vx * m.vx + m.vz * m.vz) + SKIPPER.speedBonus;
  const i = sh.count++;
  sh.x[i] = m.x;
  sh.z[i] = m.z;
  sh.y[i] = terrain.heightAt(m.x, m.z) + SKIPPER.height;
  sh.vx[i] = dsin(yaw) * speed;
  sh.vy[i] = 0;
  sh.vz[i] = dcos(yaw) * speed;
  sh.life[i] = SKIPPER.life;
  sh.damage[i] = dmg;
  sh.kind[i] = SHOT_STONE;
  sh.aux[i] = skips;
  emitFx(w, FX_STONE, m.x, sh.y[i], m.z, dmg);
}

/**
 * The first living, risen enemy the segment (x0, z0) + t (dx, dz), t in [0, 1], passes through;
 * -1 if none.
 */
function firstInWay(w: World, x0: number, z0: number, dx: number, dz: number): number {
  const h = w.horde;
  const len2 = dx * dx + dz * dz;
  const half = Math.sqrt(len2) * 0.5;
  const n = queryEnemies(w, x0 + dx * 0.5, z0 + dz * 0.5, half + MAX_ENEMY_RADIUS + SKIPPER.pad, w.nearA);
  let best = -1;
  let bestT = Infinity;
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const ex = h.x[i] - x0;
    const ez = h.z[i] - z0;
    let t = len2 > 1e-12 ? (ex * dx + ez * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ex - dx * t;
    const cz = ez - dz * t;
    const r = KINDS[h.kind[i]].radius + SKIPPER.pad;
    if (cx * cx + cz * cz > r * r) continue;
    if (t < bestT || (t === bestT && i < best)) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

/**
 * The nearest living, risen enemy other than `not` within the skip range of it and not behind the
 * stone's travel (vx, vz), so a stone never skips back the way it came; -1 if none.
 */
function skipTarget(w: World, not: number, vx: number, vz: number): number {
  const h = w.horde;
  const x = h.x[not];
  const z = h.z[not];
  const n = queryEnemies(w, x, z, SKIPPER.skipRange, w.nearA);
  let best = -1;
  let bestD = Infinity;
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (i === not || h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    if (dx * vx + dz * vz < 0) continue;
    const d = dx * dx + dz * dz;
    if (d < bestD || (d === bestD && i < best)) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function stepSkipper(w: World, s: SimState, terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const m = s.mover;
  if ((s.events & EV_HOP) !== 0) {
    const dmg = SKIPPER.damage[level - 1] * powerOf(w.player.stats, m.gear);
    const skips = SKIPPER.skips[level - 1];
    if ((s.events & EV_CLEAN_HOP) !== 0) {
      throwStone(w, s, terrain, m.heading - HALF_FAN, dmg, skips);
      throwStone(w, s, terrain, m.heading + HALF_FAN, dmg, skips);
    } else {
      throwStone(w, s, terrain, m.heading, dmg, skips);
    }
  }

  const sh = w.shots;
  const h = w.horde;
  for (let i = sh.count - 1; i >= 0; i--) {
    // The shot pool is shared; only stones are flown here.
    if (sh.kind[i] !== SHOT_STONE) continue;
    if (--sh.life[i] === 0) {
      removeShot(w, i);
      continue;
    }
    const dx = sh.vx[i] * DT;
    const dz = sh.vz[i] * DT;
    const hit = firstInWay(w, sh.x[i], sh.z[i], dx, dz);
    if (hit < 0) {
      sh.x[i] += dx;
      sh.z[i] += dz;
      sh.y[i] = terrain.heightAt(sh.x[i], sh.z[i]) + SKIPPER.height;
      continue;
    }
    damageEnemy(w, hit, sh.damage[i]);
    const next = sh.aux[i] > 0 ? skipTarget(w, hit, sh.vx[i], sh.vz[i]) : -1;
    if (next < 0) {
      removeShot(w, i);
      continue;
    }
    // Off toward the next, starting just clear of the one it hit so it cannot hit that one again.
    sh.aux[i]--;
    let ux = h.x[next] - h.x[hit];
    let uz = h.z[next] - h.z[hit];
    const l = Math.sqrt(ux * ux + uz * uz);
    if (l > 1e-6) {
      ux /= l;
      uz /= l;
    } else {
      const v = Math.sqrt(sh.vx[i] * sh.vx[i] + sh.vz[i] * sh.vz[i]);
      ux = sh.vx[i] / v;
      uz = sh.vz[i] / v;
    }
    const speed = Math.sqrt(sh.vx[i] * sh.vx[i] + sh.vz[i] * sh.vz[i]);
    const off = KINDS[h.kind[hit]].radius + SKIPPER.pad + CLEAR;
    sh.x[i] = h.x[hit] + ux * off;
    sh.z[i] = h.z[hit] + uz * off;
    sh.y[i] = terrain.heightAt(sh.x[i], sh.z[i]) + SKIPPER.height;
    sh.vx[i] = ux * speed;
    sh.vz[i] = uz * speed;
  }
}
