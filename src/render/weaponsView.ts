/**
 * The weapons that are on the mover rather than thrown from it:
 *
 * - Orbit: its discs, spinning, where `orbitDisc` puts them.
 * - Lance: a beam straight ahead of the mover as long as `lanceLength`, a bright core inside a faint
 *   band as wide as it reaches, only while the Lance is on.
 * - Slipstream: faint streaks flowing back through the draft's cone behind the mover, as long as
 *   `slipstreamLength`, only while the draft is up.
 *
 * Everything follows the mover as drawn (interpolated between the last two ticks), so nothing lags
 * it by a tick. Two draw calls: the discs, and the beams and streaks together.
 */
import { BoxGeometry, CylinderGeometry, Group, type InstancedBufferAttribute, type InstancedMesh } from 'three';
import { W_ORBIT, W_SLIPSTREAM } from '../sim/arsenal';
import type { SimState, Vec3 } from '../sim/types';
import { LANCE, lanceLength } from '../sim/weapons/lance';
import { orbitDisc, orbitDiscCount } from '../sim/weapons/orbit';
import { SLIPSTREAM, slipstreamLength } from '../sim/weapons/slipstream';
import type { World } from '../sim/world';
import { PALETTE, glowMaterial } from './look';
import { addInstanceColor, addInstanceFloat, fadeMaterial, makeInstanced, rgbInto, segmentMatrix, writeMatrix } from './fxView';

