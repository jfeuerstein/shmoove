/**
 * Shots: one kit mesh for every kind, each drawn where it is between the last two ticks
 * (extrapolated back from the latest by its velocity, as the world is not interpolated), and one
 * mesh of glowing streaks for what they leave behind.
 *
 * - a dart (`SHOT_DART`, the Seekers): a white finned dart in tones of `PALETTE.shot`, aligned to
 *   its velocity, with a short ribbon along the way it actually came (so a curving dart shows its
 *   curve), and a star of light where it strikes. A little bigger at higher levels.
 * - a stone (`SHOT_STONE`, the Skipper): a flat, wide, spinning pebble in tones of `PALETTE.stone`
 *   that visibly skips: it arcs up between the place it last bounced and the first enemy in its way
 *   (or in even hops over open ground), and a splash ring spreads on the ground at every bounce.
 *
 * The sim keeps no history and moves shots between slots as they come and go, so the view follows
 * each shot itself from tick to tick (by kind and by how far it can have flown), which tells it
 * where a dart has been, when a stone bounced and when a shot struck something rather than ran out.
 */
import { BoxGeometry, IcosahedronGeometry, type InstancedBufferAttribute, type InstancedMesh, Matrix4 } from 'three';
import { W_SEEKERS, W_SKIPPER } from '../sim/arsenal';
import { DT } from '../sim/constants';
import { SKIPPER } from '../sim/weapons/skipper';
import { KINDS, MAX_SHOTS, SHOT_DART, SHOT_STONE, type World } from '../sim/world';
import { PALETTE } from './look';
import {
  addInstanceColor,
  addInstanceFloat,
  fadeMaterial,
  kitMaterial,
  makeInstanced,
  type Paint,
  rgbInto,
  segmentMatrix,
  ShapeBuilder,
  tonePaint,
  toneRatioInto,
  uploadFirst,
  writeMatrix,
} from './fxView';

/** Length and thickness of a dart, m. */
export const STREAK_LENGTH = 0.9;
export const STREAK_WIDTH = 0.16;
/** A stone: how wide across and how thick, m, and how fast it spins, turns a second. */
export const STONE_WIDTH = 0.44;
export const STONE_THICK = 0.15;
const STONE_SPIN = 3;
const DART_GLOW = 0.9;
const STONE_GLOW = 0.45;
/** How much bigger a dart or stone is per level above 1. */
const DART_GROW = 0.1;
const STONE_GROW = 0.08;

/** Kit shapes. */
const SHAPE_DART = 0;
const SHAPE_STONE = 1;

/** Points of a dart's path kept for its ribbon (the newest is where it is). */
export const TRAIL_POINTS = 5;
const TRAIL_WIDTH = 0.9;
const TRAIL_FADE = 0.55;
/** A stone's arc: its height for each metre between bounces, and the most it rises, m. */
export const ARC_PER_M = 0.22;
export const ARC_MAX = 1.3;
/** Over open ground a stone skips in hops this long, m. */
export const HOP_FREE = 3.5;
/** It looks this far ahead for the next enemy it will bounce off, m. */
const LOOK_AHEAD = 16;
/** Slack for following a stone from one tick to the next: a bounce moves it past the body it hit, m. */
const STONE_SLACK = 4;
const DART_SLACK = 0.6;
/** Stars where darts strike, and splash rings where stones bounce: how many at once, their life, s. */
export const IMPACT_POOL = 16;
export const SPLASH_POOL = 16;
const IMPACT_LIFE = 0.14;
const IMPACT_SIZE = 0.6;
const SPLASH_LIFE = 0.38;
/** A splash ring: boxes round it, how far it spreads, m, and its strength. */
const SPLASH_SIDES = 8;
const SPLASH_FROM = 0.25;
const SPLASH_TO = 1.1;
const SPLASH_FADE = 0.8;
const MAX_STREAKS = MAX_SHOTS * (TRAIL_POINTS - 1) + IMPACT_POOL * 3 + SPLASH_POOL * SPLASH_SIDES;

