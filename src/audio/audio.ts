/**
 * The game's sound, as the app sees it: one object made at boot, handed each tick's effects, and
 * a switch and a volume for the settings.
 *
 * Browsers refuse sound before a gesture (iOS Safari most of all), so the `AudioContext` is made
 * and resumed inside the first touch, tap or key that counts as one, never before: nothing warns on
 * load. Hidden, the context is suspended; shown again, resumed. Paused, it sleeps until the game
 * resumes. Muted, nothing is scheduled and the context sleeps. If Web Audio is missing or refuses, the game goes on silent: nothing here throws
 * or logs.
 */
import type { Fx } from '../sim/world';
import type { MoverState } from '../sim/types';
import { AudioDirector } from './director';
import { SND_COUNT, SND_NAMES } from './sfx';
import { Synth } from './synth';

/** The scheduler is pumped this often, ms; its look-ahead covers several missed pumps. */
const PUMP_MS = 25;
/** Events that browsers accept as a gesture that may start audio. */
const GESTURES = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'] as const;

/** What the settings screens need: a switch and a music volume. */
export interface SoundControls {
  readonly muted: boolean;
  /** Music volume, 0..1. */
  readonly volume: number;
  setMuted(on: boolean): void;
  setVolume(v: number): void;
}

/** What the test hook reports: the context's state and how much has been scheduled. */
export interface SoundReport {
  /** The context's state, or 'none' before the first gesture (or without Web Audio). */
  state: string;
  muted: boolean;
  /** Music notes and effects handed to Web Audio. */
  notes: number;
  effects: number;
  /** Effects by name. */
  kinds: Record<string, number>;
}

export interface GameAudioOptions {
  muted: boolean;
  volume: number;
  /** The map seed: it picks the groove. */
  seed: number;
  /** Called when the player changes the switch or the volume, to keep them. */
  save?: (muted: boolean, volume: number) => void;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function contextCtor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** False only where the browser can tell us this event is not a gesture it will honour. */
function gestureActive(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua === undefined || ua.isActive;
}

export class GameAudio implements SoundControls {
  readonly director: AudioDirector;
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private vol: number;
  private timer = 0;
  private failed = false;
  private paused = false;
  private readonly save: ((muted: boolean, volume: number) => void) | undefined;

  constructor(opts: GameAudioOptions) {
    this.director = new AudioDirector(opts.seed, opts.muted);
    this.vol = clampVolume(opts.volume);
    this.save = opts.save;
    const onGesture = (): void => this.unlock();
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.sleep());
  }

  get muted(): boolean {
    return this.director.muted;
  }

  get volume(): number {
    return this.vol;
  }

  setMuted(on: boolean): void {
    this.director.setMuted(on);
    this.save?.(on, this.vol);
    if (on) this.sleep();
    // Turning sound on is itself a tap: the context can be made or woken right here.
    else this.unlock();
  }

  setVolume(v: number): void {
    this.vol = clampVolume(v);
    this.synth?.setMusicVolume(this.vol);
    this.save?.(this.director.muted, this.vol);
  }

  /**
   * The game paused (true) or resumed (false). Paused, the context is suspended: the music stops
   * where it is and nothing more sounds. Resuming is a tap on RESUME, so the context can be woken here.
   */
  setPaused(on: boolean): void {
    this.paused = on;
    if (on) this.sleep();
    else this.unlock();
  }

  /** One sim tick: its effects and the mover's state. */
  tick(fx: Fx, events: number, mover: MoverState, phase: number): void {
    this.director.tick(fx, events, mover, mover.gear, phase);
  }

  /** A new run started. */
  restart(): void {
    this.director.restart();
  }

  report(): SoundReport {
    const kinds: Record<string, number> = {};
    for (let k = 0; k < SND_COUNT; k++) kinds[SND_NAMES[k]] = this.director.byKind[k];
    return {
      state: this.ctx ? this.ctx.state : 'none',
      muted: this.director.muted,
      notes: this.director.notes,
      effects: this.director.effects,
      kinds,
    };
  }

  /** Inside a gesture: make the context if there is none, and wake it. */
  private unlock(): void {
    if (this.director.muted || this.failed || this.paused || document.visibilityState === 'hidden') return;
    if (this.ctx === null) {
      if (!gestureActive()) return;
      const Ctor = contextCtor();
      if (Ctor === null) {
        this.failed = true;
        return;
      }
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.synth = new Synth(this.ctx, this.vol);
      } catch (_err) {
        this.failed = true;
        this.ctx = null;
        this.synth = null;
        return;
      }
      this.director.attach(this.synth);
      this.timer = window.setInterval(() => this.pump(), PUMP_MS);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
  }

  private pump(): void {
    if (this.ctx !== null && this.ctx.state === 'running') this.director.pump();
  }

  private sleep(): void {
    if (this.ctx !== null && this.ctx.state === 'running') this.ctx.suspend().catch(() => undefined);
  }

  private onVisibility(): void {
    if (document.visibilityState === 'hidden') this.sleep();
    else if (this.ctx !== null && !this.director.muted && !this.paused && this.ctx.state !== 'running') this.ctx.resume().catch(() => undefined);
  }

  /** For tests and teardown: stop the pump and close the context. */
  dispose(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.ctx?.close().catch(() => undefined);
  }
}

export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
}
