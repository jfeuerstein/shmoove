/**
 * Screen-edge cues for what the narrow portrait frame cannot show.
 *
 * - A thin glow along the bottom and lower sides in `PALETTE.threat`, as strong as the number of
 *   risen enemies within `THREAT_RANGE` of the mover that are behind it or outside the frame and
 *   closing on it, smoothed over about a third of a second. Red means "now": an enemy the rider is
 *   outrunning, or one it can see coming, lights nothing, and with none the glow is gone.
 * - The rider's place on the screen, each frame, in `riderOnScreen` (the damage numbers keep off it).
 * - For each bollard within `MARKER_RANGE` that is off screen (the nearest `MARKER_POOL` of them),
 *   a chevron pinned to the screen edge, pointing at it.
 * - The flash at the edges after a hit (strength from the effects view: `hitWash`).
 * - While a boss is alive and outside the frame, one bigger marker on the edge pointing at it, in
 *   that boss's colour; it pulses hard while the Bruiser tells or charges. It is its own element,
 *   never one of the bollards' pool.
 * - When the front of a Standstill ring is out of frame or behind the rider, the rider is still
 *   outside it, and it will reach the rider within `RING_CUE_SECONDS`: a cue on the edge toward the
 *   ring's centre in `PALETTE.ring`, growing as it nears. One at a time: the nearest front.
 *
 * Which enemies count, where a marker sits, when the boss marker shows and pulses and how strong the
 * ring cue is are pure functions below; `ThreatView` only applies them to the DOM, writing a style
 * only when its value changes.
 */
import { Color, Matrix4, type Camera } from 'three';
import { PALETTE } from '../render/look';
import { BOSS, BRUISER_CHARGE, BRUISER_TELL, findBoss } from '../sim/bosses';
import type { SimState } from '../sim/types';
import { KIND_BOLLARD, KIND_BRUISER, KINDS, SPAWN_TICKS, ZONE_RING, type World } from '../sim/world';
import './threat.css';

/** Enemies nearer than this, behind you or out of frame and closing, light the glow, m. */
export const THREAT_RANGE = 10;
/** This many such enemies light it fully. */
export const THREAT_FULL = 6;
/** An enemy counts as closing when the gap to the rider shrinks faster than this, m/s. */
export const CLOSING_SPEED = 0.5;
/** Seconds the glow takes to follow (time constant). */
export const THREAT_SMOOTH = 0.33;
/** Bollards nearer than this get an edge marker when off screen, m. */
export const MARKER_RANGE = 60;
export const MARKER_POOL = 6;
/** Markers sit this far inside the screen edge, CSS px. */
export const MARKER_MARGIN = 26;
/** The boss marker sits further in than a bollard's: it is bigger. */
export const BOSS_MARGIN = 34;
/** A ring's front this many seconds or less from reaching the rider gets a cue. */
export const RING_CUE_SECONDS = 1.2;
/** The ring cue's size at its faintest (furthest) and its strength steps. */
const RING_CUE_MIN = 0.35;
/** How far round the rider counts as its own space on the screen, m. */
export const RIDER_CLEAR = 2;
/** Height on an enemy that is tested against the frame, m. */
const AIM_HEIGHT = 0.9;
const BOLLARD_AIM_HEIGHT = 1.2;

export interface Projected {
  /** Normalised device coordinates, -1..1 inside the frame (y up). */
  x: number;
  y: number;
  /** Clip w: positive in front of the camera. */
  w: number;
}

/** Project (x, y, z) by a column-major view-projection matrix. True when it lands inside the frame. */
export function project(m: ArrayLike<number>, x: number, y: number, z: number, out: Projected): boolean {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  out.w = cw;
  if (cw <= 1e-6) {
    out.x = 0;
    out.y = 0;
    return false;
  }
  out.x = cx / cw;
  out.y = cy / cw;
  return out.x >= -1 && out.x <= 1 && out.y >= -1 && out.y <= 1;
}

/** How far (dx, dz) lies ahead along the view yaw: forward(yaw) = (sin yaw, cos yaw). */
export function aheadOf(dx: number, dz: number, yaw: number): number {
  return dx * Math.sin(yaw) + dz * Math.cos(yaw);
}

/** How far (dx, dz) lies to the right as seen along the view yaw (turning left from +z is toward +x). */
export function rightOf(dx: number, dz: number, yaw: number): number {
  return -dx * Math.cos(yaw) + dz * Math.sin(yaw);
}

