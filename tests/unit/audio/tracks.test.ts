import { describe, expect, it } from 'vitest';
import { chordAt, LOOP_STEPS, TRACKS, validateTrack, type TrackDef } from '../../../src/audio/tracks/index';

const SPEC: Array<{ bpm: number; key: string; style: string; root: number }> = [
  { bpm: 92, key: 'A minor', style: 'cumbia', root: 9 },
  { bpm: 104, key: 'E dorian', style: 'funk', root: 4 },
  { bpm: 116, key: 'G major', style: 'highlife', root: 7 },
  { bpm: 100, key: 'F major', style: 'city pop', root: 5 },
];

describe('district tracks', () => {
  it('there is one track per district, in district order', () => {
    expect(TRACKS.length).toBe(4);
    TRACKS.forEach((t, i) => expect(t.district).toBe(i));
  });

  TRACKS.forEach((t, i) => {
    describe(t.style, () => {
      it('validates', () => {
        expect(validateTrack(t)).toEqual([]);
      });

      it('has the specified tempo, key and style', () => {
        expect(t.bpm).toBe(SPEC[i].bpm);
        expect(t.keyName).toBe(SPEC[i].key);
        expect(t.keyRoot).toBe(SPEC[i].root);
        expect(t.style).toBe(SPEC[i].style);
        expect(t.bars).toBe(8);
        expect(t.stepsPerBar).toBe(16);
      });

      it('moves through at least 4 distinct chord roots across the loop', () => {
        const heard = new Set<number>();
        for (const e of t.stems[2]) heard.add(chordAt(t.chords, e.step).root);
        expect(heard.size).toBeGreaterThanOrEqual(4);
      });

      it('the lead hook comes back: bars 1 and 3 or 1 and 5 share their rhythm', () => {
        const rhythm = (bar: number) =>
          t.stems[3].filter((e) => e.step >= bar * 16 && e.step < bar * 16 + 16).map((e) => e.step - bar * 16).join(',');
        expect(rhythm(0) === rhythm(2) || rhythm(0) === rhythm(4)).toBe(true);
      });
    });
  });

  it('the validator catches broken tracks', () => {
    const base = TRACKS[0];
    const broken = (f: (t: TrackDef) => void): string[] => {
      const t: TrackDef = structuredClone(base);
      f(t);
      return validateTrack(t);
    };
    expect(broken((t) => (t.bars = 4))).not.toEqual([]);
    expect(broken((t) => t.stems[1].push({ step: 3, notes: [90], vel: 0.8, len: 1 }))).not.toEqual([]);
    expect(broken((t) => t.stems[0].push({ step: 3, notes: [99], vel: 0.8, len: 1 }))).not.toEqual([]);
    expect(broken((t) => (t.stems[3] = t.stems[3].filter((e) => e.step >= 32)))).not.toEqual([]);
    expect(broken((t) => t.stems[2].push({ step: LOOP_STEPS - 1, notes: [57], vel: 0.8, len: 4 }))).not.toEqual([]);
    expect(broken((t) => (t.chords = t.chords.map((c) => ({ ...c, root: 9, tones: [9, 0, 4], voicing: [57, 60, 64] }))))).not.toEqual([]);
    // A harmony note outside its chord.
    expect(broken((t) => t.stems[2].push({ step: 0, notes: [59], vel: 0.8, len: 1 }))).not.toEqual([]);
  });
});
