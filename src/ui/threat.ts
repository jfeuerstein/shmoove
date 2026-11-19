/**
 * Screen-edge cues for what the narrow portrait frame cannot show.
 *
 * - A glow along the bottom and lower sides in `PALETTE.threat`, as strong as the number of risen
 *   enemies within `THREAT_RANGE` of the mover that are behind it or outside the frame, smoothed
 *   over about a third of a second.
 * - For each bollard within `MARKER_RANGE` that is off screen (the nearest `MARKER_POOL` of them),
 *   a chevron pinned to the screen edge, pointing at it.
 * - The red wash after a hit (strength from the effects view).
 *
 * Which enemies count and where a marker sits are pure functions below; `ThreatView` only applies
 * them to the DOM, writing a style only when its value changes.
 */
import { Color, Matrix4, type Camera } from 'three';
import { PALETTE } from '../render/look';
import type { SimState } from '../sim/types';
import { KIND_BOLLARD, SPAWN_TICKS, type World } from '../sim/world';
import './threat.css';

/** Enemies nearer than this, behind you or out of frame, light the glow, m. */
export const THREAT_RANGE = 14;
/** This many such enemies light it fully. */
export const THREAT_FULL = 6;
/** Seconds the glow takes to follow (time constant). */
export const THREAT_SMOOTH = 0.33;
/** Bollards nearer than this get an edge marker when off screen, m. */
export const MARKER_RANGE = 60;
export const MARKER_POOL = 6;
/** Markers sit this far inside the screen edge, CSS px. */
export const MARKER_MARGIN = 26;
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

/** Does an enemy at (dx, dz) from the mover count toward the glow? */
export function isThreat(dx: number, dz: number, yaw: number, inFrame: boolean): boolean {
  if (dx * dx + dz * dz > THREAT_RANGE * THREAT_RANGE) return false;
  return aheadOf(dx, dz, yaw) < 0 || !inFrame;
}

const scratch: Projected = { x: 0, y: 0, w: 0 };

/** Risen enemies within range of the mover that are behind it or out of the frame. */
export function threatCount(w: World, mx: number, mz: number, yaw: number, viewProj: ArrayLike<number>): number {
  const h = w.horde;
  const r2 = THREAT_RANGE * THREAT_RANGE;
  let n = 0;
  for (let i = 0; i < h.count; i++) {
    if (h.age[i] < SPAWN_TICKS || h.hp[i] <= 0) continue;
    const dx = h.x[i] - mx;
    const dz = h.z[i] - mz;
    if (dx * dx + dz * dz > r2) continue;
    const inFrame = project(viewProj, h.x[i], h.y[i] + AIM_HEIGHT, h.z[i], scratch);
    if (isThreat(dx, dz, yaw, inFrame)) n++;
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

  private readonly glow: HTMLElement;
  private readonly hit: HTMLElement;
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
    root.appendChild(this.element);
  }

  /** Forget the last run: the glow and the wash start from nothing. */
  reset(): void {
    this.strength = 0;
    this.glow.style.opacity = '0';
    this.hit.style.opacity = '0';
    this.glowShown = 0;
    this.hitShown = 0;
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
    const target = Math.min(1, threatCount(w, m.x, m.z, yaw, vp) / THREAT_FULL);
    const k = dt > 0 ? 1 - Math.exp(-dt / THREAT_SMOOTH) : 0;
    this.strength += (target - this.strength) * k;
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
    }
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
  }
}
