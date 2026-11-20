/**
 * The things on the map, whatever placed them in `w.things`, as chunky toys built from boxes, each
 * showing on itself what it wants and how far along it is (nothing in the world carries words):
 *
 * - crate: a wooden crate (corner posts, a diagonal brace on each face, a lid). Gold crate: a chest
 *   (lid, two straps, a lock plate and a glint that sparkles) that turns and bobs. Spent, either is a
 *   low slab of debris with its planks lying round it; at the moment it breaks the planks are thrown
 *   out of it and tumble down.
 * - shrine: a pillar on a stepped plinth with a gem floating and turning over it and four studs
 *   circling the gem; round it on the ground, a ring of twelve dashes, one for each segment of its
 *   ring in the sim. Unlit dashes are dim, lit ones bright gold, each lighting with a pop as the rider
 *   passes it. While some are unlit a pulse runs round through the unlit ones in the way the rider is
 *   circling (clockwise seen from above before the rider has started): go round. The last one sets
 *   the whole ring flashing as it opens. Spent: a dark stump, grey dashes, and the gem fallen on the
 *   ground beside it.
 * - gate: two flag poles on feet, a pennant flapping on each, and a banner across. The next gate of
 *   its slalom (its place in the group equals `state`, which is also how many are taken) is bright and
 *   its banner pulses; the gates still to come are dim; the taken ones grey with their banner lowered.
 *   A dotted line on the ground runs from each gate to the next. Before the slalom is started its dots
 *   march along the whole line from the first gate; once started, the leg into the next gate is its
 *   clock: its dots go out one by one from the rider's end toward the gate as the time runs, and the
 *   legs behind stay lit. A reset raises the lowered banners again and the line marches again.
 *   Spent: grey stumps, the banner lying on the ground, the line grey.
 * - hoop: a ring hanging over its kicker's top facing its `yaw`, as big as its catch, held up by two
 *   poles with a balloon on each, pulsing gently; a dotted arc shows the flight: up the ramp, off the
 *   lip and through the ring's middle, marching the way it is flown. Faint, the balloons shrunk and no
 *   arc, while it is waiting to come back.
 * - totem: a carved stack of three blocks round a spine, a pair of eyes on each glowing a slow red,
 *   all facing the bowl's middle, a diamond turning above, and a faint ring of dashes at its touch.
 *   When it is rammed (spent, the elite called) it shakes with its eyes lit for `CALL_TIME` and
 *   sinks into the ground, leaving a grey stump.
 * - every live thing but a plain crate (there are many, and they are found by riding) has a beacon:
 *   a tall thin column of its colour, crossed planes, faint at the foot, brightest a third of the way
 *   up, gone at the top, drawn without fog so it is seen over hills and from across the bowl. It fades
 *   out as the rider comes near, where the thing itself says what it wants. A slalom has one, over the
 *   gate that is next. Gone when the thing is spent (a hoop's while it is gone).
 *
 * Every box of every thing is one instance of one mesh: first each thing's body (the boxes that say
 * what it is and what state it is in: `firstSolid`, `solidCount`), then each thing's trim (the
 * details: `firstTrim`, `trimCount`). The marks on the ground and in the air (dashes, dots, the arc:
 * `firstMark`, `markCount`) are one mesh, the hoops one and the beacons one: four draw calls for every
 * thing on the map.
 *
 * The view remembers each thing's last state to see the moment it is spent, a segment lights or a
 * slalom resets, and which way the rider goes round each shrine (it never writes the sim).
 */
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type InstancedBufferAttribute,
  type InstancedMesh,
  OctahedronGeometry,
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

/** From the map's rules: a gate's half-width, m, and a shrine's segments. */
export const GATE_HALF = THINGS.gateHalf;
export const SHRINE_DASHES = THINGS.shrineSegments;
/** A hoop is taken within this of its middle: drawn that big, m. */
export const HOOP_RADIUS = THINGS.hoopReach;
/** A shrine's ring of dashes is drawn this far out, m: inside the band where its segments light. */
export const SHRINE_RING = 6;
/** A totem's faint ring of dashes, at its touch, and how many. */
export const TOTEM_RING = THINGS.touch;
export const TOTEM_DASHES = 10;

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
/** Dots on the ground along one leg of a slalom, gate to gate. */
export const DOTS_PER_LEG = 10;
/**
 * Dots of a hoop's arc, `ARC_STEP` m apart along its line: dot `ARC_MIDDLE` in the ring's middle, the
 * ones `ARC_TAKEOFF` dots or more before it on the ramp, and the flight between.
 */