export const MAX_DISCS = 4;
const DISC_RADIUS = 0.42;
const DISC_THICK = 0.1;
const DISC_SPIN = 2;
const DISC_GLOW = 0.6;
/** The beam rides this high above the mover's feet, m. */
export const LANCE_HEIGHT = 0.9;
const LANCE_CORE = 0.22;
const LANCE_CORE_FADE = 0.85;
const LANCE_BAND_FADE = 0.18;
/** Streaks in the draft, how long each is as a share of the draft, how fast they flow, their strength. */
export const STREAKS = 6;
const STREAK_SHARE = 0.3;
const STREAK_RATE = 1.4;
const STREAK_FADE = 0.3;
const STREAK_WIDTH = 0.08;
const STREAK_HEIGHT = 0.5;
const MAX_BEAMS = 2 + STREAKS;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class WeaponsView {
  readonly object = new Group();
  readonly discs: InstancedMesh;
  /** The Lance's beam (core and band) and the Slipstream's streaks. */
  readonly beams: InstancedMesh;
  /** Beams drawn last frame that were the Lance's (0 or 2) and the Slipstream's. */
  lanceBeams = 0;
  streakBeams = 0;
  private readonly beamFade: InstancedBufferAttribute;
  private readonly beamRgb: Float32Array;
  private readonly lanceRgb = new Float32Array(3);
  private readonly draftRgb = new Float32Array(3);
  private readonly disc: Vec3 = { x: 0, y: 0, z: 0 };

  constructor() {
    this.object.name = 'weapons';
    this.discs = makeInstanced(new CylinderGeometry(DISC_RADIUS, DISC_RADIUS, DISC_THICK, 10), glowMaterial(PALETTE.orbit, DISC_GLOW), MAX_DISCS, 'weapons-orbit');
    const box = new BoxGeometry(1, 1, 1);
    this.beamFade = addInstanceFloat(box, 'aFade', MAX_BEAMS);
    this.beams = makeInstanced(box, fadeMaterial(0xffffff), MAX_BEAMS, 'weapons-beams');
    this.beamRgb = addInstanceColor(this.beams, MAX_BEAMS);
    rgbInto(this.lanceRgb, 0, PALETTE.lance);
    rgbInto(this.draftRgb, 0, PALETTE.spark);
    this.beams.renderOrder = 3;
    this.object.add(this.discs, this.beams);
  }

  /** Draw as of `alpha` (0..1) of the way from `prev` to `cur`; `time` in seconds. */
  update(w: World, prev: SimState, cur: SimState, alpha: number, time: number): void {
    const a = prev.mover;
    const b = cur.mover;
    const mx = lerp(a.x, b.x, alpha);
    const my = lerp(a.y, b.y, alpha);
    const mz = lerp(a.z, b.z, alpha);
    const heading = a.heading + angleDelta(a.heading, b.heading) * alpha;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);

    // Orbit: where the sim puts each disc after the latest tick, moved with the mover as drawn.
    const dm = this.discs.instanceMatrix.array;
    const nd = Math.min(MAX_DISCS, orbitDiscCount(w.player.loadout.weaponLevel[W_ORBIT]));
    let discs = 0;
    const spin = time * DISC_SPIN * Math.PI * 2;
    for (let k = 0; k < nd; k++) {
      if (!orbitDisc(w, cur, k, this.disc)) break;
      const c = Math.cos(spin + k);
      const s = Math.sin(spin + k);
      writeMatrix(dm, discs++, c, 0, -s, 0, 1, 0, s, 0, c, this.disc.x - b.x + mx, this.disc.y - b.y + my, this.disc.z - b.z + mz);
    }
    this.discs.count = discs;
    this.discs.visible = discs > 0;
    if (discs > 0) this.discs.instanceMatrix.needsUpdate = true;

    const bm = this.beams.instanceMatrix.array;
    const fade = this.beamFade.array as Float32Array;
    let beams = 0;

    // Lance: straight ahead along the heading, at chest height.
    const len = lanceLength(w, cur);
    this.lanceBeams = 0;
    if (len > 0) {
      const y = my + LANCE_HEIGHT;
      const band = LANCE.halfWidth * w.player.stats.area * 2;
      segmentMatrix(bm, beams, mx, y, mz, mx + fx * len, y, mz + fz * len, band, LANCE_CORE * 0.5);
      this.beamColor(beams, this.lanceRgb);
      fade[beams++] = LANCE_BAND_FADE;
      segmentMatrix(bm, beams, mx, y, mz, mx + fx * len, y, mz + fz * len, LANCE_CORE, LANCE_CORE);
      this.beamColor(beams, this.lanceRgb);
      fade[beams++] = LANCE_CORE_FADE;
      this.lanceBeams = 2;
    }

    // Slipstream: streaks flowing back through the cone behind the mover.
    const draft = slipstreamLength(w, cur, w.player.loadout.weaponLevel[W_SLIPSTREAM]);
    this.streakBeams = 0;
    if (draft > 0) {
      const half = (SLIPSTREAM.halfAngleDegrees * Math.PI) / 180;
      const y = my + STREAK_HEIGHT;
      for (let k = 0; k < STREAKS; k++) {
        const flow = (time * STREAK_RATE + k / STREAKS) % 1;
        // Spread across the cone, inner streaks a little longer.
        const ang = heading + Math.PI + half * ((k / (STREAKS - 1)) * 2 - 1) * 0.85;
        const dx = Math.sin(ang);
        const dz = Math.cos(ang);
        const d0 = flow * draft * (1 - STREAK_SHARE);
        const d1 = d0 + draft * STREAK_SHARE;
        segmentMatrix(bm, beams, mx + dx * d0, y, mz + dz * d0, mx + dx * d1, y, mz + dz * d1, STREAK_WIDTH, STREAK_WIDTH);
        this.beamColor(beams, this.draftRgb);
        fade[beams++] = STREAK_FADE * Math.sin(flow * Math.PI);
        this.streakBeams++;
      }
    }

    this.beams.count = beams;
    this.beams.visible = beams > 0;
    if (beams > 0) {
      this.beams.instanceMatrix.needsUpdate = true;
      this.beamFade.needsUpdate = true;
      if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
    }
  }

  private beamColor(i: number, rgb: Float32Array): void {
    this.beamRgb[i * 3] = rgb[0];
    this.beamRgb[i * 3 + 1] = rgb[1];
    this.beamRgb[i * 3 + 2] = rgb[2];
  }
}
