/**
 * Seekers: darts that fire themselves every few metres travelled. Standing still fires nothing;
 * speed is the fire rate, and the gear at the moment of firing is the damage.
 */
import { powerOf } from './stats';
import { DT } from './constants';
import { dcos, dsin } from './math';
import type { Terrain } from './terrain';
import type { SimState } from './types';
import {
  damageEnemy,
  emitFx,
  FX_SHOT,
  KINDS,
  MAX_ENEMY_RADIUS,
  MAX_SHOTS,
  queryEnemies,
  removeShot,
  SHOT_DART,
  SPAWN_TICKS,
  type World,
} from './world';

/** By weapon level 1..5. */
export const SEEKERS = {
  /** Metres travelled between volleys. */
  interval: [12, 10, 9, 8, 7],
  /** Darts per volley. */
  darts: [1, 2, 2, 3, 4],
  /** Damage per dart before gear power. */
  damage: [8, 10, 12, 14, 17],
} as const;

/** An enemy must be this close to the mover to be shot at, m. */
export const SEEKER_RANGE = 28;
export const DART_SPEED = 32;
export const DART_LIFE_TICKS = 90;
/** A dart steers at enemies this close to itself, m. */
const SEEK_RANGE = 12;
const TURN_RATE = 6;
const HOLD_HEIGHT = 1;
const HIT_PAD = 0.4;
const MAX_DARTS = 4;
/** Widest enemy radius plus the hit pad: how far to look for something a dart has reached. */
const HIT_QUERY = MAX_ENEMY_RADIUS + HIT_PAD;

const COS_TURN = dcos(TURN_RATE * DT);
const SIN_TURN = dsin(TURN_RATE * DT);

/** Targets picked for the volley being fired. */
const picked = new Int16Array(MAX_DARTS);

function live(w: World, i: number): boolean {
  return w.horde.hp[i] > 0 && w.horde.age[i] >= SPAWN_TICKS;
}

/** Fill `picked` with up to `want` of the nearest distinct targets to (x, z); returns how many. */
function pickTargets(w: World, x: number, z: number, want: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, SEEKER_RANGE, w.nearA);
  let got = 0;
  while (got < want) {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const i = w.nearA[k];
      if (!live(w, i)) continue;
      let taken = false;
      for (let q = 0; q < got; q++) if (picked[q] === i) taken = true;
      if (taken) continue;
      const dx = h.x[i] - x;
      const dz = h.z[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) break;
    picked[got++] = best;
  }
  return got;
}

/** Fire a volley. False if there was nothing to shoot at. */
function fire(w: World, s: SimState, level: number): boolean {
  const m = s.mover;
  const h = w.horde;
  const want = SEEKERS.darts[level - 1];
  const got = pickTargets(w, m.x, m.z, want);
  if (got === 0) return false;
  const dmg = SEEKERS.damage[level - 1] * powerOf(w.player.stats, m.gear);
  const sh = w.shots;
  for (let q = 0; q < want; q++) {
    if (sh.count >= MAX_SHOTS) break;
    const t = picked[q % got];
    const ox = m.x;
    const oy = m.y + 1;
    const oz = m.z;
    let dx = h.x[t] - ox;
    let dy = h.y[t] + HOLD_HEIGHT - oy;
    let dz = h.z[t] - oz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-6) {
      dx = 0;
      dy = 0;
      dz = 1;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const i = sh.count++;
    sh.x[i] = ox;
    sh.y[i] = oy;
    sh.z[i] = oz;
    sh.vx[i] = dx * DART_SPEED;
    sh.vy[i] = dy * DART_SPEED;
    sh.vz[i] = dz * DART_SPEED;
    sh.life[i] = DART_LIFE_TICKS;
    sh.damage[i] = dmg;
    sh.kind[i] = SHOT_DART;
    sh.aux[i] = 0;
    emitFx(w, FX_SHOT, ox, oy, oz, dmg);
  }
  return true;
}

/** Nearest risen living enemy within SEEK_RANGE of a dart, or -1. */
function seekTarget(w: World, x: number, z: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, SEEK_RANGE, w.nearA);
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const i = w.nearA[k];
    if (!live(w, i)) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A living, risen enemy the point has reached, or -1. */
function reached(w: World, x: number, z: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, HIT_QUERY, w.nearA);
  for (let k = 0; k < n; k++) {
    const i = w.nearA[k];
    if (!live(w, i)) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const r = KINDS[h.kind[i]].radius + HIT_PAD;
    if (dx * dx + dz * dz <= r * r) return i;
  }
  return -1;
}

/** Turn dart i toward (dx, dy, dz) by at most one tick of turn rate. Speed is unchanged. */
function steer(w: World, i: number, dx: number, dy: number, dz: number): void {
  const sh = w.shots;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl < 1e-6) return;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  const ux = sh.vx[i] / DART_SPEED;
  const uy = sh.vy[i] / DART_SPEED;
  const uz = sh.vz[i] / DART_SPEED;
  const c = ux * dx + uy * dy + uz * dz;
  let nx = dx;
  let ny = dy;
  let nz = dz;
  if (c < COS_TURN) {
    // Rotate u toward d by the turn limit, in the plane they span.
    let px = dx - ux * c;
    let py = dy - uy * c;
    let pz = dz - uz * c;
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl > 1e-6) {
      px /= pl;
      py /= pl;
      pz /= pl;
      nx = ux * COS_TURN + px * SIN_TURN;
      ny = uy * COS_TURN + py * SIN_TURN;
      nz = uz * COS_TURN + pz * SIN_TURN;
    }
  }
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  sh.vx[i] = (nx / nl) * DART_SPEED;
  sh.vy[i] = (ny / nl) * DART_SPEED;
  sh.vz[i] = (nz / nl) * DART_SPEED;
}

/** Fill the meter from distance, fire volleys, and fly the darts already out. */
export function stepSeekers(w: World, s: SimState, terrain: Terrain, level: number): void {
  const m = s.mover;

  if (level <= 0) {
    w.seekerMeter = 0;
  } else {
    const interval = SEEKERS.interval[level - 1];
    w.seekerMeter += Math.sqrt(m.vx * m.vx + m.vz * m.vz) * DT;
    if (w.seekerMeter >= interval) {
      if (fire(w, s, level)) w.seekerMeter -= interval;
      else w.seekerMeter = interval;
    }
  }

  const sh = w.shots;
  const h = w.horde;
  for (let i = sh.count - 1; i >= 0; i--) {
    // The shot pool is shared; only darts are flown here.
    if (sh.kind[i] !== SHOT_DART) continue;
    if (--sh.life[i] === 0) {
      removeShot(w, i);
      continue;
    }
    const t = seekTarget(w, sh.x[i], sh.z[i]);
    if (t >= 0) {
      steer(w, i, h.x[t] - sh.x[i], h.y[t] + HOLD_HEIGHT - sh.y[i], h.z[t] - sh.z[i]);
    } else {
      const g = terrain.heightAt(sh.x[i], sh.z[i]) + HOLD_HEIGHT;
      steer(w, i, sh.vx[i], (g - sh.y[i]) * 2, sh.vz[i]);
    }
    sh.x[i] += sh.vx[i] * DT;
    sh.y[i] += sh.vy[i] * DT;
    sh.z[i] += sh.vz[i] * DT;

    const hit = reached(w, sh.x[i], sh.z[i]);
    if (hit >= 0) {
      damageEnemy(w, hit, sh.damage[i]);
      removeShot(w, i);
    }
  }
}
