/**
 * Zones on the ground, one instanced mesh per kind, each disc tilted to the ground under it:
 *
 * - a mine (`ZONE_MINE`): a small disc in the mine's colour, dim while it arms, blinking once armed;
 * - tar (`ZONE_TAR`): a dark patch as wide as it drags, spreading when it is laid and shrinking
 *   away at the end of its life;
 * - a lob ring (`ZONE_LOB`): an outline where the shot will land, filling in from the middle as its
 *   time runs out, so the moment it lands is the moment it is full;
 * - the Standstill's ring (`ZONE_RING`): a bright band on the ground in `PALETTE.ring` at the front's
 *   radius, following the ground, drawn where the front will be at the frame (it spreads steadily),
 *   so the moment to ollie can be read off it.
 *
 * Also `GroundRings`: wide rings drawn as one strip that follows the ground (elites' auras, shrines'
 * orbits), for the views that need one.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  type InstancedBufferAttribute,
  type InstancedMesh,
  Mesh,
} from 'three';
import type { Terrain } from '../sim/terrain';
import type { Vec3 } from '../sim/types';
import { BOSS } from '../sim/bosses';
import { DT } from '../sim/constants';
import { CRUMBS } from '../sim/weapons/crumbs';
import { MAX_ZONES, ZONE_LOB, ZONE_MINE, ZONE_RING, ZONE_TAR, type World } from '../sim/world';
import { PALETTE, flatMaterial } from './look';
import { addInstanceColor, addInstanceFloat, discMaterial, fadeMaterial, makeInstanced, rgbInto, writeMatrix } from './fxView';

/** A mine's disc radius, m (the blast reaches further; the disc is where it lies). */
export const MINE_SIZE = 0.6;
/** Ticks a blink of an armed mine lasts (on, then off). */
export const MINE_BLINK_TICKS = 12;
/** Strength of an unarmed mine, of an armed one's off beat, and its on beat. */
export const MINE_IDLE = 0.3;
export const MINE_OFF = 0.35;
export const MINE_ON = 1;
/** A lob ring's outline starts at this share of its radius; its fill reaches that far when full. */
export const LOB_INNER = 0.84;
const LOB_CORE_SHARE = 0.45;
const LOB_FADE = 0.9;
/** Tar spreads over this many ticks when laid and shrinks over the last `TAR_SHRINK` of its life. */
const TAR_GROW = 12;
const TAR_SHRINK = 30;
/** Heights above the ground, m. */
const MINE_LIFT = 0.08;
const TAR_LIFT = 0.04;
const LOB_LIFT = 0.12;
const RING_LIFT = 0.18;
/** The Standstill's ring: how wide its band is, m (behind the front), its strength, and how many at once. */
export const RING_BAND = 0.7;
const RING_FADE = 1;
const RING_SEGMENTS = 96;
export const MAX_RINGS = 4;

/** Columns of a disc of radius r lying on ground of unit normal n, into slot i. */
function groundDisc(m: { [i: number]: number }, i: number, n: Vec3, r: number, x: number, y: number, z: number): void {
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
  writeMatrix(m, i, ax * r, ay * r, 0, n.x, n.y, n.z, cx * r, cy * r, cz * r, x, y, z);
}

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

export class ZonesView {
  readonly object = new Group();
  readonly mines: InstancedMesh;
  readonly tar: InstancedMesh;
  readonly lobs: InstancedMesh;
  /** The Standstill's rings. */
  readonly rings: GroundRings;
  private readonly ringRgb = new Float32Array(3);
  private readonly terrain: Terrain | null;
  private readonly mineDisc: InstancedBufferAttribute;
  private readonly lobDisc: InstancedBufferAttribute;
  private readonly normal: Vec3 = { x: 0, y: 1, z: 0 };

