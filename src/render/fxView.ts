/**
 * One-off effects, read from the world's per-tick `fx` queue, and the few surfaces and shape tools
 * every view that draws a glow or a toy shares.
 *
 * - `FX_POP`, `FX_SLAM`, `FX_BLAST`: flat glows laid on the ground (tilted to the slope at their
 *   centre), one instanced mesh of discs whose inner part can be cut away so the same instance is a
 *   ring or a flash. Pop: a ring out to the loop's radius and a flash in `PALETTE.pop`. Slam: a thin
 *   bright leading edge travelling out to the wave's radius, a flash, and glowing cracks in
 *   `PALETTE.slam` left in the ground behind the edge for a moment. Blast: a flash and a ring in the
 *   mine's colour, hot debris thrown up and embers left on the ground.
 * - `FX_ENEMY_HIT`: a spray of small white-hot chips thrown out of the far side of the enemy, away
 *   from the rider, so a hit shows where it came from.
 * - `FX_ENEMY_DIE`: a burst of chunks in the enemy's colour and a darker tone of it (a boss's in
 *   `PALETTE.bosses`) that land and lie for a moment, and a splat of its colour on the ground;
 *   `FX_THING`: chunks in the thing's colour. One shard pool for every chunk and chip.
 * - `FX_BOSS_IN`: a boss arrives: a column of shards thrown up and shockwaves out over the ground
 *   at the spot, in the boss's colour, for about a second. `FX_BOSS_DOWN`: it falls: a burst
 *   `BOSS_BURST` times an ordinary death's, with a flash and a ring, in the boss's colour.
 * - `FX_ARC`: each run of links in a tick (0, 1, 2, ...) is one jagged bolt from the mover through
 *   the struck enemies in order, re-jagged every `BOLT_REROLL` so it crackles, with a flash on each
 *   enemy struck, gone in `BOLT_LIFE`.
 * - `FX_HEAL`: a plus rising from the rider and rings of `PALETTE.hp` climbing round it;
 *   `FX_TOKEN`: a plus in the token colour.
 * - `FX_LEVEL_UP`: rings of `PALETTE.spark` climbing round the rider, a ring out over the ground
 *   and a fountain of spark-coloured glints. A level-up opens its cards at once and the world holds
 *   under them, so the burst waits for the cards to close and goes off as the ride resumes.
 * - `FX_SPARK`: a spark taken: a small pop of its colour where it went in.
 * - `FX_PLAYER_HIT`: `hitTint` jumps up and decays; the UI overlay draws it as a red wash. With the
 *   Bumper carried, its ring is thrown out at hip height to the hit's shove radius
 *   (`FEEL.hitShoveRadius`), in `PALETTE.accent`.
 * - Grinding (read from the sim state's mover and events, not the queue): while the board is on a
 *   rail, a stream of small `PALETTE.grindSpark` shards flies back and up off it, and
 *   `EV_GRIND_START` and `EV_GRIND_END` each throw a burst of them. Same pool as the other shards.
 *
 * Effects round the rider (level up, heal) follow it: they are drawn from where the latest tick left
 * the mover. `ingest` must be called once per tick, right after the step (the queue is only valid
 * until the next one); `update` once per frame. Nothing allocates after construction.
 */
import {
  AdditiveBlending,
  type BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Matrix4,
  type MeshLambertMaterial,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { W_BUMPER } from '../sim/arsenal';
import { FEEL } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import { EV_GRIND_END, EV_GRIND_START, type SimState, type Vec3 } from '../sim/types';
import {
  FX_ARC,
  FX_BLAST,
  FX_BOSS_DOWN,
  FX_BUMP,
  FX_BOSS_IN,
  FX_ENEMY_DIE,
  FX_ENEMY_HIT,
  FX_HEAL,
  FX_LEVEL_UP,
  FX_PLAYER_HIT,
  FX_POP,
  FX_SLAM,
  FX_SPARK,
  FX_THING,
  FX_TOKEN,
  KIND_BRUISER,
  KIND_COUNT,
  KINDS,
  PHASE_PLAY,
  type World,
} from '../sim/world';
import { PALETTE, flatMaterial, tone } from './look';

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

/**
 * `tintMaterial` for a kit: one geometry holding several toy shapes, each tagged by the vertex
 * attribute `aPart` (0, 1, 2, ...), and the per-instance float `aShape` picking which one an
 * instance is. The other shapes' vertices collapse to a point, so one draw call shows any mix of
 * shapes. Vertex colours (the tones of a shape) multiply the instance colour.
 */
export function kitMaterial(): MeshLambertMaterial {
  const m = tintMaterial();
  m.vertexColors = true;
  const tint = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    tint(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute float aShape;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (abs(aPart - aShape) > 0.5) transformed = vec3(0.0);');
  };
  m.customProgramCacheKey = () => 'kit';
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

/**
 * Send only the first `n` items of a dynamic attribute to the GPU this frame: pools are sized for the
 * worst case, and uploading the whole of one every frame costs far more than writing it.
 */
export function uploadFirst(attr: BufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

/** Linear RGB of a palette colour into `out` at `o`. */
export function rgbInto(out: Float32Array, o: number, color: number, scale = 1): void {
  const c = scratchColor.setHex(color);
  out[o] = c.r * scale;
  out[o + 1] = c.g * scale;
  out[o + 2] = c.b * scale;
}
const scratchColor = new Color();
const scratchTone = new Color();

/**
 * A vertex colour that, multiplied by an instance colour of `color`, gives `tone(color, k)`: the
 * linear ratio of the two, channel by channel (1 where `color` has none of a channel).
 */
export function toneRatioInto(out: Float32Array, o: number, color: number, k: number): void {
  const c = scratchColor.setHex(color);
  const t = scratchTone.setHex(tone(color, k));
  out[o] = c.r > 1e-4 ? t.r / c.r : 1;
  out[o + 1] = c.g > 1e-4 ? t.g / c.g : 1;
  out[o + 2] = c.b > 1e-4 ? t.b / c.b : 1;
}

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
 * A flat shape of radius `r` laid on ground of unit normal `n` (its local y along the normal, its x
 * climbing with the slope along world x), at slot `i`. `sy` scales the local y (default 1).
 */
export function groundMatrix(m: { [i: number]: number }, i: number, n: Vec3, r: number, x: number, y: number, z: number, sy = 1): void {
  // X = n x (0, 0, 1), Z = X x n: the flat basis when n is straight up.
  let ax = n.y;
  let ay = -n.x;
  const l = Math.sqrt(ax * ax + ay * ay);
  if (l > 1e-6) {
    ax /= l;
    ay /= l;
  } else {
    ax = 1;
    ay = 0;
  }
  const cx = ay * n.z;
  const cy = -ax * n.z;
  const cz = ax * n.y - ay * n.x;
  writeMatrix(m, i, ax * r, ay * r, 0, n.x * sy, n.y * sy, n.z * sy, cx * r, cy * r, cz * r, x, y, z);
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

// ---- building toy shapes ----------------------------------------------------------------------

/** The colour a vertex is baked with: linear rgb into `out`, from where it sits in the part. */
export type Paint = (x: number, y: number, z: number, out: Float32Array) => void;

/**
 * Builds one flat-shaded geometry from parts, each baked with vertex colours and tagged with the
 * part number (`aPart`) a kit material selects by. Used once, at construction.
 */
export class ShapeBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly part: number[] = [];
  private readonly rgb = new Float32Array(3);
  private readonly v = new Vector3();
  /** The part number vertices added from now on are tagged with. */
  partId = 0;

  /** Add every triangle of `geo` (moved by `matrix`), painted by `paint` at each moved vertex. */
  add(geo: BufferGeometry, paint: Paint, matrix: Matrix4 | null = null): this {
    const flat = geo.index ? geo.toNonIndexed() : geo;
    const p = flat.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      this.v.set(p.getX(i), p.getY(i), p.getZ(i));
      if (matrix) this.v.applyMatrix4(matrix);
      paint(this.v.x, this.v.y, this.v.z, this.rgb);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.rgb[0], this.rgb[1], this.rgb[2]);
      this.part.push(this.partId);
    }
    return this;
  }

  /** One triangle, in one paint. */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, paint: Paint): this {
    const pts = [ax, ay, az, bx, by, bz, cx, cy, cz];
    for (let k = 0; k < 9; k += 3) {
      paint(pts[k], pts[k + 1], pts[k + 2], this.rgb);
      this.pos.push(pts[k], pts[k + 1], pts[k + 2]);
      this.col.push(this.rgb[0], this.rgb[1], this.rgb[2]);
      this.part.push(this.partId);
    }
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new Float32BufferAttribute(this.part, 1));
    g.computeVertexNormals();
    return g;
  }
}

