/**
 * Line-map progress: which segments of which lines the skater has inked.
 *
 * A segment runs between two consecutive stops of a line. It is inked when, during one unbroken
 * hitch to a vehicle of that line, the vehicle travels the whole segment: it started at or before
 * the segment's start (INK_SLACK inside still counts, since a bumper is grabbed as the vehicle pulls
 * away) and reached its end (same slack). Coverage is tracked from the vehicle's arc position each
 * tick; a release or bail ends the hitch and throws partial coverage away.
 *
 * Progress itself is plain JSON-able data so the saves task can persist it.
 */
import { makeVehicleState, vehicleAt, type CompiledLine } from '../lines';
import { Mode } from '../types';
import type { Game, GameReducer } from './game';

/** How far inside a segment a hitch may start, or end short of it, and still ink it, metres. */
export const INK_SLACK = 12;

export interface Segment {
  /** Index into `allStops` of the stop it starts and ends at. */
  from: number;
  to: number;
  /** Arc positions; for a loop's last segment s1 = line length (back at the terminus). */
  s0: number;
  s1: number;
}

export interface LineProgress {
  /** Line id, so saved data can be matched to lines after the world changes. */
  id: string;
  inked: boolean[];
  complete: boolean;
  discovered: boolean;
}

export interface Progress {
  lines: LineProgress[];
  mapComplete: boolean;
}

/** Segments of a line, in path order. */
export function lineSegments(line: CompiledLine): Segment[] {
  const st = line.allStops;
  const k = st.length;
  const out: Segment[] = [];
  if (line.loop) {
    for (let i = 0; i < k; i++) {
      out.push({ from: i, to: (i + 1) % k, s0: st[i].s, s1: i < k - 1 ? st[i + 1].s : line.length });
    }
  } else {
    for (let i = 0; i < k - 1; i++) out.push({ from: i, to: i + 1, s0: st[i].s, s1: st[i + 1].s });
  }
  return out;
}

/** Slack used for a segment: INK_SLACK, but never more than a quarter of a short segment. */
export function segmentSlack(seg: Segment): number {
  return Math.min(INK_SLACK, (seg.s1 - seg.s0) * 0.25);
}

export function createProgress(lines: readonly CompiledLine[]): Progress {
  return {
    lines: lines.map((l) => ({
      id: l.id,
      inked: lineSegments(l).map(() => false),
      complete: false,
      discovered: l.secret !== true,
    })),
    mapComplete: false,
  };
}

export function inkedCount(progress: Progress, lineIndex: number): number {
  let n = 0;
  for (const b of progress.lines[lineIndex].inked) if (b) n++;
  return n;
}

/** Inked share of all non-secret segments, 0..1. */
export function mapFraction(progress: Progress, lines: readonly CompiledLine[]): number {
  let total = 0;
  let inked = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].secret === true) continue;
    total += progress.lines[i].inked.length;
    inked += inkedCount(progress, i);
  }
  return total > 0 ? inked / total : 0;
}

function allNonSecretComplete(progress: Progress, lines: readonly CompiledLine[]): boolean {
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].secret === true) continue;
    any = true;
    if (!progress.lines[i].complete) return false;
  }
  return any;
}

// ---------------------------------------------------------------------------------------------
// Persistence

export interface ProgressData {
  v: 1;
  lines: Array<{ id: string; inked: boolean[]; discovered: boolean }>;
}

