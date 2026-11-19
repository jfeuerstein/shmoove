/**
 * Screen shake: a trauma value, 0 to 1, that decays in about 0.4 s. The camera is moved and rolled
 * by smooth noise scaled by trauma squared, so a small knock is barely there and a big one is a
 * jolt; never more than a few centimetres and a degree or two.
 *
 * Applied after `ChaseCamera.update` (which sets the camera's whole pose every frame, so the
 * offset never accumulates). The noise comes from a counter hashed to a lattice, so the same
 * inputs always give the same shake and `Math.random` is never used. Nothing allocates after
 * construction.
 */
import type { Camera } from 'three';
import { EV_LAND, type SimState } from '../sim/types';
import {
  FX_BLAST,
  FX_BONK,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_PLAYER_HIT,
  FX_SLAM,
  type World,
} from '../sim/world';

/** Seconds a full trauma takes to fall to nothing. */
export const TRAUMA_SECONDS = 0.4;
/** Largest camera offset along each of its own axes, m. */
export const MAX_OFFSET = 0.05;
/** Largest roll, radians (about 1.7 degrees). */
export const MAX_ROLL = 0.03;
/** Noise lattice points per second. */
export const NOISE_RATE = 28;

export const TRAUMA_HIT = 0.6;
export const TRAUMA_BONK = 0.3;
export const TRAUMA_AREA = 0.2;
export const TRAUMA_BOSS = 0.8;
export const TRAUMA_LAND = 0.12;
/** A landing at least this hard (m/s into the ground) shakes the frame. */
export const LAND_IMPACT = 8;
/** An area effect this far away or further is not felt, m. */
export const AREA_RANGE = 20;

function lattice(i: number, channel: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(channel + 1, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Smooth 1D value noise in -1..1 from a position and a channel. Pure. */
export function noise(t: number, channel: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lattice(i, channel) * (1 - u) + lattice(i + 1, channel) * u;
}

/** Trauma added by one effect at `dist` metres from the mover. 0 for effects that do not shake. */
export function traumaFor(type: number, dist: number): number {
  if (type === FX_PLAYER_HIT) return TRAUMA_HIT;
  if (type === FX_BONK) return TRAUMA_BONK;
  if (type === FX_BOSS_IN || type === FX_BOSS_DOWN) return TRAUMA_BOSS;
  if (type === FX_SLAM || type === FX_BLAST) {
    return dist >= AREA_RANGE ? 0 : TRAUMA_AREA * (1 - dist / AREA_RANGE);
  }
  return 0;
}

export class Shake {
  /** 0..1. */
  trauma = 0;
  /** The offset in the camera's own axes, m, and the roll, radians, from the last `update`. */
  x = 0;
  y = 0;
  roll = 0;
  /** False when reduced motion is on: nothing is added and the offset is zero. */
  enabled = true;
  private clock = 0;

  add(amount: number): void {
    if (!this.enabled || !(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Once per sim tick, right after the step. */
  ingest(w: World, s: SimState): void {
    if (!this.enabled) return;
    const m = s.mover;
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      let dist = 0;
      if (type === FX_SLAM || type === FX_BLAST) {
        const dx = f.x[i] - m.x;
        const dz = f.z[i] - m.z;
        dist = Math.sqrt(dx * dx + dz * dz);
      }
      this.add(traumaFor(type, dist));
    }
    if ((s.events & EV_LAND) !== 0 && m.impact >= LAND_IMPACT) this.add(TRAUMA_LAND);
  }

  /** Once per frame with real seconds: decay, and work out the offset. */
  update(dt: number): void {
    if (!this.enabled) this.trauma = 0;
    if (dt > 0) {
      this.trauma = Math.max(0, this.trauma - dt / TRAUMA_SECONDS);
      this.clock += dt;
    }
    if (this.trauma <= 0) {
      this.x = 0;
      this.y = 0;
      this.roll = 0;
      return;
    }
    const k = this.trauma * this.trauma;
    const t = this.clock * NOISE_RATE;
    this.x = MAX_OFFSET * k * noise(t, 0);
    this.y = MAX_OFFSET * k * noise(t, 1);
    this.roll = MAX_ROLL * k * noise(t, 2);
  }

  /** Move and roll the camera by the current offset. Call after `ChaseCamera.update`. */
  apply(camera: Camera): void {
    if (this.x === 0 && this.y === 0 && this.roll === 0) return;
    camera.translateX(this.x);
    camera.translateY(this.y);
    camera.rotateZ(this.roll);
  }

  reset(): void {
    this.trauma = 0;
    this.x = 0;
    this.y = 0;
    this.roll = 0;
  }
}
