/**
 * The Web Audio side: buses, compressor, delay send, the always-on noise layer and the track
 * players. It does no deciding of its own: each frame it applies a MixState from the pure mixer
 * and runs the pure transport's scheduler.
 *
 * Graph:
 *   player stems (4 GainNodes) -> player out -> music bus -> daylight tone -> duck -> compressor -> master -> out
 *   lead stem -> delay send -> delay <-> feedback -> music bus
 *   noise layer, cues, UI -> sfx bus -> duck
 */
import type { MixState, MotorKind } from './mixer';
import { Synth } from './synth';
import { scaleNote, stepIndex, TRACKS, type NoteEvent, type TrackDef } from './tracks/index';
import { createTransport, nextBeatTime, positionAt, schedule, type Position, type ScheduledStep, type Transport } from './transport';

/** How far ahead notes are scheduled, s. */
const LOOKAHEAD = 0.12;
/** Lead time for anything triggered "now", s. */
const NOW_LEAD = 0.005;

interface Player {
  track: TrackDef;
  index: NoteEvent[][][];
  transport: Transport;
  out: GainNode;
  stems: GainNode[];
  on: boolean[];
  onFrom: number[];
  offUntil: number[];
  /** Audio time after which the player is silent and removed (Infinity while current). */
  dieAt: number;
}

/** Sets an AudioParam smoothly, skipping updates that would not be heard. */
class Smooth {
  private last: number;
  constructor(
    private readonly param: AudioParam,
    initial: number,
    private readonly eps: number,
  ) {
    this.last = initial;
    param.value = initial;
  }
  set(v: number, now: number, tc: number): void {
    if (Math.abs(v - this.last) <= this.eps) return;
    this.last = v;
    this.param.setTargetAtTime(v, now, tc);
  }
}

export class Engine {
  readonly ctx: AudioContext;
  readonly synth: Synth;
  private readonly master: GainNode;
  private readonly duck: GainNode;
  private readonly musicBus: GainNode;
  private readonly sfxBus: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly delayIn: GainNode;
  /** Delay return, closed on a bail so echoes cannot outlive the cut. */
  private readonly delayOut: GainNode;
  private readonly persistent: AudioScheduledSourceNode[] = [];

  private readonly sMaster: Smooth;
  private readonly sMusic: Smooth;
  private readonly sSfx: Smooth;
  private readonly sTone: Smooth;
  private readonly sWheel: Smooth;
  private readonly sWheelCut: Smooth;
  private readonly sClatterRate: Smooth;
  private readonly sClatterDepth: Smooth;
  private readonly sWheelBase: Smooth;
  private readonly sWind: Smooth;
  private readonly sWindFreq: Smooth;
  private readonly sGrind: Smooth;
  private readonly sGrind1: Smooth;
  private readonly sGrind2: Smooth;
  private readonly sMotor: Smooth;
  private readonly sMotorCut: Smooth;
  private readonly sMotorNoise: Smooth;
  private readonly motorLP: BiquadFilterNode;
  /** Motor oscillators exist only while a ride is in range (they cost two voices). */
  private motor: { a: OscillatorNode; b: OscillatorNode; sA: Smooth; sB: Smooth } | null = null;
  private motorIdle = 0;
  private motorKind: MotorKind | null = null;

  private readonly players: Player[] = [];
  private appliedGen = 0;
  private appliedRev = 0;
  private duckTarget = 1;
  private readonly steps: ScheduledStep[] = [];
  private readonly pos: Position = { bar: 0, beat: 0, step: 0 };
  private gust = 0;
  private lastTrack = 2;
  private muted = false;
  private music = 1;
  private sfx = 1;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const now = ctx.currentTime;
    this.synth = new Synth(ctx);
    const s = this.synth;

    // Light glue on the whole mix, not a limiter: the stems are balanced to peak below full scale
    // on their own (the full band with SFX measured in a browser stays under 1.0).
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.sMaster = new Smooth(this.master.gain, 0.9, 1e-4);
    comp.connect(this.master).connect(ctx.destination);

    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(comp);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.sTone = new Smooth(this.tone.frequency, 16000, 50);
    this.tone.connect(this.duck);

    this.musicBus = ctx.createGain();
    this.sMusic = new Smooth(this.musicBus.gain, 0.8, 1e-4);
    this.musicBus.connect(this.tone);
    this.sfxBus = ctx.createGain();
    this.sSfx = new Smooth(this.sfxBus.gain, 0.9, 1e-4);
    this.sfxBus.connect(this.duck);

