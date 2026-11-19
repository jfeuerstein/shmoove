/**
 * Which sounds a tick makes. Pure: given the tick's effects (`w.fx`), the mover's events and state
 * and the run's phase, it writes the sounds to play (kind, loudness, pitch) and the continuous
 * layers (board hum, grind hiss) into a reusable frame, or leaves a sound out because of a rate
 * limit. Called once per sim tick; it allocates nothing.
 *
 * Pitch is in semitones above each voice's own base note. Loudness is 0..1 before the effects bus.
 */
import {
  FX_ARC,
  FX_BLAST,
  FX_BUMP,
  FX_BONK,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_CARD,
  FX_ENEMY_DIE,
  FX_ENEMY_HIT,
  FX_HEAL,
  FX_LEVEL_UP,
  FX_PLAYER_HIT,
  FX_PLOW,
  FX_POP,
  FX_SHOT,
  FX_SLAM,
  FX_SPARK,
  FX_STONE,
  FX_THING,
  FX_TOKEN,
  PHASE_CHOOSE,
  PHASE_DEAD,
  PHASE_PLAY,
  PHASE_WON,
  type Fx,
} from '../sim/world';
import { EV_BOOST, EV_CLEAN_HOP, EV_GRIND_END, EV_GRIND_START, EV_HOP, EV_LAND } from '../sim/types';
import { pentatonic } from './music';

export const SND_HOP = 0;
export const SND_OLLIE = 1;
export const SND_LAND = 2;
export const SND_GRIND_ON = 3;
export const SND_GRIND_OFF = 4;
export const SND_BOOST = 5;
export const SND_HURT = 6;
export const SND_HIT = 7;
export const SND_DIE = 8;
export const SND_PLOW = 9;
export const SND_BONK = 10;
export const SND_SPARK = 11;
export const SND_LEVEL = 12;
export const SND_CARD = 13;
export const SND_SHOT = 14;
export const SND_STONE = 15;
export const SND_ARC = 16;
export const SND_SLAM = 17;
export const SND_BLAST = 18;
export const SND_POP = 19;
export const SND_THING = 20;
export const SND_TOKEN = 21;
export const SND_HEAL = 22;
export const SND_BOSS_IN = 23;
export const SND_BOSS_DOWN = 24;
export const SND_DEAD = 25;
export const SND_WON = 26;
export const SND_COUNT = 27;

export const SND_NAMES: readonly string[] = [
  'hop', 'ollie', 'land', 'grindOn', 'grindOff', 'boost', 'hurt', 'hit', 'die', 'plow', 'bonk',
  'spark', 'level', 'card', 'shot', 'stone', 'arc', 'slam', 'blast', 'pop', 'thing', 'token', 'heal',
  'bossIn', 'bossDown', 'dead', 'won',
];

/** How the run ended this tick, if it did. */
export const END_NONE = 0;
export const END_FALL = 1;
export const END_CADENCE = 2;

/** The parts of the mover the sounds read. */
export interface MoverSound {
  speed: number;
  grounded: boolean;
  rail: number;
  chain: number;
  impact: number;
}

export const SFX_CAPACITY = 32;

/** One tick's sounds, and the state of the continuous layers after it. Reused every tick. */
export interface SfxFrame {
  count: number;
  kind: Uint8Array;
  gain: Float32Array;
  pitch: Float32Array;
  /** Board hum: loudness 0..1 and frequency, Hz. 0 in the air. */
  hum: number;
  humFreq: number;
  /** A grind is under way. */
  grind: boolean;
  /** The player was hurt: the music drops out for a beat. */
  dropout: boolean;
  /** A card offer is open: the music ducks. */
  duck: boolean;
  /** A boss is on the field: the key drops. */
  boss: boolean;
  /** END_* this tick. */
  end: number;
  /** A new run began this tick (from an ended one, or by a restart). */
  restart: boolean;
}

export function makeSfxFrame(): SfxFrame {
  return {
    count: 0,
    kind: new Uint8Array(SFX_CAPACITY),
    gain: new Float32Array(SFX_CAPACITY),
    pitch: new Float32Array(SFX_CAPACITY),
    hum: 0,
    humFreq: 0,
    grind: false,
    dropout: false,
    duck: false,
    boss: false,
    end: END_NONE,
    restart: false,
  };
}

// ---- tuning ----------------------------------------------------------------------------------

