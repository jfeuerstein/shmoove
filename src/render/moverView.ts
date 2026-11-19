/**
 * The mover: a rider on a skateboard, and a blob shadow pinned to the ground under it (that is how
 * hop height is read).
 *
 * The board is about 0.9 m by 0.25 m on four small wheels, in `PALETTE.accent`. On it a figure in
 * `PALETTE.mover` (`PALETTE.moverTuck` while tucked) stands side-on to the way it is going, feet
 * on the nose and tail, knees bent out toward the side it faces, arms out along the board.
 *
 * Pose, from the sim state interpolated `alpha` of the way from `prev` to `cur`: tilted to the ground
 * normal while grounded, level in the air; turned to `heading` (the board's nose points along it);
 * leaning into turns by the sideways acceleration. How low the figure crouches tells what the
 * thumb is doing: pushing (the stick held, below run speed) it stands tall; riding at speed with the
 * stick held, knees bent; coasting (`tucked`) it crouches low; in the air it tucks and the board's
 * nose comes up. The pose eases from one to the next over `POSE_TIME`.
 *
 * Two meshes, each one geometry rebuilt in place every frame (72 triangles together): the figure
 * and the board. `update` allocates nothing.
 */
import { BufferAttribute, BufferGeometry, CircleGeometry, Group, Mesh, type Object3D, Quaternion, Sphere, Vector3 } from 'three';
import { DT, FEEL } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import type { SimState, Vec3 } from '../sim/types';
import { PALETTE, flatMaterial, glowMaterial, setGlowColor } from './look';

/** Triangles in the figure and in the board. */
export const FIGURE_TRIANGLES = 48;
export const BOARD_TRIANGLES = 24;

// ---- the board (local frame: +z the nose, +y up, +x the side the rider faces) ----------------

/** Half the deck's length and width, its thickness, and the height of its underside, m. */
export const DECK_HALF_LENGTH = 0.45;
export const DECK_HALF_WIDTH = 0.125;
const DECK_THICK = 0.035;
const DECK_LOW = 0.11;
const DECK_TOP = DECK_LOW + DECK_THICK;
/** The wheels: this far either side of the middle along the board and across it, and their size, m. */
const WHEEL_ALONG = 0.31;
const WHEEL_ACROSS = 0.09;
const WHEEL_SIZE = 0.05;
/** In the air the board's nose comes up by this much, rad. */
export const AIR_NOSE = 0.38;
/** Glow of the board: enough to read on the dark ground, well under the figure's. */
const BOARD_GLOW = 0.3;

// ---- the figure -----------------------------------------------------------------------------

/** The feet stand this far from the middle of the board, toward the nose and the tail, m. */
const FOOT_AT = 0.25;
/** The hips are this far apart along the board, m. */
const HIP_HALF = 0.09;
/** Thigh and shin, each, m. */
const LIMB = 0.47;
/** Hips above the deck, standing tall and at the lowest crouch, m. */
const HIP_TALL = 0.86;
const HIP_LOW = 0.5;
/** How far the torso pitches toward the side the rider faces, tall and crouched, rad. */
const TORSO_TALL = 0.1;
const TORSO_LOW = 0.62;
/** The torso: half its height, half its depth (toward the facing side), half its shoulders, m. */
const TORSO_HALF = 0.25;
const TORSO_DEPTH = 0.12;
const TORSO_SHOULDERS = 0.19;
/** The head: its middle above the shoulders and its half-height and half-width, m. */
const HEAD_UP = 0.17;
const HEAD_HIGH = 0.15;
const HEAD_WIDE = 0.12;
/** The arms reach this far out along the board each way from the shoulders, and drop this far, m. */
const ARM_REACH = 0.55;
const ARM_DROP = 0.2;
/** Limb thickness: hips, ankles, arms, m. */
const THIGH_R = 0.11;
const ANKLE_R = 0.07;
const ARM_R = 0.06;

/** Crouch, 0 tall to 1 lowest: pushing, riding with the stick held, coasting, in the air. */
export const CROUCH_PUSH = 0;
export const CROUCH_RIDE = 0.35;
export const CROUCH_COAST = 1;
export const CROUCH_AIR = 0.8;
/** Below this share of run speed with the stick held, the rider is pushing. */
const PUSH_SHARE = 0.95;
/** Time for the pose to get most of the way to a new one, s. */
export const POSE_TIME = 0.07;
/** A pose this near the one it is easing to is taken as there. */
const POSE_SNAP = 1e-3;

