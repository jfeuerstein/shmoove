/**
 * Static: every few seconds a bolt arcs from the nearest enemy through a chain of its neighbours.
 * With nothing in reach it stays ready and goes the moment something comes close.
 */
import { W_STATIC } from '../arsenal';
import { DT } from '../constants';
import { powerOf } from '../stats';
import type { Terrain } from '../terrain';
import type { SimState } from '../types';
import { damageEnemy, emitFx, FX_ARC, queryEnemies, SPAWN_TICKS, WEAPON_MEM, type World } from '../world';
import { afterShot, isReady, waitOf } from './timer';

/** Static's numbers. Arrays are by weapon level 1..5. */
export const STATIC = {
  /** Seconds between discharges, before Haste. */
  wait: [3, 2.7, 2.4, 2.1, 1.8],
  /** Most enemies one discharge strikes. */
  chain: [3, 4, 5, 6, 8],
  /** Damage to each enemy struck, before might. */
  damage: [14, 17, 21, 26, 32],
  /** The first link is the nearest enemy within this of the mover, m. */
  reach: 10,
  /** Each further link is within this of the one before, m. */
  jump: 6,
} as const;

const MAX_CHAIN = 8;
/** mem: seconds waited since the last discharge. */
const MEM_WAITED = 0;

/** The enemies struck by the discharge being worked out, in order. */
const struck = new Int16Array(MAX_CHAIN);

/** Seconds waited since the last discharge, for the renderer and tests. */
export function staticCharge(w: World): number {
  return w.mem[W_STATIC * WEAPON_MEM + MEM_WAITED];
}

/** The nearest living, risen enemy within `r` of (x, z) not yet in the first `got` of `struck`; -1 if none. */
function nextLink(w: World, x: number, z: number, r: number, got: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, r, w.nearA);
  let best = -1;
  let bestD = Infinity;
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    let taken = false;
    for (let k = 0; k < got; k++) if (struck[k] === i) taken = true;
    if (taken) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const d = dx * dx + dz * dz;
    // Ties go to the lower index, so the chain does not depend on the grid's order.
    if (d < bestD || (d === bestD && i < best)) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Arc through the chain. False if nothing was in reach. */
function discharge(w: World, s: SimState, level: number): boolean {
  const m = s.mover;
  const h = w.horde;
  let at = nextLink(w, m.x, m.z, STATIC.reach, 0);
  if (at < 0) return false;
  const want = STATIC.chain[level - 1];
  const dmg = STATIC.damage[level - 1] * powerOf(w.player.stats, m.gear);
  let got = 0;
  while (at >= 0) {
    struck[got] = at;
    emitFx(w, FX_ARC, h.x[at], h.y[at], h.z[at], got);
    got++;
    if (got >= want) break;
    at = nextLink(w, h.x[at], h.z[at], STATIC.jump, got);
  }
  // Damage after the chain is found, so a link that dies does not change where the arc goes next.
  for (let k = 0; k < got; k++) damageEnemy(w, struck[k], dmg);
  return true;
}

export function stepStatic(w: World, s: SimState, _terrain: Terrain, level: number): void {
  if (level <= 0) return;
  const at = W_STATIC * WEAPON_MEM + MEM_WAITED;
  const wait = waitOf(STATIC.wait[level - 1], w.player.stats);
  w.mem[at] += DT;
  if (!isReady(w.mem[at], wait)) return;
  w.mem[at] = discharge(w, s, level) ? afterShot(w.mem[at], wait) : wait;
}
