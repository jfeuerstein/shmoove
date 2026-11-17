/**
 * The mix rules (DESIGN section 8) as a pure state machine. No Web Audio, no DOM, no timers.
 *
 * Feed it the per-frame view, the sim events since the previous frame and the compiled lines; it
 * says which district track should play, the target gain of each stem and how fast to get there,
 * whether the full band is in, the levels of the always-on noise layer, and the one-shot cues the
 * events asked for. The engine turns that into sound; tests read it directly.
 */
import type { CompiledLine, RideKind } from '../sim/lines';
import { Mode, type SimEvent } from '../sim/types';
import { Surface } from '../sim/world';
import { barSeconds, beatSeconds, scaleNote, TRACKS } from './tracks/index';

/** Everything the audio needs to know about the frame. Mirrors AudioView in index.ts. */
export interface MixView {
  mode: number;
  speed: number;
  surface: number;
  chain: number;
  chainAlive: boolean;
  hitchedLine: number;
  district: number;
  dayFrac: number;
  nearRideDist: number;
  nearRideKind: string | null;
  paused: boolean;
}

export type MotorKind = 'rail' | 'engine' | 'hum';

export type Cue =
  | { type: 'hop' }
  | { type: 'land'; impact: number }
  | { type: 'boing'; speed: number }
  | { type: 'scuff'; size: number }
  | { type: 'thud'; size: number }
  | { type: 'release'; speed: number; note: number }
  | { type: 'denied' }
  | { type: 'bail' };

/** Bail cuts music this fast (s). The brief allows at most 0.06. */
export const BAIL_FADE = 0.04;
/** Pause ducks everything over this long (s). */
export const PAUSE_FADE = 0.15;
/** Ride motors are heard inside this radius (m). */
export const MOTOR_RANGE = 25;
/** Quick fade used when a stem is dropped by a fresh hitch on the same track (s). */
const RESET_FADE = 0.25;
/** Stem fade-in once it starts on its beat (s): short, just enough to avoid a click. */
export const STEM_ATTACK = 0.06;

export interface MixState {
  /** District index of the track that should play, or null before the first hitch. */
  track: number | null;
  /** Bumped every time the track is (re)selected by a switch; the engine cross-fades on change. */
  trackGen: number;
  /** Cross-fade length for the last track switch (one beat of the new track), s. */
  trackFade: number;
  /** Target gain per stem: perc, bass, harmony, lead. */
  stemTargets: [number, number, number, number];
  /** Fade length of each stem's last change, s (fade-ins start on the next beat). */
  stemFades: [number, number, number, number];
  /** Bumped whenever stemTargets or stemFades change. */
  stemRev: number;
  fullBand: boolean;
  /** False after a bail or a landed chain until the next hitch. */
  musicOn: boolean;
  /** 0 when paused, else 1, reached over masterFade. */
  master: number;
  masterFade: number;
  /** Transport holds while paused. */
  hold: boolean;

  // Noise layer.
  wheelLevel: number;
  /** Lowpass cutoff of the wheel noise, Hz. */
  wheelCutoff: number;
  /** Amplitude-modulation rate (Hz) and depth (0..0.5) for stairs clatter and tumbling. */
  clatterRate: number;
  clatterDepth: number;
  windLevel: number;
  /** Centre of the wind's band, Hz. */
  windFreq: number;
  motorLevel: number;
  motorKind: MotorKind | null;
  /** Base frequency of the motor, Hz. */
  motorPitch: number;
  grinding: boolean;
  /** Centre frequency of the grind scrape, Hz. */
  grindPitch: number;
  /** 0 (midnight) .. 1 (noon): brightness of the music bus. */
  daylight: number;

  /** One-shots asked for by this frame's events (cleared each update). */
  cues: Cue[];
}

export function makeMixState(): MixState {
  return {
    track: null,
    trackGen: 0,
    trackFade: 0,
    stemTargets: [0, 0, 0, 0],
    stemFades: [0, 0, 0, 0],
    stemRev: 0,
    fullBand: false,
    musicOn: false,
    master: 1,
    masterFade: PAUSE_FADE,
    hold: false,
    wheelLevel: 0,
    wheelCutoff: 300,
    clatterRate: 0,
    clatterDepth: 0,
    windLevel: 0,
    windFreq: 400,
    motorLevel: 0,
    motorKind: null,
    motorPitch: 50,
    grinding: false,
    grindPitch: 1500,
    daylight: 1,
    cues: [],
  };
}

