/**
 * The things on the map, whatever placed them in `w.things`:
 *
 * - crate: a brown box; gold crate: a bigger gold box that glows, turns and bobs. Spent, either is a
 *   low slab of grey debris.
 * - shrine: a pale pillar with a turning diamond on top, and a ring on the ground at the middle of
 *   the band it is ridden round in, lit round by `progress` (laps of `SHRINE_LAPS`). Spent: a grey
 *   stump and a faint ring.
 * - gate: two posts and a bar across, facing along the slalom. The next gate of its slalom (its
 *   place in the group equals `state`) is bright, the gates still to come are dim, the cleared ones
 *   grey; spent, the posts are grey stumps.
 * - hoop: a ring in the air facing its `yaw`; faint while it is waiting to come back.
 * - totem: a tall pink marker with a turning diamond at the top; spent, a grey stump.
 *
 * Solids are boxes in one instanced mesh, hoops are one more, and the shrines' rings one strip:
 * three draw calls for every thing on the map.
 */
import { BoxGeometry, Group, type InstancedBufferAttribute, type InstancedMesh, TorusGeometry } from 'three';
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
import { PALETTE } from './look';
import { addInstanceColor, addInstanceFloat, fadeMaterial, makeInstanced, rgbInto, tintMaterial, uploadFirst, writeMatrix } from './fxView';
import { GroundRings } from './zonesView';

/** From the map's rules: the shrine's band, its laps, and a gate's half-width, m. */
export const SHRINE_INNER = THINGS.shrineInner;
export const SHRINE_OUTER = THINGS.shrineOuter;
export const SHRINE_LAPS = THINGS.shrineLaps;
export const GATE_HALF = THINGS.gateHalf;
/** A hoop is taken within this of its middle: drawn that big, m. */
export const HOOP_RADIUS = THINGS.hoopReach;

/** Most boxes one thing is drawn with. */
const SOLIDS_PER_THING = 3;
export const MAX_SOLIDS = MAX_THINGS * SOLIDS_PER_THING;

const CRATE_SIZE = 1.2;
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
const POST_WIDE = 0.25;
export const POST_HIGH = 2.4;
const BAR_THICK = 0.22;
const GATE_STUMP = 0.7;
const TOTEM_WIDE = 0.5;
export const TOTEM_HIGH = 3.2;
const TOTEM_STUMP = 0.9;
const HOOP_TUBE = 0.12;

/** Glow of each look, and how much of its colour a dim gate keeps. */
export const GLOW_CRATE = 0.12;
export const GLOW_GOLD = 0.5;
export const GLOW_SHRINE = 0.45;
export const GLOW_GATE_NEXT = 0.35;
export const GLOW_GATE = 0.12;
export const GLOW_TOTEM = 0.4;
export const GLOW_SPENT = 0;
const GATE_DIM = 0.55;
const SPENT_DIM = 0.7;
/** Hoop strength waiting, and while it is gone. */
export const HOOP_READY = 0.9;
export const HOOP_GONE = 0.15;
/** The shrine ring: band width, strength, the unlit part's share of it, and when spent. */
const RING_BAND = 0.7;
const RING_FADE = 0.8;
const RING_DIM = 0.25;
const RING_SPENT = 0.15;
const RING_LIFT = 0.15;
const RING_SEGMENTS = 96;
const MAX_SHRINES = 8;

// Colour slots in the table: the six things, then spent grey.
const C_SPENT = 6;

export class ThingsView {
  readonly object = new Group();
  /** Crates, pillars, posts and bars, markers: boxes. */
  readonly solids: InstancedMesh;
  readonly hoops: InstancedMesh;
  /** Shrines' orbit rings. */
  readonly rings: GroundRings;
  /** For each thing drawn last frame, its first box in `solids` and how many it has. */
  readonly firstSolid = new Int32Array(MAX_THINGS);
  readonly solidCount = new Uint8Array(MAX_THINGS);
  /** For each thing drawn last frame, its hoop instance, or -1. */
  readonly hoopOf = new Int32Array(MAX_THINGS);
  private readonly glow: InstancedBufferAttribute;
  private readonly hoopFade: InstancedBufferAttribute;
  private readonly solidRgb: Float32Array;
  private readonly hoopRgb: Float32Array;
  private readonly table = new Float32Array(7 * 3);
  private n = 0;

