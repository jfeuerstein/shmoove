/**
 * One-off effects, read from the world's per-tick `fx` queue.
 *
 * - `FX_POP`: a ring that expands to the loop's radius and a flash disc on the ground, both in
 *   `PALETTE.pop` (a pool of 4 each, one instanced mesh each, additive, fading per instance).
 * - `FX_ENEMY_DIE`: a small burst of shards in the enemy's colour (one instanced pool of 256).
 * - `FX_PLAYER_HIT`: `hitTint` jumps up and decays; the UI overlay draws it as a red wash.
 *
 * `ingest` must be called once per tick, right after the step (the queue is only valid until the
 * next one); `update` once per frame. Nothing allocates after construction.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type MeshLambertMaterial,
  RingGeometry,
  TetrahedronGeometry,
} from 'three';
import type { Terrain } from '../sim/terrain';
import { FX_ENEMY_DIE, FX_PLAYER_HIT, FX_POP, KIND_COUNT, KINDS, type World } from '../sim/world';
import { PALETTE, flatMaterial } from './look';

export const POP_POOL = 4;
export const SHARD_POOL = 256;
/** Seconds the ring takes to reach the loop's edge and fade, and the disc to fade. */
const RING_LIFE = 0.5;
const DISC_LIFE = 0.3;
/** Ring band width as a share of its radius; height above the ground, m. */
const RING_INNER = 0.88;
const POP_LIFT = 0.2;
/** Shards per death, scaled by the enemy's size; their life, launch speeds and gravity. */
const SHARDS_PER_DEATH = 6;
const SHARD_LIFE = 0.55;
const SHARD_SIZE = 0.2;
const SHARD_UP = 6;
const SHARD_OUT = 4.5;
const SHARD_GRAVITY = 22;
/** Red wash after a hit: strength for a hit of `HIT_REF` damage or more, and its fade time, s. */
const HIT_MIN = 0.35;
const HIT_MAX = 0.7;
const HIT_REF = 15;
const HIT_FADE = 0.4;

/** An additive, glowing, fogged surface whose strength fades per instance through `aFade`. */
function fadeMaterial(color: number): MeshLambertMaterial {
  const m = flatMaterial(color);
  m.emissive.setHex(color);
  m.emissiveIntensity = 1;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = AdditiveBlending;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vFade;');
  };
  return m;
}

function instanced(geo: RingGeometry | CircleGeometry | TetrahedronGeometry, mat: MeshLambertMaterial, n: number, name: string): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

