/**
 * Web Audio voices: drums, basses, harmony and lead instruments, sound effects and UI blips.
 * Every voice is a handful of nodes with a scheduled envelope that stops itself. One noise buffer
 * is shared by every noise source. A voice budget caps live oscillator/buffer sources: a voice
 * that would exceed it is simply not started.
 */
import { Drum, type BassVoice, type HarmonyVoice, type KitVoice, type LeadVoice } from './tracks/types';

/** Most oscillator + buffer source nodes alive at once (persistent ones included). */
export const MAX_VOICES = 24;

export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Small deterministic hash noise so scatter patterns don't depend on Math.random. */
function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function makeCurve(n: number, f: (u: number) => number): Float32Array<ArrayBuffer> {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) c[i] = f(i / (n - 1));
  return c;
}

export class Synth {
  readonly ctx: BaseAudioContext;
  readonly noise: AudioBuffer;
  /** Live source nodes, and the most seen at once. */
  live = 0;
  peak = 0;
  dropped = 0;

  private readonly pulse: PeriodicWave;
  private readonly vibrato: Float32Array<ArrayBuffer>;
  private readonly scrapeShort: Float32Array<ArrayBuffer>;
  private readonly scrapeLong: Float32Array<ArrayBuffer>;
  private readonly clapCurve: Float32Array<ArrayBuffer>;
  private readonly boingCurve: Float32Array<ArrayBuffer>;
  private readonly scatterCurve: Float32Array<ArrayBuffer>;
  private readonly buzzCurve: Float32Array<ArrayBuffer>;
  private noiseSeq = 0;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 0x2545f491;
    for (let i = 0; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    // 25% pulse for the clav.
    const N = 24;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let k = 1; k < N; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    this.pulse = ctx.createPeriodicWave(re, im);

    this.vibrato = makeCurve(64, (u) => 14 * Math.sin(u * Math.PI * 2 * 8) * Math.min(1, u * 3));
    // Guacharaca: a run of ridges, sharp attack each, getting quieter.
    this.scrapeShort = makeCurve(48, (u) => (1 - ((u * 4) % 1)) * (1 - 0.5 * u) * (u < 0.98 ? 1 : 0));
    this.scrapeLong = makeCurve(128, (u) => (0.35 + 0.65 * (1 - ((u * 11) % 1))) * (1 - 0.6 * u) * (u < 0.98 ? 1 : 0));
    this.clapCurve = makeCurve(96, (u) => {
      const t = u * 0.16;
      if (t < 0.03) return 1 - ((t / 0.01) % 1);
      return Math.exp(-(t - 0.03) / 0.03);
    });
    this.boingCurve = makeCurve(96, (u) => {
      const t = u * 0.45;
      return 170 + 120 * Math.exp(-t / 0.16) * Math.sin(2 * Math.PI * 9 * t) + 60 * Math.exp(-t / 0.1);
    });
    this.scatterCurve = makeCurve(256, (u) => {
      const i = Math.floor(u * 22);
      const local = (u * 22) % 1;
      return hash01(i) > 0.45 ? (1 - local) * (1 - u) * (0.5 + 0.5 * hash01(i + 9)) : 0;
    });
    this.buzzCurve = makeCurve(64, (u) => (u < 0.36 || (u > 0.56 && u < 0.94) ? 1 : 0));
  }

  // ---- plumbing ----

  /** Room for n more sources? Counts drops for diagnostics. */
  private room(n: number): boolean {
    if (this.live + n <= MAX_VOICES) return true;
    this.dropped++;
    return false;
  }

  /** Start a one-shot source and stop it at `end`; `tail` is disconnected when it ends. */
  private run(src: AudioScheduledSourceNode, t: number, end: number, tail: AudioNode): void {
    this.live++;
    if (this.live > this.peak) this.peak = this.live;
    src.onended = () => {
      this.live--;
      tail.disconnect();
    };
    src.start(t);
    src.stop(end);
  }

  /** Register a source that runs until disposal. */
  hold(src: AudioScheduledSourceNode, t: number): void {
    this.live++;
    if (this.live > this.peak) this.peak = this.live;
    src.start(t);
  }

