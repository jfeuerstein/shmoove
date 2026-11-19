/**
 * Zones on the ground, each tilted to the ground under it:
 *
 * - a mine (`ZONE_MINE`, the Crumbs): a squat spiked ball in tones of the mine's colour with a
 *   light on top that blinks fast while it arms and slowly once armed, over a small glow on the
 *   ground that is dim while it arms and blinks once armed. A little bigger the bigger its blast;
 * - tar (`ZONE_TAR`): a dark blob as wide as it drags with a light, wet rim and a sheen across it
 *   (so it reads on a dark floor in every look), bubbles swelling and popping on it, spreading when
 *   it is laid and shrinking away at the end of its life;
 * - a lob ring (`ZONE_LOB`): an outline where the shot will land that pulses faster as its time runs
 *   out and fills in from the middle, so the moment it lands is the moment it is full, and the shot
 *   itself on its way down out of the sky, its shadow on the ground growing as it falls;
 * - the Standstill's ring (`ZONE_RING`): a bright band on the ground in `PALETTE.ring` at the front's
 *   radius, following the ground, drawn where the front will be at the frame (it spreads steadily),
 *   so the moment to ollie can be read off it.
 *
 * The mines' balls, the falling shots, their shadows and the bubbles are one kit mesh (one draw).
 *
 * Also `GroundRings`: wide rings drawn as one strip that follows the ground (elites' auras, shrines'
 * orbits), for the views that need one.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  type InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Terrain } from '../sim/terrain';
import type { Vec3 } from '../sim/types';
import { BOSS } from '../sim/bosses';
import { DT } from '../sim/constants';
import { CRUMBS } from '../sim/weapons/crumbs';
import { MAX_ZONES, ZONE_LOB, ZONE_MINE, ZONE_RING, ZONE_TAR, type World } from '../sim/world';
import { PALETTE, flatMaterial, tone } from './look';
import {
  addInstanceColor,
  addInstanceFloat,
  discMaterial,
  fadeMaterial,
  groundMatrix,
  kitMaterial,
  makeInstanced,
  rgbInto,
  ShapeBuilder,
  solidPaint,
  tonePaint,
  toneRatioInto,
  uploadFirst,
  writeMatrix,
} from './fxView';

/** A mine's disc radius, m (the blast reaches further; the disc is where it lies). */
export const MINE_SIZE = 0.6;
/** Ticks a blink of an armed mine lasts (on, then off). */
export const MINE_BLINK_TICKS = 12;
/** Ticks a blink of the light lasts while the mine arms: quick, nervous. */
export const MINE_ARMING_BLINK_TICKS = 3;
/** Strength of an unarmed mine, of an armed one's off beat, and its on beat. */
export const MINE_IDLE = 0.3;
export const MINE_OFF = 0.35;
export const MINE_ON = 1;
/** The ball: its radius at the first level's blast, m; it grows with the square root of the blast. */
export const MINE_BALL = 0.3;
const MINE_BALL_MAX = 1.5;
/** A lob ring's outline starts at this share of its radius; its fill reaches that far when full. */
export const LOB_INNER = 0.84;
const LOB_CORE_SHARE = 0.45;
const LOB_FADE = 0.9;
/** How far the ring's pulse dips, and how fast it beats at first and at the end, rad a tick. */
const LOB_PULSE = 0.25;
const LOB_BEAT_FROM = 0.12;
const LOB_BEAT_TO = 0.6;
/** The falling shot: how high it starts, m, its radius, and its shadow's size at first and at the end, share of the ring. */
export const LOB_DROP = 16;
const LOB_SHELL = 0.34;
const SHADOW_FROM = 0.15;
const SHADOW_TO = 0.6;
/** Tar spreads over this many ticks when laid and shrinks over the last `TAR_SHRINK` of its life. */
const TAR_GROW = 12;
const TAR_SHRINK = 30;
/** Bubbles on each patch of tar: how many, how long one lives, s, their size and how far out they rise, share of the patch. */
const TAR_BUBBLES = 2;
const BUBBLE_LIFE = 1.3;
const BUBBLE_SIZE = 0.24;
const BUBBLE_SPREAD = 0.55;
/** Heights above the ground, m. */
const MINE_LIFT = 0.08;
const TAR_LIFT = 0.04;
const LOB_LIFT = 0.12;
const SHADOW_LIFT = 0.1;
const RING_LIFT = 0.18;
/** The Standstill's ring: how wide its band is, m (behind the front), its strength, and how many at once. */
export const RING_BAND = 0.7;
const RING_FADE = 1;
const RING_SEGMENTS = 96;
export const MAX_RINGS = 4;

