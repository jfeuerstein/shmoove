/**
 * Shots: one instanced mesh for every kind, each drawn where it is between the last two ticks
 * (extrapolated back from the latest by its velocity, as the world is not interpolated).
 *
 * - a dart (`SHOT_DART`, the Seekers): a short bright streak in `PALETTE.shot`, aligned to its
 *   velocity;
 * - a stone (`SHOT_STONE`, the Skipper): a flat, wide, spinning pebble in `PALETTE.stone`, so a
 *   stream of stones never reads as darts.
 */
import { BoxGeometry, type InstancedBufferAttribute, type InstancedMesh } from 'three';
import { DT } from '../sim/constants';
import { MAX_SHOTS, SHOT_STONE, type World } from '../sim/world';
import { PALETTE } from './look';
import { addInstanceColor, addInstanceFloat, makeInstanced, rgbInto, segmentMatrix, tintMaterial, writeMatrix } from './fxView';

/** Length and thickness of a dart's streak, m. */
export const STREAK_LENGTH = 1.1;
export const STREAK_WIDTH = 0.12;
/** A stone: how wide across and how thick, m, and how fast it spins, turns a second. */
export const STONE_WIDTH = 0.42;
export const STONE_THICK = 0.14;
const STONE_SPIN = 3;
const DART_GLOW = 0.9;
const STONE_GLOW = 0.5;

export class ShotsView {
  readonly mesh: InstancedMesh;
  private readonly glow: InstancedBufferAttribute;
  private readonly rgb: Float32Array;
  private readonly dartRgb = new Float32Array(3);
  private readonly stoneRgb = new Float32Array(3);

  constructor() {
    // A unit box, centred, shaped per instance by its matrix.
    const geo = new BoxGeometry(1, 1, 1);
    this.glow = addInstanceFloat(geo, 'aGlow', MAX_SHOTS);
    this.mesh = makeInstanced(geo, tintMaterial(), MAX_SHOTS, 'shots');
    this.rgb = addInstanceColor(this.mesh, MAX_SHOTS);
    rgbInto(this.dartRgb, 0, PALETTE.shot);
    rgbInto(this.stoneRgb, 0, PALETTE.stone);
  }

  /** `time` in seconds, for the stones' spin. */
  update(w: World, alpha: number, time = 0): void {
    const s = w.shots;
    const back = (1 - alpha) * DT;
    const m = this.mesh.instanceMatrix.array;
    const glow = this.glow.array as Float32Array;
    const rgb = this.rgb;
    for (let i = 0; i < s.count; i++) {
      const vx = s.vx[i];
      const vy = s.vy[i];
      const vz = s.vz[i];
      const x = s.x[i] - vx * back;
      const y = s.y[i] - vy * back;
      const z = s.z[i] - vz * back;
      let col = this.dartRgb;
      if (s.kind[i] === SHOT_STONE) {
        // Flat and spinning about the up axis, each at its own angle.
        const a = time * STONE_SPIN * Math.PI * 2 + i * 1.7;
        const c = Math.cos(a) * STONE_WIDTH;
        const sn = Math.sin(a) * STONE_WIDTH;
        writeMatrix(m, i, c, 0, -sn, 0, STONE_THICK, 0, sn, 0, c, x, y, z);
        glow[i] = STONE_GLOW;
        col = this.stoneRgb;
      } else {
        const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const h = l > 1e-6 ? (STREAK_LENGTH * 0.5) / l : 0;
        if (h > 0) segmentMatrix(m, i, x - vx * h, y - vy * h, z - vz * h, x + vx * h, y + vy * h, z + vz * h, STREAK_WIDTH, STREAK_WIDTH);
        else writeMatrix(m, i, STREAK_WIDTH, 0, 0, 0, STREAK_WIDTH, 0, 0, 0, STREAK_LENGTH, x, y, z);
        glow[i] = DART_GLOW;
      }
      rgb[i * 3] = col[0];
      rgb[i * 3 + 1] = col[1];
      rgb[i * 3 + 2] = col[2];
    }
    this.mesh.count = s.count;
    this.mesh.visible = s.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (s.count > 0) {
      this.glow.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
