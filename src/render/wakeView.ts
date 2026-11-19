/**
 * The Wake: a bed of glow along the trail points with tongues of flame standing on it, as wide as it
 * burns (`2 * FEEL.wakeWidth`, times the build's area), in `PALETTE.wake`, bright at the mover and
 * fading to nothing at the tail.
 *
 * It is a bright core down the middle `WAKE_CORE` of the width with faint edges out to the full
 * width, so close to the camera it reads as a stripe, not a slab.
 *
 * The bed is one mesh and one preallocated buffer: four vertices per point (outer left, core left,
 * core right, outer right), RGBA vertex colours carrying the fade, and a fixed index buffer of
 * quads between neighbouring points. The newest stretch, from the last trail point to the mover, is
 * drawn too, so the ribbon always reaches the feet.
 *
 * The flames are its child, one instanced mesh of low-poly tongues, one on each trail point that
 * burns (not the newest two under the board, which the sim does not burn), each flickering in
 * height and leaning on its own beat, taller toward the mover.
 *
 * The pop: when a loop closes, the sim cuts the trail back to the newest point. The view sees the
 * trail collapse, finds the loop in the trail it drew last frame (the stretch from the point the
 * board came back to, as the sim finds it), and for a moment flashes it: a burst of tall flames in
 * `PALETTE.pop` that runs round the loop from where it closed and dies down. The ring and flash on
 * the ground are `FxView`'s.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, type InstancedBufferAttribute, type InstancedMesh, Mesh } from 'three';
import { FEEL } from '../sim/constants';
import { WAKE_MAX, WAKE_STEP, type Wake } from '../sim/wake';
import { PALETTE, flatMaterial } from './look';
import { addInstanceColor, addInstanceFloat, fadeMaterial, makeInstanced, rgbInto, ShapeBuilder, uploadFirst, writeMatrix } from './fxView';

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
/** The newest trail points do not burn (the sim's head skip): no flames there. */
export const UNBURNT_HEAD = 2;
/** A flame: its height at the mover and its width as a share of the burn's half-width. */
export const FLAME_HEIGHT = 1.05;
const FLAME_WIDE = 1.25;
const FLAME_FADE = 0.6;
/** Flicker: how far a flame's height swings, and its beats, rad/s. */
const FLICKER = 0.3;
const FLICKER_A = 11;
const FLICKER_B = 17;
const LEAN = 0.22;
/** The pop's flash: how long, s, how tall its flames get, m, and how long the flash takes to run round. */
export const POP_LIFE = 0.55;
const POP_HEIGHT = 2.4;
const POP_RUN = 0.14;
/** A trail that collapses from at least this many points to at most `POP_LEFT` has popped. */
const POP_FROM = 6;
const POP_LEFT = 3;
const MAX_FLAMES = RIBBON_POINTS * 2;
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

/**
 * A low-poly tongue of flame standing on the origin, 1 m tall and 1 m across at its foot: a six-sided
 * foot, a narrower twisted waist, a tip off to one side. Vertex colours are brightness only (dim at
 * the foot, hot at the tip); the instance colour gives the hue.
 */
export function flameGeometry(): BufferGeometry {
  const b = new ShapeBuilder();
  const foot: number[] = [];
  const waist: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const w = a + Math.PI / 6;
    foot.push(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
    waist.push(Math.sin(w) * 0.3, 0.45, Math.cos(w) * 0.3);
  }
  const glow = (_x: number, y: number, _z: number, out: Float32Array): void => {
    const v = 0.5 + y * 1.1;
    out[0] = v;
    out[1] = v;
    out[2] = v;
  };
  const tip = [0.08, 1, 0.04];
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    const f0 = k * 3;
    const f1 = j * 3;
    b.tri(foot[f0], foot[f0 + 1], foot[f0 + 2], foot[f1], foot[f1 + 1], foot[f1 + 2], waist[f0], waist[f0 + 1], waist[f0 + 2], glow);
    b.tri(foot[f1], foot[f1 + 1], foot[f1 + 2], waist[f1], waist[f1 + 1], waist[f1 + 2], waist[f0], waist[f0 + 1], waist[f0 + 2], glow);
    b.tri(waist[f0], waist[f0 + 1], waist[f0 + 2], waist[f1], waist[f1 + 1], waist[f1 + 2], tip[0], tip[1], tip[2], glow);
  }
  const g = b.build();
  g.deleteAttribute('aPart');
  return g;
}

