/**
 * The horde: one instanced mesh per enemy kind, plus one for the blob shadows under all of them.
 *
 * Each frame the world's dense enemy arrays are written straight into the instance matrices (no
 * `Matrix4` or `Object3D` per enemy): position extrapolated back from the latest tick by the
 * velocity (the world is not interpolated, its indices move), facing from the velocity (or toward
 * the mover while standing still), and a uniform scale that grows from 0 to 1 while the enemy rises
 * out of the ground. A second per-instance attribute carries (phase, speed, flash); the vertex
 * shader turns it into a hop-wobble and the fragment shader into the hit flash, so animation costs
 * the CPU nothing. Every surface is the flat, lit, fogged material from `look.ts`, extended through
 * `onBeforeCompile`.
 */
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type MeshLambertMaterial,
  Vector4,
} from 'three';
import { DT } from '../sim/constants';
import { KIND_BOLLARD, KIND_COUNT, KIND_GNAT, KIND_SHUFFLER, KINDS, MAX_ENEMIES, SPAWN_TICKS, type World } from '../sim/world';
import { PALETTE, flatMaterial } from './look';

/** Share of an enemy's own colour it shows as glow, so its unlit side still reads as that colour. */
const ENEMY_GLOW = 0.38;
/** Ticks of hit flash shown at full strength; below that it fades out. */
const FLASH_FULL_TICKS = 3;
/** Blob shadow: radius as a share of the body radius, height above the ground, opacity. */
const SHADOW_SCALE = 1.25;
const SHADOW_LIFT = 0.05;
const SHADOW_OPACITY = 0.5;
const SHADOW_SEGMENTS = 8;
/** Below this speed an enemy counts as standing and turns to face the mover, m/s. */
const STILL_SPEED = 0.05;

/**
 * Per kind: the hop-wobble. `hop` is how high it bounces at full speed (m), `rate` how many bounces
 * a second, `sway` how far it rocks side to side (m per m of height), `idle` the share of the
 * wobble left while standing still (gnats never stop buzzing).
 */
interface Wobble {
  hop: number;
  rate: number;
  sway: number;
  idle: number;
}

const WOBBLE: readonly Wobble[] = [
  { hop: 0.14, rate: 2.4, sway: 0.06, idle: 0.2 },
  { hop: 0.12, rate: 7.5, sway: 0.25, idle: 1 },
  { hop: 0.05, rate: 1.1, sway: 0.025, idle: 0.15 },
];

// ---- geometry -------------------------------------------------------------------------------

/** Push triangle (a, b, c) into `out`, flipped if needed so it faces away from (cx, cy, cz). */
function tri(out: number[], p: readonly number[], a: number, b: number, c: number, cx: number, cy: number, cz: number): void {
  const ax = p[a * 3];
  const ay = p[a * 3 + 1];
  const az = p[a * 3 + 2];
  const ux = p[b * 3] - ax;
  const uy = p[b * 3 + 1] - ay;
  const uz = p[b * 3 + 2] - az;
  const vx = p[c * 3] - ax;
  const vy = p[c * 3 + 1] - ay;
  const vz = p[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (ax + p[b * 3] + p[c * 3]) / 3 - cx;
  const my = (ay + p[b * 3 + 1] + p[c * 3 + 1]) / 3 - cy;
  const mz = (az + p[b * 3 + 2] + p[c * 3 + 2]) / 3 - cz;
  const order = nx * mx + ny * my + nz * mz >= 0 ? [a, b, c] : [a, c, b];
  for (const k of order) out.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
}

/**
 * A block from y0 to y1 whose bottom is 2*bx by 2*bz and top 2*tx by 2*tz, the top shifted forward
 * (+z) by `lean` and the whole block by `dz`. Twelve triangles.
 */
function block(out: number[], y0: number, y1: number, bx: number, bz: number, tx: number, tz: number, lean = 0, dz = 0): void {
  const p = [
    -bx, y0, dz - bz, bx, y0, dz - bz, bx, y0, dz + bz, -bx, y0, dz + bz,
    -tx, y1, dz + lean - tz, tx, y1, dz + lean - tz, tx, y1, dz + lean + tz, -tx, y1, dz + lean + tz,
  ];
  const cy = (y0 + y1) / 2;
  const cz = dz + lean / 2;
  const faces = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 3, 2, 6, 3, 6, 7, 1, 0, 4, 1, 4, 5, 2, 1, 5, 2, 5, 6, 0, 3, 7, 0, 7, 4];
  for (let f = 0; f < faces.length; f += 3) tri(out, p, faces[f], faces[f + 1], faces[f + 2], 0, cy, cz);
}

