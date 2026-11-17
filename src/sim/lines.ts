/**
 * Ride lines. A line is a path with stops, vehicles and service hours. Where every vehicle is at
 * any tick is a pure function of the tick, so the timetable is deterministic and repeats daily.
 *
 * compileLine() drives one vehicle round one lap with a trapezoid speed profile and stores its arc
 * position for every tick of the lap. The lap is padded (longer wait at the terminus) so that its
 * period divides the day exactly.
 */
import { DAY_TICKS, DT } from './constants';
import type { District } from './world';

export type RideKind =
  | 'tram'
  | 'funicular'
  | 'forklift'
  | 'truck'
  | 'crane'
  | 'moped'
  | 'handcart'
  | 'parade'
  | 'bus'
  | 'cablecar'
  | 'kite'
  | 'blimp'
  | 'ghosttram';

export interface StopDef {
  /** Arc position along the path, metres. */
  s: number;
  name: string;
}

export interface Livery {
  /** 0xRRGGBB. */
  base: number;
  stripe: number;
  accent: number;
  /** 0 band, 1 chevrons, 2 checks, 3 diagonal, 4 dots, 5 zigzag. */
  pattern: number;
}

export interface LineDef {
  id: string;
  name: string;
  kind: RideKind;
  district: District;
  /** Which stem of the district track this line carries: 0 perc, 1 bass, 2 harmony, 3 lead. */
  stem: number;
  /** Polyline, xyz triplets. For a loop the last point must equal the first. */
  path: ArrayLike<number>;
  /** true: closed circuit. false: shuttle, out along the path and back the same way. */
  loop: boolean;
  /** Stops in increasing s. A terminus stop at s = 0 is implied (and at the far end for a shuttle). */
  stops: StopDef[];
  /** m/s. */
  cruise: number;
  /** m/s^2, used for both speeding up and braking. */
  accel: number;
  /** Seconds waited at each stop. */
  dwell: number;
  vehicles: number;
  /** Timetable offset in ticks: shifts every vehicle of the line along its lap. Default 0. */
  phase?: number;
  /** Service hours as [open, close) day fractions. close < open wraps past midnight. */
  windows: Array<[number, number]>;
  /** Vehicles vanish while waiting at the terminus (parade, blimp, ghost tram). */
  parkHidden?: boolean;
  /** Overhead ride: caught by its hanging strap rather than its bumper. */
  overhead: boolean;
  /** Grab anchor: metres behind the vehicle origin and above the path. */
  anchorBack: number;
  anchorY: number;
  /** Strap length hanging below the anchor (0 for bumper rides). */
  hang: number;
  /** Tow rope length: how far behind the grab point the skater trails, metres. */
  rope: number;
  /**
   * Collision body, centred on the vehicle origin: half length along travel, half width, height
   * above the path. Height 0 means no body (overhead rides). Bodies shove the skater aside, bail
   * them head-on, and bounce them off the roof.
   */
  bodyHalfLen: number;
  bodyHalfWid: number;
  bodyHeight: number;
  /** Can only be caught as at least this link of a chain (1 = no gate). */
  minChain?: number;
  /** Secret lines are left off the map until first ridden. */
  secret?: boolean;
  livery: Livery;
}

export interface CompiledLine extends LineDef {
  index: number;
  pathPts: Float64Array;
  /** Cumulative arc length at each path point. */
  cum: Float64Array;
  length: number;
  /** All stops including implied termini, in increasing s. */
  allStops: StopDef[];
  /** Ticks in one lap, a divisor of DAY_TICKS. */
  period: number;
  /** Ticks the lap takes before terminus padding. */
  runTicks: number;
  /** Arc position at each tick of the lap, lapS[0..period]. */
  lapS: Float32Array;
  /** +1 heading up the path, -1 heading back (shuttle return leg), per tick. */
  lapDir: Int8Array;
  /** Bounding box of the path (xz), for cheap reach rejection. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minChainN: number;
  phaseTicks: number;
  /** Unit horizontal direction of each path segment (xz pairs). A segment with no horizontal
   *  extent takes its neighbour's, so a heading never depends on which call came before. */
  segDir: Float64Array;
  /**
   * Memo of vehicleAt for the tick each vehicle was last asked about (created on first use). The
   * sim, the view, the UI and the audio all ask where the same vehicles are on the same tick; the
   * memo answers repeats with the same numbers instead of searching the path again.
   */
  vmemo?: VehicleMemo;
}

/** Per line: for each vehicle, the tick memoised (NaN for none) and its VehicleState fields. */
export interface VehicleMemo {
  /** The line this memo belongs to: a copy of a line (`{ ...line }`) must not answer from it. */
  owner: CompiledLine;
  tick: Float64Array;
  state: Float64Array;
}

