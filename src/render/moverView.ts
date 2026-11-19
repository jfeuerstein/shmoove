/**
 * The mover: a skater on a skateboard, and a blob shadow pinned to the ground under it (that is how
 * hop height is read).
 *
 * The board, in `PALETTE.accent`: a deck with kicked-up nose and tail and dark grip on top, two
 * trucks and four chunky wheels that turn with speed. On it a chunky toy figure stands side-on to
 * the way it is going (it faces +x of the board's frame): a hoodie in `PALETTE.mover`
 * (`PALETTE.moverTuck` while tucked), dark trousers, big shoes and mitts, a helmet in the accent
 * colour with a dark visor, its head turned to look where it is going, and a scarf whose tail trails
 * behind it, streaming out straight at speed and hanging down when it is slow.
 *
 * Poses blend over `POSE_TIME`, read from the sim state interpolated `alpha` of the way from `prev`
 * to `cur`:
 * - pushing (the stick held on the ground below run speed): standing tall, the back foot comes off
 *   the board, plants on the ground ahead and pushes back, then swings forward again;
 * - riding at speed with the stick held: knees bent, arms out along the board;
 * - coasting (`tucked`): crouched low, hands forward on the knees;
 * - carving: leaning into the turn by the sideways acceleration, the hands reaching to the inside;
 * - the ollie: the pop (tail down, nose up, the front foot sliding up), the tuck in the air (knees
 *   up), and the landing, absorbed in a crouch as deep as the impact was hard;
 * - grinding (`rail >= 0`): a boardslide, the board across the rail with its deck on the bar,
 *   crouched with the arms spread wide and high;
 * - hurt (the player's invulnerable ticks after a hit): a flinch, thrown back with the arms up, and a
 *   blink while nothing can hurt it;
 * - wiped out (the run over, dead): it falls over backward and lies there, the board shooting out
 *   ahead and landing wheels up.
 *
 * With the world given, every passive carried shows as one small part, a little bigger at each
 * level: Wax a pale shine under the deck, Springs coils on the trucks, Wings little wings at the
 * heels, Magnet a horseshoe on the back, Heart a heart on the chest, Regen a sprout on the helmet,
 * Might big gloves with cuffs, Hide pads on the shoulders and knees, Haste a bolt on the helmet,
 * Luck a star on the deck, Wide Load a wider deck with bumpers along its sides.
 *
 * Two meshes, each one fixed-size geometry rewritten in place every frame (at most `FIGURE_TRIANGLES`
 * and `BOARD_TRIANGLES`, drawn up to what is used), with tones of the palette baked per vertex.
 * `update` allocates nothing.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  type MeshLambertMaterial,
  type Object3D,
  Quaternion,
  Sphere,
  Vector3,
} from 'three';
import {
  P_HASTE,
  P_HEART,
  P_HIDE,
  P_LUCK,
  P_MAGNET,
  P_MIGHT,
  P_REGEN,
  P_SPRINGS,
  P_WAX,
  P_WIDE_LOAD,
  P_WINGS,
  PASSIVE_COUNT,
} from '../sim/arsenal';
import { DT, FEEL } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import type { SimState, Vec3 } from '../sim/types';
import { PHASE_DEAD, type World } from '../sim/world';
import { PALETTE, flatMaterial, glowMaterial, setGlowColor, tone } from './look';

/** Most triangles in the figure and in the board (with every passive at its biggest). */
export const FIGURE_TRIANGLES = 450;
export const BOARD_TRIANGLES = 250;

// ---- the board (local frame: +z the nose, +y up, +x the side the rider faces) ----------------

/** Half the deck's length and width, its thickness, and the height of its underside, m. */
export const DECK_HALF_LENGTH = 0.45;
export const DECK_HALF_WIDTH = 0.125;
const DECK_THICK = 0.035;
const DECK_LOW = 0.11;
const DECK_TOP = DECK_LOW + DECK_THICK;
/** Where the kicks start, from the middle, and how far their tips rise, m. */
const KICK_AT = 0.31;
const KICK_RISE = 0.055;
/** The wheels: this far either side of the middle along the board, their radius and width, m. */
const WHEEL_ALONG = 0.29;
export const WHEEL_RADIUS = 0.055;
const WHEEL_HALF_WIDTH = 0.025;
const WHEEL_SIDES = 6;
/** In the air the board's nose comes up by this much at the pop, and by `AIR_NOSE_LATE` later, rad. */
export const AIR_NOSE = 0.38;
const AIR_NOSE_LATE = 0.18;
/** Ticks in the air the pop lasts. */
const POP_TICKS = 9;
/** Ticks on the ground the landing's absorb lasts, and the impact (m/s) that makes it deepest. */
const LAND_TICKS = 16;
const LAND_HARD = 8;
/** Glow of the board: enough to read on the dark ground, well under the figure's. */
const BOARD_GLOW = 0.3;

// ---- the figure -----------------------------------------------------------------------------

/** The feet stand this far from the middle of the board, toward the nose and the tail, m. */
const FOOT_AT = 0.22;
/** The hips are this far apart along the board, m. */
const HIP_HALF = 0.1;
/** Thigh and shin, each, m. */
const LIMB = 0.45;
/** Hips above the deck, standing tall and at the lowest crouch, m. */
const HIP_TALL = 0.84;
const HIP_LOW = 0.48;
/** How far the torso pitches toward the side the rider faces, tall and crouched, rad. */
const TORSO_TALL = 0.1;
const TORSO_LOW = 0.62;
/** The torso: its length, half its depth, half its shoulders and its waist, m. */
const TORSO_LEN = 0.5;
const TORSO_DEPTH = 0.14;
const TORSO_SHOULDERS = 0.21;
const TORSO_WAIST = 0.16;
/** The head: its middle above the shoulders, and how far it turns toward the nose, rad. */
const HEAD_UP = 0.2;
const HEAD_TURN = 1.0;
/** Upper arm and forearm, m. */
const ARM_UPPER = 0.28;
const ARM_LOWER = 0.27;
/** Limb thickness: hips, ankles, shoulders, wrists, m. */
const THIGH_R = 0.1;
const ANKLE_R = 0.07;
const ARM_R = 0.065;
const WRIST_R = 0.055;
/** The scarf's tail: segments, each this long, this wide, m. */
const SCARF_SEGMENTS = 6;
const SCARF_SEG = 0.11;
const SCARF_WIDE = 0.05;
/** Speed at which the scarf streams out straight behind, m/s. */
const SCARF_FULL = 14;

/** Crouch, 0 tall to 1 lowest: pushing, riding with the stick held, coasting, in the air. */
export const CROUCH_PUSH = 0;
export const CROUCH_RIDE = 0.35;
export const CROUCH_COAST = 1;
export const CROUCH_AIR = 0.8;
export const CROUCH_GRIND = 0.7;
/** Below this share of run speed with the stick held, the rider is pushing. */
const PUSH_SHARE = 0.95;
/** Pushes a second. */
const PUSH_RATE = 1.25;
/** Time for the pose to get most of the way to a new one, s. */
export const POSE_TIME = 0.07;
/** A pose this near the one it is easing to is taken as there. */
const POSE_SNAP = 1e-3;
/** The flinch lasts this many of the invulnerable ticks after a hit; the blink flips every this many. */
const FLINCH_TICKS = 16;
const BLINK_TICKS = 4;
/** Seconds the wipe-out takes to fall. */
const WIPE_TIME = 0.5;

/** Steepest lean into a turn, rad. */
const MAX_LEAN = 0.55;
/** Blob shadow radius on the ground, and how high above the ground it has shrunk to nothing, m. */
const SHADOW_RADIUS = 0.6;
const SHADOW_FADE_HEIGHT = 12;
const SHADOW_MIN_SCALE = 0.35;
const SHADOW_LIFT = 0.04;
const SHADOW_OPACITY = 0.55;

/** A box's corners as signs on its three axes, and its faces (two triangles each) by corner. */
const BOX_SIGNS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const BOX_FACES = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 3, 7, 0, 7, 4, 1, 2, 6, 1, 6, 5, 3, 2, 6, 3, 6, 7, 0, 1, 5, 0, 5, 4];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A passive's size at `level` (1..5): 0.7 at the first, 1.1 at the fifth. */
function grow(level: number): number {
  return 0.6 + 0.1 * level;
}

