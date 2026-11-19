/**
 * What a boss is about to do, drawn on the ground so the player can dodge it:
 *
 * - The Bruiser's charge lane: from the start of its tell, a lane on the ground from the Bruiser
 *   along its aim, as wide as the Bruiser and `BOSS.bruiser.chargeFar` long, following the terrain.
 *   The whole lane shows faintly at once; a bright part fills along it over the tell, so its end is
 *   reached the moment the charge starts. It holds at full (from where the charge began) while the
 *   Bruiser charges and is gone when the charge ends. In `PALETTE.bosses[0]`.
 * - The Standstill's slow: a disc on the ground under it, `BOSS.standstill.auraReach` in radius,
 *   following it and the ground: a faint fill and a clear edge, in `PALETTE.bosses[2]`, quiet
 *   enough that its rings (`PALETTE.ring`, drawn after) stand out on it.
 *
 * Reads the world only. Where the lane lies is the pure `laneOf`. Nothing allocates after
 * construction.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh } from 'three';
import { BOSS, BRUISER_CHARGE, BRUISER_TELL, findBoss } from '../sim/bosses';
import { DT, TICK_HZ } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import { KIND_BRUISER, KIND_STANDSTILL, KINDS, type World } from '../sim/world';
import { fadeMaterial, rgbInto } from './fxView';
import { PALETTE } from './look';
import { GroundRings } from './zonesView';

/** Ticks the Bruiser's tell lasts, as the sim counts them. */
export const TELL_TICKS = Math.round(BOSS.bruiser.tell * TICK_HZ);
/** The lane: as wide as the Bruiser, as long as its longest charge, m. */
export const LANE_WIDTH = 2 * KINDS[KIND_BRUISER].radius;
export const LANE_LENGTH = BOSS.bruiser.chargeFar;
/** Rows along the lane, per strip (the lit part and the rest each get this many). */
export const LANE_ROWS = 40;
/** Across the lane: rim, fill, centre, fill, rim, as a share of half its width. */
const LANE_ACROSS = [-1, -0.72, 0, 0.72, 1] as const;
const LANE_COLS = LANE_ACROSS.length;
/** Strength of the lit part's rim and fill; of the part still to fill; while it charges. */
const LIT_RIM = 1;
const LIT_FILL = 0.5;
const REST_RIM = 0.4;
const REST_FILL = 0.1;
/** Height above the ground, m: under the enemies, over the ground's lines. */
const LANE_LIFT = 0.1;

/** The slow's disc: bands of fill out to its edge, the edge's width, and their strengths. */
export const AURA_BANDS = 4;
export const AURA_EDGE = 0.45;
const AURA_FILL = 0.1;
const AURA_RIM = 0.8;
const AURA_SEGMENTS = 72;
const AURA_LIFT = 0.06;

/** Where the Bruiser's lane lies this frame. */
export interface Lane {
  /** False when there is no lane (no Bruiser, or it walks or rests). */
  on: boolean;
  /** Where it starts, and the unit way it runs along the ground. */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** Its whole length, m, and how much of it is lit, m (all of it during the charge). */
  length: number;
  lit: number;
}

export function makeLane(): Lane {
  return { on: false, x: 0, z: 0, dirX: 0, dirZ: 1, length: 0, lit: 0 };
}

/**
 * The lane for a Bruiser in phase `state`, `timer` ticks into it, drawn `alpha` (0..1) of the way
 * from the previous tick to the latest. During the tell it starts at the Bruiser (bx, bz) and its lit
 * part grows with the tell, reaching the whole length as the charge starts; during the charge it
 * starts where the charge began (fromX, fromZ) and is lit to the end. Otherwise there is none.
 */
export function laneOf(
  state: number,
  timer: number,
  alpha: number,
  bx: number,
  bz: number,
  fromX: number,
  fromZ: number,
  aimX: number,
  aimZ: number,
  out: Lane,
): Lane {
  if (state !== BRUISER_TELL && state !== BRUISER_CHARGE) {
    out.on = false;
    out.length = 0;
    out.lit = 0;
    return out;
  }
  out.on = true;
  out.dirX = aimX;
  out.dirZ = aimZ;
  out.length = LANE_LENGTH;
  if (state === BRUISER_TELL) {
    out.x = bx;
    out.z = bz;
    const f = (timer + Math.min(1, Math.max(0, alpha))) / TELL_TICKS;
    out.lit = LANE_LENGTH * Math.min(1, Math.max(0, f));
  } else {
    out.x = fromX;
    out.z = fromZ;
    out.lit = LANE_LENGTH;
  }
  return out;
}

export class BossView {
  readonly object = new Group();
  /** The Bruiser's lane: two strips (the lit part, then the rest) in one mesh. */
  readonly lane: Mesh;
  /** The Standstill's slow. */
  readonly aura: GroundRings;
  /** The lane as last drawn, for tests. */
  readonly laneNow: Lane = makeLane();
  private readonly terrain: Terrain | null;
  private readonly positions: Float32Array;
  private readonly fades: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly fadeAttr: BufferAttribute;
  private readonly auraRgb = new Float32Array(3);