  private osc(type: OscillatorType, freq: number, t: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** A noise source reading the shared buffer from a different offset each time. */
  noiseSource(): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    this.noiseSeq++;
    n.loopStart = 0;
    n.loopEnd = this.noise.duration;
    return n;
  }

  private startNoise(src: AudioBufferSourceNode, t: number, end: number, tail: AudioNode): void {
    this.live++;
    if (this.live > this.peak) this.peak = this.live;
    src.onended = () => {
      this.live--;
      tail.disconnect();
    };
    src.start(t, hash01(this.noiseSeq) * (this.noise.duration - 0.6));
    src.stop(end);
  }

  /** Attack to `peak` then exponential-ish decay with time constant `tc`. */
  private ad(p: AudioParam, t: number, attack: number, peak: number, tc: number): void {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.setTargetAtTime(0, t + attack, tc);
  }

  /** Attack, hold at sustain until `off`, release with time constant `rel`. */
  private asr(p: AudioParam, t: number, attack: number, peak: number, sustain: number, dtc: number, off: number, rel: number): void {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.setTargetAtTime(sustain, t + attack, dtc);
    p.setTargetAtTime(0, Math.max(off, t + attack), rel);
  }

  // ---- drums ----

  drum(kitv: KitVoice, id: number, t: number, vel: number, dest: AudioNode): void {
    switch (id) {
      case Drum.KICK:
        return this.kick(kitv, t, vel, dest);
      case Drum.SNARE:
        return this.snare(kitv, t, vel, dest);
      case Drum.HAT:
        return this.noiseHit(t, vel * 0.32, dest, 'highpass', 7800, 0.7, 0.012, 0.08);
      case Drum.OHAT:
        return this.noiseHit(t, vel * 0.3, dest, 'highpass', 7200, 0.7, 0.09, 0.4);
      case Drum.SHAKER:
        return this.noiseHit(t, vel * 0.3, dest, 'bandpass', 6000, 1.4, 0.022, 0.12, 0.012);
      case Drum.SCRAPE:
        return this.scrape(t, vel, dest, false);
      case Drum.SCRAPE_LONG:
        return this.scrape(t, vel, dest, true);
      case Drum.CONGA_LO:
        return this.tone(t, vel * 0.55, dest, 'sine', 196, 172, 0.11);
      case Drum.CONGA_HI:
        return this.tone(t, vel * 0.5, dest, 'sine', 294, 262, 0.08);
      case Drum.CONGA_SLAP:
        return this.tone(t, vel * 0.42, dest, 'triangle', 460, 330, 0.035);
      case Drum.BELL_HI:
        return this.bellHit(t, vel, dest, 1180);
      case Drum.BELL_LO:
        return this.bellHit(t, vel, dest, 790);
      case Drum.CLAVE:
        return this.tone(t, vel * 0.32, dest, 'sine', 2350, 2300, 0.022);
      case Drum.CLAP:
        return this.clap(t, vel, dest);
      case Drum.RIM:
        return this.tone(t, vel * 0.2, dest, 'square', 1650, 1600, 0.01);
      default:
        return;
    }
  }

  private kick(kitv: KitVoice, t: number, vel: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const soft = kitv === 'highlife';
    const top = soft ? 115 : kitv === 'citypop' ? 175 : 150;
    const o = this.osc('sine', top, t);
    o.frequency.exponentialRampToValueAtTime(soft ? 52 : 46, t + 0.11);
    const g = this.gain();
    this.ad(g.gain, t, 0.003, vel * (soft ? 0.65 : 0.95), soft ? 0.06 : 0.085);
    o.connect(g).connect(dest);
    this.run(o, t, t + 0.45, g);
  }