  /** With a terrain, the shrines' rings follow the ground. */
  constructor(terrain: Terrain | null = null) {
    this.object.name = 'things';
    const box = new BoxGeometry(1, 1, 1);
    this.glow = addInstanceFloat(box, 'aGlow', MAX_SOLIDS);
    this.solids = makeInstanced(box, tintMaterial(), MAX_SOLIDS, 'things-solids');
    this.solidRgb = addInstanceColor(this.solids, MAX_SOLIDS);

    const torus = new TorusGeometry(HOOP_RADIUS, HOOP_TUBE, 6, 20);
    this.hoopFade = addInstanceFloat(torus, 'aFade', MAX_THINGS);
    this.hoops = makeInstanced(torus, fadeMaterial(0xffffff), MAX_THINGS, 'things-hoops');
    this.hoopRgb = addInstanceColor(this.hoops, MAX_THINGS);

    this.rings = new GroundRings(MAX_SHRINES, RING_SEGMENTS, 'things-rings', terrain, RING_LIFT);

    for (let k = 0; k < 6; k++) rgbInto(this.table, k * 3, PALETTE.things[k]);
    rgbInto(this.table, C_SPENT * 3, PALETTE.gears[0], SPENT_DIM);
    this.object.add(this.solids, this.hoops, this.rings.mesh);
  }

  /**
   * One box: centred at (x, y, z), sized (sx, sy, sz), turned to `yaw` and tilted by `tilt` about its
   * own forward axis (a quarter turn makes a diamond), in colour slot `c` times `dim`.
   */
  private box(x: number, y: number, z: number, yaw: number, tilt: number, sx: number, sy: number, sz: number, c: number, dim: number, glow: number): void {
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
    const t = this.table;
    this.solidRgb[i * 3] = t[c * 3] * dim;
    this.solidRgb[i * 3 + 1] = t[c * 3 + 1] * dim;
    this.solidRgb[i * 3 + 2] = t[c * 3 + 2] * dim;
    (this.glow.array as Float32Array)[i] = glow;
  }

  /** Is thing j a gate of slalom `group`? */
  private isGateOf(w: World, j: number, group: number): boolean {
    const t = w.things;
    return j >= 0 && j < t.count && t.kind[j] === THING_GATE && t.group[j] === group;
  }