/** Kit shapes. */
const SHAPE_MINE = 0;
const SHAPE_SHELL = 1;
const SHAPE_SHADOW = 2;
const SHAPE_BUBBLE = 3;
const MAX_PROPS = MAX_ZONES * (1 + TAR_BUBBLES);
/** Light on top of an armed mine when on and off, and while arming. */
const BULB_ON = 1.1;
const BULB_OFF = 0.12;
const BULB_ARMING = 0.6;

/** How full a lob ring is: 0 when made, 1 when it lands. */
export function lobFill(age: number, life: number): number {
  const total = age + life;
  return total > 0 ? age / total : 1;
}

/** How strongly a mine of this age shows. */
export function mineStrength(age: number): number {
  if (age < CRUMBS.armTicks) return MINE_IDLE;
  return Math.floor((age - CRUMBS.armTicks) / MINE_BLINK_TICKS) % 2 === 0 ? MINE_ON : MINE_OFF;
}

/** How brightly the light on top of a mine of this age shines: a quick blink while it arms, then the slow one. */
export function mineLight(age: number): number {
  if (age < CRUMBS.armTicks) return Math.floor(age / MINE_ARMING_BLINK_TICKS) % 2 === 0 ? BULB_ARMING : BULB_OFF;
  return mineStrength(age) === MINE_ON ? BULB_ON : BULB_OFF;
}

/** How high the falling shot of a lob ring this full is above the ground, m: it falls as things fall, faster and faster. */
export function lobHeight(fill: number): number {
  const f = fill < 0 ? 0 : fill > 1 ? 1 : fill;
  return LOB_DROP * (1 - f * f);
}

/** A fixed pseudo-random 0..1 for a place on the ground. */
function hash(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The kit: a spiked mine with its light on top (part 0, in tones of `mine`), a lobbed shell (part 1,
 * tones of `shell`), a flat shadow (part 2, one tone: its instance colour) and a bubble (part 3,
 * tones of `tar`).
 */
export function zonesKit(mine: number, shell: number, tar: number): ShapeBuilder {
  const b = new ShapeBuilder();
  b.partId = SHAPE_MINE;
  const body = new Float32Array(3);
  const spike = new Float32Array(3);
  const bulb = new Float32Array(3);
  toneRatioInto(body, 0, mine, -0.68);
  toneRatioInto(spike, 0, mine, -0.35);
  toneRatioInto(bulb, 0, mine, 0.3);
  const one = (c: Float32Array) => solidPaint(c[0], c[1], c[2]);
  const r = MINE_BALL;
  b.add(new IcosahedronGeometry(r, 0), one(body));
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const q = new Quaternion();
  const m = new Matrix4();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const el = k % 2 === 0 ? 0 : 0.75;
    dir.set(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
    const cone = new ConeGeometry(r * 0.26, r * 0.7, 4);
    m.makeRotationFromQuaternion(q.setFromUnitVectors(up, dir));
    m.setPosition(dir.x * r * 1.15, dir.y * r * 1.15, dir.z * r * 1.15);
    b.add(cone, one(spike), m);
  }
  b.add(new OctahedronGeometry(r * 0.32, 0), one(bulb), new Matrix4().makeTranslation(0, r * 1.15, 0));

  b.partId = SHAPE_SHELL;
  b.add(new IcosahedronGeometry(LOB_SHELL, 0), tonePaint(shell, -LOB_SHELL, -0.4, LOB_SHELL, 0.3));

  b.partId = SHAPE_SHADOW;
  const disc = new CircleGeometry(1, 10);
  disc.rotateX(-Math.PI / 2);
  b.add(disc, solidPaint(1, 1, 1));

  b.partId = SHAPE_BUBBLE;
  b.add(new SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), tonePaint(tar, 0, 0.15, 0.5, 0.55));
  return b;
}

