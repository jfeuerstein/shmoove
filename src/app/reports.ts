/**
 * The last ten run reports, kept between visits under their own storage key. Storage can be
 * missing, full or throw (private mode): the list then lasts for this visit only, and the game
 * runs the same. A report is filed under its `id` (when the run began), so saving the same run
 * twice (left early, then finished) keeps one.
 */
import type { StorageLike } from './settings';
import { REPORT_VERSION, type RunReport } from './runLog';

export const REPORTS_KEY = 'shmoove.reports.v1';
/** How many reports are kept. */
export const KEEP = 10;
/** A run shorter than this (s) is not worth keeping. */
export const MIN_KEPT_SECONDS = 5;

const OUTCOMES: readonly string[] = ['running', 'dead', 'won', 'abandoned'];

function isReport(v: unknown): v is RunReport {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === REPORT_VERSION &&
    typeof r.id === 'number' &&
    typeof r.seconds === 'number' &&
    typeof r.outcome === 'string' &&
    OUTCOMES.includes(r.outcome) &&
    typeof r.build === 'object' &&
    r.build !== null &&
    typeof r.damage === 'object' &&
    r.damage !== null &&
    typeof r.device === 'object' &&
    r.device !== null
  );
}

/** Saved text to reports, newest first; anything wrong with it gives fewer, never a throw. */
export function parseReports(raw: string | null): RunReport[] {
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RunReport[] = [];
  for (const item of data) if (isReport(item) && out.length < KEEP) out.push(item);
  return out;
}

export class ReportStore {
  private items: RunReport[];

  constructor(private readonly storage: StorageLike | null) {
    let raw: string | null = null;
    try {
      raw = storage ? storage.getItem(REPORTS_KEY) : null;
    } catch (_err) {
      raw = null;
    }
    this.items = parseReports(raw);
  }

  /** Newest first. */
  list(): readonly RunReport[] {
    return this.items;
  }

  /** Keep a finished (or abandoned) run. A run seen before is replaced; a trivial run is not kept. */
  keep(report: RunReport): void {
    if (report.seconds < MIN_KEPT_SECONDS) return;
    const rest = this.items.filter((r) => r.id !== report.id);
    this.items = [report, ...rest].slice(0, KEEP);
    this.save();
  }

  private save(): void {
    if (!this.storage) return;
    // Full: let go of the oldest until it fits (the newest always stays in memory).
    for (let n = this.items.length; n >= 1; n--) {
      try {
        this.storage.setItem(REPORTS_KEY, JSON.stringify(this.items.slice(0, n)));
        return;
      } catch (_err) {
        // try with one fewer
      }
    }
  }
}
