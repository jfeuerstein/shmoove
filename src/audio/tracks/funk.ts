/**
 * District 1, Mercado Steps: funk, 104 bpm, E dorian.
 * Progression: Em7 | A9 | Em7 | A9 | Gmaj7 | F#m7 | Em7 | Bm7 (the i7-IV9 dorian vamp, then a
 * climb out and a minor-v turnaround).
 * Hook: a horn-section call that jabs E twice and bends up to G, answered by a held C#/A drop;
 * the second half restates it a third lower over Gmaj7 and ends climbing to B.
 */
import { bars8, chord, drums, kit, melody } from './notation';
import { Drum, type TrackDef } from './types';

const chords = [
  chord(0, 'Em7', 'E', ['E', 'G', 'B', 'D'], ['G4', 'B4', 'D5']),
  chord(16, 'A9', 'A', ['A', 'C#', 'E', 'G', 'B'], ['G4', 'B4', 'C#5']),
  chord(32, 'Em7', 'E', ['E', 'G', 'B', 'D'], ['G4', 'B4', 'D5']),
  chord(48, 'A9', 'A', ['A', 'C#', 'E', 'G', 'B'], ['G4', 'B4', 'C#5']),
  chord(64, 'Gmaj7', 'G', ['G', 'B', 'D', 'F#'], ['F#4', 'B4', 'D5']),
  chord(80, 'F#m7', 'F#', ['F#', 'A', 'C#', 'E'], ['E4', 'A4', 'C#5']),
  chord(96, 'Em7', 'E', ['E', 'G', 'B', 'D'], ['G4', 'B4', 'D5']),
  chord(112, 'Bm7', 'B', ['B', 'D', 'F#', 'A'], ['F#4', 'A4', 'D5']),
];

const perc = kit(
  drums(Drum.KICK, bars8('X......x..X.....', { 7: 'X......x..X..x..' })),
  drums(Drum.SNARE, bars8('...oX..o.o..X..o', { 3: '...oX..o.o..X.oo', 7: '...oX..o.oX.XoXX' })),
  drums(Drum.HAT, bars8('xoxoxoxoxoxoxoxo', { 3: 'xoxoxoxoxoxoxo.o', 7: 'xoxoxoxoxo......' })),
  drums(Drum.OHAT, bars8('................', { 3: '..............x.' })),
);

// Slap bass: thumb on the root, octave pop on the "e" of 2, a run back down into the next bar.
const bass = melody([
  'E1! . . E1 E2! . . E1 . . G1 A1 . E2! D2 B1',
  'A1! . . A1 A2! . . A1 . . C#2 B1 . A2! G1 E1',
  'E1! . . E1 E2! . . E1 . . G1 A1 . E2! D2 B1',
  'A1! . . A1 A2! . . A1 . . C#2 B1 . A2! G1 E1',
  'G1! . . G1 G2! . . G1 . . B1 D2 . G2! F#2 D2',
  'F#1! . . F#1 F#2! . . F#1 . . A1 C#2 . F#2! E2 C#2',
  'E1! . . E1 E2! . . E1 . . G1 A1 . E2! D2 B1',
  'B1! . . B1 B2! . . A1 . B1 . D2 . F#2 E2 D2',
]);

// Wah clav: chord jabs with muted 16th scratches (the '?' hits are played as dead-string chops).
const harmony = melody(
  bars8('c! . c? c . c? c . c? . c c? . c c? .', {
    7: 'c! . c? c . c? c . c? c? c c? c c? c c?',
  }),
  chords,
);

const lead = melody([
  '. . E5! . . E5 . G5! - . . E5 . . D5 .',
  'E5! - - - . . . . . . . . C#5 . B4 .',
  '. . E5! . . E5 . G5! - . . E5 . . A5! -',
  '- - G5 . . E5 . . . . . . . . . .',
  '. . D5! . . D5 . F#5! - . . D5 . . B4 .',
  'C#5! - - - . . . . . . A4 . C#5 . E5 .',
  '. . E5! . . E5 . G5! - . . A5 . . B5! -',
  '- - A5 . F#5 . . D5 . . . . . . . .',
]);

export const FUNK: TrackDef = {
  district: 1,
  name: 'Mercado Steps',
  style: 'funk',
  bpm: 104,
  keyName: 'E dorian',
  keyRoot: 4,
  scale: [0, 2, 3, 5, 7, 9, 10],
  bars: 8,
  stepsPerBar: 16,
  chords,
  voices: { perc: 'funk', bass: 'slap', harmony: 'clav', lead: 'horns' },
  stems: [perc, bass, harmony, lead],
};
