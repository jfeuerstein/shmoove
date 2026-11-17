/**
 * The bot's tasks: small closed-loop controllers a plan strings together.
 */
import { FEEL } from '../../../src/sim/constants';
import { lineSegments, segmentSlack } from '../../../src/sim/game/progress';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine } from '../../../src/sim/lines';
import { Mode, type InputFrame } from '../../../src/sim/types';
import { atStop, lineById, stopIndex, stopPose } from './geo';
import type { Skater, Task } from './skater';

const V = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };
const NG = { line: -1, veh: -1, d: 0, dy: 0 };

export type XZ = readonly [number, number];

export interface GoOpts {
  /** Arrival radius at each waypoint, metres. */
  r?: number;
  /** Give up after this many ticks. */
  max?: number;
  /** Hop when within this distance of these points (onto a rail, over a ledge). */
  hopAt?: readonly XZ[];
}

/** Roll along waypoints. A waypoint counts as reached within `r`, or once it is behind the skater on the way to the next. */
export function go(label: string, pts: readonly XZ[], opts: GoOpts = {}): Task {
  const r = opts.r ?? 3;
  const max = opts.max ?? 60 * 60 * 4;
  let k = 0;
  let hopped = -1;
  let started = false;
  return {
    label,
    begin(b) {
      if (!started) {
        started = true;
        return;
      }
      // Resumed after a load put the skater down somewhere on the way: carry on from the nearest waypoint.
      let best = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - b.p.x, pts[i][1] - b.p.z);
        if (d < best) {
          best = d;
          k = i;
        }
      }
    },
    step(b, out) {
      const p = b.p;
      if (b.taskTicks > max) return b.fail(`stuck on the way to waypoint ${k} (${pts[k][0]}, ${pts[k][1]})`);
      while (k < pts.length) {
        const [x, z] = pts[k];
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < r) {
          k++;
          continue;
        }
        if (k + 1 < pts.length) {
          // Passed it: it lies behind us relative to the leg toward the next one.
          const [nx, nz] = pts[k + 1];
          const lx = nx - x;
          const lz = nz - z;
          if ((p.x - x) * lx + (p.z - z) * lz > 0 && d < 3 * r) {
            k++;
            continue;
          }
        }
        break;
      }
      if (k >= pts.length) return 'done';
      if (p.mode === Mode.HITCH) {
        out.hold = false;
        return 'run';
      }
      b.steerTo(out, pts[k][0], pts[k][1]);
      if (opts.hopAt) {
        for (let i = 0; i < opts.hopAt.length; i++) {
          const h = opts.hopAt[i];
          if (i !== hopped && p.mode === Mode.GROUND && Math.hypot(h[0] - p.x, h[1] - p.z) < 1.2) {
            out.hop = true;
            hopped = i;
          }
        }
      }
      return 'run';
    },
  };
}

/** Do something for a number of ticks (carve, hop on the spot). */
export function act(label: string, ticks: number, fn: (b: Skater, out: InputFrame, i: number) => void): Task {
  return {
    label,
    step(b, out) {
      if (b.taskTicks >= ticks) return 'done';
      fn(b, out, b.taskTicks);
      return 'run';
    },
  };
}

export interface RideSpec {
  line: string;
  /** Stop to catch it at (name). */
  at: string;
  /** Stop to let go at (name). Default: where it was caught (a full lap). */
  to?: string;
  /**
   * Segments to ink on this ride before letting go at `to` (indices). Default: every segment from
   * `at` to `to` along the line (all of them for a full lap).
   */
  segs?: number[];
  /** Where to wait, overriding the default (beside the rear bumper, or under the strap). */
  wait?: XZ;
  /** Metres to the left of the bumper to wait for a ground ride (negative: to the right). */
  side?: number;
  /** Give up waiting after this many ticks (default 4 minutes). */
  maxWait?: number;
  /** Catch a vehicle wherever it comes past the wait point, not only one standing at `at`. */
  anywhere?: boolean;
}

/** Segments from stop index a to stop index b along a line's travel (a full lap when a === b). */
export function segsBetween(l: CompiledLine, a: number, b: number): number[] {
  const n = lineSegments(l).length;
  const out: number[] = [];
  if (l.loop) {
    let i = a;
    do {
      out.push(i);
      i = (i + 1) % n;
    } while (i !== b);
    return out;
  }
  // Shuttle: segments i join stop i and i + 1.
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (let i = lo; i < hi; i++) out.push(i);
  return out;
}

/**
 * Wait for a line at a stop, catch the vehicle that is standing there (or just leaving), ride it
 * until the wanted segments are inked and it stands at the release stop, and let go.
 */