  private snare(kitv: KitVoice, t: number, vel: number, dest: AudioNode): void {
    if (!this.room(2)) return;
    const gated = kitv === 'citypop';
    const n = this.noiseSource();
    const f = gated ? this.filter('bandpass', 2000, 0.6) : this.filter('highpass', 1500, 0.8);
    const g = this.gain();
    const peak = vel * (gated ? 0.42 : 0.38);
    if (gated) {
      // Gated-reverb flavour: the noise tail holds flat, then the gate slams shut.
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setTargetAtTime(peak * 0.55, t + 0.002, 0.03);
      g.gain.setValueAtTime(peak * 0.5, t + 0.13);
      g.gain.linearRampToValueAtTime(0, t + 0.145);
    } else {
      this.ad(g.gain, t, 0.002, peak, vel < 0.5 ? 0.025 : 0.05);
    }
    n.connect(f).connect(g).connect(dest);
    this.startNoise(n, t, t + (gated ? 0.16 : 0.3), g);

    const o = this.osc('triangle', 200, t);
    o.frequency.exponentialRampToValueAtTime(165, t + 0.05);
    const og = this.gain();
    this.ad(og.gain, t, 0.002, vel * 0.32, 0.03);
    o.connect(og).connect(dest);
    this.run(o, t, t + 0.2, og);
  }

  private noiseHit(
    t: number, peak: number, dest: AudioNode, type: BiquadFilterType, freq: number, q: number, tc: number, len: number, attack = 0.001,
  ): void {
    if (!this.room(1)) return;
    const n = this.noiseSource();
    const f = this.filter(type, freq, q);
    const g = this.gain();
    this.ad(g.gain, t, attack, peak, tc);
    n.connect(f).connect(g).connect(dest);
    this.startNoise(n, t, t + len, g);
  }

  private scrape(t: number, vel: number, dest: AudioNode, long: boolean): void {
    if (!this.room(1)) return;
    const dur = long ? 0.15 : 0.055;
    const n = this.noiseSource();
    const f = this.filter('bandpass', long ? 3000 : 3600, 2.2);
    const ridge = this.gain();
    ridge.gain.setValueCurveAtTime(long ? this.scrapeLong : this.scrapeShort, t, dur);
    const g = this.gain(vel * 0.5);
    n.connect(f).connect(ridge).connect(g).connect(dest);
    this.startNoise(n, t, t + dur + 0.01, g);
  }

  private tone(t: number, peak: number, dest: AudioNode, type: OscillatorType, f0: number, f1: number, tc: number): void {
    if (!this.room(1)) return;
    const o = this.osc(type, f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + tc * 1.5);
    const g = this.gain();
    this.ad(g.gain, t, 0.002, peak, tc);
    o.connect(g).connect(dest);
    this.run(o, t, t + tc * 7 + 0.02, g);
  }

  private bellHit(t: number, vel: number, dest: AudioNode, f: number): void {
    if (!this.room(2)) return;
    const g = this.gain();
    this.ad(g.gain, t, 0.001, vel * 0.16, 0.06);
    const a = this.osc('triangle', f, t);
    const b = this.osc('sine', f * 2.76, t);
    const bg = this.gain(0.5);
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(dest);
    this.run(a, t, t + 0.35, g);
    this.run(b, t, t + 0.35, bg);
  }

  private clap(t: number, vel: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const n = this.noiseSource();
    const f = this.filter('bandpass', 1150, 1.1);
    const shape = this.gain();
    shape.gain.setValueCurveAtTime(this.clapCurve, t, 0.16);
    const g = this.gain(vel * 0.45);
    n.connect(f).connect(shape).connect(g).connect(dest);
    this.startNoise(n, t, t + 0.17, g);
  }

  // ---- bass ----