const RAIL_KINDS: readonly string[] = ['tram', 'funicular', 'ghosttram', 'handcart'] satisfies RideKind[];
const HUM_KINDS: readonly string[] = ['cablecar', 'kite', 'blimp', 'crane'] satisfies RideKind[];

export function motorKindOf(kind: string | null): MotorKind | null {
  if (kind === null) return null;
  if (RAIL_KINDS.includes(kind)) return 'rail';
  if (HUM_KINDS.includes(kind)) return 'hum';
  return 'engine';
}

/** Wheel loudness for a speed on the ground, 0..1, strictly rising with speed. */
export function wheelLevelFor(speed: number): number {
  const v = Math.max(0, speed);
  return 1 - Math.exp(-v / 9);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class Mixer {
  readonly state: MixState = makeMixState();
  /** Bit per stem: stems in for the current track. */
  private stems = 0;

  /** Advance one frame. Returns the (reused) state. */
  update(view: MixView, events: readonly SimEvent[], lines: readonly CompiledLine[], _dt: number): MixState {
    const st = this.state;
    st.cues.length = 0;
    let bounced = false;

    for (const e of events) {
      switch (e.type) {
        case 'hitch':
          this.onHitch(e.line, e.chain, e.newLink, lines);
          break;
        case 'chainEnd':
          if (e.reason === 'land') this.fadeOutAll(this.twoBars());
          break;
        case 'bail':
          this.cutMusic();
          st.cues.push({ type: 'bail' });
          break;
        case 'release': {
          const tr = TRACKS[st.track ?? lines[e.line]?.district ?? 0] ?? TRACKS[0];
          st.cues.push({ type: 'release', speed: e.speed, note: scaleNote(tr, Math.max(1, e.chain)) });
          break;
        }
        case 'hop':
          st.cues.push({ type: 'hop' });
          break;
        case 'land':
          if (e.surface === Surface.AWNING) {
            if (!bounced) st.cues.push({ type: 'boing', speed: e.impact });
            bounced = true;
          } else st.cues.push({ type: 'land', impact: e.impact });
          break;
        case 'bounce':
          if (!bounced) st.cues.push({ type: 'boing', speed: Math.abs(e.speed) });
          bounced = true;
          break;
        case 'grindStart':
          st.grinding = true;
          break;
        case 'grindEnd':
          st.grinding = false;
          break;
        case 'wallStart':
          st.cues.push({ type: 'scuff', size: 0.8 });
          break;
        case 'wallEnd':
          st.cues.push({ type: 'scuff', size: 0.5 });
          break;
        case 'wallHit':
          st.cues.push({ type: 'thud', size: clamp01(e.speed / 12) });
          break;
        case 'kickturn':
          st.cues.push({ type: 'scuff', size: 0.25 });
          break;
        case 'denied':
          st.cues.push({ type: 'denied' });
          break;
        case 'recover':
          break;
      }
    }

    // A chain that lapsed without us seeing its end (events dropped while inert, say) still lets
    // the music go: nothing hitched, no chain, stems still in -> fade as for a landing.
    if (this.stems !== 0 && view.mode !== Mode.HITCH && view.chain === 0 && !view.chainAlive) {
      this.fadeOutAll(this.twoBars());
    }
    if (view.mode !== Mode.GRIND) st.grinding = false;

    // Pause ducks everything; the transport holds.
    st.master = view.paused ? 0 : 1;
    st.masterFade = PAUSE_FADE;
    st.hold = view.paused;

    this.noiseLayer(view);
    return st;
  }

  private twoBars(): number {
    return barSeconds(TRACKS[this.state.track ?? 0].bpm) * 2;
  }

  private onHitch(lineIndex: number, chain: number, newLink: boolean, lines: readonly CompiledLine[]): void {
    const line = lines[lineIndex];
    if (!line) return;
    const st = this.state;
    const district = line.district;
    const stem = line.stem & 3;
    const tr = TRACKS[district];
    if (!tr) return;
    const prev = this.stems;
    let reset = false;
    if (st.track !== district) {
      // Switch track: cross-fade over one beat of the new track, stem set starts again.
      st.track = district;
      st.trackGen++;
      st.trackFade = beatSeconds(tr.bpm);
      this.stems = 1 << stem;
      reset = true;
    } else if (chain <= 1 && newLink) {
      // A fresh first link: exactly this line's stem.
      this.stems = 1 << stem;
    } else {
      this.stems |= 1 << stem;
    }
    st.fullBand = chain >= 3;
    if (st.fullBand) this.stems = 15;
    st.musicOn = true;
    this.applyStems(prev, reset);
  }

  private applyStems(prev: number, reset: boolean): void {
    const st = this.state;
    let changed = false;
    for (let s = 0; s < 4; s++) {
      const on = (this.stems >> s) & 1;
      const was = (prev >> s) & 1;
      const target = on ? 1 : 0;
      if (st.stemTargets[s] !== target || reset) {
        st.stemTargets[s] = target;
        st.stemFades[s] = on ? STEM_ATTACK : was && !reset ? RESET_FADE : st.trackFade;
        changed = true;
      }
    }
    if (changed) st.stemRev++;
  }

  private fadeOutAll(fade: number): void {
    const st = this.state;
    if (this.stems === 0 && st.stemTargets.every((g) => g === 0)) return;
    this.stems = 0;
    st.fullBand = false;
    st.musicOn = false;
    for (let s = 0; s < 4; s++) {
      if (st.stemTargets[s] !== 0) {
        st.stemTargets[s] = 0;
        st.stemFades[s] = fade;
      }
    }
    st.stemRev++;
  }

  private cutMusic(): void {
    const st = this.state;
    this.stems = 0;
    st.fullBand = false;
    st.musicOn = false;
    for (let s = 0; s < 4; s++) {
      st.stemTargets[s] = 0;
      st.stemFades[s] = BAIL_FADE;
    }
    st.stemRev++;
  }

  private noiseLayer(v: MixView): void {
    const st = this.state;
    const speed = Math.max(0, v.speed);
    const onGround = v.surface >= 0 && v.mode !== Mode.AIR && v.mode !== Mode.GRIND;
    const lvl = onGround ? wheelLevelFor(speed) : 0;
    let cutoff = 250 + 5200 * lvl;
    let depth = 0;
    let rate = 0;
    let level = lvl;
    if (onGround) {
      switch (v.surface) {
        case Surface.STAIRS:
          // Each step edge is a knock: ~0.3 m treads.
          rate = Math.min(28, speed / 0.3);
          depth = speed > 0.3 ? 0.45 : 0;
          break;
        case Surface.GRASS:
          cutoff *= 0.25;
          level *= 0.6;
          break;
        case Surface.DIRT:
          cutoff *= 0.4;
          level *= 0.85;
          break;
        case Surface.TRACK:
          cutoff *= 1.15;
          break;
        case Surface.WATER:
          cutoff *= 0.3;
          break;
        default:
          break;
      }
    }
    if (v.mode === Mode.BAIL && v.surface >= 0) {
      // Tumbling: a lumpy roll rather than a clean glide.
      rate = 7;
      depth = 0.4;
      level = Math.max(level, 0.35);
    }
    st.wheelLevel = clamp01(level);
    st.wheelCutoff = cutoff;
    st.clatterRate = rate;
    st.clatterDepth = depth;

    const fast = clamp01(speed / 22);
    const inAir = v.surface < 0 || v.mode === Mode.AIR;
    let wind = inAir ? 0.15 + 0.85 * fast : 0.12 * fast;
    if (v.district === 3) wind = Math.max(wind, 0.18);
    st.windLevel = clamp01(wind);
    st.windFreq = 250 + 1100 * fast;

    const kind = motorKindOf(v.nearRideKind);
    if (kind !== null && Number.isFinite(v.nearRideDist) && v.nearRideDist < MOTOR_RANGE) {
      const k = 1 - Math.max(0, v.nearRideDist) / MOTOR_RANGE;
      st.motorLevel = k * k;
      st.motorKind = kind;
      st.motorPitch = kind === 'rail' ? 46 : kind === 'hum' ? 118 : v.nearRideKind === 'moped' ? 92 : 52;
    } else {
      st.motorLevel = 0;
    }

    st.grindPitch = 900 + 110 * Math.min(speed, 30);
    // Daylight: 1 through the day, easing to 0 across dusk and back up through dawn.
    const f = ((v.dayFrac % 1) + 1) % 1;
    st.daylight = f < 0.22 || f >= 0.8 ? 0 : f < 0.3 ? (f - 0.22) / 0.08 : f < 0.72 ? 1 : 1 - (f - 0.72) / 0.08;
  }
}