/** Tar's tones: its dark middle, the body, the light wet rim and the sheen on it (`tone` of `tar`). */
export const TAR_MIDDLE = -0.2;
export const TAR_BODY = 0.12;
export const TAR_RIM = 0.62;
export const TAR_SHEEN = 0.42;
/** Where the wet rim starts, as a share of the radius. */
export const TAR_RIM_FROM = 0.74;

/**
 * A patch of tar: a disc of radius 1 with a lumpy edge pulled in here and there (never out past 1),
 * dark in the middle with a light, wet rim round it and a sheen across it (a crescent of light off
 * its glossy top), in tones of `tar` (absolute colours). The rim and the sheen make it read on a
 * dark floor in every look, dark on dark otherwise.
 */
export function tarGeometry(tar: number): BufferGeometry {
  const seg = 14;
  const rr: number[] = [];
  for (let j = 0; j < seg; j++) rr.push(1 - 0.16 * (((j * 7) % 5) / 4));
  const centre = new Float32Array(3);
  const mid = new Float32Array(3);
  const edge = new Float32Array(3);
  const sheen = new Float32Array(3);
  rgbInto(centre, 0, tone(tar, TAR_MIDDLE));
  rgbInto(mid, 0, tone(tar, TAR_BODY));
  rgbInto(edge, 0, tone(tar, TAR_RIM));
  rgbInto(sheen, 0, tone(tar, TAR_SHEEN));
  const b = new ShapeBuilder();
  const at = (j: number, k: number): [number, number] => {
    const a = ((j % seg) / seg) * Math.PI * 2;
    return [Math.sin(a) * rr[j % seg] * k, Math.cos(a) * rr[j % seg] * k];
  };
  const paint = (c: Float32Array) => (_x: number, _y: number, _z: number, out: Float32Array): void => {
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  };
  for (let j = 0; j < seg; j++) {
    const [ax, az] = at(j, TAR_RIM_FROM);
    const [bx, bz] = at(j + 1, TAR_RIM_FROM);
    const [cx, cz] = at(j, 1);
    const [dx, dz] = at(j + 1, 1);
    // Wound to face up: the dark middle, then the wet rim, raised a hair.
    b.tri(0, 0, 0, bx, 0, bz, ax, 0, az, (x, _y, z, out) => {
      const c = x === 0 && z === 0 ? centre : mid;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
    });
    b.tri(ax, 0, az, bx, 0, bz, dx, 0.012, dz, (_x, y, _z, out) => {
      const c = y > 0 ? edge : mid;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
    });
    b.tri(ax, 0, az, dx, 0.012, dz, cx, 0.012, cz, (_x, y, _z, out) => {
      const c = y > 0 ? edge : mid;
      out[0] = c[0];
      out[1] = c[1];
      out[2] = c[2];
    });
  }
  // The sheen: a thin crescent across a third of the patch, raised a hair over the body.
  const arc = 5;
  const from = Math.PI * 1.15;
  const span = Math.PI * 0.6;
  const s = paint(sheen);
  for (let k = 0; k < arc; k++) {
    const a0 = from + (k / arc) * span;
    const a1 = from + ((k + 1) / arc) * span;
    // Thickest in the middle of the arc, to a point at its ends.
    const w0 = 0.09 * Math.sin((k / arc) * Math.PI);
    const w1 = 0.09 * Math.sin(((k + 1) / arc) * Math.PI);
    const r = 0.5;
    const y = 0.006;
    const ox0 = Math.sin(a0) * (r + w0);
    const oz0 = Math.cos(a0) * (r + w0);
    const ix0 = Math.sin(a0) * (r - w0);
    const iz0 = Math.cos(a0) * (r - w0);
    const ox1 = Math.sin(a1) * (r + w1);
    const oz1 = Math.cos(a1) * (r + w1);
    const ix1 = Math.sin(a1) * (r - w1);
    const iz1 = Math.cos(a1) * (r - w1);
    b.tri(ix0, y, iz0, ox1, y, oz1, ox0, y, oz0, s);
    b.tri(ix0, y, iz0, ix1, y, iz1, ox1, y, oz1, s);
  }
  const g = b.build();
  g.deleteAttribute('aPart');
  return g;
}
export class ZonesView {
  readonly object = new Group();
  readonly mines: InstancedMesh;
  readonly tar: InstancedMesh;
  readonly lobs: InstancedMesh;
  /** Mines' balls, falling shots, their shadows, bubbles on the tar. */
  readonly props: InstancedMesh;
  /** The Standstill's rings. */
  readonly rings: GroundRings;
  private readonly ringRgb = new Float32Array(3);
  private readonly mineRgb = new Float32Array(3);
  private readonly shellRgb = new Float32Array(3);
  private readonly shadowRgb = new Float32Array(3);
  private readonly tarRgb = new Float32Array(3);
  private readonly terrain: Terrain | null;
  private readonly mineDisc: InstancedBufferAttribute;
  private readonly lobDisc: InstancedBufferAttribute;
  private readonly propShape: InstancedBufferAttribute;
  private readonly propGlow: InstancedBufferAttribute;
  private readonly propRgb: Float32Array;
  private readonly normal: Vec3 = { x: 0, y: 1, z: 0 };

