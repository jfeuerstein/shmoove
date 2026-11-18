/**
 * The clock. `FixedStepper` turns real elapsed time into whole sim steps of exactly `DT` plus an
 * interpolation alpha; `RafDriver` feeds it from `requestAnimationFrame`; `FrameStats` keeps the
 * running averages the perf runner reads.
 *
 * `FixedStepper` and `FrameStats` are pure and DOM-free. `RafDriver` touches the frame callback only
 * when started, and takes it as a parameter so it can be driven by hand.
 */
import { DT } from '../sim/constants';

/** Most steps one call may run. Anything beyond is dropped, so a backgrounded tab never fast-forwards. */
export const MAX_STEPS_PER_FRAME = 5;

/** Float slack, so that feeding exactly n * DT runs exactly n steps. */
const EPS = 1e-9;

export class FixedStepper {
  readonly dt: number;
  readonly maxSteps: number;
  private acc = 0;

  constructor(dt = DT, maxSteps = MAX_STEPS_PER_FRAME) {
    this.dt = dt;
    this.maxSteps = maxSteps;
  }

  /**
   * Advance by `elapsed` real seconds, calling `step` once per whole step due (at most `maxSteps`).
   * Returns the share of the next step already elapsed, 0..1: the interpolation alpha.
   */
  advance(elapsed: number, step: () => void): number {
    if (elapsed > 0 && Number.isFinite(elapsed)) this.acc += elapsed;
    else if (elapsed === Infinity) this.acc += this.dt * (this.maxSteps + 1);
    const dt = this.dt;
    let n = 0;
    while (this.acc >= dt - EPS && n < this.maxSteps) {
      step();
      this.acc -= dt;
      n++;
    }
    if (this.acc >= dt - EPS) {
      // Over the cap: keep only the part of a step, never whole steps.
      this.acc -= Math.floor((this.acc + EPS) / dt) * dt;
    }
    if (this.acc < 0) this.acc = 0;
    return this.alpha;
  }

  /** The current interpolation alpha, 0..1. */
  get alpha(): number {
    const a = this.acc / this.dt;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /** Forget any partial step (after a pause, so the next frame starts clean). */
  reset(): void {
    this.acc = 0;
  }
}

export type FrameRequest = (cb: (timeMs: number) => void) => number;
export type FrameCancel = (handle: number) => void;

/**
 * Calls `frame(dtSeconds)` once per animation frame while running. The first frame after a start
 * or a resume gets dt 0, so time spent paused is never fed to the stepper.
 */
export class RafDriver {
  private readonly frame: (dt: number) => void;
  private readonly request: FrameRequest;
  private readonly cancel: FrameCancel;
  private handle = 0;
  private last = -1;
  private on = false;
  private readonly tick = (timeMs: number): void => {
    if (!this.on) return;
    this.handle = this.request(this.tick);
    const dt = this.last < 0 ? 0 : Math.max(0, (timeMs - this.last) / 1000);
    this.last = timeMs;
    this.frame(dt);
  };

  constructor(frame: (dt: number) => void, request?: FrameRequest, cancel?: FrameCancel) {
    this.frame = frame;
    this.request = request ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = cancel ?? ((h) => cancelAnimationFrame(h));
  }

  get running(): boolean {
    return this.on;
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.last = -1;
    this.handle = this.request(this.tick);
  }

  /** Stop calling `frame` until `start()`. */
  pause(): void {
    if (!this.on) return;
    this.on = false;
    this.cancel(this.handle);
  }
}

/** Number of frames the averages cover. */
export const STATS_WINDOW = 120;

export interface FrameStatsSummary {
  drawCalls: number;
  triangles: number;
  /** Mean work per frame (sim steps, views, render submission), ms. */
  frameMs: number;
  /** Mean time of one sim step (input sample plus `Sim.step`), ms. */
  stepMs: number;
}

/** A ring of the last `STATS_WINDOW` frames. Recording allocates nothing. */
export class FrameStats {
  private readonly size: number;
  private readonly draw: Float64Array;
  private readonly tris: Float64Array;
  private readonly work: Float64Array;
  private readonly stepTime: Float64Array;
  private readonly steps: Float64Array;
  private next = 0;
  private count = 0;

  constructor(size = STATS_WINDOW) {
    this.size = size;
    this.draw = new Float64Array(size);
    this.tris = new Float64Array(size);
    this.work = new Float64Array(size);
    this.stepTime = new Float64Array(size);
    this.steps = new Float64Array(size);
  }

  /** One frame: its draw calls and triangles, its total work, and the time and count of its sim steps. */
  record(drawCalls: number, triangles: number, frameMs: number, stepMsTotal: number, steps: number): void {
    const i = this.next;
    this.draw[i] = drawCalls;
    this.tris[i] = triangles;
    this.work[i] = frameMs;
    this.stepTime[i] = stepMsTotal;
    this.steps[i] = steps;
    this.next = (i + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  get frames(): number {
    return this.count;
  }

  summary(): FrameStatsSummary {
    const n = this.count;
    if (n === 0) return { drawCalls: 0, triangles: 0, frameMs: 0, stepMs: 0 };
    let d = 0;
    let t = 0;
    let w = 0;
    let st = 0;
    let sn = 0;
    for (let i = 0; i < n; i++) {
      d += this.draw[i];
      t += this.tris[i];
      w += this.work[i];
      st += this.stepTime[i];
      sn += this.steps[i];
    }
    return { drawCalls: d / n, triangles: t / n, frameMs: w / n, stepMs: sn > 0 ? st / sn : 0 };
  }
}
