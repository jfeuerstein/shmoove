/**
 * The Web Audio backend: the graph and every voice, synthesised. Nothing is loaded.
 *
 *   stems (5) -> music volume -> duck low-pass -> duck gain -> drop gain -+
 *   voices, hum, grind ------------------------------> effects bus -------+-> master -> limiter -> out
 *
 * Every voice gets a slot from the `VoicePool` (24 at most, the oldest of its kind cut first) and
 * its nodes are made when it plays and dropped when it ends. The hum and the grind hiss are the only
 * nodes that live for the whole visit.
 */
import { BEAT, DRUM_CRASH, DRUM_GHOST, DRUM_HAT, DRUM_KICK, DRUM_OPEN_HAT, DRUM_SNARE, DRUM_TOM_HI, KEY_ROOT, MAX_TONES, STEM_BASS, STEM_COUNT, STEM_DRUMS, STEM_GUITAR, STEM_HORNS, STEM_KEYS, STEP, type NoteBuf } from './music';
import { MAX_VOICES, VoicePool } from './pool';
import type { AudioBackend } from './director';
import * as S from './sfx';

/** Each stem's share of the music bus at full. */
export const STEM_MIX: readonly number[] = [0.85, 0.8, 0.42, 0.3, 0.42];
/** The music's level under an open card offer, and the low-pass it sits behind, Hz. */
const DUCK_GAIN = 0.4;
const DUCK_HZ = 480;
const OPEN_HZ = 18000;
const SFX_LEVEL = 0.75;
const GRIND_LEVEL = 0.22;
/** A cut voice fades this fast, s (time constant), so cutting is never a click. */
const CUT_TAU = 0.008;

function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function ratio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Pool kinds for music voices sit above the effects', drums one per instrument. */
function musicKind(stem: number, drum: number): number {
  return S.SND_COUNT + (stem === STEM_DRUMS ? 8 + drum : stem);
}

export class Synth implements AudioBackend {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly musicVol: GainNode;
  private readonly duckFilter: BiquadFilterNode;
  private readonly duckGain: GainNode;
  private readonly dropGain: GainNode;
  private readonly stems: GainNode[] = [];
  private readonly sfxBus: GainNode;
  private readonly noise: AudioBuffer;
  private readonly pool = new VoicePool(MAX_VOICES);
  private readonly outs: (GainNode | null)[] = [];
  private readonly srcs: AudioScheduledSourceNode[][] = [];
  private cur = 0;
  private readonly humOsc: OscillatorNode;
  private readonly humSub: OscillatorNode;
  private readonly humGain: GainNode;
  private readonly grindGain: GainNode;
  private humShown = -1;
  private humFreqShown = -1;
  private grindShown = false;

