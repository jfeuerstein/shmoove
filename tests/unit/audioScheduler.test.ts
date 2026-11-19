import { describe, expect, it } from 'vitest';
import { BAR, makeGroove, makeNoteBuf, stepTime, writeBar, type NoteBuf } from '../../src/audio/music';
import { LOOKAHEAD, MusicScheduler, START_DELAY } from '../../src/audio/scheduler';

interface Queued {
  bar: number;
  i: number;
  when: number;
  now: number;
  key: string;
}

/** A sink that records each note with the clock at the moment it was queued. */
function recorder(): { list: Queued[]; clock: { now: number }; sink: { note(buf: NoteBuf, i: number, when: number): void } } {
  const list: Queued[] = [];
  const clock = { now: 0 };
  return {
    list,
    clock,
    sink: {
      note(buf, i, when) {
        list.push({ bar: buf.bar, i, when, now: clock.now, key: `${buf.bar}:${i}` });
      },
    },
  };
}

function run(sched: MusicScheduler, rec: ReturnType<typeof recorder>, from: number, to: number, step: number): void {
  for (let t = from; t <= to; t += step) {
    rec.clock.now = t;
    sched.pump(t, rec.sink);
  }
}

describe('the scheduler', () => {
  it('queues every note once, in order, ahead of its time and never late', () => {
    const g = makeGroove(11);
    for (const step of [1 / 60, 0.025, 0.05, 0.1]) {
      const sched = new MusicScheduler(g);
      const rec = recorder();
      sched.start(0);
      const bars = 9;
      run(sched, rec, 0, START_DELAY + bars * BAR, step);
      // Never late, never more than the look-ahead early (plus one pump of slack).
      for (const q of rec.list) {
        expect(q.when).toBeGreaterThanOrEqual(q.now);
        expect(q.when - q.now).toBeLessThan(LOOKAHEAD + 1e-9);
      }
      // In order, and never twice.
      const keys = new Set<string>();
      for (let k = 0; k < rec.list.length; k++) {
        if (k > 0) expect(rec.list[k].when).toBeGreaterThanOrEqual(rec.list[k - 1].when);
        expect(keys.has(rec.list[k].key)).toBe(false);
        keys.add(rec.list[k].key);
      }
      // Every note of the first nine bars, at its time on the grid.
      const buf = makeNoteBuf();
      let expected = 0;
      for (let b = 0; b < bars; b++) {
        writeBar(g, b, 0, buf);
        for (let i = 0; i < buf.count; i++) {
          expected++;
          const q = rec.list.find((x) => x.key === `${b}:${i}`);
          expect(q, `bar ${b} note ${i} at step ${step}`).toBeDefined();
          if (q) expect(q.when).toBeCloseTo(START_DELAY + b * BAR + stepTime(buf.step[i]), 9);
        }
      }
      expect(rec.list.filter((q) => q.bar < bars).length).toBe(expected);
      expect(sched.dropped).toBe(0);
    }
  });

  it('pumping twice at the same time queues nothing new', () => {
    const sched = new MusicScheduler(makeGroove(2));
    const rec = recorder();
    sched.start(0);
    rec.clock.now = 0.5;
    const a = sched.pump(0.5, rec.sink);
    const b = sched.pump(0.5, rec.sink);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('drops notes the clock jumped past instead of playing them late, and keeps the grid', () => {
    const sched = new MusicScheduler(makeGroove(2));
    const rec = recorder();
    sched.start(0);
    run(sched, rec, 0, 1, 0.02);
    const before = rec.list.length;
    // A stall of three and a half bars.
    const resume = 1 + BAR * 3.5;
    rec.clock.now = resume;
    sched.pump(resume, rec.sink);
    run(sched, rec, resume, resume + BAR, 0.02);
    expect(rec.list.length).toBeGreaterThan(before);
    for (const q of rec.list) expect(q.when).toBeGreaterThanOrEqual(q.now);
    expect(sched.dropped).toBeGreaterThan(0);
    // Still on the grid: every note's time is a bar start plus its swung step.
    for (const q of rec.list.slice(before)) {
      const barStart = START_DELAY + q.bar * BAR;
      expect(q.when).toBeGreaterThanOrEqual(barStart - 1e-9);
      expect(q.when).toBeLessThan(barStart + BAR);
    }
  });

  it('stops at the end of the bar when asked, and not before', () => {
    const sched = new MusicScheduler(makeGroove(3));
    const rec = recorder();
    sched.start(0);
    run(sched, rec, 0, 0.5, 0.02);
    const end = sched.stopAtBarEnd();
    expect(end).toBeCloseTo(START_DELAY + BAR, 9);
    run(sched, rec, 0.5, 4 * BAR, 0.02);
    expect(sched.isRunning).toBe(false);
    for (const q of rec.list) expect(q.when).toBeLessThan(end);
    const buf = makeNoteBuf();
    writeBar(makeGroove(3), 0, 0, buf);
    expect(rec.list.length).toBe(buf.count);
  });

  it('a stopped scheduler queues nothing; a restart begins at bar 0 again', () => {
    const sched = new MusicScheduler(makeGroove(3));
    const rec = recorder();
    expect(sched.pump(1, rec.sink)).toBe(0);
    sched.start(5);
    run(sched, rec, 5, 8, 0.02);
    sched.stop();
    const n = rec.list.length;
    run(sched, rec, 8, 10, 0.02);
    expect(rec.list.length).toBe(n);
    sched.start(20);
    expect(sched.currentBar).toBe(0);
    run(sched, rec, 20, 20.3, 0.02);
    expect(rec.list[n].bar).toBe(0);
    expect(rec.list[n].when).toBeGreaterThanOrEqual(20);
  });

  it('applies a key change from the next bar on, never inside a bar', () => {
    const sched = new MusicScheduler(makeGroove(4));
    const pitches: { bar: number; pitch: number; stem: number }[] = [];
    let now = 0;
    const sink = { note: (b: NoteBuf, i: number) => pitches.push({ bar: b.bar, pitch: b.pitch[i], stem: b.stem[i] }) };
    sched.start(0);
    for (; now < BAR * 0.5; now += 0.02) sched.pump(now, sink);
    sched.transpose = -5;
    for (; now < BAR * 2.5; now += 0.02) sched.pump(now, sink);
    const buf = makeNoteBuf();
    const g = makeGroove(4);
    writeBar(g, 0, 0, buf);
    const bar0 = pitches.filter((p) => p.bar === 0);
    for (let i = 0; i < bar0.length; i++) expect(bar0[i].pitch).toBe(buf.pitch[i]);
    writeBar(g, 1, -5, buf);
    const bar1 = pitches.filter((p) => p.bar === 1);
    expect(bar1.length).toBe(buf.count);
    for (let i = 0; i < bar1.length; i++) expect(bar1[i].pitch).toBe(buf.pitch[i]);
  });
});