  /** Without a terrain the ground is taken as level at each zone's height. */
  constructor(terrain: Terrain | null = null) {
    this.terrain = terrain;
    this.object.name = 'zones';
    const mine = PALETTE.zones[ZONE_MINE];
    const tarColor = PALETTE.zones[ZONE_TAR];
    const shell = PALETTE.enemies[4];

    const mineGeo = new CircleGeometry(1, 12);
    mineGeo.rotateX(-Math.PI / 2);
    this.mineDisc = addInstanceFloat(mineGeo, 'aDisc', MAX_ZONES, 3);
    this.mines = makeInstanced(mineGeo, discMaterial(0), MAX_ZONES, 'zones-mines');
    const mineCol = addInstanceColor(this.mines, MAX_ZONES);
    for (let i = 0; i < MAX_ZONES; i++) rgbInto(mineCol, i * 3, mine);

    const tarMat = flatMaterial(0xffffff, true);
    tarMat.polygonOffset = true;
    tarMat.polygonOffsetFactor = -1;
    tarMat.polygonOffsetUnits = -1;
    this.tar = makeInstanced(tarGeometry(tarColor), tarMat, MAX_ZONES, 'zones-tar');

    const lobGeo = new CircleGeometry(1, 32);
    lobGeo.rotateX(-Math.PI / 2);
    this.lobDisc = addInstanceFloat(lobGeo, 'aDisc', MAX_ZONES, 3);
    this.lobs = makeInstanced(lobGeo, discMaterial(LOB_CORE_SHARE), MAX_ZONES, 'zones-lobs');
    const lobCol = addInstanceColor(this.lobs, MAX_ZONES);
    for (let i = 0; i < MAX_ZONES; i++) rgbInto(lobCol, i * 3, PALETTE.zones[ZONE_LOB]);

    const kit = zonesKit(mine, shell, tarColor).build();
    this.propShape = addInstanceFloat(kit, 'aShape', MAX_PROPS);
    this.propGlow = addInstanceFloat(kit, 'aGlow', MAX_PROPS);
    this.props = makeInstanced(kit, kitMaterial(), MAX_PROPS, 'zones-props');
    this.propRgb = addInstanceColor(this.props, MAX_PROPS);
    rgbInto(this.mineRgb, 0, mine);
    rgbInto(this.shellRgb, 0, shell);
    rgbInto(this.shadowRgb, 0, tone(PALETTE.groundA, -0.4));
    rgbInto(this.tarRgb, 0, tarColor);

    this.rings = new GroundRings(MAX_RINGS, RING_SEGMENTS, 'zones-rings', terrain, RING_LIFT);
    rgbInto(this.ringRgb, 0, PALETTE.ring);

    this.tar.renderOrder = 1;
    this.mines.renderOrder = 2;
    this.lobs.renderOrder = 2;
    this.object.add(this.tar, this.props, this.mines, this.lobs, this.rings.mesh);
  }

