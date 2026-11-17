/**
 * District 2, Terraces: highlife, 116 bpm, G major.
 * Progression: G | C | D | G | Em | C | Am | D (I-IV-V-I, then vi-IV-ii-V back home).
 * Hook: horns in thirds that bounce B/G - D/B and leap to G/E over C; the second half lifts the
 * same shape a third higher over Em and C, then cadences on F#/A down into the top of the loop.
 * Where the horns sit low (bars 3, 7 and 8) the guitar is voiced an octave down, under them.
 */
import { bars8, chord, drums, kit, melody } from './notation';
import { Drum, type TrackDef } from './types';

const chords = [
  chord(0, 'G', 'G', ['G', 'B', 'D'], ['G3', 'B3', 'D4', 'G4']),
  chord(16, 'C', 'C', ['C', 'E', 'G'], ['G3', 'C4', 'E4', 'G4']),
  chord(32, 'D', 'D', ['D', 'F#', 'A'], ['D3', 'F#3', 'A3', 'D4']),
  chord(48, 'G', 'G', ['G', 'B', 'D'], ['G3', 'B3', 'D4', 'G4']),
  chord(64, 'Em', 'E', ['E', 'G', 'B'], ['G3', 'B3', 'E4', 'G4']),
  chord(80, 'C', 'C', ['C', 'E', 'G'], ['G3', 'C4', 'E4', 'G4']),
  chord(96, 'Am', 'A', ['A', 'C', 'E'], ['E3', 'A3', 'C4', 'E4']),
  chord(112, 'D', 'D', ['D', 'F#', 'A'], ['D3', 'F#3', 'A3', 'D4']),
];

// Son-clave timeline on the clave, off-beat bell, 16th shaker leaning on the off-beats, a soft
// kick, and a conga run in the last bar.
const perc = kit(
  drums(Drum.CLAVE, bars8('x..x..x...x.x...')),
  drums(Drum.BELL_HI, bars8('..x...x...x...x.')),
  drums(Drum.BELL_LO, bars8('x.......x.......', { 7: 'x...............' })),
  drums(Drum.SHAKER, bars8('goxogoxogoxogoxo')),
  drums(Drum.KICK, bars8('x.......x..o....')),
  drums(Drum.CONGA_HI, bars8('................', { 3: '............o.o.', 7: '........x.x.x...' })),
  drums(Drum.CONGA_LO, bars8('................', { 7: '..............xx' })),
);

// Walking bass, every bar stepping toward the next chord's root.
const bass = melody([
  'G1! . . . D2 . . . G1 . A1 . B1 . . .',
  'C2! . . . E2 . . . G2 . . . E2 . . .',
  'D2! . . . A1 . . . D2 . E2 . F#2 . . .',
  'G2! . . . D2 . . . B1 . . . G1 . F#1 .',
  'E1! . . . B1 . . . E2 . . . D2 . . .',
  'C2! . . . G1 . . . E2 . . . C2 . B1 .',
  'A1! . . . E2 . . . C2 . . . B1 . C2 .',
  'D2! . . . A1 . . . D2 . . . F#1 . A1 .',
]);

// Palm-wine guitar: a low part on the 8ths (voicing notes 1 and 2) interlocked with an upper part
// on the 16ths in between (3 and 4).
const harmony = melody(
  bars8('1 . 4 3 2 . 4 3 1 . 4 3 2 3 4 .', {
    3: '1 . 4 3 2 . 4 3 1 3 2 4 3 2 4 3',
    7: '1 . 4 3 2 . 4 3 1 3 2 4 3 2 4 3',
  }),
  chords,
);

const lead = melody([
  'D5/B4! . . B4/G4 . . D5/B4 . E5/C5 . D5/B4 . B4/G4 . . .',
  'C5/A4 . E5/C5 . G5/E5! - - . E5/C5 . D5/B4 . C5/A4 . . .',
  'A4/F#4 . . F#4/D4 . . A4/F#4 . B4/G4 . A4/F#4 . F#4/D4 . . .',
  'B4/G4 . D5/B4 . G5/E5! - - . F#5/D5 . E5/C5 . D5/B4 - . .',
  'G5/E5! . . E5/C5 . . G5/E5 . A5/F#5 . G5/E5 . E5/C5 . . .',
  'E5/C5 . G5/E5 . C6/A5! - - . A5/F#5 . G5/E5 . E5/C5 . . .',
  'C5/A4 . . E5/C5 . . C5/A4 . D5/B4 . C5/A4 . A4/F#4 . . .',
  'A4/F#4! - - - . . . . . . D5/B4 . C5/A4 . A4/F#4 .',
]);

export const HIGHLIFE: TrackDef = {
  district: 2,
  name: 'Terraces',
  style: 'highlife',
  bpm: 116,
  keyName: 'G major',
  keyRoot: 7,
  scale: [0, 2, 4, 5, 7, 9, 11],
  bars: 8,
  stepsPerBar: 16,
  chords,
  voices: { perc: 'highlife', bass: 'walk', harmony: 'guitar', lead: 'hornThirds' },
  stems: [perc, bass, harmony, lead],
};