/**
 * Is an enemy at (dx, dz) from the mover, moving at (rvx, rvz) relative to it, closing: is the gap
 * between them shrinking faster than `CLOSING_SPEED`?
 */
export function isClosing(dx: number, dz: number, rvx: number, rvz: number): boolean {
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return true;
  return -(dx * rvx + dz * rvz) / d > CLOSING_SPEED;
}

/**
 * Does an enemy at (dx, dz) from the mover count toward the glow? Near, unseen (behind or out of
 * frame) and closing.
 */
export function isThreat(dx: number, dz: number, yaw: number, inFrame: boolean, closing: boolean): boolean {
  if (!closing) return false;
  if (dx * dx + dz * dz > THREAT_RANGE * THREAT_RANGE) return false;
  return aheadOf(dx, dz, yaw) < 0 || !inFrame;
}

/** The glow's target strength, 0..1, for `n` enemies near, unseen and closing. */
export function glowTarget(n: number): number {
  return n <= 0 ? 0 : Math.min(1, n / THREAT_FULL);
}

/**
 * Where the rider is on the screen this frame, CSS px, and roughly how far 2 m round it reaches
 * there (`r`, px): written by `ThreatView.update`, read by the damage numbers to keep off the rider.
 * `known` is false until the first frame.
 */
export const riderOnScreen = { x: 0, y: 0, r: 0, known: false };

const scratch: Projected = { x: 0, y: 0, w: 0 };

/**
 * Risen enemies within range of the mover that are behind it or out of the frame and closing on it;
 * (mvx, mvz) is the mover's velocity.
 */
export function threatCount(
  w: World,
  mx: number,
  mz: number,
  yaw: number,
  viewProj: ArrayLike<number>,
  mvx = 0,
  mvz = 0,
): number {
  const h = w.horde;
  const r2 = THREAT_RANGE * THREAT_RANGE;
  let n = 0;
  for (let i = 0; i < h.count; i++) {
    if (h.age[i] < SPAWN_TICKS || h.hp[i] <= 0) continue;
    const dx = h.x[i] - mx;
    const dz = h.z[i] - mz;
    if (dx * dx + dz * dz > r2) continue;
    const closing = isClosing(dx, dz, h.vx[i] - mvx, h.vz[i] - mvz);
    if (!closing) continue;
    const inFrame = project(viewProj, h.x[i], h.y[i] + AIM_HEIGHT, h.z[i], scratch);
    if (isThreat(dx, dz, yaw, inFrame, closing)) n++;
  }
  return n;
}

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface MarkerPlace {
  /** CSS px from the top left of the screen. */
  x: number;
  y: number;
  /** Clockwise from pointing up, rad. */
  angle: number;
  edge: Edge;
}

/**
 * Where a marker for something `right` and `forward` of the mover (in the view's frame, m) sits:
 * on the ray from the mover's place on screen (ox, oy) toward it, where that ray meets the screen
 * rectangle inset by `margin`. Forward is up the screen, right is right.
 */
export function placeMarker(
  right: number,
  forward: number,
  ox: number,
  oy: number,
  width: number,
  height: number,
  margin: number,
  out: MarkerPlace,
): void {
  const x0 = margin;
  const x1 = Math.max(margin, width - margin);
  const y0 = margin;
  const y1 = Math.max(margin, height - margin);
  const px = Math.min(x1, Math.max(x0, ox));
  const py = Math.min(y1, Math.max(y0, oy));
  const dx = right;
  let dy = -forward;
  if (dx * dx + dy * dy < 1e-12) dy = 1;
  let t = Infinity;
  let edge: Edge = 'bottom';
  if (dx > 0) {
    const k = (x1 - px) / dx;
    if (k < t) {
      t = k;
      edge = 'right';
    }
  } else if (dx < 0) {
    const k = (x0 - px) / dx;
    if (k < t) {
      t = k;
      edge = 'left';
    }
  }
  if (dy > 0) {
    const k = (y1 - py) / dy;
    if (k < t) {
      t = k;
      edge = 'bottom';
    }
  } else if (dy < 0) {
    const k = (y0 - py) / dy;
    if (k < t) {
      t = k;
      edge = 'top';
    }
  }
  if (!Number.isFinite(t)) t = 0;
  out.x = px + dx * t;
  out.y = py + dy * t;
  out.angle = Math.atan2(dx, -dy);
  out.edge = edge;
}

/** Should the boss marker show: a boss is alive (`kind` >= 0) and nothing of it is in frame? */
export function bossMarkerShown(kind: number, inFrame: boolean): boolean {
  return kind >= 0 && !inFrame;
}

