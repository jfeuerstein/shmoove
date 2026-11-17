/**
 * A tiny text notation for writing patterns by hand, parsed once at module load into plain
 * NoteEvent data.
 *
 * Drums: one string of 16 characters per bar per instrument.
 *   '.' rest, 'x' hit (0.75), 'X' accent (1.0), 'o' ghost (0.4), 'g' faint (0.25).
 *
 * Melodic: one string of 16 space-separated tokens per bar.
 *   '.' rest, '-' tie (extends the previous note, also across bar lines),
 *   a note name ('A4', 'F#2', 'Bb3') or a dyad ('D5/B4'),
 *   in harmony stems: 'c' (the current chord's voicing) or '1'..'4' (one note of the voicing).
 *   Suffix '!' accent (1.0), '?' ghost (0.4); default velocity 0.8.
 */
import { LOOP_STEPS, STEPS_PER_BAR, type ChordDef, type NoteEvent } from './types';

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' = 60. Throws on a malformed name (patterns are static data; a typo is a build error). */
export function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name '${name}'`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return LETTER[m[1]] + acc + (Number(m[3]) + 1) * 12;
}

/** 'C', 'F#', 'Bb' -> pitch class. */
export function pc(name: string): number {
  return (midi(`${name}4`) % 12 + 12) % 12;
}

/** Build a chord: name, root name, chord-tone names, voicing note names. */
export function chord(step: number, name: string, root: string, tones: string[], voicing: string[]): ChordDef {
  return { step, name, root: pc(root), tones: tones.map(pc), voicing: voicing.map(midi) };
}

/** Chord sounding at a loop step. */
export function chordAt(chords: readonly ChordDef[], step: number): ChordDef {
  let c = chords[0];
  for (const ch of chords) if (ch.step <= step) c = ch;
  return c;
}

function velOf(ch: string): number {
  switch (ch) {
    case 'X':
      return 1;
    case 'x':
      return 0.75;
    case 'o':
      return 0.4;
    case 'g':
      return 0.25;
    default:
      return 0;
  }
}

/** Parse drum grids for one instrument. `bars` has one 16-char string per bar. */
export function drums(inst: number, bars: readonly string[], out: NoteEvent[] = []): NoteEvent[] {
  bars.forEach((row, b) => {
    if (row.length !== STEPS_PER_BAR) throw new Error(`drum row '${row}' is not ${STEPS_PER_BAR} steps`);
    for (let i = 0; i < STEPS_PER_BAR; i++) {
      const v = velOf(row[i]);
      if (row[i] !== '.' && v === 0) throw new Error(`bad drum char '${row[i]}' in '${row}'`);
      if (v > 0) out.push({ step: b * STEPS_PER_BAR + i, notes: [inst], vel: v, len: 1 });
    }
  });
  return out;
}

/** Merge several instruments' events into one stem, sorted by step. */
export function kit(...parts: NoteEvent[][]): NoteEvent[] {
  return parts.flat().sort((a, b) => a.step - b.step || a.notes[0] - b.notes[0]);
}

/** Repeat a bar pattern for all 8 bars, replacing selected bars. */
export function bars8(base: string, over: Record<number, string> = {}): string[] {
  const out: string[] = [];
  for (let b = 0; b < 8; b++) out.push(over[b] ?? base);
  return out;
}

/** Parse melodic bars. `chords` resolves 'c' and digit tokens (harmony stems). */
export function melody(bars: readonly string[], chords?: readonly ChordDef[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  let last: NoteEvent | null = null;
  bars.forEach((row, b) => {
    const toks = row.trim().split(/\s+/);
    if (toks.length !== STEPS_PER_BAR) throw new Error(`bar ${b} has ${toks.length} tokens: '${row}'`);
    toks.forEach((tok, i) => {
      const step = b * STEPS_PER_BAR + i;
      if (tok === '.') {
        last = null;
        return;
      }
      if (tok === '-') {
        if (!last) throw new Error(`tie with nothing to extend at bar ${b} step ${i}`);
        last.len += 1;
        return;
      }
      let vel = 0.8;
      let body = tok;
      if (body.endsWith('!')) {
        vel = 1;
        body = body.slice(0, -1);
      } else if (body.endsWith('?')) {
        vel = 0.4;
        body = body.slice(0, -1);
      }
      let notes: number[];
      if (body === 'c' || /^[1-4]$/.test(body)) {
        if (!chords) throw new Error(`chord token '${tok}' outside a harmony stem`);
        const v = chordAt(chords, step).voicing;
        notes = body === 'c' ? v.slice() : [v[Math.min(Number(body), v.length) - 1]];
      } else {
        notes = body.split('/').map(midi);
      }
      last = { step, notes, vel, len: 1 };
      out.push(last);
    });
  });
  for (const e of out) if (e.step + e.len > LOOP_STEPS) throw new Error('note runs past the loop end');
  return out;
}
