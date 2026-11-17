/**
 * The two switchback roads. Each climbs from the docks boulevard through a stack of hairpins:
 * inner hairpins (apex at x = APEX_X) meet the end of every landing and pad, outer hairpins turn
 * near the world edge. Built with a turtle (straights and circular arcs), so every corner is a
 * true arc of known radius; heights are linear in arc length between knots.
 */
import { PI, dcos, dsin } from '../math';
import { APEX_X, BOULEVARD_Z, INNER_R, LEVELS, OUTER_X, PAD_TILT, docksHeight } from './layout';

export class Turtle {
  /** Flat x, z pairs at about `step` spacing. */
  readonly xz: number[] = [];
  x: number;
  z: number;
  /** Heading: direction (cos a, sin a) in (x, z). */
  a: number;
  readonly step: number;

  constructor(x: number, z: number, a: number, step = 1) {
    this.x = x;
    this.z = z;
    this.a = a;
    this.step = step;
    this.xz.push(x, z);
  }

  straight(len: number): this {
    const n = Math.max(1, Math.ceil(len / this.step));
    const dx = dcos(this.a);
    const dz = dsin(this.a);
    const x0 = this.x;
    const z0 = this.z;
    for (let i = 1; i <= n; i++) {
      this.x = x0 + (dx * len * i) / n;
      this.z = z0 + (dz * len * i) / n;
      this.xz.push(this.x, this.z);
    }
    return this;
  }

  /** Turn by `da` radians (positive = toward +z from +x) on a circle of radius r. */
  arc(r: number, da: number): this {
    const n = Math.max(2, Math.ceil((Math.abs(da) * r) / this.step));
    const left = da > 0;
    const s0 = dsin(this.a);
    const c0 = dcos(this.a);
    const cx = left ? this.x - r * s0 : this.x + r * s0;
    const cz = left ? this.z + r * c0 : this.z - r * c0;
    const a0 = this.a;
    for (let i = 1; i <= n; i++) {
      const a = a0 + (da * i) / n;
      const s = dsin(a);
      const c = dcos(a);
      this.x = left ? cx + r * s : cx - r * s;
      this.z = left ? cz - r * c : cz + r * c;
      this.xz.push(this.x, this.z);
    }
    this.a = a0 + da;
    return this;
  }
}

export interface Road {
  /** xyz triplets about 1 m apart, from the docks boulevard up to the top level's apex. */
  pts: number[];
  /** Arc position of each level's apex (index matches LEVELS). */
  apexS: number[];
  /** Arc length of the whole road. */
  length: number;
}

/** Where the climb starts: the road keeps the docks grade until it is this far up the hill. */
const CLIMB_START_Z = 286;
/** Arc length past each apex over which the road rises at the cross streets' gentle grade. */
const APEX_EASE = 12;

/** The east road; the west road is its mirror image (x -> -x). */
export function buildRoad(mirror: boolean): Road {
  const xIn = APEX_X + INNER_R;
  const firstLow = LEVELS[0].z - INNER_R;
  const rBottom = (firstLow - BOULEVARD_Z) / 2;
  const t = new Turtle(OUTER_X, BOULEVARD_Z, 0);
  // Out of the boulevard round the bottom outer hairpin.
  t.arc(rBottom, PI);
  t.straight(OUTER_X - xIn);
  const apexIdx: number[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    // Inner hairpin: half to the apex, then (unless this is the top) the other half.
    t.arc(INNER_R, -PI / 2);
    apexIdx.push(t.xz.length / 2 - 1);
    if (i === LEVELS.length - 1) break;
    t.arc(INNER_R, -PI / 2);
    t.straight(OUTER_X - xIn);
    const rOut = (LEVELS[i + 1].z - LEVELS[i].z - 2 * INNER_R) / 2;
    t.arc(rOut, PI);
    t.straight(OUTER_X - xIn);
  }
  const n = t.xz.length / 2;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dx = t.xz[i * 2] - t.xz[i * 2 - 2];
    const dz = t.xz[i * 2 + 1] - t.xz[i * 2 - 1];
    s[i] = s[i - 1] + Math.sqrt(dx * dx + dz * dz);
  }
  // Height knots: docks grade to CLIMB_START_Z, then linear between apexes.
  const knotS: number[] = [0];
  const knotY: number[] = [docksHeight(BOULEVARD_Z)];
  for (let i = 1; i < n; i++) {
    if (t.xz[i * 2 + 1] >= CLIMB_START_Z) {
      knotS.push(s[i]);
      knotY.push(docksHeight(CLIMB_START_Z));
      break;
    }
  }
  for (let i = 0; i < LEVELS.length; i++) {
    knotS.push(s[apexIdx[i]]);
    knotY.push(LEVELS[i].yEnd);
    // Past the apex the road rises only as gently as the street that meets it for a few metres,
    // so the street's fall carries on round the apex into the descending leg instead of meeting
    // the next climb head-on (which leaves a flat pocket at the street's end).
    if (i < LEVELS.length - 1) {
      knotS.push(s[apexIdx[i]] + APEX_EASE);
      knotY.push(LEVELS[i].yEnd + PAD_TILT * APEX_EASE);
    }
  }
  const pts: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < knotS.length - 2 && s[i] > knotS[k + 1]) k++;
    const f = Math.min(1, Math.max(0, (s[i] - knotS[k]) / (knotS[k + 1] - knotS[k])));
    // Along the docks the road follows the docks grade exactly.
    const z = t.xz[i * 2 + 1];
    const y = k === 0 ? docksHeight(z) : knotY[k] + (knotY[k + 1] - knotY[k]) * f;
    pts.push(mirror ? -t.xz[i * 2] : t.xz[i * 2], y, z);
  }
  return { pts, apexS: apexIdx.map((i) => s[i]), length: s[n - 1] };
}