/** Enemy-hit ticks: at most this many a second on average, with a burst of this many. */
export const HIT_RATE = 16;
export const HIT_BURST = 3;
/** Enemy-death crunches: the same, a little rarer. */
export const DIE_RATE = 11;
export const DIE_BURST = 3;
/** Plows and bonks share one budget. */
export const SHOVE_RATE = 8;
export const SHOVE_BURST = 2;
/** The fastest each weapon's voice can repeat, ticks. */
export const WEAPON_GAP: Readonly<Record<number, number>> = {
  [SND_SHOT]: 5,
  [SND_STONE]: 5,
  [SND_ARC]: 4,
  [SND_SLAM]: 8,
  [SND_BLAST]: 5,
  [SND_POP]: 8,
};
/** Weapons fire all the time: their voices sit low. */
export const WEAPON_GAIN: Readonly<Record<number, number>> = {
  [SND_SHOT]: 0.16,
  [SND_STONE]: 0.18,
  [SND_ARC]: 0.16,
  [SND_SLAM]: 0.26,
  [SND_BLAST]: 0.3,
  [SND_POP]: 0.3,
};
/** Sparks taken within this many ticks of the last keep the chime climbing. */
export const SPARK_WINDOW = 60;
/** The fastest the chime repeats, ticks. */
export const SPARK_GAP = 3;
/** The chime and the ollie climb at most this many steps of the pentatonic. */
export const SCALE_TOP = 12;
export const HIT_GAIN = 0.22;
export const DIE_GAIN = 0.4;
/** The board hum at full speed, and the speed that is full, m/s. */
export const HUM_GAIN = 0.32;
export const HUM_FULL_SPEED = 25;
export const HUM_BASE_HZ = 42;
export const HUM_HZ_PER_MS = 4.2;
/** A landing at this speed into the ground is as loud as a landing gets, m/s. */
export const LAND_FULL_IMPACT = 9;

/** Small pitch wobble for repeated ticks so a stream of them is not one machine-gun note. */
const WOBBLE: readonly number[] = [0, 1.5, -1, 2.5, 0.5, -2, 3, -0.5];