function toGeometry(positions: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A chunky block figure, 1.7 m: legs, broad hunched torso, head pushed forward. 36 triangles. */
export function shufflerGeometry(): BufferGeometry {
  const p: number[] = [];
  block(p, 0, 0.72, 0.3, 0.2, 0.28, 0.18);
  block(p, 0.68, 1.36, 0.36, 0.24, 0.48, 0.3, 0.12);
  block(p, 1.34, 1.7, 0.2, 0.19, 0.18, 0.17, 0.02, 0.2);
  return toGeometry(p);
}

/** A small faceted shard hovering at knee height, its point forward. 8 triangles. */
export function gnatGeometry(): BufferGeometry {
  const c = 0.55;
  const v = [0, c, 0.62, 0, c, -0.38, 0.3, c, 0, -0.3, c, 0, 0, c + 0.28, 0.04, 0, c - 0.22, 0.04];
  const faces = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5];
  const p: number[] = [];
  for (let f = 0; f < faces.length; f += 3) tri(p, v, faces[f], faces[f + 1], faces[f + 2], 0, c, 0.04);
  return toGeometry(p);
}

/** A fat tapered block, 2.4 m, with a narrower cap. 24 triangles. */
export function bollardGeometry(): BufferGeometry {
  const p: number[] = [];
  block(p, 0, 1.85, 1.2, 1.2, 0.9, 0.9);
  block(p, 1.85, 2.4, 0.98, 0.98, 0.7, 0.7);
  return toGeometry(p);
}

function geometryFor(kind: number): BufferGeometry {
  if (kind === KIND_SHUFFLER) return shufflerGeometry();
  if (kind === KIND_GNAT) return gnatGeometry();
  if (kind === KIND_BOLLARD) return bollardGeometry();
  throw new Error(`no geometry for enemy kind ${kind}`);
}

// ---- material -------------------------------------------------------------------------------

/** The flat material, with the wobble in the vertex shader and the hit flash in the fragment shader. */
function enemyMaterial(kind: number, time: { value: number }): MeshLambertMaterial {
  const color = PALETTE.enemies[kind];
  const m = flatMaterial(color);
  m.emissive.setHex(color);
  m.emissiveIntensity = ENEMY_GLOW;
  const w = WOBBLE[kind];
  const wobble = { value: new Vector4(w.hop, w.rate, w.sway, w.idle) };
  const flash = { value: new Color(PALETTE.enemyFlash) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWobble = wobble;
    shader.uniforms.uFlashColor = flash;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aAnim;\nuniform float uTime;\nuniform vec4 uWobble;\nvarying float vFlash;',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float wPh = (uTime * uWobble.y + aAnim.x) * 6.2831853;',
          'float wAmt = mix(uWobble.w, 1.0, clamp(aAnim.y, 0.0, 1.0));',
          'float wS = sin(wPh);',
          'transformed.y += abs(wS) * uWobble.x * wAmt;',
          'transformed.x += wS * uWobble.z * position.y * wAmt;',
          'vFlash = aAnim.z;',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFlashColor;\nvarying float vFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'diffuseColor.rgb = mix(diffuseColor.rgb, uFlashColor, vFlash);',
          'totalEmissiveRadiance = mix(totalEmissiveRadiance, uFlashColor, vFlash);',
        ].join('\n'),
      );
  };
  return m;
}

// ---- the view -------------------------------------------------------------------------------

export class HordeView {
  readonly object = new Group();
  /** One per kind, indexed by `KIND_*`. */
  readonly meshes: InstancedMesh[] = [];
  readonly shadows: InstancedMesh;
  /** Seconds, for the wobble; shared by every enemy material. */
  private readonly time = { value: 0 };
  private readonly anim: InstancedBufferAttribute[] = [];
  private readonly counts = new Int32Array(KIND_COUNT);