/** Where each shot was at the last tick the view saw, and what it has seen of it. */
class Records {
  readonly kind = new Uint8Array(MAX_SHOTS);
  readonly aux = new Float32Array(MAX_SHOTS);
  readonly life = new Float32Array(MAX_SHOTS);
  /** Where a stone last bounced (or was thrown), and the hops it has made over open ground since. */
  readonly bx = new Float32Array(MAX_SHOTS);
  readonly bz = new Float32Array(MAX_SHOTS);
  readonly hops = new Uint8Array(MAX_SHOTS);
  /** A dart's path, newest first: TRAIL_POINTS (x, y, z) per shot. */
  readonly hist = new Float32Array(MAX_SHOTS * TRAIL_POINTS * 3);
  readonly histN = new Uint8Array(MAX_SHOTS);
  count = 0;

  copy(from: Records, j: number, i: number): void {
    this.kind[i] = from.kind[j];
    this.aux[i] = from.aux[j];
    this.life[i] = from.life[j];
    this.bx[i] = from.bx[j];
    this.bz[i] = from.bz[j];
    this.hops[i] = from.hops[j];
    this.histN[i] = from.histN[j];
    const o = i * TRAIL_POINTS * 3;
    const p = j * TRAIL_POINTS * 3;
    for (let k = 0; k < TRAIL_POINTS * 3; k++) this.hist[o + k] = from.hist[p + k];
  }
}

/** The kit: a finned dart along +z (part 0) and a pebble (part 1), both in a unit box. */
export function shotsKit(dart: number, stone: number): ShapeBuilder {
  const b = new ShapeBuilder();
  b.partId = SHAPE_DART;
  const nose = new Float32Array(3);
  const body = new Float32Array(3);
  const fin = new Float32Array(3);
  toneRatioInto(nose, 0, dart, 0.2);
  toneRatioInto(body, 0, dart, -0.12);
  toneRatioInto(fin, 0, dart, -0.45);
  const paintBody: Paint = (_x, _y, z, out) => {
    const c = z > 0.12 ? nose : body;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  };
  const paintFin: Paint = (_x, _y, _z, out) => {
    out[0] = fin[0];
    out[1] = fin[1];
    out[2] = fin[2];
  };
  // A diamond-section body: nose at +z, widest a third of the way back, narrowing to the tail.
  const ring = (r: number, z: number): number[] => [r, 0, z, 0, r, z, -r, 0, z, 0, -r, z];
  const wide = ring(0.5, 0.12);
  const tail = ring(0.28, -0.5);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    const a = k * 3;
    const c = j * 3;
    b.tri(0, 0, 0.5, wide[a], wide[a + 1], wide[a + 2], wide[c], wide[c + 1], wide[c + 2], paintBody);
    b.tri(wide[a], wide[a + 1], wide[a + 2], tail[a], tail[a + 1], tail[a + 2], tail[c], tail[c + 1], tail[c + 2], paintBody);
    b.tri(wide[a], wide[a + 1], wide[a + 2], tail[c], tail[c + 1], tail[c + 2], wide[c], wide[c + 1], wide[c + 2], paintBody);
    b.tri(0, 0, -0.5, tail[c], tail[c + 1], tail[c + 2], tail[a], tail[a + 1], tail[a + 2], paintBody);
  }
  // Four swept fins at the tail, each a thin wedge seen from both sides.
  for (let k = 0; k < 4; k++) {
    const ax = k === 0 ? 1 : k === 2 ? -1 : 0;
    const ay = k === 1 ? 1 : k === 3 ? -1 : 0;
    const px = ay * 0.06;
    const py = -ax * 0.06;
    const r0 = 0.22;
    const r1 = 1.15;
    b.tri(ax * r0 + px, ay * r0 + py, -0.05, ax * r1 + px, ay * r1 + py, -0.55, ax * r0 + px, ay * r0 + py, -0.5, paintFin);
    b.tri(ax * r0 - px, ay * r0 - py, -0.05, ax * r0 - px, ay * r0 - py, -0.5, ax * r1 - px, ay * r1 - py, -0.55, paintFin);
  }
  b.partId = SHAPE_STONE;
  const pebble = new IcosahedronGeometry(0.5, 0);
  pebble.applyMatrix4(new Matrix4().makeScale(1, 1, 0.82));
  b.add(pebble, tonePaint(stone, -0.4, -0.45, 0.45, 0.25));
  return b;
}

