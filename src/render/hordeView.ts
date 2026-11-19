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
 *
 * Seven silhouettes that cannot be mistaken for each other at 30 m: the chunky shuffler, the gnat's
 * shard, the fat bollard, the cutter leaning on its blade, the squat lobber with its ball held up,
 * the wide low sludge and the small spiky clinger. An elite is drawn `ELITE_SCALE` larger with a
 * white sheen, and its aura is a ring on the ground at the aura's reach in `AURA_COLORS`. A clinger
 * holding on (`STATE_LATCHED`) is drawn on the mover's back, not where the sim keeps it.
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
import { HORDE } from '../sim/horde';
import type { Terrain } from '../sim/terrain';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_NONE,
  ELITE_SHIELD,
  KIND_BOLLARD,
  KIND_CLINGER,
  KIND_COUNT,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KINDS,
  MAX_ENEMIES,
  SPAWN_TICKS,
  STATE_LATCHED,
  type World,
} from '../sim/world';
import { rgbInto } from './fxView';
import { PALETTE, flatMaterial } from './look';
import { GroundRings } from './zonesView';

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
/** An elite is drawn this much larger than its kind. */
export const ELITE_SCALE = 1.4;
/** An elite always shows this much of the flash colour (white), so it reads as special. */
const ELITE_SHEEN = 0.22;
/**
 * The colour of each aura's ring on the ground, by ELITE_*: haste orange (the Wake's fire), shield
 * blue (the second gear), jam magenta (the accent). Index 0 is unused.
 */
export const AURA_COLORS: readonly number[] = [PALETTE.elite, PALETTE.wake, PALETTE.gears[1], PALETTE.accent];
/** Width of an aura's ring at the edge of its reach, m, and its strength. */
const AURA_BAND = 0.4;
const AURA_FADE = 0.55;
const AURA_SEGMENTS = 48;
const AURA_LIFT = 0.15;
/** Most aura rings drawn at once. */
export const MAX_AURA_RINGS = 32;
/**
 * A latched clinger rides on the mover's back: this far behind its middle, spread this far across
 * by its phase, and between these heights above its feet, m.
 */
const RIDE_BACK = 0.3;
const RIDE_SPREAD = 0.6;
const RIDE_LOW = 0.45;
const RIDE_HIGH = 1.05;
/** How far a clinger's spikes reach from its middle, m. */
const CLINGER_SPIKE = 0.6;
/** The clinger's middle above its feet: it stands on its lowest spike, m. */
const CLINGER_MID = CLINGER_SPIKE / Math.sqrt(3);

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
  // Cutter: a quick, low sprint.
  { hop: 0.06, rate: 4.6, sway: 0.04, idle: 0.15 },
  // Lobber: a heavy rock from foot to foot.
  { hop: 0.08, rate: 1.7, sway: 0.07, idle: 0.35 },
  // Sludge: a slow ooze.
  { hop: 0.03, rate: 0.9, sway: 0.12, idle: 0.5 },
  // Clinger: never still.
  { hop: 0.14, rate: 9, sway: 0.3, idle: 1 },
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

/** A pyramid from the quad (corners, in order) to an apex. Four triangles. */
function pyramid(out: number[], quad: readonly number[], ax: number, ay: number, az: number): void {
  const p = [...quad, ax, ay, az];
  let cx = ax;
  let cy = ay;
  let cz = az;
  for (let k = 0; k < 4; k++) {
    cx += quad[k * 3];
    cy += quad[k * 3 + 1];
    cz += quad[k * 3 + 2];
  }
  cx /= 5;
  cy /= 5;
  cz /= 5;
  for (let k = 0; k < 4; k++) tri(out, p, k, (k + 1) % 4, 4, cx, cy, cz);
}

/**
 * Lean and pointed forward, 1.5 m: thin legs, a torso pitched hard toward the mover and a blade
 * jutting from the chest. 28 triangles.
 */
export function cutterGeometry(): BufferGeometry {
  const p: number[] = [];
  block(p, 0, 0.62, 0.17, 0.13, 0.15, 0.12);
  block(p, 0.58, 1.5, 0.22, 0.16, 0.14, 0.12, 0.42);
  // The blade: a long point forward from the front of the chest.
  const y0 = 0.86;
  const y1 = 1.22;
  const zf = 0.2;
  pyramid(p, [-0.16, y0, zf, 0.16, y0, zf, 0.1, y1, zf + 0.22, -0.1, y1, zf + 0.22], 0, 1.02, 0.95);
  return toGeometry(p);
}