  constructor() {
    this.object.name = 'horde';
    const shadowMat = flatMaterial(PALETTE.sky);
    shadowMat.transparent = true;
    shadowMat.opacity = SHADOW_OPACITY;
    shadowMat.depthWrite = false;
    shadowMat.polygonOffset = true;
    shadowMat.polygonOffsetFactor = -2;
    shadowMat.polygonOffsetUnits = -2;
    const shadowGeo = new CircleGeometry(1, SHADOW_SEGMENTS);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(shadowGeo, shadowMat, MAX_ENEMIES);
    this.shadows.name = 'horde-shadows';
    this.prepare(this.shadows);
    this.shadows.renderOrder = 1;
    this.object.add(this.shadows);

    for (let k = 0; k < KIND_COUNT; k++) {
      const geo = geometryFor(k);
      const anim = new InstancedBufferAttribute(new Float32Array(MAX_ENEMIES * 3), 3);
      anim.setUsage(DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new InstancedMesh(geo, enemyMaterial(k, this.time), MAX_ENEMIES);
      mesh.name = `horde-${KINDS[k].name}`;
      this.prepare(mesh);
      this.meshes.push(mesh);
      this.anim.push(anim);
      this.object.add(mesh);
    }
  }

  private prepare(mesh: InstancedMesh): void {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
  }

  /**
   * Draw the horde as it stands `alpha` (0..1) of the way from the previous tick to the latest.
   * `time` is in seconds; (mx, mz) is the mover, which standing enemies turn to face.
   */
  update(w: World, alpha: number, time: number, mx: number, mz: number): void {
    const h = w.horde;
    const back = (1 - alpha) * DT;
    const counts = this.counts;
    counts.fill(0);
    const shadow = this.shadows.instanceMatrix.array;
    this.time.value = time;

    for (let i = 0; i < h.count; i++) {
      const k = h.kind[i];
      const def = KINDS[k];
      const n = counts[k]++;
      const vx = h.vx[i];
      const vz = h.vz[i];
      const x = h.x[i] - vx * back;
      const y = h.y[i];
      const z = h.z[i] - vz * back;

      // Facing: +z of the model turned to (sin, cos) = the velocity, or toward the mover.
      let speed = Math.sqrt(vx * vx + vz * vz);
      let s = 0;
      let c = 1;
      if (speed > STILL_SPEED) {
        s = vx / speed;
        c = vz / speed;
      } else {
        speed = 0;
        const dx = mx - x;
        const dz = mz - z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 1e-4) {
          s = dx / l;
          c = dz / l;
        }
      }
      const age = h.age[i];
      const rise = age >= SPAWN_TICKS ? 1 : age / SPAWN_TICKS;

      const m = this.meshes[k].instanceMatrix.array;
      const o = n * 16;
      m[o] = c * rise;
      m[o + 1] = 0;
      m[o + 2] = -s * rise;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = rise;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s * rise;
      m[o + 9] = 0;
      m[o + 10] = c * rise;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;

      const a = this.anim[k].array as Float32Array;
      const f = h.flash[i];
      a[n * 3] = h.phase[i];
      a[n * 3 + 1] = speed / def.speed;
      a[n * 3 + 2] = f >= FLASH_FULL_TICKS ? 1 : f / FLASH_FULL_TICKS;

      const r = def.radius * SHADOW_SCALE * rise;
      const so = i * 16;
      shadow[so] = r;
      shadow[so + 1] = 0;
      shadow[so + 2] = 0;
      shadow[so + 3] = 0;
      shadow[so + 4] = 0;
      shadow[so + 5] = 1;
      shadow[so + 6] = 0;
      shadow[so + 7] = 0;
      shadow[so + 8] = 0;
      shadow[so + 9] = 0;
      shadow[so + 10] = r;
      shadow[so + 11] = 0;
      shadow[so + 12] = x;
      shadow[so + 13] = y + SHADOW_LIFT;
      shadow[so + 14] = z;
      shadow[so + 15] = 1;
    }

    for (let k = 0; k < KIND_COUNT; k++) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.visible = counts[k] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      this.anim[k].needsUpdate = true;
    }
    this.shadows.count = h.count;
    this.shadows.visible = h.count > 0;
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}