/** A paint of one flat colour (already linear, or a ratio for a kit). */
export function solidPaint(r: number, g: number, b: number): Paint {
  return (_x, _y, _z, out) => {
    out[0] = r;
    out[1] = g;
    out[2] = b;
  };
}

/**
 * A paint in tones of `color` for an instance coloured `color`: `kLow` at `yLow` and below, `kHigh`
 * at `yHigh` and above, between them in proportion. Darker underneath, lighter on top.
 */
export function tonePaint(color: number, yLow: number, kLow: number, yHigh: number, kHigh: number): Paint {
  const lo = new Float32Array(3);
  const hi = new Float32Array(3);
  toneRatioInto(lo, 0, color, kLow);
  toneRatioInto(hi, 0, color, kHigh);
  return (_x, y, _z, out) => {
    const t = yHigh > yLow ? Math.min(1, Math.max(0, (y - yLow) / (yHigh - yLow))) : 1;
    out[0] = lo[0] + (hi[0] - lo[0]) * t;
    out[1] = lo[1] + (hi[1] - lo[1]) * t;
    out[2] = lo[2] + (hi[2] - lo[2]) * t;
  };
}

// ---- the effects ------------------------------------------------------------------------------

/** Big ground glows (rings and flashes) alive at once; a new one takes the oldest one's place. */
export const GLOW_POOL = 20;
/** Small glows (splats, link flashes, pops) have their own pool, so a crowd dying never cuts a slam short. */
export const SMALL_GLOW_POOL = 40;
export const SHARD_POOL = 384;
export const BOLT_POOL = 6;
/** Most links in one bolt (Static's longest chain). */
export const BOLT_LINKS = 8;
/** Points per link: the link's end and the jagged points before it. */
export const BOLT_JAG = 3;
export const BOLT_POINTS = 1 + BOLT_LINKS * BOLT_JAG;
/** Seconds a bolt shows, and how often its jags are drawn afresh while it does. */
export const BOLT_LIFE = 0.2;
export const BOLT_REROLL = 0.045;
export const MARK_POOL = 8;
/** Slams whose cracks can show at once, and most cracks in one. */
export const CRACK_SLAMS = 3;
export const CRACKS_MAX = 14;
/** Points along one crack (three segments). */
const CRACK_POINTS = 4;

/** A bolt starts at the mover's chest and strikes each enemy this high above its feet, m. */
export const BOLT_FROM = 1;
export const BOLT_TO = 0.8;
/** A jagged point is pushed off the straight line by up to this share of the link, capped, m. */
const BOLT_WANDER = 0.2;
const BOLT_WANDER_MAX = 0.8;
const BOLT_WIDTH = 0.2;
/** The flash on each enemy a bolt strikes: radius, m, and strength. */
const LINK_FLASH = 0.55;
const LINK_FLASH_PEAK = 0.6;

const GLOW_RING = 0;
const GLOW_FLASH = 1;
/** Spreads a little and lingers, then fades: a splat or embers on the ground. */
const GLOW_SPLAT = 2;
/** A ring round the rider, climbing and narrowing as it fades. */
const GLOW_RISE = 3;
/** Height of a glow above the ground, m. */
const GLOW_LIFT = 0.2;
const SPLAT_LIFT = 0.08;

/** A death's chunks: per unit of enemy size; their life, launch speeds and gravity. */
const SHARDS_PER_DEATH = 7;
const SHARDS_PER_THING = 8;
const SHARD_LIFE = 0.85;
/** A death's chunks fly lower and lie longer than a crate's. */
const DEATH_UP = 4;
const DEATH_LIFE = 0.95;
const SHARD_SIZE = 0.2;
const SHARD_UP = 6;
const SHARD_OUT = 4.5;
const SHARD_GRAVITY = 22;
/** Share of its life a shard spends shrinking away at the end. */
const SHARD_SHRINK = 0.35;
/** A death's splat on the ground: times the enemy's radius, its life and strength. */
const SPLAT_SCALE = 1.4;
const SPLAT_LIFE = 0.9;
const SPLAT_PEAK = 0.3;
/** A hit's chips: how many, how fast, their life and size (share of a shard's). */
const HIT_CHIPS = 3;
const HIT_SPEED = 7;
const HIT_LIFE = 0.22;
const HIT_SIZE = 0.55;
const HIT_GLOW = 1;
/** Height on the enemy a hit shows at, share of its height. */
const HIT_HEIGHT = 0.6;
/** A blast's hot debris, its life and glow, and the embers it leaves. */
const BLAST_DEBRIS = 10;
const BLAST_DEBRIS_PER_M = 2;
const BLAST_LIFE = 0.6;
const BLAST_GLOW = 1;
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
/** The slam's leading edge: its life, and the cracks' life. */
const SLAM_LIFE = 0.45;
const CRACK_LIFE = 0.9;
const CRACK_WIDTH = 0.14;
const CRACK_LIFT = 0.06;
const CRACK_PEAK = 0.85;
/** Level up: the rings round the rider, the ring out over the ground, the glints. */
const LEVEL_RING_LIFE = 0.9;
const LEVEL_GROUND_RING = 3.5;
const LEVEL_GLINTS = 10;
/** Heal: rings climbing round the rider. */
const HEAL_RING_LIFE = 0.8;
/** The Bumper's ring: at hip height, its life. */
export const BUMPER_HIP = 0.55;
const BUMPER_RING_LIFE = 0.35;
/** A spark taken: the pop's radius for a spark worth 1, m, and its life. */
const SPARK_POP = 0.45;
const SPARK_POP_LIFE = 0.18;

