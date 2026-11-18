/**
 * The audio system the app drives. The pure Mixer always runs (so debug() follows the game even
 * without sound); the Web Audio Engine exists only after unlock() in a browser that has it.
 */
import type { CompiledLine } from '../sim/lines';
import type { SimEvent } from '../sim/types';
import { Engine } from './engine';
import { Mixer } from './mixer';

export interface AudioView {
  /** Mode value from src/sim/types.ts. */
  mode: number;
  /** m/s. */
  speed: number;
  /** Surface under the wheels (Surface enum) or -1 in the air. */
  surface: number;
  /** Links in the current chain (0 = none) and whether it is alive in flight. */
  chain: number;
  chainAlive: boolean;
  /** Index into `lines` of the line hitched to, or -1. */
  hitchedLine: number;
  /** District (0..3) the skater is in. */
  district: number;
  /** 0..1, 0 = midnight. */
  dayFrac: number;
  /** Distance in metres to the nearest active ride vehicle, its kind, or Infinity/null. */
  nearRideDist: number;
  nearRideKind: string | null;
  paused: boolean;
}

export interface AudioDebug {
  /** AudioContext exists and is running. */
  running: boolean;
  /** District index of the playing track. */
  track: number | null;
  /** Mixer target gain 0..1 per stem (perc, bass, harmony, lead). */
  stemTargets: [number, number, number, number];
  fullBand: boolean;
  /** 0..1. */
  wheelLevel: number;
  /** Transport position. */
  bar: number;
  beat: number;
  /**
   * Live oscillator/buffer source nodes, the most planned to sound at once, and voices skipped
   * because the 24-source budget was full (all 0 without Web Audio).
   */
  voices: number;
  peakVoices: number;
  droppedVoices: number;
}

export type UiSound = 'tick' | 'punch' | 'ink' | 'fanfare' | 'deny';

/** Sounds of finding things (see Engine.find). */
export type FindSound = 'tile' | 'spot' | 'unlock';

export interface AudioSystem {
  /** Call from a user gesture. Creates or resumes the AudioContext. Idempotent; never throws (a browser without Web Audio leaves the system silently inert). */
  unlock(): void;
  /** Once per rendered frame, with every sim event since the previous call. */
  update(view: AudioView, events: readonly SimEvent[], lines: readonly CompiledLine[], dtSeconds: number): void;
  setMuted(muted: boolean): void;
  /** Each 0..1. */
  setVolumes(music: number, sfx: number): void;
  /** One-shot UI sounds: 'tick' (flap of a destination board), 'punch' (ticket punched), 'ink' (line segment inked), 'fanfare' (line or errand complete), 'deny'. */
  ui(name: UiSound): void;
  /** A find: 'tile' (a chime `step` degrees up a trail), 'spot' (a stamp), 'unlock' (a fanfare). */
  find(kind: FindSound, step?: number): void;
  debug(): AudioDebug;
  dispose(): void;
}

type AudioCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioCtor | null {
  const g = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

class AudioSystemImpl implements AudioSystem {
  private readonly mixer = new Mixer();
  private engine: Engine | null = null;
  private muted = false;
  private music = 1;
  private sfx = 1;
  private disposed = false;

  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.engine) {
        const Ctor = audioContextCtor();
        if (!Ctor) return;
        this.engine = new Engine(new Ctor({ latencyHint: 'interactive' }));
        this.engine.setVolumes(this.music, this.sfx);
        this.engine.setMuted(this.muted);
      }
      this.engine.resume();
    } catch (_e) {
      this.engine = null;
    }
  }

  update(view: AudioView, events: readonly SimEvent[], lines: readonly CompiledLine[], dtSeconds: number): void {
    if (this.disposed) return;
    const mix = this.mixer.update(view, events, lines, dtSeconds);
    if (!this.engine) return;
    try {
      this.engine.apply(mix, dtSeconds);
    } catch (_e) {
      // A Web Audio failure must never take the game loop down; drop to silent.
      this.dropEngine();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.engine?.setMuted(muted);
  }

  setVolumes(music: number, sfx: number): void {
    this.music = music;
    this.sfx = sfx;
    this.engine?.setVolumes(music, sfx);
  }

  ui(name: UiSound): void {
    if (!this.engine) return;
    try {
      this.engine.ui(name);
    } catch (_e) {
      this.dropEngine();
    }
  }

  find(kind: FindSound, step = 0): void {
    if (!this.engine) return;
    try {
      this.engine.find(kind, step);
    } catch (_e) {
      this.dropEngine();
    }
  }

  debug(): AudioDebug {
    const m = this.mixer.state;
    const pos = this.engine?.position() ?? null;
    return {
      running: this.engine?.running ?? false,
      track: m.track,
      stemTargets: [m.stemTargets[0], m.stemTargets[1], m.stemTargets[2], m.stemTargets[3]],
      fullBand: m.fullBand,
      wheelLevel: m.wheelLevel,
      bar: pos?.bar ?? 0,
      beat: pos?.beat ?? 0,
      voices: this.engine?.voices ?? 0,
      peakVoices: this.engine?.synth.peak ?? 0,
      droppedVoices: this.engine?.synth.dropped ?? 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.dropEngine();
  }

  private dropEngine(): void {
    const e = this.engine;
    this.engine = null;
    if (!e) return;
    try {
      e.dispose();
    } catch (_e) {
      // nothing left to release
    }
  }
}

export function createAudio(): AudioSystem {
  return new AudioSystemImpl();
}