export class ShotsView {
  /** Darts and stones (one kit); its child `streaks` draws ribbons, stars and splashes. */
  readonly mesh: InstancedMesh;
  readonly streaks: InstancedMesh;
  private readonly shape: InstancedBufferAttribute;
  private readonly glow: InstancedBufferAttribute;
  private readonly rgb: Float32Array;
  private readonly streakFade: InstancedBufferAttribute;
  private readonly streakRgb: Float32Array;
  private readonly dartRgb = new Float32Array(3);
  private readonly stoneRgb = new Float32Array(3);

  private recs = new Records();
  private prevRecs = new Records();
  private readonly used = new Uint8Array(MAX_SHOTS);
  /** The run tick the records are of; -1 before the first. */
  private seenTick = -1;
  private lastTime = Number.NaN;

  // Stars and splashes: ring buffers; age < 0 is free.
  private readonly ix = new Float32Array(IMPACT_POOL);
  private readonly iy = new Float32Array(IMPACT_POOL);
  private readonly iz = new Float32Array(IMPACT_POOL);
  private readonly iAge = new Float32Array(IMPACT_POOL).fill(-1);
  private impactNext = 0;
  private readonly px = new Float32Array(SPLASH_POOL);
  private readonly py = new Float32Array(SPLASH_POOL);
  private readonly pz = new Float32Array(SPLASH_POOL);
  private readonly pAge = new Float32Array(SPLASH_POOL).fill(-1);
  private readonly pSize = new Float32Array(SPLASH_POOL);
  private splashNext = 0;

  constructor() {
    rgbInto(this.dartRgb, 0, PALETTE.shot);
    rgbInto(this.stoneRgb, 0, PALETTE.stone);
    const geo = shotsKit(PALETTE.shot, PALETTE.stone).build();
    this.shape = addInstanceFloat(geo, 'aShape', MAX_SHOTS);
    this.glow = addInstanceFloat(geo, 'aGlow', MAX_SHOTS);
    this.mesh = makeInstanced(geo, kitMaterial(), MAX_SHOTS, 'shots');
    this.rgb = addInstanceColor(this.mesh, MAX_SHOTS);

    const box = new BoxGeometry(1, 1, 1);
    this.streakFade = addInstanceFloat(box, 'aFade', MAX_STREAKS);
    this.streaks = makeInstanced(box, fadeMaterial(0xffffff), MAX_STREAKS, 'shots-streaks');
    this.streakRgb = addInstanceColor(this.streaks, MAX_STREAKS);
    this.streaks.renderOrder = 3;
    this.mesh.add(this.streaks);
  }

  /** Stars and splashes still showing, for tests. */
  get liveImpacts(): number {
    let n = 0;
    for (let i = 0; i < IMPACT_POOL; i++) if (this.iAge[i] >= 0) n++;
    return n;
  }

  get liveSplashes(): number {
    let n = 0;
    for (let i = 0; i < SPLASH_POOL; i++) if (this.pAge[i] >= 0) n++;
    return n;
  }

  /** `time` in seconds, for the stones' spin and the effects' age. */
  update(w: World, alpha: number, time = 0): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const tick = w.run.ticks;
    if (tick !== this.seenTick) this.follow(w, tick);