  private groundNormal(x: number, z: number): Vec3 {
    const n = this.normal;
    if (this.terrain) this.terrain.normalAt(x, z, n);
    else {
      n.x = 0;
      n.y = 1;
      n.z = 0;
    }
    return n;
  }

  private prop(i: number, shape: number, glow: number, rgb: Float32Array): void {
    (this.propShape.array as Float32Array)[i] = shape;
    (this.propGlow.array as Float32Array)[i] = glow;
    this.propRgb[i * 3] = rgb[0];
    this.propRgb[i * 3 + 1] = rgb[1];
    this.propRgb[i * 3 + 2] = rgb[2];
  }

  /** `alpha` (0..1) is how far the frame is from the previous tick to the latest. */
  update(w: World, alpha = 1): void {
    const zn = w.zones;
    this.rings.begin();
    const mm = this.mines.instanceMatrix.array;
    const tm = this.tar.instanceMatrix.array;
    const lm = this.lobs.instanceMatrix.array;
    const pm = this.props.instanceMatrix.array;
    const md = this.mineDisc.array as Float32Array;
    const ld = this.lobDisc.array as Float32Array;
    let mines = 0;
    let tar = 0;
    let lobs = 0;
    let props = 0;
    for (let i = 0; i < zn.count; i++) {
      const kind = zn.kind[i];
      const x = zn.x[i];
      const y = zn.y[i];
      const z = zn.z[i];
      const age = zn.age[i];
      const life = zn.life[i];
      if (kind === ZONE_MINE) {
        const n = this.groundNormal(x, z);
        groundMatrix(mm, mines, n, MINE_SIZE, x + n.x * MINE_LIFT, y + n.y * MINE_LIFT, z + n.z * MINE_LIFT);
        md[mines * 3] = 0;
        md[mines * 3 + 1] = 0;
        md[mines * 3 + 2] = mineStrength(age);
        mines++;
        // The ball sits on the ground, turned its own way, bigger for a bigger blast.
        const k = Math.min(MINE_BALL_MAX, Math.max(0.8, Math.sqrt(zn.r[i] / CRUMBS.radius[0])));
        const lift = MINE_BALL * k * 0.85;
        groundMatrix(pm, props, n, k, x + n.x * lift, y + n.y * lift, z + n.z * lift, k);
        this.turn(pm, props, hash(x, z) * Math.PI * 2);
        this.prop(props++, SHAPE_MINE, mineLight(age), this.mineRgb);
      } else if (kind === ZONE_TAR) {
        const n = this.groundNormal(x, z);
        const grow = Math.min(1, age / TAR_GROW) * Math.min(1, life / TAR_SHRINK);
        const r = zn.r[i] * grow;
        groundMatrix(tm, tar, n, r, x + n.x * TAR_LIFT, y + n.y * TAR_LIFT, z + n.z * TAR_LIFT);
        tar++;
        // Bubbles swell and pop, each somewhere new on the patch.
        const h0 = hash(x, z);
        for (let b = 0; b < TAR_BUBBLES; b++) {
          const clock = (age * DT) / BUBBLE_LIFE + h0 + b * 0.5;
          const cycle = Math.floor(clock);
          const t = clock - cycle;
          if (t > 0.85 || r <= 0) continue;
          const hb = hash(x + cycle * 3.1 + b, z - cycle * 1.7);
          const a = hb * Math.PI * 2;
          const d = BUBBLE_SPREAD * r * Math.sqrt(hash(z + b, x + cycle));
          const bx = x + Math.sin(a) * d;
          const bz = z + Math.cos(a) * d;
          const by = this.terrain ? this.terrain.heightAt(bx, bz) : y;
          const size = BUBBLE_SIZE * (0.6 + 0.6 * hb) * Math.min(1, r / zn.r[i]) * (t / 0.85);
          groundMatrix(pm, props, n, size, bx + n.x * TAR_LIFT, by + n.y * TAR_LIFT, bz + n.z * TAR_LIFT, size);
          this.prop(props++, SHAPE_BUBBLE, 0.05, this.tarRgb);
        }
      } else if (kind === ZONE_LOB) {
        const n = this.groundNormal(x, z);
        const fill = lobFill(age, life);
        groundMatrix(lm, lobs, n, zn.r[i], x + n.x * LOB_LIFT, y + n.y * LOB_LIFT, z + n.z * LOB_LIFT);
        // It beats faster as the shot comes down.
        const beat = LOB_BEAT_FROM + (LOB_BEAT_TO - LOB_BEAT_FROM) * fill;
        const pulse = 1 - LOB_PULSE * 0.5 * (1 - Math.cos(age * beat));
        ld[lobs * 3] = LOB_INNER;
        ld[lobs * 3 + 1] = LOB_INNER * fill;
        ld[lobs * 3 + 2] = LOB_FADE * pulse;
        lobs++;
        // Its shadow, growing as the shot falls, and the shot itself.
        const sr = zn.r[i] * (SHADOW_FROM + (SHADOW_TO - SHADOW_FROM) * fill);
        groundMatrix(pm, props, n, sr, x + n.x * SHADOW_LIFT, y + n.y * SHADOW_LIFT, z + n.z * SHADOW_LIFT);
        this.prop(props++, SHAPE_SHADOW, 0, this.shadowRgb);
        const hgt = lobHeight(fill) + LOB_SHELL;
        const spin = age * 0.15;
        const c = Math.cos(spin);
        const s = Math.sin(spin);
        writeMatrix(pm, props, c, 0, -s, 0, 1, 0, s, 0, c, x, y + hgt, z);
        this.prop(props++, SHAPE_SHELL, 0.5, this.shellRgb);
      } else if (kind === ZONE_RING) {
        // The front as it stands at the frame: back from the latest tick by what it spreads in the rest of one.
        const r = Math.max(0, zn.r[i] - BOSS.standstill.ringSpeed * (1 - alpha) * DT);
        this.rings.add(x, y, z, Math.max(0, r - RING_BAND), r, this.ringRgb, 0, RING_FADE);
      }
    }
    this.rings.end();
    this.finish(this.mines, mines, this.mineDisc);
    this.finish(this.tar, tar, null);
    this.finish(this.lobs, lobs, this.lobDisc);
    this.props.count = props;
    this.props.visible = props > 0;
    if (props > 0) {
      uploadFirst(this.props.instanceMatrix, props);
      uploadFirst(this.propShape, props);
      uploadFirst(this.propGlow, props);
      if (this.props.instanceColor) uploadFirst(this.props.instanceColor, props);
    }
  }

