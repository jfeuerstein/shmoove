/** The four district tracks, a pure validator, and lookup helpers. */
import { chordAt } from './notation';
import { CITYPOP } from './citypop';
import { CUMBIA } from './cumbia';
import { FUNK } from './funk';
import { HIGHLIFE } from './highlife';
import { BARS, DRUM_COUNT, LOOP_STEPS, STEM_NAMES, STEPS_PER_BAR, type NoteEvent, type TrackDef } from './types';

export * from './types';
export { chordAt } from './notation';

/** Indexed by district. */
export const TRACKS: readonly TrackDef[] = [CUMBIA, FUNK, HIGHLIFE, CITYPOP];

/** Sane MIDI ranges per melodic stem (inclusive). */
export const STEM_RANGES: Record<number, [number, number]> = {
  1: [24, 60],
  2: [48, 88],
  3: [55, 96],
};

/** Seconds per beat / per 16th step / per bar. */
export function beatSeconds(bpm: number): number {
  return 60 / bpm;
}
export function barSeconds(bpm: number): number {
  return (4 * 60) / bpm;
}

/**
 * The note of the track's scale for link n of a chain (n >= 1): link 1 is the tonic, link 2 the
 * second degree, and so on, climbing an octave every 7 links. Starts at the tonic above A4.
 */
export function scaleNote(track: TrackDef, n: number): number {
  const i = Math.max(0, Math.floor(n) - 1);
  const base = 69 + ((track.keyRoot - 9 + 12) % 12);
  return base + track.scale[i % 7] + 12 * Math.floor(i / 7);
}

/** Events of each stem bucketed by loop step: index[stem][step] -> events starting there. */
export function stepIndex(track: TrackDef): NoteEvent[][][] {
  return track.stems.map((events) => {
    const byStep: NoteEvent[][] = [];
    for (let s = 0; s < LOOP_STEPS; s++) byStep.push([]);
    for (const e of events) byStep[e.step].push(e);
    return byStep;
  });
}

/** Every rule a track must satisfy. Returns human-readable problems; empty means valid. */
export function validateTrack(t: TrackDef): string[] {
  const errs: string[] = [];
  const where = (stem: number, e: NoteEvent) => `${t.style} ${STEM_NAMES[stem]} step ${e.step}`;
  if (t.bars !== BARS) errs.push(`${t.style}: ${t.bars} bars, want ${BARS}`);
  if (t.stepsPerBar !== STEPS_PER_BAR) errs.push(`${t.style}: ${t.stepsPerBar} steps a bar, want ${STEPS_PER_BAR}`);
  if (!(t.bpm >= 60 && t.bpm <= 160)) errs.push(`${t.style}: tempo ${t.bpm} out of range`);
  if (t.scale.length !== 7 || t.scale[0] !== 0) errs.push(`${t.style}: scale must have 7 degrees from 0`);
  for (let i = 1; i < t.scale.length; i++) if (t.scale[i] <= t.scale[i - 1]) errs.push(`${t.style}: scale not ascending`);
  const scalePcs = new Set(t.scale.map((d) => (t.keyRoot + d) % 12));

  // Chords.
  if (t.chords.length === 0 || t.chords[0].step !== 0) errs.push(`${t.style}: progression must start at step 0`);
  for (let i = 1; i < t.chords.length; i++) {
    if (t.chords[i].step <= t.chords[i - 1].step) errs.push(`${t.style}: chords out of order`);
  }
  for (const c of t.chords) {
    if (!c.tones.includes(c.root)) errs.push(`${t.style}: ${c.name} root not among its tones`);
    for (const n of c.voicing) if (!c.tones.includes(n % 12)) errs.push(`${t.style}: ${c.name} voicing has a non-chord tone`);
  }
  const roots = new Set(t.chords.map((c) => c.root));
  if (roots.size < 4) errs.push(`${t.style}: only ${roots.size} distinct chord roots`);

  t.stems.forEach((events, stem) => {
    if (events.length === 0) errs.push(`${t.style} ${STEM_NAMES[stem]}: empty`);
    for (const e of events) {
      if (!Number.isInteger(e.step) || e.step < 0 || e.step >= LOOP_STEPS) errs.push(`${where(stem, e)}: step out of loop`);
      if (!(e.len >= 1) || e.step + e.len > LOOP_STEPS) errs.push(`${where(stem, e)}: bad length ${e.len}`);
      if (!(e.vel > 0 && e.vel <= 1)) errs.push(`${where(stem, e)}: bad velocity ${e.vel}`);
      if (e.notes.length === 0) errs.push(`${where(stem, e)}: no notes`);
      if (stem === 0) {
        for (const n of e.notes) if (!Number.isInteger(n) || n < 0 || n >= DRUM_COUNT) errs.push(`${where(stem, e)}: unknown drum ${n}`);
        continue;
      }
      const [lo, hi] = STEM_RANGES[stem];
      const ch = chordAt(t.chords, e.step);
      for (const n of e.notes) {
        if (!Number.isInteger(n) || n < lo || n > hi) errs.push(`${where(stem, e)}: note ${n} outside ${lo}..${hi}`);
        const p = ((n % 12) + 12) % 12;
        if (stem === 2) {
          if (!ch.tones.includes(p)) errs.push(`${where(stem, e)}: harmony note ${n} not in ${ch.name}`);
        } else if (!scalePcs.has(p) && !ch.tones.includes(p)) {
          errs.push(`${where(stem, e)}: note ${n} neither in key nor in ${ch.name}`);
        }
      }
    }
    // Every 2-bar window has something to play, so any stem alone keeps moving.
    for (let w = 0; w < BARS; w += 2) {
      const a = w * STEPS_PER_BAR;
      const b = a + 2 * STEPS_PER_BAR;
      if (!events.some((e) => e.step >= a && e.step < b)) errs.push(`${t.style} ${STEM_NAMES[stem]}: silent in bars ${w + 1}-${w + 2}`);
    }
  });
  return errs;
}