export class WakeView {
  readonly mesh: Mesh;
  /** The tongues of flame on the trail and the pop's flash; a child of `mesh`. */
  readonly flames: InstancedMesh;
  private readonly geometry = new BufferGeometry();
  private readonly pos: BufferAttribute;
  private readonly col: BufferAttribute;
  private readonly flameFade: InstancedBufferAttribute;
  private readonly flameRgb: Float32Array;
  private readonly wakeRgb = new Float32Array(3);
  private readonly popRgb = new Float32Array(3);
  /** Ribbon points drawn last frame (0 when nothing is drawn), flames on the trail, and flames of the pop. */
  points = 0;
  trailFlames = 0;
  popFlames = 0;
  // The trail as drawn last frame, to find a loop in when it collapses.
  private readonly lastX = new Float32Array(WAKE_MAX);
  private readonly lastZ = new Float32Array(WAKE_MAX);
  private lastN = 0;
  // The loop being flashed: its points (where it closed first), and how long it has shown, s (< 0: none).
  private readonly popX = new Float32Array(WAKE_MAX + 1);
  private readonly popZ = new Float32Array(WAKE_MAX + 1);
  private popN = 0;
  private popAge = -1;
  private lastTime = Number.NaN;

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

    const flame = flameGeometry();
    this.flameFade = addInstanceFloat(flame, 'aFade', MAX_FLAMES);
    this.flames = makeInstanced(flame, fadeMaterial(0xffffff, true), MAX_FLAMES, 'wake-flames');
    this.flameRgb = addInstanceColor(this.flames, MAX_FLAMES);
    this.flames.renderOrder = 3;
    rgbInto(this.wakeRgb, 0, PALETTE.wake);
    rgbInto(this.popRgb, 0, PALETTE.pop);
    this.mesh.add(this.flames);
  }

  /** Is the pop's flash showing? For tests. */
  get popping(): boolean {
    return this.popAge >= 0;
  }

  /**
   * (hx, hz): where the mover is drawn this frame. `area` is the build's (the trail burns that much
   * wider); `time` in seconds, for the flicker (the page clock if left out).
   */
  update(k: Wake, hx: number, hz: number, heightAt: (x: number, z: number) => number, area = 1, time = performance.now() / 1000): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const half = FEEL.wakeWidth * area;
    this.findPop(k);

    const n = writeWakeRibbon(k, true, hx, hz, half, heightAt, this.pos.array as Float32Array, this.col.array as Float32Array, HEAD_CORE_ALPHA, HEAD_EDGE_ALPHA);
    this.points = n;
    this.geometry.setDrawRange(0, n >= 2 ? (n - 1) * QUADS * 6 : 0);
    if (n >= 2) {
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
    }

    const fm = this.flames.instanceMatrix.array;
    const fade = this.flameFade.array as Float32Array;
    let f = 0;
    // Tongues on the burning part of the trail, taller toward the mover.
    const burning = k.count - UNBURNT_HEAD;
    for (let j = 0; j < burning; j++) {
      const t = burning > 1 ? j / (burning - 1) : 1;
      const x = k.x[j];
      const z = k.z[j];
      const flick = 1 - FLICKER * (0.5 + 0.25 * Math.sin(time * FLICKER_A + j * 2.3) + 0.25 * Math.sin(time * FLICKER_B + j * 1.1));
      const h = FLAME_HEIGHT * (0.3 + 0.7 * t) * flick;
      const wd = half * FLAME_WIDE * (0.45 + 0.55 * t);
      this.flame(fm, f, x, heightAt(x, z), z, wd, h, j * 1.7 + time * 0.8, time * 6 + j);
      this.flameColor(f, this.wakeRgb);
      fade[f++] = FLAME_FADE * Math.sqrt(t);
    }
    this.trailFlames = f;

    // The pop: tall flames in the pop's colour run round the loop from where it closed, then die down.
    this.popFlames = 0;
    if (this.popAge >= 0) {
      this.popAge += dt;
      if (this.popAge >= POP_LIFE) this.popAge = -1;
      else {
        const age = this.popAge;
        for (let j = 0; j < this.popN && f < MAX_FLAMES; j++) {
          const lit = age - (j / Math.max(1, this.popN - 1)) * POP_RUN;
          if (lit < 0) continue;
          const t = Math.min(1, lit / (POP_LIFE - POP_RUN));
          const rise = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
          const x = this.popX[j];
          const z = this.popZ[j];
          this.flame(fm, f, x, heightAt(x, z), z, half * FLAME_WIDE * 1.2, POP_HEIGHT * (0.25 + 0.75 * rise), j * 2.1, time * 9 + j);
          this.flameColor(f, this.popRgb);
          fade[f++] = 0.95 * (1 - t);
          this.popFlames++;
        }
      }
    }

    this.flames.count = f;
    this.flames.visible = f > 0;
    // The flames hang off the bed: it stays up (drawing nothing) while only the pop shows.
    this.mesh.visible = n >= 2 || f > 0;
    if (f > 0) {
      uploadFirst(this.flames.instanceMatrix, f);
      uploadFirst(this.flameFade, f);
      if (this.flames.instanceColor) uploadFirst(this.flames.instanceColor, f);
    }

    const keep = Math.min(WAKE_MAX, k.count);
    for (let j = 0; j < keep; j++) {
      this.lastX[j] = k.x[j];
      this.lastZ[j] = k.z[j];
    }
    this.lastN = keep;
  }

  /** Did the trail collapse since last frame because a loop closed? Then take the loop to flash. */
  private findPop(k: Wake): void {
    const pn = this.lastN;
    if (pn < POP_FROM || k.count < 1 || k.count > POP_LEFT) return;
    // The point the trail starts again from is where the board closed the loop: next to the old head.
    const hx = k.x[k.count - 1];
    const hz = k.z[k.count - 1];
    const ex = hx - this.lastX[pn - 1];
    const ez = hz - this.lastZ[pn - 1];
    const reach = FEEL.wakeCloseDist + 4 * WAKE_STEP;
    if (ex * ex + ez * ez > reach * reach) return;
    // The loop starts at the old point nearest the head that is a loop's length of trail back.
    let path = Math.sqrt(ex * ex + ez * ez);
    let from = -1;
    let best = Infinity;
    for (let j = pn - 1; j > 0; j--) {
      const sx = this.lastX[j] - this.lastX[j - 1];
      const sz = this.lastZ[j] - this.lastZ[j - 1];
      path += Math.sqrt(sx * sx + sz * sz);
      if (path < FEEL.wakeLoopMin) continue;
      const dx = this.lastX[j - 1] - hx;
      const dz = this.lastZ[j - 1] - hz;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        from = j - 1;
      }
    }
    if (from < 0) return;
    let m = 0;
    for (let j = from; j < pn; j++) {
      this.popX[m] = this.lastX[j];
      this.popZ[m] = this.lastZ[j];
      m++;
    }
    this.popX[m] = hx;
    this.popZ[m] = hz;
    this.popN = m + 1;
    this.popAge = 0;
  }

  /** A flame at (x, y, z), `w` across and `h` tall, turned `yaw`, its tip leaning on the beat `beat`. */
  private flame(m: { [i: number]: number }, i: number, x: number, y: number, z: number, w: number, h: number, yaw: number, beat: number): void {
    const c = Math.cos(yaw) * w;
    const s = Math.sin(yaw) * w;
    const lx = Math.sin(beat) * LEAN * h;
    const lz = Math.cos(beat * 0.7) * LEAN * h;
    writeMatrix(m, i, c, 0, -s, lx, h, lz, s, 0, c, x, y, z);
  }

  private flameColor(i: number, rgb: Float32Array): void {
    this.flameRgb[i * 3] = rgb[0];
    this.flameRgb[i * 3 + 1] = rgb[1];
    this.flameRgb[i * 3 + 2] = rgb[2];
  }
}