  bass(v: BassVoice, note: number, t: number, dur: number, vel: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const hz = mtof(note);
    const off = t + dur;
    const g = this.gain();
    let o: OscillatorNode;
    let end: number;
    switch (v) {
      case 'tumbao': {
        o = this.osc('triangle', hz, t);
        const f = this.filter('lowpass', 750, 0.9);
        this.asr(g.gain, t, 0.006, vel * 0.75, vel * 0.5, 0.2, off - 0.03, 0.04);
        o.connect(f).connect(g);
        end = off + 0.25;
        break;
      }
      case 'slap': {
        o = this.osc('sawtooth', hz, t);
        const f = this.filter('lowpass', 300, 6);
        f.frequency.setValueAtTime(400 + 3600 * vel, t);
        f.frequency.setTargetAtTime(320, t + 0.005, 0.045);
        this.asr(g.gain, t, 0.003, vel * 0.6, vel * 0.32, 0.09, off - 0.02, 0.03);
        o.connect(f).connect(g);
        end = off + 0.2;
        break;
      }
      case 'walk': {
        o = this.osc('triangle', hz, t);
        const f = this.filter('lowpass', 1300, 1);
        this.asr(g.gain, t, 0.004, vel * 0.75, vel * 0.35, 0.22, off - 0.02, 0.05);
        o.connect(f).connect(g);
        end = off + 0.3;
        break;
      }
      case 'octave': {
        o = this.osc('square', hz, t);
        const f = this.filter('lowpass', 500, 4);
        f.frequency.setValueAtTime(600 + 2000 * vel, t);
        f.frequency.setTargetAtTime(420, t + 0.004, 0.06);
        this.asr(g.gain, t, 0.004, vel * 0.42, vel * 0.25, 0.12, off - 0.02, 0.03);
        o.connect(f).connect(g);
        end = off + 0.2;
        break;
      }
    }
    g.connect(dest);
    this.run(o, t, end, g);
  }

  // ---- harmony ----

  harmony(v: HarmonyVoice, notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode): void {
    switch (v) {
      case 'accordion':
        return this.accordion(notes, t, dur, vel, dest);
      case 'clav':
        return this.clav(notes, t, dur, vel, dest);
      case 'guitar':
        for (const n of notes) this.pluck(n, t, vel, dest);
        return;
      case 'epiano':
        return this.epiano(notes, t, dur, vel, dest);
    }
  }

  private accordion(notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode): void {
    if (!this.room(notes.length)) return;
    const f = this.filter('bandpass', 1500, 0.8);
    const g = this.gain();
    const off = t + Math.max(0.06, dur * 0.85);
    this.asr(g.gain, t, 0.012, vel * 0.16, vel * 0.13, 0.08, off, 0.035);
    f.connect(g).connect(dest);
    const end = off + 0.2;
    notes.forEach((n, i) => {
      // Two reeds a few cents apart, alternated across the chord: saw and square.
      const o = this.osc(i % 2 === 0 ? 'sawtooth' : 'square', mtof(n), t);
      o.detune.value = i % 2 === 0 ? 7 : -7;
      o.connect(f);
      this.run(o, t, end, i === 0 ? g : o);
    });
  }