/** Shard colours (each also in a darker tone): the enemy kinds, then the things, the grind, the bosses, then the effects'. */
const THING_COLOR_BASE = KIND_COUNT;
const GRIND_COLOR = KIND_COUNT + PALETTE.things.length;
const BOSS_COLOR_BASE = GRIND_COLOR + 1;
const HIT_COLOR = BOSS_COLOR_BASE + PALETTE.bosses.length;
const BLAST_COLOR = HIT_COLOR + 1;
const SPARK_COLOR = HIT_COLOR + 2;
const BUMPER_COLOR = HIT_COLOR + 3;
const COLOR_COUNT = HIT_COLOR + 4;

/** A boss's fall throws this many times the shards of an ordinary death, each this much bigger. */
export const BOSS_BURST = 5;
const BOSS_SHARD_SCALE = 1.4;
/** A boss's arrival: how long its shockwaves last, s, how far the widest reaches, m, and its column. */
export const BOSS_IN_LIFE = 1.1;
export const BOSS_IN_REACH = 14;
const BOSS_COLUMN_SHARDS = 28;
const BOSS_COLUMN_UP = 15;
const BOSS_COLUMN_OUT = 1.2;

/** Grind sparks streamed each tick on a rail, and thrown when a grind starts or ends. */
export const GRIND_STREAM = 2;
export const GRIND_BURST = 10;
/** A streamed spark's size (share of a shard's), and how much of the board's speed it keeps. */
const GRIND_SIZE = 0.45;
const GRIND_TRAIL = 0.35;
const GRIND_LIFE = 0.55;
/** Grind sparks glow (other shards are lit only): hot metal reads on the dark ground. */
export const GRIND_GLOW = 0.9;
/** Its speed up and sideways, m/s. */
const GRIND_UP = 3;
const GRIND_SIDE = 2.2;
/** The burst's spread: as a thing about this big, m (a 0.6 m thing throws `perUnit` shards). */
const GRIND_BURST_RADIUS = 0.6;
/** Mark colours. */
const MARK_HEAL = 0;
const MARK_TOKEN = 1;

/** A chunky 3D plus: three bars crossed. */
function plusGeometry(size: number): BufferGeometry {
  const b = new ShapeBuilder();
  const white = solidPaint(1, 1, 1);
  const long = size * 2;
  const thick = size * 0.62;
  b.add(new BoxGeometry(long, thick, thick), white);
  b.add(new BoxGeometry(thick, long, thick), white);
  b.add(new BoxGeometry(thick, thick, long), white);
  const g = b.build();
  g.deleteAttribute('aPart');
  return g;
}

export class FxView {
  readonly object = new Group();
  /** Rings, flashes and splats: pops, slams, blasts, deaths, link flashes, rings round the rider. */
  readonly glows: InstancedMesh;
  readonly shards: InstancedMesh;
  /** Bright segments: the Static's bolts and the Slam's cracks. */
  readonly bolts: InstancedMesh;
  /** Heals and tokens rising from the mover. */
  readonly marks: InstancedMesh;
  /** 0..1: how strongly the frame is washed red after a hit. */
  hitTint = 0;

  private readonly terrain: Terrain;
  private readonly glowDisc: InstancedBufferAttribute;
  private readonly glowRgb: Float32Array;
  private readonly shardGlow: InstancedBufferAttribute;
  private readonly boltFade: InstancedBufferAttribute;
  private readonly boltRgb: Float32Array;
  private readonly markGlow: InstancedBufferAttribute;
  private readonly markRgb: Float32Array;
  private readonly normal: Vec3 = { x: 0, y: 1, z: 0 };

  // Palette colours, read when the view is made.
  private readonly popColor: number;
  private readonly slamColor: number;
  private readonly mineColor: number;
  private readonly arcColor: number;
  private readonly sparkColor: number;
  private readonly hpColor: number;
  private readonly bumperColor: number;
  private readonly markColors: number[];
  private readonly arcRgb = new Float32Array(3);
  private readonly slamRgb = new Float32Array(3);