/**
 * Squat with something raised to throw, 1.9 m: a wide low body, one arm up over its head and the
 * ball held at the top. 32 triangles.
 */
export function lobberGeometry(): BufferGeometry {
  const p: number[] = [];
  block(p, 0, 1.0, 0.6, 0.5, 0.42, 0.36);
  // The arm, up and a little back.
  block(p, 0.95, 1.6, 0.11, 0.11, 0.09, 0.09, -0.1, -0.05);
  // The ball: a diamond at the top of the reach.
  const c = 1.72;
  const r = 0.18;
  const bz = -0.15;
  const v = [0, c + r, bz, 0, c - r, bz, r, c, bz, -r, c, bz, 0, c, bz + r, 0, c, bz - r];
  const faces = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5];
  for (let f = 0; f < faces.length; f += 3) tri(p, v, faces[f], faces[f + 1], faces[f + 2], 0, c, bz);
  return toGeometry(p);
}

/** Wide and low, 1.1 m: a broad mound with a lumpy crown. 24 triangles. */
export function sludgeGeometry(): BufferGeometry {
  const p: number[] = [];
  block(p, 0, 0.5, 0.95, 0.95, 0.85, 0.8);
  block(p, 0.48, 1.1, 0.8, 0.75, 0.35, 0.3, 0.12);
  return toGeometry(p);
}

/**
 * Small and spiky, 0.7 m: an octahedron with every face pulled out to a point, standing on its
 * lowest spike. 24 triangles.
 */
export function clingerGeometry(): BufferGeometry {
  const c = CLINGER_MID;
  const r = 0.22;
  const v = [0, c + r, 0, 0, c - r, 0, r, c, 0, -r, c, 0, 0, c, r, 0, c, -r];
  const faces = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5];
  const p: number[] = [];
  const spike = CLINGER_SPIKE;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f];
    const b = faces[f + 1];
    const d = faces[f + 2];
    // The face's middle pushed out from the centre to the spike's reach.
    let mx = (v[a * 3] + v[b * 3] + v[d * 3]) / 3;
    let my = (v[a * 3 + 1] + v[b * 3 + 1] + v[d * 3 + 1]) / 3 - c;
    let mz = (v[a * 3 + 2] + v[b * 3 + 2] + v[d * 3 + 2]) / 3;
    const l = Math.sqrt(mx * mx + my * my + mz * mz);
    mx = (mx / l) * spike;
    my = (my / l) * spike;
    mz = (mz / l) * spike;
    const q = [v[a * 3], v[a * 3 + 1], v[a * 3 + 2], v[b * 3], v[b * 3 + 1], v[b * 3 + 2], v[d * 3], v[d * 3 + 1], v[d * 3 + 2], mx, c + my, mz];
    tri(p, q, 0, 1, 3, 0, c, 0);
    tri(p, q, 1, 2, 3, 0, c, 0);
    tri(p, q, 2, 0, 3, 0, c, 0);
  }
  return toGeometry(p);
}

/** The shape of each kind, by KIND_*. */
export function geometryFor(kind: number): BufferGeometry {
  if (kind === KIND_SHUFFLER) return shufflerGeometry();
  if (kind === KIND_GNAT) return gnatGeometry();
  if (kind === KIND_BOLLARD) return bollardGeometry();
  if (kind === KIND_CUTTER) return cutterGeometry();
  if (kind === KIND_LOBBER) return lobberGeometry();
  if (kind === KIND_SLUDGE) return sludgeGeometry();
  if (kind === KIND_CLINGER) return clingerGeometry();
  throw new Error(`no shape for enemy kind ${kind}`);
}

function wobbleFor(kind: number): Wobble {
  return kind < WOBBLE.length ? WOBBLE[kind] : WOBBLE[KIND_SHUFFLER];
}

// ---- material -------------------------------------------------------------------------------

