/**
 * The funk loop, as data. Pure: given a seed and a bar number, the notes of every stem in that bar,
 * at which sixteenth, how long, how hard and at what pitch. Nothing here touches Web Audio.
 *
 * One key (E, dorian-flavoured minor), 104 bpm, sixteen sixteenths a bar. A phrase is four bars:
 * Em9, Em9, A13, Em9. Every fourth phrase is the variation: the last bar turns around through
 * Cmaj7 and B7, the drums fill, the horns answer bigger. The first bar of every sixteen gets a crash.
 *
 * The seed picks one of two parts for each stem, so a map has its own groove, always the same one.
 */

export const BPM = 104;
export const BEAT = 60 / BPM;
export const STEPS_PER_BAR = 16;
/** One sixteenth, s. */
export const STEP = BEAT / 4;
/** One bar, s. */
export const BAR = BEAT * 4;
/** Half a bar, s: how long a stem takes to fade in or out. */
export const HALF_BAR = BAR / 2;
/** Bars in a phrase. */
export const PHRASE_BARS = 4;
/** Every this-many-th phrase is the variation. */
export const VARIATION_EVERY = 4;
/** How far each off-beat sixteenth is pushed late, in sixteenths. */
export const SWING = 0.09;

/** The key's root as a MIDI note: E1 (41.2 Hz), the bass's lowest. Everything is written above it. */
export const KEY_ROOT = 28;
/** The key's pitch classes relative to the root: E dorian (E F# G A B C# D). */
export const KEY_SCALE: readonly number[] = [0, 2, 3, 5, 7, 9, 10];
/** The minor pentatonic over the root, for the ollie chain, the spark chime and the stingers. */
export const PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];
/** A boss drops the key a fourth until it falls, semitones. */
export const BOSS_TRANSPOSE = -5;

export const STEM_DRUMS = 0;
export const STEM_BASS = 1;
export const STEM_KEYS = 2;
export const STEM_GUITAR = 3;
export const STEM_HORNS = 4;
export const STEM_COUNT = 5;
export const STEM_NAMES: readonly string[] = ['drums', 'bass', 'keys', 'guitar', 'horns'];

/** Drum notes carry an instrument in `pitch`, not a MIDI note. */
export const DRUM_KICK = 0;
export const DRUM_SNARE = 1;
export const DRUM_GHOST = 2;
export const DRUM_HAT = 3;
export const DRUM_OPEN_HAT = 4;
export const DRUM_TOM_HI = 5;
export const DRUM_TOM_LO = 6;
export const DRUM_CRASH = 7;

/** At most this many tones sound together in one note (a chord is one note). */
export const MAX_TONES = 4;
/** Room for every note of the busiest bar. */
export const NOTE_CAPACITY = 96;

/**
 * One bar of notes, sorted by time. A note is one voice: a drum hit, a bass note, a chord stab
 * (up to `MAX_TONES` tones) or a guitar scratch (no tones: a muted strum).
 */
export interface NoteBuf {
  count: number;
  /** The bar these are for. */
  bar: number;
  stem: Uint8Array;
  /** When in the bar, in sixteenths (0..15), before swing. */
  step: Uint8Array;
  /** How long, in sixteenths. */
  dur: Float32Array;
  /** 0..1. */
  vel: Float32Array;
  /** Drums: DRUM_*. Everything else: the lowest tone as a MIDI note. */
  pitch: Float32Array;
  /** How many tones the note has, 0..MAX_TONES; tones live at `tones[i * MAX_TONES + k]`. */
  toneCount: Uint8Array;
  tones: Float32Array;
}

export function makeNoteBuf(): NoteBuf {
  return {
    count: 0,
    bar: 0,
    stem: new Uint8Array(NOTE_CAPACITY),
    step: new Uint8Array(NOTE_CAPACITY),
    dur: new Float32Array(NOTE_CAPACITY),
    vel: new Float32Array(NOTE_CAPACITY),
    pitch: new Float32Array(NOTE_CAPACITY),
    toneCount: new Uint8Array(NOTE_CAPACITY),
    tones: new Float32Array(NOTE_CAPACITY * MAX_TONES),
  };
}

/** Which of the two parts each stem plays, from the seed. */
export interface Groove {
  seed: number;
  /** 0 or 1 per stem. */
  part: Uint8Array;
}