/**
 * Triangles written in place into a fixed-size geometry, each facing away from a given middle, each
 * in the current colour. What is not used this frame is not drawn.
 */
class Shape {
  readonly geometry = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly col: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly norAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private n = 0;
  private r = 1;
  private g = 1;
  private b = 1;
  /** Scratch corners for boxes and rings. */
  private readonly c = new Float32Array(16 * 3);

  constructor(readonly triangles: number) {
    this.pos = new Float32Array(triangles * 9);
    this.nor = new Float32Array(triangles * 9);
    this.col = new Float32Array(triangles * 9);
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.norAttr = new BufferAttribute(this.nor, 3);
    this.colAttr = new BufferAttribute(this.col, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.norAttr);
    this.geometry.setAttribute('color', this.colAttr);
    // The rider never leaves this sphere about its feet (lying down, its board shot out ahead).
    this.geometry.boundingSphere = new Sphere(new Vector3(0, 0.6, 0.3), 2.2);
  }

  /** Triangles drawn this frame. */
  get used(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
  }

  end(): void {
    // Whatever was drawn last frame past this one's end is folded away.
    this.pos.fill(0, this.n * 9);
    this.geometry.setDrawRange(0, this.n * 3);
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  /** The colour of what follows: linear RGB from a table. */
  color(rgb: Float32Array, o: number): void {
    this.r = rgb[o];
    this.g = rgb[o + 1];
    this.b = rgb[o + 2];
  }

  /** One triangle, wound to face away from (mx, my, mz). */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    mx: number, my: number, mz: number,
  ): void {
    if (this.n >= this.triangles) throw new Error(`shape is full at ${this.triangles} triangles`);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const out = nx * ((ax + bx + cx) / 3 - mx) + ny * ((ay + by + cy) / 3 - my) + nz * ((az + bz + cz) / 3 - mz);
    const flip = out < 0;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const s = flip ? -1 / l : 1 / l;
    nx *= s;
    ny *= s;
    nz *= s;
    const o = this.n * 9;
    const p = this.pos;
    p[o] = ax;
    p[o + 1] = ay;
    p[o + 2] = az;
    if (flip) {
      p[o + 3] = cx;
      p[o + 4] = cy;
      p[o + 5] = cz;
      p[o + 6] = bx;
      p[o + 7] = by;
      p[o + 8] = bz;
    } else {
      p[o + 3] = bx;
      p[o + 4] = by;
      p[o + 5] = bz;
      p[o + 6] = cx;
      p[o + 7] = cy;
      p[o + 8] = cz;
    }
    const q = this.nor;
    const k = this.col;
    for (let i = 0; i < 3; i++) {
      q[o + i * 3] = nx;
      q[o + i * 3 + 1] = ny;
      q[o + i * 3 + 2] = nz;
      k[o + i * 3] = this.r;
      k[o + i * 3 + 1] = this.g;
      k[o + i * 3 + 2] = this.b;
    }
    this.n++;
  }

  /**
   * A box about (x, y, z) with half-axes a, b, c (each a vector, its length the half-size). Twelve
   * triangles, or ten with no bottom (the face on -b).
   */
  box(
    x: number, y: number, z: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    bottom = true,
  ): void {
    const c = this.c;
    for (let k = 0; k < 8; k++) {
      const sa = BOX_SIGNS[k * 3];
      const sb = BOX_SIGNS[k * 3 + 1];
      const sc = BOX_SIGNS[k * 3 + 2];
      c[k * 3] = x + ax * sa + bx * sb + cx * sc;
      c[k * 3 + 1] = y + ay * sa + by * sb + cy * sc;
      c[k * 3 + 2] = z + az * sa + bz * sb + cz * sc;
    }
    this.corners(bottom ? BOX_FACES.length : BOX_FACES.length - 6, x, y, z);
  }

  /** The box faces over the eight corners in the scratch, facing away from (x, y, z). */
  private corners(faces: number, x: number, y: number, z: number): void {
    const c = this.c;
    for (let f = 0; f < faces; f += 3) {
      const i = BOX_FACES[f] * 3;
      const j = BOX_FACES[f + 1] * 3;
      const k = BOX_FACES[f + 2] * 3;
      this.tri(c[i], c[i + 1], c[i + 2], c[j], c[j + 1], c[j + 2], c[k], c[k + 1], c[k + 2], x, y, z);
    }
  }

  /**
   * A box given by its eight corners (in BOX_SIGNS order, read from `p` at `o`), facing away from
   * their middle. Twelve triangles.
   */
  hex(p: Float32Array): void {
    const c = this.c;
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let k = 0; k < 24; k++) c[k] = p[k];
    for (let k = 0; k < 8; k++) {
      mx += c[k * 3];
      my += c[k * 3 + 1];
      mz += c[k * 3 + 2];
    }
    this.corners(BOX_FACES.length, mx / 8, my / 8, mz / 8);
  }

  /** A `sides`-sided limb from A (thickness ra) to B (thickness rb), open at the ends. Two triangles a side. */
  limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, sides = 4): void {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    // u = d x (a helper not along d), v = d x u.
    const hx = dx > 0.9 || dx < -0.9 ? 0 : 1;
    const hy = 1 - hx;
    let ux = -dz * hy;
    let uy = dz * hx;
    let uz = dx * hy - dy * hx;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    const step = (Math.PI * 2) / sides;
    for (let k = 0; k < sides; k++) {
      const a0 = (k + 0.5) * step;
      const a1 = a0 + step;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const ox0 = ux * c0 + vx * s0;
      const oy0 = uy * c0 + vy * s0;
      const oz0 = uz * c0 + vz * s0;
      const ox1 = ux * c1 + vx * s1;
      const oy1 = uy * c1 + vy * s1;
      const oz1 = uz * c1 + vz * s1;
      this.tri(ax + ox0 * ra, ay + oy0 * ra, az + oz0 * ra, ax + ox1 * ra, ay + oy1 * ra, az + oz1 * ra, bx + ox1 * rb, by + oy1 * rb, bz + oz1 * rb, mx, my, mz);
      this.tri(ax + ox0 * ra, ay + oy0 * ra, az + oz0 * ra, bx + ox1 * rb, by + oy1 * rb, bz + oz1 * rb, bx + ox0 * rb, by + oy0 * rb, bz + oz0 * rb, mx, my, mz);
    }
  }

  /** A diamond about (x, y, z) reaching r along each axis (rx, ry, rz). Eight triangles. */
  diamond(x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
    for (let k = 0; k < 4; k++) {
      const x0 = k === 0 ? rx : k === 2 ? -rx : 0;
      const z0 = k === 1 ? rz : k === 3 ? -rz : 0;
      const j = (k + 1) % 4;
      const x1 = j === 0 ? rx : j === 2 ? -rx : 0;
      const z1 = j === 1 ? rz : j === 3 ? -rz : 0;
      this.tri(x + x0, y, z + z0, x + x1, y, z + z1, x, y + ry, z, x, y, z);
      this.tri(x + x0, y, z + z0, x + x1, y, z + z1, x, y - ry, z, x, y, z);
    }
  }

  /**
   * A ring of `n` sides round an axis: centre (x, y, z), axis u (unit), and two unit vectors a, b
   * across it; radius r0 at height h0 along u, r1 at h1, with a cap at the top if asked. Two
   * triangles a side, one more per side for the cap.
   */
  ring(
    x: number, y: number, z: number,
    ux: number, uy: number, uz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    n: number, r0: number, r1: number, h0: number, h1: number, top: boolean, turn = 0,
  ): void {
    const mx = x + ux * (h0 + h1) * 0.5;
    const my = y + uy * (h0 + h1) * 0.5;
    const mz = z + uz * (h0 + h1) * 0.5;
    const step = (Math.PI * 2) / n;
    for (let k = 0; k < n; k++) {
      const c0 = Math.cos(turn + k * step);
      const s0 = Math.sin(turn + k * step);
      const c1 = Math.cos(turn + (k + 1) * step);
      const s1 = Math.sin(turn + (k + 1) * step);
      const p0x = x + ux * h0 + (ax * c0 + bx * s0) * r0;
      const p0y = y + uy * h0 + (ay * c0 + by * s0) * r0;
      const p0z = z + uz * h0 + (az * c0 + bz * s0) * r0;
      const p1x = x + ux * h0 + (ax * c1 + bx * s1) * r0;
      const p1y = y + uy * h0 + (ay * c1 + by * s1) * r0;
      const p1z = z + uz * h0 + (az * c1 + bz * s1) * r0;
      const q0x = x + ux * h1 + (ax * c0 + bx * s0) * r1;
      const q0y = y + uy * h1 + (ay * c0 + by * s0) * r1;
      const q0z = z + uz * h1 + (az * c0 + bz * s0) * r1;
      const q1x = x + ux * h1 + (ax * c1 + bx * s1) * r1;
      const q1y = y + uy * h1 + (ay * c1 + by * s1) * r1;
      const q1z = z + uz * h1 + (az * c1 + bz * s1) * r1;
      this.tri(p0x, p0y, p0z, p1x, p1y, p1z, q1x, q1y, q1z, mx, my, mz);
      this.tri(p0x, p0y, p0z, q1x, q1y, q1z, q0x, q0y, q0z, mx, my, mz);
      if (top) this.tri(q0x, q0y, q0z, q1x, q1y, q1z, x + ux * h1, y + uy * h1, z + uz * h1, mx, my, mz);
    }
  }
}