  /** Without a terrain the ground is taken as level at each zone's height. */
  constructor(terrain: Terrain | null = null) {
    this.terrain = terrain;
    this.object.name = 'zones';

    const mineGeo = new CircleGeometry(1, 12);
    mineGeo.rotateX(-Math.PI / 2);
    this.mineDisc = addInstanceFloat(mineGeo, 'aDisc', MAX_ZONES, 3);
    this.mines = makeInstanced(mineGeo, discMaterial(0), MAX_ZONES, 'zones-mines');
    const mineCol = addInstanceColor(this.mines, MAX_ZONES);
    for (let i = 0; i < MAX_ZONES; i++) rgbInto(mineCol, i * 3, PALETTE.zones[ZONE_MINE]);

    const tarGeo = new CircleGeometry(1, 14);
    tarGeo.rotateX(-Math.PI / 2);
    const tarMat = flatMaterial(PALETTE.zones[ZONE_TAR]);
    tarMat.polygonOffset = true;
    tarMat.polygonOffsetFactor = -1;
    tarMat.polygonOffsetUnits = -1;
    this.tar = makeInstanced(tarGeo, tarMat, MAX_ZONES, 'zones-tar');

    const lobGeo = new CircleGeometry(1, 32);
    lobGeo.rotateX(-Math.PI / 2);
    this.lobDisc = addInstanceFloat(lobGeo, 'aDisc', MAX_ZONES, 3);
    this.lobs = makeInstanced(lobGeo, discMaterial(LOB_CORE_SHARE), MAX_ZONES, 'zones-lobs');
    const lobCol = addInstanceColor(this.lobs, MAX_ZONES);
    for (let i = 0; i < MAX_ZONES; i++) rgbInto(lobCol, i * 3, PALETTE.zones[ZONE_LOB]);

    this.rings = new GroundRings(MAX_RINGS, RING_SEGMENTS, 'zones-rings', terrain, RING_LIFT);
    rgbInto(this.ringRgb, 0, PALETTE.ring);

    this.tar.renderOrder = 1;
    this.mines.renderOrder = 2;
    this.lobs.renderOrder = 2;
    this.object.add(this.tar, this.mines, this.lobs, this.rings.mesh);
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

  /** `alpha` (0..1) is how far the frame is from the previous tick to the latest. */
  update(w: World, alpha = 1): void {
    const zn = w.zones;
    this.rings.begin();
    const mm = this.mines.instanceMatrix.array;
    const tm = this.tar.instanceMatrix.array;
    const lm = this.lobs.instanceMatrix.array;
    const md = this.mineDisc.array as Float32Array;
    const ld = this.lobDisc.array as Float32Array;
    let mines = 0;
    let tar = 0;
    let lobs = 0;
    for (let i = 0; i < zn.count; i++) {
      const kind = zn.kind[i];
      const x = zn.x[i];
      const y = zn.y[i];
      const z = zn.z[i];
      const age = zn.age[i];
      const life = zn.life[i];
      if (kind === ZONE_MINE) {
        const n = this.groundNormal(x, z);
        groundDisc(mm, mines, n, MINE_SIZE, x + n.x * MINE_LIFT, y + n.y * MINE_LIFT, z + n.z * MINE_LIFT);
        md[mines * 3] = 0;
        md[mines * 3 + 1] = 0;
        md[mines * 3 + 2] = mineStrength(age);
        mines++;
      } else if (kind === ZONE_TAR) {
        const n = this.groundNormal(x, z);
        const grow = Math.min(1, age / TAR_GROW) * Math.min(1, life / TAR_SHRINK);
        groundDisc(tm, tar, n, zn.r[i] * grow, x + n.x * TAR_LIFT, y + n.y * TAR_LIFT, z + n.z * TAR_LIFT);
        tar++;
      } else if (kind === ZONE_LOB) {
        const n = this.groundNormal(x, z);
        groundDisc(lm, lobs, n, zn.r[i], x + n.x * LOB_LIFT, y + n.y * LOB_LIFT, z + n.z * LOB_LIFT);
        ld[lobs * 3] = LOB_INNER;
        ld[lobs * 3 + 1] = LOB_INNER * lobFill(age, life);
        ld[lobs * 3 + 2] = LOB_FADE;
        lobs++;
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