/** A token bucket in ticks. */
class Bucket {
  private tokens: number;
  constructor(
    private readonly perTick: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  refill(): void {
    this.tokens = Math.min(this.burst, this.tokens + this.perTick);
  }
  take(): boolean {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  reset(): void {
    this.tokens = this.burst;
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class SfxMapper {
  /** Ticks this mapper has seen. */
  private tick = 0;
  private readonly hits = new Bucket(HIT_RATE / 60, HIT_BURST);
  private readonly dies = new Bucket(DIE_RATE / 60, DIE_BURST);
  private readonly shoves = new Bucket(SHOVE_RATE / 60, SHOVE_BURST);
  /** The tick each weapon voice last sounded, by SND_*. */
  private readonly lastWeapon = new Int32Array(SND_COUNT).fill(-1000);
  private hitTurn = 0;
  private sparkChain = 0;
  private lastSpark = -1000;
  private lastChime = -1000;
  private bosses = 0;
  private phase = PHASE_PLAY;

  /** Back to a fresh run. */
  reset(): void {
    this.hits.reset();
    this.dies.reset();
    this.shoves.reset();
    this.lastWeapon.fill(-1000);
    this.hitTurn = 0;
    this.sparkChain = 0;
    this.lastSpark = -1000;
    this.lastChime = -1000;
    this.bosses = 0;
    this.phase = PHASE_PLAY;
  }

  /** One tick: `fx` are the effects, `events` the mover's EV_* flags, `phase` the run's. */
  map(fx: Fx, events: number, m: MoverSound, phase: number, out: SfxFrame): void {
    const t = ++this.tick;
    out.count = 0;
    out.dropout = false;
    out.end = END_NONE;
    out.restart = false;
    this.hits.refill();
    this.dies.refill();
    this.shoves.refill();

    const was = this.phase;
    this.phase = phase;
    const ended = (phase === PHASE_DEAD || phase === PHASE_WON) && phase !== was;
    if ((was === PHASE_DEAD || was === PHASE_WON) && (phase === PHASE_PLAY || phase === PHASE_CHOOSE)) {
      out.restart = true;
      this.bosses = 0;
      this.sparkChain = 0;
    }

    // The mover first: what the thumb did is never lost under the crowd.
    if ((events & EV_HOP) !== 0) {
      if ((events & EV_CLEAN_HOP) !== 0) push(out, SND_OLLIE, 0.55, pentatonic(Math.min(SCALE_TOP, Math.max(1, m.chain))));
      else push(out, SND_HOP, 0.5, 0);
    }
    if ((events & EV_LAND) !== 0) {
      const k = clamp01(m.impact / LAND_FULL_IMPACT);
      push(out, SND_LAND, 0.25 + 0.75 * k, -4 * k);
    }
    if ((events & EV_GRIND_START) !== 0) push(out, SND_GRIND_ON, 0.5, 0);
    if ((events & EV_GRIND_END) !== 0) push(out, SND_GRIND_OFF, 0.35, 0);
    if ((events & EV_BOOST) !== 0) push(out, SND_BOOST, 0.6, 0);

    let sparks = 0;
    for (let i = 0; i < fx.count; i++) {
      const type = fx.type[i];
      const a = fx.a[i];
      switch (type) {
        case FX_PLAYER_HIT:
          push(out, SND_HURT, 0.7 + 0.3 * clamp01(a / 40), 0);
          out.dropout = true;
          break;
        case FX_ENEMY_HIT:
          if (this.hits.take()) push(out, SND_HIT, HIT_GAIN, WOBBLE[this.hitTurn++ & 7]);
          break;
        case FX_ENEMY_DIE:
          if (this.dies.take()) push(out, SND_DIE, DIE_GAIN, -1.5 * a + WOBBLE[this.hitTurn++ & 7] * 0.5);
          break;
        case FX_PLOW:
          if (this.shoves.take()) push(out, SND_PLOW, 0.3, -a);
          break;
        case FX_BONK:
          if (this.shoves.take()) push(out, SND_BONK, 0.3, -a);
          break;
        case FX_SPARK:
          sparks++;
          break;
        case FX_LEVEL_UP:
          push(out, SND_LEVEL, 0.6, 0);
          break;
        case FX_CARD:
          push(out, SND_CARD, 0.55, 0);
          break;
        case FX_SHOT:
          this.weapon(out, SND_SHOT, t, 0);
          break;
        case FX_STONE:
          this.weapon(out, SND_STONE, t, 0);
          break;
        case FX_ARC:
          // One zap per chain, from its first link.
          if (a === 0) this.weapon(out, SND_ARC, t, 0);
          break;
        case FX_SLAM:
          this.weapon(out, SND_SLAM, t, 0);
          break;
        case FX_BUMP:
          // The same kind of thing as the Slam, so the same thump.
          this.weapon(out, SND_SLAM, t, 0);
          break;
        case FX_BLAST:
          this.weapon(out, SND_BLAST, t, 0);
          break;
        case FX_POP:
          this.weapon(out, SND_POP, t, 0);
          break;
        case FX_THING:
          push(out, SND_THING, 0.5, 0);
          break;
        case FX_TOKEN:
          push(out, SND_TOKEN, 0.4, 0);
          break;
        case FX_HEAL:
          push(out, SND_HEAL, 0.3 + 0.3 * clamp01(a / 30), 0);
          break;
        case FX_BOSS_IN:
          push(out, SND_BOSS_IN, 0.85, 0);
          this.bosses++;
          break;
        case FX_BOSS_DOWN:
          push(out, SND_BOSS_DOWN, 0.85, 0);
          if (this.bosses > 0) this.bosses--;
          break;
        default:
          break;
      }
    }

    if (sparks > 0) {
      if (t - this.lastSpark > SPARK_WINDOW) this.sparkChain = 0;
      this.sparkChain += sparks;
      this.lastSpark = t;
      if (t - this.lastChime >= SPARK_GAP) {
        this.lastChime = t;
        push(out, SND_SPARK, 0.32, pentatonic(Math.min(SCALE_TOP, this.sparkChain - 1)));
      }
    }

    if (ended) {
      out.end = phase === PHASE_DEAD ? END_FALL : END_CADENCE;
      push(out, phase === PHASE_DEAD ? SND_DEAD : SND_WON, 0.8, 0);
      this.bosses = 0;
    }

    const live = phase === PHASE_PLAY;
    const rolling = live && m.grounded && m.rail < 0;
    const k = clamp01(m.speed / HUM_FULL_SPEED);
    out.hum = rolling ? HUM_GAIN * Math.sqrt(k) : 0;
    out.humFreq = HUM_BASE_HZ + HUM_HZ_PER_MS * Math.max(0, m.speed);
    out.grind = live && m.rail >= 0;
    out.duck = phase === PHASE_CHOOSE;
    out.boss = this.bosses > 0;
  }

  private weapon(out: SfxFrame, kind: number, t: number, pitch: number): void {
    if (t - this.lastWeapon[kind] < WEAPON_GAP[kind]) return;
    this.lastWeapon[kind] = t;
    push(out, kind, WEAPON_GAIN[kind], pitch);
  }
}

function push(out: SfxFrame, kind: number, gain: number, pitch: number): void {
  const i = out.count;
  if (i >= SFX_CAPACITY) return;
  out.kind[i] = kind;
  out.gain[i] = gain;
  out.pitch[i] = pitch;
  out.count = i + 1;
}
