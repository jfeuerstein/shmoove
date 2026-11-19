/**
 * The audio's logic, between the game and whatever makes the sound. Once a tick it turns the sim's
 * effects into sounds (through `SfxMapper`) and keeps the music in step with the run: stems by
 * gear, ducked under a card offer, a beat of silence on a hit, the key down a fourth while a boss is
 * up, a fall or a cadence at the end. A timer pumps the scheduler between ticks.
 *
 * It holds no Web Audio itself: the backend does. Before the first touch there is no backend, and
 * nothing is scheduled; muted, nothing is scheduled either. Tests drive it with a fake backend.
 */
import { BEAT, BOSS_TRANSPOSE, makeGroove, STEM_COUNT, type NoteBuf } from './music';
import { StemMixer } from './mix';
import { MusicScheduler, type NoteSink } from './scheduler';
import { END_CADENCE, END_FALL, makeSfxFrame, SND_COUNT, SND_WON, SfxMapper, type MoverSound } from './sfx';
import { PHASE_DEAD, PHASE_PLAY, PHASE_WON, type Fx } from '../sim/world';

/** What makes the sound. Times are on the backend's own clock, s. */
export interface AudioBackend {
  now(): number;
  sfx(kind: number, gain: number, pitch: number, when: number): void;
  note(buf: NoteBuf, i: number, when: number): void;
  /** Ramp stem `stem` linearly from level `from` to `to` over `dur` from `at`. */
  stem(stem: number, from: number, to: number, at: number, dur: number): void;
  duck(on: boolean, at: number): void;
  /** Silence the music from `at` for `dur`, then bring it back. */
  dropout(at: number, dur: number): void;
  /** The continuous layers: hum loudness and pitch, grind on or off. */
  layers(hum: number, humFreq: number, grind: boolean): void;
  /** The music ends at `at`: with a fall (true) or by just ending (a cadence plays over it). */
  musicEnd(at: number, fall: boolean): void;
  /** The music bus back to full, for a new start at `at`. */
  musicResume(at: number): void;
  /** Everything continuous to silence (muted). */
  silence(): void;
}

export class AudioDirector implements NoteSink {
  /** Notes and effects actually handed to a backend, for the test hook. */
  notes = 0;
  effects = 0;
  readonly byKind = new Uint32Array(SND_COUNT);
  readonly mapper = new SfxMapper();
  readonly frame = makeSfxFrame();
  readonly scheduler: MusicScheduler;
  readonly mixer = new StemMixer();
  private backend: AudioBackend | null = null;
  private mutedNow: boolean;
  private gear = 1;
  private phase = PHASE_PLAY;
  private ducked = false;

  constructor(seed: number, muted: boolean) {
    this.scheduler = new MusicScheduler(makeGroove(seed));
    this.mutedNow = muted;
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  get attached(): boolean {
    return this.backend !== null;
  }

  /** The backend exists now (the first touch made it). */
  attach(backend: AudioBackend): void {
    this.backend = backend;
    this.startMusic();
  }

  setMuted(on: boolean): void {
    if (on === this.mutedNow) return;
    this.mutedNow = on;
    if (on) {
      this.scheduler.stop();
      this.ducked = false;
      this.backend?.silence();
    } else this.startMusic();
  }

  /** A new run: the effects forget the last one and the loop starts again. */
  restart(): void {
    this.mapper.reset();
    this.phase = PHASE_PLAY;
    this.startMusic();
  }

  /** One sim tick. */
  tick(fx: Fx, events: number, mover: MoverSound, gear: number, phase: number): void {
    const f = this.frame;
    this.mapper.map(fx, events, mover, phase, f);
    this.gear = gear;
    this.phase = phase;
    if (f.restart) this.startMusic();
    const b = this.backend;
    if (b === null || this.mutedNow) return;
    const now = b.now();

    this.scheduler.transpose = f.boss ? BOSS_TRANSPOSE : 0;
    let cadenceAt = now;
    if (f.end === END_FALL) {
      this.scheduler.stop();
      b.musicEnd(now, true);
    } else if (f.end === END_CADENCE) {
      cadenceAt = this.scheduler.isRunning ? this.scheduler.stopAtBarEnd() : now;
      b.musicEnd(cadenceAt, false);
    }
    for (let i = 0; i < f.count; i++) {
      const kind = f.kind[i];
      b.sfx(kind, f.gain[i], f.pitch[i], kind === SND_WON ? cadenceAt : now);
      this.effects++;
      this.byKind[kind]++;
    }
    b.layers(f.hum, f.humFreq, f.grind);
    if (f.duck !== this.ducked) {
      this.ducked = f.duck;
      b.duck(f.duck, now);
    }
    if (f.dropout) b.dropout(now, BEAT);
  }

  /** Queue the music due soon. Called by a timer, often. */
  pump(): void {
    const b = this.backend;
    if (b === null || this.mutedNow || !this.scheduler.isRunning) return;
    const now = b.now();
    const changed = this.mixer.setGear(this.gear, now);
    if (changed !== 0) {
      for (let s = 0; s < STEM_COUNT; s++) {
        if ((changed & (1 << s)) !== 0) b.stem(s, this.mixer.from[s], this.mixer.to[s], now, this.mixer.fade);
      }
    }
    this.scheduler.pump(now, this);
  }

  /** The scheduler's sink: a note goes out only on a stem that can be heard. */
  note(buf: NoteBuf, i: number, when: number): void {
    const b = this.backend;
    if (b === null || !this.mixer.audible(buf.stem[i], when)) return;
    b.note(buf, i, when);
    this.notes++;
  }

  private startMusic(): void {
    const b = this.backend;
    if (b === null || this.mutedNow || this.phase === PHASE_DEAD || this.phase === PHASE_WON) return;
    const now = b.now();
    // Every stem comes in from silence over half a bar.
    this.mixer.reset();
    for (let s = 0; s < STEM_COUNT; s++) b.stem(s, 0, 0, now, 0);
    this.ducked = false;
    b.duck(false, now);
    b.musicResume(now);
    this.scheduler.start(now);
  }
}