/** Does the boss marker pulse: the Bruiser is telling or charging (`state` is its phase)? */
export function bossMarkerPulses(kind: number, state: number): boolean {
  return kind === KIND_BRUISER && (state === BRUISER_TELL || state === BRUISER_CHARGE);
}

/**
 * How strongly a ring's front gets a cue, 0 (none) to 1: `dist` is the rider's distance from the
 * ring's centre, `front` the front's radius, `ahead` how far the centre lies ahead of the rider
 * along the view (the front reaches the rider from that side), and `inFrame` whether the part of
 * the front coming at the rider is in the frame. Only a front the rider has not seen (out of
 * frame, or behind) that it is still outside of and that will reach it within `RING_CUE_SECONDS`
 * counts; the cue grows as the front nears.
 */
export function ringCueStrength(dist: number, front: number, ahead: number, inFrame: boolean): number {
  const gap = dist - front;
  if (gap <= 0) return 0;
  const t = gap / BOSS.standstill.ringSpeed;
  if (t > RING_CUE_SECONDS) return 0;
  if (inFrame && ahead >= 0) return 0;
  return RING_CUE_MIN + (1 - RING_CUE_MIN) * (1 - t / RING_CUE_SECONDS);
}

/** A palette colour as CSS "r, g, b", exactly as written (no colour-space conversion), as the boss bar shows it. */
function hexRgb(hex: number): string {
  return `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;
}

function cssRgb(hex: number): string {
  const c = new Color(hex);
  return `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
}

/** Glow and tint opacities are written in steps of this. */
const OPACITY_STEP = 0.02;

export class ThreatView {
  readonly element: HTMLElement;
  /** The glow's smoothed strength, 0..1. */
  strength = 0;
  /** Markers shown last frame. */
  shown = 0;

  /** Is the boss marker up, and is a ring cue (its strength, 0 for none)? For tests. */
  bossShown = false;
  bossPulse = false;
  ringCue = 0;

  private readonly glow: HTMLElement;
  private readonly hit: HTMLElement;
  private readonly bossEl: HTMLElement;
  private readonly ringEl: HTMLElement;
  private bossKind = -1;
  private bossPulseShown = false;
  private readonly bossKey = new Int32Array(3).fill(-99999);
  private readonly ringKey = new Int32Array(4).fill(-99999);
  private readonly markers: HTMLElement[] = [];
  private readonly markerKey = new Int32Array(MARKER_POOL * 3).fill(-99999);
  private readonly markerOn = new Uint8Array(MARKER_POOL);
  private glowShown = -1;
  private hitShown = -1;