export function exportProgress(p: Progress): ProgressData {
  return {
    v: 1,
    lines: p.lines.map((l) => ({ id: l.id, inked: l.inked.slice(), discovered: l.discovered })),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Rebuild progress for `lines` from saved data. Lines are matched by id; unknown ids and malformed
 * entries are ignored; a line whose segment count changed keeps the segments that still exist.
 * Completion is recomputed from the ink, never trusted from the data.
 */
export function importProgress(lines: readonly CompiledLine[], data: unknown): Progress {
  const p = createProgress(lines);
  if (!isRecord(data) || !Array.isArray(data.lines)) return p;
  for (const entry of data.lines) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const li = lines.findIndex((l) => l.id === entry.id);
    if (li < 0) continue;
    const lp = p.lines[li];
    if (Array.isArray(entry.inked)) {
      const n = Math.min(lp.inked.length, entry.inked.length);
      for (let i = 0; i < n; i++) lp.inked[i] = entry.inked[i] === true;
    }
    if (entry.discovered === true) lp.discovered = true;
    // Ink on a secret line means it was ridden.
    if (lp.inked.some((b) => b)) lp.discovered = true;
    lp.complete = lp.inked.length > 0 && lp.inked.every((b) => b);
  }
  p.mapComplete = allNonSecretComplete(p, lines);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Reducer

const VS = makeVehicleState();

/** Tracks the current hitch and inks segments as the towing vehicle completes them. */
export class ProgressReducer implements GameReducer {
  readonly key = 'progress';
  private readonly segs: Segment[][];
  private readonly slack: number[][];
  // Current hitch (transient; a fresh session starts unhitched).
  private active = false;
  private line = -1;
  private veh = -1;
  private prevS = 0;
  // Loops: unwrapped arc position at the start of the hitch and now.
  private startU = 0;
  private prevU = 0;
  // Shuttles: where the current run in one direction began, and that direction.
  private runStart = 0;
  private runDir = 1;

  constructor(
    private readonly progress: Progress,
    private readonly lines: readonly CompiledLine[],
  ) {
    this.segs = lines.map(lineSegments);
    this.slack = this.segs.map((ss) => ss.map(segmentSlack));
  }

  exportState(): ProgressData {
    return exportProgress(this.progress);
  }

  /** Replaces progress in place (the UI holds the same object); any hitch in flight is forgotten. */
  importState(data: unknown): void {
    const fresh = importProgress(this.lines, data);
    this.progress.lines.length = 0;
    for (const l of fresh.lines) this.progress.lines.push(l);
    this.progress.mapComplete = fresh.mapComplete;
    this.active = false;
  }

  step(game: Game): void {
    const sim = game.sim;
    const lines = sim.world.lines;
    const p = sim.player;
    let fresh = false;
    for (const e of sim.events) {
      if (e.type !== 'hitch') continue;
      fresh = true;
      const lp = this.progress.lines[e.line];
      if (!lp.discovered) {
        lp.discovered = true;
        game.events.push({ type: 'lineDiscovered', line: e.line });
      }
    }
    if (p.mode !== Mode.HITCH) {
      this.active = false;
      return;
    }
    const line = lines[p.hLine];
    vehicleAt(line, p.hVeh, sim.tick, VS);
    const s = VS.s;
    if (fresh || !this.active || this.line !== p.hLine || this.veh !== p.hVeh) {
      this.active = true;
      this.line = p.hLine;
      this.veh = p.hVeh;
      this.prevS = s;
      this.startU = s;
      this.prevU = s;
      this.runStart = s;
      this.runDir = VS.dir;
      return;
    }
    if (line.loop) this.stepLoop(game, line, s);
    else this.stepShuttle(game, line, s, VS.dir);
    this.prevS = s;
  }

  private stepLoop(game: Game, line: CompiledLine, s: number): void {
    const L = line.length;
    let d = s - this.prevS;
    if (d < -L * 0.5) d += L;
    else if (d > L * 0.5) d -= L;
    const cur = this.prevU + d;
    if (d > 0) {
      const segs = this.segs[line.index];
      const slack = this.slack[line.index];
      for (let i = 0; i < segs.length; i++) {
        const end = segs[i].s1 - slack[i];
        const m = Math.floor((cur - end) / L);
        if (end + m * L <= this.prevU) continue;
        if (this.startU <= segs[i].s0 + slack[i] + m * L) this.ink(game, line, i);
      }
    }
    this.prevU = cur;
  }

  private stepShuttle(game: Game, line: CompiledLine, s: number, dir: number): void {
    if (dir !== this.runDir) {
      this.runDir = dir;
      this.runStart = this.prevS;
    }
    const segs = this.segs[line.index];
    const slack = this.slack[line.index];
    const prev = this.prevS;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      if (s > prev) {
        const end = g.s1 - slack[i];
        if (end > prev && end <= s && this.runStart <= g.s0 + slack[i]) this.ink(game, line, i);
      } else if (s < prev) {
        const end = g.s0 + slack[i];
        if (end < prev && end >= s && this.runStart >= g.s1 - slack[i]) this.ink(game, line, i);
      }
    }
  }

  private ink(game: Game, line: CompiledLine, seg: number): void {
    const lp = this.progress.lines[line.index];
    if (lp.inked[seg]) return;
    lp.inked[seg] = true;
    game.events.push({ type: 'segmentInked', line: line.index, segment: seg });
    if (lp.complete || !lp.inked.every((b) => b)) return;
    lp.complete = true;
    game.events.push({ type: 'lineComplete', line: line.index });
    if (!this.progress.mapComplete && allNonSecretComplete(this.progress, game.sim.world.lines)) {
      this.progress.mapComplete = true;
      game.events.push({ type: 'mapComplete' });
    }
  }
}
