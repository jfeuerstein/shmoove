/**
 * Sparks: one instanced mesh of small diamonds in `PALETTE.spark`, hovering, bobbing and turning,
 * bigger for a bigger `value`. Sparks carry no velocity in the world, so they are drawn where the
 * latest tick left them. Each one's bob and spin is offset by a hash of where it lies, so a field of
 * them does not move in lockstep.
 */
import { DynamicDrawUsage, InstancedMesh, OctahedronGeometry } from 'three';
import { MAX_SPARKS, type World } from '../sim/world';
import { PALETTE, glowMaterial } from './look';

/** Half the height of a spark worth 1, m. */
const SPARK_SIZE = 0.2;
/** How much taller than wide a diamond is. */
const SPARK_TALL = 1.5;
/** How high it hovers above the ground, and how far it bobs, m. */
const HOVER = 0.55;
const BOB = 0.12;
/** Bobs and turns per second. */
const BOB_RATE = 2.2;
const SPIN_RATE = 2.6;
/** Pulled sparks spin this much faster: they are on their way to you. */
const PULL_SPIN = 3;
const SPARK_GLOW = 0.7;

/** Size for a value: a spark worth 1 is 1, worth 12 a little over twice that. */
export function sparkScale(value: number): number {
  return 0.7 + 0.3 * Math.sqrt(value > 0 ? value : 0) + (value > 4 ? 0.3 : 0);
}

function hash(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export class SparksView {
  readonly mesh: InstancedMesh;

  constructor() {
    const geo = new OctahedronGeometry(SPARK_SIZE, 0);
    geo.scale(1, SPARK_TALL, 1);
    this.mesh = new InstancedMesh(geo, glowMaterial(PALETTE.spark, SPARK_GLOW), MAX_SPARKS);
    this.mesh.name = 'sparks';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** `time` in seconds. */
  update(w: World, time: number): void {
    const s = w.sparks;
    const m = this.mesh.instanceMatrix.array;
    for (let i = 0; i < s.count; i++) {
      const x = s.x[i];
      const z = s.z[i];
      const ph = hash(x, z) * Math.PI * 2;
      const spin = time * SPIN_RATE * (s.pull[i] ? PULL_SPIN : 1) + ph;
      const k = sparkScale(s.value[i]);
      const c = Math.cos(spin) * k;
      const sn = Math.sin(spin) * k;
      const o = i * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -sn;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = k;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = s.y[i] + HOVER * k + BOB * Math.sin(time * BOB_RATE * Math.PI * 2 + ph);
      m[o + 14] = z;
      m[o + 15] = 1;
    }
    this.mesh.count = s.count;
    this.mesh.visible = s.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