  private readonly viewProj = new Matrix4();
  private readonly mover: Projected = { x: 0, y: 0, w: 0 };
  private readonly p: Projected = { x: 0, y: 0, w: 0 };
  private readonly place: MarkerPlace = { x: 0, y: 0, angle: 0, edge: 'bottom' };
  /** The nearest off-screen bollards this frame: index and squared distance, nearest first. */
  private readonly nearI = new Int32Array(MARKER_POOL);
  private readonly nearD = new Float64Array(MARKER_POOL);

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'threat';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.setProperty('--threat-rgb', cssRgb(PALETTE.threat));
    this.glow = doc.createElement('div');
    this.glow.className = 'threat-glow';
    this.glow.style.opacity = '0';
    this.hit = doc.createElement('div');
    this.hit.className = 'threat-hit';
    this.hit.style.opacity = '0';
    this.element.appendChild(this.glow);
    this.element.appendChild(this.hit);
    for (let i = 0; i < MARKER_POOL; i++) {
      const m = doc.createElement('div');
      m.className = 'threat-marker';
      m.hidden = true;
      this.element.appendChild(m);
      this.markers.push(m);
    }
    this.bossEl = doc.createElement('div');
    this.bossEl.className = 'threat-boss';
    this.bossEl.hidden = true;
    this.element.appendChild(this.bossEl);
    this.ringEl = doc.createElement('div');
    this.ringEl.className = 'threat-ring';
    this.ringEl.hidden = true;
    this.ringEl.style.setProperty('--ring-rgb', hexRgb(PALETTE.ring));
    this.element.appendChild(this.ringEl);
    root.appendChild(this.element);
  }

  /** Forget the last run: the glow and the wash start from nothing. */
  reset(): void {
    this.strength = 0;
    this.glow.style.opacity = '0';
    this.hit.style.opacity = '0';
    this.glowShown = 0;
    this.hitShown = 0;
    this.bossShown = false;
    this.bossEl.hidden = true;
    this.ringCue = 0;
    this.ringEl.hidden = true;
  }

  /**
   * `dt` real seconds since the last frame; `hitTint` 0..1 from the effects view; `width` and
   * `height` the screen in CSS px. Call after the camera has been placed for this frame.
   */
  update(w: World, s: SimState, camera: Camera, dt: number, hitTint: number, width: number, height: number): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const vp = this.viewProj.elements;
    const m = s.mover;
    const yaw = s.viewYaw;

    // Glow.
    const target = glowTarget(threatCount(w, m.x, m.z, yaw, vp, m.vx, m.vz));
    const k = dt > 0 ? 1 - Math.exp(-dt / THREAT_SMOOTH) : 0;
    this.strength += (target - this.strength) * k;
    // Gone, not lingering at a faint step above nothing.
    if (target === 0 && this.strength < OPACITY_STEP) this.strength = 0;
    const g = Math.round(this.strength / OPACITY_STEP);
    if (g !== this.glowShown) {
      this.glowShown = g;
      this.glow.style.opacity = String(g * OPACITY_STEP);
    }
    const t = Math.round(Math.min(1, Math.max(0, hitTint)) / OPACITY_STEP);
    if (t !== this.hitShown) {
      this.hitShown = t;
      this.hit.style.opacity = String(t * OPACITY_STEP);
    }

    // Markers: the nearest off-screen bollards.
    const h = w.horde;
    let n = 0;
    const r2 = MARKER_RANGE * MARKER_RANGE;
    for (let i = 0; i < h.count; i++) {
      if (h.kind[i] !== KIND_BOLLARD || h.age[i] < SPAWN_TICKS || h.hp[i] <= 0) continue;
      const dx = h.x[i] - m.x;
      const dz = h.z[i] - m.z;
      const d = dx * dx + dz * dz;
      if (d > r2) continue;
      if (project(vp, h.x[i], h.y[i] + BOLLARD_AIM_HEIGHT, h.z[i], this.p)) continue;
      // Insert into the sorted short list.
      let j = n < MARKER_POOL ? n++ : MARKER_POOL;
      if (j === MARKER_POOL) {
        if (d >= this.nearD[MARKER_POOL - 1]) continue;
        j = MARKER_POOL - 1;
      }
      while (j > 0 && this.nearD[j - 1] > d) {
        this.nearD[j] = this.nearD[j - 1];
        this.nearI[j] = this.nearI[j - 1];
        j--;
      }
      this.nearD[j] = d;
      this.nearI[j] = i;
    }

    let ox = width * 0.5;
    let oy = height * 0.6;
    if (project(vp, m.x, m.y + 0.8, m.z, this.mover) || this.mover.w > 0) {
      ox = ((this.mover.x + 1) / 2) * width;
      oy = ((1 - this.mover.y) / 2) * height;
      // 2 m at the rider's distance, in px: the projection's x scale over clip w.
      const px = camera.projectionMatrix.elements[0];
      riderOnScreen.r = this.mover.w > 1e-6 ? ((px * RIDER_CLEAR) / this.mover.w) * (width / 2) : 0;
    }
    riderOnScreen.x = ox;
    riderOnScreen.y = oy;
    riderOnScreen.known = true;
    for (let q = 0; q < MARKER_POOL; q++) {
      const el = this.markers[q];
      if (q >= n) {
        if (this.markerOn[q]) {
          this.markerOn[q] = 0;
          el.hidden = true;
        }
        continue;
      }
      const i = this.nearI[q];
      const dx = h.x[i] - m.x;
      const dz = h.z[i] - m.z;
      placeMarker(rightOf(dx, dz, yaw), aheadOf(dx, dz, yaw), ox, oy, width, height, MARKER_MARGIN, this.place);
      if (!this.markerOn[q]) {
        this.markerOn[q] = 1;
        el.hidden = false;
      }
      const kx = Math.round(this.place.x);
      const ky = Math.round(this.place.y);
      const ka = Math.round(this.place.angle * 20);
      const o = q * 3;
      if (kx !== this.markerKey[o] || ky !== this.markerKey[o + 1] || ka !== this.markerKey[o + 2]) {
        this.markerKey[o] = kx;
        this.markerKey[o + 1] = ky;
        this.markerKey[o + 2] = ka;
        el.style.transform = `translate3d(${kx}px, ${ky}px, 0) rotate(${ka / 20}rad)`;
      }
    }
    this.shown = n;

    this.updateBoss(w, s, vp, ox, oy, width, height);
    this.updateRing(w, s, vp, ox, oy, width, height);
  }

  /** The boss marker: up while a boss is alive and out of frame, pointing at it. */
  private updateBoss(w: World, s: SimState, vp: ArrayLike<number>, ox: number, oy: number, width: number, height: number): void {
    const i = w.boss.kind >= 0 ? findBoss(w) : -1;
    const h = w.horde;
    const kind = i >= 0 ? h.kind[i] : -1;
    let inFrame = false;
    if (kind >= 0) {
      const def = KINDS[kind];
      // Any of its foot, its middle or its top in frame counts as seen.
      inFrame =
        project(vp, h.x[i], h.y[i] + 0.3, h.z[i], this.p) ||
        project(vp, h.x[i], h.y[i] + def.height * 0.5, h.z[i], this.p) ||
        project(vp, h.x[i], h.y[i] + def.height, h.z[i], this.p);
    }
    const show = bossMarkerShown(kind, inFrame);
    if (show !== this.bossShown) {
      this.bossShown = show;
      this.bossEl.hidden = !show;
    }
    if (!show) return;
    if (kind !== this.bossKind) {
      this.bossKind = kind;
      const c = PALETTE.bosses[kind - KIND_BRUISER] ?? PALETTE.threat;
      this.bossEl.style.setProperty('--boss-rgb', hexRgb(c));
    }
    const pulse = bossMarkerPulses(kind, h.state[i]);
    this.bossPulse = pulse;
    if (pulse !== this.bossPulseShown) {
      this.bossPulseShown = pulse;
      this.bossEl.className = pulse ? 'threat-boss threat-boss-pulse' : 'threat-boss';
    }
    const m = s.mover;
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    placeMarker(rightOf(dx, dz, s.viewYaw), aheadOf(dx, dz, s.viewYaw), ox, oy, width, height, BOSS_MARGIN, this.place);
    this.move(this.bossEl, this.bossKey, this.place, -1);
  }

  /** The ring cue: for the nearest unseen front that will reach the rider soon. */
  private updateRing(w: World, s: SimState, vp: ArrayLike<number>, ox: number, oy: number, width: number, height: number): void {
    const zn = w.zones;
    const m = s.mover;
    const yaw = s.viewYaw;
    let best = 0;
    let bestGap = Infinity;
    let bx = 0;
    let bz = 0;
    for (let k = 0; k < zn.count; k++) {
      if (zn.kind[k] !== ZONE_RING) continue;
      const cx = zn.x[k] - m.x;
      const cz = zn.z[k] - m.z;
      const d = Math.sqrt(cx * cx + cz * cz);
      const r = zn.r[k];
      const gap = d - r;
      if (gap <= 0 || gap >= bestGap) continue;
      // The part of the front coming at the rider: on the line from the centre to the rider.
      const f = d > 1e-6 ? r / d : 0;
      const fx = zn.x[k] - cx * f;
      const fz = zn.z[k] - cz * f;
      const inFrame = project(vp, fx, m.y + 0.2, fz, this.p);
      const strength = ringCueStrength(d, r, aheadOf(cx, cz, yaw), inFrame);
      if (strength <= 0) continue;
      best = strength;
      bestGap = gap;
      bx = cx;
      bz = cz;
    }
    this.ringCue = best;
    const show = best > 0;
    if (show === this.ringEl.hidden) this.ringEl.hidden = !show;
    if (!show) return;
    placeMarker(rightOf(bx, bz, yaw), aheadOf(bx, bz, yaw), ox, oy, width, height, MARKER_MARGIN, this.place);
    this.move(this.ringEl, this.ringKey, this.place, Math.round(best * 20));
  }

  /** Put a marker element at a place, writing only what changed; `size` in twentieths, or -1 for none. */
  private move(el: HTMLElement, key: Int32Array, place: MarkerPlace, size: number): void {
    const kx = Math.round(place.x);
    const ky = Math.round(place.y);
    const ka = Math.round(place.angle * 20);
    if (kx !== key[0] || ky !== key[1] || ka !== key[2]) {
      key[0] = kx;
      key[1] = ky;
      key[2] = ka;
      el.style.transform = `translate3d(${kx}px, ${ky}px, 0) rotate(${ka / 20}rad)`;
    }
    if (size >= 0 && size !== key[3]) {
      key[3] = size;
      el.style.setProperty('--cue', String(size / 20));
    }
  }
}
