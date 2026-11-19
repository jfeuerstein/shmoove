/**
 * The weapons that are on the mover rather than thrown from it:
 *
 * - Orbit: toothed saw blades where `orbitDisc` puts them, tipped a little outward so their faces
 *   show, each spinning on its own axis as it goes round, with a glowing streak along the orbit
 *   behind it. More of them at higher levels, as the sim says.
 * - Bumper: a hoop of chunky plates round the rider at hip height, slowly turning. When the player
 *   is hit (the sim's invulnerability starts) it flares and swells for a moment; the ring it throws
 *   out to the shove radius is `FxView`'s. Taller plates at higher levels.
 * - Lance: a beam straight ahead of the mover as long as `lanceLength`: a faint sheath as wide as it
 *   reaches, and a bright core that swells each time the beam burns (on the sim's own beat, the
 *   Lance's wait times Haste) and narrows as it charges for the next, with a charge gathering at the
 *   muzzle and embers rising off the line. Thicker at higher levels.
 * - Slipstream: streaks of air drawn in through the draft's cone behind the mover, as long as
 *   `slipstreamLength`, each curving in toward the line behind the board as it flows forward and
 *   brightening as it nears the board, with bright glints riding them, only while the draft is up.
 *
 * Everything follows the mover as drawn (interpolated between the last two ticks), so nothing lags
 * it by a tick. Two draw calls: the solids (blades and hoop, one kit), and the beams, streaks and
 * glows together.
 */
import { BoxGeometry, CylinderGeometry, Group, Matrix4, type InstancedBufferAttribute, type InstancedMesh } from 'three';
import { W_BUMPER, W_LANCE, W_ORBIT, W_SLIPSTREAM } from '../sim/arsenal';
import { FEEL } from '../sim/constants';
import type { SimState, Vec3 } from '../sim/types';
import { LANCE, lanceLength } from '../sim/weapons/lance';
import { orbitDisc, orbitDiscCount } from '../sim/weapons/orbit';
import { SLIPSTREAM, slipstreamLength } from '../sim/weapons/slipstream';
import type { World } from '../sim/world';
import { PALETTE, tone } from './look';
import {
  addInstanceColor,
  addInstanceFloat,
  BUMPER_HIP,
  fadeMaterial,
  kitMaterial,
  makeInstanced,
  type Paint,
  rgbInto,
  segmentMatrix,
  ShapeBuilder,
  toneRatioInto,
  writeMatrix,
} from './fxView';

export const MAX_DISCS = 4;
/** A blade's radius and thickness, m. */
export const DISC_RADIUS = 0.36;
const DISC_THICK = 0.09;
const DISC_TEETH = 10;
/** Turns a second a blade spins on its own axis, and how far it is tipped outward, rad. */
const DISC_SPIN = 3;
const DISC_TILT = 0.35;
/** Blade glow at level 1, and more per level. */
const DISC_GLOW = 0.3;
const DISC_GLOW_PER_LEVEL = 0.06;
/** The streak behind each blade: segments, the angle each covers, rad, and its strength. */
const DISC_TRAIL_SEGS = 3;
const DISC_TRAIL_STEP = 0.2;
const DISC_TRAIL_FADE = 0.4;

/** The Bumper's hoop: its radius, the plates round it, and their size, m. */
export const HOOP_RADIUS = 0.62;
const HOOP_PLATES = 8;
const PLATE_W = 0.3;
const PLATE_H = 0.22;
const PLATE_D = 0.1;
/** Turns a second, glow, and how much taller the plates are per level above 1. */
const HOOP_SPIN = 0.12;
const HOOP_GLOW = 0.25;
const HOOP_TALLER = 0.15;
/** Ticks the hoop flares for after a hit, and how much it swells and glows at the peak. */
const HOOP_FLARE_TICKS = 14;
const HOOP_SWELL = 0.5;
const HOOP_FLARE_GLOW = 1.4;

/** Kit shapes. */
const SHAPE_BLADE = 0;
const SHAPE_HOOP = 1;
const MAX_SOLIDS = MAX_DISCS + 1;