  /** Turn the shape in slot i about its own up axis by `a`. */
  private turn(m: { [i: number]: number }, i: number, a: number): void {
    const o = i * 16;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let k = 0; k < 3; k++) {
      const x = m[o + k];
      const z = m[o + 8 + k];
      m[o + k] = x * c - z * s;
      m[o + 8 + k] = x * s + z * c;
    }
  }

  private finish(mesh: InstancedMesh, n: number, attr: InstancedBufferAttribute | null): void {
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (attr) attr.needsUpdate = true;
    }
  }
}

/**
 * Wide flat rings that follow the ground, all in one strip mesh (one draw call): each ring is a band
 * from an inner to an outer radius, `segments` quads round, its own colour, and lit from the start
 * of the circle round to `fill` of the way (the rest at `dim` of that). Fill `begin()`, `add()` each
 * ring, `end()`, once a frame.
 */
export class GroundRings {
  readonly mesh: Mesh;
  readonly segments: number;
  readonly capacity: number;
  /** Per vertex: position, strength, colour. Two vertices (inner, outer) per step round a ring. */
  readonly positions: Float32Array;
  readonly fades: Float32Array;
  readonly colors: Float32Array;
  private readonly terrain: Terrain | null;
  private readonly lift: number;
  private readonly geometry: BufferGeometry;
  private readonly posAttr: BufferAttribute;
  private readonly fadeAttr: BufferAttribute;
  private readonly colorAttr: BufferAttribute;
  /** sin and cos round the circle, one per step. */
  private readonly sinA: Float32Array;
  private readonly cosA: Float32Array;
  private rings = 0;
  /** Where each slot's ring was last laid (x, y, z, inner, outer): a ring that has not moved keeps its points. */
  private readonly laid: Float64Array;

