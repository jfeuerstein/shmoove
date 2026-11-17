/**
 * District 3, Antenna Hill: city pop, 100 bpm, F major.
 * Progression: Bbmaj7 | C7 | Am7 | Dm9 | Gm9 | C9 | Fmaj7 | C9sus4 (the IVmaj7-V7-iii7-vi7
 * "royal road", then ii9-V9-Imaj7 and a suspended dominant back to the top). The electric piano
 * plays rootless 3-note voicings (3rds, 7ths and 9ths) so the octave bass carries the roots.
 * Hook: a glassy bell arpeggio that climbs A-C-F and sighs down E-C, sequenced over each chord.
 */
import { bars8, chord, drums, kit, melody } from './notation';
import { Drum, type TrackDef } from './types';

const chords = [
  chord(0, 'Bbmaj7', 'Bb', ['Bb', 'D', 'F', 'A', 'C'], ['A3', 'D4', 'F4']),
  chord(16, 'C7', 'C', ['C', 'E', 'G', 'Bb', 'D'], ['Bb3', 'E4', 'G4']),
  chord(32, 'Am7', 'A', ['A', 'C', 'E', 'G'], ['C4', 'E4', 'G4']),
  chord(48, 'Dm9', 'D', ['D', 'F', 'A', 'C', 'E'], ['C4', 'E4', 'F4']),
  chord(64, 'Gm9', 'G', ['G', 'Bb', 'D', 'F', 'A'], ['Bb3', 'F4', 'A4']),
  chord(80, 'C9', 'C', ['C', 'E', 'G', 'Bb', 'D'], ['Bb3', 'D4', 'E4']),
  chord(96, 'Fmaj7', 'F', ['F', 'A', 'C', 'E', 'G'], ['A3', 'E4', 'G4']),
  chord(112, 'C9sus4', 'C', ['C', 'F', 'G', 'Bb', 'D'], ['Bb3', 'D4', 'F4']),
];

const perc = kit(
  drums(Drum.KICK, bars8('X.......X.x.....', { 7: 'X.......X.x...x.' })),
  drums(Drum.SNARE, bars8('....X.......X...', { 7: '....X.....x.XxXX' })),
  drums(Drum.HAT, bars8('X.x.X.x.X.x.X.xx', { 7: 'X.x.X.x.X.x.....' })),
  drums(Drum.CLAP, bars8('................', { 3: '............x...' })),
);

/** Octave bass: root, octave, root on the 8ths with a pushed root on the "and of 2". */
function octaves(lo: string, hi: string): string {
  return `${lo}! . ${hi} . ${lo} . ${hi} ${lo} . . ${hi} . ${lo} . ${hi} .`;
}
const bass = melody([
  octaves('Bb1', 'Bb2'),
  octaves('C2', 'C3'),
  octaves('A1', 'A2'),
  octaves('D2', 'D3'),
  octaves('G1', 'G2'),
  octaves('C2', 'C3'),
  octaves('F1', 'F2'),
  'C2! . C3 . C2 . C3 . Bb2 . A2 . G2 . F2 .',
]);

const harmony = melody(
  bars8('c! - - - - . c - . . c - - - . .', {
    7: 'c! - - - - . c - . . c - . . c -',
  }),
  chords,
);

const lead = melody([
  'A4! . . C5 . . F5 . E5 - - . C5 . . .',
  // The sigh lands on E, the third of C7 (an F held over it rubbed a minor ninth against the E).
  'D5 . . E5 . . G5 . E5 - - . E5 . D5 .',
  'C5! . . E5 . . A5 . G5 - - . E5 . . .',
  'F5 - - . E5 . D5 . C5 - - . A4 . . .',
  'A4! . . C5 . . F5 . E5 - - . D5 . . .',
  'E5 . . G5 . . Bb5 . A5 - - . G5 . E5 .',
  'F5! - - . E5 . C5 . A4 - - . G4 . A4 .',
  'C5 - - - . . . . . . . . D5 . E5 .',
]);

export const CITYPOP: TrackDef = {
  district: 3,
  name: 'Antenna Hill',
  style: 'city pop',
  bpm: 100,
  keyName: 'F major',
  keyRoot: 5,
  scale: [0, 2, 4, 5, 7, 9, 11],
  bars: 8,
  stepsPerBar: 16,
  chords,
  voices: { perc: 'citypop', bass: 'octave', harmony: 'epiano', lead: 'bell' },
  stems: [perc, bass, harmony, lead],
};