/** The beam rides this high above the mover's feet, m. */
export const LANCE_HEIGHT = 0.9;
const LANCE_CORE = 0.12;
/** The core's strength between burns and at a burn, its swell at a burn, and per level. */
const LANCE_CORE_FADE = 0.45;
const LANCE_CORE_BURST = 0.4;
const LANCE_CORE_SWELL = 0.8;
const LANCE_CORE_PER_LEVEL = 0.15;
/** The sheath: its strength, and its height as a share of its width. */
const LANCE_BAND_FADE = 0.11;
const LANCE_BAND_TALL = 0.3;
/** The charge at the muzzle: how far ahead it starts, its length and size, m. */
const MUZZLE_FROM = 0.25;
const MUZZLE_LEN = 0.45;
const MUZZLE_SIZE = 0.34;
/** Embers rising off the beam: how many, how fast they climb, how high, m. */
export const LANCE_EMBERS = 5;
const EMBER_RATE = 1.1;
const EMBER_RISE = 0.9;
/** Streaks in the draft: lines, segments per line (`STREAKS` segments in all), how long each line is
 *  as a share of the draft, how fast they flow, their strength. */
export const STREAK_LINES = 6;
export const STREAK_SEGS = 3;
export const STREAKS = STREAK_LINES * STREAK_SEGS;
const STREAK_SHARE = 0.25;
const STREAK_RATE = 0.9;
const STREAK_FADE = 0.27;
const STREAK_WIDTH = 0.3;
const STREAK_HEIGHT = 0.5;
/** Share of the cone's half-angle a line starts at (far end) and how far in it curves (near end). */
const STREAK_SPREAD = 0.85;
const STREAK_CURL = 0.35;
/** Glints riding the streaks: the sparks the draft carries. */
export const DRAFT_GLINTS = 3;
const GLINT_SIZE = 0.16;
const GLINT_FADE = 0.55;
/** The draft's light, times its colour. */
const DRAFT_BRIGHT = 2.5;
const MAX_BEAMS = 2 + 1 + LANCE_EMBERS + STREAKS + DRAFT_GLINTS + MAX_DISCS * DISC_TRAIL_SEGS;

/**
 * How strongly a draft streak shows as it flows in (0 far back, 1 at the board): brighter the nearer
 * it is drawn in, so the rush into the board is what the eye catches; it fades fast at the very end.
 */