/** A small integer hash (not the sim's RNG: this is not the sim). */
function mix32(x: number): number {
  let h = (x ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeGroove(seed: number): Groove {
  const h = mix32(seed | 0);
  const part = new Uint8Array(STEM_COUNT);
  for (let s = 0; s < STEM_COUNT; s++) part[s] = (h >>> (s * 3)) & 1;
  return { seed, part };
}

/** When a sixteenth falls, s from the start of its bar, with the swing. */
export function stepTime(step: number): number {
  return (step + ((step & 1) === 1 ? SWING : 0)) * STEP;
}

/** Where a bar sits: its place in the phrase, and whether its phrase is the variation. */
export function barPlace(bar: number): { inPhrase: number; variation: boolean; cycleStart: boolean } {
  const b = Math.max(0, Math.floor(bar));
  const phrase = Math.floor(b / PHRASE_BARS);
  return { inPhrase: b % PHRASE_BARS, variation: phrase % VARIATION_EVERY === VARIATION_EVERY - 1, cycleStart: b % (PHRASE_BARS * VARIATION_EVERY) === 0 };
}

// ---- harmony -------------------------------------------------------------------------------------
// Chords as semitones above KEY_ROOT. `root` is the bass's root; the voicings sit in the keys'
// register (E3 to B4), the horns' a little higher, the guitar's on the top strings.

interface Chord {
  root: number;
  keys: readonly number[];
  guitar: readonly number[];
  horns: readonly number[];
}

const EM9: Chord = { root: 0, keys: [27, 31, 34, 38], guitar: [36, 39, 43], horns: [36, 39, 43] };
const A13: Chord = { root: 5, keys: [27, 31, 33, 36], guitar: [36, 39, 45], horns: [36, 39, 45] };
const CMAJ7: Chord = { root: 8, keys: [27, 31, 32, 36], guitar: [36, 39, 44], horns: [36, 39, 44] };
const B7: Chord = { root: 7, keys: [29, 31, 35, 38], guitar: [35, 38, 41], horns: [35, 38, 41] };

/** The chord under sixteenth `step` of a bar. */
export function chordAt(inPhrase: number, variation: boolean, step: number): Chord {
  if (inPhrase === 2) return A13;
  if (inPhrase === 3 && variation) return step < 8 ? CMAJ7 : B7;
  return EM9;
}

/** The chord roots of the phrase, for tests and stingers: semitones above the key root. */
export function chordRoot(inPhrase: number, variation: boolean, step: number): number {
  return chordAt(inPhrase, variation, step).root;
}

// ---- the parts -----------------------------------------------------------------------------------
// Each line is [step, value, dur, vel]. For the bass, value is semitones above the chord root.

type Hit = readonly [number, number, number, number];

const KICKS: readonly (readonly number[])[] = [
  [0, 3, 8, 10],
  [0, 6, 8, 11, 14],
];
const GHOSTS: readonly (readonly number[])[] = [
  [7, 9, 15],
  [2, 7, 13],
];
const OPEN_HAT: readonly number[] = [14, 6];

const BASS: readonly (readonly Hit[])[] = [
  [
    [0, 0, 2, 1],
    [3, 12, 1, 0.8],
    [4, 0, 1, 0.45],
    [6, 10, 1, 0.75],
    [7, 12, 1, 0.85],
    [8, 0, 2, 1],
    [10, 7, 1, 0.7],
    [11, 10, 1, 0.75],
    [12, 12, 1, 0.9],
    [14, 10, 1, 0.7],
    [15, 7, 1, 0.7],
  ],
  [
    [0, 0, 3, 1],
    [3, 0, 1, 0.5],
    [5, 12, 1, 0.85],
    [6, 10, 1, 0.7],
    [8, 7, 1, 0.8],
    [9, 10, 1, 0.6],
    [10, 12, 2, 0.9],
    [13, 0, 1, 0.6],
    [14, 2, 1, 0.8],
    [15, 5, 1, 0.75],
  ],
];
/** The variation's turnaround bar: Cmaj7 then B7, walking back up to E. */
const BASS_TURN: readonly Hit[] = [
  [0, 8, 2, 1],
  [3, 20, 1, 0.8],
  [4, 8, 1, 0.45],
  [6, 15, 1, 0.75],
  [8, 7, 2, 1],
  [10, 11, 1, 0.75],
  [11, 14, 1, 0.75],
  [12, 19, 1, 0.9],
  [14, 17, 1, 0.75],
  [15, 11, 1, 0.8],
];

const KEYS: readonly (readonly Hit[])[] = [
  [
    [0, 0, 3, 0.8],
    [6, 0, 1, 0.55],
    [10, 0, 2, 0.7],
  ],
  [
    [2, 0, 1, 0.65],
    [7, 0, 2, 0.75],
    [12, 0, 1, 0.6],
    [14, 0, 1, 0.55],
  ],
];

/** Guitar chord hits; every other sixteenth is a muted scratch. */
const GUITAR_HITS: readonly (readonly number[])[] = [
  [4, 10, 12],
  [2, 6, 12],
];

/** Horn lines. value: -1 a chord stab, otherwise a single note, semitones above the key root. */
const HORNS_ANSWER: readonly (readonly Hit[])[] = [
  [
    [12, -1, 1, 0.8],
    [14, -1, 1, 0.9],
  ],
  [
    [10, -1, 1, 0.75],
    [11, -1, 2, 0.9],
  ],
];
const HORNS_LICK: readonly (readonly Hit[])[] = [
  [
    [0, -1, 1, 0.9],
    [3, -1, 1, 0.8],
    [8, 39, 1, 0.7],
    [10, 41, 1, 0.75],
    [11, 43, 1, 0.8],
    [12, 46, 2, 0.9],
  ],
  [
    [0, -1, 2, 0.9],
    [6, 43, 1, 0.7],
    [8, 46, 1, 0.8],
    [10, 43, 1, 0.75],
    [12, 41, 1, 0.75],
    [14, 39, 2, 0.8],
  ],
];
const HORNS_TURN: readonly Hit[] = [
  [0, -1, 1, 0.9],
  [3, -1, 1, 0.85],
  [6, -1, 1, 0.9],
  [8, -1, 2, 1],
  [11, -1, 1, 0.9],
  [12, 43, 1, 0.85],
  [14, 47, 2, 0.95],
];

// ---- writing a bar -------------------------------------------------------------------------------

function push(out: NoteBuf, stem: number, step: number, dur: number, vel: number, pitch: number): number {
  const i = out.count;
  if (i >= NOTE_CAPACITY) return -1;
  out.stem[i] = stem;
  out.step[i] = step;
  out.dur[i] = dur;
  out.vel[i] = vel;
  out.pitch[i] = pitch;
  out.toneCount[i] = 0;
  out.count = i + 1;
  return i;
}

function pushChord(out: NoteBuf, stem: number, step: number, dur: number, vel: number, tones: readonly number[], transpose: number): void {
  const i = push(out, stem, step, dur, vel, KEY_ROOT + tones[0] + transpose);
  if (i < 0) return;
  const n = Math.min(MAX_TONES, tones.length);
  for (let k = 0; k < n; k++) out.tones[i * MAX_TONES + k] = KEY_ROOT + tones[k] + transpose;
  out.toneCount[i] = n;
}

function writeDrums(out: NoteBuf, g: Groove, inPhrase: number, variation: boolean, cycleStart: boolean): void {
  const part = g.part[STEM_DRUMS];
  const fill = variation && inPhrase === 3;
  const kicks = KICKS[part];
  const ghosts = GHOSTS[part];
  const open = OPEN_HAT[part];
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    if (fill && s >= 12) {
      // The fill: two high toms, two low, the last one hardest.
      push(out, STEM_DRUMS, s, 1, 0.7 + (s - 12) * 0.1, s < 14 ? DRUM_TOM_HI : DRUM_TOM_LO);
      if (s === 12) push(out, STEM_DRUMS, s, 1, 0.9, DRUM_KICK);
      continue;
    }
    if (s === 0 && cycleStart) push(out, STEM_DRUMS, s, 8, 0.8, DRUM_CRASH);
    if (kicks.includes(s)) push(out, STEM_DRUMS, s, 1, s === 0 ? 1 : 0.85, DRUM_KICK);
    if (s === 4 || s === 12) push(out, STEM_DRUMS, s, 1, 1, DRUM_SNARE);
    else if (ghosts.includes(s)) push(out, STEM_DRUMS, s, 1, 0.22, DRUM_GHOST);
    if (s === open) push(out, STEM_DRUMS, s, 2, 0.5, DRUM_OPEN_HAT);
    else push(out, STEM_DRUMS, s, 1, (s & 1) === 0 ? ((s & 3) === 0 ? 0.6 : 0.45) : 0.28, DRUM_HAT);
  }
}

function writeBass(out: NoteBuf, g: Groove, inPhrase: number, variation: boolean, transpose: number): void {
  if (inPhrase === 3 && variation) {
    for (const [s, v, d, vel] of BASS_TURN) push(out, STEM_BASS, s, d, vel, KEY_ROOT + v + transpose);
    return;
  }
  const root = chordAt(inPhrase, variation, 0).root;
  for (const [s, v, d, vel] of BASS[g.part[STEM_BASS]]) push(out, STEM_BASS, s, d, vel, KEY_ROOT + root + v + transpose);
}

function writeKeys(out: NoteBuf, g: Groove, inPhrase: number, variation: boolean, transpose: number): void {
  for (const [s, , d, vel] of KEYS[g.part[STEM_KEYS]]) pushChord(out, STEM_KEYS, s, d, vel, chordAt(inPhrase, variation, s).keys, transpose);
}

function writeGuitar(out: NoteBuf, g: Groove, inPhrase: number, variation: boolean, transpose: number): void {
  const hits = GUITAR_HITS[g.part[STEM_GUITAR]];
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    if (hits.includes(s)) pushChord(out, STEM_GUITAR, s, 0.6, 0.85, chordAt(inPhrase, variation, s).guitar, transpose);
    else if ((s & 1) === 1) push(out, STEM_GUITAR, s, 0.4, 0.35, KEY_ROOT + chordAt(inPhrase, variation, s).guitar[0] + transpose);
  }
}