/** The flat material, with the wobble in the vertex shader and the hit flash in the fragment shader. */
function enemyMaterial(kind: number, time: { value: number }): MeshLambertMaterial {
  const color = PALETTE.enemies[kind];
  const m = flatMaterial(color);
  m.emissive.setHex(color);
  m.emissiveIntensity = ENEMY_GLOW;
  const w = wobbleFor(kind);
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
  /** The elites' auras: a ring on the ground at the aura's reach, in the aura's colour. */
  readonly auras: GroundRings;
  /** Seconds, for the wobble; shared by every enemy material. */
  private readonly time = { value: 0 };
  private readonly anim: InstancedBufferAttribute[] = [];
  private readonly counts = new Int32Array(KIND_COUNT);
  /** Linear RGB per aura, by ELITE_*. */
  private readonly auraRgb = new Float32Array(AURA_COLORS.length * 3);

  /** With a terrain, the aura rings follow the ground; without, they lie level at the elite's feet. */
  constructor(terrain: Terrain | null = null) {
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

    for (let a = 0; a < AURA_COLORS.length; a++) rgbInto(this.auraRgb, a * 3, AURA_COLORS[a]);
    this.auras = new GroundRings(MAX_AURA_RINGS, AURA_SEGMENTS, 'horde-auras', terrain, AURA_LIFT);
    this.object.add(this.auras.mesh);
  }

  private prepare(mesh: InstancedMesh): void {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
  }

  /**
   * Draw the horde as it stands `alpha` (0..1) of the way from the previous tick to the latest.
   * `time` is in seconds; (mx, my, mz) is the mover as drawn, which standing enemies turn to face and
   * latched clingers ride, and `heading` the way it faces.
   */
  update(w: World, alpha: number, time: number, mx: number, mz: number, my = 0, heading = 0): void {
    const h = w.horde;
    const back = (1 - alpha) * DT;
    const counts = this.counts;
    counts.fill(0);
    const shadow = this.shadows.instanceMatrix.array;
    this.time.value = time;
    this.auras.begin();
    const hs = Math.sin(heading);
    const hc = Math.cos(heading);

    for (let i = 0; i < h.count; i++) {
      const k = h.kind[i];
      const def = KINDS[k];
      const n = counts[k]++;
      const vx = h.vx[i];
      const vz = h.vz[i];
      let x = h.x[i] - vx * back;
      let y = h.y[i];
      let z = h.z[i] - vz * back;

      // Facing: +z of the model turned to (sin, cos) = the velocity, or toward the mover.
      let speed = Math.sqrt(vx * vx + vz * vz);
      let s = 0;
      let c = 1;
      const latched = h.state[i] === STATE_LATCHED && def.latches === true;
      if (latched) {
        // On the mover's back, facing out behind it, spread across and up by its phase.
        const ph = h.phase[i];
        const across = (ph - 0.5) * RIDE_SPREAD;
        const up = RIDE_LOW + (RIDE_HIGH - RIDE_LOW) * ((ph * 7.31) % 1);
        x = mx - hs * RIDE_BACK + hc * across;
        y = my + up - CLINGER_MID;
        z = mz - hc * RIDE_BACK - hs * across;
        s = -hs;
        c = -hc;
        speed = 0;
      } else if (speed > STILL_SPEED) {
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
      const elite = h.elite[i];
      const scale = elite !== ELITE_NONE ? rise * ELITE_SCALE : rise;

      const m = this.meshes[k].instanceMatrix.array;
      const o = n * 16;
      m[o] = c * scale;
      m[o + 1] = 0;
      m[o + 2] = -s * scale;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = scale;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s * scale;
      m[o + 9] = 0;
      m[o + 10] = c * scale;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;

      const a = this.anim[k].array as Float32Array;
      const f = h.flash[i];
      let flash = f >= FLASH_FULL_TICKS ? 1 : f / FLASH_FULL_TICKS;
      if (elite !== ELITE_NONE && flash < ELITE_SHEEN) flash = ELITE_SHEEN;
      a[n * 3] = h.phase[i];
      a[n * 3 + 1] = speed / def.speed;
      a[n * 3 + 2] = flash;

      // A rider casts no shadow of its own: the mover's covers it.
      const r = latched ? 0 : def.radius * SHADOW_SCALE * scale;
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

      if (elite === ELITE_HASTE || elite === ELITE_SHIELD || elite === ELITE_JAM) {
        const reach = HORDE.auraReach;
        this.auras.add(x, y, z, reach - AURA_BAND, reach, this.auraRgb, elite * 3, AURA_FADE * rise);
      }
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
    this.auras.end();
  }
}