export function drawIn(flow: number): number {
  const f = flow < 0 ? 0 : flow > 1 ? 1 : flow;
  return f < 0.85 ? f / 0.85 : (1 - f) / 0.15;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Tones by distance from the axis: `kIn` at the centre to `kOut` at `r`, for an instance coloured `color`. */
function radialPaint(color: number, r: number, kIn: number, kOut: number, kBottom: number): Paint {
  const inner = new Float32Array(3);
  const outer = new Float32Array(3);
  const under = new Float32Array(3);
  toneRatioInto(inner, 0, color, kIn);
  toneRatioInto(outer, 0, color, kOut);
  toneRatioInto(under, 0, color, kBottom);
  return (x, y, z, out) => {
    if (y < -1e-4) {
      out[0] = under[0];
      out[1] = under[1];
      out[2] = under[2];
      return;
    }
    const t = Math.min(1, Math.sqrt(x * x + z * z) / r);
    out[0] = lerp(inner[0], outer[0], t);
    out[1] = lerp(inner[1], outer[1], t);
    out[2] = lerp(inner[2], outer[2], t);
  };
}

/** One tone of `color` for an instance coloured `color`. */
function flatTone(color: number, k: number): Paint {
  const c = new Float32Array(3);
  toneRatioInto(c, 0, color, k);
  return (_x, _y, _z, out) => {
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  };
}

/**
 * The kit: a toothed saw blade (part 0, lying in the xz plane, in tones of `blade`) and the Bumper's
 * hoop of plates (part 1, centred on the origin, in tones of `hoop`).
 */
export function weaponsKit(blade: number, hoop: number): ShapeBuilder {
  const b = new ShapeBuilder();
  b.partId = SHAPE_BLADE;
  const R = DISC_RADIUS;
  const h = DISC_THICK * 0.5;
  const face = radialPaint(blade, R, -0.35, 0.3, -0.45);
  const side = flatTone(blade, -0.1);
  // The outline: a tip, then a valley, round the rim (a saw's steep back and long slope).
  const pts: number[] = [];
  for (let i = 0; i < DISC_TEETH; i++) {
    const a0 = (i / DISC_TEETH) * Math.PI * 2;
    const a1 = ((i + 0.72) / DISC_TEETH) * Math.PI * 2;
    pts.push(Math.sin(a0) * R, Math.cos(a0) * R, Math.sin(a1) * R * 0.74, Math.cos(a1) * R * 0.74);
  }
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2];
    const az = pts[i * 2 + 1];
    const bx = pts[j * 2];
    const bz = pts[j * 2 + 1];
    b.tri(0, h, 0, ax, h, az, bx, h, bz, face);
    b.tri(0, -h, 0, bx, -h, bz, ax, -h, az, face);
    b.tri(ax, h, az, ax, -h, az, bx, -h, bz, side);
    b.tri(ax, h, az, bx, -h, bz, bx, h, bz, side);
  }
  // A raised hub.
  b.add(new CylinderGeometry(R * 0.28, R * 0.28, DISC_THICK * 2.2, 6), flatTone(blade, -0.55));

  b.partId = SHAPE_HOOP;
  const lo = new Float32Array(3);
  const hi = new Float32Array(3);
  toneRatioInto(lo, 0, hoop, -0.4);
  toneRatioInto(hi, 0, hoop, 0.25);
  // Darker at the foot of each plate, lighter at its top edge.
  const plate: Paint = (_x, y, _z, out) => {
    const t = Math.min(1, Math.max(0, (y + PLATE_H * 0.5) / PLATE_H));
    out[0] = lerp(lo[0], hi[0], t);
    out[1] = lerp(lo[1], hi[1], t);
    out[2] = lerp(lo[2], hi[2], t);
  };
  const stud = flatTone(hoop, 0.45);
  const m = new Matrix4();
  const rot = new Matrix4();
  for (let k = 0; k < HOOP_PLATES; k++) {
    const a = (k / HOOP_PLATES) * Math.PI * 2;
    rot.makeRotationY(a);
    m.makeTranslation(0, 0, HOOP_RADIUS).premultiply(rot);
    b.add(new BoxGeometry(PLATE_W, PLATE_H, PLATE_D), plate, m);
    m.makeTranslation(0, 0, HOOP_RADIUS + PLATE_D * 0.5 + 0.03).premultiply(rot);
    b.add(new BoxGeometry(0.11, 0.11, 0.08), stud, m);
  }
  return b;
}

export class WeaponsView {
  readonly object = new Group();
  /** The solids: the Orbit's blades first (as many as are out), then the Bumper's hoop. */
  readonly discs: InstancedMesh;
  /** The Lance's beam, its charge and embers, the Slipstream's streaks and glints, the blades' streaks. */
  readonly beams: InstancedMesh;
  /** Blades drawn last frame, and whether the hoop was. */
  discCount = 0;
  hoop = false;
  /** Beams drawn last frame that span the Lance (its sheath and core: 0 or 2), and the Slipstream's streak segments. */
  lanceBeams = 0;
  streakBeams = 0;
  /** How strongly the hoop flared last frame, 0..1. */
  hoopFlare = 0;
  private readonly solidShape: InstancedBufferAttribute;
  private readonly solidGlow: InstancedBufferAttribute;
  private readonly solidRgb: Float32Array;
  private readonly beamFade: InstancedBufferAttribute;
  private readonly beamRgb: Float32Array;
  private readonly orbitRgb = new Float32Array(3);
  private readonly hoopRgb = new Float32Array(3);
  private readonly lanceRgb = new Float32Array(3);
  private readonly emberRgb = new Float32Array(3);
  private readonly draftRgb = new Float32Array(3);
  private readonly disc: Vec3 = { x: 0, y: 0, z: 0 };

