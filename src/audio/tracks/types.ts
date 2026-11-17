/**
 * Track data model. A track is plain data: a chord progression and four stems of note events on a
 * 16th-note grid. Nothing here touches Web Audio.
 */

export const BARS = 8;
export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = BARS * STEPS_PER_BAR;

export const STEM_NAMES = ['perc', 'bass', 'harmony', 'lead'] as const;
export const Stem = { PERC: 0, BASS: 1, HARMONY: 2, LEAD: 3 } as const;

/** Percussion instruments. A perc event's note is one of these ids. */
export const Drum = {
  KICK: 0,
  SNARE: 1,
  HAT: 2,
  OHAT: 3,
  SHAKER: 4,
  SCRAPE: 5,
  SCRAPE_LONG: 6,
  CONGA_LO: 7,
  CONGA_HI: 8,
  CONGA_SLAP: 9,
  BELL_HI: 10,
  BELL_LO: 11,
  CLAVE: 12,
  CLAP: 13,
  RIM: 14,
} as const;
export const DRUM_COUNT = 15;

export type KitVoice = 'cumbia' | 'funk' | 'highlife' | 'citypop';
export type BassVoice = 'tumbao' | 'slap' | 'walk' | 'octave';
export type HarmonyVoice = 'accordion' | 'clav' | 'guitar' | 'epiano';
export type LeadVoice = 'clarinet' | 'horns' | 'hornThirds' | 'bell';

export interface NoteEvent {
  /** Step in the loop, 0..LOOP_STEPS-1. */
  step: number;
  /** MIDI notes (melodic stems) or Drum ids (perc). A chord or dyad has several. */
  notes: number[];
  /** 0..1. */
  vel: number;
  /** Length in steps (>= 1). */
  len: number;
}

export interface ChordDef {
  /** Loop step where the chord starts. */
  step: number;
  name: string;
  /** Pitch class of the root, 0 = C. */
  root: number;
  /** Pitch classes of the chord tones. */
  tones: number[];
  /** MIDI notes the harmony stem plays for this chord. */
  voicing: number[];
}

export interface TrackDef {
  district: number;
  name: string;
  style: string;
  bpm: number;
  keyName: string;
  /** Pitch class of the tonic. */
  keyRoot: number;
  /** Scale degrees as semitones above the tonic, ascending, 7 notes. */
  scale: number[];
  bars: number;
  stepsPerBar: number;
  chords: ChordDef[];
  voices: { perc: KitVoice; bass: BassVoice; harmony: HarmonyVoice; lead: LeadVoice };
  /** perc, bass, harmony, lead. */
  stems: [NoteEvent[], NoteEvent[], NoteEvent[], NoteEvent[]];
}