/** Write a matrix that scales x and z by `s` (y by `sy`) and translates, at slot `i`. */
function flatMatrix(m: { [i: number]: number }, i: number, s: number, sy: number, x: number, y: number, z: number): void {
  const o = i * 16;
  m[o] = s;
  m[o + 1] = 0;
  m[o + 2] = 0;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = sy;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = 0;
  m[o + 9] = 0;
  m[o + 10] = s;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

export class FxView {
  readonly object = new Group();
  readonly rings: InstancedMesh;
  readonly discs: InstancedMesh;
  readonly shards: InstancedMesh;
  /** 0..1: how strongly the frame is washed red after a hit. */
  hitTint = 0;

  private readonly terrain: Terrain;
  private readonly ringFade: InstancedBufferAttribute;
  private readonly discFade: InstancedBufferAttribute;

  // Pops: a ring buffer of POP_POOL slots; age < 0 is free.
  private readonly popX = new Float32Array(POP_POOL);
  private readonly popY = new Float32Array(POP_POOL);
  private readonly popZ = new Float32Array(POP_POOL);
  private readonly popR = new Float32Array(POP_POOL);
  private readonly popAge = new Float32Array(POP_POOL).fill(-1);
  private popNext = 0;

  // Shards: dense, live ones are [0, shardCount).
  private shardCount = 0;
  private readonly sx = new Float32Array(SHARD_POOL);
  private readonly sy = new Float32Array(SHARD_POOL);
  private readonly sz = new Float32Array(SHARD_POOL);
  private readonly svx = new Float32Array(SHARD_POOL);
  private readonly svy = new Float32Array(SHARD_POOL);
  private readonly svz = new Float32Array(SHARD_POOL);
  private readonly sage = new Float32Array(SHARD_POOL);
  private readonly sspin = new Float32Array(SHARD_POOL);
  private readonly ssize = new Float32Array(SHARD_POOL);
  private readonly skind = new Uint8Array(SHARD_POOL);
  /** Linear RGB per enemy kind, for the shards' instance colours. */
  private readonly kindRgb = new Float32Array(KIND_COUNT * 3);
  /** Cheap deterministic noise for shard directions. */
  private seed = 0x9e3779b9;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.object.name = 'fx';

    const ringGeo = new RingGeometry(RING_INNER, 1, 48, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringFade = new InstancedBufferAttribute(new Float32Array(POP_POOL), 1);
    this.ringFade.setUsage(DynamicDrawUsage);
    ringGeo.setAttribute('aFade', this.ringFade);
    this.rings = instanced(ringGeo, fadeMaterial(PALETTE.pop), POP_POOL, 'pop-rings');

    const discGeo = new CircleGeometry(1, 32);
    discGeo.rotateX(-Math.PI / 2);
    this.discFade = new InstancedBufferAttribute(new Float32Array(POP_POOL), 1);
    this.discFade.setUsage(DynamicDrawUsage);
    discGeo.setAttribute('aFade', this.discFade);
    this.discs = instanced(discGeo, fadeMaterial(PALETTE.pop), POP_POOL, 'pop-discs');

    const shardMat = flatMaterial(0xffffff);
    this.shards = instanced(new TetrahedronGeometry(SHARD_SIZE, 0), shardMat, SHARD_POOL, 'death-shards');
    this.shards.instanceColor = new InstancedBufferAttribute(new Float32Array(SHARD_POOL * 3), 3);
    this.shards.instanceColor.setUsage(DynamicDrawUsage);
    const c = new Color();
    for (let k = 0; k < KIND_COUNT; k++) {
      c.setHex(PALETTE.enemies[k]);
      this.kindRgb[k * 3] = c.r;
      this.kindRgb[k * 3 + 1] = c.g;
      this.kindRgb[k * 3 + 2] = c.b;
    }

    this.discs.renderOrder = 2;
    this.rings.renderOrder = 2;
    this.object.add(this.discs, this.rings, this.shards);
  }

  /** Live shards, for tests. */
  get liveShards(): number {
    return this.shardCount;
  }

  /** Live pops, for tests. */
  get livePops(): number {
    let n = 0;
    for (let i = 0; i < POP_POOL; i++) if (this.popAge[i] >= 0) n++;
    return n;
  }

  /** Drop everything still playing from the last run. */
  reset(): void {
    this.hitTint = 0;
    this.popAge.fill(-1);
    this.popNext = 0;
    this.shardCount = 0;
    this.rings.count = 0;
    this.rings.visible = false;
    this.discs.count = 0;
    this.discs.visible = false;
    this.shards.count = 0;
    this.shards.visible = false;
  }

  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Take this tick's effects. Call once per tick, right after `sim.step`. */
  ingest(w: World): void {
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      if (type === FX_POP) {
        const p = this.popNext;
        this.popNext = (p + 1) % POP_POOL;
        this.popX[p] = f.x[i];
        this.popY[p] = f.y[i];
        this.popZ[p] = f.z[i];
        this.popR[p] = f.a[i] > 0.5 ? f.a[i] : 0.5;
        this.popAge[p] = 0;
      } else if (type === FX_ENEMY_DIE) {
        this.burst(f.a[i] | 0, f.x[i], f.y[i], f.z[i]);
      } else if (type === FX_PLAYER_HIT) {
        const s = HIT_MIN + (HIT_MAX - HIT_MIN) * Math.min(1, f.a[i] / HIT_REF);
        if (s > this.hitTint) this.hitTint = s;
      }
    }
  }

  private burst(kind: number, x: number, y: number, z: number): void {
    const k = kind >= 0 && kind < KIND_COUNT ? kind : 0;
    const def = KINDS[k];
    const n = Math.max(3, Math.round(SHARDS_PER_DEATH * Math.sqrt(def.radius / 0.6)));
    const size = 0.6 + def.radius * 0.6;
    for (let j = 0; j < n; j++) {
      // A full pool overwrites a live shard at random: in a crowd nobody notices which.
      const i = this.shardCount < SHARD_POOL ? this.shardCount++ : Math.floor(this.rand() * SHARD_POOL);
      const a = this.rand() * Math.PI * 2;
      const out = SHARD_OUT * (0.5 + this.rand());
      this.sx[i] = x;
      this.sy[i] = y + def.height * 0.5;
      this.sz[i] = z;
      this.svx[i] = Math.cos(a) * out;
      this.svz[i] = Math.sin(a) * out;
      this.svy[i] = SHARD_UP * (0.6 + 0.6 * this.rand());
      this.sage[i] = 0;
      this.sspin[i] = this.rand() * Math.PI * 2;
      this.ssize[i] = size * (0.7 + 0.6 * this.rand());
      this.skind[i] = k;
    }
  }

  /** Advance and draw. `dt` is the real time since the last frame, s. */
  update(dt: number): void {
    const step = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    this.hitTint = Math.max(0, this.hitTint - step / HIT_FADE);

    // Pops.
    const rm = this.rings.instanceMatrix.array;
    const dm = this.discs.instanceMatrix.array;
    const rf = this.ringFade.array as Float32Array;
    const df = this.discFade.array as Float32Array;
    let rn = 0;
    let dn = 0;
    for (let p = 0; p < POP_POOL; p++) {
      if (this.popAge[p] < 0) continue;
      const age = (this.popAge[p] += step);
      if (age >= RING_LIFE) {
        this.popAge[p] = -1;
        continue;
      }
      const t = age / RING_LIFE;
      const grow = 1 - (1 - t) * (1 - t) * (1 - t);
      flatMatrix(rm, rn, this.popR[p] * (0.25 + 0.75 * grow), 1, this.popX[p], this.popY[p] + POP_LIFT, this.popZ[p]);
      rf[rn++] = 1 - t;
      if (age < DISC_LIFE) {
        const u = 1 - age / DISC_LIFE;
        flatMatrix(dm, dn, this.popR[p], 1, this.popX[p], this.popY[p] + POP_LIFT * 0.5, this.popZ[p]);
        df[dn++] = 0.55 * u * u;
      }
    }
    this.rings.count = rn;
    this.rings.visible = rn > 0;
    this.discs.count = dn;
    this.discs.visible = dn > 0;
    if (rn > 0) {
      this.rings.instanceMatrix.needsUpdate = true;
      this.ringFade.needsUpdate = true;
    }
    if (dn > 0) {
      this.discs.instanceMatrix.needsUpdate = true;
      this.discFade.needsUpdate = true;
    }

    // Shards.
    const sm = this.shards.instanceMatrix.array;
    const col = this.shards.instanceColor;
    const sc = col ? (col.array as Float32Array) : null;
    let i = 0;
    while (i < this.shardCount) {
      const age = (this.sage[i] += step);
      if (age >= SHARD_LIFE) {
        this.killShard(i);
        continue;
      }
      this.svy[i] -= SHARD_GRAVITY * step;
      this.sx[i] += this.svx[i] * step;
      this.sy[i] += this.svy[i] * step;
      this.sz[i] += this.svz[i] * step;
      const floor = this.terrain.heightAt(this.sx[i], this.sz[i]) + SHARD_SIZE * 0.5;
      if (this.sy[i] < floor) {
        this.sy[i] = floor;
        this.svy[i] *= -0.35;
        this.svx[i] *= 0.6;
        this.svz[i] *= 0.6;
      }
      const s = this.ssize[i] * (1 - age / SHARD_LIFE);
      // Tumbling: Ry(b) * Rx(a), scaled by s.
      const a = this.sspin[i] + age * 9;
      const b = this.sspin[i] * 1.7 + age * 5;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cb = Math.cos(b) * s;
      const sb = Math.sin(b) * s;
      const o = i * 16;
      sm[o] = cb;
      sm[o + 1] = 0;
      sm[o + 2] = -sb;
      sm[o + 3] = 0;
      sm[o + 4] = sb * sa;
      sm[o + 5] = ca * s;
      sm[o + 6] = cb * sa;
      sm[o + 7] = 0;
      sm[o + 8] = sb * ca;
      sm[o + 9] = -sa * s;
      sm[o + 10] = cb * ca;
      sm[o + 11] = 0;
      sm[o + 12] = this.sx[i];
      sm[o + 13] = this.sy[i];
      sm[o + 14] = this.sz[i];
      sm[o + 15] = 1;
      if (sc) {
        const k = this.skind[i] * 3;
        sc[i * 3] = this.kindRgb[k];
        sc[i * 3 + 1] = this.kindRgb[k + 1];
        sc[i * 3 + 2] = this.kindRgb[k + 2];
      }
      i++;
    }
    this.shards.count = this.shardCount;
    this.shards.visible = this.shardCount > 0;
    if (this.shardCount > 0) {
      this.shards.instanceMatrix.needsUpdate = true;
      if (col) col.needsUpdate = true;
    }
  }

  private killShard(i: number): void {
    const j = --this.shardCount;
    if (i === j) return;
    this.sx[i] = this.sx[j];
    this.sy[i] = this.sy[j];
    this.sz[i] = this.sz[j];
    this.svx[i] = this.svx[j];
    this.svy[i] = this.svy[j];
    this.svz[i] = this.svz[j];
    this.sage[i] = this.sage[j];
    this.sspin[i] = this.sspin[j];
    this.ssize[i] = this.ssize[j];
    this.skind[i] = this.skind[j];
  }
}