    const s = w.shots;
    const back = (1 - alpha) * DT;
    const m = this.mesh.instanceMatrix.array;
    const glow = this.glow.array as Float32Array;
    const shape = this.shape.array as Float32Array;
    const rgb = this.rgb;
    const sm = this.streaks.instanceMatrix.array;
    const fade = this.streakFade.array as Float32Array;
    let streaks = 0;
    const r = this.recs;
    const dartScale = 1 + DART_GROW * Math.max(0, w.player.loadout.weaponLevel[W_SEEKERS] - 1);
    const stoneScale = 1 + STONE_GROW * Math.max(0, w.player.loadout.weaponLevel[W_SKIPPER] - 1);
    for (let i = 0; i < s.count; i++) {
      const vx = s.vx[i];
      const vy = s.vy[i];
      const vz = s.vz[i];
      const x = s.x[i] - vx * back;
      let y = s.y[i] - vy * back;
      const z = s.z[i] - vz * back;
      const known = i < r.count && r.kind[i] === s.kind[i];
      let col = this.dartRgb;
      if (s.kind[i] === SHOT_STONE) {
        // Up in its arc between bounces.
        if (known) y += this.arc(w, i, x, z, vx, vz);
        const a = time * STONE_SPIN * Math.PI * 2 + i * 1.7;
        const c = Math.cos(a) * STONE_WIDTH * stoneScale;
        const sn = Math.sin(a) * STONE_WIDTH * stoneScale;
        writeMatrix(m, i, c, 0, -sn, 0, STONE_THICK * stoneScale, 0, sn, 0, c, x, y, z);
        glow[i] = STONE_GLOW;
        shape[i] = SHAPE_STONE;
        col = this.stoneRgb;
      } else {
        const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const h = l > 1e-6 ? (STREAK_LENGTH * 0.5) / l : 0;
        const wd = STREAK_WIDTH * dartScale;
        if (h > 0) segmentMatrix(m, i, x - vx * h, y - vy * h, z - vz * h, x + vx * h, y + vy * h, z + vz * h, wd, wd);
        else writeMatrix(m, i, wd, 0, 0, 0, wd, 0, 0, 0, STREAK_LENGTH, x, y, z);
        glow[i] = DART_GLOW;
        shape[i] = SHAPE_DART;
        // The ribbon: from its tail back along the way it came.
        if (known && h > 0) {
          let ax = x - vx * h;
          let ay = y - vy * h;
          let az = z - vz * h;
          const o = i * TRAIL_POINTS * 3;
          for (let k = 1; k < r.histN[i]; k++) {
            const bx = r.hist[o + k * 3];
            const by = r.hist[o + k * 3 + 1];
            const bz = r.hist[o + k * 3 + 2];
            const t = (k - 1) / (TRAIL_POINTS - 1);
            const tw = wd * TRAIL_WIDTH * (1 - 0.7 * t);
            segmentMatrix(sm, streaks, ax, ay, az, bx, by, bz, tw, tw);
            this.streakColor(streaks, this.dartRgb);
            fade[streaks++] = TRAIL_FADE * (1 - t);
            ax = bx;
            ay = by;
            az = bz;
          }
        }
      }
      rgb[i * 3] = col[0];
      rgb[i * 3 + 1] = col[1];
      rgb[i * 3 + 2] = col[2];
    }

    // Stars where darts struck.
    for (let p = 0; p < IMPACT_POOL; p++) {
      if (this.iAge[p] < 0) continue;
      const age = (this.iAge[p] += dt);
      if (age >= IMPACT_LIFE) {
        this.iAge[p] = -1;
        continue;
      }
      const t = age / IMPACT_LIFE;
      const sz = IMPACT_SIZE * (0.6 + 0.6 * t);
      const f = 0.95 * (1 - t);
      const x = this.ix[p];
      const y = this.iy[p];
      const z = this.iz[p];
      for (let a = 0; a < 3; a++) {
        const dx = a === 0 ? sz : 0;
        const dy = a === 1 ? sz : 0;
        const dz = a === 2 ? sz : 0;
        segmentMatrix(sm, streaks, x - dx * 0.5, y - dy * 0.5, z - dz * 0.5, x + dx * 0.5, y + dy * 0.5, z + dz * 0.5, 0.09, 0.09);
        this.streakColor(streaks, this.dartRgb);
        fade[streaks++] = f;
      }
    }
    // Splash rings where stones bounced.
    for (let p = 0; p < SPLASH_POOL; p++) {
      if (this.pAge[p] < 0) continue;
      const age = (this.pAge[p] += dt);
      if (age >= SPLASH_LIFE) {
        this.pAge[p] = -1;
        continue;
      }
      const t = age / SPLASH_LIFE;
      const rr = (SPLASH_FROM + (SPLASH_TO - SPLASH_FROM) * (1 - (1 - t) * (1 - t))) * this.pSize[p];
      const f = SPLASH_FADE * (1 - t);
      const x = this.px[p];
      const y = this.py[p];
      const z = this.pz[p];
      for (let k = 0; k < SPLASH_SIDES; k++) {
        const a0 = (k / SPLASH_SIDES) * Math.PI * 2;
        const a1 = ((k + 1) / SPLASH_SIDES) * Math.PI * 2;
        segmentMatrix(sm, streaks, x + Math.sin(a0) * rr, y, z + Math.cos(a0) * rr, x + Math.sin(a1) * rr, y, z + Math.cos(a1) * rr, 0.1, 0.05);
        this.streakColor(streaks, this.stoneRgb);
        fade[streaks++] = f;
      }
    }