/** Numbers stored per vehicle in a VehicleMemo. */
const MEMO_FIELDS = 12;

export interface VehicleState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Unit horizontal heading (direction of travel, or of last travel when stopped). */
  hx: number;
  hz: number;
  /** Arc position on the path. */
  s: number;
  /** +1 or -1 along the path. */
  dir: number;
  /** Tick within the lap. */
  lapTick: number;
}

export function makeVehicleState(): VehicleState {
  return { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hx: 0, hz: 1, s: 0, dir: 1, lapTick: 0 };
}

const PERIODS: number[] = [];
for (let d = 1; d <= DAY_TICKS; d++) if (DAY_TICKS % d === 0) PERIODS.push(d);

/** Smallest divisor of the day that is >= ticks. */
export function padPeriod(ticks: number): number {
  for (const p of PERIODS) if (p >= ticks) return p;
  return DAY_TICKS;
}

export function compileLine(def: LineDef, index: number): CompiledLine {
  const n = Math.floor(def.path.length / 3);
  if (n < 2) throw new Error(`line ${def.id}: path needs at least two points`);
  const pathPts = new Float64Array(n * 3);
  for (let i = 0; i < n * 3; i++) pathPts[i] = def.path[i];
  const cum = new Float64Array(n);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pathPts[i * 3];
    const z = pathPts[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (i > 0) {
      const dx = x - pathPts[i * 3 - 3];
      const dy = pathPts[i * 3 + 1] - pathPts[i * 3 - 2];
      const dz = z - pathPts[i * 3 - 1];
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  const length = cum[n - 1];
  // Per-segment headings, with vertical segments borrowing the nearest real direction.
  const segDir = new Float64Array(Math.max(1, n - 1) * 2);
  const hasDir = new Uint8Array(Math.max(1, n - 1));
  for (let i = 0; i < n - 1; i++) {
    const ex = pathPts[i * 3 + 3] - pathPts[i * 3];
    const ez = pathPts[i * 3 + 5] - pathPts[i * 3 + 2];
    const hl = Math.sqrt(ex * ex + ez * ez);
    if (hl > 1e-9) {
      segDir[i * 2] = ex / hl;
      segDir[i * 2 + 1] = ez / hl;
      hasDir[i] = 1;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (hasDir[i] === 1) continue;
    let j = -1;
    for (let d = 1; d < n && j < 0; d++) {
      if (i - d >= 0 && hasDir[i - d] === 1) j = i - d;
      else if (i + d < n - 1 && hasDir[i + d] === 1) j = i + d;
    }
    segDir[i * 2] = j >= 0 ? segDir[j * 2] : 0;
    segDir[i * 2 + 1] = j >= 0 ? segDir[j * 2 + 1] : 1;
  }
  if (def.loop) {
    const gap =
      Math.abs(pathPts[0] - pathPts[n * 3 - 3]) +
      Math.abs(pathPts[1] - pathPts[n * 3 - 2]) +
      Math.abs(pathPts[2] - pathPts[n * 3 - 1]);
    if (gap > 1e-3) throw new Error(`line ${def.id}: loop path must end where it starts`);
  }

  // Stops, with termini implied.
  const allStops: StopDef[] = [];
  const eps = 0.5;
  const sorted = def.stops.slice().sort((a, b) => a.s - b.s);
  if (sorted.length === 0 || sorted[0].s > eps) allStops.push({ s: 0, name: `${def.name} terminus` });
  for (const st of sorted) {
    if (st.s < -eps || st.s > length + eps) throw new Error(`line ${def.id}: stop ${st.name} is off the path`);
    allStops.push({ s: Math.min(Math.max(st.s, 0), length), name: st.name });
  }
  if (!def.loop && allStops[allStops.length - 1].s < length - eps) {
    allStops.push({ s: length, name: `${def.name} end` });
  }
  if (def.loop && allStops[allStops.length - 1].s > length - eps) allStops.pop();

  // Targets the vehicle drives to, in order, as [s, direction].
  const targets: number[] = [];
  const dirs: number[] = [];
  for (let i = 1; i < allStops.length; i++) {
    targets.push(allStops[i].s);
    dirs.push(1);
  }
  if (def.loop) {
    targets.push(length);
    dirs.push(1);
  } else {
    for (let i = allStops.length - 2; i >= 0; i--) {
      targets.push(allStops[i].s);
      dirs.push(-1);
    }
  }

  const dwellTicks = Math.max(1, Math.round(def.dwell / DT));
  const sLog: number[] = [];
  const dLog: number[] = [];
  let s = 0;
  let v = 0;
  let dir = 1;
  const wait = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      sLog.push(s);
      dLog.push(dir);
    }
  };
  wait(dwellTicks);
  for (let t = 0; t < targets.length; t++) {
    const target = targets[t];
    dir = dirs[t];
    let guard = 0;
    for (;;) {
      const dist = Math.abs(target - s);
      const brake = Math.sqrt(2 * def.accel * dist);
      v = Math.min(v + def.accel * DT, def.cruise, Math.max(brake, 0.3));
      if (v * DT >= dist) {
        s = target;
        v = 0;
        break;
      }
      s += dir * v * DT;
      sLog.push(s);
      dLog.push(dir);
      if (++guard > DAY_TICKS) throw new Error(`line ${def.id}: lap does not finish within a day`);
    }
    // Arrive, then dwell (the final terminus dwell is the lap padding plus the next lap's start).
    sLog.push(s);
    dLog.push(dir);
    if (t < targets.length - 1) wait(dwellTicks);
  }
  const runTicks = sLog.length;
  const period = padPeriod(runTicks);
  const lapS = new Float32Array(period + 1);
  const lapDir = new Int8Array(period + 1);
  const endS = def.loop ? length : 0;
  for (let i = 0; i <= period; i++) {
    lapS[i] = i < runTicks ? sLog[i] : endS;
    lapDir[i] = i < runTicks ? dLog[i] : dLog[runTicks - 1];
  }

  return {
    ...def,
    index,
    pathPts,
    cum,
    length,
    allStops,
    period,
    runTicks,
    lapS,
    lapDir,
    minX,
    maxX,
    minZ,
    maxZ,
    minChainN: def.minChain ?? 1,
    segDir,
    phaseTicks: (((def.phase ?? 0) % period) + period) % period,
  };
}

/** Day fraction in [0, 1) of an absolute tick. */
export function dayFrac(tick: number): number {
  const t = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  return t / DAY_TICKS;
}

export function inWindows(windows: ReadonlyArray<readonly [number, number]>, f: number): boolean {
  for (const w of windows) {
    if (w[0] <= w[1]) {
      if (f >= w[0] && f < w[1]) return true;
    } else if (f >= w[0] || f < w[1]) return true;
  }
  return false;
}

/** Tick within the lap of vehicle `i` at absolute tick `tick`. */
export function lapTickOf(line: CompiledLine, i: number, tick: number): number {
  const day = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  const offset = Math.floor((i * line.period) / line.vehicles) + line.phaseTicks;
  return (day + offset) % line.period;
}

const _a = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
const _b = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };

