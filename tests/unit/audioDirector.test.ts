import { describe, expect, it } from 'vitest';
import { AudioDirector, type AudioBackend } from '../../src/audio/director';
import { BEAT, BOSS_TRANSPOSE, STEM_BASS, STEM_DRUMS, STEM_KEYS, type NoteBuf } from '../../src/audio/music';
import { MAX_VOICES, VoicePool } from '../../src/audio/pool';
import { SND_DEAD, SND_HIT, SND_HOP, SND_WON, type MoverSound } from '../../src/audio/sfx';
import { EV_HOP } from '../../src/sim/types';
import { FX_BOSS_DOWN, FX_BOSS_IN, FX_ENEMY_HIT, FX_PLAYER_HIT, PHASE_CHOOSE, PHASE_DEAD, PHASE_PLAY, PHASE_WON, type Fx } from '../../src/sim/world';

class FakeBackend implements AudioBackend {
  t = 0;
  sfxs: { kind: number; when: number }[] = [];
  notes: { stem: number; pitch: number; bar: number; when: number }[] = [];
  stems: { stem: number; from: number; to: number; at: number; dur: number }[] = [];
  ducks: boolean[] = [];
  drops: { at: number; dur: number }[] = [];
  ends: { at: number; fall: boolean }[] = [];
  resumes = 0;
  silences = 0;
  hum = 0;
  grind = false;
  now(): number {
    return this.t;
  }
  sfx(kind: number, _gain: number, _pitch: number, when: number): void {
    this.sfxs.push({ kind, when });
  }
  note(buf: NoteBuf, i: number, when: number): void {
    this.notes.push({ stem: buf.stem[i], pitch: buf.pitch[i], bar: buf.bar, when });
  }
  stem(stem: number, from: number, to: number, at: number, dur: number): void {
    this.stems.push({ stem, from, to, at, dur });
  }
  duck(on: boolean): void {
    this.ducks.push(on);
  }
  dropout(at: number, dur: number): void {
    this.drops.push({ at, dur });
  }
  layers(hum: number, _f: number, grind: boolean): void {
    this.hum = hum;
    this.grind = grind;
  }
  musicEnd(at: number, fall: boolean): void {
    this.ends.push({ at, fall });
  }
  musicResume(): void {
    this.resumes++;
  }
  silence(): void {
    this.silences++;
  }
}

function makeFx(...list: [number, number][]): Fx {
  const f: Fx = { count: 0, type: new Uint8Array(16), x: new Float32Array(16), y: new Float32Array(16), z: new Float32Array(16), a: new Float32Array(16) };
  for (const [type, a] of list) {
    f.type[f.count] = type;
    f.a[f.count] = a;
    f.count++;
  }
  return f;
}

const NONE = makeFx();
const MOVER: MoverSound = { speed: 12, grounded: true, rail: -1, chain: 0, impact: 0 };

/** Run `seconds` of game: a tick every 1/60 s and a pump every 25 ms. */
function play(d: AudioDirector, b: FakeBackend, seconds: number, gear: number, phase = PHASE_PLAY, fx: Fx = NONE): void {
  const end = b.t + seconds;
  let nextPump = b.t;
  while (b.t < end) {
    d.tick(fx, 0, MOVER, gear, phase);
    while (nextPump <= b.t) {
      d.pump();
      nextPump += 0.025;
    }
    b.t += 1 / 60;
  }
}