/** Colours the rider is built from, as rows of linear RGB in one table. */
const C_BODY = 0;
const C_BODY_DARK = 1;
const C_PANTS = 2;
const C_SKIN = 3;
const C_HELMET = 4;
const C_VISOR = 5;
const C_SHOE = 6;
const C_SCARF = 7;
const C_DECK = 8;
const C_GRIP = 9;
const C_TRUCK = 10;
const C_WHEEL = 11;
const C_WAX = 12;
const C_SPRING = 13;
const C_WING = 14;
const C_MAGNET = 15;
const C_METAL = 16;
const C_HEART = 17;
const C_REGEN = 18;
const C_GLOVE = 19;
const C_PAD = 20;
const C_BOLT = 21;
const C_STAR = 22;
const C_BUMPER = 23;
const C_COUNT = 24;

export class MoverView {
  readonly object: Object3D;
  /** The rider and the board, in the body's frame. */
  readonly figure: Mesh;
  readonly board: Mesh;
  readonly shadow: Mesh;
  /** The pose last drawn: crouch 0 (tall) to 1 (lowest), and the board's nose-up pitch, rad. */
  crouch = CROUCH_RIDE;
  pitch = 0;
  /** How far the arms are spread, 0 riding to 1 grinding. */
  spread = 0;
  /** True while the last pose drawn was a grind: the board across the rail. */
  grinding = false;
  /** How much of a push is shown, 0 to 1, and how far through its stroke the back foot is, 0..1. */
  push = 0;
  pushPhase = 0;
  /** The flinch shown, 0 to 1, and whether this frame is a blink. */
  flinch = 0;
  blink = false;
  /** How far through the wipe-out, 0 standing to 1 lying on the ground. */
  wipe = 0;
  /** How far the wheels have turned, rad. */
  wheelTurn = 0;
  /** Levels of the passives shown, by P_*. */
  readonly passives = new Uint8Array(PASSIVE_COUNT);

  /** Placed at the mover, tilted to the ground. */
  private readonly root = new Group();
  /** Turned to the heading and leaning. */
  private readonly body = new Group();
  private readonly figureShape = new Shape(FIGURE_TRIANGLES);
  private readonly boardShape = new Shape(BOARD_TRIANGLES);
  private readonly material = glowMaterial(PALETTE.mover);
  private readonly rgb = new Float32Array(C_COUNT * 3);
  private tuckShown = false;
  private blinkShown = false;
  private posed = false;
  /** The scarf's flutter, rad, and how far it streams out, 0 hanging to 1 straight back. */
  private flutter = 0;
  private trail = 0;
  /** The hand's reach to the inside of a turn, -1 (heel side) to 1 (toe side). */
  private carve = 0;
  /** How much of the landing's absorb, the pop and the air are shown, 0 to 1. */
  private absorb = 0;
  private pop = 0;
  private air = 0;
  private wipeTime = 0;
  /** This frame's share of the way to a new pose. */
  private easeK = 1;
  /** The board's frame this frame: its middle's height, along (0, fy, fz) and up (0, uy, uz). */
  private bpy = 0;
  private bfy = 0;
  private bfz = 1;
  private buy = 1;
  private buz = 0;

  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();
  private readonly q = new Quaternion();
  private readonly ground: Vec3 = { x: 0, y: 1, z: 0 };
  /** Scratch: a knee or an elbow, and the corners of a deck piece. */
  private readonly joint = new Float32Array(3);
  private readonly hexp = new Float32Array(24);
  private readonly scratch = new Color();

  constructor() {
    const container = new Group();
    container.name = 'mover';
    figureMaterial(this.material);
    this.figure = new Mesh(this.figureShape.geometry, this.material);
    this.figure.name = 'mover-rider';
    const boardMat = glowMaterial(PALETTE.accent, BOARD_GLOW);
    figureMaterial(boardMat);
    this.board = new Mesh(this.boardShape.geometry, boardMat);
    this.board.name = 'mover-board';
    this.body.add(this.board, this.figure);
    this.root.add(this.body);

    const shadowMat = flatMaterial(PALETTE.sky);
    shadowMat.transparent = true;
    shadowMat.opacity = SHADOW_OPACITY;
    shadowMat.depthWrite = false;
    const shadowGeo = new CircleGeometry(SHADOW_RADIUS, 20);
    // Lay the disc flat, facing up.
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new Mesh(shadowGeo, shadowMat);
    this.shadow.renderOrder = 1;
    container.add(this.root, this.shadow);
    this.object = container;
    this.paint();
    this.pose(this.crouch, this.pitch, this.spread, 0);
  }

  /** Triangles drawn last frame: the figure's and the board's. */
  get triangles(): number {
    return this.figureShape.used + this.boardShape.used;
  }

