import { describe, expect, it } from 'vitest';
import {
  BAR,
  barPlace,
  BPM,
  DRUM_CRASH,
  DRUM_KICK,
  DRUM_SNARE,
  DRUM_TOM_HI,
  DRUM_TOM_LO,
  inKey,
  KEY_ROOT,
  makeGroove,
  makeNoteBuf,
  MAX_TONES,
  pentatonic,
  STEM_BASS,
  STEM_COUNT,
  STEM_DRUMS,
  STEM_GUITAR,
  STEM_HORNS,
  STEM_KEYS,
  stepTime,
  STEPS_PER_BAR,
  writeBar,
  type NoteBuf,
} from '../../src/audio/music';

/** A plain copy of a bar, for comparing. */
function snapshot(b: NoteBuf): string[] {
  const out: string[] = [];
  for (let i = 0; i < b.count; i++) {
    const tones: number[] = [];
    for (let k = 0; k < b.toneCount[i]; k++) tones.push(b.tones[i * MAX_TONES + k]);
    out.push(`${b.stem[i]}@${b.step[i]}:${b.pitch[i]}x${b.dur[i].toFixed(2)}v${b.vel[i].toFixed(2)}[${tones.join(',')}]`);
  }
  return out;
}

function bar(seed: number, n: number, transpose = 0): NoteBuf {
  const b = makeNoteBuf();
  writeBar(makeGroove(seed), n, transpose, b);
  return b;
}

/** Every pitch a non-drum note plays: its tones, or its one pitch. */
function pitches(b: NoteBuf, i: number): number[] {
  if (b.toneCount[i] === 0) return [b.pitch[i]];
  const out: number[] = [];
  for (let k = 0; k < b.toneCount[i]; k++) out.push(b.tones[i * MAX_TONES + k]);
  return out;
}