/** Steepest lean into a turn, rad. */
const MAX_LEAN = 0.55;
/** Blob shadow radius on the ground, and how high above the ground it has shrunk to nothing, m. */
const SHADOW_RADIUS = 0.6;
const SHADOW_FADE_HEIGHT = 12;
const SHADOW_MIN_SCALE = 0.35;
const SHADOW_LIFT = 0.04;
const SHADOW_OPACITY = 0.55;

/** Cross-section of a limb: a triangle. */
const PRISM_COS = [1, -0.5, -0.5];
const PRISM_SIN = [0, Math.sqrt(3) / 2, -Math.sqrt(3) / 2];
/** A box's corners as signs on its three axes, and its faces (two triangles each) by corner. */
const BOX_SIGNS = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
/** Faces: -z, +z, -x, +x, +y, -y (the last is left out when a box has no bottom). */
const BOX_FACES = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 3, 7, 0, 7, 4, 1, 2, 6, 1, 6, 5, 3, 2, 6, 3, 6, 7, 0, 1, 5, 0, 5, 4];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Triangles written in place into a fixed-size geometry, each facing away from a given middle. */
class Shape {
  readonly geometry = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly norAttr: BufferAttribute;
  private n = 0;
  /** Scratch corners for boxes. */
  private readonly c = new Float32Array(8 * 3);

  constructor(readonly triangles: number) {
    this.pos = new Float32Array(triangles * 9);
    this.nor = new Float32Array(triangles * 9);
    this.posAttr = new BufferAttribute(this.pos, 3);
    this.norAttr = new BufferAttribute(this.nor, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.norAttr);
    // The rider never leaves this sphere about its feet.
    this.geometry.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.6);
  }

  get positions(): Float32Array {
    return this.pos;
  }

  begin(): void {
    this.n = 0;
  }

  end(): void {
    if (this.n !== this.triangles) throw new Error(`shape drew ${this.n} of ${this.triangles} triangles`);
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
  }

  /** One triangle, wound to face away from (mx, my, mz). */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    mx: number, my: number, mz: number,
  ): void {
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
    for (let k = 0; k < 3; k++) {
      q[o + k * 3] = nx;
      q[o + k * 3 + 1] = ny;
      q[o + k * 3 + 2] = nz;
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
    bottom: boolean,
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
    const faces = bottom ? BOX_FACES.length : BOX_FACES.length - 6;
    for (let f = 0; f < faces; f += 3) {
      const i = BOX_FACES[f] * 3;
      const j = BOX_FACES[f + 1] * 3;
      const k = BOX_FACES[f + 2] * 3;
      this.tri(c[i], c[i + 1], c[i + 2], c[j], c[j + 1], c[j + 2], c[k], c[k + 1], c[k + 2], x, y, z);
    }
  }

  /** A three-sided limb from A (thickness ra) to B (thickness rb), open at the ends. Six triangles. */
  limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): void {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    // u = d x (a helper not along d), v = d x u.
    let hx = 1;
    let hy = 0;
    if (dx > 0.9 || dx < -0.9) {
      hx = 0;
      hy = 1;
    }
    let ux = dy * 0 - dz * hy;
    let uy = dz * hx - dx * 0;
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
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      const ox0 = ux * PRISM_COS[k] + vx * PRISM_SIN[k];
      const oy0 = uy * PRISM_COS[k] + vy * PRISM_SIN[k];
      const oz0 = uz * PRISM_COS[k] + vz * PRISM_SIN[k];
      const ox1 = ux * PRISM_COS[j] + vx * PRISM_SIN[j];
      const oy1 = uy * PRISM_COS[j] + vy * PRISM_SIN[j];
      const oz1 = uz * PRISM_COS[j] + vz * PRISM_SIN[j];
      this.tri(ax + ox0 * ra, ay + oy0 * ra, az + oz0 * ra, ax + ox1 * ra, ay + oy1 * ra, az + oz1 * ra, bx + ox1 * rb, by + oy1 * rb, bz + oz1 * rb, mx, my, mz);
      this.tri(ax + ox0 * ra, ay + oy0 * ra, az + oz0 * ra, bx + ox1 * rb, by + oy1 * rb, bz + oz1 * rb, bx + ox0 * rb, by + oy0 * rb, bz + oz0 * rb, mx, my, mz);
    }
  }

  /** A diamond (octahedron) about (x, y, z), `high` up and down, `wide` across. Eight triangles. */
  diamond(x: number, y: number, z: number, high: number, wide: number): void {
    for (let k = 0; k < 4; k++) {
      const a0 = (k * Math.PI) / 2;
      const a1 = ((k + 1) * Math.PI) / 2;
      const x0 = x + Math.cos(a0) * wide;
      const z0 = z + Math.sin(a0) * wide;
      const x1 = x + Math.cos(a1) * wide;
      const z1 = z + Math.sin(a1) * wide;
      this.tri(x0, y, z0, x1, y, z1, x, y + high, z, x, y, z);
      this.tri(x0, y, z0, x1, y, z1, x, y - high, z, x, y, z);
    }
  }
}

