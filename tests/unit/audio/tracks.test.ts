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

  it('where the horns answer low (funk bars 2 and 6, highlife bars 3, 7 and 8) the harmony stays under them', () => {
    const cases: Array<[style: string, bars: number[]]> = [
      ['funk', [2, 6]],
      ['highlife', [3, 7, 8]],
    ];
    for (const [style, bars] of cases) {
      const t = TRACKS.find((x) => x.style === style);
      expect(t, style).toBeDefined();
      if (!t) continue;
      for (const bar of bars) {
        const inBar = (e: { step: number }): boolean => e.step >= (bar - 1) * 16 && e.step < bar * 16;
        const leadLow = Math.min(...t.stems[3].filter(inBar).flatMap((e) => e.notes));
        const harmTop = Math.max(...t.stems[2].filter(inBar).flatMap((e) => e.notes));
        expect(harmTop, `${style} bar ${bar}`).toBeLessThanOrEqual(leadLow);
      }
    }
  });

  it('city pop bar 2 holds a tone of its C7, not the F a minor ninth above its E', () => {
    const t = TRACKS.find((x) => x.style === 'city pop');
    expect(t).toBeDefined();
    if (!t) return;
    const held = t.stems[3].filter((e) => e.step >= 16 && e.step < 32 && e.len >= 3);
    expect(held.length).toBeGreaterThan(0);
    const ch = chordAt(t.chords, 16);
    for (const e of held) for (const n of e.notes) expect(ch.tones, `note ${n}`).toContain(n % 12);
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
