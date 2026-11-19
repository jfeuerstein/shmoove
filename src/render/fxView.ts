/**
 * One-off effects, read from the world's per-tick `fx` queue, and the few surfaces every view that
 * draws a glow shares.
 *
 * - `FX_POP`, `FX_SLAM`, `FX_BLAST`: flat glows on the ground, one instanced mesh of discs whose
 *   inner part can be cut away so the same instance is a ring or a flash. Pop: a ring out to the
 *   loop's radius and a flash in `PALETTE.pop`. Slam: a ring out to the wave's radius in
 *   `PALETTE.slam`. Blast: a flash and a ring in the mine's colour.
 * - `FX_ENEMY_DIE`: a small burst of shards in the enemy's colour; `FX_THING`: the same in the
 *   thing's colour (one instanced pool of 256 for both).
 * - `FX_ARC`: each run of links in a tick (0, 1, 2, ...) is one jagged bolt from the mover through
 *   the struck enemies in order, gone in `BOLT_LIFE`.
 * - `FX_HEAL`, `FX_TOKEN`: a small mark rising from the mover.
 * - `FX_PLAYER_HIT`: `hitTint` jumps up and decays; the UI overlay draws it as a red wash.
 *
 * `ingest` must be called once per tick, right after the step (the queue is only valid until the
 * next one); `update` once per frame. Nothing allocates after construction.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type MeshLambertMaterial,
  OctahedronGeometry,
  TetrahedronGeometry,
} from 'three';
import type { Terrain } from '../sim/terrain';
import {
  FX_ARC,
  FX_BLAST,
  FX_ENEMY_DIE,
  FX_HEAL,
  FX_PLAYER_HIT,
  FX_POP,
  FX_SLAM,
  FX_THING,
  FX_TOKEN,
  KIND_COUNT,
  KINDS,
  type World,
} from '../sim/world';
import { PALETTE, flatMaterial } from './look';

// ---- shared surfaces --------------------------------------------------------------------------

/**
 * An additive, glowing, fogged surface whose strength fades through the float attribute `aFade`
 * (per instance or per vertex). With instance or vertex colours, the glow takes that colour too.
 */
export function fadeMaterial(color: number, vertexColors = false): MeshLambertMaterial {
  const m = flatMaterial(color, vertexColors);
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= vFade;');
  };
  return m;
}

/**
 * Additive flat discs on the ground (geometry: a unit `CircleGeometry` laid flat). Per instance,
 * `aDisc` = (inner, core, fade): the band from `inner` to the rim shows at full strength, the core
 * out to `core` at `coreShare` of it, and the rest is cut away. A ring is inner 0.9, a flash inner 0,
 * a filling target inner 0.85 with a growing core. Colour from the instance colour.
 */
