import { describe, expect, it } from 'vitest';
import { KEEP, MIN_KEPT_SECONDS, ReportStore, REPORTS_KEY, parseReports } from '../../src/app/reports';
import { REPORT_VERSION, RunLog, type RunReport } from '../../src/app/runLog';
import { makeBowl } from '../../src/sim/bowl';
import { Sim } from '../../src/sim/sim';
import { reportRowText, whenLabel } from '../../src/ui/reportView';

function fake(): RunReport {
  const sim = new Sim(makeBowl(1), { seed: 1, horde: true, autoPick: false });
  const log = new RunLog();
  log.reset(0);
  return log.report(sim);
}

function make(id: number, seconds = 60): RunReport {
  return { ...fake(), id, seconds };
}

class MemStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('the kept reports', () => {
  it('keeps the last ten, newest first, across a reload', () => {
    const mem = new MemStorage();
    const store = new ReportStore(mem);
    for (let i = 1; i <= 12; i++) store.keep(make(i));
    expect(store.list()).toHaveLength(KEEP);
    expect(store.list()[0].id).toBe(12);
    expect(store.list()[KEEP - 1].id).toBe(3);
    const again = new ReportStore(mem);
    expect(again.list().map((r) => r.id)).toEqual(store.list().map((r) => r.id));
  });

  it('files the same run once: left early, then finished, is one report', () => {
    const store = new ReportStore(new MemStorage());
    store.keep({ ...make(7), outcome: 'abandoned' });
    store.keep({ ...make(7, 90), outcome: 'dead' });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].outcome).toBe('dead');
    expect(store.list()[0].seconds).toBe(90);
  });

  it('does not keep a run that was over before it began', () => {
    const store = new ReportStore(new MemStorage());
    store.keep(make(1, MIN_KEPT_SECONDS - 1));
    expect(store.list()).toHaveLength(0);
  });

  it('works with no storage, with storage that throws, and with storage that is full', () => {
    const none = new ReportStore(null);
    none.keep(make(1));
    expect(none.list()).toHaveLength(1);

    const broken = {
      getItem(): string | null {
        throw new Error('no');
      },
      setItem(): void {
        throw new Error('no');
      },
    };
    const b = new ReportStore(broken);
    b.keep(make(1));
    expect(b.list()).toHaveLength(1);

    // Room for one report only: the newest is saved, the older let go.
    const small = make(1);
    const limit = JSON.stringify([small]).length + 10;
    const mem = new MemStorage();
    const tight = {
      getItem: (k: string) => mem.getItem(k),
      setItem(k: string, v: string): void {
        if (v.length > limit) throw new Error('quota');
        mem.setItem(k, v);
      },
    };
    const t = new ReportStore(tight);
    t.keep(make(1));
    t.keep(make(2));
    expect(t.list()).toHaveLength(2);
    expect(parseReports(mem.getItem(REPORTS_KEY)).map((r) => r.id)).toEqual([2]);
  });

  it('reads bad saved text as nothing and skips entries that are not reports', () => {
    expect(parseReports(null)).toEqual([]);
    expect(parseReports('{nope')).toEqual([]);
    expect(parseReports('{"a":1}')).toEqual([]);
    const good = make(3);
    const mixed = JSON.stringify([{ v: REPORT_VERSION }, 5, null, good, { ...good, v: 99 }]);
    expect(parseReports(mixed).map((r) => r.id)).toEqual([3]);
  });

  it('lists when, outcome and time', () => {
    const r = { ...make(Date.UTC(2026, 10, 19, 12, 5), 125), outcome: 'dead' as const };
    expect(reportRowText(r)).toContain('DIED');
    expect(reportRowText(r)).toContain('2:05');
    expect(whenLabel(r.id)).toMatch(/^Nov 19 \d\d:\d\d$/);
  });
});
