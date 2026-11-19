import { describe, expect, it } from 'vitest';
import { FixedStepper, FrameStats, MAX_STEPS_PER_FRAME, RafDriver } from '../../src/app/loop';
import { DT } from '../../src/sim/constants';

function counter(): { n: number; step: () => void } {
  const c = { n: 0, step: () => void c.n++ };
  return c;
}

describe('FixedStepper', () => {
  it('runs exactly one step per 1/60 s fed', () => {
    const s = new FixedStepper();
    const c = counter();
    for (let i = 0; i < 600; i++) s.advance(DT, c.step);
    expect(c.n).toBe(600);
  });

  it('runs exact step counts for given times', () => {
    const cases: [number, number][] = [
      [0, 0],
      [DT * 0.5, 0],
      [DT, 1],
      [0.05, 3],
      [0.06, 3],
      [1 / 30, 2],
      [0.0833334, 5],
    ];
    for (const [t, want] of cases) {
      const s = new FixedStepper();
      const c = counter();
      s.advance(t, c.step);
      expect(c.n, `t=${t}`).toBe(want);
    }
  });

  it('carries partial steps from frame to frame', () => {
    const s = new FixedStepper();
    const c = counter();
    // 144 Hz display: 0.6 s of frames is 36 steps.
    for (let i = 0; i < 0.6 * 144; i++) s.advance(1 / 144, c.step);
    expect(c.n).toBe(36);
    // 50 Hz frames over 2 s: 120 steps.
    const s2 = new FixedStepper();
    const c2 = counter();
    for (let i = 0; i < 100; i++) s2.advance(1 / 50, c2.step);
    expect(c2.n).toBe(120);
  });

  it('never runs more than 5 steps in one call', () => {
    expect(MAX_STEPS_PER_FRAME).toBe(5);
    for (const t of [6 * DT, 0.2, 1, 30, Infinity]) {
      const s = new FixedStepper();
      const c = counter();
      s.advance(t, c.step);
      expect(c.n, `t=${t}`).toBe(5);
    }
  });

  it('drops time beyond the cap instead of banking it', () => {
    const s = new FixedStepper();
    const c = counter();
    s.advance(10, c.step); // a tab back from the background
    expect(c.n).toBe(5);
    c.n = 0;
    s.advance(DT, c.step);
    expect(c.n).toBe(1);
    c.n = 0;
    s.advance(0, c.step);
    expect(c.n).toBe(0);
  });

  it('returns alpha in 0..1, the share of the next step elapsed', () => {
    const s = new FixedStepper();
    const c = counter();
    expect(s.advance(DT * 0.25, c.step)).toBeCloseTo(0.25, 9);
    expect(s.advance(DT * 0.5, c.step)).toBeCloseTo(0.75, 9);
    expect(s.advance(DT * 0.5, c.step)).toBeCloseTo(0.25, 9);
    expect(c.n).toBe(1);
    for (const t of [0, 1e-5, DT * 0.999, 0.3, 7, -1, Number.NaN]) {
      const a = s.advance(t, c.step);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('ignores negative and non-numeric time', () => {
    const s = new FixedStepper();
    const c = counter();
    s.advance(-1, c.step);
    s.advance(Number.NaN, c.step);
    expect(c.n).toBe(0);
    expect(s.alpha).toBe(0);
  });

  it('reset forgets a partial step', () => {
    const s = new FixedStepper();
    const c = counter();
    s.advance(DT * 0.9, c.step);
    s.reset();
    s.advance(DT * 0.5, c.step);
    expect(c.n).toBe(0);
  });
});

describe('RafDriver', () => {
  function fakeRaf() {
    let queued: ((t: number) => void) | null = null;
    let cancelled = 0;
    return {
      request: (cb: (t: number) => void) => {
        queued = cb;
        return 1;
      },
      cancel: () => {
        queued = null;
        cancelled++;
      },
      fire(t: number) {
        const cb = queued;
        queued = null;
        if (cb) cb(t);
      },
      get pending() {
        return queued !== null;
      },
      get cancelled() {
        return cancelled;
      },
    };
  }

  it('feeds real seconds between frames, 0 on the first', () => {
    const raf = fakeRaf();
    const dts: number[] = [];
    const d = new RafDriver((dt) => dts.push(dt), raf.request, raf.cancel);
    d.start();
    raf.fire(1000);
    raf.fire(1016);
    raf.fire(1050);
    expect(dts[0]).toBe(0);
    expect(dts[1]).toBeCloseTo(0.016, 9);
    expect(dts[2]).toBeCloseTo(0.034, 9);
  });

  it('stops while paused and does not feed the paused time on resume', () => {
    const raf = fakeRaf();
    const dts: number[] = [];
    const d = new RafDriver((dt) => dts.push(dt), raf.request, raf.cancel);
    d.start();
    raf.fire(0);
    raf.fire(16);
    d.pause();
    expect(d.running).toBe(false);
    expect(raf.pending).toBe(false);
    expect(raf.cancelled).toBe(1);
    raf.fire(5000);
    expect(dts.length).toBe(2);
    d.start();
    raf.fire(9000);
    raf.fire(9016);
    expect(dts).toHaveLength(4);
    expect(dts[2]).toBe(0);
    expect(dts[3]).toBeCloseTo(0.016, 9);
  });
});

describe('FrameStats', () => {
  it('averages the last 120 frames only', () => {
    const s = new FrameStats();
    for (let i = 0; i < 200; i++) s.record(1000, 1, 100, 100, 1); // old, heavy frames
    for (let i = 0; i < 120; i++) s.record(10, 5000, 4, 0.5, 2);
    const r = s.summary();
    expect(s.frames).toBe(120);
    expect(r.drawCalls).toBe(10);
    expect(r.triangles).toBe(5000);
    // 3.5 ms of drawing plus one 0.25 ms step, though each frame ran two.
    expect(r.frameMs).toBeCloseTo(3.75, 9);
    expect(r.stepMs).toBeCloseTo(0.25, 9);
  });

  it('reports the same frame work however many steps a frame had to catch up', () => {
    const one = new FrameStats();
    const five = new FrameStats();
    for (let i = 0; i < 120; i++) {
      one.record(10, 5000, 3 + 0.8, 0.8, 1);
      five.record(10, 5000, 3 + 5 * 0.8, 5 * 0.8, 5);
    }
    expect(five.summary().frameMs).toBeCloseTo(one.summary().frameMs, 9);
    expect(five.summary().stepMs).toBeCloseTo(0.8, 9);
  });

  it('reads zero before any frame and with no steps', () => {
    const s = new FrameStats();
    expect(s.summary()).toEqual({ drawCalls: 0, triangles: 0, frameMs: 0, stepMs: 0 });
    s.record(3, 30, 2, 0, 0);
    expect(s.summary().stepMs).toBe(0);
  });
});
