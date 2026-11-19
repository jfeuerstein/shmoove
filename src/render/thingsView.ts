/**
 * The things on the map, whatever placed them in `w.things`, as chunky toys built from boxes:
 *
 * - crate: a wooden crate (corner posts, a diagonal brace on each face, a lid). Gold crate: a chest
 *   (lid, two straps, a lock plate and a glint that sparkles) that turns and bobs. Spent, either is a
 *   low slab of debris with its planks lying round it; at the moment it breaks the planks are thrown
 *   out of it and tumble down.
 * - shrine: a pillar on a stepped plinth with a gem floating and turning over it and four studs
 *   circling the gem; on the ground, a bright ring whose outer edge is exactly its reach (ride inside
 *   it and it opens), breathing while it waits. Spent: a dark stump, a faint ring, and the gem fallen
 *   on the ground beside it (it drops when the shrine is done).
 * - gate: two flag poles on feet, a pennant flapping on each, and a banner across. The next gate of
 *   its slalom (its place in the group equals `state`, which is also how many are taken) is bright and
 *   its banner pulses; the gates still to come are dim; the taken ones grey with their banner lowered. A dashed line on the
 *   ground runs from each gate to the next; the leg into the next gate is lit and marches. Spent:
 *   grey stumps and the banner lying on the ground.
 * - hoop: a ring standing on its kicker's top facing its `yaw`, as big as its catch, held up by two
 *   poles with a balloon on each, and a chevron on the kicker's run-in pointing the way to ride.
 *   Faint, the balloons shrunk, while it is waiting to come back.
 * - totem: a carved stack of three blocks round a spine, a pair of eyes on each, all facing the
 *   bowl's middle, a diamond turning above. When it is rammed (spent, the elite called) it shakes
 *   with its eyes lit for `CALL_TIME` and sinks into the ground, leaving a grey stump.
 * - every live thing but a plain crate (there are many, and they are found by riding) has a beacon:
 *   a tall thin column of its colour, crossed planes, faint at the foot, brightest a third of the way
 *   up, gone at the top, drawn without fog so it is seen over hills and from across the bowl. It fades
 *   out as the rider comes near (the label over the thing takes over). A slalom has one, over the
 *   gate that is next. Gone when the thing is spent (a hoop's while it is gone).
 *
 * Every box of every thing is one instance of one mesh: first each thing's body (the boxes that say
 * what it is and what state it is in: `firstSolid`, `solidCount`), then each thing's trim (the
 * details: `firstTrim`, `trimCount`). Hoops, the shrines' rings and the beacons are one mesh each:
 * four draw calls for every thing on the map.
 *
 * The view remembers each thing's last state to see the moment it is spent (it never writes the sim).
 */
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type InstancedBufferAttribute,
  type InstancedMesh,
  TorusGeometry,
} from 'three';
import type { Terrain } from '../sim/terrain';
import { THINGS } from '../sim/things';
import {
  MAX_THINGS,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from '../sim/world';
import { PALETTE, tone } from './look';
import {
  addInstanceColor,
  addInstanceFloat,
  fadeMaterial,
  makeInstanced,
  rgbInto,
  segmentMatrix,
  tintMaterial,
  uploadFirst,
  writeMatrix,
} from './fxView';
import { GroundRings } from './zonesView';

/** From the map's rules: a shrine's reach (its ring's outer edge) and a gate's half-width, m. */
export const SHRINE_REACH = THINGS.shrineReach;
export const GATE_HALF = THINGS.gateHalf;
/** A hoop is taken within this of its middle: drawn that big, m. */
export const HOOP_RADIUS = THINGS.hoopReach;

/** Most boxes, body and trim, one thing is drawn with. */
export const BOXES_PER_THING = 16;
export const MAX_SOLIDS = MAX_THINGS * BOXES_PER_THING;
/** Triangles in one box. */
export const BOX_TRIANGLES = 12;

const CRATE_SIZE = 1.1;
const GOLD_SIZE = 1.3;
const GOLD_SPIN = 0.35;
const GOLD_BOB = 0.12;
const DEBRIS_WIDE = 1.3;
const DEBRIS_HIGH = 0.18;
const PILLAR_WIDE = 0.7;
export const PILLAR_HIGH = 3.6;
const STUMP_HIGH = 1.1;
const CAP_SIZE = 0.8;
const CAP_SPIN = 0.25;
const CAP_BOB = 0.25;
const POST_WIDE = 0.25;
export const POST_HIGH = 2.4;
const BANNER_HIGH = 0.55;
const BANNER_DEEP = 0.1;
/** A cleared gate's banner hangs this low (its top), m. */
const BANNER_LOWERED = 1.1;
const GATE_STUMP = 0.7;
const TOTEM_WIDE = 0.5;
export const TOTEM_HIGH = 3.2;
const TOTEM_STUMP = 0.9;
const HOOP_TUBE = 0.22;
/** Dashes on the ground between two gates of a slalom. */
export const DASHES_PER_LEG = 3;
const DASH_WIDE = 0.35;
const DASH_LIFT = 0.06;
/** The chevron on a hoop's run-in: this far back from the kicker's top, m, and its arms. */
const RUN_IN_BACK = 16;
const CHEVRON_ARM = 1.8;
const CHEVRON_WIDE = 0.45;

/** How long, s, the planks of a broken crate fly, the gem of a done shrine falls, a called totem shakes and sinks. */
export const THROW_TIME = 0.7;
export const DROP_TIME = 0.6;
export const CALL_TIME = 2.5;

/** Glow of each look, and how much of its colour a dim gate keeps. */
export const GLOW_CRATE = 0.12;
export const GLOW_GOLD = 0.5;
export const GLOW_SHRINE = 0.45;
export const GLOW_GATE_NEXT = 0.35;
export const GLOW_GATE = 0.12;
export const GLOW_TOTEM = 0.4;
export const GLOW_SPENT = 0;
/** The lit eyes of a called totem, the gold crate's glint, a lit dash. */
export const GLOW_EYES = 1;
const GLOW_GLINT = 1.2;
const GLOW_DASH = 0.9;
const GATE_DIM = 0.55;
const SPENT_DIM = 0.7;
/** Hoop strength waiting, and while it is gone. */
export const HOOP_READY = 0.9;
export const HOOP_GONE = 0.15;
/** The shrine ring: band width (inside its reach), strength at the low and high of its breath, and when spent. */
export const RING_BAND = 0.8;
export const RING_LOW = 0.7;
export const RING_HIGH = 1;
const RING_BREATH = 2.2;
export const RING_SPENT = 0.15;
const RING_LIFT = 0.15;
const RING_SEGMENTS = 96;
const MAX_SHRINES = 8;

/** Beacons: where they start above the thing, how tall and wide, and how strong. */
export const BEACON_BASE = 7;
export const BEACON_HIGH = 42;
export const BEACON_WIDE = 0.7;
export const BEACON_FADE = 0.35;
export const BEACON_GOLD = 0.6;
/** A beacon is full while the rider is further than this from its thing, m, and gone nearer than the second. */
export const BEACON_FAR = 50;
export const BEACON_NEAR = 30;

// Colour slots in the table: three tones (base, dark, light) of each of the six things, then the
// same three of spent grey, then the lit eyes.
const T_BASE = 0;
const T_DARK = 1;
const T_LIGHT = 2;
const C_SPENT = 6;
const C_EYES = 7;
const SLOTS = 8 * 3;
const DARK = -0.45;
const LIGHT = 0.45;

/** The tones of a totem's three blocks, bottom to top. */
const TOTEM_TONES = [T_DARK, T_BASE, T_LIGHT] as const;

/** A state no thing has: the view has not seen this slot yet. */
const UNSEEN = 0xffff;

function slot(c: number, t: number): number {
  return c * 3 + t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How much of its strength a beacon keeps with the rider `d` m from its thing: 1 far off, 0 near. */
export function beaconShare(d: number): number {
  return clamp01((d - BEACON_NEAR) / (BEACON_FAR - BEACON_NEAR));
}

/** Where up a beacon its light is strongest, as a share of its height. */
const BEACON_PEAK = 0.35;

/**
 * Two crossed vertical planes from y 0 to 1, 1 wide, each two quads high: dark at the foot (so up
 * close, where only the foot is in view, it does not wash over the thing), brightest at
 * `BEACON_PEAK`, fading to nothing at the top.
 */
function beaconGeometry(): BufferGeometry {
  const h = 0.5;
  const rows = [0, BEACON_PEAK, 1];
  const shade = [0.15, 1, 0];
  const pos: number[] = [];
  const col: number[] = [];
  for (const [ax, az, bx, bz] of [[-h, 0, h, 0], [0, -h, 0, h]]) {
    for (let r = 0; r < 2; r++) {
      const y0 = rows[r];
      const y1 = rows[r + 1];
      const c0 = shade[r];
      const c1 = shade[r + 1];
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
      for (const c of [c0, c0, c1, c0, c1, c1]) col.push(c, c, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class ThingsView {
  readonly object = new Group();
  /** Every box: bodies first, then trims. */
  readonly solids: InstancedMesh;
  readonly hoops: InstancedMesh;
  /** Shrines' orbit rings. */
  readonly rings: GroundRings;
  readonly beacons: InstancedMesh;
  /** For each thing drawn last frame, its first body box in `solids` and how many it has. */
  readonly firstSolid = new Int32Array(MAX_THINGS);
  readonly solidCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its first trim box in `solids` and how many it has. */
  readonly firstTrim = new Int32Array(MAX_THINGS);
  readonly trimCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its hoop instance, or -1. */
  readonly hoopOf = new Int32Array(MAX_THINGS);
  /** For each thing drawn last frame, its beacon instance, or -1. */
  readonly beaconOf = new Int32Array(MAX_THINGS);
  private readonly glow: InstancedBufferAttribute;
  private readonly hoopFade: InstancedBufferAttribute;
  private readonly beaconFade: InstancedBufferAttribute;
  private readonly solidRgb: Float32Array;
  private readonly hoopRgb: Float32Array;
  private readonly beaconRgb: Float32Array;
  private readonly table = new Float32Array(SLOTS * 3);
  private readonly terrain: Terrain | null;
  /** Each slot's state last frame, and when (in `update`'s time) it was last seen being spent. */
  private readonly lastState = new Uint16Array(MAX_THINGS).fill(UNSEEN);
  private readonly spentAt = new Float64Array(MAX_THINGS).fill(Number.NEGATIVE_INFINITY);
  /** Each gate's place in its slalom, this frame. */
  private readonly gateIdx = new Int32Array(MAX_THINGS);
  private n = 0;
  private beaconsN = 0;
  /** Where the rider is this frame, for the beacons. */
  private riderX = Number.POSITIVE_INFINITY;
  private riderZ = Number.POSITIVE_INFINITY;

  /** With a terrain, the shrines' rings, a hoop's poles and the lines on the ground follow it. */
  constructor(terrain: Terrain | null = null) {
    this.object.name = 'things';
    this.terrain = terrain;
    const box = new BoxGeometry(1, 1, 1);
    this.glow = addInstanceFloat(box, 'aGlow', MAX_SOLIDS);
    this.solids = makeInstanced(box, tintMaterial(), MAX_SOLIDS, 'things-solids');
    this.solidRgb = addInstanceColor(this.solids, MAX_SOLIDS);

    const torus = new TorusGeometry(HOOP_RADIUS, HOOP_TUBE, 3, 10);
    this.hoopFade = addInstanceFloat(torus, 'aFade', MAX_THINGS);
    this.hoops = makeInstanced(torus, fadeMaterial(0xffffff), MAX_THINGS, 'things-hoops');
    this.hoopRgb = addInstanceColor(this.hoops, MAX_THINGS);

    this.rings = new GroundRings(MAX_SHRINES, RING_SEGMENTS, 'things-rings', terrain, RING_LIFT);

    const beam = beaconGeometry();
    this.beaconFade = addInstanceFloat(beam, 'aFade', MAX_THINGS);
    const beamMat = fadeMaterial(0xffffff, true);
    beamMat.side = DoubleSide;
    // Additive, so the order of its faces does not matter: one pass, not one per side.
    beamMat.forceSinglePass = true;
    // A beacon is for finding the thing from anywhere in the bowl: the fog does not take it.
    beamMat.fog = false;
    this.beacons = makeInstanced(beam, beamMat, MAX_THINGS, 'things-beacons');
    this.beaconRgb = addInstanceColor(this.beacons, MAX_THINGS);
    this.beacons.renderOrder = 3;

    for (let k = 0; k < 6; k++) {
      const c = PALETTE.things[k];
      rgbInto(this.table, slot(k, T_BASE) * 3, c);
      rgbInto(this.table, slot(k, T_DARK) * 3, tone(c, DARK));
      rgbInto(this.table, slot(k, T_LIGHT) * 3, tone(c, LIGHT));
    }
    const grey = PALETTE.gears[0];
    rgbInto(this.table, slot(C_SPENT, T_BASE) * 3, grey, SPENT_DIM);
    rgbInto(this.table, slot(C_SPENT, T_DARK) * 3, tone(grey, DARK), SPENT_DIM);
    rgbInto(this.table, slot(C_SPENT, T_LIGHT) * 3, tone(grey, LIGHT), SPENT_DIM);
    rgbInto(this.table, slot(C_EYES, T_BASE) * 3, PALETTE.threat);
    rgbInto(this.table, slot(C_EYES, T_DARK) * 3, tone(PALETTE.threat, DARK));
    rgbInto(this.table, slot(C_EYES, T_LIGHT) * 3, tone(PALETTE.threat, LIGHT));
    this.object.add(this.solids, this.hoops, this.rings.mesh, this.beacons);
  }

  private ground(x: number, z: number, y: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : y;
  }

  private paint(i: number, s: number, dim: number, glow: number): void {
    const t = this.table;
    this.solidRgb[i * 3] = t[s * 3] * dim;
    this.solidRgb[i * 3 + 1] = t[s * 3 + 1] * dim;
    this.solidRgb[i * 3 + 2] = t[s * 3 + 2] * dim;
    (this.glow.array as Float32Array)[i] = glow;
  }

  /**
   * One box: centred at (x, y, z), sized (sx, sy, sz), turned to `yaw` and tilted by `tilt` about its
   * own forward axis (a quarter turn makes a diamond), in colour slot `s` times `dim`.
   */
  private box(x: number, y: number, z: number, yaw: number, tilt: number, sx: number, sy: number, sz: number, s: number, dim: number, glow: number): void {
    if (this.n >= MAX_SOLIDS) return;
    const i = this.n++;
    const cy = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    writeMatrix(
      this.solids.instanceMatrix.array, i,
      ct * cy * sx, st * sx, -ct * sn * sx,
      -st * cy * sy, ct * sy, st * sn * sy,
      sn * sz, 0, cy * sz,
      x, y, z,
    );
    this.paint(i, s, dim, glow);
  }

  /**
   * A box placed in a thing's own frame: the thing at (x, y, z) turned to `yaw`; the box at (lx, ly,
   * lz) in that frame (x across, z forward), turned a further `turn`.
   */
  private part(
    x: number, y: number, z: number, yaw: number,
    lx: number, ly: number, lz: number, turn: number, tilt: number,
    sx: number, sy: number, sz: number, s: number, dim: number, glow: number,
  ): void {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    this.box(x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c, yaw + turn, tilt, sx, sy, sz, s, dim, glow);
  }

  /** A box stretched from one point to another, `wide` across and `high` up. */
  private bar(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wide: number, high: number, s: number, dim: number, glow: number): void {
    if (this.n >= MAX_SOLIDS) return;
    const i = this.n++;
    segmentMatrix(this.solids.instanceMatrix.array, i, x0, y0, z0, x1, y1, z1, wide, high);
    this.paint(i, s, dim, glow);
  }

  /** A flat chevron on the ground at (x, z) pointing along (fx, fz) (a unit vector). */
  private chevron(x: number, z: number, y: number, fx: number, fz: number, s: number, dim: number, glow: number): void {
    // The tip, and the two arms going back from it at 45 degrees.
    const tipX = x + fx * CHEVRON_ARM * 0.35;
    const tipZ = z + fz * CHEVRON_ARM * 0.35;
    const k = CHEVRON_ARM * 0.7071;
    for (let e = -1; e <= 1; e += 2) {
      const ex = tipX - fx * k + fz * k * e;
      const ez = tipZ - fz * k - fx * k * e;
      const y0 = this.ground(tipX, tipZ, y) + DASH_LIFT;
      const y1 = this.ground(ex, ez, y) + DASH_LIFT;
      this.bar(tipX, y0, tipZ, ex, y1, ez, CHEVRON_WIDE, 0.08, s, dim, glow);
    }
  }

  /** A beacon over (x, z), its strength `fade` scaled by how far the rider is; -1 if the rider is too near for one. */
  private beacon(x: number, y: number, z: number, color: number, fade: number): number {
    const dx = x - this.riderX;
    const dz = z - this.riderZ;
    const near = beaconShare(Math.sqrt(dx * dx + dz * dz));
    if (near <= 0) return -1;
    fade *= near;
    const b = this.beaconsN++;
    writeMatrix(this.beacons.instanceMatrix.array, b, BEACON_WIDE, 0, 0, 0, BEACON_HIGH, 0, 0, 0, BEACON_WIDE, x, y + BEACON_BASE, z);
    (this.beaconFade.array as Float32Array)[b] = fade;
    rgbInto(this.beaconRgb, b * 3, color);
    return b;
  }

  /** Is thing j a gate of slalom `group`? */
  private isGateOf(w: World, j: number, group: number): boolean {
    const t = w.things;
    return j >= 0 && j < t.count && t.kind[j] === THING_GATE && t.group[j] === group;
  }

  /** Seconds since thing i was seen being spent (infinite if it was spent before the view saw it). */
  private sinceSpent(i: number, time: number): number {
    return time - this.spentAt[i];
  }

  /**
   * `time` in seconds, for what turns, bobs and falls; (riderX, riderZ) where the rider is, for the
   * beacons (none given: far from everything).
   */
  update(w: World, time: number, riderX = Number.POSITIVE_INFINITY, riderZ = Number.POSITIVE_INFINITY): void {
    const t = w.things;
    this.riderX = riderX;
    this.riderZ = riderZ;
    this.n = 0;
    this.beaconsN = 0;
    this.rings.begin();
    let hoops = 0;
    const hm = this.hoops.instanceMatrix.array;
    const hf = this.hoopFade.array as Float32Array;
    let gateIdx = 0;

    // Bodies, hoops, rings and beacons.
    for (let i = 0; i < t.count; i++) {
      const kind = t.kind[i];
      const x = t.x[i];
      const y = t.y[i];
      const z = t.z[i];
      const yaw = t.yaw[i];
      const state = t.state[i];
      const done = state === THING_DONE;
      // The moment it is spent; a slot seen for the first time already spent has no moment.
      const last = this.lastState[i];
      if (done && last === UNSEEN) this.spentAt[i] = Number.NEGATIVE_INFINITY;
      else if (done && last !== THING_DONE) this.spentAt[i] = time;
      this.lastState[i] = state;

      this.firstSolid[i] = this.n;
      this.hoopOf[i] = -1;
      this.beaconOf[i] = -1;
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) {
        if (done) {
          this.box(x, y + DEBRIS_HIGH / 2, z, yaw, 0, DEBRIS_WIDE, DEBRIS_HIGH, DEBRIS_WIDE, slot(C_SPENT, T_BASE), kind === THING_GOLD_CRATE ? 1.2 : 1, GLOW_SPENT);
        } else if (kind === THING_CRATE) {
          this.box(x, y + CRATE_SIZE / 2, z, yaw, 0, CRATE_SIZE, CRATE_SIZE, CRATE_SIZE, slot(THING_CRATE, T_BASE), 1, GLOW_CRATE);
        } else {
          const bob = GOLD_BOB * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 0.6 + i));
          const spin = yaw + time * GOLD_SPIN * Math.PI * 2;
          this.box(x, y + GOLD_SIZE / 2 + bob, z, spin, 0, GOLD_SIZE, GOLD_SIZE, GOLD_SIZE, slot(THING_GOLD_CRATE, T_BASE), 1, GLOW_GOLD);
          this.beaconOf[i] = this.beacon(x, y, z, PALETTE.things[THING_GOLD_CRATE], BEACON_GOLD);
        }
      } else if (kind === THING_SHRINE) {
        if (done) {
          this.box(x, y + STUMP_HIGH / 2, z, yaw, 0, PILLAR_WIDE, STUMP_HIGH, PILLAR_WIDE, slot(C_SPENT, T_BASE), 1, GLOW_SPENT);
          this.rings.add(x, y, z, SHRINE_REACH - RING_BAND, SHRINE_REACH, this.table, slot(THING_SHRINE, T_BASE) * 3, RING_SPENT);
        } else {
          this.box(x, y + PILLAR_HIGH / 2, z, yaw, 0, PILLAR_WIDE, PILLAR_HIGH, PILLAR_WIDE, slot(THING_SHRINE, T_BASE), 1, GLOW_SHRINE);
          const spin = time * CAP_SPIN * Math.PI * 2;
          const bob = CAP_BOB * Math.sin(time * 1.7 + i);
          this.box(x, y + PILLAR_HIGH + CAP_SIZE * 0.9 + bob, z, spin, Math.PI / 4, CAP_SIZE, CAP_SIZE, CAP_SIZE, slot(THING_SHRINE, T_LIGHT), 1, GLOW_SHRINE);
          // The whole ring lit, breathing: come in.
          const breath = RING_LOW + (RING_HIGH - RING_LOW) * (0.5 + 0.5 * Math.sin(time * RING_BREATH * Math.PI + i));
          this.rings.add(x, y, z, SHRINE_REACH - RING_BAND, SHRINE_REACH, this.table, slot(THING_SHRINE, T_LIGHT) * 3, breath);
          this.beaconOf[i] = this.beacon(x, y, z, PALETTE.things[THING_SHRINE], BEACON_FADE);
        }
      } else if (kind === THING_GATE) {
        // Its place in its slalom: gates of one slalom are contiguous and share a group.
        gateIdx = i > 0 && t.kind[i - 1] === THING_GATE && t.group[i - 1] === t.group[i] ? gateIdx + 1 : 0;
        this.gateIdx[i] = gateIdx;
        this.gateBody(w, i, gateIdx, time);
      } else if (kind === THING_HOOP) {
        // The torus lies across its local z: turned to `yaw`, it faces along the way it is flown.
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        writeMatrix(hm, hoops, c, 0, -s, 0, 1, 0, s, 0, c, x, y, z);
        hf[hoops] = state === 0 ? HOOP_READY : HOOP_GONE;
        rgbInto(this.hoopRgb, hoops * 3, PALETTE.things[THING_HOOP]);
        this.hoopOf[i] = hoops;
        hoops++;
        if (state === 0) this.beaconOf[i] = this.beacon(x, y - BEACON_BASE + HOOP_RADIUS + 1, z, PALETTE.things[THING_HOOP], BEACON_FADE);
      } else if (kind === THING_TOTEM) {
        if (done) this.box(x, y + TOTEM_STUMP / 2, z, yaw, 0, TOTEM_WIDE, TOTEM_STUMP, TOTEM_WIDE, slot(C_SPENT, T_BASE), 1, GLOW_SPENT);
        else {
          this.box(x, y + TOTEM_HIGH / 2, z, yaw, 0, TOTEM_WIDE, TOTEM_HIGH, TOTEM_WIDE, slot(THING_TOTEM, T_BASE), 1, GLOW_TOTEM);
          const spin = -time * CAP_SPIN * Math.PI * 2;
          this.box(x, y + TOTEM_HIGH + CAP_SIZE * 0.8, z, spin, Math.PI / 4, CAP_SIZE * 1.1, CAP_SIZE * 1.1, CAP_SIZE * 1.1, slot(THING_TOTEM, T_LIGHT), 1, GLOW_TOTEM);
          this.beaconOf[i] = this.beacon(x, y, z, PALETTE.things[THING_TOTEM], BEACON_FADE);
        }
      }
      this.solidCount[i] = this.n - this.firstSolid[i];
    }

    // Trims, after every body.
    for (let i = 0; i < t.count; i++) {
      this.firstTrim[i] = this.n;
      const kind = t.kind[i];
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) this.crateTrim(w, i, time);
      else if (kind === THING_SHRINE) this.shrineTrim(w, i, time);
      else if (kind === THING_GATE) this.gateTrim(w, i, time);
      else if (kind === THING_HOOP) this.hoopTrim(w, i, time);
      else if (kind === THING_TOTEM) this.totemTrim(w, i, time);
      this.trimCount[i] = this.n - this.firstTrim[i];
    }
    for (let i = t.count; i < MAX_THINGS; i++) this.lastState[i] = UNSEEN;

    const n = this.n;
    this.solids.count = n;
    this.solids.visible = n > 0;
    if (n > 0) {
      uploadFirst(this.solids.instanceMatrix, n);
      uploadFirst(this.glow, n);
      if (this.solids.instanceColor) uploadFirst(this.solids.instanceColor, n);
    }
    this.hoops.count = hoops;
    this.hoops.visible = hoops > 0;
    if (hoops > 0) {
      this.hoops.instanceMatrix.needsUpdate = true;
      this.hoopFade.needsUpdate = true;
      if (this.hoops.instanceColor) this.hoops.instanceColor.needsUpdate = true;
    }
    const b = this.beaconsN;
    this.beacons.count = b;
    this.beacons.visible = b > 0;
    if (b > 0) {
      uploadFirst(this.beacons.instanceMatrix, b);
      uploadFirst(this.beaconFade, b);
      if (this.beacons.instanceColor) uploadFirst(this.beacons.instanceColor, b);
    }
    this.rings.end();
  }

  /** Where gate i of its slalom stands in the run: 1 next, 0 still to come (or waiting), -1 cleared. */
  private gateLook(w: World, i: number, gateIdx: number): number {
    const t = w.things;
    const state = t.state[i];
    if (state === gateIdx) return 1;
    // Already taken (`state` names a later gate of this slalom).
    if (gateIdx < state && this.isGateOf(w, i - gateIdx + state, t.group[i])) return -1;
    return 0;
  }

  private gateBody(w: World, i: number, gateIdx: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const yaw = t.yaw[i];
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    if (t.state[i] === THING_DONE) {
      for (let e = -1; e <= 1; e += 2) {
        this.box(x + ax * GATE_HALF * e, y + GATE_STUMP / 2, z + az * GATE_HALF * e, yaw, 0, POST_WIDE, GATE_STUMP, POST_WIDE, slot(C_SPENT, T_BASE), 1, GLOW_SPENT);
      }
      return;
    }
    const look = this.gateLook(w, i, gateIdx);
    let s = slot(THING_GATE, T_BASE);
    let dim = GATE_DIM;
    let glow = GLOW_GATE;
    let bannerTop = POST_HIGH;
    let bannerGlow = GLOW_GATE;
    if (look === 1) {
      dim = 1;
      glow = GLOW_GATE_NEXT;
      // The next gate beckons: its banner pulses.
      bannerGlow = GLOW_GATE_NEXT + 0.35 * (0.5 + 0.5 * Math.sin(time * 6));
    } else if (look === -1) {
      s = slot(C_SPENT, T_BASE);
      dim = 1;
      glow = GLOW_SPENT;
      bannerGlow = GLOW_SPENT;
      bannerTop = BANNER_LOWERED;
    }
    for (let e = -1; e <= 1; e += 2) {
      this.box(x + ax * GATE_HALF * e, y + POST_HIGH / 2, z + az * GATE_HALF * e, yaw, 0, POST_WIDE, POST_HIGH, POST_WIDE, s, dim, glow);
    }
    this.box(x, y + bannerTop - BANNER_HIGH / 2, z, yaw, 0, GATE_HALF * 2 + POST_WIDE, BANNER_HIGH, BANNER_DEEP, s, dim, bannerGlow);
    // One beacon per slalom: over the gate that is next, or over the first while none is.
    const first = i - gateIdx;
    const state = t.state[i];
    const named = this.isGateOf(w, first + state, t.group[i]);
    if (look === 1 || (!named && gateIdx === 0)) this.beaconOf[i] = this.beacon(x, y, z, PALETTE.things[THING_GATE], BEACON_FADE);
  }

  private crateTrim(w: World, i: number, time: number): void {
    const t = w.things;
    const kind = t.kind[i];
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const yaw = t.yaw[i];
    if (t.state[i] === THING_DONE) {
      // Three planks: thrown out of it when it breaks, then lying round the debris.
      const p = clamp01(this.sinceSpent(i, time) / THROW_TIME);
      const s = slot(kind, T_DARK);
      for (let k = 0; k < 3; k++) {
        const a = i * 2.3 + k * 2.1;
        const reach = 1.1 + 0.25 * k;
        const lx = Math.sin(a) * reach * p;
        const lz = Math.cos(a) * reach * p;
        const ly = 0.05 + (1 - p) * 0.5 + 3.2 * p * (1 - p);
        this.part(x, y, z, yaw, lx, ly, lz, a + 0.6, (1 - p) * 7 + k * 0.1, 1.1, 0.1, 0.26, s, 0.75, GLOW_SPENT);
      }
      return;
    }
    if (kind === THING_CRATE) {
      const h = CRATE_SIZE;
      const half = h / 2;
      const dark = slot(THING_CRATE, T_DARK);
      // Corner posts.
      for (let ex = -1; ex <= 1; ex += 2) {
        for (let ez = -1; ez <= 1; ez += 2) this.part(x, y, z, yaw, ex * (half - 0.02), half, ez * (half - 0.02), 0, 0, 0.2, h + 0.04, 0.2, dark, 1, GLOW_CRATE * 0.5);
      }
      // A diagonal brace on each face.
      for (let f = 0; f < 4; f++) {
        const turn = (f * Math.PI) / 2;
        const lx = Math.sin(turn) * (half + 0.03);
        const lz = Math.cos(turn) * (half + 0.03);
        this.part(x, y, z, yaw, lx, half, lz, turn, (f % 2 === 0 ? 1 : -1) * 0.785, h * 1.25, 0.17, 0.07, dark, 1, GLOW_CRATE * 0.5);
      }
      // The lid.
      this.part(x, y, z, yaw, 0, h + 0.05, 0, 0, 0, h + 0.16, 0.14, h + 0.16, slot(THING_CRATE, T_LIGHT), 1, GLOW_CRATE);
      return;
    }
    // The gold chest turns and bobs with its body.
    const bob = GOLD_BOB * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 0.6 + i));
    const spin = yaw + time * GOLD_SPIN * Math.PI * 2;
    const h = GOLD_SIZE;
    const yb = y + bob;
    const light = slot(THING_GOLD_CRATE, T_LIGHT);
    const dark = slot(THING_GOLD_CRATE, T_DARK);
    // A lid with a ridge: the chest's silhouette.
    this.part(x, yb, z, spin, 0, h + 0.12, 0, 0, 0, h + 0.14, 0.24, h + 0.14, light, 1, GLOW_GOLD);
    this.part(x, yb, z, spin, 0, h + 0.32, 0, 0, 0, h + 0.14, 0.18, h * 0.62, light, 1, GLOW_GOLD);
    // Two straps over it.
    for (let e = -1; e <= 1; e += 2) this.part(x, yb, z, spin, e * h * 0.3, (h + 0.42) / 2, 0, 0, 0, 0.18, h + 0.44, h + 0.18, dark, 1, GLOW_GOLD * 0.4);
    // The lock plate, and a glint that sparkles round the lid.
    this.part(x, yb, z, spin, 0, h * 0.62, h / 2 + 0.06, 0, 0, 0.34, 0.4, 0.1, light, 1, GLOW_GLINT);
    const sparkle = Math.max(0, Math.sin(time * 2.6 + i * 1.7));
    const g = 0.12 + 0.3 * sparkle * sparkle;
    this.part(x, yb, z, spin, h * 0.45, h + 0.5, h * 0.3, time * 3, Math.PI / 4, g, g, g, light, 1, GLOW_GLINT);
  }

  private shrineTrim(w: World, i: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const yaw = t.yaw[i];
    const done = t.state[i] === THING_DONE;
    const c = done ? C_SPENT : THING_SHRINE;
    const glow = done ? GLOW_SPENT : GLOW_SHRINE * 0.3;
    // The stepped plinth.
    this.part(x, y, z, yaw, 0, 0.17, 0, 0, 0, 2, 0.34, 2, slot(c, T_DARK), 1, glow);
    this.part(x, y, z, yaw, 0, 0.48, 0, 0, 0, 1.4, 0.3, 1.4, slot(c, T_BASE), 1, glow);
    if (done) {
      // The gem drops off the top and lies beside the stump.
      const p = clamp01(this.sinceSpent(i, time) / DROP_TIME);
      const fall = p * p;
      const top = PILLAR_HIGH + CAP_SIZE * 0.9;
      this.part(x, y, z, yaw, 1.4 * p, top + (0.45 - top) * fall, 0.4 * p, p * 2, Math.PI / 4 + p * 1.3, CAP_SIZE, CAP_SIZE, CAP_SIZE, slot(C_SPENT, T_LIGHT), 1, GLOW_SPENT);
      return;
    }
    // A capital on the pillar, and four studs circling the floating gem.
    this.part(x, y, z, yaw, 0, PILLAR_HIGH - 0.1, 0, 0, 0, 1.05, 0.26, 1.05, slot(THING_SHRINE, T_LIGHT), 1, GLOW_SHRINE);
    const bob = CAP_BOB * Math.sin(time * 1.7 + i);
    const gy = PILLAR_HIGH + CAP_SIZE * 0.9 + bob;
    const orbit = -time * 1.3;
    for (let k = 0; k < 4; k++) {
      const a = orbit + (k * Math.PI) / 2;
      this.part(x, y, z, 0, Math.sin(a) * 1.05, gy + 0.25 * Math.sin(a * 2), Math.cos(a) * 1.05, a, Math.PI / 4, 0.2, 0.2, 0.2, slot(THING_SHRINE, T_LIGHT), 1, GLOW_SHRINE * 2);
    }
  }

  private gateTrim(w: World, i: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const yaw = t.yaw[i];
    const gateIdx = this.gateIdx[i];
    const done = t.state[i] === THING_DONE;
    const look = done ? -1 : this.gateLook(w, i, gateIdx);
    const c = look === -1 ? C_SPENT : THING_GATE;
    const dim = look === 0 ? GATE_DIM : 1;
    const glow = look === 1 ? GLOW_GATE_NEXT : look === 0 ? GLOW_GATE : GLOW_SPENT;
    // Feet under both poles.
    for (let e = -1; e <= 1; e += 2) this.part(x, y, z, yaw, e * GATE_HALF, 0.1, 0, 0, 0, 0.6, 0.2, 0.6, slot(c, T_DARK), dim, GLOW_SPENT);
    if (done) {
      // The banner lies on the ground.
      this.part(x, y, z, yaw, 0, 0.06, 0.5, 0.12, 0, GATE_HALF * 2, 0.1, BANNER_HIGH, slot(C_SPENT, T_BASE), 1, GLOW_SPENT);
    } else {
      // A pennant on each pole, flapping (faster at the next gate), and a stripe along the banner.
      const rate = look === 1 ? 9 : 4;
      for (let e = -1; e <= 1; e += 2) {
        const flap = look === -1 ? 0 : 0.35 * Math.sin(time * rate + i + e);
        this.part(x, y, z, yaw, e * GATE_HALF, POST_HIGH + 0.18, -0.3, Math.PI / 2 + flap, 0, 0.6, 0.36, 0.06, slot(c, T_LIGHT), dim, glow);
      }
      const top = look === -1 ? BANNER_LOWERED : POST_HIGH;
      this.part(x, y, z, yaw, 0, top - BANNER_HIGH / 2, 0, 0, 0, GATE_HALF * 2 + POST_WIDE * 0.5, 0.14, BANNER_DEEP + 0.06, slot(c, T_DARK), dim, glow);
    }
    // The dashed line to the next gate of the slalom; the leg into the gate that is next is lit and marches.
    const j = i + 1;
    if (!this.isGateOf(w, j, t.group[i])) return;
    const into = !done && t.state[j] === gateIdx + 1;
    const leg = into ? GLOW_DASH : done ? GLOW_SPENT : GLOW_GATE;
    const legDim = into ? 1 : done ? 0.6 : GATE_DIM * 0.7;
    const s = done ? slot(C_SPENT, T_BASE) : slot(THING_GATE, T_BASE);
    const dx = t.x[j] - x;
    const dz = t.z[j] - z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const dash = Math.min(1.6, (len / DASHES_PER_LEG) * 0.5);
    for (let k = 0; k < DASHES_PER_LEG; k++) {
      const f = (k + 0.5) / DASHES_PER_LEG;
      const march = into ? 0.5 + 0.5 * Math.sin(time * 8 - k * 1.6) : 1;
      const h = dash / len / 2;
      const ax = x + dx * (f - h);
      const az = z + dz * (f - h);
      const bx = x + dx * (f + h);
      const bz = z + dz * (f + h);
      const ya = this.ground(ax, az, y + (t.y[j] - y) * (f - h)) + DASH_LIFT;
      const yb = this.ground(bx, bz, y + (t.y[j] - y) * (f + h)) + DASH_LIFT;
      this.bar(ax, ya, az, bx, yb, bz, DASH_WIDE, 0.08, s, legDim, leg * march);
    }
  }

  private hoopTrim(w: World, i: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const yaw = t.yaw[i];
    const ready = t.state[i] === 0;
    const dim = ready ? 1 : 0.5;
    const glow = ready ? 0.35 : GLOW_SPENT;
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Two poles from the ground to the ring's sides, a balloon tied over each.
    const side = HOOP_RADIUS + HOOP_TUBE + 0.15;
    for (let e = -1; e <= 1; e += 2) {
      const px = x + ax * side * e;
      const pz = z + az * side * e;
      const foot = this.ground(px, pz, y - 4) - 0.3;
      const top = y + 0.6;
      this.bar(px, foot, pz, px, top, pz, 0.2, 0.2, slot(THING_HOOP, T_DARK), 1, GLOW_SPENT);
      const bob = 0.2 * Math.sin(time * 2.1 + e + i);
      const b = ready ? 0.75 : 0.35;
      this.box(px, top + 0.55 + b * 0.5 + bob, pz, yaw + time * 0.5 * e, Math.PI / 4, b, b * 1.25, b, slot(THING_HOOP, T_LIGHT), dim, glow);
    }
    // A chevron on the kicker's run-in, pointing the way to ride it into the hoop.
    const cx = x - fx * RUN_IN_BACK;
    const cz = z - fz * RUN_IN_BACK;
    const pulse = ready ? 0.6 + 0.4 * Math.sin(time * 4 + i) : 0;
    this.chevron(cx, cz, y - 5, fx, fz, slot(THING_HOOP, T_BASE), dim, ready ? 0.5 + 0.5 * pulse : GLOW_SPENT);
  }

  private totemTrim(w: World, i: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    // Its faces look toward the bowl's middle, where riders mostly come from.
    const yaw = Math.atan2(-x, -z);
    const done = t.state[i] === THING_DONE;
    let sink = 0;
    let shake = 0;
    let eyes = slot(THING_TOTEM, T_DARK);
    let eyeGlow = GLOW_SPENT;
    if (done) {
      // Called: it shakes with its eyes lit, then sinks into the ground.
      const p = this.sinceSpent(i, time) / CALL_TIME;
      if (!(p < 1)) return;
      shake = 0.09;
      const q = clamp01((p - 0.55) / 0.45);
      sink = q * q * (TOTEM_HIGH + 0.5);
      eyes = slot(C_EYES, T_BASE);
      eyeGlow = GLOW_EYES;
    }
    // Three carved blocks round the spine, a pair of eyes on the front of each.
    const blockHigh = 0.88;
    for (let k = 0; k < 3; k++) {
      const wide = 0.95 - k * 0.07;
      const cy = 0.08 + blockHigh / 2 + k * (blockHigh + 0.14) - sink;
      const jx = shake * Math.sin(time * 47 + k * 2.1);
      const jz = shake * Math.sin(time * 39 + k * 1.3);
      this.part(x, y, z, yaw, jx, cy, jz, shake * Math.sin(time * 31 + k), 0, wide, blockHigh, wide, slot(THING_TOTEM, TOTEM_TONES[k]), 1, GLOW_TOTEM * 0.4);
      for (let e = -1; e <= 1; e += 2) {
        this.part(x, y, z, yaw, jx + e * wide * 0.24, cy + 0.12, jz + wide / 2 + 0.03, 0, 0, 0.22, 0.16, 0.08, eyes, 1, eyeGlow);
      }
    }
  }
}
