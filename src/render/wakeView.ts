/**
 * The Wake: a ribbon along the trail points, as wide as it burns (`2 * FEEL.wakeWidth`), laid just
 * above the ground in `PALETTE.wake`, bright at the mover and fading to nothing at the tail.
 *
 * It is a bright core down the middle `WAKE_CORE` of the width with faint edges out to the full
 * width, so close to the camera it reads as a stripe, not a slab.
 *
 * One mesh, one draw call, one preallocated buffer: four vertices per point (outer left, core left,
 * core right, outer right), RGBA vertex colours carrying the fade, and a fixed index buffer of
 * quads between neighbouring points. The newest stretch, from the last trail point to the mover, is drawn too, so
 * the ribbon always reaches the feet.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh } from 'three';
import { FEEL } from '../sim/constants';
import { WAKE_MAX, type Wake } from '../sim/wake';
import { PALETTE, flatMaterial } from './look';

/** Trail points plus the mover. */
export const RIBBON_POINTS = WAKE_MAX + 1;
/** Height of the ribbon above the ground, m. */
export const WAKE_LIFT = 0.07;
/** The mover is drawn as an extra point only if it is at least this far past the last one, m. */
const HEAD_MIN = 0.05;
const WAKE_GLOW = 0.45;
/** Share of the full width taken by the bright core, centred on the trail. */
export const WAKE_CORE = 0.4;
/** Alpha at the head, in the core and at the outer edges: the trail stays under the mover. */
export const HEAD_CORE_ALPHA = 0.5;
export const HEAD_EDGE_ALPHA = 0.15;
/** Vertices per ribbon point. */
const ACROSS = 4;
/** Quads between neighbouring points: left edge, core, right edge. */
const QUADS = ACROSS - 1;

/**
 * Fill `pos` (xyz per vertex) and `col` (rgba per vertex) with the ribbon for the trail, plus the
 * head at (hx, hz) if `withHead`. Vertex 2j is left of point j (looking along the trail toward the
 * mover), 2j + 1 right of it; points run oldest first. Alpha is 0 at the tail and `alphaMax` at
 * the head.
 * Returns the number of ribbon points written; fewer than 2 means there is nothing to draw (0).
 */
export function writeWakeRibbon(
  k: Wake,
  withHead: boolean,
  hx: number,
  hz: number,
  halfWidth: number,
  heightAt: (x: number, z: number) => number,
  pos: Float32Array,
  col: Float32Array,
  coreAlpha = 1,
  edgeAlpha = coreAlpha,
): number {
  let n = k.count;
  if (withHead && n > 0) {
    const dx = hx - k.x[n - 1];
    const dz = hz - k.z[n - 1];
    if (dx * dx + dz * dz > HEAD_MIN * HEAD_MIN) n++;
  }
  if (n < 2) return 0;
  const last = n - 1;
  for (let j = 0; j < n; j++) {
    const a = j > 0 ? j - 1 : 0;
    const b = j < last ? j + 1 : last;
    const ax = a < k.count ? k.x[a] : hx;
    const az = a < k.count ? k.z[a] : hz;
    const bx = b < k.count ? k.x[b] : hx;
    const bz = b < k.count ? k.z[b] : hz;
    const px = j < k.count ? k.x[j] : hx;
    const pz = j < k.count ? k.z[j] : hz;
    let tx = bx - ax;
    let tz = bz - az;
    const tl = Math.sqrt(tx * tx + tz * tz);
    if (tl > 1e-6) {
      tx /= tl;
      tz /= tl;
    } else {
      tx = 0;
      tz = 1;
    }
    // Left of the direction of travel: turning left from +z is toward +x (as the mover's heading
    // does), so left of (tx, tz) is (tz, -tx).
    const lx = tz * halfWidth;
    const lz = -tx * halfWidth;
    const y = heightAt(px, pz) + WAKE_LIFT;
    const o = j * ACROSS * 3;
    const cx = lx * WAKE_CORE;
    const cz = lz * WAKE_CORE;
    pos[o] = px + lx;
    pos[o + 1] = y;
    pos[o + 2] = pz + lz;
    pos[o + 3] = px + cx;
    pos[o + 4] = y;
    pos[o + 5] = pz + cz;
    pos[o + 6] = px - cx;
    pos[o + 7] = y;
    pos[o + 8] = pz - cz;
    pos[o + 9] = px - lx;
    pos[o + 10] = y;
    pos[o + 11] = pz - lz;
    const fade = j / last;
    const c = j * ACROSS * 4;
    for (let v = 0; v < ACROSS; v++) {
      const q = c + v * 4;
      col[q] = 1;
      col[q + 1] = 1;
      col[q + 2] = 1;
      col[q + 3] = fade * (v === 1 || v === 2 ? coreAlpha : edgeAlpha);
    }
  }
  return n;
}

export class WakeView {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly pos: BufferAttribute;
  private readonly col: BufferAttribute;
  /** Ribbon points drawn last frame (0 when nothing is drawn). */
  points = 0;

  constructor() {
    this.pos = new BufferAttribute(new Float32Array(RIBBON_POINTS * ACROSS * 3), 3);
    this.col = new BufferAttribute(new Float32Array(RIBBON_POINTS * ACROSS * 4), 4);
    this.pos.setUsage(DynamicDrawUsage);
    this.col.setUsage(DynamicDrawUsage);
    const index = new Uint16Array((RIBBON_POINTS - 1) * QUADS * 6);
    for (let j = 0; j < RIBBON_POINTS - 1; j++) {
      for (let q = 0; q < QUADS; q++) {
        const v = j * ACROSS + q;
        const o = (j * QUADS + q) * 6;
        // Wound to face up.
        index[o] = v;
        index[o + 1] = v + 1;
        index[o + 2] = v + ACROSS;
        index[o + 3] = v + 1;
        index[o + 4] = v + ACROSS + 1;
        index[o + 5] = v + ACROSS;
      }
    }
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('color', this.col);
    this.geometry.setDrawRange(0, 0);

    const mat = flatMaterial(PALETTE.wake, true);
    mat.emissive.setHex(PALETTE.wake);
    mat.emissiveIntensity = WAKE_GLOW;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = DoubleSide;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    this.mesh = new Mesh(this.geometry, mat);
    this.mesh.name = 'wake';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
  }

  /** (hx, hz): where the mover is drawn this frame. */
  update(k: Wake, hx: number, hz: number, heightAt: (x: number, z: number) => number): void {
    const n = writeWakeRibbon(k, true, hx, hz, FEEL.wakeWidth, heightAt, this.pos.array as Float32Array, this.col.array as Float32Array, HEAD_CORE_ALPHA, HEAD_EDGE_ALPHA);
    this.points = n;
    this.mesh.visible = n >= 2;
    this.geometry.setDrawRange(0, n >= 2 ? (n - 1) * QUADS * 6 : 0);
    if (n >= 2) {
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
    }
  }
}