describe('the audio director', () => {
  it('schedules nothing before the first touch gives it a backend', () => {
    const d = new AudioDirector(1, false);
    d.tick(makeFx([FX_ENEMY_HIT, 3]), EV_HOP, MOVER, 3, PHASE_PLAY);
    d.pump();
    expect(d.notes + d.effects).toBe(0);
  });

  it('plays effects and the loop once attached, with the stems the gear asks for', () => {
    const d = new AudioDirector(1, false);
    const b = new FakeBackend();
    d.attach(b);
    d.tick(NONE, EV_HOP, MOVER, 1, PHASE_PLAY);
    expect(b.sfxs.map((s) => s.kind)).toEqual([SND_HOP]);
    expect(d.byKind[SND_HOP]).toBe(1);
    play(d, b, 4, 1);
    expect(b.notes.length).toBeGreaterThan(0);
    expect(new Set(b.notes.map((n) => n.stem))).toEqual(new Set([STEM_DRUMS]));
    expect(b.hum).toBeGreaterThan(0);
    // Up to gear 3: bass and keys fade in over half a bar and start playing.
    const before = b.notes.length;
    play(d, b, 4, 3);
    const later = b.notes.slice(before);
    expect(later.some((n) => n.stem === STEM_BASS)).toBe(true);
    expect(later.some((n) => n.stem === STEM_KEYS)).toBe(true);
    const fadeIn = b.stems.find((s) => s.stem === STEM_KEYS && s.to === 1);
    expect(fadeIn && fadeIn.dur).toBeGreaterThan(0.5);
    expect(d.notes).toBe(b.notes.length);
  });

  it('muted, schedules nothing at all; unmuted, starts again', () => {
    const d = new AudioDirector(1, true);
    const b = new FakeBackend();
    d.attach(b);
    play(d, b, 3, 5, PHASE_PLAY, makeFx([FX_ENEMY_HIT, 3], [FX_PLAYER_HIT, 10]));
    d.tick(NONE, EV_HOP, MOVER, 5, PHASE_PLAY);
    expect(b.notes.length + b.sfxs.length + b.drops.length).toBe(0);
    expect(d.notes + d.effects).toBe(0);
    d.setMuted(false);
    play(d, b, 1, 5);
    expect(b.notes.length).toBeGreaterThan(0);
    d.setMuted(true);
    expect(b.silences).toBe(1);
    const n = b.notes.length;
    const e = b.sfxs.length;
    play(d, b, 2, 5, PHASE_PLAY, makeFx([FX_ENEMY_HIT, 3]));
    expect(b.notes.length).toBe(n);
    expect(b.sfxs.length).toBe(e);
  });

  it('a hit drops the music out for a beat; a card offer ducks it until taken', () => {
    const d = new AudioDirector(1, false);
    const b = new FakeBackend();
    d.attach(b);
    play(d, b, 0.5, 2);
    d.tick(makeFx([FX_PLAYER_HIT, 10]), 0, MOVER, 2, PHASE_PLAY);
    expect(b.drops).toEqual([{ at: b.t, dur: BEAT }]);
    const ducksBefore = b.ducks.length;
    play(d, b, 0.5, 2, PHASE_CHOOSE);
    play(d, b, 0.5, 2, PHASE_PLAY);
    expect(b.ducks.slice(ducksBefore)).toEqual([true, false]);
  });

  it('a boss drops the key a fourth from the next bar until it falls', () => {
    const d = new AudioDirector(1, false);
    const b = new FakeBackend();
    d.attach(b);
    play(d, b, 2, 2);
    d.tick(makeFx([FX_BOSS_IN, 7]), 0, MOVER, 2, PHASE_PLAY);
    expect(d.scheduler.transpose).toBe(BOSS_TRANSPOSE);
    play(d, b, 6, 2);
    d.tick(makeFx([FX_BOSS_DOWN, 7]), 0, MOVER, 2, PHASE_PLAY);
    expect(d.scheduler.transpose).toBe(0);
  });

  it('dead: the music stops on a fall; cleared: it plays out the bar and resolves on the cadence', () => {
    const d = new AudioDirector(1, false);
    const b = new FakeBackend();
    d.attach(b);
    play(d, b, 1, 4);
    d.tick(NONE, 0, MOVER, 4, PHASE_DEAD);
    expect(b.ends).toEqual([{ at: b.t, fall: true }]);
    expect(b.sfxs.map((s) => s.kind)).toContain(SND_DEAD);
    const n = b.notes.length;
    play(d, b, 3, 4, PHASE_DEAD);
    expect(b.notes.length).toBe(n);
    expect(d.scheduler.isRunning).toBe(false);

    // Again: the loop starts over.
    d.tick(NONE, 0, MOVER, 4, PHASE_PLAY);
    play(d, b, 1, 4);
    expect(b.notes.length).toBeGreaterThan(n);
    const barEnd = d.scheduler.currentBarStart + 60 / 104 * 4;
    d.tick(NONE, 0, MOVER, 4, PHASE_WON);
    const won = b.sfxs.find((s) => s.kind === SND_WON);
    expect(won).toBeDefined();
    expect(won && won.when).toBeCloseTo(barEnd, 6);
    expect(b.ends[b.ends.length - 1]).toEqual({ at: barEnd, fall: false });
    play(d, b, 4, 4, PHASE_WON);
    for (const note of b.notes) expect(note.when).toBeLessThan(barEnd + 1e-9);
  });

  it('counts the enemy-hit texture as scheduled effects', () => {
    const d = new AudioDirector(1, false);
    const b = new FakeBackend();
    d.attach(b);
    play(d, b, 1, 1, PHASE_PLAY, makeFx([FX_ENEMY_HIT, 3]));
    expect(d.byKind[SND_HIT]).toBeGreaterThan(5);
    expect(d.byKind[SND_HIT]).toBeLessThan(30);
  });
});

describe('the voice cap', () => {
  it('holds 24 voices and cuts the oldest of the same kind first', () => {
    const pool = new VoicePool();
    expect(pool.size).toBe(MAX_VOICES);
    expect(MAX_VOICES).toBe(24);
    // 24 long voices: 12 of kind 1, 12 of kind 2, started in turn.
    for (let i = 0; i < 24; i++) {
      pool.claim(1 + (i & 1), i, 100, i);
      expect(pool.evicted).toBe(false);
    }
    expect(pool.busy(24)).toBe(24);
    // A 25th of kind 2 cuts the oldest kind-2 voice (started at 1), not the oldest of all (0).
    const slot = pool.claim(2, 30, 100, 30);
    expect(pool.evicted).toBe(true);
    expect(pool.start[slot]).toBe(30);
    expect(Array.from(pool.start).includes(1)).toBe(false);
    expect(Array.from(pool.start).includes(0)).toBe(true);
    // A kind nobody is playing cuts the oldest of all.
    pool.claim(9, 31, 100, 31);
    expect(pool.evicted).toBe(true);
    expect(Array.from(pool.start).includes(0)).toBe(false);
    expect(pool.busy(31)).toBe(24);
  });

  it('reuses a slot once its voice has ended, without cutting anything', () => {
    const pool = new VoicePool();
    for (let i = 0; i < 24; i++) pool.claim(1, 0, 1 + i, 0);
    pool.claim(1, 1.5, 3, 1.5);
    expect(pool.evicted).toBe(false);
    expect(pool.busy(1.5)).toBe(24);
  });
});
