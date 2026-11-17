/**
 * Pure transport arithmetic and the lookahead scheduler. Times are plain numbers (seconds on the
 * audio clock); nothing here touches an AudioContext.
 *
 * A transport is a timeline: step k (absolute, counting from 0 forever) sounds at
 * anchor + k * stepDur. The scheduler hands out every step exactly once, in order. If the caller
 * stalls (a long frame, a hidden tab, a pause), the overdue steps are not dumped all at once and
 * not skipped: the timeline is re-anchored so the next unplayed step sounds just after "now", and
 * the music resumes where it left off.
 */
import { BARS, LOOP_STEPS, STEPS_PER_BAR } from './tracks/types';

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
/** A step this late (s) is not played late; the timeline slides instead. */
export const MAX_LATE = 0.03;
/** Lead time given to the first step after a re-anchor, s. */
export const RESYNC_LEAD = 0.02;
/** Most steps handed out by one schedule() call. */
export const MAX_STEPS_PER_CALL = 64;

export interface Transport {
  bpm: number;
  stepDur: number;
  /** Audio time of absolute step 0 of the current timeline. */
  anchor: number;
  /** Next absolute step to hand out. */
  nextStep: number;
  /** Times the timeline slid after a stall (diagnostics). */
  resyncs: number;
}

export interface ScheduledStep {
  /** Absolute step (monotonic, never repeats). */
  step: number;
  /** Step within the 8-bar loop. */
  loopStep: number;
  time: number;
}

export function stepDuration(bpm: number): number {
  return 60 / bpm / STEPS_PER_BEAT;
}

export function createTransport(bpm: number, startTime: number): Transport {
  return { bpm, stepDur: stepDuration(bpm), anchor: startTime, nextStep: 0, resyncs: 0 };
}

export function stepTime(t: Transport, step: number): number {
  return t.anchor + step * t.stepDur;
}

/** Loop step of an absolute step (wraps at 8 bars). */
export function loopStepOf(step: number): number {
  return ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
}

export interface Position {
  bar: number;
  beat: number;
  step: number;
}

/** Bar (0..7), beat (0..3) and step-in-bar (0..15) of an absolute step. */
export function positionOfStep(step: number, out: Position = { bar: 0, beat: 0, step: 0 }): Position {
  const s = loopStepOf(Math.floor(step));
  out.bar = Math.floor(s / STEPS_PER_BAR) % BARS;
  out.beat = Math.floor((s % STEPS_PER_BAR) / STEPS_PER_BEAT);
  out.step = s % STEPS_PER_BAR;
  return out;
}

/** Transport position at an audio time (clamped to step 0 before the anchor). */
export function positionAt(t: Transport, time: number, out?: Position): Position {
  const k = Math.max(0, Math.floor((time - t.anchor) / t.stepDur + 1e-9));
  return positionOfStep(k, out);
}

/** The first beat boundary at or after `time` (never before the anchor). */
export function nextBeatTime(t: Transport, time: number): number {
  const beat = t.stepDur * STEPS_PER_BEAT;
  const k = Math.max(0, Math.ceil((time - t.anchor) / beat - 1e-9));
  return t.anchor + k * beat;
}

/** The first bar boundary at or after `time`. */
export function nextBarTime(t: Transport, time: number): number {
  const bar = t.stepDur * STEPS_PER_BAR;
  const k = Math.max(0, Math.ceil((time - t.anchor) / bar - 1e-9));
  return t.anchor + k * bar;
}

/**
 * Hand out every step due before now + lookahead, in order, each exactly once. Writes into the
 * first n slots of `out` (slots are reused across calls, no allocation in steady state) and
 * returns n; entries past n are stale.
 */
export function schedule(t: Transport, now: number, lookahead: number, out: ScheduledStep[]): number {
  let n = 0;
  if (stepTime(t, t.nextStep) < now - MAX_LATE) {
    t.anchor = now + RESYNC_LEAD - t.nextStep * t.stepDur;
    t.resyncs++;
  }
  const until = now + lookahead;
  while (n < MAX_STEPS_PER_CALL) {
    const time = stepTime(t, t.nextStep);
    if (time >= until) break;
    let slot = out[n];
    if (!slot) {
      slot = { step: 0, loopStep: 0, time: 0 };
      out[n] = slot;
    }
    slot.step = t.nextStep;
    slot.loopStep = loopStepOf(t.nextStep);
    slot.time = time;
    t.nextStep++;
    n++;
  }
  return n;
}
