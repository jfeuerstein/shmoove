/**
 * The greybox mover: a 1.7 m block figure in `PALETTE.mover` with a visor that shows which way it
 * faces, and a blob shadow pinned to the ground under it (that is how hop height is read).
 *
 * Pose, from the sim state interpolated `alpha` of the way from `prev` to `cur`: tilted to the ground
 * normal while grounded, upright in the air; turned to `heading`; leaning into turns by the sideways
 * acceleration; low and `PALETTE.moverTuck` while tucked; a little stretched in the air.
 * `update` allocates nothing.
 */
import { BoxGeometry, CircleGeometry, Group, Mesh, type Object3D, Quaternion, Vector3 } from 'three';
import { DT, FEEL } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import type { SimState, Vec3 } from '../sim/types';
import { PALETTE, flatMaterial } from './look';

/** Height of the figure standing, m. */
export const MOVER_HEIGHT = 1.7;
/** Steepest lean into a turn, rad. */
const MAX_LEAN = 0.55;
/** Scale of the figure's height while tucked. */
const TUCK_SQUASH = 0.68;
/** Scale of the figure's height at the top of a hop, and of its width then. */
const AIR_STRETCH = 1.1;
const AIR_THIN = 0.95;
/** Blob shadow radius on the ground, and how high above the ground it has shrunk to nothing, m. */
const SHADOW_RADIUS = 0.6;
const SHADOW_FADE_HEIGHT = 12;
const SHADOW_MIN_SCALE = 0.35;
const SHADOW_LIFT = 0.04;
const SHADOW_OPACITY = 0.55;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class MoverView {
  readonly object: Object3D;
  /** Placed at the mover, tilted to the ground. */
  private readonly root = new Group();
  /** Turned to the heading and leaning. */
  private readonly body = new Group();
  /** Squashed and stretched. */
  private readonly figure = new Group();
  private readonly shadow: Mesh;
  private readonly material = flatMaterial(PALETTE.mover);
  private tuckShown = false;

  private readonly up = new Vector3(0, 1, 0);
  private readonly n = new Vector3();
  private readonly q = new Quaternion();
  private readonly ground: Vec3 = { x: 0, y: 1, z: 0 };

  constructor() {
    const container = new Group();
    container.name = 'mover';
    const legs = new Mesh(new BoxGeometry(0.5, 0.8, 0.32), this.material);
    legs.position.y = 0.4;
    const torso = new Mesh(new BoxGeometry(0.62, 0.62, 0.38), this.material);
    torso.position.y = 1.11;
    const head = new Mesh(new BoxGeometry(0.34, 0.26, 0.34), this.material);
    head.position.y = MOVER_HEIGHT - 0.13;
    // The visor sits on the face, toward +z, which `heading` turns to the direction of travel.
    const visor = new Mesh(new BoxGeometry(0.28, 0.09, 0.08), flatMaterial(PALETTE.accent));
    visor.position.set(0, MOVER_HEIGHT - 0.12, 0.19);
    this.figure.add(legs, torso, head, visor);
    this.body.add(this.figure);
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
  }

  update(prev: SimState, cur: SimState, alpha: number, terrain: Terrain): void {
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

    if (b.grounded) {
      if (b.tucked) this.figure.scale.set(1.08, TUCK_SQUASH, 1.08);
      else this.figure.scale.set(1, 1, 1);
    } else {
      this.figure.scale.set(AIR_THIN, AIR_STRETCH, AIR_THIN);
    }
    const tuck = b.tucked;
    if (tuck !== this.tuckShown) {
      this.tuckShown = tuck;
      this.material.color.setHex(tuck ? PALETTE.moverTuck : PALETTE.mover);
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
}