  constructor(ctx: AudioContext, musicVolume: number) {
    this.ctx = ctx;
    const t = ctx.currentTime;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-8, t);
    limiter.knee.setValueAtTime(8, t);
    limiter.ratio.setValueAtTime(12, t);
    limiter.attack.setValueAtTime(0.003, t);
    limiter.release.setValueAtTime(0.2, t);
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.9, t);
    this.master.connect(limiter);

    this.dropGain = ctx.createGain();
    this.dropGain.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.dropGain);
    this.duckFilter = ctx.createBiquadFilter();
    this.duckFilter.type = 'lowpass';
    this.duckFilter.frequency.setValueAtTime(OPEN_HZ, t);
    this.duckFilter.Q.setValueAtTime(0.7, t);
    this.duckFilter.connect(this.duckGain);
    this.musicVol = ctx.createGain();
    this.musicVol.gain.setValueAtTime(musicVolume, t);
    this.musicVol.connect(this.duckFilter);
    for (let s = 0; s < STEM_COUNT; s++) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.connect(this.musicVol);
      this.stems.push(g);
    }
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.setValueAtTime(SFX_LEVEL, t);
    this.sfxBus.connect(this.master);

    // One second of white noise, looped from a random place by every noisy voice.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    for (let i = 0; i < MAX_VOICES; i++) {
      this.outs.push(null);
      this.srcs.push([]);
    }

    // The board hum: a low saw and a sine under it, dulled, at no volume until the board rolls.
    this.humGain = ctx.createGain();
    this.humGain.gain.setValueAtTime(0, t);
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.setValueAtTime(260, t);
    humLp.connect(this.humGain);
    this.humGain.connect(this.sfxBus);
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sawtooth';
    this.humOsc.frequency.setValueAtTime(50, t);
    this.humOsc.connect(humLp);
    this.humSub = ctx.createOscillator();
    this.humSub.type = 'sine';
    this.humSub.frequency.setValueAtTime(25, t);
    this.humSub.connect(humLp);
    this.humOsc.start(t);
    this.humSub.start(t);

    // The grind: bright noise and two inharmonic partials, a rail singing under the trucks.
    this.grindGain = ctx.createGain();
    this.grindGain.gain.setValueAtTime(0, t);
    this.grindGain.connect(this.sfxBus);
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, t);
    bp.Q.setValueAtTime(1.4, t);
    hiss.connect(bp);
    bp.connect(this.grindGain);
    const ring = ctx.createGain();
    ring.gain.setValueAtTime(0.06, t);
    ring.connect(this.grindGain);
    for (const f of [2637, 3951]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      o.connect(ring);
      o.start(t);
    }
    hiss.start(t);
  }

  now(): number {
    return this.ctx.currentTime;
  }

  setMusicVolume(v: number): void {
    this.musicVol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // ---- the backend ----------------------------------------------------------------------------

  stem(stem: number, from: number, to: number, at: number, dur: number): void {
    const g = this.stems[stem].gain;
    const mix = STEM_MIX[stem];
    g.cancelScheduledValues(at);
    g.setValueAtTime(from * mix, at);
    if (dur > 0) g.linearRampToValueAtTime(to * mix, at + dur);
    else g.setValueAtTime(to * mix, at);
  }

  duck(on: boolean, at: number): void {
    this.duckFilter.frequency.setTargetAtTime(on ? DUCK_HZ : OPEN_HZ, at, 0.08);
    this.duckGain.gain.setTargetAtTime(on ? DUCK_GAIN : 1, at, 0.08);
  }

  dropout(at: number, dur: number): void {
    const g = this.dropGain.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, 0.01);
    g.setTargetAtTime(1, at + dur, 0.06);
  }

  musicEnd(at: number, fall: boolean): void {
    if (!fall) return;
    // The band falls over: everything slides down behind a closing filter and is gone.
    const g = this.dropGain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(1, at);
    g.linearRampToValueAtTime(0, at + 0.9);
    this.duckFilter.frequency.cancelScheduledValues(at);
    this.duckFilter.frequency.setValueAtTime(OPEN_HZ, at);
    this.duckFilter.frequency.exponentialRampToValueAtTime(160, at + 0.9);
  }

  musicResume(at: number): void {
    const g = this.dropGain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(1, at);
    this.duckFilter.frequency.cancelScheduledValues(at);
    this.duckFilter.frequency.setValueAtTime(OPEN_HZ, at);
    this.duckGain.gain.cancelScheduledValues(at);
    this.duckGain.gain.setValueAtTime(1, at);
  }

  layers(hum: number, humFreq: number, grind: boolean): void {
    const t = this.ctx.currentTime;
    if (Math.abs(hum - this.humShown) > 0.004) {
      this.humShown = hum;
      this.humGain.gain.setTargetAtTime(hum, t, 0.06);
    }
    if (Math.abs(humFreq - this.humFreqShown) > 0.5) {
      this.humFreqShown = humFreq;
      this.humOsc.frequency.setTargetAtTime(humFreq, t, 0.08);
      this.humSub.frequency.setTargetAtTime(humFreq * 0.5, t, 0.08);
    }
    if (grind !== this.grindShown) {
      this.grindShown = grind;
      this.grindGain.gain.setTargetAtTime(grind ? GRIND_LEVEL : 0, t, grind ? 0.02 : 0.06);
    }
  }

  silence(): void {
    this.layers(0, this.humFreqShown, false);
  }

  note(buf: NoteBuf, i: number, when: number): void {
    const stem = buf.stem[i];
    const vel = buf.vel[i];
    const dur = buf.dur[i] * STEP;
    if (stem === STEM_DRUMS) this.drum(buf.pitch[i], vel, when);
    else if (stem === STEM_BASS) this.bass(buf.pitch[i], vel, dur, when);
    else if (stem === STEM_KEYS) this.keys(buf, i, vel, dur, when);
    else if (stem === STEM_GUITAR) this.guitar(buf, i, vel, dur, when);
    else if (stem === STEM_HORNS) this.horns(buf, i, vel, dur, when, this.stems[STEM_HORNS]);
  }

  sfx(kind: number, gain: number, pitch: number, when: number): void {
    const r = ratio(pitch);
    switch (kind) {
      case S.SND_HOP:
        return this.pop(gain, r, when);
      case S.SND_OLLIE:
        this.pop(gain * 0.8, 1.2, when);
        return this.bell(mtof(KEY_ROOT + 36 + pitch), gain * 0.55, 0.22, when, kind);
      case S.SND_LAND:
        return this.land(gain, r, when);
      case S.SND_GRIND_ON:
        return this.clank(gain, when);
      case S.SND_GRIND_OFF:
        return this.hiss(gain, 2600, 0.1, when, kind);
      case S.SND_BOOST:
        return this.whoosh(gain, when);
      case S.SND_HURT:
        return this.hurt(gain, when);
      case S.SND_HIT:
        return this.tick(gain, r, when);
      case S.SND_DIE:
        return this.crunch(gain, r, when);
      case S.SND_PLOW:
        return this.thump(gain, r, when, kind);
      case S.SND_BONK:
        return this.knock(gain, r, when);
      case S.SND_SPARK:
        return this.bell(mtof(KEY_ROOT + 48 + pitch), gain, 0.3, when, kind);
      case S.SND_LEVEL:
        return this.figure(gain, when, kind, [0, 3, 7, 12, 15], 0.065, 48);
      case S.SND_CARD:
        return this.figure(gain, when, kind, [7, 12], 0.07, 48);
      case S.SND_SHOT:
        return this.chirp(gain, 1300 * r, 650 * r, 0.06, when, kind);
      case S.SND_STONE:
        return this.chirp(gain, 700 * r, 1250 * r, 0.05, when, kind);
      case S.SND_ARC:
        return this.zap(gain, when);
      case S.SND_SLAM:
        return this.thump(gain, r, when, kind);
      case S.SND_BLAST:
        return this.blast(gain, when);
      case S.SND_POP:
        return this.bubble(gain, when);
      case S.SND_THING:
        return this.figure(gain, when, kind, [5, 12], 0.05, 48);
      case S.SND_TOKEN:
        return this.coin(gain, when);
      case S.SND_HEAL:
        return this.swell(gain, when);
      case S.SND_BOSS_IN:
        return this.bossIn(gain, when);
      case S.SND_BOSS_DOWN:
        return this.bossDown(gain, when);
      case S.SND_DEAD:
        return this.fall(gain, when);
      case S.SND_WON:
        return this.cadence(gain, when);
      default:
        return;
    }
  }

  // ---- voice plumbing -------------------------------------------------------------------------

  /** A new voice's output, connected to `dest`, with its slot claimed (cutting one if full). */
  private voice(kind: number, when: number, dur: number, dest: AudioNode): GainNode {
    const now = this.ctx.currentTime;
    const slot = this.pool.claim(kind, when, when + dur, now);
    if (this.pool.evicted) this.cut(slot, now);
    const out = this.ctx.createGain();
    out.connect(dest);
    this.outs[slot] = out;
    this.srcs[slot].length = 0;
    this.cur = slot;
    return out;
  }

  private cut(slot: number, now: number): void {
    const out = this.outs[slot];
    if (out) {
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, CUT_TAU);
    }
    for (const s of this.srcs[slot]) {
      try {
        s.stop(now + CUT_TAU * 6);
      } catch (_err) {
        // Already stopped.
      }
    }
    this.srcs[slot].length = 0;
  }

  private track<T extends AudioScheduledSourceNode>(src: T, when: number, end: number): T {
    src.start(when);
    src.stop(end);
    this.srcs[this.cur].push(src);
    return src;
  }

  private osc(type: OscillatorType, freq: number, when: number, end: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.connect(dest);
    return this.track(o, when, end);
  }

  private noiseSrc(when: number, end: number, dest: AudioNode): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.connect(dest);
    n.start(when, Math.random() * 0.9);
    n.stop(end);
    this.srcs[this.cur].push(n);
    return n;
  }

  private filter(type: BiquadFilterType, freq: number, q: number, when: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, when);
    f.Q.setValueAtTime(q, when);
    f.connect(dest);
    return f;
  }

  private gainNode(dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(dest);
    return g;
  }

  /** A percussive envelope: up to `peak` in `attack`, exponentially down to nothing over `decay`. */
  private env(p: AudioParam, when: number, attack: number, peak: number, decay: number): void {
    const v = Math.max(0.0002, peak);
    p.setValueAtTime(0.0001, when);
    p.exponentialRampToValueAtTime(v, when + attack);
    p.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  /** A held envelope: up in `attack`, easing to 70 % by `hold`, released over `release`. */
  private held(p: AudioParam, when: number, attack: number, peak: number, hold: number, release: number): void {
    const v = Math.max(0.0002, peak);
    p.setValueAtTime(0.0001, when);
    p.exponentialRampToValueAtTime(v, when + attack);
    p.exponentialRampToValueAtTime(v * 0.7, when + Math.max(attack + 0.01, hold));
    p.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.01, hold) + release);
  }

  private glide(p: AudioParam, when: number, from: number, to: number, dur: number): void {
    p.setValueAtTime(from, when);
    p.exponentialRampToValueAtTime(to, when + dur);
  }

  // ---- the band -------------------------------------------------------------------------------

  private drum(id: number, vel: number, when: number): void {
    const dest = this.stems[STEM_DRUMS];
    const kind = musicKind(STEM_DRUMS, id);
    if (id === DRUM_KICK) {
      const out = this.voice(kind, when, 0.4, dest);
      const o = this.osc('sine', 150, when, when + 0.4, out);
      this.glide(o.frequency, when, 150, 44, 0.12);
      this.env(out.gain, when, 0.002, vel, 0.34);
      const click = this.gainNode(out);
      this.noiseSrc(when, when + 0.02, this.filter('highpass', 3000, 0.7, when, click));
      this.env(click.gain, when, 0.001, 0.25, 0.012);
    } else if (id === DRUM_SNARE || id === DRUM_GHOST) {
      const out = this.voice(kind, when, 0.22, dest);
      this.env(out.gain, when, 0.001, vel * 0.8, 0.18);
      const body = this.gainNode(out);
      this.osc('triangle', 190, when, when + 0.12, body);
      this.env(body.gain, when, 0.001, 0.6, 0.08);
      const rattle = this.gainNode(out);
      this.noiseSrc(when, when + 0.22, this.filter('highpass', 1400, 0.8, when, rattle));
      this.env(rattle.gain, when, 0.001, 0.7, 0.17);
    } else if (id === DRUM_HAT || id === DRUM_OPEN_HAT) {
      const decay = id === DRUM_HAT ? 0.04 : 0.24;
      const out = this.voice(kind, when, decay + 0.02, dest);
      const bp = this.filter('bandpass', 10000, 0.8, when, out);
      this.noiseSrc(when, when + decay + 0.02, this.filter('highpass', 7000, 0.7, when, bp));
      this.env(out.gain, when, 0.001, vel * 0.5, decay);
    } else if (id === DRUM_CRASH) {
      const out = this.voice(kind, when, 1.5, dest);
      this.noiseSrc(when, when + 1.5, this.filter('highpass', 4500, 0.6, when, out));
      this.env(out.gain, when, 0.002, vel * 0.32, 1.45);
    } else {
      const f = id === DRUM_TOM_HI ? 165 : 110;
      const out = this.voice(kind, when, 0.3, dest);
      const o = this.osc('sine', f, when, when + 0.3, out);
      this.glide(o.frequency, when, f, f * 0.7, 0.22);
      this.env(out.gain, when, 0.002, vel * 0.8, 0.27);
    }
  }

  private bass(midi: number, vel: number, dur: number, when: number): void {
    const end = when + dur + 0.08;
    const out = this.voice(musicKind(STEM_BASS, 0), when, dur + 0.08, this.stems[STEM_BASS]);
    const lp = this.filter('lowpass', 1800, 6, when, out);
    // A pluck: the filter snaps shut after the attack, harder the harder it is played.
    this.glide(lp.frequency, when, 260 + vel * 1700, 220, 0.14);
    const f = mtof(midi);
    this.osc('sawtooth', f, when, end, lp);
    const sub = this.gainNode(out);
    sub.gain.setValueAtTime(0.5, when);
    this.osc('sine', f, when, end, sub);
    this.held(out.gain, when, 0.005, vel * 0.55, dur, 0.06);
  }

  /** The electric piano: two-operator FM per tone, the bark of the attack fading to a pure tone. */
  private keys(buf: NoteBuf, i: number, vel: number, dur: number, when: number): void {
    const n = Math.max(1, buf.toneCount[i]);
    const tail = 0.35;
    const end = when + dur + tail;
    const out = this.voice(musicKind(STEM_KEYS, 0), when, dur + tail, this.stems[STEM_KEYS]);
    for (let k = 0; k < n; k++) {
      const f = mtof(buf.toneCount[i] > 0 ? buf.tones[i * MAX_TONES + k] : buf.pitch[i]);
      const car = this.osc('sine', f, when, end, out);
      const modGain = this.ctx.createGain();
      modGain.connect(car.frequency);
      this.glide(modGain.gain, when, f * 2.2, f * 0.25, 0.4);
      this.osc('sine', f, when, end, modGain);
    }
    this.held(out.gain, when, 0.004, (vel * 0.4) / n, dur, tail);
  }

  /** Funk guitar: chord hits through an auto-wah, and muted scratches between them. */
  private guitar(buf: NoteBuf, i: number, vel: number, dur: number, when: number): void {
    const dest = this.stems[STEM_GUITAR];
    const n = buf.toneCount[i];
    if (n === 0) {
      const out = this.voice(musicKind(STEM_GUITAR, 0), when, 0.05, dest);
      this.noiseSrc(when, when + 0.05, this.filter('bandpass', 2300, 3, when, out));
      this.osc('square', mtof(buf.pitch[i]), when, when + 0.04, out);
      this.env(out.gain, when, 0.001, vel * 0.35, 0.035);
      return;
    }
    const len = Math.max(0.08, dur) + 0.05;
    const out = this.voice(musicKind(STEM_GUITAR, 1), when, len, dest);
    const wah = this.filter('bandpass', 600, 2.5, when, this.filter('highpass', 280, 0.7, when, out));
    this.glide(wah.frequency, when, 600, 2600, 0.07);
    for (let k = 0; k < n; k++) {
      // A strum: each string a few ms after the last.
      const t = when + k * 0.006;
      this.osc('sawtooth', mtof(buf.tones[i * MAX_TONES + k]), t, when + len, wah);
    }
    this.env(out.gain, when, 0.002, (vel * 0.5) / Math.sqrt(n), len - 0.01);
  }

  /** Brass: two detuned saws per tone, scooping up into the note, the filter opening on the attack. */
  private horns(buf: NoteBuf, i: number, vel: number, dur: number, when: number, dest: AudioNode, kind = musicKind(STEM_HORNS, 0)): void {
    const n = Math.max(1, buf.toneCount[i]);
    const len = Math.max(0.1, dur);
    const release = 0.09;
    const end = when + len + release;
    const out = this.voice(kind, when, len + release, dest);
    const lp = this.filter('lowpass', 500, 1.2, when, out);
    lp.frequency.setValueAtTime(500, when);
    lp.frequency.exponentialRampToValueAtTime(2800, when + 0.04);
    lp.frequency.exponentialRampToValueAtTime(1500, when + 0.04 + len);
    for (let k = 0; k < n; k++) {
      const f = mtof(buf.toneCount[i] > 0 ? buf.tones[i * MAX_TONES + k] : buf.pitch[i]);
      for (const detune of [-7, 7]) {
        const o = this.osc('sawtooth', f, when, end, lp);
        o.detune.setValueAtTime(detune - 100, when);
        o.detune.linearRampToValueAtTime(detune, when + 0.045);
      }
    }
    this.held(out.gain, when, 0.02, (vel * 0.3) / n, len, release);
  }

  /** Horn tones given as semitones above E1, for the stingers and the cadence. */
  private brass(tones: readonly number[], vel: number, dur: number, when: number, kind: number): void {
    const n = Math.min(MAX_TONES, tones.length);
    const one = this.stingBuf;
    one.toneCount[0] = n;
    one.pitch[0] = KEY_ROOT + tones[0];
    for (let k = 0; k < n; k++) one.tones[k] = KEY_ROOT + tones[k];
    this.horns(one, 0, vel, dur, when, this.sfxBus, kind);
  }

  private readonly stingBuf: NoteBuf = {
    count: 1,
    bar: 0,
    stem: new Uint8Array(1),
    step: new Uint8Array(1),
    dur: new Float32Array(1),
    vel: new Float32Array(1),
    pitch: new Float32Array(1),
    toneCount: new Uint8Array(1),
    tones: new Float32Array(MAX_TONES),
  };

  // ---- the effects ----------------------------------------------------------------------------

  private pop(gain: number, r: number, when: number): void {
    const out = this.voice(S.SND_HOP, when, 0.1, this.sfxBus);
    const o = this.osc('sine', 380 * r, when, when + 0.1, out);
    this.glide(o.frequency, when, 380 * r, 860 * r, 0.06);
    this.env(out.gain, when, 0.002, gain, 0.08);
    const click = this.gainNode(out);
    this.noiseSrc(when, when + 0.02, this.filter('highpass', 3000, 0.7, when, click));
    this.env(click.gain, when, 0.001, 0.5, 0.015);
  }

  private bell(freq: number, gain: number, decay: number, when: number, kind: number): void {
    const out = this.voice(kind, when, decay + 0.02, this.sfxBus);
    this.osc('sine', freq, when, when + decay + 0.02, out);
    const part = this.gainNode(out);
    part.gain.setValueAtTime(0.25, when);
    this.osc('sine', freq * 2.76, when, when + decay * 0.5, part);
    this.env(out.gain, when, 0.003, gain, decay);
  }

  private land(gain: number, r: number, when: number): void {
    const out = this.voice(S.SND_LAND, when, 0.25, this.sfxBus);
    this.noiseSrc(when, when + 0.22, this.filter('lowpass', 420, 0.8, when, out));
    const body = this.gainNode(out);
    body.gain.setValueAtTime(1.2, when);
    const o = this.osc('sine', 95 * r, when, when + 0.25, body);
    this.glide(o.frequency, when, 95 * r, 40, 0.16);
    this.env(out.gain, when, 0.002, gain, 0.2);
  }

  private clank(gain: number, when: number): void {
    const out = this.voice(S.SND_GRIND_ON, when, 0.3, this.sfxBus);
    const bp = this.filter('bandpass', 2100, 1.5, when, out);
    for (const f of [523, 1243, 1987]) this.osc('square', f, when, when + 0.3, bp);
    this.env(out.gain, when, 0.001, gain * 0.6, 0.26);
  }

  private hiss(gain: number, freq: number, decay: number, when: number, kind: number): void {
    const out = this.voice(kind, when, decay + 0.02, this.sfxBus);
    this.noiseSrc(when, when + decay + 0.02, this.filter('highpass', freq, 0.7, when, out));
    this.env(out.gain, when, 0.002, gain, decay);
  }

  private whoosh(gain: number, when: number): void {
    const out = this.voice(S.SND_BOOST, when, 0.55, this.sfxBus);
    const bp = this.filter('bandpass', 300, 4, when, out);
    this.glide(bp.frequency, when, 300, 3600, 0.45);
    this.noiseSrc(when, when + 0.55, bp);
    const tone = this.gainNode(out);
    tone.gain.setValueAtTime(0.25, when);
    const o = this.osc('sawtooth', 110, when, when + 0.55, this.filter('lowpass', 1200, 1, when, tone));
    this.glide(o.frequency, when, 110, 440, 0.45);
    this.held(out.gain, when, 0.12, gain, 0.3, 0.2);
  }

  private hurt(gain: number, when: number): void {
    const out = this.voice(S.SND_HURT, when, 0.38, this.sfxBus);
    const o = this.osc('square', 150, when, when + 0.38, this.filter('lowpass', 900, 1, when, out));
    this.glide(o.frequency, when, 150, 48, 0.28);
    const grit = this.gainNode(out);
    grit.gain.setValueAtTime(0.8, when);
    this.noiseSrc(when, when + 0.25, this.filter('lowpass', 1100, 0.7, when, grit));
    this.env(out.gain, when, 0.002, gain, 0.34);
  }

  private tick(gain: number, r: number, when: number): void {
    const out = this.voice(S.SND_HIT, when, 0.05, this.sfxBus);
    this.osc('sine', 1900 * r, when, when + 0.05, out);
    const click = this.gainNode(out);
    click.gain.setValueAtTime(0.6, when);
    this.noiseSrc(when, when + 0.02, this.filter('highpass', 4200, 0.7, when, click));
    this.env(out.gain, when, 0.001, gain, 0.035);
  }

  private crunch(gain: number, r: number, when: number): void {
    const out = this.voice(S.SND_DIE, when, 0.14, this.sfxBus);
    this.noiseSrc(when, when + 0.12, this.filter('bandpass', 900 * r, 1.5, when, out));
    const body = this.gainNode(out);
    body.gain.setValueAtTime(0.6, when);
    const o = this.osc('square', 190 * r, when, when + 0.12, this.filter('lowpass', 1400, 1, when, body));
    this.glide(o.frequency, when, 190 * r, 60, 0.09);
    this.env(out.gain, when, 0.001, gain, 0.11);
  }

  private thump(gain: number, r: number, when: number, kind: number): void {
    const out = this.voice(kind, when, 0.28, this.sfxBus);
    const o = this.osc('sine', 78 * r, when, when + 0.28, out);
    this.glide(o.frequency, when, 78 * r, 34, 0.2);
    const dirt = this.gainNode(out);
    dirt.gain.setValueAtTime(0.7, when);
    this.noiseSrc(when, when + 0.18, this.filter('lowpass', 320, 0.7, when, dirt));
    this.env(out.gain, when, 0.002, gain, 0.25);
  }

  private knock(gain: number, r: number, when: number): void {
    const out = this.voice(S.SND_BONK, when, 0.12, this.sfxBus);
    const o = this.osc('triangle', 240 * r, when, when + 0.12, out);
    this.glide(o.frequency, when, 240 * r, 120 * r, 0.08);
    this.env(out.gain, when, 0.001, gain, 0.1);
  }

  /** Notes `steps` (semitones above E at octave `octave` semitones up) one after another. */
  private figure(gain: number, when: number, kind: number, steps: readonly number[], gap: number, octave: number): void {
    const len = gap * steps.length + 0.3;
    const out = this.voice(kind, when, len, this.sfxBus);
    out.gain.setValueAtTime(gain, when);
    for (let k = 0; k < steps.length; k++) {
      const t = when + k * gap;
      const f = mtof(KEY_ROOT + octave + steps[k]);
      const g = this.gainNode(out);
      this.osc('triangle', f, t, t + 0.3, g);
      const shine = this.gainNode(g);
      shine.gain.setValueAtTime(0.3, t);
      this.osc('sine', f * 2, t, t + 0.2, shine);
      this.env(g.gain, t, 0.003, 0.5, k === steps.length - 1 ? 0.28 : 0.14);
    }
  }

  private chirp(gain: number, from: number, to: number, dur: number, when: number, kind: number): void {
    const out = this.voice(kind, when, dur + 0.02, this.sfxBus);
    const o = this.osc('sine', from, when, when + dur + 0.02, out);
    this.glide(o.frequency, when, from, to, dur);
    this.env(out.gain, when, 0.002, gain, dur);
  }

  private zap(gain: number, when: number): void {
    const out = this.voice(S.SND_ARC, when, 0.1, this.sfxBus);
    const o = this.osc('sawtooth', 900, when, when + 0.1, this.filter('highpass', 1500, 0.8, when, out));
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(420, when);
    lfoGain.connect(o.frequency);
    this.osc('square', 63, when, when + 0.1, lfoGain);
    this.env(out.gain, when, 0.002, gain, 0.08);
  }

  private blast(gain: number, when: number): void {
    const out = this.voice(S.SND_BLAST, when, 0.5, this.sfxBus);
    const lp = this.filter('lowpass', 1300, 0.8, when, out);
    this.glide(lp.frequency, when, 1300, 120, 0.4);
    this.noiseSrc(when, when + 0.5, lp);
    const boom = this.gainNode(out);
    boom.gain.setValueAtTime(1, when);
    this.osc('sine', 55, when, when + 0.35, boom);
    this.env(out.gain, when, 0.003, gain, 0.45);
  }

  private bubble(gain: number, when: number): void {
    const out = this.voice(S.SND_POP, when, 0.12, this.sfxBus);
    const o = this.osc('sine', 300, when, when + 0.12, out);
    this.glide(o.frequency, when, 300, 1500, 0.07);
    const fizz = this.gainNode(out);
    fizz.gain.setValueAtTime(0.4, when);
    this.noiseSrc(when, when + 0.06, this.filter('bandpass', 2000, 2, when, fizz));
    this.env(out.gain, when, 0.002, gain, 0.1);
  }

  private coin(gain: number, when: number): void {
    const out = this.voice(S.SND_TOKEN, when, 0.36, this.sfxBus);
    const lp = this.filter('lowpass', 4000, 0.7, when, out);
    const o = this.osc('square', mtof(83), when, when + 0.36, lp);
    o.frequency.setValueAtTime(mtof(88), when + 0.06);
    out.gain.setValueAtTime(gain * 0.5, when);
    out.gain.setValueAtTime(gain * 0.5, when + 0.06);
    out.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
  }

  private swell(gain: number, when: number): void {
    const out = this.voice(S.SND_HEAL, when, 0.95, this.sfxBus);
    for (const m of [KEY_ROOT + 48, KEY_ROOT + 55, KEY_ROOT + 62]) this.osc('sine', mtof(m), when, when + 0.95, out);
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(gain * 0.4, when + 0.28);
    out.gain.exponentialRampToValueAtTime(0.0001, when + 0.92);
  }

  /** A boss: a low tritone in the brass over a boom, darkening. */
  private bossIn(gain: number, when: number): void {
    const out = this.voice(S.SND_BOSS_IN, when, 1.6, this.sfxBus);
    const o = this.osc('sine', 62, when, when + 1.2, out);
    this.glide(o.frequency, when, 62, 30, 1.0);
    this.env(out.gain, when, 0.004, gain, 1.1);
    this.brass([12, 18, 24], gain, 1.2, when + 0.05, S.SND_BOSS_IN);
  }

  /** A boss falls: a bright major stab, up an octave, with a crash. */
  private bossDown(gain: number, when: number): void {
    this.brass([24, 28, 31, 36], gain, 0.18, when, S.SND_BOSS_DOWN);
    this.brass([36, 40, 43, 48], gain, 0.9, when + 0.2, S.SND_BOSS_DOWN);
    const out = this.voice(S.SND_BOSS_DOWN, when + 0.2, 1.4, this.sfxBus);
    this.noiseSrc(when + 0.2, when + 1.6, this.filter('highpass', 4500, 0.6, when, out));
    this.env(out.gain, when + 0.2, 0.002, gain * 0.3, 1.3);
  }

  /** Dead: a tape-stop slide down through a closing filter. */
  private fall(gain: number, when: number): void {
    const out = this.voice(S.SND_DEAD, when, 1.5, this.sfxBus);
    const lp = this.filter('lowpass', 2200, 2, when, out);
    this.glide(lp.frequency, when, 2200, 160, 1.3);
    const o = this.osc('sawtooth', 220, when, when + 1.5, lp);
    this.glide(o.frequency, when, 220, 28, 1.4);
    const o2 = this.osc('square', 164.8, when, when + 1.5, lp);
    this.glide(o2.frequency, when, 164.8, 21, 1.4);
    this.held(out.gain, when, 0.01, gain * 0.6, 0.9, 0.5);
  }

  /** Cleared: the band resolves, B7 to Em9, held. */
  private cadence(gain: number, when: number): void {
    this.brass([35, 38, 41, 43], gain, BEAT * 1.5, when, S.SND_WON);
    this.brass([24, 31, 36, 39], gain, BEAT * 5, when + BEAT * 2, S.SND_WON);
    const out = this.voice(S.SND_WON, when + BEAT * 2, 2.2, this.sfxBus);
    const o = this.osc('sine', mtof(KEY_ROOT), when + BEAT * 2, when + BEAT * 2 + 2.2, out);
    o.frequency.setValueAtTime(mtof(KEY_ROOT + 12), when + BEAT * 2);
    this.env(out.gain, when + BEAT * 2, 0.01, gain * 0.7, 2.1);
  }
}