/** Position on the path at arc position s, plus the horizontal direction of that segment. */
export function pathAt(
  line: CompiledLine,
  s: number,
  out: { x: number; y: number; z: number; hx: number; hz: number },
): void {
  const cum = line.cum;
  const n = cum.length;
  if (s <= 0) s = 0;
  else if (s >= line.length) s = line.length;
  let lo = 0;
  let hi = n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  const p = line.pathPts;
  const i = lo * 3;
  const ex = p[i + 3] - p[i];
  const ey = p[i + 4] - p[i + 1];
  const ez = p[i + 5] - p[i + 2];
  out.x = p[i] + ex * t;
  out.y = p[i + 1] + ey * t;
  out.z = p[i + 2] + ez * t;
  out.hx = line.segDir[lo * 2];
  out.hz = line.segDir[lo * 2 + 1];
}

/**
 * Where vehicle `i` of `line` is at absolute tick `tick`. Pure: a repeat for the same vehicle and
 * tick is answered from the line's memo with exactly the numbers the first call computed.
 */
export function vehicleAt(line: CompiledLine, i: number, tick: number, out: VehicleState): void {
  let memo = line.vmemo;
  if (memo === undefined || memo.owner !== line) {
    memo = { owner: line, tick: new Float64Array(line.vehicles).fill(Number.NaN), state: new Float64Array(line.vehicles * MEMO_FIELDS) };
    line.vmemo = memo;
  }
  const m = memo.state;
  const k = i * MEMO_FIELDS;
  if (memo.tick[i] === tick) {
    out.active = m[k] === 1;
    out.x = m[k + 1];
    out.y = m[k + 2];
    out.z = m[k + 3];
    out.vx = m[k + 4];
    out.vy = m[k + 5];
    out.vz = m[k + 6];
    out.hx = m[k + 7];
    out.hz = m[k + 8];
    out.s = m[k + 9];
    out.dir = m[k + 10];
    out.lapTick = m[k + 11];
    return;
  }
  computeVehicle(line, i, tick, out);
  if (i >= 0 && i < line.vehicles && Number.isInteger(i)) {
    memo.tick[i] = tick;
    m[k] = out.active ? 1 : 0;
    m[k + 1] = out.x;
    m[k + 2] = out.y;
    m[k + 3] = out.z;
    m[k + 4] = out.vx;
    m[k + 5] = out.vy;
    m[k + 6] = out.vz;
    m[k + 7] = out.hx;
    m[k + 8] = out.hz;
    m[k + 9] = out.s;
    m[k + 10] = out.dir;
    m[k + 11] = out.lapTick;
  }
}

