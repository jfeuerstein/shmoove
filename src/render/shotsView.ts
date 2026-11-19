/**
 * Shots: one instanced mesh of short bright streaks in `PALETTE.shot`, each aligned to its velocity
 * and drawn where it is between the last two ticks (extrapolated back from the latest by its
 * velocity, as the world is not interpolated).
 */
import { BoxGeometry, DynamicDrawUsage, InstancedMesh } from 'three';
import { DT } from '../sim/constants';
import { MAX_SHOTS, type World } from '../sim/world';
import { PALETTE, glowMaterial } from './look';

/** Length and thickness of a streak, m. */
const STREAK_LENGTH = 1.1;
const STREAK_WIDTH = 0.12;
const SHOT_GLOW = 0.9;

export class ShotsView {
  readonly mesh: InstancedMesh;

  constructor() {
    // A unit-long box along +z, centred, scaled per instance by the basis below.
    const geo = new BoxGeometry(1, 1, 1);
    this.mesh = new InstancedMesh(geo, glowMaterial(PALETTE.shot, SHOT_GLOW), MAX_SHOTS);
    this.mesh.name = 'shots';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  update(w: World, alpha: number): void {
    const s = w.shots;
    const back = (1 - alpha) * DT;
    const m = this.mesh.instanceMatrix.array;
    for (let i = 0; i < s.count; i++) {
      const vx = s.vx[i];
      const vy = s.vy[i];
      const vz = s.vz[i];
      const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
      // Forward f, right r = up x f, up u = f x r.
      let fx = 0;
      let fy = 0;
      let fz = 1;
      if (l > 1e-6) {
        fx = vx / l;
        fy = vy / l;
        fz = vz / l;
      }
      let rx = fz;
      let rz = -fx;
      const rl = Math.sqrt(rx * rx + rz * rz);
      if (rl > 1e-4) {
        rx /= rl;
        rz /= rl;
      } else {
        rx = 1;
        rz = 0;
      }
      const ux = fy * rz;
      const uy = fz * rx - fx * rz;
      const uz = -fy * rx;
      const o = i * 16;
      m[o] = rx * STREAK_WIDTH;
      m[o + 1] = 0;
      m[o + 2] = rz * STREAK_WIDTH;
      m[o + 3] = 0;
      m[o + 4] = ux * STREAK_WIDTH;
      m[o + 5] = uy * STREAK_WIDTH;
      m[o + 6] = uz * STREAK_WIDTH;
      m[o + 7] = 0;
      m[o + 8] = fx * STREAK_LENGTH;
      m[o + 9] = fy * STREAK_LENGTH;
      m[o + 10] = fz * STREAK_LENGTH;
      m[o + 11] = 0;
      m[o + 12] = s.x[i] - vx * back;
      m[o + 13] = s.y[i] - vy * back;
      m[o + 14] = s.z[i] - vz * back;
      m[o + 15] = 1;
    }
    this.mesh.count = s.count;
    this.mesh.visible = s.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
