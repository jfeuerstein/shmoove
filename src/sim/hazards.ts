/**
 * What the newer enemies leave on the mover and under it: lobbed shots landing in their rings, tar
 * on the ground, clingers holding on. Runs once a tick after contact and writes `w.player.cling`,
 * the extra drag the mover feels next tick (tar plus clingers; 0 when neither).
 *
 * The horde's step makes the zones (a lobber lobs, a sludge leaves tar, with `lob` and `dropTar`);
 * this step ages them, lands the lobs, and removes them. Clingers are latched by contact; they are
 * shaken off here: one by each clean hop, all by a hard landing or a loop popping.
 *
 * Pure and allocation-free after a world's first tick.
 */
import { hurtPlayer } from './contact';
import { TICK_HZ } from './constants';
import { dcos, dsin, TAU } from './math';
import type { Terrain } from './terrain';
import { EV_CLEAN_HOP, EV_LAND, type SimState } from './types';
import {
  addZone,
  damageEnemy,
  KINDS,
  PHASE_PLAY,
  removeZone,
  shoveEnemy,
  STATE_LATCHED,
  ZONE_LOB,
  ZONE_TAR,
  HURT_LOB,
  type World,
} from './world';

export const HAZARDS = {
  /** A lobber lobs once every this many seconds while the mover is within lobRange. */
  lobEvery: 3.5,
  /** m. Further than this a lobber does not lob. */
  lobRange: 40,
  /** Radius of the ring a lob lands in, m (2.4 m across). */
  lobRadius: 1.2,
  /** Ticks the ring shows before the shot lands. */
  lobTicks: 66,
  /**
   * The ring goes where the mover would be after this long at its present velocity, s. It is the
   * ring's flight time (lobTicks), so a mover that keeps its line is inside the ring when it lands.
   */
  lobLead: 66 / TICK_HZ,
  lobDamage: 12,
  /** A mover this high above the ground or more when a lob lands is not hit, m. */
  lobClear: 1.5,

  /** A sludge leaves tar every this many metres it travels. */
  tarEvery: 4,
  /** Radius of a patch of tar, m (2.2 m across). */
  tarRadius: 1.1,
  /** Ticks a patch lasts. */
  tarTicks: 600,
  /** Most patches at once; a new one beyond that takes the place of the oldest. */
  tarMax: 24,
  /** Extra drag on a grounded mover standing in tar, 1/s. */
  tarDrag: 1.2,

  /** Extra drag per clinger holding on, 1/s. */
  clingDrag: 0.8,
  /** A landing at least this hard (speed into the ground, m/s) shakes every clinger off. */
  shakeImpact: 5,
  /** A clinger shaken off is thrown this fast, m/s, ... */
  shakeSpeed: 10,
  /** ... is harmless for this many ticks ... */
  shakeStun: 60,
  /** ... and takes this much damage. */
  shakeDamage: 6,
} as const;

/** Lob a shot that lands at (x, z) after `ticks` (a lobber's `HAZARDS.lobTicks` by default). */
export function lob(w: World, terrain: Terrain, x: number, z: number, ticks: number = HAZARDS.lobTicks): void {
  const H = HAZARDS;
  addZone(w, ZONE_LOB, x, terrain.heightAt(x, z), z, H.lobRadius, ticks, H.lobDamage);
}

/** Leave a patch of tar at (x, y, z). At the limit, the oldest patch makes way. */
export function dropTar(w: World, x: number, y: number, z: number): void {
  const H = HAZARDS;
  const zn = w.zones;
  let tars = 0;
  let oldest = -1;
  for (let i = 0; i < zn.count; i++) {
    if (zn.kind[i] !== ZONE_TAR) continue;
    tars++;
    if (oldest < 0 || zn.age[i] > zn.age[oldest]) oldest = i;
  }
  if (tars >= H.tarMax && oldest >= 0) removeZone(w, oldest);
  addZone(w, ZONE_TAR, x, y, z, H.tarRadius, H.tarTicks, H.tarDrag);
}

/** Throw clinger i clear of the mover: let go, stunned, hurt. */
function shake(w: World, s: SimState, i: number): void {
  const h = w.horde;
  const m = s.mover;
  h.state[i] = 0;
  let dx = h.x[i] - m.x;
  let dz = h.z[i] - m.z;
  if (dx * dx + dz * dz < 1e-6) {
    const a = TAU * h.phase[i];
    dx = dsin(a);
    dz = dcos(a);
  }
  shoveEnemy(w, i, dx, dz, HAZARDS.shakeSpeed, HAZARDS.shakeStun);
  damageEnemy(w, i, HAZARDS.shakeDamage);
}

/** Shake clingers off, land lobs, age tar, and work out the drag on the mover. */
export function stepHazards(w: World, s: SimState, terrain: Terrain): void {
  const H = HAZARDS;
  const h = w.horde;
  const p = w.player;
  const m = s.mover;

  // A pop happens among the weapons, after this step: it is seen here on the next tick.
  const popped = p.pops > w.popsSeen;
  w.popsSeen = p.pops;
  const ev = s.events;
  const all = popped || ((ev & EV_LAND) !== 0 && m.impact >= H.shakeImpact);
  let one = !all && (ev & EV_CLEAN_HOP) !== 0;

  let latched = 0;
  for (let i = 0; i < h.count; i++) {
    if (h.state[i] !== STATE_LATCHED || KINDS[h.kind[i]].latches !== true) continue;
    if (h.hp[i] <= 0) {
      // Killed while holding on: it lets go.
      h.state[i] = 0;
      continue;
    }
    if (all || one) {
      shake(w, s, i);
      one = false;
      continue;
    }
    latched++;
  }
  p.latched = latched;
  let cling = latched * H.clingDrag;

  const zn = w.zones;
  let inTar = false;
  for (let i = zn.count - 1; i >= 0; i--) {
    const kind = zn.kind[i];
    if (kind !== ZONE_TAR && kind !== ZONE_LOB) continue;
    if (zn.age[i] < 65535) zn.age[i]++;
    if (zn.life[i] > 0) zn.life[i]--;
    const dx = m.x - zn.x[i];
    const dz = m.z - zn.z[i];
    const inside = dx * dx + dz * dz <= zn.r[i] * zn.r[i];
    if (kind === ZONE_TAR) {
      if (inside && m.grounded && zn.life[i] > 0) inTar = true;
    } else if (zn.life[i] === 0 && inside && p.invuln === 0 && w.run.phase === PHASE_PLAY) {
      // The shot lands. Over it in the air is safe; low or on the ground is not.
      const up = m.grounded ? 0 : m.y - terrain.heightAt(m.x, m.z);
      if (up < H.lobClear) hurtPlayer(w, s, zn.power[i], HURT_LOB);
    }
    if (zn.life[i] === 0) removeZone(w, i);
  }
  if (inTar) cling += H.tarDrag;
  p.cling = cling;
}
