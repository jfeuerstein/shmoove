/**
 * Labels over the map's points of interest: a small tag over a live thing the rider is near enough
 * to act on and can see, with its name and, in a few words, what to do with it. `CRATE`,
 * `GOLD CRATE`, `SHRINE · ride in`, `GATES 2/5` (over the gate that is next), `HOOP · jump through`,
 * `TOTEM · calls elites`.
 *
 * At most `LABEL_MAX` at once, the nearest first; only within `LABEL_RANGE` of the rider and in
 * frame; never over the rider, the top HUD or the build bar, nor over one another; none while a
 * card, the end card or the pause sheet is up (the run is not in play, or the sheet is open).
 *
 * Which labels show, where, and what they say is the pure `pickLabels`; `ThingLabels` only applies
 * it to a fixed pool of elements, writing a text or a style only when it changes.
 */
import { Matrix4, type Camera } from 'three';
import { PALETTE } from '../render/look';
import { HOOP_RADIUS, PILLAR_HIGH, POST_HIGH, TOTEM_HIGH } from '../render/thingsView';
import { HOOP_TAKEN } from '../sim/things';
import {
  MAX_THINGS,
  PHASE_PLAY,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from '../sim/world';
import { project, type Projected } from './threat';
import './thingLabels.css';

/** A thing further than this from the rider has no label, m (across the ground). */
export const LABEL_RANGE = 35;
/** Most labels at once. */
export const LABEL_MAX = 3;
/** The top of the screen kept clear for the HUD (clock, kills, boss bar), CSS px. */
export const LABEL_TOP = 100;
/** The bottom of the screen kept clear for the build bar and the XP bar, CSS px. */
export const LABEL_BOTTOM = 112;
/** A label is about this big, CSS px: used to keep it off the rider, the edges and other labels. */
export const LABEL_W = 132;
export const LABEL_H = 24;
/** Kept clear round the rider on screen: this far to either side and above its head, CSS px. */
const RIDER_SIDE = 46;
const RIDER_ABOVE = 40;
/** The rider's height on screen is taken from its feet to this high, m. */
const RIDER_HIGH = 1.9;
/** Labels keep this far inside the left and right edges, CSS px. */
const SIDE_MARGIN = 6;

/** What a label says: its name, and what to do (may be empty). */
export interface Label {
  readonly name: string;
  readonly hint: string;
  /** The whole line, as the player reads it. */
  readonly text: string;
}

function label(name: string, hint = ''): Label {
  return { name, hint, text: hint === '' ? name : `${name} · ${hint}` };
}

const CRATE_LABEL = label('CRATE');
const GOLD_LABEL = label('GOLD CRATE');
const SHRINE_LABEL = label('SHRINE', 'ride in');
const HOOP_LABEL = label('HOOP', 'jump through');
const TOTEM_LABEL = label('TOTEM', 'calls elites');
/** Slaloms of up to this many gates have their labels made ahead. */
const MAX_GATES = 12;
/** `GATES done/n`, made once: GATE_LABELS[n][done]. */
const GATE_LABELS: Label[][] = [];
for (let n = 0; n <= MAX_GATES; n++) {
  const row: Label[] = [];
  for (let d = 0; d <= n; d++) row.push(label(`GATES ${d}/${n}`));
  GATE_LABELS.push(row);
}

/** How high over a thing's foot its label sits, m: a little over the top of what is drawn. */
function liftOf(kind: number): number {
  switch (kind) {
    case THING_GOLD_CRATE:
      return 2.6;
    case THING_SHRINE:
      return PILLAR_HIGH + 2.2;
    case THING_GATE:
      return POST_HIGH + 0.2;
    case THING_HOOP:
      return HOOP_RADIUS + 0.9;
    case THING_TOTEM:
      return TOTEM_HIGH + 2;
    default:
      return 2;
  }
}

/**
 * What thing i's label says, or null if it has none now: spent, a hoop not back yet, or a gate
 * that is not the next of its slalom.
 */
export function labelOf(w: World, i: number): Label | null {
  const t = w.things;
  const kind = t.kind[i];
  const state = t.state[i];
  if (state === THING_DONE) return null;
  switch (kind) {
    case THING_CRATE:
      return CRATE_LABEL;
    case THING_GOLD_CRATE:
      return GOLD_LABEL;
    case THING_SHRINE:
      return SHRINE_LABEL;
    case THING_TOTEM:
      return TOTEM_LABEL;
    case THING_HOOP:
      return state === HOOP_TAKEN ? null : HOOP_LABEL;
    case THING_GATE: {
      // The gates of one slalom are contiguous and share a group: find this one's place and the count.
      const g = t.group[i];
      let first = i;
      while (first > 0 && t.kind[first - 1] === THING_GATE && t.group[first - 1] === g) first--;
      if (i - first !== state) return null;
      let n = i - first + 1;
      while (first + n < t.count && t.kind[first + n] === THING_GATE && t.group[first + n] === g) n++;
      if (n > MAX_GATES) return null;
      return GATE_LABELS[n][state];
    }
    default:
      return null;
  }
}

/** The labels to show this frame. */
export interface LabelPicks {
  count: number;
  /** Which thing each is over, and where its foot (the bottom middle of the tag) goes, CSS px. */
  readonly thing: Int32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly label: (Label | null)[];
}

export function makeLabelPicks(): LabelPicks {
  return {
    count: 0,
    thing: new Int32Array(LABEL_MAX),
    x: new Float32Array(LABEL_MAX),
    y: new Float32Array(LABEL_MAX),
    label: new Array<Label | null>(LABEL_MAX).fill(null),
  };
}

/** Where the rider is, and the frame it is seen in. */
export interface LabelView {
  /** The rider's feet, m. */
  mx: number;
  my: number;
  mz: number;
  /** World to clip, column-major. */
  viewProj: ArrayLike<number>;
  /** The screen, CSS px. */
  width: number;
  height: number;
}

// Scratch for the pick, kept between calls: nothing is allocated per frame.
const order = new Int32Array(MAX_THINGS);
const dist2 = new Float32Array(MAX_THINGS);
const p: Projected = { x: 0, y: 0, w: 0 };

/**
 * Which labels show: live labelled things within `LABEL_RANGE` of the rider, nearest first, whose
 * tag lands in frame clear of the HUD, the build bar, the rider and the labels already chosen; at
 * most `LABEL_MAX`. None unless the run is in play.
 */
export function pickLabels(w: World, v: LabelView, out: LabelPicks): void {
  out.count = 0;
  for (let k = 0; k < LABEL_MAX; k++) out.label[k] = null;
  if (w.run.phase !== PHASE_PLAY) return;
  const t = w.things;
  const r2 = LABEL_RANGE * LABEL_RANGE;
  // The near enough, in order of distance (insertion: there are few).
  let n = 0;
  for (let i = 0; i < t.count; i++) {
    const dx = t.x[i] - v.mx;
    const dz = t.z[i] - v.mz;
    const d = dx * dx + dz * dz;
    if (d > r2 || labelOf(w, i) === null) continue;
    let j = n++;
    while (j > 0 && dist2[j - 1] > d) {
      dist2[j] = dist2[j - 1];
      order[j] = order[j - 1];
      j--;
    }
    dist2[j] = d;
    order[j] = i;
  }
  if (n === 0) return;

  // The rider on screen: from its feet to over its head.
  let riderX = Number.NaN;
  let riderTop = 0;
  let riderBottom = 0;
  if (project(v.viewProj, v.mx, v.my, v.mz, p) || p.w > 0) {
    riderX = ((p.x + 1) / 2) * v.width;
    riderBottom = ((1 - p.y) / 2) * v.height;
    project(v.viewProj, v.mx, v.my + RIDER_HIGH, v.mz, p);
    riderTop = ((1 - p.y) / 2) * v.height - RIDER_ABOVE;
  }

  const halfW = LABEL_W / 2;
  for (let k = 0; k < n && out.count < LABEL_MAX; k++) {
    const i = order[k];
    if (!project(v.viewProj, t.x[i], t.y[i] + liftOf(t.kind[i]), t.z[i], p)) continue;
    const sx = ((p.x + 1) / 2) * v.width;
    const sy = ((1 - p.y) / 2) * v.height;
    // The tag stands on (sx, sy): its box is [sx - halfW, sx + halfW] by [sy - LABEL_H, sy].
    if (sy - LABEL_H < LABEL_TOP || sy > v.height - LABEL_BOTTOM) continue;
    // Pulled in from the sides rather than cut off.
    const x = Math.min(v.width - SIDE_MARGIN - halfW, Math.max(SIDE_MARGIN + halfW, sx));
    if (riderX === riderX && Math.abs(x - riderX) < halfW + RIDER_SIDE && sy > riderTop && sy - LABEL_H < riderBottom) continue;
    let clear = true;
    for (let c = 0; c < out.count && clear; c++) {
      if (Math.abs(out.x[c] - x) < LABEL_W && Math.abs(out.y[c] - sy) < LABEL_H) clear = false;
    }
    if (!clear) continue;
    const c = out.count++;
    out.thing[c] = i;
    out.x[c] = x;
    out.y[c] = sy;
    out.label[c] = labelOf(w, i);
  }
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export class ThingLabels {
  readonly element: HTMLElement;
  readonly picks = makeLabelPicks();
  private readonly tags: HTMLElement[] = [];
  private readonly names: HTMLElement[] = [];
  private readonly hints: HTMLElement[] = [];
  /** What each tag shows now, so nothing is written that has not changed. */
  private readonly shown: (Label | null)[] = new Array<Label | null>(LABEL_MAX).fill(null);
  private readonly px = new Int32Array(LABEL_MAX).fill(-99999);
  private readonly py = new Int32Array(LABEL_MAX).fill(-99999);
  private readonly on = new Uint8Array(LABEL_MAX);
  private readonly viewProj = new Matrix4();
  private readonly view: LabelView = { mx: 0, my: 0, mz: 0, viewProj: this.viewProj.elements, width: 0, height: 0 };

  /** `doc` is a seam so tests can build the pool over a fake element tree. */
  constructor(root: HTMLElement, doc: Document = document) {
    const el = doc.createElement('div');
    el.className = 'tl';
    // The gold every point of interest is drawn in.
    el.style.setProperty('--tl-gold', hex(PALETTE.things[THING_GOLD_CRATE]));
    for (let k = 0; k < LABEL_MAX; k++) {
      const tag = doc.createElement('div');
      tag.className = 'tl-tag';
      tag.hidden = true;
      const name = doc.createElement('b');
      name.className = 'tl-name';
      const hint = doc.createElement('span');
      hint.className = 'tl-hint';
      tag.appendChild(name);
      tag.appendChild(hint);
      el.appendChild(tag);
      this.tags.push(tag);
      this.names.push(name);
      this.hints.push(hint);
    }
    root.appendChild(el);
    this.element = el;
  }

  /** Once per frame, after the camera has been placed: the rider's feet at (mx, my, mz). */
  update(w: World, camera: Camera, mx: number, my: number, mz: number, width: number, height: number): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const v = this.view;
    v.mx = mx;
    v.my = my;
    v.mz = mz;
    v.width = width;
    v.height = height;
    this.apply(w, v);
  }

  /** The same with the frame already worked out. */
  apply(w: World, v: LabelView): void {
    pickLabels(w, v, this.picks);
    const pk = this.picks;
    for (let k = 0; k < LABEL_MAX; k++) {
      const l = k < pk.count ? pk.label[k] : null;
      const tag = this.tags[k];
      if (l === null) {
        if (this.on[k]) {
          this.on[k] = 0;
          tag.hidden = true;
        }
        continue;
      }
      if (l !== this.shown[k]) {
        this.shown[k] = l;
        this.names[k].textContent = l.name;
        this.hints[k].textContent = l.hint;
        this.hints[k].hidden = l.hint === '';
      }
      const x = Math.round(pk.x[k]);
      const y = Math.round(pk.y[k]);
      if (x !== this.px[k] || y !== this.py[k]) {
        this.px[k] = x;
        this.py[k] = y;
        tag.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      if (!this.on[k]) {
        this.on[k] = 1;
        tag.hidden = false;
      }
    }
  }

  /** Labels on screen now. */
  get active(): number {
    let n = 0;
    for (let k = 0; k < LABEL_MAX; k++) n += this.on[k];
    return n;
  }
}
