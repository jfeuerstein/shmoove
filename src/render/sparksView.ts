/**
 * Sparks: one instanced mesh of small cut gems in tones of `PALETTE.spark` (a lighter table on top,
 * a darker point below), hovering, bobbing and turning, bigger for a bigger `value`, and the big
 * ones paler and brighter. A spark flying to the player stretches along the way it is going, the
 * faster the longer, so a pull reads as a stream into the rider; its pop on pick-up is `FxView`'s.
 *
 * Sparks carry no velocity in the world, so they are drawn where the latest tick left them, and the
 * view works out a pulled spark's motion from where it was at the tick before (the pool moves sparks
 * between slots as they are taken, so a slot that jumped further than a spark can fly is ignored).
 * Each one's bob and spin is offset by a hash of where it lies, so a field of them does not move in
 * lockstep.
 */
import { CylinderGeometry, type InstancedBufferAttribute, type InstancedMesh, Matrix4 } from 'three';
import { DT } from '../sim/constants';
import { MAX_SPARKS, type World } from '../sim/world';
import { PALETTE, tone } from './look';
import { addInstanceColor, addInstanceFloat, makeInstanced, rgbInto, ShapeBuilder, tintMaterial, tonePaint, uploadFirst } from './fxView';

/** Half the height of a spark worth 1, m. */
const SPARK_SIZE = 0.2;
/** How high it hovers above the ground, and how far it bobs, m. */
const HOVER = 0.55;
const BOB = 0.12;
/** Bobs and turns per second. */
const BOB_RATE = 2.2;
const SPIN_RATE = 2.6;
/** Pulled sparks spin this much faster: they are on their way to you. */
const PULL_SPIN = 3;
const SPARK_GLOW = 0.7;
/** A spark worth at least this is a big one: paler, brighter. */
export const BIG_SPARK = 5;
const BIG_GLOW = 0.95;
/** A pulled spark is this much longer per m/s it flies, at most `STRETCH_MAX` times, and this much thinner. */
const STRETCH_PER_MS = 0.045;
export const STRETCH_MAX = 2.4;
const STRETCH_THIN = 0.75;
/** A slot that moved further than this in a tick is a different spark, m. */
const MAX_FLY = 3;

/** Size for a value: a spark worth 1 is 1, worth 12 a little over twice that. */
export function sparkScale(value: number): number {
  return 0.7 + 0.3 * Math.sqrt(value > 0 ? value : 0) + (value > 4 ? 0.3 : 0);
}