function writeHorns(out: NoteBuf, g: Groove, inPhrase: number, variation: boolean, transpose: number): void {
  let line: readonly Hit[] | null = null;
  if (inPhrase === 1) line = HORNS_ANSWER[g.part[STEM_HORNS]];
  else if (inPhrase === 3) line = variation ? HORNS_TURN : HORNS_LICK[g.part[STEM_HORNS]];
  if (line === null) return;
  for (const [s, v, d, vel] of line) {
    // The answer in bar 2 stabs the chord coming next (A13): it pushes into the change.
    const chord = inPhrase === 1 ? A13 : chordAt(inPhrase, variation, s);
    if (v < 0) pushChord(out, STEM_HORNS, s, d, vel, chord.horns, transpose);
    else push(out, STEM_HORNS, s, d, vel, KEY_ROOT + v + transpose);
  }
}

/**
 * Every note of bar `bar` for groove `g`, transposed by `transpose` semitones (drums are not),
 * written into `out` sorted by step. Deterministic; allocates nothing.
 */
export function writeBar(g: Groove, bar: number, transpose: number, out: NoteBuf): void {
  out.count = 0;
  out.bar = bar;
  const { inPhrase, variation, cycleStart } = barPlace(bar);
  writeDrums(out, g, inPhrase, variation, cycleStart);
  writeBass(out, g, inPhrase, variation, transpose);
  writeKeys(out, g, inPhrase, variation, transpose);
  writeGuitar(out, g, inPhrase, variation, transpose);
  writeHorns(out, g, inPhrase, variation, transpose);
  sortByStep(out);
}