export const ARC_DOTS = 21;
export const ARC_MIDDLE = 12;
export const ARC_STEP = 1.3;
export const ARC_TAKEOFF = 5;
const MARK_LIFT = 0.07;
const DASH_HIGH = 0.1;

/** How long, s, the planks of a broken crate fly, the gem of a done shrine falls, a called totem shakes and sinks. */
export const THROW_TIME = 0.7;
export const DROP_TIME = 0.6;
export const CALL_TIME = 2.5;
/** How long, s, a shrine's dash pops as it lights, its whole ring flashes as it opens, a slalom's banners rise again. */
export const POP_TIME = 0.35;
export const FLASH_TIME = 1.2;
export const RAISE_TIME = 0.5;

/** Glow of each look, and how much of its colour a dim gate keeps. */
export const GLOW_CRATE = 0.12;
export const GLOW_GOLD = 0.5;
export const GLOW_SHRINE = 0.45;
export const GLOW_GATE_NEXT = 0.35;
export const GLOW_GATE = 0.12;
export const GLOW_TOTEM = 0.4;
export const GLOW_SPENT = 0;
/** The lit eyes of a called totem, the gold crate's glint, a lit dash or dot, an unlit one. */
export const GLOW_EYES = 1;
const GLOW_GLINT = 1.2;
export const GLOW_LIT = 0.9;
export const GLOW_UNLIT = 0.04;
/** How much of its colour an unlit dash keeps, and what the pulse through the unlit ones adds. */
export const UNLIT_DIM = 0.4;
const PULSE_GLOW = 0.7;
/** The pulse round a shrine: segments a second, and how many segments wide. */
const PULSE_RATE = 6;
const PULSE_WIDE = 1.4;
/** A totem's idle eyes: a slow red glow between these. */
export const EYES_LOW = 0.15;
export const EYES_HIGH = 0.55;
const GATE_DIM = 0.55;
const SPENT_DIM = 0.7;
/** Hoop strength waiting (it pulses a little under it), and while it is gone. */
export const HOOP_READY = 0.9;
export const HOOP_GONE = 0.15;
const HOOP_PULSE = 0.15;

/** Most marks (dashes and dots) of every thing together. */
export const MAX_MARKS = MAX_THINGS * 24;