  constructor(capacity: number, segments: number, name: string, terrain: Terrain | null, lift: number) {
    this.capacity = capacity;
    this.laid = new Float64Array(capacity * 5).fill(Number.NaN);
    this.segments = segments;
    this.terrain = terrain;
    this.lift = lift;
    const verts = capacity * (segments + 1) * 2;
    this.positions = new Float32Array(verts * 3);
    this.fades = new Float32Array(verts);
    this.colors = new Float32Array(verts * 3);
    this.sinA = new Float32Array(segments + 1);
    this.cosA = new Float32Array(segments + 1);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      this.sinA[j] = Math.sin(a);
      this.cosA[j] = Math.cos(a);
    }
    const index = new Uint32Array(capacity * segments * 6);
    let k = 0;
    for (let r = 0; r < capacity; r++) {
      const base = r * (segments + 1) * 2;
      for (let j = 0; j < segments; j++) {
        const i0 = base + j * 2;
        index[k++] = i0;
        index[k++] = i0 + 1;
        index[k++] = i0 + 3;
        index[k++] = i0;
        index[k++] = i0 + 3;
        index[k++] = i0 + 2;
      }
    }
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.fadeAttr = new BufferAttribute(this.fades, 1);
    this.fadeAttr.setUsage(DynamicDrawUsage);
    this.colorAttr = new BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aFade', this.fadeAttr);
    g.setAttribute('color', this.colorAttr);
    g.setIndex(new BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    const mat = fadeMaterial(0xffffff, true);
    mat.side = DoubleSide;
    this.mesh = new Mesh(g, mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /** Rings added since `begin`. */
  get count(): number {
    return this.rings;
  }

  begin(): void {
    this.rings = 0;
  }

  /**
   * A ring round (x, z) from rIn to rOut, at height y where there is no terrain. `rgb` is linear
   * colour at offset `o`. Returns false when full.
   */
  add(x: number, y: number, z: number, rIn: number, rOut: number, rgb: Float32Array, o: number, fade: number, fill = 1, dim = 1): boolean {
    if (this.rings >= this.capacity) return false;
    const seg = this.segments;
    const t = this.terrain;
    const lift = this.lift;
    let v = this.rings * (seg + 1) * 2;
    // Following the ground is the costly part: a ring laid where it was last frame keeps its points.
    const l = this.laid;
    const k = this.rings * 5;
    const moved = l[k] !== x || l[k + 1] !== y || l[k + 2] !== z || l[k + 3] !== rIn || l[k + 4] !== rOut;
    if (moved) {
      l[k] = x;
      l[k + 1] = y;
      l[k + 2] = z;
      l[k + 3] = rIn;
      l[k + 4] = rOut;
    }
    for (let j = 0; j <= seg; j++) {
      const s = this.sinA[j];
      const c = this.cosA[j];
      const f = j / seg <= fill ? fade : fade * dim;
      for (let e = 0; e < 2; e++) {
        const p = v * 3;
        if (moved) {
          const r = e === 0 ? rIn : rOut;
          const px = x + s * r;
          const pz = z + c * r;
          this.positions[p] = px;
          this.positions[p + 1] = (t ? t.heightAt(px, pz) : y) + lift;
          this.positions[p + 2] = pz;
        }
        this.fades[v] = f;
        this.colors[p] = rgb[o];
        this.colors[p + 1] = rgb[o + 1];
        this.colors[p + 2] = rgb[o + 2];
        v++;
      }
    }
    this.rings++;
    return true;
  }

  end(): void {
    const n = this.rings;
    this.geometry.setDrawRange(0, n * this.segments * 6);
    this.mesh.visible = n > 0;
    if (n > 0) {
      const verts = n * (this.segments + 1) * 2;
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(0, verts * 3);
      this.posAttr.needsUpdate = true;
      this.fadeAttr.clearUpdateRanges();
      this.fadeAttr.addUpdateRange(0, verts);
      this.fadeAttr.needsUpdate = true;
      this.colorAttr.clearUpdateRanges();
      this.colorAttr.addUpdateRange(0, verts * 3);
      this.colorAttr.needsUpdate = true;
    }
  }
}