export class MoverView {
  readonly object: Object3D;
  /** The rider and the board, in the body's frame. */
  readonly figure: Mesh;
  readonly board: Mesh;
  readonly shadow: Mesh;
  /** The pose last drawn: crouch 0 (tall) to 1 (lowest), and the board's nose-up pitch, rad. */
  crouch = CROUCH_RIDE;
  pitch = 0;

  /** Placed at the mover, tilted to the ground. */
  private readonly root = new Group();
  /** Turned to the heading and leaning. */
  private readonly body = new Group();
  private readonly figureShape = new Shape(FIGURE_TRIANGLES);
  private readonly boardShape = new Shape(BOARD_TRIANGLES);
  private readonly material = glowMaterial(PALETTE.mover);
  private tuckShown = false;
  private posed = false;

  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();
  private readonly q = new Quaternion();
  private readonly ground: Vec3 = { x: 0, y: 1, z: 0 };

  constructor() {
    const container = new Group();
    container.name = 'mover';
    this.figure = new Mesh(this.figureShape.geometry, this.material);
    this.figure.name = 'mover-rider';
    this.board = new Mesh(this.boardShape.geometry, glowMaterial(PALETTE.accent, BOARD_GLOW));
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
    this.pose(this.crouch, this.pitch);
  }

  /**
   * Draw as of `alpha` (0..1) of the way from `prev` to `cur`. `dt` is the real time since the last
   * frame, s; the pose eases toward the new one over it (left out, it snaps).
   */
  update(prev: SimState, cur: SimState, alpha: number, terrain: Terrain, dt = Infinity): void {
    const a = prev.mover;
    const b = cur.mover;
    const x = lerp(a.x, b.x, alpha);
    const y = lerp(a.y, b.y, alpha);
    const z = lerp(a.z, b.z, alpha);
    const turn = angleDelta(a.heading, b.heading);
    const heading = a.heading + turn * alpha;

    this.root.position.set(x, y, z);
    if (b.grounded) {
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
    this.body.rotation.set(0, heading, lean);

    // What the thumb is doing, read off the pose.
    let crouch: number;
    let pitch = 0;
    if (!b.grounded) {
      crouch = CROUCH_AIR;
      pitch = AIR_NOSE;
    } else if (b.tucked) crouch = CROUCH_COAST;
    else if (speed < FEEL.runSpeed * PUSH_SHARE) crouch = CROUCH_PUSH;
    else crouch = CROUCH_RIDE;
    if (this.posed) {
      const k = dt === Infinity ? 1 : 1 - Math.exp(-(dt > 0 ? dt : 0) / POSE_TIME);
      // Close enough is there, so a settled pose stops being rebuilt.
      if (Math.abs(crouch - this.crouch) > POSE_SNAP) crouch = lerp(this.crouch, crouch, k);
      if (Math.abs(pitch - this.pitch) > POSE_SNAP) pitch = lerp(this.pitch, pitch, k);
    }
    this.posed = true;
    if (crouch !== this.crouch || pitch !== this.pitch) this.pose(crouch, pitch);

    const tuck = b.tucked;
    if (tuck !== this.tuckShown) {
      this.tuckShown = tuck;
      setGlowColor(this.material, tuck ? PALETTE.moverTuck : PALETTE.mover);
    }

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

  /** Build the board and the rider for a crouch (0..1) and the board's nose-up pitch. */
  private pose(crouch: number, pitch: number): void {
    this.crouch = crouch;
    this.pitch = pitch;

    // The board turns nose-up about its middle. Its axes: along (f), up (u), across (x).
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fy = sp;
    const fz = cp;
    const uy = cp;
    const uz = -sp;
    const py = DECK_LOW + DECK_THICK / 2;
    const bs = this.boardShape;
    bs.begin();
    bs.box(0, py, 0, DECK_HALF_WIDTH, 0, 0, 0, uy * DECK_THICK / 2, uz * DECK_THICK / 2, 0, fy * DECK_HALF_LENGTH, fz * DECK_HALF_LENGTH, true);
    for (let k = 0; k < 4; k++) {
      const along = k < 2 ? WHEEL_ALONG : -WHEEL_ALONG;
      const across = k % 2 === 0 ? WHEEL_ACROSS : -WHEEL_ACROSS;
      // Three corners against the deck's underside and a point below: the wheel's three sides.
      const top = DECK_LOW - py;
      const low = top - WHEEL_SIZE * 2;
      const ty = py + uy * top + fy * along;
      const tz = uz * top + fz * along;
      const ly = py + uy * low + fy * along;
      const lz = uz * low + fz * along;
      const w = WHEEL_SIZE;
      // In the deck's frame, a small tetrahedron with its top face on the deck, the nose's and the
      // tail's mirror images of each other.
      const wa = along > 0 ? w : -w;
      const ax = across - w;
      const ay = ty - fy * wa;
      const az = tz - fz * wa;
      const bx = across + w;
      const cx = across;
      const cy = ty + fy * wa;
      const cz = tz + fz * wa;
      const mx = across;
      const my = (ty * 2 + ly) / 3;
      const mz = (tz * 2 + lz) / 3;
      bs.tri(ax, ay, az, bx, ay, az, across, ly, lz, mx, my, mz);
      bs.tri(bx, ay, az, cx, cy, cz, across, ly, lz, mx, my, mz);
      bs.tri(cx, cy, cz, ax, ay, az, across, ly, lz, mx, my, mz);
    }
    bs.end();

    // The feet on the deck's top, toward the nose and the tail.
    const top = DECK_TOP - py;
    const ffy = py + uy * top + fy * FOOT_AT;
    const ffz = uz * top + fz * FOOT_AT;
    const bfy = py + uy * top - fy * FOOT_AT;
    const bfz = uz * top - fz * FOOT_AT;
    // The hips over the middle of the board (not the tilted deck: the rider stays upright).
    const hy = DECK_TOP + lerp(HIP_TALL, HIP_LOW, crouch);
    const fs = this.figureShape;
    fs.begin();
    this.leg(fs, HIP_HALF, hy, ffy, ffz);
    this.leg(fs, -HIP_HALF, hy, bfy, bfz);

    // The torso, pitched toward the side the rider faces (+x); the shoulders run along the board.
    const t = lerp(TORSO_TALL, TORSO_LOW, crouch);
    const tx = Math.sin(t);
    const ty = Math.cos(t);
    const cx = tx * TORSO_HALF;
    const cy = hy + ty * TORSO_HALF;
    fs.box(cx, cy, 0, ty * TORSO_DEPTH, -tx * TORSO_DEPTH, 0, tx * TORSO_HALF, ty * TORSO_HALF, 0, 0, 0, TORSO_SHOULDERS, false);
    const sx = tx * TORSO_HALF * 2;
    const sy = hy + ty * TORSO_HALF * 2;
    fs.diamond(sx + tx * HEAD_UP, sy + ty * HEAD_UP, 0, HEAD_HIGH, HEAD_WIDE);
    // Arms out along the board for balance, a little forward of the shoulders.
    const ay = sy - 0.06;
    fs.limb(sx + 0.08, ay - ARM_DROP, ARM_REACH, sx + 0.08, ay - ARM_DROP * 1.2, -ARM_REACH, ARM_R, ARM_R);
    fs.end();
  }

  /** One leg from the hip (at `hz` along the board, height `hy`) to the foot, knee bent toward +x. */
  private leg(fs: Shape, hz: number, hy: number, fy: number, fz: number): void {
    const dy = fy - hy;
    const dz = fz - hz;
    let d = Math.sqrt(dy * dy + dz * dz);
    if (d > LIMB * 2 - 1e-3) d = LIMB * 2 - 1e-3;
    const out = Math.sqrt(LIMB * LIMB - (d / 2) * (d / 2));
    const ky = (hy + fy) / 2;
    const kz = (hz + fz) / 2;
    fs.limb(0, hy, hz, out, ky, kz, THIGH_R, (THIGH_R + ANKLE_R) / 2);
    fs.limb(out, ky, kz, 0, fy, fz, (THIGH_R + ANKLE_R) / 2, ANKLE_R);
  }
}