  /**
   * Draw as of `alpha` (0..1) of the way from `prev` to `cur`. `dt` is the real time since the last
   * frame, s; the pose eases toward the new one over it (left out, it snaps). With `world`, the
   * passives carried, a hit and the end of the run show on the rider; it is only read.
   */
  update(prev: SimState, cur: SimState, alpha: number, terrain: Terrain, dt = Infinity, world?: World): void {
    const a = prev.mover;
    const b = cur.mover;
    const x = lerp(a.x, b.x, alpha);
    const y = lerp(a.y, b.y, alpha);
    const z = lerp(a.z, b.z, alpha);
    const turn = angleDelta(a.heading, b.heading);
    const heading = a.heading + turn * alpha;
    const step = dt === Infinity ? 0 : dt > 0 ? dt : 0;
    this.easeK = dt === Infinity ? 1 : 1 - Math.exp(-step / POSE_TIME);

    const grinding = b.rail >= 0;
    this.grinding = grinding;
    this.root.position.set(x, y, z);
    if (b.grounded && !grinding) {
      this.n.set(lerp(a.nx, b.nx, alpha), lerp(a.ny, b.ny, alpha), lerp(a.nz, b.nz, alpha)).normalize();
      this.root.quaternion.setFromUnitVectors(this.up, this.n);
    } else {
      this.root.quaternion.identity();
    }

    // Lean by the sideways acceleration of the last step: speed times turn rate, against gravity.
    // A rising heading turns left (toward +x when facing +z); rolling about +z by a negative angle
    // leans the top toward +x.
    const speed = lerp(a.speed, b.speed, alpha);
    const side = (speed * turn) / DT;
    let lean = -Math.atan(side / FEEL.gravity);
    if (!b.grounded) lean *= 0.5;
    if (lean > MAX_LEAN) lean = MAX_LEAN;
    else if (lean < -MAX_LEAN) lean = -MAX_LEAN;

    // What the world says: the run over, a hit, the passives.
    const dead = world !== undefined && world.run.phase === PHASE_DEAD;
    this.wipeTime = dead ? this.wipeTime + step : 0;
    this.wipe = dead ? (dt === Infinity ? 1 : clamp01(this.wipeTime / WIPE_TIME)) : 0;
    const invuln = world !== undefined && !dead ? world.player.invuln : 0;
    this.flinch = clamp01((invuln - (FEEL.invulnTicks - FLINCH_TICKS)) / FLINCH_TICKS);
    this.blink = invuln > 0 && Math.floor(invuln / BLINK_TICKS) % 2 === 1;
    if (world !== undefined) this.passives.set(world.player.loadout.passiveLevel);
    else this.passives.fill(0);

    if (grinding) {
      // A boardslide: turned a quarter so the board lies across the rail and the side the rider
      // faces (+x) points the way it is going, the deck itself resting on the bar.
      this.body.rotation.set(0, heading - Math.PI / 2, 0);
      this.body.position.set(0, -DECK_LOW, 0);
    } else {
      this.body.rotation.set(0, heading, dead ? 0 : lean);
      this.body.position.set(0, 0, 0);
    }

    // What the thumb is doing, read off the pose.
    let crouch: number;
    let pitch = 0;
    let spread = 0;
    let push = 0;
    let pop = 0;
    let air = 0;
    let absorb = 0;
    if (grinding) {
      crouch = CROUCH_GRIND;
      spread = 1;
    } else if (!b.grounded) {
      crouch = CROUCH_AIR;
      air = 1;
      pop = b.airTicks < POP_TICKS ? 1 - b.airTicks / POP_TICKS : 0;
      pitch = lerp(AIR_NOSE_LATE, AIR_NOSE, pop);
    } else {
      if (b.tucked) crouch = CROUCH_COAST;
      else if (speed < FEEL.runSpeed * PUSH_SHARE) {
        crouch = CROUCH_PUSH;
        push = 1;
      } else crouch = CROUCH_RIDE;
      if (b.groundTicks < LAND_TICKS && b.impact > 0) absorb = clamp01(b.impact / LAND_HARD) * (1 - b.groundTicks / LAND_TICKS);
    }
    if (dead) {
      crouch = 0.25;
      spread = 0.6;
      pitch = 0;
      push = 0;
      air = 0;
      pop = 0;
      absorb = 0;
    }
    crouch = this.ease(this.crouch, crouch);
    pitch = this.ease(this.pitch, pitch);
    spread = this.ease(this.spread, spread);
    this.push = this.ease(this.push, push);
    this.pop = this.ease(this.pop, pop);
    this.air = this.ease(this.air, air);
    this.absorb = this.ease(this.absorb, absorb);
    this.carve = this.ease(this.carve, grinding || dead ? 0 : lean / MAX_LEAN);
    this.trail = this.ease(this.trail, clamp01(speed / SCARF_FULL));
    this.posed = true;
    if (this.push > 0.01) this.pushPhase = (this.pushPhase + step * PUSH_RATE) % 1;
    this.flutter = (this.flutter + step * (5 + speed * 0.7)) % (Math.PI * 200);
    if (!dead) this.wheelTurn = (this.wheelTurn + (step * speed) / WHEEL_RADIUS) % (Math.PI * 2);

    const tuck = b.tucked && !dead;
    if (tuck !== this.tuckShown || this.blink !== this.blinkShown) {
      this.tuckShown = tuck;
      this.blinkShown = this.blink;
      setGlowColor(this.material, tuck ? PALETTE.moverTuck : PALETTE.mover);
      this.paint();
    }
    this.pose(crouch, pitch, spread, lean);

    // The wipe-out: the rider falls over backward (toward -x) and the board shoots out ahead,
    // landing wheels up.
    const wp = this.wipe;
    const fall = wp * wp * (3 - 2 * wp);
    this.figure.rotation.set(0, 0, fall * 1.42);
    this.figure.position.set(0, fall * 0.16, -fall * 0.1);
    this.board.rotation.set(0, 0, fall * Math.PI);
    this.board.position.set(0, fall * DECK_TOP, fall * 1.3);

    // The shadow: straight below, on the ground, flat to it, smaller the higher the mover is.
    const gy = terrain.heightAt(x, z);
    terrain.normalAt(x, z, this.ground);
    this.n.set(this.ground.x, this.ground.y, this.ground.z);
    this.q.setFromUnitVectors(this.up, this.n);
    this.shadow.position.set(x, gy + SHADOW_LIFT, z);
    this.shadow.quaternion.copy(this.q);
    const h = y - gy;
    let s = 1 - h / SHADOW_FADE_HEIGHT;
    if (s < SHADOW_MIN_SCALE) s = SHADOW_MIN_SCALE;
    else if (s > 1) s = 1;
    this.shadow.scale.set(s, 1, s);
  }

  /** Ease from the pose last drawn toward `to` by this frame's share; close enough is there. */
  private ease(from: number, to: number): number {
    return this.posed && Math.abs(to - from) > POSE_SNAP ? lerp(from, to, this.easeK) : to;
  }

  /** Work out the colour table from the palette: tones of the rider's colours, lighter in a blink. */
  private paint(): void {
    const body = this.tuckShown ? PALETTE.moverTuck : PALETTE.mover;
    this.setColor(C_BODY, body);
    this.setColor(C_BODY_DARK, tone(body, -0.22));
    this.setColor(C_PANTS, tone(PALETTE.mover, -0.62));
    this.setColor(C_SKIN, tone(PALETTE.mover, 0.58));
    this.setColor(C_HELMET, PALETTE.accent);
    this.setColor(C_VISOR, tone(PALETTE.accent, -0.82));
    this.setColor(C_SHOE, tone(PALETTE.mover, 0.78));
    this.setColor(C_SCARF, tone(PALETTE.accent, 0.12));
    this.setColor(C_DECK, PALETTE.accent);
    this.setColor(C_GRIP, tone(PALETTE.accent, -0.72));
    this.setColor(C_TRUCK, tone(PALETTE.rail, -0.35));
    this.setColor(C_WHEEL, tone(PALETTE.mover, 0.7));
    this.setColor(C_WAX, PALETTE.spark);
    this.setColor(C_SPRING, PALETTE.rail);
    this.setColor(C_WING, tone(PALETTE.elite, -0.05));
    this.setColor(C_MAGNET, PALETTE.ring);
    this.setColor(C_METAL, PALETTE.rail);
    this.setColor(C_HEART, PALETTE.hpLow);
    this.setColor(C_REGEN, PALETTE.hp);
    this.setColor(C_GLOVE, PALETTE.wake);
    this.setColor(C_PAD, tone(PALETTE.accent, -0.45));
    this.setColor(C_BOLT, PALETTE.orbit);
    this.setColor(C_STAR, PALETTE.things[1]);
    this.setColor(C_BUMPER, PALETTE.rail);
  }

  /** Row `i` of the colour table: `hex` as linear RGB, lighter in a blink (the board does not blink). */
  private setColor(i: number, hex: number): void {
    const c = this.scratch.setHex(this.blinkShown && i < C_DECK ? tone(hex, 0.6) : hex);
    this.rgb[i * 3] = c.r;
    this.rgb[i * 3 + 1] = c.g;
    this.rgb[i * 3 + 2] = c.b;
  }