    this.mesh.count = s.count;
    this.streaks.count = streaks;
    this.streaks.visible = streaks > 0;
    // The streaks hang off the shots' mesh: it stays up (drawing none) while only they show.
    this.mesh.visible = s.count > 0 || streaks > 0;
    if (s.count > 0) {
      uploadFirst(this.mesh.instanceMatrix, s.count);
      uploadFirst(this.glow, s.count);
      uploadFirst(this.shape, s.count);
      if (this.mesh.instanceColor) uploadFirst(this.mesh.instanceColor, s.count);
    }
    if (streaks > 0) {
      uploadFirst(this.streaks.instanceMatrix, streaks);
      uploadFirst(this.streakFade, streaks);
      if (this.streaks.instanceColor) uploadFirst(this.streaks.instanceColor, streaks);
    }
  }

  /** How high above its flight line stone i is drawn at (x, z), m. */
  private arc(w: World, i: number, x: number, z: number, vx: number, vz: number): number {
    const r = this.recs;
    const sx = x - r.bx[i];
    const sz = z - r.bz[i];
    const s = Math.sqrt(sx * sx + sz * sz);
    const v = Math.sqrt(vx * vx + vz * vz);
    if (v < 1e-6) return 0;
    const ux = vx / v;
    const uz = vz / v;
    // The first enemy in its way: where it comes down next.
    const h = w.horde;
    let ahead = Infinity;
    for (let e = 0; e < h.count; e++) {
      if (h.hp[e] <= 0) continue;
      const ex = h.x[e] - x;
      const ez = h.z[e] - z;
      const t = ex * ux + ez * uz;
      if (t <= 0 || t > LOOK_AHEAD || t >= ahead) continue;
      const side = ex * uz - ez * ux;
      const reach = KINDS[h.kind[e]].radius + SKIPPER.pad;
      if (side * side > reach * reach) continue;
      ahead = t;
    }
    let span: number;
    let at: number;
    if (ahead < Infinity) {
      span = s + ahead;
      at = s;
    } else {
      span = HOP_FREE;
      at = s - r.hops[i] * HOP_FREE;
      if (at < 0) at = 0;
      if (at > HOP_FREE) at = HOP_FREE;
    }
    if (span < 1e-3) return 0;
    const u = at / span;
    return Math.min(ARC_MAX, ARC_PER_M * span) * 4 * u * (1 - u);
  }

  /**
   * Follow the shots from the last tick seen to this one: which is which, where darts have been,
   * which stones bounced, and which shots are gone because they struck something.
   */
  private follow(w: World, tick: number): void {
    const elapsed = tick - this.seenTick;
    const fresh = this.seenTick < 0 || elapsed <= 0 || elapsed > 30;
    this.seenTick = tick;
    const prev = this.recs;
    const cur = this.prevRecs;
    this.recs = cur;
    this.prevRecs = prev;
    const s = w.shots;
    const pn = fresh ? 0 : prev.count;
    this.used.fill(0, 0, MAX_SHOTS);
    for (let i = 0; i < s.count; i++) {
      const kind = s.kind[i];
      const speed = Math.sqrt(s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i] + s.vz[i] * s.vz[i]);
      const tol = speed * DT * elapsed + (kind === SHOT_STONE ? STONE_SLACK : DART_SLACK);
      let j = -1;
      if (i < pn && this.used[i] === 0 && this.near(prev, i, kind, s.x[i], s.y[i], s.z[i], tol)) j = i;
      else {
        let best = tol * tol;
        for (let q = 0; q < pn; q++) {
          if (this.used[q] !== 0 || prev.kind[q] !== kind) continue;
          const d = this.dist2(prev, q, s.x[i], s.y[i], s.z[i]);
          if (d <= best) {
            best = d;
            j = q;
          }
        }
      }
      const o = i * TRAIL_POINTS * 3;
      if (j >= 0) {
        this.used[j] = 1;
        cur.copy(prev, j, i);
        if (kind === SHOT_STONE && s.aux[i] < prev.aux[j]) {
          // It bounced off something: a splash, and a new arc from here.
          this.splash(s.x[i], s.y[i] - SKIPPER.height, s.z[i], 1);
          cur.bx[i] = s.x[i];
          cur.bz[i] = s.z[i];
          cur.hops[i] = 0;
        }
      } else {
        cur.bx[i] = s.x[i];
        cur.bz[i] = s.z[i];
        cur.hops[i] = 0;
        cur.histN[i] = 0;
      }
      cur.kind[i] = kind;
      cur.aux[i] = s.aux[i];
      cur.life[i] = s.life[i];
      // Newest first.
      const n = Math.min(TRAIL_POINTS, cur.histN[i] + 1);
      for (let k = n - 1; k > 0; k--) {
        cur.hist[o + k * 3] = cur.hist[o + (k - 1) * 3];
        cur.hist[o + k * 3 + 1] = cur.hist[o + (k - 1) * 3 + 1];
        cur.hist[o + k * 3 + 2] = cur.hist[o + (k - 1) * 3 + 2];
      }
      cur.hist[o] = s.x[i];
      cur.hist[o + 1] = s.y[i];
      cur.hist[o + 2] = s.z[i];
      cur.histN[i] = n;
      // Over open ground, a splash at every hop.
      if (kind === SHOT_STONE) {
        const dx = s.x[i] - cur.bx[i];
        const dz = s.z[i] - cur.bz[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= HOP_FREE * (cur.hops[i] + 1) && cur.hops[i] < 255 && !this.headingFor(w, i)) {
          cur.hops[i]++;
          this.splash(s.x[i], s.y[i] - SKIPPER.height, s.z[i], 0.7);
        }
      }
    }
    cur.count = s.count;
    // Gone before their time: they struck something.
    for (let q = 0; q < pn; q++) {
      if (this.used[q] !== 0 || prev.life[q] <= elapsed) continue;
      const o = q * TRAIL_POINTS * 3;
      if (prev.kind[q] === SHOT_DART) this.impact(prev.hist[o], prev.hist[o + 1], prev.hist[o + 2]);
      else this.splash(prev.hist[o], prev.hist[o + 1] - SKIPPER.height, prev.hist[o + 2], 1);
    }
  }

  /** Is an enemy in the way of stone i (so its next bounce is off that, not a hop)? */
  private headingFor(w: World, i: number): boolean {
    const s = w.shots;
    const v = Math.sqrt(s.vx[i] * s.vx[i] + s.vz[i] * s.vz[i]);
    if (v < 1e-6) return false;
    const ux = s.vx[i] / v;
    const uz = s.vz[i] / v;
    const h = w.horde;
    for (let e = 0; e < h.count; e++) {
      if (h.hp[e] <= 0) continue;
      const ex = h.x[e] - s.x[i];
      const ez = h.z[e] - s.z[i];
      const t = ex * ux + ez * uz;
      if (t <= 0 || t > LOOK_AHEAD) continue;
      const side = ex * uz - ez * ux;
      const reach = KINDS[h.kind[e]].radius + SKIPPER.pad;
      if (side * side <= reach * reach) return true;
    }
    return false;
  }

  private dist2(r: Records, j: number, x: number, y: number, z: number): number {
    const o = j * TRAIL_POINTS * 3;
    const dx = r.hist[o] - x;
    const dy = r.hist[o + 1] - y;
    const dz = r.hist[o + 2] - z;
    return dx * dx + dy * dy + dz * dz;
  }

  private near(r: Records, j: number, kind: number, x: number, y: number, z: number, tol: number): boolean {
    return r.kind[j] === kind && r.histN[j] > 0 && this.dist2(r, j, x, y, z) <= tol * tol;
  }

  private impact(x: number, y: number, z: number): void {
    const p = this.impactNext;
    this.impactNext = (p + 1) % IMPACT_POOL;
    this.ix[p] = x;
    this.iy[p] = y;
    this.iz[p] = z;
    this.iAge[p] = 0;
  }

  private splash(x: number, y: number, z: number, size: number): void {
    const p = this.splashNext;
    this.splashNext = (p + 1) % SPLASH_POOL;
    this.px[p] = x;
    this.py[p] = y + 0.06;
    this.pz[p] = z;
    this.pSize[p] = size;
    this.pAge[p] = 0;
  }

  private streakColor(i: number, rgb: Float32Array): void {
    this.streakRgb[i * 3] = rgb[0];
    this.streakRgb[i * 3 + 1] = rgb[1];
    this.streakRgb[i * 3 + 2] = rgb[2];
  }
}