  // Glows: two ring buffers (big, then small); age < 0 is free.
  private readonly gx = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gy = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gz = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gn = new Float32Array((GLOW_POOL + SMALL_GLOW_POOL) * 3);
  private readonly gr = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gAge = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL).fill(-1);
  private readonly gLife = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gPeak = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gInner = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gType = new Uint8Array(GLOW_POOL + SMALL_GLOW_POOL);
  /** Climb, m over its life, for a ring round the rider; such a ring is drawn from the rider. */
  private readonly gRise = new Float32Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gFollow = new Uint8Array(GLOW_POOL + SMALL_GLOW_POOL);
  private readonly gRgb = new Float32Array((GLOW_POOL + SMALL_GLOW_POOL) * 3);
  private glowNext = 0;
  private smallNext = 0;

  // Shards: dense, live ones are [0, shardCount).
  private shardCount = 0;
  private readonly sx = new Float32Array(SHARD_POOL);
  private readonly sy = new Float32Array(SHARD_POOL);
  private readonly sz = new Float32Array(SHARD_POOL);
  private readonly svx = new Float32Array(SHARD_POOL);
  private readonly svy = new Float32Array(SHARD_POOL);
  private readonly svz = new Float32Array(SHARD_POOL);
  private readonly sage = new Float32Array(SHARD_POOL);
  private readonly slife = new Float32Array(SHARD_POOL);
  private readonly sglow = new Float32Array(SHARD_POOL);
  private readonly sgrav = new Float32Array(SHARD_POOL);
  private readonly sspin = new Float32Array(SHARD_POOL);
  private readonly ssize = new Float32Array(SHARD_POOL);
  /** Colour index, plus COLOR_COUNT for its darker tone. */
  private readonly scol = new Uint8Array(SHARD_POOL);
  /** Linear RGB per shard colour, then per darker tone. */
  private readonly shardRgb = new Float32Array(COLOR_COUNT * 2 * 3);

  // Bolts: a ring buffer of BOLT_POOL; age < 0 is free.
  /** Points of each bolt, BOLT_POINTS (x, y, z) per bolt. */
  readonly boltPoints = new Float32Array(BOLT_POOL * BOLT_POINTS * 3);
  /** How many points each bolt has (1 + links * BOLT_JAG). */
  readonly boltCount = new Int32Array(BOLT_POOL);
  private readonly boltAge = new Float32Array(BOLT_POOL).fill(-1);
  private readonly boltLinks = new Int32Array(BOLT_POOL);
  private readonly boltRoll = new Float32Array(BOLT_POOL);
  private boltNext = 0;
  /** The bolt being built from this tick's links, or -1. */
  private boltOpen = -1;

  // Cracks: a ring buffer of CRACK_SLAMS slams, each with up to CRACKS_MAX cracks.
  private readonly crackPts = new Float32Array(CRACK_SLAMS * CRACKS_MAX * CRACK_POINTS * 3);
  /** How far from the centre each crack starts (it shows once the edge has passed), m. */
  private readonly crackFrom = new Float32Array(CRACK_SLAMS * CRACKS_MAX);
  private readonly crackN = new Int32Array(CRACK_SLAMS);
  private readonly crackR = new Float32Array(CRACK_SLAMS);
  private readonly crackAge = new Float32Array(CRACK_SLAMS).fill(-1);
  private crackNext = 0;

  // Marks: a ring buffer of MARK_POOL; age < 0 is free.
  private readonly mx = new Float32Array(MARK_POOL);
  private readonly my = new Float32Array(MARK_POOL);
  private readonly mz = new Float32Array(MARK_POOL);
  private readonly mAge = new Float32Array(MARK_POOL).fill(-1);
  private readonly mCol = new Uint8Array(MARK_POOL);
  private markNext = 0;

  /** Where the latest tick left the mover's feet: rings round the rider are drawn from here. */
  private fmx = 0;
  private fmy = 0;
  private fmz = 0;

  /** The sim tick grind sparks were last thrown for. */
  private grindTick = -1;
  /** A level-up waiting for its cards to close. */
  private levelPending = false;

  /** Cheap deterministic noise for shard directions and bolt jags. */
  private seed = 0x9e3779b9;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    this.object.name = 'fx';
    this.popColor = PALETTE.pop;
    this.slamColor = PALETTE.slam;
    this.mineColor = PALETTE.zones[0];
    this.arcColor = PALETTE.arc;
    this.sparkColor = PALETTE.spark;
    this.hpColor = PALETTE.hp;
    this.bumperColor = PALETTE.accent;
    this.markColors = [PALETTE.hp, PALETTE.things[1]];
    rgbInto(this.arcRgb, 0, this.arcColor);
    rgbInto(this.slamRgb, 0, this.slamColor);

    const glowGeo = new CircleGeometry(1, 40);
    glowGeo.rotateX(-Math.PI / 2);
    this.glowDisc = addInstanceFloat(glowGeo, 'aDisc', GLOW_POOL + SMALL_GLOW_POOL, 3);
    this.glows = makeInstanced(glowGeo, discMaterial(0), GLOW_POOL + SMALL_GLOW_POOL, 'fx-glows');
    this.glowRgb = addInstanceColor(this.glows, GLOW_POOL + SMALL_GLOW_POOL);

    const shardGeo = new TetrahedronGeometry(SHARD_SIZE, 0);
    this.shardGlow = addInstanceFloat(shardGeo, 'aGlow', SHARD_POOL);
    this.shards = makeInstanced(shardGeo, tintMaterial(), SHARD_POOL, 'fx-shards');
    const shardCol = addInstanceColor(this.shards, SHARD_POOL);
    shardCol.fill(1);
    const colors = [
      ...PALETTE.enemies,
      ...PALETTE.things,
      PALETTE.grindSpark,
      ...PALETTE.bosses,
      PALETTE.enemyFlash,
      this.mineColor,
      this.sparkColor,
      this.bumperColor,
    ];
    for (let k = 0; k < COLOR_COUNT; k++) {
      const c = colors[k] ?? PALETTE.enemyFlash;
      rgbInto(this.shardRgb, k * 3, c);
      rgbInto(this.shardRgb, (k + COLOR_COUNT) * 3, tone(c, -0.4));
    }

    const boltGeo = new BoxGeometry(1, 1, 1);
    const segs = BOLT_POOL * (BOLT_POINTS - 1) + CRACK_SLAMS * CRACKS_MAX * (CRACK_POINTS - 1);
    this.boltFade = addInstanceFloat(boltGeo, 'aFade', segs);
    this.bolts = makeInstanced(boltGeo, fadeMaterial(0xffffff), segs, 'fx-bolts');
    this.boltRgb = addInstanceColor(this.bolts, segs);

    const markGeo = plusGeometry(MARK_SIZE);
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

  /** Live glows (rings, flashes, splats), for tests. */
  get liveGlows(): number {
    let n = 0;
    for (let i = 0; i < GLOW_POOL + SMALL_GLOW_POOL; i++) if (this.gAge[i] >= 0) n++;
    return n;
  }

  /** Live big glows only (rings and flashes, not splats or link flashes), for tests. */
  get liveBigGlows(): number {
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

  /** Slams whose cracks are still in the ground, for tests. */
  get liveCracks(): number {
    let n = 0;
    for (let i = 0; i < CRACK_SLAMS; i++) if (this.crackAge[i] >= 0) n++;
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
    this.grindTick = -1;
    this.levelPending = false;
    this.gAge.fill(-1);
    this.glowNext = 0;
    this.smallNext = 0;
    this.shardCount = 0;
    this.boltAge.fill(-1);
    this.boltCount.fill(0);
    this.boltNext = 0;
    this.boltOpen = -1;
    this.crackAge.fill(-1);
    this.crackNext = 0;
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
   * mover's feet are after the step: bolts start there, rings round the rider follow it. With the
   * sim state, grinds throw sparks.
   */
  ingest(w: World, mx = 0, my = 0, mz = 0, s: SimState | null = null): void {
    this.fmx = mx;
    this.fmy = my;
    this.fmz = mz;
    if (s) this.grind(s);
    const f = w.fx;
    this.boltOpen = -1;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      const x = f.x[i];
      const y = f.y[i];
      const z = f.z[i];
      const a = f.a[i];
      if (type === FX_ENEMY_HIT) {
        this.hit(x, y, z, mx, mz, a);
      } else if (type === FX_POP) {
        const r = a > 0.5 ? a : 0.5;
        this.ground(x, z);
        this.glow(false, GLOW_RING, x, y, z, r, 0.5, 1, 0.88, this.popColor);
        this.glow(false, GLOW_FLASH, x, y, z, r, 0.3, 0.55, 0, this.popColor);
      } else if (type === FX_SLAM) {
        const r = a > 0.5 ? a : 0.5;
        this.ground(x, z);
        this.glow(false, GLOW_RING, x, y, z, r, SLAM_LIFE, 1, 0.9, this.slamColor);
        this.glow(false, GLOW_FLASH, x, y, z, r * 0.6, 0.2, 0.35, 0, this.slamColor);
        this.cracks(x, z, r);
      } else if (type === FX_BLAST) {
        const r = a > 0.5 ? a : 0.5;
        this.ground(x, z);
        this.glow(false, GLOW_FLASH, x, y, z, r, 0.18, 0.8, 0, this.mineColor);
        this.glow(false, GLOW_RING, x, y, z, r, 0.35, 0.9, 0.8, this.mineColor);
        const n = BLAST_DEBRIS + Math.round(r * BLAST_DEBRIS_PER_M);
        this.spray(BLAST_COLOR, x, y + 0.3, z, n, 0.7, 0, 0, 7 + r, 9, BLAST_LIFE, BLAST_GLOW, 0.5, true);
      } else if (type === FX_ENEMY_DIE) {
        const k = a | 0;
        const def = KINDS[k >= 0 && k < KINDS.length ? k : 0];
        const col = shardColorOfKind(k);
        this.burst(col, x, y + def.height * 0.5, z, def.radius, SHARDS_PER_DEATH, 1, SHARD_OUT, DEATH_UP, true, DEATH_LIFE);
        this.ground(x, z);
        this.glow(true, GLOW_SPLAT, x, y, z, def.radius * SPLAT_SCALE, SPLAT_LIFE, SPLAT_PEAK, 0, this.shardHex(col));
      } else if (type === FX_BOSS_IN) {
        this.bossIn(a | 0, x, y, z);
      } else if (type === FX_BOSS_DOWN) {
        this.bossDown(a | 0, x, y, z);
      } else if (type === FX_THING) {
        const k = a | 0;
        if (k >= 0 && k < PALETTE.things.length) this.burst(THING_COLOR_BASE + k, x, y + 0.8, z, 0.7, SHARDS_PER_THING);
      } else if (type === FX_ARC) {
        this.arc(a | 0, x, y, z, mx, my, mz);
        this.up();
        this.glow(true, GLOW_FLASH, x, y + BOLT_TO, z, LINK_FLASH, BOLT_LIFE + 0.05, LINK_FLASH_PEAK, 0, this.arcColor);
      } else if (type === FX_HEAL) {
        this.mark(MARK_HEAL, x, y, z);
        this.up();
        this.rise(0.9, 1.6, HEAL_RING_LIFE, 0.9, this.hpColor);
        this.rise(1.15, 1.1, HEAL_RING_LIFE * 0.85, 0.7, this.hpColor);
      } else if (type === FX_TOKEN) {
        this.mark(MARK_TOKEN, x, y, z);
      } else if (type === FX_LEVEL_UP) {
        this.levelPending = true;
      } else if (type === FX_SPARK) {
        this.up();
        const r = SPARK_POP * (0.8 + 0.2 * Math.sqrt(a > 0 ? a : 0));
        this.glow(true, GLOW_FLASH, x, y + 0.6, z, r, SPARK_POP_LIFE, 0.9, 0, this.sparkColor);
      } else if (type === FX_PLAYER_HIT) {
        const s = HIT_MIN + (HIT_MAX - HIT_MIN) * Math.min(1, a / HIT_REF);
        if (s > this.hitTint) this.hitTint = s;
        if (w.player.loadout.weaponLevel[W_BUMPER] > 0) this.bumper(x, y, z, FEEL.hitShoveRadius);
      } else if (type === FX_BUMP) {
        this.bumper(x, y, z, a);
      }
    }
    this.boltOpen = -1;
    if (this.levelPending && w.run.phase === PHASE_PLAY && !w.offer.open && w.offerQueued === 0) {
      this.levelPending = false;
      this.levelUp(mx, my, mz);
    }
  }

  /**
   * Sparks off a board on a rail, from the mover's state and this tick's events. Only on a tick the
   * sim really stepped: while it holds (cards open, the run over) the board stands still on the bar.
   */
  private grind(s: SimState): void {
    if (s.tick === this.grindTick) return;
    this.grindTick = s.tick;
    const m = s.mover;
    if ((s.events & (EV_GRIND_START | EV_GRIND_END)) !== 0) {
      this.burst(GRIND_COLOR, m.x, m.y, m.z, GRIND_BURST_RADIUS, GRIND_BURST, GRIND_SIZE, SHARD_OUT, SHARD_UP, false, GRIND_LIFE, GRIND_GLOW);
    }
    if (m.rail < 0) return;
    const hs = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
    // Across the way it is going, on the ground.
    const sx = hs > 1e-6 ? -m.vz / hs : 1;
    const sz = hs > 1e-6 ? m.vx / hs : 0;
    for (let j = 0; j < GRIND_STREAM; j++) {
      const i = this.takeShard();
      const side = (this.rand() * 2 - 1) * GRIND_SIDE;
      const back = GRIND_TRAIL * (0.5 + this.rand());
      this.sx[i] = m.x;
      this.sy[i] = m.y;
      this.sz[i] = m.z;
      this.svx[i] = -m.vx * back + sx * side;
      this.svy[i] = GRIND_UP * (0.4 + this.rand());
      this.svz[i] = -m.vz * back + sz * side;
      this.sage[i] = 0;
      this.slife[i] = GRIND_LIFE;
      this.sglow[i] = GRIND_GLOW;
      this.sgrav[i] = 1;
      this.sspin[i] = this.rand() * Math.PI * 2;
      this.ssize[i] = GRIND_SIZE * (0.7 + 0.6 * this.rand());
      this.scol[i] = GRIND_COLOR;
    }
  }

  /** The ground's normal at (x, z), into `this.normal`, for the next glow. */
  private ground(x: number, z: number): void {
    this.terrain.normalAt(x, z, this.normal);
  }

  /** The next glow lies flat (straight up), for glows in the air. */
  private up(): void {
    this.normal.x = 0;
    this.normal.y = 1;
    this.normal.z = 0;
  }

  /** A glow, from the big pool or the small one, lying on `this.normal`. */
  private glow(small: boolean, type: number, x: number, y: number, z: number, r: number, life: number, peak: number, inner: number, color: number): number {
    let p: number;
    if (small) {
      p = GLOW_POOL + this.smallNext;
      this.smallNext = (this.smallNext + 1) % SMALL_GLOW_POOL;
    } else {
      p = this.glowNext;
      this.glowNext = (p + 1) % GLOW_POOL;
    }
    this.gType[p] = type;
    this.gx[p] = x;
    this.gy[p] = y;
    this.gz[p] = z;
    this.gn[p * 3] = this.normal.x;
    this.gn[p * 3 + 1] = this.normal.y;
    this.gn[p * 3 + 2] = this.normal.z;
    this.gr[p] = r;
    this.gAge[p] = 0;
    this.gLife[p] = life;
    this.gPeak[p] = peak;
    this.gInner[p] = inner;
    this.gRise[p] = 0;
    this.gFollow[p] = 0;
    rgbInto(this.gRgb, p * 3, color);
    return p;
  }

  /** A ring round the rider, from its feet, climbing `climb` m over its life. */
  private rise(r: number, climb: number, life: number, peak: number, color: number): void {
    this.up();
    const p = this.glow(false, GLOW_RISE, 0, 0.1, 0, r, life, peak, 0.8, color);
    this.gRise[p] = climb;
    this.gFollow[p] = 1;
  }

  /** The level-up: rings climbing round the rider, a ring out over the ground, a fountain of glints. */
  private levelUp(x: number, y: number, z: number): void {
    this.rise(0.8, 2.6, LEVEL_RING_LIFE, 0.7, this.sparkColor);
    this.rise(1.05, 1.9, LEVEL_RING_LIFE * 0.9, 0.55, this.sparkColor);
    this.rise(1.3, 1.2, LEVEL_RING_LIFE * 0.8, 0.45, this.sparkColor);
    this.ground(x, z);
    this.glow(false, GLOW_RING, x, y, z, LEVEL_GROUND_RING, 0.45, 0.5, 0.93, this.sparkColor);
    this.glow(false, GLOW_FLASH, x, y, z, 1.4, 0.3, 0.45, 0, this.sparkColor);
    this.spray(SPARK_COLOR, x, y + 0.8, z, LEVEL_GLINTS, 0.6, 0, 0, 2.5, 10, 0.8, 1, 0.5, false, 0.6);
  }

  /** The Bumper went off: its ring thrown out at hip height to `reach`, and a flash. */
  private bumper(x: number, y: number, z: number, reach: number): void {
    this.up();
    this.glow(false, GLOW_RING, x, y + BUMPER_HIP, z, reach, BUMPER_RING_LIFE, 1, 0.86, this.bumperColor);
    this.ground(x, z);
    this.glow(false, GLOW_FLASH, x, y, z, 1.8, 0.2, 0.7, 0, this.bumperColor);
    this.spray(BUMPER_COLOR, x, y + BUMPER_HIP, z, 8, 0.7, 0, 0, 9, 3, 0.3, 0.9, 0.5, false, 0.3);
  }

  /** A hit on an enemy at (x, y, z): chips thrown out of its far side, away from the rider at (mx, mz). */
  private hit(x: number, y: number, z: number, mx: number, mz: number, damage: number): void {
    let dx = x - mx;
    let dz = z - mz;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = 0;
      dz = 1;
    }
    const n = HIT_CHIPS + (damage >= 20 ? 1 : 0);
    this.spray(HIT_COLOR, x, y + 1.7 * HIT_HEIGHT, z, n, HIT_SIZE, dx, dz, HIT_SPEED, 2, HIT_LIFE, HIT_GLOW, 0.6, false, 0.3);
  }

  /**
   * `n` shards of colour `col` from (x, y, z): along (dx, dz) within a cone of half-width `spread`
   * (radians times 2), or every way when (dx, dz) is zero; `out` and `up` m/s.
   */
  private spray(
    col: number,
    x: number,
    y: number,
    z: number,
    n: number,
    size: number,
    dx: number,
    dz: number,
    out: number,
    up: number,
    life: number,
    glow: number,
    spread: number,
    mixDark: boolean,
    gravity = 1,
  ): void {
    const aimed = dx !== 0 || dz !== 0;
    const base = Math.atan2(dx, dz);
    for (let j = 0; j < n; j++) {
      const i = this.takeShard();
      const a = aimed ? base + (this.rand() * 2 - 1) * spread * 1.6 : this.rand() * Math.PI * 2;
      const o = out * (0.55 + 0.6 * this.rand());
      this.sx[i] = x;
      this.sy[i] = y;
      this.sz[i] = z;
      this.svx[i] = Math.sin(a) * o;
      this.svz[i] = Math.cos(a) * o;
      this.svy[i] = up * (0.5 + 0.7 * this.rand());
      this.sage[i] = 0;
      this.slife[i] = life * (0.75 + 0.35 * this.rand());
      this.sglow[i] = glow;
      this.sgrav[i] = gravity;
      this.sspin[i] = this.rand() * Math.PI * 2;
      this.ssize[i] = size * (0.7 + 0.6 * this.rand());
      this.scol[i] = mixDark && j % 2 === 1 ? col + COLOR_COUNT : col;
    }
  }

  /** The slot for a new shard: a free one, or (the pool full) a live one at random: in a crowd nobody notices which. */
  private takeShard(): number {
    return this.shardCount < SHARD_POOL ? this.shardCount++ : Math.floor(this.rand() * SHARD_POOL);
  }

  private shardHex(col: number): number {
    // Back from the linear table is lossy; pick the palette colour again.
    if (col < KIND_COUNT) return PALETTE.enemies[col];
    const b = col - BOSS_COLOR_BASE;
    if (b >= 0 && b < PALETTE.bosses.length) return PALETTE.bosses[b];
    return PALETTE.enemies[0];
  }

  /** The Slam's cracks: jagged lines out from the centre over the ground, shown as the edge passes. */
  private cracks(x: number, z: number, r: number): void {
    const c = this.crackNext;
    this.crackNext = (c + 1) % CRACK_SLAMS;
    const n = Math.min(CRACKS_MAX, 6 + Math.round(r));
    this.crackN[c] = n;
    this.crackR[c] = r;
    this.crackAge[c] = 0;
    const t = this.terrain;
    for (let k = 0; k < n; k++) {
      const a = ((k + this.rand() * 0.6) / n) * Math.PI * 2;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const d0 = r * (0.18 + 0.12 * this.rand());
      const d1 = r * (0.7 + 0.25 * this.rand());
      this.crackFrom[c * CRACKS_MAX + k] = d0;
      for (let p = 0; p < CRACK_POINTS; p++) {
        const f = p / (CRACK_POINTS - 1);
        const d = d0 + (d1 - d0) * f;
        const side = p === 0 ? 0 : (this.rand() * 2 - 1) * Math.min(0.5, d * 0.12);
        const px = x + sa * d + ca * side;
        const pz = z + ca * d - sa * side;
        const o = ((c * CRACKS_MAX + k) * CRACK_POINTS + p) * 3;
        this.crackPts[o] = px;
        this.crackPts[o + 1] = t.heightAt(px, pz) + CRACK_LIFT;
        this.crackPts[o + 2] = pz;
      }
    }
  }

  /** A boss came up at (x, y, z): a column of its colour thrown up, and shockwaves over the ground. */
  private bossIn(kind: number, x: number, y: number, z: number): void {
    const color = bossColor(kind);
    const r = BOSS_IN_REACH;
    this.up();
    this.glow(false, GLOW_FLASH, x, y, z, r * 0.35, BOSS_IN_LIFE * 0.6, 0.9, 0, color);
    this.glow(false, GLOW_RING, x, y, z, r * 0.55, BOSS_IN_LIFE * 0.6, 1, 0.86, color);
    this.glow(false, GLOW_RING, x, y, z, r * 0.8, BOSS_IN_LIFE * 0.8, 0.9, 0.9, color);
    this.glow(false, GLOW_RING, x, y, z, r, BOSS_IN_LIFE, 0.8, 0.93, color);
    this.burst(shardColorOfKind(kind), x, y + 0.3, z, 0.6, BOSS_COLUMN_SHARDS, BOSS_SHARD_SCALE, BOSS_COLUMN_OUT, BOSS_COLUMN_UP);
  }

  /** A boss fell at (x, y, z): a burst several times an ordinary death's, a flash and a ring. */
  private bossDown(kind: number, x: number, y: number, z: number): void {
    const color = bossColor(kind);
    const def = KINDS[kind >= 0 && kind < KINDS.length ? kind : 0];
    this.up();
    this.glow(false, GLOW_FLASH, x, y, z, def.radius * 3, 0.5, 1, 0, color);
    this.glow(false, GLOW_RING, x, y, z, def.radius * 5, 0.8, 1, 0.88, color);
    this.burst(shardColorOfKind(kind), x, y + def.height * 0.5, z, def.radius, SHARDS_PER_DEATH * BOSS_BURST, BOSS_SHARD_SCALE);
  }

  private burst(
    col: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    perUnit: number,
    scale = 1,
    outSpeed = SHARD_OUT,
    upSpeed = SHARD_UP,
    mixDark = false,
    life = SHARD_LIFE,
    glow = 0,
  ): void {
    const n = Math.max(3, Math.round(perUnit * Math.sqrt(radius / 0.6)));
    const size = (0.6 + radius * 0.6) * scale;
    for (let j = 0; j < n; j++) {
      const i = this.takeShard();
      const a = this.rand() * Math.PI * 2;
      const out = outSpeed * (0.5 + this.rand());
      this.sx[i] = x;
      this.sy[i] = y;
      this.sz[i] = z;
      this.svx[i] = Math.cos(a) * out;
      this.svz[i] = Math.sin(a) * out;
      this.svy[i] = upSpeed * (0.6 + 0.6 * this.rand());
      this.sage[i] = 0;
      this.slife[i] = life * (0.85 + 0.15 * this.rand());
      this.sglow[i] = glow;
      this.sgrav[i] = 1;
      this.sspin[i] = this.rand() * Math.PI * 2;
      this.ssize[i] = size * (0.7 + 0.6 * this.rand());
      this.scol[i] = mixDark && j % 2 === 1 ? col + COLOR_COUNT : col;
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
      this.boltRoll[b] = 0;
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
    const o = base + (n - 1 + BOLT_JAG) * 3;
    pts[o] = x;
    pts[o + 1] = y + BOLT_TO;
    pts[o + 2] = z;
    this.jag(b, this.boltLinks[b]);
    this.boltCount[b] = n + BOLT_JAG;
    this.boltLinks[b]++;
  }

  /** Lay the jagged points of link `k` of bolt `b` afresh between its two ends. */
  private jag(b: number, k: number): void {
    const pts = this.boltPoints;
    const base = b * BOLT_POINTS * 3;
    const s = base + k * BOLT_JAG * 3;
    const e = s + BOLT_JAG * 3;
    const px = pts[s];
    const py = pts[s + 1];
    const pz = pts[s + 2];
    const dx = pts[e] - px;
    const dy = pts[e + 1] - py;
    const dz = pts[e + 2] - pz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const wander = Math.min(BOLT_WANDER_MAX, l * BOLT_WANDER);
    // Sideways in the ground plane, unit.
    const hl = Math.sqrt(dx * dx + dz * dz);
    const sx = hl > 1e-6 ? -dz / hl : 1;
    const sz = hl > 1e-6 ? dx / hl : 0;
    for (let j = 1; j < BOLT_JAG; j++) {
      const t = j / BOLT_JAG;
      const side = (this.rand() * 2 - 1) * wander;
      const up = (this.rand() * 2 - 1) * wander * 0.6;
      const o = s + j * 3;
      pts[o] = px + dx * t + sx * side;
      pts[o + 1] = py + dy * t + up;
      pts[o + 2] = pz + dz * t + sz * side;
    }
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
    const n3 = this.normal;
    let n = 0;
    for (let p = 0; p < GLOW_POOL + SMALL_GLOW_POOL; p++) {
      if (this.gAge[p] < 0) continue;
      const age = (this.gAge[p] += step);
      if (age >= this.gLife[p]) {
        this.gAge[p] = -1;
        continue;
      }
      const t = age / this.gLife[p];
      let r = this.gr[p];
      let fade = this.gPeak[p] * (1 - t);
      let x = this.gx[p];
      let y = this.gy[p] + GLOW_LIFT;
      let z = this.gz[p];
      const type = this.gType[p];
      if (type === GLOW_RING) {
        const grow = 1 - (1 - t) * (1 - t) * (1 - t);
        r *= 0.25 + 0.75 * grow;
      } else if (type === GLOW_FLASH) {
        fade *= 1 - t;
      } else if (type === GLOW_SPLAT) {
        r *= 0.6 + 0.4 * Math.min(1, t * 6);
        fade = this.gPeak[p] * (t < 0.55 ? 1 : (1 - t) / 0.45);
        y = this.gy[p] + SPLAT_LIFT;
      } else {
        // Round the rider, climbing and narrowing.
        r *= 1 - 0.35 * t;
        fade = this.gPeak[p] * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
        y = this.gy[p] + this.gRise[p] * (1 - (1 - t) * (1 - t));
      }
      if (this.gFollow[p]) {
        x += this.fmx;
        y += this.fmy;
        z += this.fmz;
      }
      n3.x = this.gn[p * 3];
      n3.y = this.gn[p * 3 + 1];
      n3.z = this.gn[p * 3 + 2];
      groundMatrix(gm, n, n3, r, x, y, z);
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
      uploadFirst(this.glows.instanceMatrix, n);
      uploadFirst(this.glowDisc, n);
      if (this.glows.instanceColor) uploadFirst(this.glows.instanceColor, n);
    }
  }

  private updateShards(step: number): void {
    const sm = this.shards.instanceMatrix.array;
    const col = this.shards.instanceColor;
    const sc = col ? (col.array as Float32Array) : null;
    const glow = this.shardGlow.array as Float32Array;
    let i = 0;
    while (i < this.shardCount) {
      const age = (this.sage[i] += step);
      const life = this.slife[i];
      if (age >= life) {
        this.killShard(i);
        continue;
      }
      this.svy[i] -= SHARD_GRAVITY * this.sgrav[i] * step;
      this.sx[i] += this.svx[i] * step;
      this.sy[i] += this.svy[i] * step;
      this.sz[i] += this.svz[i] * step;
      const floor = this.terrain.heightAt(this.sx[i], this.sz[i]) + SHARD_SIZE * 0.5;
      let resting = false;
      if (this.sy[i] < floor) {
        // Lands, bounces a little, and lies where it fell.
        this.sy[i] = floor;
        this.svy[i] *= -0.3;
        this.svx[i] *= 0.45;
        this.svz[i] *= 0.45;
        resting = this.svy[i] < 1;
      }
      const left = (life - age) / (life * SHARD_SHRINK);
      const s = this.ssize[i] * (left < 1 ? left : 1);
      // Tumbling: Ry(b) * Rx(a), scaled by s; a resting chunk stops turning.
      if (!resting) this.sspin[i] += step * 7;
      const a = this.sspin[i];
      const b = this.sspin[i] * 0.6 + this.ssize[i] * 9;
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
      // Hot things cool as they go.
      glow[i] = this.sglow[i] * (1 - 0.5 * (age / life));
      i++;
    }
    this.shards.count = this.shardCount;
    this.shards.visible = this.shardCount > 0;
    if (this.shardCount > 0) {
      uploadFirst(this.shards.instanceMatrix, this.shardCount);
      uploadFirst(this.shardGlow, this.shardCount);
      if (col) uploadFirst(col, this.shardCount);
    }
  }

  private updateBolts(step: number): void {
    const bm = this.bolts.instanceMatrix.array;
    const fade = this.boltFade.array as Float32Array;
    const rgb = this.boltRgb;
    const pts = this.boltPoints;
    let n = 0;
    for (let b = 0; b < BOLT_POOL; b++) {
      if (this.boltAge[b] < 0) continue;
      const age = (this.boltAge[b] += step);
      if (age >= BOLT_LIFE) {
        this.boltAge[b] = -1;
        continue;
      }
      // Crackle: the jags are laid afresh a few times while it lasts.
      this.boltRoll[b] += step;
      if (this.boltRoll[b] >= BOLT_REROLL) {
        this.boltRoll[b] = 0;
        for (let k = 0; k < this.boltLinks[b]; k++) this.jag(b, k);
      }
      const t = age / BOLT_LIFE;
      const f = (1 - t) * (0.7 + 0.3 * this.rand());
      const width = BOLT_WIDTH * (1.3 - 0.6 * t);
      const base = b * BOLT_POINTS * 3;
      for (let k = 1; k < this.boltCount[b]; k++) {
        const o = base + k * 3;
        segmentMatrix(bm, n, pts[o - 3], pts[o - 2], pts[o - 1], pts[o], pts[o + 1], pts[o + 2], width, width);
        rgb[n * 3] = this.arcRgb[0];
        rgb[n * 3 + 1] = this.arcRgb[1];
        rgb[n * 3 + 2] = this.arcRgb[2];
        fade[n++] = f;
      }
    }
    for (let c = 0; c < CRACK_SLAMS; c++) {
      if (this.crackAge[c] < 0) continue;
      const age = (this.crackAge[c] += step);
      if (age >= CRACK_LIFE) {
        this.crackAge[c] = -1;
        continue;
      }
      // Where the leading edge is: the same curve as the slam's ring.
      const te = Math.min(1, age / SLAM_LIFE);
      const edge = this.crackR[c] * (0.25 + 0.75 * (1 - (1 - te) * (1 - te) * (1 - te)));
      const f = CRACK_PEAK * (1 - age / CRACK_LIFE);
      for (let k = 0; k < this.crackN[c]; k++) {
        if (this.crackFrom[c * CRACKS_MAX + k] > edge) continue;
        const base = (c * CRACKS_MAX + k) * CRACK_POINTS * 3;
        for (let p = 1; p < CRACK_POINTS; p++) {
          const o = base + p * 3;
          // A segment shows once the edge has reached its far end, so the cracks run out behind it.
          const ex = this.crackPts[o] - this.crackPts[base];
          const ez = this.crackPts[o + 2] - this.crackPts[base + 2];
          if (this.crackFrom[c * CRACKS_MAX + k] + Math.sqrt(ex * ex + ez * ez) > edge) break;
          const w = CRACK_WIDTH * (1 - 0.25 * p);
          segmentMatrix(bm, n, this.crackPts[o - 3], this.crackPts[o - 2], this.crackPts[o - 1], this.crackPts[o], this.crackPts[o + 1], this.crackPts[o + 2], w, 0.04);
          rgb[n * 3] = this.slamRgb[0];
          rgb[n * 3 + 1] = this.slamRgb[1];
          rgb[n * 3 + 2] = this.slamRgb[2];
          fade[n++] = f;
        }
      }
    }
    this.bolts.count = n;
    this.bolts.visible = n > 0;
    if (n > 0) {
      uploadFirst(this.bolts.instanceMatrix, n);
      uploadFirst(this.boltFade, n);
      if (this.bolts.instanceColor) uploadFirst(this.bolts.instanceColor, n);
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
      // Pops up big, then shrinks away as it climbs.
      const s = (t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - 0.2 * ((t - 0.15) / 0.85)) * (1 - t * t);
      const spin = age * 5;
      const c = Math.cos(spin) * s;
      const sn = Math.sin(spin) * s;
      writeMatrix(mm, n, c, 0, -sn, 0, s, 0, sn, 0, c, this.mx[p], this.my[p] + MARK_RISE * (1 - (1 - t) * (1 - t)), this.mz[p]);
      rgbInto(this.markRgb, n * 3, this.markColors[this.mCol[p]]);
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
    this.slife[i] = this.slife[j];
    this.sglow[i] = this.sglow[j];
    this.sgrav[i] = this.sgrav[j];
    this.sspin[i] = this.sspin[j];
    this.ssize[i] = this.ssize[j];
    this.scol[i] = this.scol[j];
  }
}

/** The shard colour for an enemy of `kind`: its own, a boss's from `PALETTE.bosses`, else the shuffler's. */
export function shardColorOfKind(kind: number): number {
  if (kind >= 0 && kind < KIND_COUNT) return kind;
  const b = kind - KIND_BRUISER;
  if (b >= 0 && b < PALETTE.bosses.length) return BOSS_COLOR_BASE + b;
  return 0;
}

/** A boss's colour; an unknown kind falls back to the threat colour. */
function bossColor(kind: number): number {
  const b = kind - KIND_BRUISER;
  return b >= 0 && b < PALETTE.bosses.length ? PALETTE.bosses[b] : PALETTE.threat;
}