/** Beacons: where they start above the thing, how tall and wide, and how strong. */
export const BEACON_BASE = 7;
export const BEACON_HIGH = 42;
export const BEACON_WIDE = 0.7;
export const BEACON_FADE = 0.35;
export const BEACON_GOLD = 0.6;
/** A beacon is full while the rider is further than this from its thing, m, and gone nearer than the second. */
export const BEACON_FAR = 30;
export const BEACON_NEAR = 12;

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
  /** Dashes and dots on the ground and in the air. */
  readonly marks: InstancedMesh;
  readonly beacons: InstancedMesh;
  /** For each thing drawn last frame, its first body box in `solids` and how many it has. */
  readonly firstSolid = new Int32Array(MAX_THINGS);
  readonly solidCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its first trim box in `solids` and how many it has. */
  readonly firstTrim = new Int32Array(MAX_THINGS);
  readonly trimCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its first mark in `marks` and how many it has. */
  readonly firstMark = new Int32Array(MAX_THINGS);
  readonly markCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its hoop instance, or -1. */
  readonly hoopOf = new Int32Array(MAX_THINGS);
  /** For each thing drawn last frame, its beacon instance, or -1. */
  readonly beaconOf = new Int32Array(MAX_THINGS);
  private readonly glow: InstancedBufferAttribute;
  private readonly markGlow: InstancedBufferAttribute;
  private readonly markRgb: Float32Array;
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
  /** Each shrine's lit segments last frame, and when each segment was seen lighting. */
  private readonly lastLit = new Uint16Array(MAX_THINGS);
  private readonly litAt = new Float64Array(MAX_THINGS * SHRINE_DASHES).fill(Number.NEGATIVE_INFINITY);
  /** Which way the rider goes round each shrine (+1 the way atan2(x, z) grows, -1 the other: clockwise seen from above), and its angle round it last frame. */
  readonly circling = new Int8Array(MAX_THINGS).fill(-1);
  private readonly riderAngle = new Float64Array(MAX_THINGS).fill(Number.NaN);
  /** When each gate's banner was seen to start rising again after its slalom reset. */
  private readonly raiseAt = new Float64Array(MAX_THINGS).fill(Number.NEGATIVE_INFINITY);
  private n = 0;
  private marksN = 0;
  /** Set by `arcPoint`: whether the dot it placed is in the air. */
  arcAir = false;
  private beaconsN = 0;
  /** Where the rider is this frame, for the beacons. */
  private riderX = Number.POSITIVE_INFINITY;
  private riderZ = Number.POSITIVE_INFINITY;

  /** With a terrain, the marks on the ground and a hoop's poles follow it. */
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

    // A flat-shaded diamond: laid flat and stretched it is a dash on the ground, small it is a dot in the air.
    const gem = new OctahedronGeometry(0.5, 0);
    this.markGlow = addInstanceFloat(gem, 'aGlow', MAX_MARKS);
    this.marks = makeInstanced(gem, tintMaterial(), MAX_MARKS, 'things-marks');
    this.markRgb = addInstanceColor(this.marks, MAX_MARKS);

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
    this.object.add(this.solids, this.hoops, this.marks, this.beacons);
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

  /** One mark: a diamond stretched from (x0, y0, z0) to (x1, y1, z1), `wide` across and `high` up, in colour slot `s` times `dim`. */
  private mark(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wide: number, high: number, s: number, dim: number, glow: number): void {
    if (this.marksN >= MAX_MARKS) return;
    const i = this.marksN++;
    segmentMatrix(this.marks.instanceMatrix.array, i, x0, y0, z0, x1, y1, z1, wide, high);
    const t = this.table;
    this.markRgb[i * 3] = t[s * 3] * dim;
    this.markRgb[i * 3 + 1] = t[s * 3 + 1] * dim;
    this.markRgb[i * 3 + 2] = t[s * 3 + 2] * dim;
    (this.markGlow.array as Float32Array)[i] = glow;
  }

  /** A dash lying on the ground from (x0, z0) to (x1, z1), following it (`y` where there is no terrain). */
  private dash(x0: number, z0: number, x1: number, z1: number, y: number, wide: number, s: number, dim: number, glow: number): void {
    this.mark(x0, this.ground(x0, z0, y) + MARK_LIFT, z0, x1, this.ground(x1, z1, y) + MARK_LIFT, z1, wide, DASH_HIGH, s, dim, glow);
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
    this.marksN = 0;
    let hoops = 0;
    const hm = this.hoops.instanceMatrix.array;
    const hf = this.hoopFade.array as Float32Array;
    let gateIdx = 0;

    // Bodies, hoops and beacons.
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
      if (last === UNSEEN) this.forget(i, kind === THING_SHRINE ? t.progress[i] : 0);
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
        } else {
          this.box(x, y + PILLAR_HIGH / 2, z, yaw, 0, PILLAR_WIDE, PILLAR_HIGH, PILLAR_WIDE, slot(THING_SHRINE, T_BASE), 1, GLOW_SHRINE);
          const spin = time * CAP_SPIN * Math.PI * 2;
          const bob = CAP_BOB * Math.sin(time * 1.7 + i);
          this.box(x, y + PILLAR_HIGH + CAP_SIZE * 0.9 + bob, z, spin, Math.PI / 4, CAP_SIZE, CAP_SIZE, CAP_SIZE, slot(THING_SHRINE, T_LIGHT), 1, GLOW_SHRINE);
          this.beaconOf[i] = this.beacon(x, y, z, PALETTE.things[THING_SHRINE], BEACON_FADE);
        }
      } else if (kind === THING_GATE) {
        // Its place in its slalom: gates of one slalom are contiguous and share a group.
        gateIdx = i > 0 && t.kind[i - 1] === THING_GATE && t.group[i - 1] === t.group[i] ? gateIdx + 1 : 0;
        this.gateIdx[i] = gateIdx;
        // Its slalom has just gone back to the start: the banners it had lowered rise again.
        if (gateIdx === 0 && state === 0 && last !== UNSEEN && last !== THING_DONE && last > 0) {
          for (let k = 0; k < last && i + k < t.count; k++) this.raiseAt[i + k] = time;
        }
        this.gateBody(w, i, gateIdx, time);
      } else if (kind === THING_HOOP) {
        // The torus lies across its local z: turned to `yaw`, it faces along the way it is flown.
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        writeMatrix(hm, hoops, c, 0, -s, 0, 1, 0, s, 0, c, x, y, z);
        // Waiting, it pulses gently.
        hf[hoops] = state === 0 ? HOOP_READY * (1 - HOOP_PULSE * (0.5 + 0.5 * Math.sin(time * 2.4 + i))) : HOOP_GONE;
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

    // Trims, after every body, and the marks.
    for (let i = 0; i < t.count; i++) {
      this.firstTrim[i] = this.n;
      this.firstMark[i] = this.marksN;
      const kind = t.kind[i];
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) this.crateTrim(w, i, time);
      else if (kind === THING_SHRINE) this.shrineTrim(w, i, time);
      else if (kind === THING_GATE) this.gateTrim(w, i, time);
      else if (kind === THING_HOOP) this.hoopTrim(w, i, time);
      else if (kind === THING_TOTEM) this.totemTrim(w, i, time);
      this.trimCount[i] = this.n - this.firstTrim[i];
      this.markCount[i] = this.marksN - this.firstMark[i];
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
    const k = this.marksN;
    this.marks.count = k;
    this.marks.visible = k > 0;
    if (k > 0) {
      uploadFirst(this.marks.instanceMatrix, k);
      uploadFirst(this.markGlow, k);
      if (this.marks.instanceColor) uploadFirst(this.marks.instanceColor, k);
    }
    const b = this.beaconsN;
    this.beacons.count = b;
    this.beacons.visible = b > 0;
    if (b > 0) {
      uploadFirst(this.beacons.instanceMatrix, b);
      uploadFirst(this.beaconFade, b);
      if (this.beacons.instanceColor) uploadFirst(this.beacons.instanceColor, b);
    }
  }

  /** A slot holds a thing the view has not seen before: nothing it remembers of the last one counts. */
  private forget(i: number, lit: number): void {
    // Lit before the view first saw it: no pop.
    this.lastLit[i] = lit;
    for (let k = 0; k < SHRINE_DASHES; k++) this.litAt[i * SHRINE_DASHES + k] = Number.NEGATIVE_INFINITY;
    this.circling[i] = -1;
    this.riderAngle[i] = Number.NaN;
    this.raiseAt[i] = Number.NEGATIVE_INFINITY;
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
    if (look !== -1) bannerTop = this.bannerTop(i, time);
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

  /** Where a gate's banner that is not lowered hangs (its top): rising back up just after a reset. */
  private bannerTop(i: number, time: number): number {
    const p = clamp01((time - this.raiseAt[i]) / RAISE_TIME);
    return BANNER_LOWERED + (POST_HIGH - BANNER_LOWERED) * p * (2 - p);
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
    this.shrineRing(w, i, time);
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

  /** Which way the rider is going round shrine i, from where it was last frame. */
  private watchCircling(w: World, i: number): void {
    const t = w.things;
    const dx = this.riderX - t.x[i];
    const dz = this.riderZ - t.z[i];
    const d2 = dx * dx + dz * dz;
    if (!(d2 < THINGS.shrineFar * THINGS.shrineFar * 2.25) || d2 < 1) {
      this.riderAngle[i] = Number.NaN;
      return;
    }
    const a = Math.atan2(dx, dz);
    const before = this.riderAngle[i];
    this.riderAngle[i] = a;
    if (Number.isNaN(before)) return;
    let da = a - before;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    if (da > 1e-3) this.circling[i] = 1;
    else if (da < -1e-3) this.circling[i] = -1;
  }

  /** How bright the pulse running round shrine i is at segment k, 0 to 1. */
  pulseAt(i: number, k: number, time: number): number {
    const n = SHRINE_DASHES;
    let at = (this.circling[i] * time * PULSE_RATE + i * 3.7) % n;
    if (at < 0) at += n;
    let d = Math.abs(k + 0.5 - at);
    if (d > n / 2) d = n - d;
    return clamp01(1 - d / PULSE_WIDE);
  }

  /** The twelve dashes round a shrine, one per segment of its ring. */
  private shrineRing(w: World, i: number, time: number): void {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const done = t.state[i] === THING_DONE;
    const n = SHRINE_DASHES;
    const lit = done ? (1 << n) - 1 : t.progress[i];
    // The moment each lights: a pop.
    const fresh = lit & ~this.lastLit[i];
    this.lastLit[i] = lit;
    for (let k = 0; k < n; k++) if ((fresh & (1 << k)) !== 0) this.litAt[i * n + k] = time;
    if (!done) this.watchCircling(w, i);
    const opening = done ? this.sinceSpent(i, time) : Number.POSITIVE_INFINITY;
    const step = (Math.PI * 2) / n;
    for (let k = 0; k < n; k++) {
      // Segment k covers atan2(dx, dz) from -PI + k * step (see `shrineSector`); a gap either end.
      const a0 = -Math.PI + (k + 0.16) * step;
      const a1 = -Math.PI + (k + 0.84) * step;
      let r = SHRINE_RING;
      let wide = 0.55;
      let s = slot(THING_SHRINE, T_LIGHT);
      let dim = 1;
      let glow = GLOW_LIT;
      if (done && !(opening < FLASH_TIME)) {
        s = slot(C_SPENT, T_BASE);
        glow = GLOW_SPENT;
        dim = 0.8;
      } else if (done) {
        // Open: the whole ring flashes.
        glow = GLOW_LIT + 0.8 * (0.5 + 0.5 * Math.cos(opening * 18));
        wide = 0.7;
      } else if ((lit & (1 << k)) !== 0) {
        const pop = 1 - clamp01((time - this.litAt[i * n + k]) / POP_TIME);
        wide = 0.55 + 0.5 * pop;
        r += 0.4 * pop;
        glow = GLOW_LIT + 0.6 * pop;
      } else {
        const pulse = this.pulseAt(i, k, time);
        s = slot(THING_SHRINE, T_BASE);
        dim = UNLIT_DIM + (1 - UNLIT_DIM) * 0.5 * pulse;
        glow = GLOW_UNLIT + PULSE_GLOW * pulse;
      }
      this.dash(x + Math.sin(a0) * r, z + Math.cos(a0) * r, x + Math.sin(a1) * r, z + Math.cos(a1) * r, y, wide, s, dim, glow);
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
      const top = look === -1 ? BANNER_LOWERED : this.bannerTop(i, time);
      this.part(x, y, z, yaw, 0, top - BANNER_HIGH / 2, 0, 0, 0, GATE_HALF * 2 + POST_WIDE * 0.5, 0.14, BANNER_DEEP + 0.06, slot(c, T_DARK), dim, glow);
    }
    this.slalomLeg(w, i, gateIdx, time);
  }

  /**
   * The dotted line from gate i to the next gate of its slalom. Waiting, every leg marches from the
   * first gate on; started, the legs behind are lit, the leg into the next gate is lit only for the
   * share of its clock that is left (the dots nearest the rider go out first), and the legs ahead are
   * dim. Spent, grey.
   */
  private slalomLeg(w: World, i: number, gateIdx: number, time: number): void {
    const t = w.things;
    const j = i + 1;
    if (!this.isGateOf(w, j, t.group[i])) return;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const state = t.state[i];
    const done = state === THING_DONE;
    const dx = t.x[j] - x;
    const dz = t.z[j] - z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-3) return;
    const n = DOTS_PER_LEG;
    const half = Math.min(0.45, (len / n) * 0.3) / len;
    // Into the next gate: how many of its dots, from the gate's end, are still lit.
    const left = state === gateIdx + 1 ? Math.ceil((t.timer[i] / THINGS.slalomTicks) * n) : 0;
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      let s = slot(THING_GATE, T_LIGHT);
      let dim = 1;
      let glow = GLOW_LIT;
      let wide = 0.4;
      if (done) {
        s = slot(C_SPENT, T_BASE);
        dim = 0.6;
        glow = GLOW_SPENT;
      } else if (state === 0) {
        // Not started: dots march along the whole line from the first gate.
        const march = 0.5 + 0.5 * Math.sin(time * 7 - (gateIdx * n + k) * 0.7);
        s = slot(THING_GATE, T_BASE);
        dim = UNLIT_DIM + (1 - UNLIT_DIM) * march;
        glow = GLOW_UNLIT + (GLOW_LIT - GLOW_UNLIT) * march * march;
      } else if (gateIdx + 1 === state) {
        // The clock: out from the rider's end toward the gate.
        if (k < n - left) {
          s = slot(THING_GATE, T_BASE);
          dim = UNLIT_DIM;
          glow = GLOW_UNLIT;
        } else wide = 0.5;
      } else if (gateIdx + 1 > state) {
        // Ahead: dim until the rider gets there. (Behind the rider a leg stays lit.)
        s = slot(THING_GATE, T_BASE);
        dim = UNLIT_DIM;
        glow = GLOW_UNLIT;
      }
      const yl = y + (t.y[j] - y) * f;
      this.dash(x + dx * (f - half), z + dz * (f - half), x + dx * (f + half), z + dz * (f + half), yl, wide, s, dim, glow);
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
    if (ready) this.hoopArc(w, i, time, fx, fz);
  }

  /**
   * The height of dot k of hoop i's arc, `(k - ARC_MIDDLE) * ARC_STEP` m along its line from the ring's
   * middle; `arcAir` says whether it is in the air.
   */
  arcPoint(w: World, i: number, k: number): number {
    const t = w.things;
    const x = t.x[i];
    const y = t.y[i];
    const z = t.z[i];
    const fx = Math.sin(t.yaw[i]);
    const fz = Math.cos(t.yaw[i]);
    // Without a terrain, the ramp is level under the ring.
    const ramp = y - THINGS.hoopGap - HOOP_RADIUS;
    const s = (k - ARC_MIDDLE) * ARC_STEP;
    const ground = this.ground(x + fx * s, z + fz * s, ramp) + MARK_LIFT;
    const off = -ARC_TAKEOFF * ARC_STEP;
    this.arcAir = false;
    if (s <= off) return ground;
    // A flight off the ramp that tops out in the ring's middle, landing where it meets the ground.
    const lift = this.ground(x + fx * off, z + fz * off, ramp) + MARK_LIFT;
    const fly = y - ((y - lift) * s * s) / (off * off);
    this.arcAir = fly > ground;
    return this.arcAir ? fly : ground;
  }

  /** The dotted flight of a hoop: up its kicker, off the lip, through the ring, marching the way it is flown. */
  private hoopArc(w: World, i: number, time: number, fx: number, fz: number): void {
    const t = w.things;
    const x = t.x[i];
    const z = t.z[i];
    const s = slot(THING_HOOP, T_LIGHT);
    for (let k = 0; k < ARC_DOTS; k++) {
      const ps = (k - ARC_MIDDLE) * ARC_STEP;
      const py = this.arcPoint(w, i, k);
      const air = this.arcAir;
      const march = 0.5 + 0.5 * Math.sin(time * 6 - k * 0.8 + i);
      const glow = 0.15 + 0.75 * march * march;
      const dim = UNLIT_DIM + (1 - UNLIT_DIM) * march;
      const px = x + fx * ps;
      const pz = z + fz * ps;
      if (air) {
        // A little diamond in the air, along the way of the flight.
        const dy = this.arcPoint(w, i, k + 0.25) - py;
        const d = 0.25 * ARC_STEP;
        this.mark(px - fx * d, py - dy, pz - fz * d, px + fx * d, py + dy, pz + fz * d, 0.3, 0.3, s, dim, glow);
      } else {
        this.dash(px - fx * 0.35, pz - fz * 0.35, px + fx * 0.35, pz + fz * 0.35, py - MARK_LIFT, 0.4, s, dim, glow);
      }
    }
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
    // Waiting, a slow red glow in its eyes (it bites) and a faint ring where it is touched.
    let eyes = slot(C_EYES, T_BASE);
    let eyeGlow = EYES_LOW + (EYES_HIGH - EYES_LOW) * (0.5 + 0.5 * Math.sin(time * 1.6 + i));
    if (!done) {
      const step = (Math.PI * 2) / TOTEM_DASHES;
      for (let k = 0; k < TOTEM_DASHES; k++) {
        const a0 = (k + 0.2) * step;
        const a1 = (k + 0.8) * step;
        this.dash(x + Math.sin(a0) * TOTEM_RING, z + Math.cos(a0) * TOTEM_RING, x + Math.sin(a1) * TOTEM_RING, z + Math.cos(a1) * TOTEM_RING, y, 0.25, slot(THING_TOTEM, T_BASE), 0.7, 0.12);
      }
    }
    if (done) {
      // Called: it shakes with its eyes lit, then sinks into the ground.
      const p = this.sinceSpent(i, time) / CALL_TIME;
      if (!(p < 1)) return;
      shake = 0.09;
      const q = clamp01((p - 0.55) / 0.45);
      sink = q * q * (TOTEM_HIGH + 0.5);
      eyes = slot(C_EYES, T_LIGHT);
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