/** Stable insertion sort by step: the scheduler walks a bar in time order. */
function sortByStep(b: NoteBuf): void {
  for (let i = 1; i < b.count; i++) {
    let j = i;
    while (j > 0 && b.step[j - 1] > b.step[j]) {
      swap(b, j - 1, j);
      j--;
    }
  }
}

function swap(b: NoteBuf, i: number, j: number): void {
  let t = b.stem[i];
  b.stem[i] = b.stem[j];
  b.stem[j] = t;
  t = b.step[i];
  b.step[i] = b.step[j];
  b.step[j] = t;
  t = b.toneCount[i];
  b.toneCount[i] = b.toneCount[j];
  b.toneCount[j] = t;
  let f = b.dur[i];
  b.dur[i] = b.dur[j];
  b.dur[j] = f;
  f = b.vel[i];
  b.vel[i] = b.vel[j];
  b.vel[j] = f;
  f = b.pitch[i];
  b.pitch[i] = b.pitch[j];
  b.pitch[j] = f;
  for (let k = 0; k < MAX_TONES; k++) {
    f = b.tones[i * MAX_TONES + k];
    b.tones[i * MAX_TONES + k] = b.tones[j * MAX_TONES + k];
    b.tones[j * MAX_TONES + k] = f;
  }
}

/** Semitones above the key root of step `k` of the minor pentatonic (k = 0 is the root). */
export function pentatonic(k: number): number {
  const n = Math.max(0, Math.floor(k));
  return 12 * Math.floor(n / PENTATONIC.length) + PENTATONIC[n % PENTATONIC.length];
}

/** True if a MIDI note is in the key (E dorian) once `transpose` is undone. */
export function inKey(midi: number, transpose = 0): boolean {
  const pc = (((Math.round(midi - transpose - KEY_ROOT) % 12) + 12) % 12);
  return KEY_SCALE.includes(pc);
}