  /** Build the board and the rider for a crouch (0..1), the board's nose-up pitch, the arms' spread (0..1) and the lean. */
  private pose(crouch: number, pitch: number, spread: number, lean: number): void {
    this.crouch = crouch;
    this.pitch = pitch;
    this.spread = spread;
    const lv = this.passives;
    const rgb = this.rgb;

    // ---- the board. It turns nose-up about its middle. Its axes: along (f), up (u), across (x).
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fy = sp;
    const fz = cp;
    const uy = cp;
    const uz = -sp;
    const py = DECK_LOW + DECK_THICK / 2;
    const wide = lv[P_WIDE_LOAD] > 0 ? 1 + 0.12 * lv[P_WIDE_LOAD] : 1;
    const hw = DECK_HALF_WIDTH * wide;
    const bs = this.boardShape;
    bs.begin();
    this.bpy = py;
    this.bfy = fy;
    this.bfz = fz;
    this.buy = uy;
    this.buz = uz;
    const t = DECK_THICK / 2;
    bs.color(rgb, C_DECK * 3);
    // The middle of the deck, and the two kicks rising to the nose and the tail.
    this.deckPiece(bs, hw, -KICK_AT, KICK_AT, 0, 0, t);
    this.deckPiece(bs, hw, KICK_AT, DECK_HALF_LENGTH, 0, KICK_RISE, t);
    this.deckPiece(bs, hw, -KICK_AT, -DECK_HALF_LENGTH, 0, KICK_RISE, t);
    // Grip on top.
    bs.color(rgb, C_GRIP * 3);
    bs.box(0, this.by(t + 0.006, 0), this.bz(t + 0.006, 0), hw - 0.02, 0, 0, 0, uy * 0.008, uz * 0.008, 0, fy * (KICK_AT - 0.02), fz * (KICK_AT - 0.02));
    // Trucks and wheels.
    const wx = hw - WHEEL_HALF_WIDTH - 0.005;
    for (let e = 0; e < 2; e++) {
      const al = e === 0 ? WHEEL_ALONG : -WHEEL_ALONG;
      const axleUp = WHEEL_RADIUS - py;
      bs.color(rgb, C_TRUCK * 3);
      const hy = (DECK_LOW - py + axleUp) / 2 + 0.01;
      const hh = (DECK_LOW - py - axleUp) / 2;
      bs.box(0, this.by(hy, al), this.bz(hy, al), wx - WHEEL_HALF_WIDTH, 0, 0, 0, uy * hh, uz * hh, 0, fy * 0.04, fz * 0.04);
      bs.color(rgb, C_WHEEL * 3);
      for (let w = -1; w <= 1; w += 2) this.wheel(bs, w * wx, this.by(axleUp, al), this.bz(axleUp, al), fy, fz, uy, uz);
      if (lv[P_SPRINGS] > 0) {
        // A coil standing on the truck beside the hanger, as tall as the gap allows, fatter with level.
        bs.color(rgb, C_SPRING * 3);
        const r = 0.03 * grow(lv[P_SPRINGS]) + 0.01;
        for (let w = -1; w <= 1; w += 2) {
          const sx = w * (wx - 0.035);
          const lo = axleUp + 0.02;
          const hi = DECK_LOW - py;
          for (let c = 0; c < 2; c++) {
            const u0 = lerp(lo, hi, c / 2);
            const u1 = lerp(lo, hi, (c + 1) / 2);
            const d0 = c % 2 === 0 ? -r : r;
            bs.limb(sx, this.by(u0, al + d0), this.bz(u0, al + d0), sx, this.by(u1, al - d0), this.bz(u1, al - d0), 0.012, 0.012, 3);
          }
        }
      }
    }
    if (lv[P_WAX] > 0) {
      // A pale shine under the deck, longer with level.
      bs.color(rgb, C_WAX * 3);
      const l = DECK_HALF_LENGTH * (0.45 + 0.1 * lv[P_WAX]);
      bs.box(0, this.by(-t - 0.012, -0.04), this.bz(-t - 0.012, -0.04), hw * 0.8, 0, 0, 0, uy * 0.006, uz * 0.006, 0, fy * l, fz * l);
    }
    if (lv[P_LUCK] > 0) {
      // A star on the grip near the tail.
      bs.color(rgb, C_STAR * 3);
      const r = 0.06 * grow(lv[P_LUCK]);
      const up = t + 0.016;
      const cx = 0;
      const al = -0.17;
      for (let p = 0; p < 10; p++) {
        const a0 = (p / 10) * Math.PI * 2;
        const a1 = ((p + 1) / 10) * Math.PI * 2;
        const r0 = p % 2 === 0 ? r : r * 0.45;
        const r1 = p % 2 === 0 ? r * 0.45 : r;
        bs.tri(
          cx, this.by(up, al), this.bz(up, al),
          cx + Math.sin(a0) * r0, this.by(up, al + Math.cos(a0) * r0), this.bz(up, al + Math.cos(a0) * r0),
          cx + Math.sin(a1) * r1, this.by(up, al + Math.cos(a1) * r1), this.bz(up, al + Math.cos(a1) * r1),
          cx, this.by(up - 0.1, al), this.bz(up - 0.1, al),
        );
      }
    }
    if (lv[P_WIDE_LOAD] > 0) {
      // Bumpers along both edges of the widened deck.
      bs.color(rgb, C_BUMPER * 3);
      for (let w = -1; w <= 1; w += 2) bs.box(w * (hw + 0.012), py, 0, 0.018, 0, 0, 0, uy * 0.028, uz * 0.028, 0, fy * 0.26, fz * 0.26);
    }
    bs.end();

    // ---- the figure. The feet on the deck's top, toward the nose and the tail; the pop slides
    // the front foot up toward the nose.
    const fs = this.figureShape;
    fs.begin();
    const top = DECK_TOP - py;
    const ffAt = FOOT_AT + 0.05 * this.pop;
    let ffx = 0;
    const ffy = py + uy * top + fy * ffAt;
    let ffz = uz * top + fz * ffAt;
    let bfx = 0;
    let bfy = py + uy * top - fy * FOOT_AT;
    let bfz = uz * top - fz * FOOT_AT;
    // Pushing: the back foot plants on the ground ahead of the toes and pushes back, then swings
    // forward again in the air.
    const push = this.push;
    let bob = 0;
    if (push > 0) {
      const ph = this.pushPhase;
      let gz: number;
      let gy: number;
      if (ph < 0.55) {
        const u = ph / 0.55;
        gz = lerp(0.12, -0.62, u);
        gy = 0;
        bob = Math.sin(u * Math.PI) * 0.06;
      } else {
        const u = (ph - 0.55) / 0.45;
        gz = lerp(-0.62, 0.12, u);
        gy = Math.sin(u * Math.PI) * 0.22;
      }
      bfx = lerp(bfx, 0.2, push);
      bfy = lerp(bfy, gy, push);
      bfz = lerp(bfz, gz, push);
      ffz = lerp(ffz, ffz - 0.06, push);
    }
    if (this.wipe > 0) {
      // Legs flung apart as it goes over.
      ffx += this.wipe * 0.25;
      ffz += this.wipe * 0.2;
      bfx += this.wipe * 0.1;
      bfz -= this.wipe * 0.2;
    }
    // The hips over the middle of the board (not the tilted deck: the rider stays upright), lower
    // in the landing's absorb and through a push's stroke; in the air the knees come up.
    const deep = crouch + this.absorb * 0.5 + this.air * 0.12;
    const hipY = DECK_TOP + lerp(HIP_TALL, HIP_LOW, clamp01(deep)) - bob - push * 0.08;
    const hipX = -0.05 * clamp01(deep) - this.flinch * 0.06;
    const hipZ = push * -0.04;
    fs.color(rgb, C_PANTS * 3);
    // Legs: knee bent toward +x (the way it faces).
    this.leg(fs, hipX, hipY, hipZ + HIP_HALF, ffx, ffy + 0.06, ffz, 1);
    this.leg(fs, hipX, hipY, hipZ - HIP_HALF, bfx, bfy + 0.06, bfz, 1);
    // Shoes: toes toward +x on the board; the front one turns to point ahead while pushing.
    fs.color(rgb, C_SHOE * 3);
    const turnF = push * 1.1;
    this.shoe(fs, ffx, ffy, ffz, turnF, cp, sp, 1);
    this.shoe(fs, bfx, bfy, bfz, 0, push > 0.5 ? 1 : cp, push > 0.5 ? 0 : sp, -1);
    if (lv[P_WINGS] > 0) {
      fs.color(rgb, C_WING * 3);
      const g = grow(lv[P_WINGS]);
      this.wing(fs, ffx - 0.1, ffy + 0.07, ffz, g, 1);
      this.wing(fs, bfx - 0.1, bfy + 0.07, bfz, g, -1);
    }
    if (lv[P_HIDE] > 0) {
      // Knee pads.
      fs.color(rgb, C_PAD * 3);
      const pr = 0.05 + 0.012 * lv[P_HIDE];
      this.kneePad(fs, hipX, hipY, hipZ + HIP_HALF, ffx, ffy + 0.06, ffz, pr);
      this.kneePad(fs, hipX, hipY, hipZ - HIP_HALF, bfx, bfy + 0.06, bfz, pr);
    }

    // The pelvis, and the torso pitched toward the side it faces (+x); thrown back in a flinch.
    fs.color(rgb, C_PANTS * 3);
    fs.box(hipX, hipY, hipZ, 0.12, 0, 0, 0, 0.08, 0, 0, 0, HIP_HALF + 0.07);
    const tAng = lerp(TORSO_TALL, TORSO_LOW, clamp01(crouch + this.absorb * 0.3)) - this.flinch * 0.75 + this.carve * -0.15 + this.wipe * -0.3;
    const tx = Math.sin(tAng);
    const ty = Math.cos(tAng);
    const sx = hipX + tx * TORSO_LEN;
    const sy = hipY + ty * TORSO_LEN;
    const sz = hipZ;
    this.torso(fs, hipX, hipY, hipZ, tx, ty, rgb);
    if (lv[P_HEART] > 0) {
      // A heart on the chest: two lobes and a point.
      fs.color(rgb, C_HEART * 3);
      const g = 0.06 * grow(lv[P_HEART]);
      const cx = hipX + tx * TORSO_LEN * 0.66 + ty * (TORSO_DEPTH + 0.01);
      const cy = hipY + ty * TORSO_LEN * 0.66 - tx * (TORSO_DEPTH + 0.01);
      fs.diamond(cx, cy + g * 0.35, sz + g * 0.55, g * 0.5, g * 0.7, g * 0.7);
      fs.diamond(cx, cy + g * 0.35, sz - g * 0.55, g * 0.5, g * 0.7, g * 0.7);
      fs.diamond(cx, cy - g * 0.35, sz, g * 0.45, g * 0.85, g * 0.75);
    }
    if (lv[P_MAGNET] > 0) {
      // A horseshoe on the back, its ends up, silver tips.
      const g = grow(lv[P_MAGNET]);
      const bx0 = hipX + tx * TORSO_LEN * 0.55 - ty * (TORSO_DEPTH + 0.04);
      const by0 = hipY + ty * TORSO_LEN * 0.55 + tx * (TORSO_DEPTH + 0.04);
      const w = 0.11 * g;
      const h = 0.16 * g;
      const r = 0.032 * g;
      fs.color(rgb, C_MAGNET * 3);
      fs.limb(bx0, by0 - h * 0.5, sz - w, bx0, by0 - h * 0.5, sz + w, r, r);
      fs.limb(bx0, by0 - h * 0.5, sz + w, bx0 + tx * h * 0.6, by0 + ty * h * 0.6, sz + w, r, r);
      fs.limb(bx0, by0 - h * 0.5, sz - w, bx0 + tx * h * 0.6, by0 + ty * h * 0.6, sz - w, r, r);
      fs.color(rgb, C_METAL * 3);
      fs.limb(bx0 + tx * h * 0.6, by0 + ty * h * 0.6, sz + w, bx0 + tx * h, by0 + ty * h, sz + w, r * 1.05, r * 1.05);
      fs.limb(bx0 + tx * h * 0.6, by0 + ty * h * 0.6, sz - w, bx0 + tx * h, by0 + ty * h, sz - w, r * 1.05, r * 1.05);
    }

    // The arms. Where the hands go: along the board for balance (riding), forward on the knees
    // (coasting), wide and high (grinding), reaching to the inside of a turn, up in a flinch.
    const shY = sy - ty * 0.06;
    const shX = sx - tx * 0.06;
    const reach = lerp(0.52, 0.74, spread);
    const drop = lerp(0.24, -0.1, spread);
    const coast = clamp01((crouch - CROUCH_RIDE) / (CROUCH_COAST - CROUCH_RIDE)) * (1 - spread);
    for (let s = 0; s < 2; s++) {
      const dir = s === 0 ? 1 : -1;
      const shZ = sz + dir * (TORSO_SHOULDERS + 0.02);
      // Riding: out along the board.
      let hx = shX + 0.1;
      let hy = shY - drop;
      let hz = sz + dir * reach;
      // Coasting: forward to the knees.
      hx = lerp(hx, hipX + 0.42, coast);
      hy = lerp(hy, hipY + 0.06, coast);
      hz = lerp(hz, sz + dir * 0.18, coast);
      // Carving: toward the inside, the front hand low on a toe-side turn, back on a heel-side one.
      const c = this.carve;
      if (c > 0) {
        hx += c * 0.32;
        hy -= c * (dir > 0 ? 0.38 : 0.12);
      } else {
        hx += c * 0.3;
        hy -= -c * 0.12;
      }
      // Pushing: the arms swing against the push.
      if (push > 0) {
        const sw = Math.sin(this.pushPhase * Math.PI * 2) * 0.18 * push;
        hz += dir * sw;
        hy += push * 0.06;
      }
      // In the air: hands out wide for balance.
      hy += this.air * 0.12;
      // A flinch throws them up in front, as if to fend the hit off.
      const fl = this.flinch;
      hx = lerp(hx, shX + 0.3, fl);
      hy = lerp(hy, shY + 0.2, fl);
      hz = lerp(hz, sz + dir * 0.36, fl);
      // Lying in a wipe-out: flung out.
      hx = lerp(hx, shX - 0.1, this.wipe);
      hy = lerp(hy, shY + 0.15, this.wipe);
      hz = lerp(hz, sz + dir * 0.7, this.wipe);
      this.arm(fs, shX, shY, shZ, hx, hy, hz, dir, rgb, lv);
    }
    if (lv[P_HIDE] > 0) {
      // Shoulder pads.
      fs.color(rgb, C_PAD * 3);
      const pr = 0.075 + 0.012 * lv[P_HIDE];
      for (let dir = -1; dir <= 1; dir += 2) {
        fs.box(shX, shY + 0.03, sz + dir * (TORSO_SHOULDERS + 0.01), pr * ty, -pr * tx, 0, pr * 0.55 * tx, pr * 0.55 * ty, 0, 0, 0, pr * 0.9, false);
      }
    }

    // The head, turned toward the nose to look where it is going.
    const hcx = sx + tx * HEAD_UP + this.flinch * -0.06;
    const hcy = sy + ty * HEAD_UP;
    const hcz = sz;
    this.head(fs, hcx, hcy, hcz, tx, ty, lean, rgb, lv);

    // The scarf: a knot at the neck and its tail trailing back (-z), streaming out at speed.
    this.scarf(fs, sx + tx * 0.04, sy + ty * 0.04, sz, tx, ty, rgb);
    fs.end();
  }