  private clav(notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode): void {
    if (!this.room(notes.length)) return;
    const muted = vel < 0.5;
    const f = this.filter('bandpass', 700, muted ? 3 : 6);
    // Envelope-swept wah: open fast, close slower.
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(muted ? 1500 : 900 + 2100 * vel, t + 0.03);
    f.frequency.setTargetAtTime(800, t + 0.03, 0.07);
    const g = this.gain();
    const off = t + (muted ? 0.035 : Math.min(dur, 0.2));
    this.asr(g.gain, t, 0.002, muted ? 0.16 : vel * 0.24, muted ? 0.05 : vel * 0.14, muted ? 0.012 : 0.07, off, 0.02);
    f.connect(g).connect(dest);
    const end = off + 0.12;
    notes.forEach((n, i) => {
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this.pulse);
      o.frequency.setValueAtTime(mtof(n), t);
      o.connect(f);
      this.run(o, t, end, i === 0 ? g : o);
    });
  }

  private pluck(note: number, t: number, vel: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const o = this.osc('sawtooth', mtof(note), t);
    const f = this.filter('lowpass', 800, 2);
    f.frequency.setValueAtTime(1500 + 3000 * vel, t);
    f.frequency.setTargetAtTime(650, t + 0.002, 0.07);
    const g = this.gain();
    this.ad(g.gain, t, 0.002, vel * 0.17, 0.16);
    o.connect(f).connect(g).connect(dest);
    this.run(o, t, t + 0.6, g);
  }

  private epiano(notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode): void {
    if (!this.room(notes.length * 2)) return;
    const g = this.gain();
    const off = t + dur;
    this.asr(g.gain, t, 0.004, vel * 0.13, vel * 0.07, 0.35, off, 0.09);
    g.connect(dest);
    const end = off + 0.4;
    notes.forEach((n, i) => {
      const hz = mtof(n);
      const det = i % 2 === 0 ? 5 : -5;
      const car = this.osc('sine', hz, t);
      car.detune.value = det;
      const mod = this.osc('sine', hz, t);
      mod.detune.value = det;
      const idx = this.gain();
      // FM index decays: a bright tine strike that mellows into a sine.
      idx.gain.setValueAtTime(hz * (1.2 + 1.6 * vel), t);
      idx.gain.setTargetAtTime(hz * 0.18, t + 0.005, 0.22);
      mod.connect(idx).connect(car.frequency);
      car.connect(g);
      this.run(car, t, end, i === 0 ? g : car);
      this.run(mod, t, end, idx);
    });
  }

  // ---- lead ----

  lead(v: LeadVoice, notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode): void {
    switch (v) {
      case 'clarinet':
        for (const n of notes) this.clarinet(n, t, dur, vel, dest);
        return;
      case 'horns':
        for (const n of notes) this.brass([n, n - 7, n - 12], t, dur, vel, dest, 0.1);
        return;
      case 'hornThirds':
        return this.brass(notes, t, dur, vel, dest, 0.13);
      case 'bell':
        for (const n of notes) this.glass(n, t, vel, dest);
        return;
    }
  }

  private clarinet(note: number, t: number, dur: number, vel: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const o = this.osc('square', mtof(note), t);
    if (dur > 0.3) o.detune.setValueCurveAtTime(this.vibrato, t + 0.12, dur - 0.12);
    const f = this.filter('lowpass', 1700 + 900 * vel, 0.6);
    const g = this.gain();
    const off = t + dur;
    this.asr(g.gain, t, 0.035, vel * 0.16, vel * 0.13, 0.1, off - 0.02, 0.05);
    o.connect(f).connect(g).connect(dest);
    this.run(o, t, off + 0.3, g);
  }

  private brass(notes: readonly number[], t: number, dur: number, vel: number, dest: AudioNode, level: number): void {
    if (!this.room(notes.length)) return;
    const f = this.filter('lowpass', 400, 1.2);
    // Brassy blat: the filter opens fast, overshoots, settles.
    f.frequency.setValueAtTime(350, t);
    f.frequency.linearRampToValueAtTime(1800 + 2200 * vel, t + 0.04);
    f.frequency.setTargetAtTime(1300 + 500 * vel, t + 0.04, 0.12);
    const g = this.gain();
    const off = t + Math.max(0.08, dur);
    this.asr(g.gain, t, 0.025, vel * level, vel * level * 0.75, 0.15, off - 0.02, 0.05);
    f.connect(g).connect(dest);
    const end = off + 0.3;
    notes.forEach((n, i) => {
      const o = this.osc('sawtooth', mtof(n), t);
      o.detune.value = i % 2 === 0 ? 4 : -4;
      o.connect(f);
      this.run(o, t, end, i === 0 ? g : o);
    });
  }

  private glass(note: number, t: number, vel: number, dest: AudioNode): void {
    if (!this.room(2)) return;
    const hz = mtof(note);
    const car = this.osc('sine', hz, t);
    const mod = this.osc('sine', hz * 3.5, t);
    const idx = this.gain();
    idx.gain.setValueAtTime(hz * 1.4 * vel, t);
    idx.gain.setTargetAtTime(hz * 0.05, t + 0.002, 0.12);
    mod.connect(idx).connect(car.frequency);
    const g = this.gain();
    this.ad(g.gain, t, 0.002, vel * 0.2, 0.32);
    car.connect(g).connect(dest);
    this.run(car, t, t + 1.3, g);
    this.run(mod, t, t + 1.3, idx);
  }

  // ---- effects ----

  hop(t: number, dest: AudioNode): void {
    this.tone(t, 0.45, dest, 'sine', 210, 95, 0.045);
  }

  land(t: number, impact: number, dest: AudioNode): void {
    const k = Math.min(1, Math.max(0.15, impact / 9));
    this.tone(t, 0.75 * k, dest, 'sine', 120, 42, 0.06 + 0.04 * k);
    this.noiseHit(t, 0.35 * k, dest, 'lowpass', 600 + 900 * k, 0.7, 0.03 + 0.03 * k, 0.3);
  }

  boing(t: number, speed: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const k = Math.min(1, Math.max(0.3, speed / 8));
    const o = this.osc('triangle', 170, t);
    o.frequency.setValueCurveAtTime(this.boingCurve, t, 0.45);
    const g = this.gain();
    this.ad(g.gain, t, 0.004, 0.4 * k, 0.15);
    o.connect(g).connect(dest);
    this.run(o, t, t + 0.6, g);
  }

  scuff(t: number, size: number, dest: AudioNode): void {
    this.noiseHit(t, 0.32 * size, dest, 'bandpass', 900 + 500 * size, 0.8, 0.025 + 0.04 * size, 0.35, 0.008);
  }

  thud(t: number, size: number, dest: AudioNode): void {
    this.tone(t, 0.3 + 0.5 * size, dest, 'sine', 95, 45, 0.07);
  }

  whoosh(t: number, speed: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const n = this.noiseSource();
    const top = 350 + 95 * Math.min(speed, 30);
    const f = this.filter('bandpass', 300, 1.3);
    f.frequency.setValueAtTime(280, t);
    f.frequency.exponentialRampToValueAtTime(top, t + 0.13);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.45);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.09);
    g.gain.setTargetAtTime(0, t + 0.12, 0.1);
    n.connect(f).connect(g).connect(dest);
    this.startNoise(n, t, t + 0.6, g);
  }

  chime(t: number, note: number, dest: AudioNode, level = 0.22): void {
    if (!this.room(1)) return;
    const o = this.osc('triangle', mtof(note), t);
    const g = this.gain();
    this.ad(g.gain, t, 0.003, level, 0.22);
    o.connect(g).connect(dest);
    this.run(o, t, t + 1.1, g);
  }

  buzz(t: number, hz: number, len: number, dest: AudioNode, level = 0.22): void {
    if (!this.room(1)) return;
    const o = this.osc('square', hz, t);
    o.detune.value = -30;
    const f = this.filter('lowpass', 900, 0.8);
    const shape = this.gain();
    shape.gain.setValueCurveAtTime(this.buzzCurve, t, len);
    const g = this.gain(level);
    o.connect(f).connect(shape).connect(g).connect(dest);
    this.run(o, t, t + len + 0.01, g);
  }

  crash(t: number, dest: AudioNode): void {
    if (this.room(1)) {
      const n = this.noiseSource();
      const f = this.filter('lowpass', 6000, 0.7);
      f.frequency.setValueAtTime(6500, t);
      f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
      const g = this.gain();
      this.ad(g.gain, t, 0.002, 0.55, 0.18);
      n.connect(f).connect(g).connect(dest);
      this.startNoise(n, t, t + 1, g);
    }
    if (this.room(1)) {
      // Scatter: bits of board and grit skittering off.
      const n = this.noiseSource();
      const f = this.filter('bandpass', 2600, 2);
      const shape = this.gain();
      shape.gain.setValueCurveAtTime(this.scatterCurve, t + 0.05, 0.7);
      const g = this.gain(0.3);
      n.connect(f).connect(shape).connect(g).connect(dest);
      this.startNoise(n, t, t + 0.8, g);
    }
    this.tone(t, 0.7, dest, 'sine', 85, 34, 0.09);
  }

  // ---- UI ----

  tick(t: number, dest: AudioNode): void {
    this.noiseHit(t, 0.28, dest, 'highpass', 2800, 0.9, 0.006, 0.04);
  }

  punch(t: number, dest: AudioNode): void {
    this.tone(t, 0.45, dest, 'sine', 320, 70, 0.025);
    this.noiseHit(t, 0.3, dest, 'highpass', 3500, 0.7, 0.008, 0.05);
  }

  ink(t: number, dest: AudioNode): void {
    if (!this.room(1)) return;
    const o = this.osc('sine', 520, t);
    o.frequency.exponentialRampToValueAtTime(860, t + 0.09);
    const g = this.gain();
    this.ad(g.gain, t, 0.01, 0.16, 0.05);
    o.connect(g).connect(dest);
    this.run(o, t, t + 0.3, g);
  }
}
