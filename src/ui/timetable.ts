/**
 * Pure timetable queries for the boards, read from the lines' lap tables (never simulated).
 */
import { DAY_TICKS } from '../sim/constants';
import {
  dayFrac,
  inWindows,
  lapTickOf,
  makeVehicleState,
  pathAt,
  ticksToArrival,
  vehicleAt,
  type CompiledLine,
} from '../sim/lines';

/** Tolerance matching a dwell position to a stop (compileLine's own terminus tolerance). */
const STOP_EPS = 0.6;

/** Index into allStops of the stop at arc position s, or -1. A loop's s = length is its terminus. */
export function stopIndexAt(line: CompiledLine, s: number): number {
  const st = line.allStops;
  for (let i = 0; i < st.length; i++) if (Math.abs(st[i].s - s) < STOP_EPS) return i;
  if (line.loop && Math.abs(s - line.length) < STOP_EPS && st.length > 0 && st[0].s < STOP_EPS) return 0;
  if (Math.abs(s) < STOP_EPS && st.length > 0 && st[0].s < STOP_EPS) return 0;
  return -1;
}

export interface NextStop {
  /** Index into allStops. */
  stop: number;
  /** Ticks until the vehicle is dwelling there. */
  ticks: number;
}

/**
 * The next stop vehicle `veh` will stand at, and in how many ticks. While dwelling at a stop, the
 * next stop is the following one. Returns false if the lap has no further stop (degenerate line).
 */
export function nextStopOf(line: CompiledLine, veh: number, tick: number, out: NextStop): boolean {
  const P = line.period;
  const S = line.lapS;
  const lt0 = lapTickOf(line, veh, tick);
  let moved = S[lt0] !== S[lt0 + 1];
  for (let k = 1; k <= P; k++) {
    const t = (lt0 + k) % P;
    if (S[t] !== S[t + 1]) {
      moved = true;
      continue;
    }
    if (!moved) continue;
    const si = stopIndexAt(line, S[t]);
    if (si >= 0) {
      out.stop = si;
      out.ticks = k;
      return true;
    }
  }
  return false;
}

/** Whether the line runs at this tick: inside its service hours, or a vehicle still finishing a lap. */
export function inService(line: CompiledLine, tick: number): boolean {
  if (inWindows(line.windows, dayFrac(tick))) return true;
  for (let i = 0; i < line.vehicles; i++) {
    vehicleAt(line, i, tick, VS);
    if (VS.active) return true;
  }
  return false;
}

const VS = makeVehicleState();

/**
 * Index of the stop a vehicle arriving at `stop` in `ticks` heads for next. Loops go round; a
 * shuttle's direction is read from the lap table of whichever vehicle makes that arrival.
 */
export function followingStop(line: CompiledLine, stop: number, tick: number, ticks: number): number {
  const k = line.allStops.length;
  if (line.loop) return (stop + 1) % k;
  if (stop === 0) return Math.min(1, k - 1);
  if (stop === k - 1) return Math.max(0, k - 2);
  if (Number.isFinite(ticks)) {
    const at = tick + ticks;
    for (let i = 0; i < line.vehicles; i++) {
      const lt = lapTickOf(line, i, at);
      if (line.lapS[lt] !== line.lapS[lt + 1] || stopIndexAt(line, line.lapS[lt]) !== stop) continue;
      for (let j = 1; j <= line.period; j++) {
        const t = (lt + j) % line.period;
        if (line.lapS[t] !== line.lapS[t + 1]) return line.lapDir[t] > 0 ? stop + 1 : stop - 1;
      }
    }
  }
  return stop + 1;
}

export interface StopPos {
  line: number;
  stop: number;
  x: number;
  z: number;
}

/** Plan positions of every stop of every line. */
export function stopPositions(lines: readonly CompiledLine[]): StopPos[] {
  const out: StopPos[] = [];
  const p = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
  for (const l of lines) {
    for (let i = 0; i < l.allStops.length; i++) {
      pathAt(l, l.allStops[i].s, p);
      out.push({ line: l.index, stop: i, x: p.x, z: p.z });
    }
  }
  return out;
}

export interface NearStop extends StopPos {
  dist: number;
}

/** Stops of lines where `include(line)` holds within `radius` (plan distance) of (x, z), nearest first. */
export function nearbyStops(
  stops: readonly StopPos[],
  x: number,
  z: number,
  radius: number,
  include: (line: number) => boolean,
): NearStop[] {
  const out: NearStop[] = [];
  const r2 = radius * radius;
  for (const s of stops) {
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= r2 && include(s.line)) out.push({ ...s, dist: Math.sqrt(d2) });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

/**
 * Ticks until a vehicle of `line` is standing at stop `stop`: ticksToArrival, except at a loop's
 * terminus, where a vehicle also stands while it waits out the end of its lap (at s = length,
 * which ticksToArrival does not count). That wait is when riders see it there.
 */
export function arrivalTicks(line: CompiledLine, stop: number, tick: number): number {
  const best = ticksToArrival(line, stop, tick);
  if (!line.loop || stop !== 0 || line.allStops[0].s >= STOP_EPS) return best;
  const S = line.lapS;
  const end = line.length;
  const day = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  let out = best;
  for (let i = 0; i < line.vehicles; i++) {
    const lt0 = lapTickOf(line, i, tick);
    for (let k = 0; k < line.period && k < out; k++) {
      const lt = (lt0 + k) % line.period;
      if (Math.abs(S[lt] - end) >= 0.05 || S[lt] !== S[lt + 1]) continue;
      const lapStart = (((day + k - lt) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
      if (!inWindows(line.windows, lapStart / DAY_TICKS)) continue;
      if (line.parkHidden === true && lt >= line.runTicks) continue;
      out = k;
      break;
    }
  }
  return out;
}

export interface BoardRow {
  line: number;
  stop: number;
  /** Stop the arriving vehicle heads for next. */
  next: number;
  /** Ticks to arrival (Infinity when none). */
  ticks: number;
  service: boolean;
}

/** Timetable rows for a set of stops: soonest first, lines out of service last, at most `max`. */
export function boardRows(lines: readonly CompiledLine[], near: readonly StopPos[], tick: number, max = 4): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const n of near) {
    const line = lines[n.line];
    const service = inService(line, tick);
    const ticks = service ? arrivalTicks(line, n.stop, tick) : Infinity;
    rows.push({ line: n.line, stop: n.stop, next: followingStop(line, n.stop, tick, ticks), ticks, service: service && Number.isFinite(ticks) });
  }
  rows.sort((a, b) => (a.service === b.service ? a.ticks - b.ticks || a.line - b.line : a.service ? -1 : 1));
  if (rows.length > max) rows.length = max;
  return rows;
}