function hash(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** A cut gem about the origin, `SPARK_SIZE` above and below, in tones of `color`. */
export function gemGeometry(color: number): ShapeBuilder {
  const b = new ShapeBuilder();
  const s = SPARK_SIZE;
  // A six-sided gem: table on top, a girdle, then a long point below.
  const crown = new CylinderGeometry(0.42 * s, 0.78 * s, 0.4 * s, 6);
  const pavilion = new CylinderGeometry(0.78 * s, 0, 1.2 * s, 6);
  const paint = tonePaint(color, -1.1 * s, -0.4, 0.62 * s, 0.45);
  b.add(crown, paint, new Matrix4().makeTranslation(0, 0.42 * s, 0));
  b.add(pavilion, paint, new Matrix4().makeTranslation(0, -0.38 * s, 0));
  return b;
}

export class SparksView {
  readonly mesh: InstancedMesh;
  private readonly glow: InstancedBufferAttribute;
  private readonly rgb: Float32Array;
  private readonly smallRgb = new Float32Array(3);
  private readonly bigRgb = new Float32Array(3);
  // Where each slot's spark was at the last tick seen, and how fast it was going.
  private readonly lx = new Float32Array(MAX_SPARKS);
  private readonly ly = new Float32Array(MAX_SPARKS);
  private readonly lz = new Float32Array(MAX_SPARKS);
  private readonly vx = new Float32Array(MAX_SPARKS);
  private readonly vy = new Float32Array(MAX_SPARKS);
  private readonly vz = new Float32Array(MAX_SPARKS);
  private seen = 0;
  private seenTick = -1;
  /** How much longer than wide each spark was drawn last frame (1 at rest), for tests. */
  readonly stretch = new Float32Array(MAX_SPARKS);

  constructor() {
    const geo = gemGeometry(PALETTE.spark).build();
    geo.deleteAttribute('aPart');
    this.glow = addInstanceFloat(geo, 'aGlow', MAX_SPARKS);
    const mat = tintMaterial();
    mat.vertexColors = true;
    this.mesh = makeInstanced(geo, mat, MAX_SPARKS, 'sparks');
    this.rgb = addInstanceColor(this.mesh, MAX_SPARKS);
    rgbInto(this.smallRgb, 0, PALETTE.spark);
    rgbInto(this.bigRgb, 0, tone(PALETTE.spark, 0.4));
  }

  /** `time` in seconds. */
  update(w: World, time: number): void {
    const s = w.sparks;
    const tick = w.run.ticks;
    if (tick !== this.seenTick) this.follow(w, tick);
    const m = this.mesh.instanceMatrix.array;
    const glow = this.glow.array as Float32Array;
    const rgb = this.rgb;
    for (let i = 0; i < s.count; i++) {
      const x = s.x[i];
      const z = s.z[i];
      const ph = hash(x, z) * Math.PI * 2;
      const pulled = s.pull[i] !== 0;
      const spin = time * SPIN_RATE * (pulled ? PULL_SPIN : 1) + ph;
      const value = s.value[i];
      const k = sparkScale(value);
      const c = Math.cos(spin);
      const sn = Math.sin(spin);
      const y = s.y[i] + HOVER * k + BOB * Math.sin(time * BOB_RATE * Math.PI * 2 + ph);
      const o = i * 16;
      const vx = this.vx[i];
      const vy = this.vy[i];
      const vz = this.vz[i];
      const speed = pulled ? Math.sqrt(vx * vx + vy * vy + vz * vz) : 0;
      if (speed > 1) {
        // Along the way it flies: its long axis on the velocity, the other two round it, turning.
        const st = Math.min(STRETCH_MAX, 1 + speed * STRETCH_PER_MS * 2);
        const ux = vx / speed;
        const uy = vy / speed;
        const uz = vz / speed;
        // p = u x up (or x if it flies straight up), q = u x p.
        let px = -uz;
        let pz = ux;
        const py = 0;
        let pl = Math.sqrt(px * px + pz * pz);
        if (pl < 1e-4) {
          px = 1;
          pz = 0;
          pl = 1;
        }
        px /= pl;
        pz /= pl;
        const qx = uy * pz - uz * py;
        const qy = uz * px - ux * pz;
        const qz = ux * py - uy * px;
        const r = k * STRETCH_THIN;
        const ax = (px * c + qx * sn) * r;
        const ay = (py * c + qy * sn) * r;
        const az = (pz * c + qz * sn) * r;
        const bx = (qx * c - px * sn) * r;
        const by = (qy * c - py * sn) * r;
        const bz = (qz * c - pz * sn) * r;
        m[o] = ax;
        m[o + 1] = ay;
        m[o + 2] = az;
        m[o + 4] = ux * k * st;
        m[o + 5] = uy * k * st;
        m[o + 6] = uz * k * st;
        m[o + 8] = bx;
        m[o + 9] = by;
        m[o + 10] = bz;
        this.stretch[i] = st / STRETCH_THIN;
      } else {
        m[o] = c * k;
        m[o + 1] = 0;
        m[o + 2] = -sn * k;
        m[o + 4] = 0;
        m[o + 5] = k;
        m[o + 6] = 0;
        m[o + 8] = sn * k;
        m[o + 9] = 0;
        m[o + 10] = c * k;
        this.stretch[i] = 1;
      }
      m[o + 3] = 0;
      m[o + 7] = 0;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      const big = value >= BIG_SPARK;
      const col = big ? this.bigRgb : this.smallRgb;
      rgb[i * 3] = col[0];
      rgb[i * 3 + 1] = col[1];
      rgb[i * 3 + 2] = col[2];
      glow[i] = big ? BIG_GLOW : SPARK_GLOW;
    }
    this.mesh.count = s.count;
    this.mesh.visible = s.count > 0;
    if (s.count > 0) {
      uploadFirst(this.mesh.instanceMatrix, s.count);
      uploadFirst(this.glow, s.count);
      if (this.mesh.instanceColor) uploadFirst(this.mesh.instanceColor, s.count);
    }
  }

  /** From the last tick seen to this one: how fast each pulled spark moved. */
  private follow(w: World, tick: number): void {
    const elapsed = tick - this.seenTick;
    const fresh = this.seenTick < 0 || elapsed <= 0 || elapsed > 30;
    this.seenTick = tick;
    const s = w.sparks;
    const lim = MAX_FLY * elapsed;
    for (let i = 0; i < s.count; i++) {
      let vx = 0;
      let vy = 0;
      let vz = 0;
      if (!fresh && i < this.seen && s.pull[i] !== 0) {
        const dx = s.x[i] - this.lx[i];
        const dy = s.y[i] - this.ly[i];
        const dz = s.z[i] - this.lz[i];
        if (dx * dx + dy * dy + dz * dz <= lim * lim) {
          const inv = 1 / (elapsed * DT);
          vx = dx * inv;
          vy = dy * inv;
          vz = dz * inv;
        }
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.lx[i] = s.x[i];
      this.ly[i] = s.y[i];
      this.lz[i] = s.z[i];
    }
    this.seen = s.count;
  }
}