describe('the funk loop', () => {
  it('is about 104 bpm, sixteen sixteenths to a bar', () => {
    expect(BPM).toBeGreaterThanOrEqual(100);
    expect(BPM).toBeLessThanOrEqual(108);
    expect(BAR).toBeCloseTo((60 / BPM) * 4, 9);
    expect(stepTime(0)).toBe(0);
    expect(stepTime(4)).toBeCloseTo(60 / BPM, 9);
    // Swing pushes the off-beat sixteenths late, never past the next one.
    expect(stepTime(1)).toBeGreaterThan(BAR / STEPS_PER_BAR);
    expect(stepTime(1)).toBeLessThan(stepTime(2));
  });

  it('is deterministic: the same seed and bar give the same notes', () => {
    for (const seed of [1, 7, 12345]) {
      for (let n = 0; n < 16; n++) expect(snapshot(bar(seed, n))).toEqual(snapshot(bar(seed, n)));
    }
  });

  it('has notes for all five stems, sorted in time, inside the bar', () => {
    for (let n = 0; n < 16; n++) {
      const b = bar(3, n);
      const seen = new Set<number>();
      for (let i = 0; i < b.count; i++) {
        seen.add(b.stem[i]);
        expect(b.step[i]).toBeGreaterThanOrEqual(0);
        expect(b.step[i]).toBeLessThan(STEPS_PER_BAR);
        if (i > 0) expect(b.step[i]).toBeGreaterThanOrEqual(b.step[i - 1]);
        expect(b.vel[i]).toBeGreaterThan(0);
        expect(b.vel[i]).toBeLessThanOrEqual(1);
      }
      for (const s of [STEM_DRUMS, STEM_BASS, STEM_KEYS, STEM_GUITAR]) expect(seen.has(s), `bar ${n} stem ${s}`).toBe(true);
      expect(STEM_COUNT).toBe(5);
    }
    // The horns answer in bars two and four of the phrase, and rest in one and three.
    const horns = (n: number): number => {
      const b = bar(3, n);
      let c = 0;
      for (let i = 0; i < b.count; i++) if (b.stem[i] === STEM_HORNS) c++;
      return c;
    };
    expect(horns(0)).toBe(0);
    expect(horns(1)).toBeGreaterThan(0);
    expect(horns(2)).toBe(0);
    expect(horns(3)).toBeGreaterThan(0);
  });

  it('is a four-bar pattern: bar n and bar n + 4 match outside the variation', () => {
    // Bar 0 opens the cycle with a crash; from bar 1 on, every phrase but the fourth repeats.
    for (let n = 1; n < 8; n++) expect(snapshot(bar(5, n + 4))).toEqual(snapshot(bar(5, n)));
    // Cycles of sixteen bars repeat exactly.
    for (let n = 0; n < 16; n++) expect(snapshot(bar(5, n + 16))).toEqual(snapshot(bar(5, n)));
  });

  it('plays a variation every fourth time round: a turnaround, a drum fill, bigger horns', () => {
    expect(barPlace(15)).toEqual({ inPhrase: 3, variation: true, cycleStart: false });
    expect(barPlace(3).variation).toBe(false);
    expect(barPlace(16).cycleStart).toBe(true);
    // Only the fourth phrase's last bar differs from the plain phrase.
    for (let k = 0; k < 3; k++) expect(snapshot(bar(9, 12 + k))).toEqual(snapshot(bar(9, 4 + k)));
    const plain = bar(9, 3);
    const turn = bar(9, 15);
    expect(snapshot(turn)).not.toEqual(snapshot(plain));
    const drumsAt = (b: NoteBuf, step: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i < b.count; i++) if (b.stem[i] === STEM_DRUMS && b.step[i] === step) out.push(b.pitch[i]);
      return out;
    };
    for (let s = 12; s < 16; s++) {
      const hits = drumsAt(turn, s);
      expect(hits.some((d) => d === DRUM_TOM_HI || d === DRUM_TOM_LO), `fill at ${s}`).toBe(true);
      expect(drumsAt(plain, s).some((d) => d === DRUM_TOM_HI || d === DRUM_TOM_LO)).toBe(false);
    }
    // The bass walks Cmaj7 then B7: C under the first half, B under the second.
    const bassAt = (b: NoteBuf, step: number): number => {
      for (let i = 0; i < b.count; i++) if (b.stem[i] === STEM_BASS && b.step[i] === step) return b.pitch[i];
      return -1;
    };
    expect((bassAt(turn, 0) - KEY_ROOT) % 12).toBe(8);
    expect((bassAt(turn, 8) - KEY_ROOT) % 12).toBe(7);
    expect((bassAt(plain, 0) - KEY_ROOT) % 12).toBe(0);
    // A crash opens every sixteen bars and only then.
    const crash = (b: NoteBuf): boolean => drumsAt(b, 0).includes(DRUM_CRASH);
    expect(crash(bar(9, 0))).toBe(true);
    expect(crash(bar(9, 16))).toBe(true);
    for (let n = 1; n < 16; n++) expect(crash(bar(9, n))).toBe(false);
  });

  it('keeps the backbeat: kick on one, snare on two and four', () => {
    for (const seed of [1, 2, 3, 4]) {
      const b = bar(seed, 0);
      const at = (step: number, d: number): boolean => {
        for (let i = 0; i < b.count; i++) if (b.stem[i] === STEM_DRUMS && b.step[i] === step && b.pitch[i] === d) return true;
        return false;
      };
      expect(at(0, DRUM_KICK)).toBe(true);
      expect(at(4, DRUM_SNARE)).toBe(true);
      expect(at(12, DRUM_SNARE)).toBe(true);
    }
  });

  it('is in one key: every pitched note is in E dorian, but for the turnaround chords', () => {
    const turnTones = new Set([8, 0, 3, 7, 11, 2, 5]); // C E G B, then B D# F# A
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (let n = 0; n < 16; n++) {
        const b = bar(seed, n);
        const turnaround = barPlace(n).variation && barPlace(n).inPhrase === 3;
        for (let i = 0; i < b.count; i++) {
          if (b.stem[i] === STEM_DRUMS) continue;
          for (const p of pitches(b, i)) {
            if (turnaround) expect(turnTones.has((((p - KEY_ROOT) % 12) + 12) % 12), `seed ${seed} bar ${n} pitch ${p}`).toBe(true);
            else expect(inKey(p), `seed ${seed} bar ${n} stem ${b.stem[i]} pitch ${p}`).toBe(true);
          }
        }
      }
    }
  });

  it('transposes every pitched note and no drum when the key drops', () => {
    const a = bar(4, 2);
    const b = bar(4, 2, -5);
    expect(b.count).toBe(a.count);
    for (let i = 0; i < a.count; i++) {
      if (a.stem[i] === STEM_DRUMS) expect(b.pitch[i]).toBe(a.pitch[i]);
      else {
        expect(b.pitch[i]).toBe(a.pitch[i] - 5);
        expect(inKey(b.pitch[i], -5)).toBe(true);
      }
    }
  });

  it('gives different maps different grooves from the same parts', () => {
    const grooves = new Set<string>();
    for (let seed = 0; seed < 32; seed++) grooves.add(Array.from(makeGroove(seed).part).join(''));
    expect(grooves.size).toBeGreaterThan(4);
  });

  it('climbs the minor pentatonic', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(pentatonic)).toEqual([0, 3, 5, 7, 10, 12, 15]);
  });
});