    // Lead delay: a dotted-8th echo, darkened on each repeat.
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 0.3;
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.45;
    const dTone = ctx.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 2400;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.delayIn.connect(this.delay).connect(dTone);
    dTone.connect(fb).connect(this.delay);
    this.delayOut = ctx.createGain();
    this.delayOut.gain.value = 1;
    dTone.connect(this.delayOut).connect(this.musicBus);

    // Noise layer, all fed by one looping noise source.
    const noise = s.noiseSource();
    s.hold(noise, now);
    this.persistent.push(noise);

    const wheelLP = ctx.createBiquadFilter();
    wheelLP.type = 'lowpass';
    wheelLP.Q.value = 0.9;
    this.sWheelCut = new Smooth(wheelLP.frequency, 300, 20);
    const wheelHP = ctx.createBiquadFilter();
    wheelHP.type = 'highpass';
    wheelHP.frequency.value = 70;
    const wheelAM = ctx.createGain();
    this.sWheelBase = new Smooth(wheelAM.gain, 1, 1e-3);
    const wheelGain = ctx.createGain();
    this.sWheel = new Smooth(wheelGain.gain, 0, 1e-4);
    noise.connect(wheelHP).connect(wheelLP).connect(wheelAM).connect(wheelGain).connect(this.sfxBus);
    const clatter = ctx.createOscillator();
    clatter.type = 'square';
    this.sClatterRate = new Smooth(clatter.frequency, 10, 0.2);
    const clatterDepth = ctx.createGain();
    this.sClatterDepth = new Smooth(clatterDepth.gain, 0, 1e-3);
    clatter.connect(clatterDepth).connect(wheelAM.gain);
    s.hold(clatter, now);
    this.persistent.push(clatter);

    const windBP = ctx.createBiquadFilter();
    windBP.type = 'bandpass';
    windBP.Q.value = 0.8;
    this.sWindFreq = new Smooth(windBP.frequency, 400, 10);
    const windGain = ctx.createGain();
    this.sWind = new Smooth(windGain.gain, 0, 1e-4);
    noise.connect(windBP).connect(windGain).connect(this.sfxBus);

    const g1 = ctx.createBiquadFilter();
    g1.type = 'bandpass';
    g1.Q.value = 14;
    this.sGrind1 = new Smooth(g1.frequency, 1500, 10);
    const g2 = ctx.createBiquadFilter();
    g2.type = 'bandpass';
    g2.Q.value = 18;
    this.sGrind2 = new Smooth(g2.frequency, 2200, 10);
    const grindGain = ctx.createGain();
    this.sGrind = new Smooth(grindGain.gain, 0, 1e-4);
    noise.connect(g1).connect(grindGain);
    noise.connect(g2).connect(grindGain);
    grindGain.connect(this.sfxBus);