  constructor() {
    this.object.name = 'weapons';
    rgbInto(this.orbitRgb, 0, PALETTE.orbit);
    rgbInto(this.hoopRgb, 0, PALETTE.accent);
    rgbInto(this.lanceRgb, 0, PALETTE.lance);
    rgbInto(this.emberRgb, 0, tone(PALETTE.lance, -0.15));
    // Air is thin: the streaks stay see-through, but bright where they are.
    rgbInto(this.draftRgb, 0, PALETTE.spark, DRAFT_BRIGHT);

    const kit = weaponsKit(PALETTE.orbit, PALETTE.accent).build();
    this.solidShape = addInstanceFloat(kit, 'aShape', MAX_SOLIDS);
    this.solidGlow = addInstanceFloat(kit, 'aGlow', MAX_SOLIDS);
    this.discs = makeInstanced(kit, kitMaterial(), MAX_SOLIDS, 'weapons-solids');
    this.solidRgb = addInstanceColor(this.discs, MAX_SOLIDS);

    const box = new BoxGeometry(1, 1, 1);
    this.beamFade = addInstanceFloat(box, 'aFade', MAX_BEAMS);
    const beamMat = fadeMaterial(0xffffff);
    // Light only of their own, so each keeps its hue (lit as well, they all wash out to white).
    beamMat.color.setHex(0);
    this.beams = makeInstanced(box, beamMat, MAX_BEAMS, 'weapons-beams');
    this.beamRgb = addInstanceColor(this.beams, MAX_BEAMS);
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
    const levels = w.player.loadout.weaponLevel;

    const bm = this.beams.instanceMatrix.array;
    const fade = this.beamFade.array as Float32Array;
    let beams = 0;

    // Lance: straight ahead along the heading, at chest height. First the two that span it.
    const len = lanceLength(w, cur);
    this.lanceBeams = 0;
    if (len > 0) {
      const level = levels[W_LANCE];
      const y = my + LANCE_HEIGHT;
      const band = LANCE.halfWidth * w.player.stats.area * 2;
      // The burn's beat: the beam burns once every wait (times Haste); it swells at a burn and narrows as it charges.
      const wait = LANCE.wait * w.player.stats.haste;
      const phase = wait > 0 ? (time / wait) % 1 : 0;
      const burst = (1 - phase) * (1 - phase) * (1 - phase);
      const core = LANCE_CORE * (1 + LANCE_CORE_PER_LEVEL * (level - 1)) * (1 + LANCE_CORE_SWELL * burst);
      const ex = mx + fx * len;
      const ez = mz + fz * len;
      segmentMatrix(bm, beams, mx, y, mz, ex, y, ez, band, band * LANCE_BAND_TALL);
      this.beamColor(beams, this.lanceRgb);
      fade[beams++] = LANCE_BAND_FADE * (1 + 0.5 * burst);
      segmentMatrix(bm, beams, mx, y, mz, ex, y, ez, core, core);
      this.beamColor(beams, this.lanceRgb);
      fade[beams++] = LANCE_CORE_FADE + LANCE_CORE_BURST * burst;
      this.lanceBeams = 2;
      // The charge gathering at the muzzle.
      const c = MUZZLE_SIZE * (0.45 + 0.55 * phase) * (1 + LANCE_CORE_PER_LEVEL * (level - 1));
      segmentMatrix(bm, beams, mx + fx * MUZZLE_FROM, y, mz + fz * MUZZLE_FROM, mx + fx * (MUZZLE_FROM + MUZZLE_LEN), y, mz + fz * (MUZZLE_FROM + MUZZLE_LEN), c, c);
      this.beamColor(beams, this.lanceRgb);
      fade[beams++] = 0.35 + 0.4 * phase;
      // Embers rising off the line it burns.
      for (let k = 0; k < LANCE_EMBERS; k++) {
        const t = (time * EMBER_RATE + k * 0.618) % 1;
        const d = len * ((k * 0.37 + 0.13 + time * 0.07) % 1);
        const side = ((k * 0.53) % 1) * 2 - 1;
        const px = mx + fx * d + fz * side * band * 0.35;
        const pz = mz + fz * d - fx * side * band * 0.35;
        const py = y - 0.3 + EMBER_RISE * t;
        segmentMatrix(bm, beams, px, py, pz, px, py + 0.22, pz, 0.09, 0.09);
        this.beamColor(beams, this.emberRgb);
        fade[beams++] = 0.45 * Math.sin(t * Math.PI);
      }
    }

    // Slipstream: lines of air drawn forward and inward through the cone behind the mover.
    const draft = slipstreamLength(w, cur, levels[W_SLIPSTREAM]);
    this.streakBeams = 0;
    if (draft > 0) {
      const level = levels[W_SLIPSTREAM];
      const half = (SLIPSTREAM.halfAngleDegrees * Math.PI) / 180;
      const y = my + STREAK_HEIGHT;
      const width = STREAK_WIDTH * (1 + 0.1 * (level - 1));
      const seg = (draft * STREAK_SHARE) / STREAK_SEGS;
      for (let k = 0; k < STREAK_LINES; k++) {
        const flow = (time * STREAK_RATE + k / STREAK_LINES) % 1;
        // Far end out at the cone's edge, near end curled in toward the line behind the board.
        const side = ((k % 2 === 0 ? 1 : -1) * (0.45 + 0.55 * (((k * 7) % STREAK_LINES) / (STREAK_LINES - 1)))) * half * STREAK_SPREAD;
        const head = draft * (0.95 - STREAK_SHARE) * (1 - flow * 0.85);
        const strength = STREAK_FADE * drawIn(flow);
        let px = 0;
        let pz = 0;
        for (let j = 0; j <= STREAK_SEGS; j++) {
          const u = j / STREAK_SEGS;
          const d = head + u * seg * STREAK_SEGS;
          const ang = heading + Math.PI + side * (STREAK_CURL + (1 - STREAK_CURL) * u);
          const qx = mx + Math.sin(ang) * d;
          const qz = mz + Math.cos(ang) * d;
          if (j > 0) {
            segmentMatrix(bm, beams, px, y, pz, qx, y, qz, width * (1.2 - 0.5 * u), 0.05);
            this.beamColor(beams, this.draftRgb);
            fade[beams++] = strength * (1 - 0.35 * u);
            this.streakBeams++;
          }
          px = qx;
          pz = qz;
        }
      }
      // The sparks it carries: glints at the near ends of every other line.
      for (let g = 0; g < DRAFT_GLINTS; g++) {
        const k = g * 2;
        const flow = (time * STREAK_RATE + k / STREAK_LINES) % 1;
        const side = (0.45 + 0.55 * (((k * 7) % STREAK_LINES) / (STREAK_LINES - 1))) * half * STREAK_SPREAD;
        const d = draft * (0.95 - STREAK_SHARE) * (1 - flow * 0.85);
        const ang = heading + Math.PI + side * STREAK_CURL;
        const qx = mx + Math.sin(ang) * d;
        const qz = mz + Math.cos(ang) * d;
        segmentMatrix(bm, beams, qx - fx * GLINT_SIZE, y, qz - fz * GLINT_SIZE, qx + fx * GLINT_SIZE, y, qz + fz * GLINT_SIZE, GLINT_SIZE, GLINT_SIZE);
        this.beamColor(beams, this.draftRgb);
        fade[beams++] = GLINT_FADE * drawIn(flow);
      }
    }

    // Orbit: where the sim puts each blade after the latest tick, moved with the mover as drawn.
    const dm = this.discs.instanceMatrix.array;
    const shape = this.solidShape.array as Float32Array;
    const glow = this.solidGlow.array as Float32Array;
    const orbitLevel = levels[W_ORBIT];
    const nd = Math.min(MAX_DISCS, orbitDiscCount(orbitLevel));
    let solids = 0;
    const spin = time * DISC_SPIN * Math.PI * 2;
    const ct = Math.cos(DISC_TILT);
    const st = Math.sin(DISC_TILT);
    for (let k = 0; k < nd; k++) {
      if (!orbitDisc(w, cur, k, this.disc)) break;
      let ux = this.disc.x - b.x;
      let uz = this.disc.z - b.z;
      const ul = Math.sqrt(ux * ux + uz * uz);
      ux = ul > 1e-6 ? ux / ul : 0;
      uz = ul > 1e-6 ? uz / ul : 1;
      // Its axis: up, tipped outward. Then two axes across it, turned by its spin.
      const nx = ux * st;
      const ny = ct;
      const nz = uz * st;
      const tx = uz;
      const tz = -ux;
      // b = n x t
      const bx = ny * tz;
      const by = nz * tx - nx * tz;
      const bz = -ny * tx;
      const c = Math.cos(spin + k * 1.3);
      const s = Math.sin(spin + k * 1.3);
      const x = this.disc.x - b.x + mx;
      const y = this.disc.y - b.y + my;
      const z = this.disc.z - b.z + mz;
      writeMatrix(dm, solids, tx * c + bx * s, by * s, tz * c + bz * s, nx, ny, nz, -tx * s + bx * c, by * c, -tz * s + bz * c, x, y, z);
      shape[solids] = SHAPE_BLADE;
      glow[solids] = DISC_GLOW + DISC_GLOW_PER_LEVEL * (orbitLevel - 1);
      this.solidColor(solids, this.orbitRgb);
      solids++;
      // The streak along the orbit behind it (the blades turn with the angle increasing).
      const ang = Math.atan2(ux, uz);
      let px = x;
      let pz = z;
      for (let j = 1; j <= DISC_TRAIL_SEGS; j++) {
        const aj = ang - j * DISC_TRAIL_STEP;
        const qx = mx + Math.sin(aj) * ul;
        const qz = mz + Math.cos(aj) * ul;
        segmentMatrix(bm, beams, px, y, pz, qx, y, qz, DISC_RADIUS * 2 * (1 - 0.22 * j), 0.05);
        this.beamColor(beams, this.orbitRgb);
        fade[beams++] = DISC_TRAIL_FADE * (1 - (j - 1) / DISC_TRAIL_SEGS);
        px = qx;
        pz = qz;
      }
    }
    this.discCount = solids;

    // Bumper: the hoop round the hips, flaring when a hit sets off the sim's invulnerability.
    const bumper = levels[W_BUMPER];
    this.hoop = bumper > 0;
    this.hoopFlare = 0;
    if (bumper > 0) {
      const into = FEEL.invulnTicks - w.player.invuln;
      const flare = w.player.invuln > 0 && into < HOOP_FLARE_TICKS ? 1 - into / HOOP_FLARE_TICKS : 0;
      this.hoopFlare = flare;
      const swell = 1 + HOOP_SWELL * flare;
      const tall = (1 + HOOP_TALLER * (bumper - 1)) * (1 + 0.3 * flare);
      const ha = time * HOOP_SPIN * Math.PI * 2;
      const c = Math.cos(ha) * swell;
      const s = Math.sin(ha) * swell;
      writeMatrix(dm, solids, c, 0, -s, 0, tall, 0, s, 0, c, mx, my + BUMPER_HIP, mz);
      shape[solids] = SHAPE_HOOP;
      glow[solids] = HOOP_GLOW + 0.05 * (bumper - 1) + HOOP_FLARE_GLOW * flare;
      this.solidColor(solids, this.hoopRgb);
      solids++;
    }

    this.discs.count = solids;
    this.discs.visible = solids > 0;
    if (solids > 0) {
      this.discs.instanceMatrix.needsUpdate = true;
      this.solidShape.needsUpdate = true;
      this.solidGlow.needsUpdate = true;
      if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
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

  private solidColor(i: number, rgb: Float32Array): void {
    this.solidRgb[i * 3] = rgb[0];
    this.solidRgb[i * 3 + 1] = rgb[1];
    this.solidRgb[i * 3 + 2] = rgb[2];
  }
}