  /** `time` in seconds, for what turns and bobs. */
  update(w: World, time: number): void {
    const t = w.things;
    this.n = 0;
    this.rings.begin();
    let hoops = 0;
    const hm = this.hoops.instanceMatrix.array;
    const hf = this.hoopFade.array as Float32Array;
    let gateIdx = 0;
    for (let i = 0; i < t.count; i++) {
      const kind = t.kind[i];
      const x = t.x[i];
      const y = t.y[i];
      const z = t.z[i];
      const yaw = t.yaw[i];
      const state = t.state[i];
      const done = state === THING_DONE;
      this.firstSolid[i] = this.n;
      this.hoopOf[i] = -1;
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) {
        if (done) this.box(x, y + DEBRIS_HIGH / 2, z, yaw, 0, DEBRIS_WIDE, DEBRIS_HIGH, DEBRIS_WIDE, C_SPENT, kind === THING_GOLD_CRATE ? 1.2 : 1, GLOW_SPENT);
        else if (kind === THING_CRATE) this.box(x, y + CRATE_SIZE / 2, z, yaw, 0, CRATE_SIZE, CRATE_SIZE, CRATE_SIZE, THING_CRATE, 1, GLOW_CRATE);
        else {
          const bob = GOLD_BOB * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 0.6 + i));
          const spin = yaw + time * GOLD_SPIN * Math.PI * 2;
          this.box(x, y + GOLD_SIZE / 2 + bob, z, spin, 0, GOLD_SIZE, GOLD_SIZE, GOLD_SIZE, THING_GOLD_CRATE, 1, GLOW_GOLD);
        }
      } else if (kind === THING_SHRINE) {
        const mid = (SHRINE_INNER + SHRINE_OUTER) / 2;
        if (done) {
          this.box(x, y + STUMP_HIGH / 2, z, yaw, 0, PILLAR_WIDE, STUMP_HIGH, PILLAR_WIDE, C_SPENT, 1, GLOW_SPENT);
          this.rings.add(x, y, z, mid - RING_BAND / 2, mid + RING_BAND / 2, this.table, THING_SHRINE * 3, RING_SPENT);
        } else {
          this.box(x, y + PILLAR_HIGH / 2, z, yaw, 0, PILLAR_WIDE, PILLAR_HIGH, PILLAR_WIDE, THING_SHRINE, 1, GLOW_SHRINE);
          const spin = time * CAP_SPIN * Math.PI * 2;
          this.box(x, y + PILLAR_HIGH + CAP_SIZE * 0.75, z, spin, Math.PI / 4, CAP_SIZE, CAP_SIZE, CAP_SIZE, THING_SHRINE, 1, GLOW_SHRINE);
          const fill = Math.min(1, Math.max(0, t.progress[i] / SHRINE_LAPS));
          this.rings.add(x, y, z, mid - RING_BAND / 2, mid + RING_BAND / 2, this.table, THING_SHRINE * 3, RING_FADE, fill, RING_DIM);
        }
      } else if (kind === THING_GATE) {
        // Its place in its slalom: gates of one slalom are contiguous and share a group.
        gateIdx = i > 0 && t.kind[i - 1] === THING_GATE && t.group[i - 1] === t.group[i] ? gateIdx + 1 : 0;
        const ax = Math.cos(yaw);
        const az = -Math.sin(yaw);
        if (done) {
          for (let e = -1; e <= 1; e += 2) {
            this.box(x + ax * GATE_HALF * e, y + GATE_STUMP / 2, z + az * GATE_HALF * e, yaw, 0, POST_WIDE, GATE_STUMP, POST_WIDE, C_SPENT, 1, GLOW_SPENT);
          }
        } else {
          let c = THING_GATE;
          let dim = GATE_DIM;
          let glow = GLOW_GATE;
          if (state === gateIdx) {
            dim = 1;
            glow = GLOW_GATE_NEXT;
          } else if (gateIdx < state && this.isGateOf(w, i - gateIdx + state, t.group[i])) {
            // Already cleared on this run of the slalom (`state` names a gate of this slalom; any
            // other value, such as waiting after a miss, leaves every gate looking ready).
            c = C_SPENT;
            dim = 1;
            glow = GLOW_SPENT;
          }
          for (let e = -1; e <= 1; e += 2) {
            this.box(x + ax * GATE_HALF * e, y + POST_HIGH / 2, z + az * GATE_HALF * e, yaw, 0, POST_WIDE, POST_HIGH, POST_WIDE, c, dim, glow);
          }
          this.box(x, y + POST_HIGH - BAR_THICK / 2, z, yaw, 0, GATE_HALF * 2 + POST_WIDE, BAR_THICK, BAR_THICK, c, dim, glow);
        }
      } else if (kind === THING_HOOP) {
        // The torus lies across its local z: turned to `yaw`, it faces along the way it is flown.
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        writeMatrix(hm, hoops, c, 0, -s, 0, 1, 0, s, 0, c, x, y, z);
        hf[hoops] = state === 0 ? HOOP_READY : HOOP_GONE;
        rgbInto(this.hoopRgb, hoops * 3, PALETTE.things[THING_HOOP]);
        this.hoopOf[i] = hoops;
        hoops++;
      } else if (kind === THING_TOTEM) {
        if (done) this.box(x, y + TOTEM_STUMP / 2, z, yaw, 0, TOTEM_WIDE, TOTEM_STUMP, TOTEM_WIDE, C_SPENT, 1, GLOW_SPENT);
        else {
          this.box(x, y + TOTEM_HIGH / 2, z, yaw, 0, TOTEM_WIDE, TOTEM_HIGH, TOTEM_WIDE, THING_TOTEM, 1, GLOW_TOTEM);
          const spin = -time * CAP_SPIN * Math.PI * 2;
          this.box(x, y + TOTEM_HIGH + CAP_SIZE * 0.8, z, spin, Math.PI / 4, CAP_SIZE * 1.1, CAP_SIZE * 1.1, CAP_SIZE * 1.1, THING_TOTEM, 1, GLOW_TOTEM);
        }
      }
      this.solidCount[i] = this.n - this.firstSolid[i];
    }

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
    this.rings.end();
  }
}
