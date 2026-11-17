/**
 * District 0, Docks: cumbia, 92 bpm, A minor.
 * Progression (one chord a bar, down the circle of fifths): Am | Dm | G | C | F | Dm | E7 | E7.
 * Hook: a clarinet figure that climbs a fourth and turns (E-A-A-B-C-B-A), sequenced down a step
 * each bar, answered in bars 5-8 by a rise to the top C and a fall over the dominant.
 */
import { bars8, chord, drums, kit, melody } from './notation';
import { Drum, type TrackDef } from './types';

const chords = [
  chord(0, 'Am', 'A', ['A', 'C', 'E'], ['A3', 'C4', 'E4']),
  chord(16, 'Dm', 'D', ['D', 'F', 'A'], ['A3', 'D4', 'F4']),
  chord(32, 'G', 'G', ['G', 'B', 'D'], ['G3', 'B3', 'D4']),
  chord(48, 'C', 'C', ['C', 'E', 'G'], ['G3', 'C4', 'E4']),
  chord(64, 'F', 'F', ['F', 'A', 'C'], ['A3', 'C4', 'F4']),
  chord(80, 'Dm', 'D', ['D', 'F', 'A'], ['A3', 'D4', 'F4']),
  chord(96, 'E7', 'E', ['E', 'G#', 'B', 'D'], ['G#3', 'D4', 'E4']),
  chord(112, 'E7', 'E', ['E', 'G#', 'B', 'D'], ['G#3', 'B3', 'E4']),
];

// Kick on 1 and 3, the guacharaca's long down-stroke on every beat with two short scrapes on the
// "and-a", conga slaps on 2 and 4 and the two open tones on the "4-and" that push the bar round.
const perc = kit(
  drums(Drum.KICK, bars8('X.......x.......')),
  drums(Drum.SCRAPE_LONG, bars8('x...x...x...x...', { 7: 'x...x...x.......' })),
  drums(Drum.SCRAPE, bars8('..ox..ox..ox..ox', { 7: '..ox..ox..oxxxxx' })),
  drums(Drum.CONGA_SLAP, bars8('....x.......x...', { 3: '....x.......x.o.' })),
  drums(Drum.CONGA_LO, bars8('..............xx', { 7: '..............XX' })),
  drums(Drum.CONGA_HI, bars8('................', { 3: '..........o.....', 7: '........x.x.x...' })),
);

// Tumbao: root on 1, the fifth anticipating beat 3, and the next chord's root pushed onto the
// "4-and" and tied over the bar line (bars 2-7 therefore begin with a tie).
const bass = melody([
  'A1! - - . . . E2 . E2 - . . A1 . D2! -',
  '- - . . . . A1 . A1 - . . D2 . G1! -',
  '- - . . . . D2 . D2 - . . G1 . C2! -',
  '- - . . . . G1 . G1 - . . C2 . F1! -',
  '- - . . . . C2 . C2 - . . F1 . D2! -',
  '- - . . . . A1 . A1 - . . D2 . E2! -',
  '- - . . . . B1 . B1 - . . E2 . G#1 .',
  'E1! - - . . . B1 . B1 - . . E2 D2 C2 B1',
]);

// Accordion: off-beat stabs, the second one leaned on.
const harmony = melody(
  bars8('. . c . . . c! . . . c . . . c .', {
    3: '. . c . . . c! . . . c . . c . c',
    7: '. . c . . . c! . . . c . c . c c',
  }),
  chords,
);

const lead = melody([
  'E5! . A5 . A5 B5 C6 . B5 . A5 . E5 - - .',
  'F5 . A5 . A5 G5 F5 . E5 . D5 - - . . .',
  'D5 . G5 . G5 A5 B5 . A5 . G5 . D5 - - .',
  'E5 . G5 . G5 F5 E5 . D5 . C5 - - . . .',
  'C5 . F5 . F5 G5 A5 . G5 . F5 . C6! - - .',
  'D6 . C6 . A5 . F5 . D5 . F5 . A5 - . .',
  'G#5 - - . B5 . D6 - - . B5 . G#5 . E5 .',
  'F5 . E5 . D5 . C5 . B4 - - - . . . .',
]);

export const CUMBIA: TrackDef = {
  district: 0,
  name: 'Docks',
  style: 'cumbia',
  bpm: 92,
  keyName: 'A minor',
  keyRoot: 9,
  scale: [0, 2, 3, 5, 7, 8, 10],
  bars: 8,
  stepsPerBar: 16,
  chords,
  voices: { perc: 'cumbia', bass: 'tumbao', harmony: 'accordion', lead: 'clarinet' },
  stems: [perc, bass, harmony, lead],
};