  /** Without a terrain the ground is taken as level at the boss's height. */
  constructor(terrain: Terrain | null = null) {
    this.terrain = terrain;
    this.object.name = 'bosses';

    const rows = LANE_ROWS + 1;
    const verts = 2 * rows * LANE_COLS;
    this.positions = new Float32Array(verts * 3);
    this.fades = new Float32Array(verts);
    const index = new Uint16Array(2 * LANE_ROWS * (LANE_COLS - 1) * 6);
    let k = 0;
    for (let strip = 0; strip < 2; strip++) {
      const base = strip * rows * LANE_COLS;
      for (let r = 0; r < LANE_ROWS; r++) {
        for (let c = 0; c < LANE_COLS - 1; c++) {
          const a = base + r * LANE_COLS + c;
          const b = a + LANE_COLS;
          index[k++] = a;
          index[k++] = b;
          index[k++] = a + 1;
          index[k++] = a + 1;
          index[k++] = b;
          index[k++] = b + 1;
        }
      }
    }
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(DynamicDrawUsage);
    this.fadeAttr = new BufferAttribute(this.fades, 1);
    this.fadeAttr.setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aFade', this.fadeAttr);
    g.setIndex(new BufferAttribute(index, 1));
    const mat = fadeMaterial(PALETTE.bosses[0]);
    mat.side = DoubleSide;
    this.lane = new Mesh(g, mat);
    this.lane.name = 'boss-lane';
    this.lane.frustumCulled = false;
    this.lane.visible = false;
    this.lane.renderOrder = 1;

    this.aura = new GroundRings(AURA_BANDS + 1, AURA_SEGMENTS, 'boss-aura', terrain, AURA_LIFT);
    this.aura.mesh.renderOrder = 1;
    rgbInto(this.auraRgb, 0, PALETTE.bosses[KIND_STANDSTILL - KIND_BRUISER]);

    this.object.add(this.lane, this.aura.mesh);
  }

  /** `alpha` (0..1) is how far the frame is from the previous tick to the latest. */
  update(w: World, alpha = 1): void {
    const i = findBoss(w);
    const h = w.horde;
    const kind = i >= 0 ? h.kind[i] : -1;
    const back = (1 - Math.min(1, Math.max(0, alpha))) * DT;

    const lane = this.laneNow;
    if (kind === KIND_BRUISER) {
      const b = w.boss;
      laneOf(h.state[i], h.timer[i], alpha, h.x[i] - h.vx[i] * back, h.z[i] - h.vz[i] * back, b.fromX, b.fromZ, b.aimX, b.aimZ, lane);
    } else {
      lane.on = false;
      lane.length = 0;
      lane.lit = 0;
    }
    if (lane.on) this.layLane(lane, i >= 0 ? h.y[i] : 0);
    this.lane.visible = lane.on;

    this.aura.begin();
    if (kind === KIND_STANDSTILL) {
      const x = h.x[i] - h.vx[i] * back;
      const z = h.z[i] - h.vz[i] * back;
      const y = h.y[i];
      const reach = BOSS.standstill.auraReach;
      const fillTo = reach - AURA_EDGE;
      for (let k = 0; k < AURA_BANDS; k++) {
        this.aura.add(x, y, z, (fillTo * k) / AURA_BANDS, (fillTo * (k + 1)) / AURA_BANDS, this.auraRgb, 0, AURA_FILL);
      }
      this.aura.add(x, y, z, fillTo, reach, this.auraRgb, 0, AURA_RIM);
    }
    this.aura.end();
  }

  /** Two strips along the lane: [0, lit] bright, [lit, length] faint. */
  private layLane(lane: Lane, y: number): void {
    const t = this.terrain;
    const half = LANE_WIDTH * 0.5;
    // Across the lane, to its right as it runs.
    const px = lane.dirZ;
    const pz = -lane.dirX;
    const rows = LANE_ROWS + 1;
    const charging = lane.lit >= lane.length;
    for (let strip = 0; strip < 2; strip++) {
      const s0 = strip === 0 ? 0 : lane.lit;
      const s1 = strip === 0 ? lane.lit : lane.length;
      const rim = strip === 0 ? LIT_RIM : REST_RIM;
      const fill = strip === 0 ? LIT_FILL : REST_FILL;
      // A strip of no length is laid flat at its start and adds nothing.
      const empty = s1 - s0 <= 1e-4;
      for (let r = 0; r < rows; r++) {
        const s = s0 + ((s1 - s0) * r) / LANE_ROWS;
        const cx = lane.x + lane.dirX * s;
        const cz = lane.z + lane.dirZ * s;
        for (let c = 0; c < LANE_COLS; c++) {
          const a = LANE_ACROSS[c];
          const x = cx + px * a * half;
          const z = cz + pz * a * half;
          const v = (strip * rows + r) * LANE_COLS + c;
          const p = v * 3;
          this.positions[p] = x;
          this.positions[p + 1] = (t ? t.heightAt(x, z) : y) + LANE_LIFT;
          this.positions[p + 2] = z;
          const edge = c === 0 || c === LANE_COLS - 1;
          this.fades[v] = empty ? 0 : edge ? rim : charging ? fill * 1.2 : fill;
        }
      }
    }
    this.posAttr.needsUpdate = true;
    this.fadeAttr.needsUpdate = true;
  }
}