  /** Height and depth in the body's frame of a point `up` above the board's middle and `al` along it. */
  private by(up: number, al: number): number {
    return this.bpy + this.buy * up + this.bfy * al;
  }

  private bz(up: number, al: number): number {
    return this.buz * up + this.bfz * al;
  }

  /**
   * A piece of deck from `a` to `b` along the board, rising from `ra` to `rb` above the flat, `t`
   * half thick. Its ends are cut square to the ground, so the deck spans exactly its length.
   */
  private deckPiece(bs: Shape, hw: number, a: number, b: number, ra: number, rb: number, t: number): void {
    const p = this.hexp;
    for (let k = 0; k < 8; k++) {
      const sa = BOX_SIGNS[k * 3];
      const sb = BOX_SIGNS[k * 3 + 1];
      const sc = BOX_SIGNS[k * 3 + 2];
      const al = sc < 0 ? a : b;
      const rise = sc < 0 ? ra : rb;
      const up = rise + sb * t;
      p[k * 3] = sa * hw;
      p[k * 3 + 1] = this.by(up, al);
      p[k * 3 + 2] = this.bz(up, al);
    }
    bs.hex(p);
  }

  /** A wheel on its axle at (x, wy, wz) in the body's frame, turned by `wheelTurn`. Twenty triangles. */
  private wheel(bs: Shape, x: number, wy: number, wz: number, fy: number, fz: number, uy: number, uz: number): void {
    // Its axis is across the board (x); round it, the board's along (f) and up (u).
    bs.ring(x - WHEEL_HALF_WIDTH, wy, wz, 1, 0, 0, 0, uy, uz, 0, fy, fz, WHEEL_SIDES, WHEEL_RADIUS, WHEEL_RADIUS, 0, WHEEL_HALF_WIDTH * 2, false, this.wheelTurn);
    // The two caps, each a fan from one corner.
    const step = (Math.PI * 2) / WHEEL_SIDES;
    const r = WHEEL_RADIUS;
    for (let e = -1; e <= 1; e += 2) {
      const xi = x + e * WHEEL_HALF_WIDTH;
      const a0 = this.wheelTurn;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      for (let k = 1; k < WHEEL_SIDES - 1; k++) {
        const c1 = Math.cos(a0 + k * step);
        const s1 = Math.sin(a0 + k * step);
        const c2 = Math.cos(a0 + (k + 1) * step);
        const s2 = Math.sin(a0 + (k + 1) * step);
        bs.tri(
          xi, wy + (uy * c0 + fy * s0) * r, wz + (uz * c0 + fz * s0) * r,
          xi, wy + (uy * c1 + fy * s1) * r, wz + (uz * c1 + fz * s1) * r,
          xi, wy + (uy * c2 + fy * s2) * r, wz + (uz * c2 + fz * s2) * r,
          x, wy, wz,
        );
      }
    }
  }