export function ride(label: string, spec: RideSpec): Task {
  let L: CompiledLine | null = null;
  let kAt = 0;
  let kTo = 0;
  let segs: number[] = [];
  let wx = 0;
  let wz = 0;
  let phase: 'wait' | 'ride' | 'off' = 'wait';
  let caughtVeh = -1;
  let slackAt = 0;
  const maxWait = spec.maxWait ?? 60 * 60 * 4;
  return {
    label,
    idle: () => phase === 'wait',
    begin(b) {
      if (!L) {
        L = lineById(b.w, spec.line);
        kAt = stopIndex(L, spec.at);
        kTo = spec.to === undefined ? kAt : stopIndex(L, spec.to);
        segs = spec.segs ?? segsBetween(L, kAt, kTo);
        const pose = stopPose(L, kAt);
        const all = lineSegments(L);
        const first = all.find((s) => s.from === kAt);
        slackAt = first ? segmentSlack(first) : 2;
        if (spec.wait) {
          wx = spec.wait[0];
          wz = spec.wait[1];
        } else if (L.overhead) {
          wx = pose.gx;
          wz = pose.gz;
        } else {
          // Beside the bumper, out of the vehicle's way: left of travel is (-hz, hx).
          const side = spec.side ?? 2.6;
          wx = pose.gx - pose.hz * side;
          wz = pose.gz + pose.hx * side;
        }
      }
      // A load puts the skater down off the ride: wait again.
      if (b.p.mode !== Mode.HITCH) phase = 'wait';
    },
    step(b, out) {
      const line = L;
      if (!line) return b.fail('not begun');
      const p = b.p;
      const prog = b.game.progress.lines[line.index];
      if (phase === 'wait') {
        if (b.taskTicks > maxWait) return b.fail(`no ${line.id} caught at ${spec.at} in ${(maxWait / 60).toFixed(0)} s`);
        if (p.mode === Mode.HITCH) {
          if (p.hLine === line.index) {
            phase = 'ride';
            caughtVeh = p.hVeh;
            b.note(`caught ${line.id} #${p.hVeh}`);
          } else {
            // Caught the wrong ride: let go as soon as it allows.
            out.hold = false;
            return 'run';
          }
        } else {
          const dw = Math.hypot(wx - p.x, wz - p.z);
          if (p.mode === Mode.GROUND && (dw < 1.5 || (dw < 4 && p.speed < 0.6)) && b.canPlantFoot(line.index)) {
            // At the spot: hold a still finger and stand (a planted foot), beside the lane.
            out.steer = 0;
            out.hold = true;
          } else b.steerTo(out, wx, wz);
          // Arm when the fresh vehicle of this line at the stop is the nearest grab point around.
          b.nearestGrab(9, NG);
          if (NG.line === line.index && (spec.anywhere === true || fresh(line, NG.veh, b.tick, kAt, slackAt))) {
            out.hold = NG.d < FEEL.HITCH_REACH + 2;
            if (line.overhead && NG.d < 2.5 && NG.dy > FEEL.HITCH_REACH_Y * 0.75 && p.mode === Mode.GROUND) out.hop = true;
            // Close in on the grab point itself.
            vehicleAt(line, NG.veh, b.tick, V);
            grabPoint(line, V, GP);
            if (line.overhead) b.steerTo(out, GP.x, GP.z, 1.2);
          }
          return 'run';
        }
      }
      if (phase === 'ride') {
        if (p.mode !== Mode.HITCH || p.hLine !== line.index) {
          // Off the ride without letting go: it went out of service or the strap slipped.
          const missing = segs.filter((s) => !prog.inked[s]);
          if (missing.length === 0) return 'done';
          b.note(`dropped by ${line.id} #${caughtVeh}, missing segs ${missing.join(',')}`);
          return b.fail(`${line.id} dropped the skater before segments ${missing.join(',')} were inked`);
        }
        out.hold = true;
        b.quiet(out);
        vehicleAt(line, p.hVeh, b.tick, V);
        if (segs.every((s) => prog.inked[s]) && atStop(line, V, kTo)) {
          out.hold = false;
          phase = 'off';
        }
        return 'run';
      }
      // Let go: wait for the release to register.
      if (p.mode === Mode.HITCH) {
        out.hold = false;
        return 'run';
      }
      return 'done';
    },
  };
}

/**
 * Is vehicle `vi` of `l` the one to catch at stop k: standing at it, or within `slack` metres past
 * it (its run along the first segment still inks), or drawing up to it?
 */
function fresh(l: CompiledLine, vi: number, tick: number, k: number, slack: number): boolean {
  vehicleAt(l, vi, tick, V);
  const s0 = l.allStops[k].s;
  let ds = V.s - s0;
  if (l.loop) {
    const L = l.length;
    if (ds > L / 2) ds -= L;
    else if (ds < -L / 2) ds += L;
  } else ds *= V.dir;
  return ds > -25 && ds < slack * 0.6;
}