    const motorLP = ctx.createBiquadFilter();
    this.motorLP = motorLP;
    motorLP.type = 'lowpass';
    motorLP.Q.value = 1.5;
    this.sMotorCut = new Smooth(motorLP.frequency, 300, 10);
    const motorGain = ctx.createGain();
    this.sMotor = new Smooth(motorGain.gain, 0, 1e-4);
    const motorNoiseLP = ctx.createBiquadFilter();
    motorNoiseLP.type = 'lowpass';
    motorNoiseLP.frequency.value = 380;
    const motorNoise = ctx.createGain();
    this.sMotorNoise = new Smooth(motorNoise.gain, 0, 1e-3);
    motorLP.connect(motorGain);
    noise.connect(motorNoiseLP).connect(motorNoise).connect(motorGain);
    motorGain.connect(this.sfxBus);
  }

  resume(): void {
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      void this.ctx.resume().catch(() => undefined);
    }
    // Older iOS only unlocks after something plays inside the gesture.
    const b = this.ctx.createBufferSource();
    b.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    b.connect(this.ctx.destination);
    b.start();
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  setVolumes(music: number, sfx: number): void {
    this.music = clamp01(music);
    this.sfx = clamp01(sfx);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const now = this.ctx.currentTime;
    this.sMaster.set(this.muted ? 0 : 0.9, now, 0.02);
    this.sMusic.set(0.8 * this.music, now, 0.03);
    this.sSfx.set(0.9 * this.sfx, now, 0.03);
  }

  /** Bar and beat of the current track at the audio clock, or null with no track. */
  position(): Position | null {
    const p = this.current();
    if (!p) return null;
    return positionAt(p.transport, this.ctx.currentTime, this.pos);
  }

  get voices(): number {
    return this.synth.live;
  }

  private current(): Player | null {
    for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].dieAt === Infinity) return this.players[i];
    return null;
  }

  /** Apply one frame of mixer output. */
  apply(m: MixState, dt: number): void {
    if (this.ctx.state === 'closed') return;
    const now = this.ctx.currentTime;

    // Pause: duck everything over exactly masterFade.
    if (m.master !== this.duckTarget) {
      this.duckTarget = m.master;
      const g = this.duck.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(m.master, now + m.masterFade);
    }
    this.sTone.set(5500 + 12500 * m.daylight, now, 0.5);

    if (m.trackGen !== this.appliedGen && m.track !== null) {
      this.appliedGen = m.trackGen;
      this.switchTrack(TRACKS[m.track], m.trackFade, now);
      this.appliedRev = -1;
    }
    if (m.stemRev !== this.appliedRev) {
      this.appliedRev = m.stemRev;
      this.applyStems(m, now);
    }

    if (!m.hold) for (const p of this.players) this.schedulePlayer(p, now);
    // Drop finished players, compacting in place (no new array per frame).
    const ps = this.players;
    let kept = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dieAt > now) ps[kept++] = p;
      else p.out.disconnect();
    }
    ps.length = kept;

    for (const c of m.cues) this.cue(c, now + NOW_LEAD);
    this.noiseLayer(m, now, dt);
  }

  private switchTrack(track: TrackDef, fade: number, now: number): void {
    this.lastTrack = track.district;
    const cur = this.current();
    // Rapid switching: anything still fading out goes now.
    for (const p of this.players) {
      if (p !== cur && p.dieAt !== Infinity) this.kill(p, now, 0.03);
    }
    const curAudible = cur !== null && cur.on.some((on, s) => on || cur.offUntil[s] > now);
    const start = cur && curAudible ? nextBeatTime(cur.transport, now + 0.02) : now + 0.04;
    const out = this.ctx.createGain();
    out.connect(this.musicBus);
    if (curAudible) {
      out.gain.setValueAtTime(0, now);
      out.gain.setValueAtTime(0, start);
      out.gain.linearRampToValueAtTime(1, start + fade);
    } else {
      out.gain.value = 1;
    }
    const stems: GainNode[] = [];
    for (let s = 0; s < 4; s++) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      if (s === 3) g.connect(this.delayIn);
      stems.push(g);
    }
    if (cur) {
      if (curAudible) {
        const g = cur.out.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setValueAtTime(g.value, start);
        g.linearRampToValueAtTime(0, start + fade);
        cur.dieAt = start + fade + 0.05;
      } else {
        cur.dieAt = now;
      }
    }
    const beat = 60 / track.bpm;
    this.delay.delayTime.setTargetAtTime(beat * 0.75, now, 0.05);
    this.players.push({
      track,
      index: stepIndex(track),
      transport: createTransport(track.bpm, start),
      out,
      stems,
      on: [false, false, false, false],
      onFrom: [0, 0, 0, 0],
      offUntil: [0, 0, 0, 0],
      dieAt: Infinity,
    });
  }

  private kill(p: Player, now: number, fade: number): void {
    const g = p.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    p.dieAt = Math.min(p.dieAt, now + fade + 0.02);
  }

  private applyStems(m: MixState, now: number): void {
    const p = this.current();
    let maxFade = 0;
    let anyOn = false;
    for (let s = 0; s < 4; s++) {
      maxFade = Math.max(maxFade, m.stemFades[s]);
      if (m.stemTargets[s] > 0) anyOn = true;
    }
    // A bail-fast cut also silences a track still cross-fading out, and the echoes.
    const dg = this.delayOut.gain;
    if (!anyOn && maxFade <= 0.06) {
      for (const q of this.players) if (q !== p) this.kill(q, now, maxFade);
      dg.cancelScheduledValues(now);
      dg.setValueAtTime(dg.value, now);
      dg.linearRampToValueAtTime(0, now + Math.max(0.005, maxFade));
    } else if (anyOn) {
      dg.cancelScheduledValues(now);
      dg.setValueAtTime(dg.value, now);
      dg.linearRampToValueAtTime(1, now + 0.02);
    }
    if (!p) return;
    for (let s = 0; s < 4; s++) {
      const target = m.stemTargets[s];
      const fade = Math.max(0.005, m.stemFades[s]);
      const g = p.stems[s].gain;
      if (target > 0 && !p.on[s]) {
        const tB = nextBeatTime(p.transport, now + NOW_LEAD);
        const stillSounding = now < p.offUntil[s];
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.setValueAtTime(stillSounding ? g.value : 0, tB);
        g.linearRampToValueAtTime(target, tB + fade);
        p.on[s] = true;
        p.onFrom[s] = stillSounding ? now : tB;
      } else if (target === 0 && p.on[s]) {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + fade);
        p.on[s] = false;
        p.offUntil[s] = now + fade;
      }
    }
  }

  private schedulePlayer(p: Player, now: number): void {
    const n = schedule(p.transport, now, LOOKAHEAD, this.steps);
    const stepDur = p.transport.stepDur;
    for (let i = 0; i < n; i++) {
      const st = this.steps[i];
      if (st.time >= p.dieAt) break;
      for (let s = 0; s < 4; s++) {
        const audible = p.on[s] ? st.time >= p.onFrom[s] - 1e-6 : st.time < p.offUntil[s];
        if (!audible) continue;
        const evs = p.index[s][st.loopStep];
        for (let k = 0; k < evs.length; k++) this.play(p, s, evs[k], st.time, stepDur);
      }
    }
  }

  private play(p: Player, stem: number, e: NoteEvent, t: number, stepDur: number): void {
    const v = p.track.voices;
    const dest = p.stems[stem];
    const dur = e.len * stepDur;
    switch (stem) {
      case 0:
        for (const n of e.notes) this.synth.drum(v.perc, n, t, e.vel, dest);
        break;
      case 1:
        this.synth.bass(v.bass, e.notes[0], t, dur, e.vel, dest);
        break;
      case 2:
        this.synth.harmony(v.harmony, e.notes, t, dur, e.vel, dest);
        break;
      case 3:
        this.synth.lead(v.lead, e.notes, t, dur, e.vel, dest);
        break;
    }
  }

  private cue(c: MixState['cues'][number], t: number): void {
    const s = this.synth;
    const d = this.sfxBus;
    switch (c.type) {
      case 'hop':
        return s.hop(t, d);
      case 'land':
        return s.land(t, c.impact, d);
      case 'boing':
        return s.boing(t, c.speed, d);
      case 'scuff':
        return s.scuff(t, c.size, d);
      case 'thud':
        return s.thud(t, c.size, d);
      case 'release':
        s.whoosh(t, c.speed, d);
        s.chime(t + 0.04, c.note, d);
        return;
      case 'denied':
        return s.buzz(t, 98, 0.26, d);
      case 'bail':
        return s.crash(t, d);
    }
  }

  ui(name: 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny'): void {
    if (this.ctx.state === 'closed') return;
    const t = this.ctx.currentTime + NOW_LEAD;
    const s = this.synth;
    const d = this.sfxBus;
    switch (name) {
      case 'tick':
        return s.tick(t, d);
      case 'punch':
        return s.punch(t, d);
      case 'ink':
        return s.ink(t, d);
      case 'deny':
        return s.buzz(t, 150, 0.17, d, 0.16);
      case 'fanfare': {
        const tr = TRACKS[this.lastTrack];
        const degrees = [1, 3, 5, 8];
        degrees.forEach((deg, i) => s.chime(t + i * 0.085, scaleNote(tr, deg) - 12, d, i === 3 ? 0.24 : 0.18));
        s.chime(t + 3 * 0.085, scaleNote(tr, 5) - 12, d, 0.12);
        return;
      }
    }
  }

  /**
   * Finds: 'tile' a bright two-note chime, `step` scale degrees up the trail (each tile taken within
   * a few seconds of the last is a step higher); 'spot' a rubber-stamp thud; 'unlock' a four-note
   * fanfare climbing an octave and a half.
   */
  find(kind: 'tile' | 'spot' | 'unlock', step: number): void {
    if (this.ctx.state === 'closed') return;
    const t = this.ctx.currentTime + NOW_LEAD;
    const s = this.synth;
    const d = this.sfxBus;
    const tr = TRACKS[this.lastTrack];
    switch (kind) {
      case 'tile': {
        const deg = 3 + Math.max(0, Math.min(9, Math.floor(step)));
        s.chime(t, scaleNote(tr, deg), d, 0.17);
        s.chime(t + 0.07, scaleNote(tr, deg + 2), d, 0.2);
        return;
      }
      case 'spot':
        s.thud(t, 1, d);
        s.punch(t + 0.01, d);
        return;
      case 'unlock': {
        const degrees = [1, 5, 8, 12];
        degrees.forEach((deg, i) => s.chime(t + i * 0.11, scaleNote(tr, deg) - 12, d, i === 3 ? 0.26 : 0.19));
        s.chime(t + 3 * 0.11, scaleNote(tr, 10) - 12, d, 0.12);
        return;
      }
    }
  }

  private noiseLayer(m: MixState, now: number, dt: number): void {
    const wheel = m.wheelLevel;
    this.sWheel.set(0.24 * wheel * Math.sqrt(wheel), now, 0.04);
    this.sWheelCut.set(m.wheelCutoff, now, 0.05);
    this.sClatterRate.set(Math.max(1, m.clatterRate), now, 0.05);
    this.sClatterDepth.set(m.clatterDepth, now, 0.03);
    this.sWheelBase.set(1 - m.clatterDepth, now, 0.03);

    this.gust += Math.min(dt, 0.1);
    const gust = 0.8 + 0.2 * Math.sin(this.gust * 0.7) * Math.sin(this.gust * 1.9 + 1);
    this.sWind.set(0.16 * m.windLevel * gust, now, 0.15);
    this.sWindFreq.set(m.windFreq * (0.85 + 0.3 * gust), now, 0.2);

    this.sGrind.set(m.grinding ? 0.16 : 0, now, m.grinding ? 0.01 : 0.03);
    this.sGrind1.set(m.grindPitch, now, 0.05);
    this.sGrind2.set(m.grindPitch * 1.47, now, 0.05);

    if (m.motorLevel > 0) {
      this.motorIdle = 0;
      if (!this.motor) {
        const a = this.ctx.createOscillator();
        const b = this.ctx.createOscillator();
        a.connect(this.motorLP);
        b.connect(this.motorLP);
        this.synth.hold(a, now);
        this.synth.hold(b, now);
        this.motor = { a, b, sA: new Smooth(a.frequency, m.motorPitch, 0.5), sB: new Smooth(b.frequency, m.motorPitch * 1.5, 0.5) };
        this.motorKind = null;
      }
      if (m.motorKind !== null && m.motorKind !== this.motorKind) {
        this.motorKind = m.motorKind;
        const k = m.motorKind;
        this.motor.a.type = k === 'hum' ? 'sine' : 'sawtooth';
        this.motor.b.type = k === 'hum' ? 'sine' : k === 'engine' ? 'square' : 'sawtooth';
      }
    } else if (this.motor) {
      this.motorIdle += dt;
      if (this.motorIdle > 1.5) {
        this.stopMotor();
      }
    }
    const k = this.motorKind;
    const pitch = m.motorPitch;
    if (this.motor) {
      this.motor.sA.set(pitch, now, 0.3);
      this.motor.sB.set(k === 'engine' ? pitch * 1.012 : k === 'hum' ? pitch * 1.5 + 0.7 : pitch * 1.5, now, 0.3);
    }
    this.sMotorCut.set(k === 'hum' ? 1800 : k === 'engine' ? 650 : 230, now, 0.1);
    this.sMotorNoise.set(k === 'rail' ? 0.9 : k === 'engine' ? 0.2 : 0, now, 0.1);
    const motorGain = k === 'hum' ? 0.07 : 0.2;
    this.sMotor.set(m.motorLevel * motorGain, now, 0.12);
  }

  private stopMotor(): void {
    const mo = this.motor;
    if (!mo) return;
    this.motor = null;
    for (const o of [mo.a, mo.b]) {
      this.synth.unhold(o);
      o.disconnect();
    }
  }

  dispose(): void {
    this.stopMotor();
    for (const p of this.players) p.out.disconnect();
    this.players.length = 0;
    for (const n of this.persistent) {
      try {
        n.stop();
      } catch {
        // already stopped
      }
    }
    void this.ctx.close().catch(() => undefined);
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