export function discMaterial(coreShare: number): MeshLambertMaterial {
  const m = flatMaterial(0xffffff);
  m.emissive.setHex(0xffffff);
  m.emissiveIntensity = 1;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = AdditiveBlending;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDisc;\nvarying vec3 vDisc;\nvarying vec2 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDisc = aDisc;\nvLocal = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDisc;\nvarying vec2 vLocal;`)
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif',
      )
      .replace(
        '#include <opaque_fragment>',
        [
          '#include <opaque_fragment>',
          'float dR = length(vLocal);',
          `float dA = dR >= vDisc.x ? 1.0 : (dR <= vDisc.y ? ${coreShare.toFixed(3)} : 0.0);`,
          'if (dA <= 0.0) discard;',
          'gl_FragColor.a *= dA * vDisc.z;',
        ].join('\n'),
      );
  };
  return m;
}

/**
 * The flat lit surface for instanced solids of many colours: the instance colour is the surface and,
 * scaled by the float attribute `aGlow`, its glow.
 */
export function tintMaterial(): MeshLambertMaterial {
  const m = flatMaterial(0xffffff);
  m.emissive.setHex(0xffffff);
  m.emissiveIntensity = 1;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance = vColor.rgb * vGlow;\n#else\ntotalEmissiveRadiance *= vGlow;\n#endif',
      );
  };
  return m;
}

/** An instanced mesh drawn from dynamic data: nothing shown until `count` is set, never culled. */
export function makeInstanced(geo: BufferGeometry, mat: MeshLambertMaterial, n: number, name: string): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, n);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

/** Give a mesh dynamic instance colours (before it is first drawn). */
export function addInstanceColor(mesh: InstancedMesh, n: number): Float32Array {
  const a = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
  a.setUsage(DynamicDrawUsage);
  mesh.instanceColor = a;
  return a.array as Float32Array;
}

/** A dynamic per-instance float attribute on a geometry. */
export function addInstanceFloat(geo: BufferGeometry, name: string, n: number, size = 1): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

/** Linear RGB of a palette colour into `out` at `o`. */
export function rgbInto(out: Float32Array, o: number, color: number, scale = 1): void {
  const c = scratchColor.setHex(color);
  out[o] = c.r * scale;
  out[o + 1] = c.g * scale;
  out[o + 2] = c.b * scale;
}
const scratchColor = new Color();

/** Write a matrix with columns a, b, c and translation (x, y, z) at slot `i`. */
export function writeMatrix(
  m: { [i: number]: number },
  i: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  x: number, y: number, z: number,
): void {
  const o = i * 16;
  m[o] = ax;
  m[o + 1] = ay;
  m[o + 2] = az;
  m[o + 3] = 0;
  m[o + 4] = bx;
  m[o + 5] = by;
  m[o + 6] = bz;
  m[o + 7] = 0;
  m[o + 8] = cx;
  m[o + 9] = cy;
  m[o + 10] = cz;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/** A matrix that scales x and z by `s` (y by `sy`) and translates, at slot `i`. */
export function flatMatrix(m: { [i: number]: number }, i: number, s: number, sy: number, x: number, y: number, z: number): void {
  writeMatrix(m, i, s, 0, 0, 0, sy, 0, 0, 0, s, x, y, z);
}

/**
 * A unit box (centred, 1 m each way) stretched from (x0, y0, z0) to (x1, y1, z1), `width` across and
 * `height` up, at slot `i`. Its +z runs along the segment.
 */
export function segmentMatrix(
  m: { [i: number]: number },
  i: number,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  width: number,
  height: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let fx = 0;
  let fy = 0;
  let fz = 1;
  if (l > 1e-6) {
    fx = dx / l;
    fy = dy / l;
    fz = dz / l;
  }
  // Right r = up x f, up u = f x r.
  let rx = fz;
  let rz = -fx;
  const rl = Math.sqrt(rx * rx + rz * rz);
  if (rl > 1e-4) {
    rx /= rl;
    rz /= rl;
  } else {
    rx = 1;
    rz = 0;
  }
  const ux = fy * rz;
  const uy = fz * rx - fx * rz;
  const uz = -fy * rx;
  writeMatrix(
    m, i,
    rx * width, 0, rz * width,
    ux * height, uy * height, uz * height,
    fx * l, fy * l, fz * l,
    (x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5,
  );
}

// ---- the effects ------------------------------------------------------------------------------

/** Ground glows (rings and flashes) alive at once; a new one takes the oldest one's place. */
export const GLOW_POOL = 16;
export const SHARD_POOL = 256;
export const BOLT_POOL = 6;
/** Most links in one bolt (Static's longest chain). */
export const BOLT_LINKS = 8;
/** Points per link: the link's end and the jagged points before it. */
export const BOLT_JAG = 3;
export const BOLT_POINTS = 1 + BOLT_LINKS * BOLT_JAG;
/** Seconds a bolt shows. */
export const BOLT_LIFE = 0.15;
export const MARK_POOL = 8;

/** A bolt starts at the mover's chest and strikes each enemy this high above its feet, m. */
export const BOLT_FROM = 1;
export const BOLT_TO = 0.8;
/** A jagged point is pushed off the straight line by up to this share of the link, capped, m. */
const BOLT_WANDER = 0.18;
const BOLT_WANDER_MAX = 0.7;
const BOLT_WIDTH = 0.13;

const GLOW_RING = 0;
const GLOW_FLASH = 1;
/** Height of a glow above the ground, m. */
const GLOW_LIFT = 0.2;
/** Shards per death, scaled by the enemy's size; their life, launch speeds and gravity. */
const SHARDS_PER_DEATH = 6;
const SHARDS_PER_THING = 8;
const SHARD_LIFE = 0.55;
const SHARD_SIZE = 0.2;
const SHARD_UP = 6;
const SHARD_OUT = 4.5;
const SHARD_GRAVITY = 22;
/** A rising mark: how high it goes, how long it lasts, its size. */
const MARK_RISE = 1.6;
const MARK_LIFE = 0.7;
const MARK_SIZE = 0.3;
const MARK_FROM = 1.2;
/** Red wash after a hit: strength for a hit of `HIT_REF` damage or more, and its fade time, s. */
const HIT_MIN = 0.35;
const HIT_MAX = 0.7;
const HIT_REF = 15;
const HIT_FADE = 0.4;

/** Shard colours: the enemy kinds, then the things. */
const THING_COLOR_BASE = KIND_COUNT;
const SHARD_COLORS = [...PALETTE.enemies, ...PALETTE.things];
/** Mark colours. */
const MARK_HEAL = 0;
const MARK_TOKEN = 1;
const MARK_COLORS = [PALETTE.hp, PALETTE.things[1]];

export class FxView {
  readonly object = new Group();
  /** Rings and flashes on the ground: pops, slams, blasts. */
  readonly glows: InstancedMesh;
  readonly shards: InstancedMesh;
  /** The Static's bolts, as thin bright segments. */
  readonly bolts: InstancedMesh;
  /** Heals and tokens rising from the mover. */
  readonly marks: InstancedMesh;
  /** 0..1: how strongly the frame is washed red after a hit. */
  hitTint = 0;

  private readonly terrain: Terrain;
  private readonly glowDisc: InstancedBufferAttribute;
  private readonly glowRgb: Float32Array;
  private readonly boltFade: InstancedBufferAttribute;
  private readonly markGlow: InstancedBufferAttribute;
  private readonly markRgb: Float32Array;

  // Glows: a ring buffer of GLOW_POOL slots; age < 0 is free.
  private readonly gx = new Float32Array(GLOW_POOL);
  private readonly gy = new Float32Array(GLOW_POOL);
  private readonly gz = new Float32Array(GLOW_POOL);
  private readonly gr = new Float32Array(GLOW_POOL);
  private readonly gAge = new Float32Array(GLOW_POOL).fill(-1);
  private readonly gLife = new Float32Array(GLOW_POOL);
  private readonly gPeak = new Float32Array(GLOW_POOL);
  private readonly gInner = new Float32Array(GLOW_POOL);
  private readonly gType = new Uint8Array(GLOW_POOL);
  private readonly gRgb = new Float32Array(GLOW_POOL * 3);
  private glowNext = 0;

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
  private readonly scol = new Uint8Array(SHARD_POOL);
  /** Linear RGB per shard colour. */
  private readonly shardRgb = new Float32Array(SHARD_COLORS.length * 3);

  // Bolts: a ring buffer of BOLT_POOL; age < 0 is free.
  /** Points of each bolt, BOLT_POINTS (x, y, z) per bolt. */
  readonly boltPoints = new Float32Array(BOLT_POOL * BOLT_POINTS * 3);
  /** How many points each bolt has (1 + links * BOLT_JAG). */
  readonly boltCount = new Int32Array(BOLT_POOL);
  private readonly boltAge = new Float32Array(BOLT_POOL).fill(-1);
  private readonly boltLinks = new Int32Array(BOLT_POOL);
  private boltNext = 0;
  /** The bolt being built from this tick's links, or -1. */
  private boltOpen = -1;

  // Marks: a ring buffer of MARK_POOL; age < 0 is free.
  private readonly mx = new Float32Array(MARK_POOL);
  private readonly my = new Float32Array(MARK_POOL);
  private readonly mz = new Float32Array(MARK_POOL);
  private readonly mAge = new Float32Array(MARK_POOL).fill(-1);
  private readonly mCol = new Uint8Array(MARK_POOL);
  private markNext = 0;

  /** Cheap deterministic noise for shard directions and bolt jags. */
  private seed = 0x9e3779b9;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.object.name = 'fx';

    const glowGeo = new CircleGeometry(1, 48);
    glowGeo.rotateX(-Math.PI / 2);
    this.glowDisc = addInstanceFloat(glowGeo, 'aDisc', GLOW_POOL, 3);
    this.glows = makeInstanced(glowGeo, discMaterial(0), GLOW_POOL, 'fx-glows');
    this.glowRgb = addInstanceColor(this.glows, GLOW_POOL);

    this.shards = makeInstanced(new TetrahedronGeometry(SHARD_SIZE, 0), flatMaterial(0xffffff), SHARD_POOL, 'fx-shards');
    const shardCol = addInstanceColor(this.shards, SHARD_POOL);
    shardCol.fill(1);
    for (let k = 0; k < SHARD_COLORS.length; k++) rgbInto(this.shardRgb, k * 3, SHARD_COLORS[k]);

    const boltGeo = new BoxGeometry(1, 1, 1);
    this.boltFade = addInstanceFloat(boltGeo, 'aFade', BOLT_POOL * (BOLT_POINTS - 1));
    this.bolts = makeInstanced(boltGeo, fadeMaterial(PALETTE.arc), BOLT_POOL * (BOLT_POINTS - 1), 'fx-bolts');

    const markGeo = new OctahedronGeometry(MARK_SIZE, 0);
    this.markGlow = addInstanceFloat(markGeo, 'aGlow', MARK_POOL);
    this.marks = makeInstanced(markGeo, tintMaterial(), MARK_POOL, 'fx-marks');
    this.markRgb = addInstanceColor(this.marks, MARK_POOL);

    this.glows.renderOrder = 2;
    this.bolts.renderOrder = 3;
    this.object.add(this.glows, this.shards, this.bolts, this.marks);
  }

  /** Live shards, for tests. */
  get liveShards(): number {
    return this.shardCount;
  }

  /** Live ground glows (rings and flashes), for tests. */
  get liveGlows(): number {
    let n = 0;
    for (let i = 0; i < GLOW_POOL; i++) if (this.gAge[i] >= 0) n++;
    return n;
  }

  /** Live bolts, for tests. */
  get liveBolts(): number {
    let n = 0;
    for (let i = 0; i < BOLT_POOL; i++) if (this.boltAge[i] >= 0) n++;
    return n;
  }

  /** Live rising marks, for tests. */
  get liveMarks(): number {
    let n = 0;
    for (let i = 0; i < MARK_POOL; i++) if (this.mAge[i] >= 0) n++;
    return n;
  }

  /** Drop everything still playing from the last run. */
  reset(): void {
    this.hitTint = 0;
    this.gAge.fill(-1);
    this.glowNext = 0;
    this.shardCount = 0;
    this.boltAge.fill(-1);
    this.boltCount.fill(0);
    this.boltNext = 0;
    this.boltOpen = -1;
    this.mAge.fill(-1);
    this.markNext = 0;
    for (const mesh of [this.glows, this.shards, this.bolts, this.marks]) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }

  private rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Take this tick's effects. Call once per tick, right after `sim.step`. (mx, my, mz) is where the
   * mover's feet are after the step: bolts start there.
   */
  ingest(w: World, mx = 0, my = 0, mz = 0): void {
    const f = w.fx;
    this.boltOpen = -1;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      const x = f.x[i];
      const y = f.y[i];
      const z = f.z[i];
      const a = f.a[i];
      if (type === FX_POP) {
        const r = a > 0.5 ? a : 0.5;
        this.glow(GLOW_RING, x, y, z, r, 0.5, 1, 0.88, PALETTE.pop);
        this.glow(GLOW_FLASH, x, y, z, r, 0.3, 0.55, 0, PALETTE.pop);
      } else if (type === FX_SLAM) {
        const r = a > 0.5 ? a : 0.5;
        this.glow(GLOW_RING, x, y, z, r, 0.45, 0.7, 0.82, PALETTE.slam);
        this.glow(GLOW_FLASH, x, y, z, r, 0.2, 0.25, 0, PALETTE.slam);
      } else if (type === FX_BLAST) {
        const r = a > 0.5 ? a : 0.5;
        this.glow(GLOW_FLASH, x, y, z, r, 0.18, 0.8, 0, PALETTE.zones[0]);
        this.glow(GLOW_RING, x, y, z, r, 0.35, 0.9, 0.8, PALETTE.zones[0]);
      } else if (type === FX_ENEMY_DIE) {
        const k = a | 0;
        const def = KINDS[k >= 0 && k < KIND_COUNT ? k : 0];
        this.burst(k >= 0 && k < KIND_COUNT ? k : 0, x, y + def.height * 0.5, z, def.radius, SHARDS_PER_DEATH);
      } else if (type === FX_THING) {
        const k = a | 0;
        if (k >= 0 && k < PALETTE.things.length) this.burst(THING_COLOR_BASE + k, x, y + 0.8, z, 0.7, SHARDS_PER_THING);
      } else if (type === FX_ARC) {
        this.arc(a | 0, x, y, z, mx, my, mz);
      } else if (type === FX_HEAL) {
        this.mark(MARK_HEAL, x, y, z);
      } else if (type === FX_TOKEN) {
        this.mark(MARK_TOKEN, x, y, z);
      } else if (type === FX_PLAYER_HIT) {
        const s = HIT_MIN + (HIT_MAX - HIT_MIN) * Math.min(1, a / HIT_REF);
        if (s > this.hitTint) this.hitTint = s;
      }
    }
    this.boltOpen = -1;
  }

  private glow(type: number, x: number, y: number, z: number, r: number, life: number, peak: number, inner: number, color: number): void {
    const p = this.glowNext;
    this.glowNext = (p + 1) % GLOW_POOL;
    this.gType[p] = type;
    this.gx[p] = x;
    this.gy[p] = y;
    this.gz[p] = z;
    this.gr[p] = r;
    this.gAge[p] = 0;
    this.gLife[p] = life;
    this.gPeak[p] = peak;
    this.gInner[p] = inner;
    rgbInto(this.gRgb, p * 3, color);
  }

  private burst(col: number, x: number, y: number, z: number, radius: number, perUnit: number): void {
    const n = Math.max(3, Math.round(perUnit * Math.sqrt(radius / 0.6)));
    const size = 0.6 + radius * 0.6;
    for (let j = 0; j < n; j++) {
      // A full pool overwrites a live shard at random: in a crowd nobody notices which.
      const i = this.shardCount < SHARD_POOL ? this.shardCount++ : Math.floor(this.rand() * SHARD_POOL);
      const a = this.rand() * Math.PI * 2;
      const out = SHARD_OUT * (0.5 + this.rand());
      this.sx[i] = x;
      this.sy[i] = y;
      this.sz[i] = z;
      this.svx[i] = Math.cos(a) * out;
      this.svz[i] = Math.sin(a) * out;
      this.svy[i] = SHARD_UP * (0.6 + 0.6 * this.rand());
      this.sage[i] = 0;
      this.sspin[i] = this.rand() * Math.PI * 2;
      this.ssize[i] = size * (0.7 + 0.6 * this.rand());
      this.scol[i] = col;
    }
  }

  /** One link of a chain: the first of a run starts a new bolt at the mover; the rest extend it. */
  private arc(link: number, x: number, y: number, z: number, mx: number, my: number, mz: number): void {
    let b = this.boltOpen;
    if (link === 0 || b < 0 || this.boltLinks[b] !== link || this.boltLinks[b] >= BOLT_LINKS) {
      b = this.boltNext;
      this.boltNext = (b + 1) % BOLT_POOL;
      this.boltOpen = b;
      this.boltAge[b] = 0;
      this.boltLinks[b] = 0;
      this.boltCount[b] = 1;
      const o = b * BOLT_POINTS * 3;
      this.boltPoints[o] = mx;
      this.boltPoints[o + 1] = my + BOLT_FROM;
      this.boltPoints[o + 2] = mz;
    }
    const pts = this.boltPoints;
    const base = b * BOLT_POINTS * 3;
    const n = this.boltCount[b];
    const px = pts[base + (n - 1) * 3];
    const py = pts[base + (n - 1) * 3 + 1];
    const pz = pts[base + (n - 1) * 3 + 2];
    const ex = x;
    const ey = y + BOLT_TO;
    const ez = z;
    const dx = ex - px;
    const dz = ez - pz;
    const l = Math.sqrt(dx * dx + (ey - py) * (ey - py) + dz * dz);
    const wander = Math.min(BOLT_WANDER_MAX, l * BOLT_WANDER);
    // Sideways in the ground plane, unit.
    const hl = Math.sqrt(dx * dx + dz * dz);
    const sx = hl > 1e-6 ? -dz / hl : 1;
    const sz = hl > 1e-6 ? dx / hl : 0;
    let k = n;
    for (let j = 1; j < BOLT_JAG; j++) {
      const t = j / BOLT_JAG;
      const side = (this.rand() * 2 - 1) * wander;
      const up = (this.rand() * 2 - 1) * wander * 0.6;
      const o = base + k * 3;
      pts[o] = px + dx * t + sx * side;
      pts[o + 1] = py + (ey - py) * t + up;
      pts[o + 2] = pz + dz * t + sz * side;
      k++;
    }
    const o = base + k * 3;
    pts[o] = ex;
    pts[o + 1] = ey;
    pts[o + 2] = ez;
    this.boltCount[b] = k + 1;
    this.boltLinks[b]++;
  }

  private mark(col: number, x: number, y: number, z: number): void {
    const p = this.markNext;
    this.markNext = (p + 1) % MARK_POOL;
    this.mx[p] = x;
    this.my[p] = y + MARK_FROM;
    this.mz[p] = z;
    this.mAge[p] = 0;
    this.mCol[p] = col;
  }

  /** Advance and draw. `dt` is the real time since the last frame, s. */
  update(dt: number): void {
    const step = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    this.hitTint = Math.max(0, this.hitTint - step / HIT_FADE);
    this.updateGlows(step);
    this.updateShards(step);
    this.updateBolts(step);
    this.updateMarks(step);
  }

  private updateGlows(step: number): void {
    const gm = this.glows.instanceMatrix.array;
    const disc = this.glowDisc.array as Float32Array;
    let n = 0;
    for (let p = 0; p < GLOW_POOL; p++) {
      if (this.gAge[p] < 0) continue;
      const age = (this.gAge[p] += step);
      if (age >= this.gLife[p]) {
        this.gAge[p] = -1;
        continue;
      }
      const t = age / this.gLife[p];
      let r = this.gr[p];
      let fade = this.gPeak[p] * (1 - t);
      if (this.gType[p] === GLOW_RING) {
        const grow = 1 - (1 - t) * (1 - t) * (1 - t);
        r *= 0.25 + 0.75 * grow;
      } else {
        fade *= 1 - t;
      }
      flatMatrix(gm, n, r, 1, this.gx[p], this.gy[p] + GLOW_LIFT, this.gz[p]);
      disc[n * 3] = this.gInner[p];
      disc[n * 3 + 1] = 0;
      disc[n * 3 + 2] = fade;
      this.glowRgb[n * 3] = this.gRgb[p * 3];
      this.glowRgb[n * 3 + 1] = this.gRgb[p * 3 + 1];
      this.glowRgb[n * 3 + 2] = this.gRgb[p * 3 + 2];
      n++;
    }
    this.glows.count = n;
    this.glows.visible = n > 0;
    if (n > 0) {
      this.glows.instanceMatrix.needsUpdate = true;
      this.glowDisc.needsUpdate = true;
      if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    }
  }

  private updateShards(step: number): void {
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
      writeMatrix(sm, i, cb, 0, -sb, sb * sa, ca * s, cb * sa, sb * ca, -sa * s, cb * ca, this.sx[i], this.sy[i], this.sz[i]);
      if (sc) {
        const k = this.scol[i] * 3;
        sc[i * 3] = this.shardRgb[k];
        sc[i * 3 + 1] = this.shardRgb[k + 1];
        sc[i * 3 + 2] = this.shardRgb[k + 2];
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

  private updateBolts(step: number): void {
    const bm = this.bolts.instanceMatrix.array;
    const fade = this.boltFade.array as Float32Array;
    const pts = this.boltPoints;
    let n = 0;
    for (let b = 0; b < BOLT_POOL; b++) {
      if (this.boltAge[b] < 0) continue;
      const age = (this.boltAge[b] += step);
      if (age >= BOLT_LIFE) {
        this.boltAge[b] = -1;
        continue;
      }
      const f = 1 - age / BOLT_LIFE;
      const base = b * BOLT_POINTS * 3;
      for (let k = 1; k < this.boltCount[b]; k++) {
        const o = base + k * 3;
        segmentMatrix(bm, n, pts[o - 3], pts[o - 2], pts[o - 1], pts[o], pts[o + 1], pts[o + 2], BOLT_WIDTH, BOLT_WIDTH);
        fade[n++] = f;
      }
    }
    this.bolts.count = n;
    this.bolts.visible = n > 0;
    if (n > 0) {
      this.bolts.instanceMatrix.needsUpdate = true;
      this.boltFade.needsUpdate = true;
    }
  }

  private updateMarks(step: number): void {
    const mm = this.marks.instanceMatrix.array;
    const glow = this.markGlow.array as Float32Array;
    let n = 0;
    for (let p = 0; p < MARK_POOL; p++) {
      if (this.mAge[p] < 0) continue;
      const age = (this.mAge[p] += step);
      if (age >= MARK_LIFE) {
        this.mAge[p] = -1;
        continue;
      }
      const t = age / MARK_LIFE;
      const s = 1 - t * t;
      const spin = age * 7;
      const c = Math.cos(spin) * s;
      const sn = Math.sin(spin) * s;
      writeMatrix(mm, n, c, 0, -sn, 0, s * 1.4, 0, sn, 0, c, this.mx[p], this.my[p] + MARK_RISE * (1 - (1 - t) * (1 - t)), this.mz[p]);
      rgbInto(this.markRgb, n * 3, MARK_COLORS[this.mCol[p]]);
      glow[n++] = 0.8;
    }
    this.marks.count = n;
    this.marks.visible = n > 0;
    if (n > 0) {
      this.marks.instanceMatrix.needsUpdate = true;
      this.markGlow.needsUpdate = true;
      if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
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
    this.scol[i] = this.scol[j];
  }
}
