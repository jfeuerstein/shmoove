import { describe, expect, it } from 'vitest';
import {
  createTransport,
  nextBarTime,
  nextBeatTime,
  positionAt,
  positionOfStep,
  schedule,
  stepDuration,
  type ScheduledStep,
} from '../../../src/audio/transport';

const LOOKAHEAD = 0.12;

/** Deterministic irregular frame times, with some long stalls. */
function frames(n: number, seed = 7): number[] {
  const out: number[] = [];
  let s = seed;
  let t = 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const r = s / 4294967296;
    let dt = 0.004 + r * 0.03;
    if (i % 97 === 50) dt = 2.5; // a long stall (tab hidden, GC, debugger)
    if (i % 41 === 20) dt = 0.25;
    t += dt;
    out.push(t);
  }
  return out;
}

describe('transport scheduler', () => {
  it('hands out every step exactly once, in order, across irregular frames and stalls', () => {
    for (const bpm of [92, 104, 116, 100]) {
      const tr = createTransport(bpm, 0.05);
      const buf: ScheduledStep[] = [];
      const seen: number[] = [];
      let lastTime = -Infinity;
      for (const now of frames(3000, bpm)) {
        const n = schedule(tr, now, LOOKAHEAD, buf);
        for (let i = 0; i < n; i++) {
          seen.push(buf[i].step);
          // Never scheduled in the past (beyond the late tolerance) and never out of order.
          expect(buf[i].time).toBeGreaterThan(now - 0.031);
          expect(buf[i].time).toBeGreaterThan(lastTime);
          expect(buf[i].time).toBeLessThan(now + LOOKAHEAD);
          lastTime = buf[i].time;
        }
      }
      expect(seen.length).toBeGreaterThan(300);
      seen.forEach((s, i) => expect(s).toBe(i));
      expect(tr.resyncs).toBeGreaterThan(0);
    }
  });

  it('keeps a steady grid when frames are regular (no drift, no resync)', () => {
    const tr = createTransport(120, 0);
    const buf: ScheduledStep[] = [];
    const dur = stepDuration(120);
    for (let f = 0; f < 600; f++) {
      const now = f / 60;
      const n = schedule(tr, now, LOOKAHEAD, buf);
      for (let i = 0; i < n; i++) expect(buf[i].time).toBeCloseTo(buf[i].step * dur, 9);
    }
    expect(tr.resyncs).toBe(0);
  });

  it('after a stall the next step plays just after now, not late and not skipped', () => {
    const tr = createTransport(100, 0);
    const buf: ScheduledStep[] = [];
    schedule(tr, 0, LOOKAHEAD, buf);
    const next = tr.nextStep;
    const n = schedule(tr, 10, LOOKAHEAD, buf);
    expect(n).toBeGreaterThan(0);
    expect(buf[0].step).toBe(next);
    expect(buf[0].time).toBeGreaterThanOrEqual(10);
    expect(buf[0].time).toBeLessThan(10 + 0.05);
  });

  it('stem starts quantise to a beat boundary at or after now', () => {
    for (const bpm of [92, 104, 116, 100]) {
      const tr = createTransport(bpm, 0.37);
      const beat = 60 / bpm;
      for (let i = 0; i < 500; i++) {
        const now = 0.37 + i * 0.0731 + (i % 3) * 0.001;
        const t = nextBeatTime(tr, now);
        expect(t).toBeGreaterThanOrEqual(now - 1e-9);
        expect(t - now).toBeLessThan(beat + 1e-9);
        const k = (t - tr.anchor) / beat;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      }
      // Exactly on a beat stays on it; before the anchor waits for the anchor.
      expect(nextBeatTime(tr, 0.37 + 3 * beat)).toBeCloseTo(0.37 + 3 * beat, 9);
      expect(nextBeatTime(tr, 0)).toBeCloseTo(0.37, 9);
      const bar = nextBarTime(tr, 0.37 + beat * 0.5);
      expect(bar).toBeCloseTo(0.37 + 4 * beat, 9);
    }
  });

  it('bar/beat math wraps at 8 bars', () => {
    expect(positionOfStep(0)).toEqual({ bar: 0, beat: 0, step: 0 });
    expect(positionOfStep(5)).toEqual({ bar: 0, beat: 1, step: 5 });
    expect(positionOfStep(16 * 7 + 15)).toEqual({ bar: 7, beat: 3, step: 15 });
    expect(positionOfStep(128)).toEqual({ bar: 0, beat: 0, step: 0 });
    expect(positionOfStep(128 * 3 + 16 * 2 + 9)).toEqual({ bar: 2, beat: 2, step: 9 });
    const buf: ScheduledStep[] = [];
    const tr = createTransport(116, 0);
    const loopSteps: number[] = [];
    for (let f = 0; f < 400; f++) {
      const n = schedule(tr, f / 60, LOOKAHEAD, buf);
      for (let i = 0; i < n; i++) loopSteps.push(buf[i].loopStep);
    }
    loopSteps.forEach((s, i) => expect(s).toBe(i % 128));
    const p = positionAt(tr, 8 * 4 * (60 / 116) + 0.001);
    expect(p.bar).toBe(0);
    expect(p.beat).toBe(0);
  });
});