/** vehicleAt without the memo (the memo stores what this computes). */
export function computeVehicle(line: CompiledLine, i: number, tick: number, out: VehicleState): void {
  const day = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  const offset = Math.floor((i * line.period) / line.vehicles) + line.phaseTicks;
  const lt = (day + offset) % line.period;
  // In service if this lap left the terminus during service hours.
  const lapStart = (((day - lt) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  let active = inWindows(line.windows, lapStart / DAY_TICKS);
  if (active && line.parkHidden === true && lt >= line.runTicks) active = false;
  out.active = active;
  out.lapTick = lt;
  const s0 = line.lapS[lt];
  const s1 = line.lapS[lt + 1];
  const dir = line.lapDir[lt];
  pathAt(line, s0, _a);
  pathAt(line, s1, _b);
  out.s = s0;
  out.dir = dir;
  out.x = _a.x;
  out.y = _a.y;
  out.z = _a.z;
  out.vx = (_b.x - _a.x) / DT;
  out.vy = (_b.y - _a.y) / DT;
  out.vz = (_b.z - _a.z) / DT;
  out.hx = _a.hx * dir;
  out.hz = _a.hz * dir;
}

/**
 * The point a hand must reach to catch this vehicle: the bumper for ground rides, the end of the
 * strap for overhead rides.
 */
export function grabPoint(line: CompiledLine, v: VehicleState, out: { x: number; y: number; z: number }): void {
  out.x = v.x - v.hx * line.anchorBack;
  out.y = v.y + line.anchorY - line.hang;
  out.z = v.z - v.hz * line.anchorBack;
}

/** Ticks until a vehicle of `line` next arrives at stop `stopIndex` (0 if one is there now). */
export function ticksToArrival(line: CompiledLine, stopIndex: number, tick: number): number {
  const target = line.allStops[stopIndex].s;
  let best = Infinity;
  const day = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  for (let i = 0; i < line.vehicles; i++) {
    const offset = Math.floor((i * line.period) / line.vehicles) + line.phaseTicks;
    const lt0 = (day + offset) % line.period;
    for (let k = 0; k < line.period && k < best; k++) {
      const lt = (lt0 + k) % line.period;
      if (Math.abs(line.lapS[lt] - target) < 0.05 && line.lapS[lt] === line.lapS[lt + 1]) {
        const lapStart = (((day + k - lt) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
        if (!inWindows(line.windows, lapStart / DAY_TICKS)) continue;
        if (line.parkHidden === true && lt >= line.runTicks) continue;
        best = k;
        break;
      }
    }
  }
  return best;
}

/**
 * Catmull-Rom resample of a control polyline (xyz triplets) at roughly `spacing` metres, so
 * vehicles corner smoothly. `closed` joins the end to the start and repeats the first point last.
 */
export function smoothPath(ctrl: ArrayLike<number>, spacing: number, closed: boolean): number[] {
  const n = Math.floor(ctrl.length / 3);
  const get = (i: number, k: number): number => {
    let j = i;
    if (closed) j = ((i % n) + n) % n;
    else j = i < 0 ? 0 : i >= n ? n - 1 : i;
    return ctrl[j * 3 + k];
  };
  const out: number[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const dx = get(i + 1, 0) - get(i, 0);
    const dy = get(i + 1, 1) - get(i, 1);
    const dz = get(i + 1, 2) - get(i, 2);
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      for (let c = 0; c < 3; c++) {
        const p0 = get(i - 1, c);
        const p1 = get(i, c);
        const p2 = get(i + 1, c);
        const p3 = get(i + 2, c);
        out.push(
          0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3),
        );
      }
    }
  }
  if (closed) out.push(out[0], out[1], out[2]);
  else out.push(get(n - 1, 0), get(n - 1, 1), get(n - 1, 2));
  return out;
}

/** Arc position of the path point nearest to (x, z), searching whole path points only. */
export function nearestArc(path: ArrayLike<number>, x: number, z: number): number {
  const n = Math.floor(path.length / 3);
  let s = 0;
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const dx = path[i * 3] - path[i * 3 - 3];
      const dy = path[i * 3 + 1] - path[i * 3 - 2];
      const dz = path[i * 3 + 2] - path[i * 3 - 1];
      s += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const ex = path[i * 3] - x;
    const ez = path[i * 3 + 2] - z;
    const d = ex * ex + ez * ez;
    if (d < best) {
      best = d;
      bestS = s;
    }
  }
  return bestS;
}