  /**
   * A two-part limb from the hip (or shoulder) H to the foot (or hand) F, its joint bent toward
   * (kx, 0, 0)·sign, written to `joint`.
   */
  private bend(hx: number, hy: number, hz: number, fx: number, fy: number, fz: number, l1: number, l2: number, kx: number, ky: number, kz: number): void {
    let dx = fx - hx;
    let dy = fy - hy;
    let dz = fz - hz;
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) len = 1e-5;
    dx /= len;
    dy /= len;
    dz /= len;
    if (len > l1 + l2 - 1e-3) len = l1 + l2 - 1e-3;
    const along = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    // The bend direction, square to the limb.
    const d = kx * dx + ky * dy + kz * dz;
    let bx = kx - dx * d;
    let by = ky - dy * d;
    let bz = kz - dz * d;
    const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
    bx /= bl;
    by /= bl;
    bz /= bl;
    this.joint[0] = hx + dx * along + bx * h;
    this.joint[1] = hy + dy * along + by * h;
    this.joint[2] = hz + dz * along + bz * h;
  }

  /** One leg from the hip to the ankle, knee bent toward +x. */
  private leg(fs: Shape, hx: number, hy: number, hz: number, fx: number, fy: number, fz: number, sign: number): void {
    this.bend(hx, hy, hz, fx, fy, fz, LIMB, LIMB, sign, 0.15, 0);
    const kx = this.joint[0];
    const ky = this.joint[1];
    const kz = this.joint[2];
    const mid = (THIGH_R + ANKLE_R) / 2;
    fs.limb(hx, hy, hz, kx, ky, kz, THIGH_R, mid);
    fs.limb(kx, ky, kz, fx, fy, fz, mid, ANKLE_R);
  }

  /** A pad over the knee of the leg from H to F. */
  private kneePad(fs: Shape, hx: number, hy: number, hz: number, fx: number, fy: number, fz: number, r: number): void {
    this.bend(hx, hy, hz, fx, fy, fz, LIMB, LIMB, 1, 0.15, 0);
    fs.box(this.joint[0] + 0.05, this.joint[1], this.joint[2], r * 0.6, 0, 0, 0, r, 0, 0, 0, r * 0.9);
  }

  /** A big shoe on (x, y, z), toes toward +x, turned `turn` toward +z, tilted with the deck (cp, sp). */
  private shoe(fs: Shape, x: number, y: number, z: number, turn: number, cp: number, sp: number, _end: number): void {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const len = 0.15;
    const wide = 0.065;
    const high = 0.055;
    // Long axis: toward +x turned to +z; across: along z turned to -x; up tilted with the deck.
    fs.box(
      x + c * 0.03, y + high * cp, z + s * 0.03 - high * sp,
      c * len, 0, s * len,
      0, high * cp, -high * sp,
      -s * wide, sp * wide * c, c * wide * cp,
    );
  }

  /** A small wing at a heel, swept back and up, `g` its size, on the outer side `dir` (+z or -z). */
  private wing(fs: Shape, x: number, y: number, z: number, g: number, dir: number): void {
    const l = 0.16 * g;
    const h = 0.1 * g;
    fs.tri(x, y, z + dir * 0.07, x - l, y + h * 1.4, z + dir * (0.07 + l * 0.6), x - l * 0.6, y - h * 0.2, z + dir * 0.09, x + 0.02, y, z);
    fs.tri(x, y, z + dir * 0.07, x - l, y + h * 1.4, z + dir * (0.07 + l * 0.6), x - l * 0.6, y - h * 0.2, z + dir * 0.09, x - l * 0.5, y + h * 0.4, z + dir * (0.07 + l * 0.9));
    fs.tri(x - l * 0.4, y + h * 0.2, z + dir * 0.08, x - l * 1.2, y + h * 0.9, z + dir * (0.07 + l * 0.45), x - l * 0.9, y - h * 0.15, z + dir * 0.08, x, y + h * 0.3, z);
    fs.tri(x - l * 0.4, y + h * 0.2, z + dir * 0.08, x - l * 1.2, y + h * 0.9, z + dir * (0.07 + l * 0.45), x - l * 0.9, y - h * 0.15, z + dir * 0.08, x - l * 0.8, y + h * 0.3, z + dir * (0.07 + l * 0.8));
  }

  /** The torso: a hoodie, wider at the shoulders than the waist, pitched along (tx, ty) from the hips. */
  private torso(fs: Shape, hx: number, hy: number, hz: number, tx: number, ty: number, rgb: Float32Array): void {
    const p = this.hexp;
    // Depth axis (toward the facing side, square to the torso): (ty, -tx).
    for (let k = 0; k < 8; k++) {
      const sa = BOX_SIGNS[k * 3];
      const sb = BOX_SIGNS[k * 3 + 1];
      const sc = BOX_SIGNS[k * 3 + 2];
      const up = sb < 0 ? 0 : TORSO_LEN;
      const half = sb < 0 ? TORSO_WAIST : TORSO_SHOULDERS;
      const depth = (sb < 0 ? TORSO_DEPTH * 0.9 : TORSO_DEPTH) * sa;
      p[k * 3] = hx + tx * up + ty * depth;
      p[k * 3 + 1] = hy + ty * up - tx * depth;
      p[k * 3 + 2] = hz + sc * half;
    }
    fs.color(rgb, C_BODY * 3);
    fs.hex(p);
    // The hood, bunched at the back of the neck.
    fs.color(rgb, C_BODY_DARK * 3);
    const nx = hx + tx * (TORSO_LEN - 0.02) - ty * (TORSO_DEPTH * 0.55);
    const ny = hy + ty * (TORSO_LEN - 0.02) + tx * (TORSO_DEPTH * 0.55);
    fs.box(nx, ny, hz, 0.08 * ty, -0.08 * tx, 0, 0.07 * tx, 0.07 * ty, 0, 0, 0, 0.13);
  }

  /** An arm from the shoulder to the hand, elbow out behind and down; a mitt (a glove with Might). */
  private arm(fs: Shape, sx: number, sy: number, sz: number, hx: number, hy: number, hz: number, dir: number, rgb: Float32Array, lv: Uint8Array): void {
    this.bend(sx, sy, sz, hx, hy, hz, ARM_UPPER, ARM_LOWER, -0.6, -0.5, dir * 0.4);
    const ex = this.joint[0];
    const ey = this.joint[1];
    const ez = this.joint[2];
    fs.color(rgb, C_BODY * 3);
    fs.limb(sx, sy, sz, ex, ey, ez, ARM_R, (ARM_R + WRIST_R) / 2);
    fs.limb(ex, ey, ez, hx, hy, hz, (ARM_R + WRIST_R) / 2, WRIST_R);
    const might = lv[P_MIGHT];
    // The hand, a little past the wrist along the forearm.
    let dx = hx - ex;
    let dy = hy - ey;
    let dz = hz - ez;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const r = might > 0 ? 0.075 * grow(might) + 0.015 : 0.07;
    fs.color(rgb, (might > 0 ? C_GLOVE : C_SKIN) * 3);
    fs.box(hx + dx * r * 0.8, hy + dy * r * 0.8, hz + dz * r * 0.8, dx * r, dy * r, dz * r, 0, r * 0.85, 0, r * 0.8, 0, 0);
    if (might > 0) {
      // A cuff at the wrist.
      fs.box(hx, hy, hz, dx * 0.03, dy * 0.03, dz * 0.03, 0, r * 0.8, 0, r * 0.8, 0, 0);
    }
  }

  /**
   * The head at (x, y, z) on a neck along (tx, ty): a face turned toward the nose, a helmet with a
   * brim, a dark visor and a grin; Haste's bolt and Regen's sprout on the helmet.
   */
  private head(fs: Shape, x: number, y: number, z: number, tx: number, ty: number, lean: number, rgb: Float32Array, lv: Uint8Array): void {
    // Face direction: toward +x turned to the nose (+z), tipped up a little from the torso's pitch.
    const turn = HEAD_TURN - lean * 0.4;
    const fc = Math.cos(turn);
    const fsn = Math.sin(turn);
    // Up: the neck, but leaning back toward vertical so the face looks ahead.
    let ux = tx * 0.4;
    let uy = ty * 0.4 + 0.6;
    const ul = Math.sqrt(ux * ux + uy * uy);
    ux /= ul;
    uy /= ul;
    // Forward (the face): horizontal (fc, 0, fsn) made square to up; right = up x forward.
    let ax = fc;
    let ay = 0;
    let az = fsn;
    const d = ax * ux + ay * uy;
    ax -= ux * d;
    ay -= uy * d;
    const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    // r = u x a
    const rx = uy * az;
    const ry = -ux * az;
    const rz = ux * ay - uy * ax;

    // The face.
    fs.color(rgb, C_SKIN * 3);
    fs.box(x, y, z, ax * 0.12, ay * 0.12, az * 0.12, ux * 0.13, uy * 0.13, 0, rx * 0.12, ry * 0.12, rz * 0.12);
    // The helmet: a dome over the top and back, and a brim.
    fs.color(rgb, C_HELMET * 3);
    fs.ring(x - ax * 0.015, y - ay * 0.015, z - az * 0.015, ux, uy, 0, ax, ay, az, rx, ry, rz, 8, 0.175, 0.11, 0.0, 0.2, true, Math.PI / 8);
    fs.box(
      x + ax * 0.16 + ux * 0.05, y + ay * 0.16 + uy * 0.05, z + az * 0.16,
      ax * 0.06, ay * 0.06, az * 0.06,
      ux * 0.018, uy * 0.018, 0,
      rx * 0.15, ry * 0.15, rz * 0.15,
    );
    // The visor across the eyes, and a grin below it.
    fs.color(rgb, C_VISOR * 3);
    fs.box(
      x + ax * 0.12, y + ay * 0.12 - uy * 0.005, z + az * 0.12,
      ax * 0.03, ay * 0.03, az * 0.03,
      ux * 0.045, uy * 0.045, 0,
      rx * 0.125, ry * 0.125, rz * 0.125,
    );
    fs.box(
      x + ax * 0.115 - ux * 0.085, y + ay * 0.115 - uy * 0.085, z + az * 0.115,
      ax * 0.015, ay * 0.015, az * 0.015,
      ux * 0.014, uy * 0.014, 0,
      rx * 0.06, ry * 0.06, rz * 0.06,
    );
    if (lv[P_HASTE] > 0) {
      // A bolt on the helmet's side (the side away from the nose, toward the camera behind).
      fs.color(rgb, C_BOLT * 3);
      const g = grow(lv[P_HASTE]);
      const ox = x - rx * 0.165;
      const oy = y - ry * 0.165 + uy * 0.08;
      const oz = z - rz * 0.165;
      fs.box(ox + ax * 0.03 * g + ux * 0.04 * g, oy + uy * 0.04 * g, oz + az * 0.03 * g,
        (ax * 0.025 + ux * 0.05) * g, (ay * 0.025 + uy * 0.05) * g, az * 0.025 * g,
        ax * 0.018 * g - ux * 0.009 * g, ay * 0.018 * g - uy * 0.009 * g, az * 0.018 * g,
        rx * 0.012, ry * 0.012, rz * 0.012);
      fs.box(ox - ax * 0.03 * g - ux * 0.03 * g, oy - uy * 0.03 * g, oz - az * 0.03 * g,
        (ax * 0.025 + ux * 0.05) * g, (ay * 0.025 + uy * 0.05) * g, az * 0.025 * g,
        ax * 0.018 * g - ux * 0.009 * g, ay * 0.018 * g - uy * 0.009 * g, az * 0.018 * g,
        rx * 0.012, ry * 0.012, rz * 0.012);
    }
    if (lv[P_REGEN] > 0) {
      // A sprout on top: a stem and two leaves.
      fs.color(rgb, C_REGEN * 3);
      const g = grow(lv[P_REGEN]);
      const bx = x + ux * 0.19;
      const by = y + uy * 0.19;
      const tx2 = bx + ux * 0.1 * g;
      const ty2 = by + uy * 0.1 * g;
      fs.limb(bx, by, z, tx2, ty2, z, 0.014, 0.012, 3);
      fs.diamond(tx2 + ax * 0.04 * g, ty2 + 0.01, z + az * 0.04 * g, 0.045 * g, 0.02 * g, 0.045 * g);
      fs.diamond(tx2 - ax * 0.04 * g, ty2 + 0.02, z - az * 0.04 * g, 0.045 * g, 0.02 * g, 0.045 * g);
    }
  }

  /** The scarf: a knot round the neck and a tail of `SCARF_SEGMENTS` trailing toward -z. */
  private scarf(fs: Shape, x: number, y: number, z: number, tx: number, ty: number, rgb: Float32Array): void {
    fs.color(rgb, C_SCARF * 3);
    fs.box(x, y, z, 0.13 * ty, -0.13 * tx, 0, 0.045 * tx, 0.045 * ty, 0, 0, 0, 0.14);
    // The tail starts at the back of the neck.
    let px = x - ty * 0.1;
    let py = y + tx * 0.1;
    let pz = z - 0.08;
    const tr = this.trail;
    // Hanging: straight down the back; streaming: straight back and a little up.
    const dx0 = lerp(-0.3, -0.05, tr);
    const dy0 = lerp(-1, 0.12, tr);
    const dz0 = lerp(-0.25, -1, tr);
    const dl = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);
    const amp = 0.035 + 0.05 * tr;
    for (let k = 0; k < SCARF_SEGMENTS; k++) {
      const wav = Math.sin(this.flutter - k * 0.9) * amp * (k + 1) * 0.35;
      const wav2 = Math.cos(this.flutter * 0.7 - k * 1.3) * amp * (k + 1) * 0.2;
      const qx = px + (dx0 / dl) * SCARF_SEG + wav * 0.6;
      const qy = py + (dy0 / dl) * SCARF_SEG + wav2;
      const qz = pz + (dz0 / dl) * SCARF_SEG;
      // A flat ribbon, wide across the body (z when hanging, y when streaming), drawn on both faces:
      // the same corners twice, facing away from a point on either side of it.
      const wy = SCARF_WIDE * tr;
      const wx = SCARF_WIDE * (1 - tr) * 0.4;
      const wz = SCARF_WIDE * (1 - tr) * 0.9;
      // Its normal: the segment crossed with the width.
      const sx = qx - px;
      const sy = qy - py;
      const sz = qz - pz;
      let nx = sy * wz - sz * wy;
      let ny = sz * wx - sx * wz;
      let nz = sx * wy - sy * wx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx = (nx / nl) * 0.1;
      ny = (ny / nl) * 0.1;
      nz = (nz / nl) * 0.1;
      const mx = (px + qx) / 2;
      const my = (py + qy) / 2;
      const mz = (pz + qz) / 2;
      for (let f = -1; f <= 1; f += 2) {
        fs.tri(px - wx, py - wy, pz - wz, px + wx, py + wy, pz + wz, qx + wx, qy + wy, qz + wz, mx + nx * f, my + ny * f, mz + nz * f);
        fs.tri(px - wx, py - wy, pz - wz, qx + wx, qy + wy, qz + wz, qx - wx, qy - wy, qz - wz, mx + nx * f, my + ny * f, mz + nz * f);
      }
      px = qx;
      py = qy;
      pz = qz;
    }
  }
}

/**
 * Draw the baked tones: the surface and its glow take the vertex colour, so the nominal colour of
 * the material (the mover's, the accent) only names the whole.
 */
function figureMaterial(m: MeshLambertMaterial): void {
  m.vertexColors = true;
  const glow = { value: m.emissiveIntensity };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vColor.rgb;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * uGlow;');
  };
  m.customProgramCacheKey = () => 'mover-figure';
}
