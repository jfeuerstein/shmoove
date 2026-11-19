/**
 * The run recorder: what a playtest measures. Fed once per sim step (`afterStep`) and once per
 * drawn frame (`frame`), it keeps counters in fixed typed arrays and turns them into a plain
 * `RunReport` when asked. Nothing here touches the DOM or the clock; the app gives it the device
 * facts (`meta`) and the start time.
 *
 * `afterStep` and `frame` allocate nothing: they read the sim, bump numbers in arrays made once in
 * the constructor, and run index loops. `report` and the text helpers allocate freely; they run
 * when a run ends or a button is pressed.
 *
 * What is left out because it cannot be read from outside the sim: the look in use (no such
 * setting exists yet).
 */
import { MAX_LEVEL, PASSIVE_COUNT, PASSIVE_INFO, WEAPON_COUNT, WEAPON_INFO } from '../sim/arsenal';
import { BOON_INFO, CARD_BOON, CARD_PASSIVE, CARD_WEAPON, OFFER_SIZE } from '../sim/offer';
import type { Sim } from '../sim/sim';
import { EV_CLEAN_HOP, EV_HOP } from '../sim/types';
import {
  FX_CARD,
  FX_THING,
  HURT_COUNT,
  HURT_LOB,
  HURT_OTHER,
  HURT_RING,
  KINDS,
  PHASE_CHOOSE,
  PHASE_DEAD,
  PHASE_WON,
  SRC_COUNT,
  SRC_OTHER,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
} from '../sim/world';

export const REPORT_VERSION = 1;

/** Whole minutes of health and horde samples kept. */
export const MAX_MINUTES = 30;
/** Cards, and offers, kept per run. */
export const MAX_CARDS = 64;
export const MAX_BOSSES = 8;
export const LESSON_STEPS = 7;
/** The frame-time histogram: bins this wide (ms), this many, the last holding everything slower. */
export const BIN_MS = 0.5;
export const BINS = 400;
/** Under this share of health counts as low. */
export const LOW_HEALTH = 0.3;
/** Slower than this (m/s) counts as standing still. */
export const STILL_SPEED = 1;
/** Frame times over these are counted. */
export const SLOW_FRAME_MS = 33;
export const SLOWER_FRAME_MS = 50;
/** A crowd over this many is "a big horde" for the frame average. */
export const BIG_HORDE = 200;

const TPS = 60;
const MINUTE_TICKS = 60 * TPS;

export type Outcome = 'running' | 'dead' | 'won' | 'abandoned';

/** Where a card came from, by the offer's source. */
export const CARD_FROM: readonly string[] = ['level', 'crate', 'totem', 'shrine', 'boss'];

export interface CardTaken {
  /** Run time it was taken, s. */
  at: number;
  /** level, crate, totem, shrine or boss. */
  from: string;
  /** weapon, passive or boon. */
  type: string;
  /** What it was, by name; `?` if it could not be told. */
  name: string;
  /** Levels it gave (1 for a boon). */
  by: number;
}

export interface NamedLevel {
  name: string;
  level: number;
}

export interface DamageShare {
  /** A weapon's name, or `other`. */
  source: string;
  dealt: number;
  /** Share of all damage dealt, 0..1. */
  share: number;
}

export interface Cause {
  /** An enemy kind's name, `lob`, `ring` or `other`. */
  cause: string;
  hits: number;
  damage: number;
}

export interface BossRecord {
  name: string;
  /** Run time it arrived, s. */
  arrived: number;
  /** How long it was up, s. */
  lived: number;
  /** Times the player was hit while it was up (by anything). */
  hitsWhileUp: number;
  fell: boolean;
}

export interface RunReport {
  v: number;
  /** When the run began, ms since the epoch: also the key the kept list is filed under. */
  id: number;
  outcome: Outcome;
  /** Run time, s. */
  seconds: number;
  level: number;
  kills: number;
  seed: number;
  scheme: string;
  build: {
    /** Every card taken, in order. */
    cards: CardTaken[];
    weapons: NamedLevel[];
    passives: NamedLevel[];
  };
  damage: {
    total: number;
    bySource: DamageShare[];
  };
  taken: {
    hits: number;
    damage: number;
    byCause: Cause[];
    /** Health at the end of minute 1, 2, ... */
    hpAtMinute: number[];
    lowestHp: number;
    /** Lowest health as a share of the maximum, 0..1. */
    lowestShare: number;
    /** Seconds under 30% health. */
    secondsLow: number;
  };
  movement: {
    distance: number;
    avgSpeed: number;
    topSpeed: number;
    /** Share of run time in gear 1 to 5. */
    gearShare: number[];
    airSeconds: number;
    ollies: number;
    cleanOllies: number;
    longestChain: number;
    railMetres: number;
    railSeconds: number;
    padsHit: number;
    /** Seconds under 1 m/s. */
    stillSeconds: number;
    /** Share of run time the thumb was carving. */
    holdingShare: number;
  };
  map: {
    cratesOpened: number;
    shrinesFinished: number;
    slalomsFinished: number;
    gatesTaken: number;
    hoopsTaken: number;
    totemsCalled: number;
    tokens: number;
  };
  bosses: BossRecord[];
  horde: {
    /** Enemies alive at the end of minute 1, 2, ... */
    atMinute: number[];
    peak: number;
  };
  cards: {
    /** Real seconds spent with cards on the table. */
    choosingSeconds: number;
    perOffer: number[];
  };
  frames: {
    count: number;
    avgMs: number;
    p95Ms: number;
    p99Ms: number;
    over33: number;
    over50: number;
    /** Average frame time while the horde was over 200; null if it never was. */
    avgMsBigHorde: number | null;
  };
  device: {
    userAgent: string;
    screenW: number;
    screenH: number;
    dpr: number;
    standalone: boolean;
    /** The service worker's cache name, `dev` for a dev server, or `unknown` if unreachable. */
    build: string;
  };
  /** Seconds each lesson step took this session; null if the lesson did not run. */
  lesson: number[] | null;
}

/** What the app knows that the sim does not. Fill it in once; `startedAt` per run. */
export interface RunMeta {
  startedAt: number;
  scheme: string;
  userAgent: string;
  screenW: number;
  screenH: number;
  dpr: number;
  standalone: boolean;
  build: string;
}

export function makeMeta(): RunMeta {
  return { startedAt: 0, scheme: 'unknown', userAgent: 'unknown', screenW: 0, screenH: 0, dpr: 1, standalone: false, build: 'unknown' };
}

function round(v: number, places: number): number {
  const k = 10 ** places;
  return Math.round(v * k) / k;
}

export class RunLog {
  readonly meta: RunMeta = makeMeta();

  // The step.
  private lastTicks = 0;
  private lastDistance = 0;
  private lastPad = 0;
  private phase = 0;
  private hordeNow = 0;
  private activeTicks = 0;
  private speedSum = 0;
  private topSpeed = 0;
  private readonly gearTicks = new Float64Array(6);
  private airTicks = 0;
  private railTicks = 0;
  private railMetres = 0;
  private ollies = 0;
  private cleanOllies = 0;
  private longestChain = 0;
  private pads = 0;
  private stillTicks = 0;
  private holdTicks = 0;
  private lowTicks = 0;
  private lowestHp = Infinity;
  private lowestShare = 1;
  private peak = 0;
  private minutes = 0;
  private readonly hpMinute = new Float64Array(MAX_MINUTES);
  private readonly hordeMinute = new Float64Array(MAX_MINUTES);
  private gatesTaken = 0;
  private hoopsTaken = 0;

  // Cards.
  private cardCount = 0;
  private readonly cardAt = new Float64Array(MAX_CARDS);
  private readonly cardFrom = new Int8Array(MAX_CARDS);
  private readonly cardType = new Int8Array(MAX_CARDS);
  private readonly cardId = new Int16Array(MAX_CARDS);
  private readonly cardBy = new Uint8Array(MAX_CARDS);
  private readonly weaponSeen = new Uint8Array(WEAPON_COUNT);
  private readonly passiveSeen = new Uint8Array(PASSIVE_COUNT);
  /** The open offer as last seen, so the card taken can be named even after the offer closes. */
  private seenOpen = false;
  private seenSource = 0;
  private readonly seenType = new Uint8Array(OFFER_SIZE);
  private seenCount = 0;
  private pickIndex = -1;
  private offers = 0;
  private choosing = 0;
  private readonly offerSeconds = new Float64Array(MAX_CARDS);

  // Bosses.
  private bossCount = 0;
  private bossUp = false;
  private bossFelled0 = 0;
  private bossHits0 = 0;
  private readonly bossKind = new Int8Array(MAX_BOSSES);
  private readonly bossIn = new Float64Array(MAX_BOSSES);
  private readonly bossOut = new Float64Array(MAX_BOSSES);
  private readonly bossHits = new Float64Array(MAX_BOSSES);
  private readonly bossFell = new Uint8Array(MAX_BOSSES);

  // Frames.
  private frames = 0;
  private frameSum = 0;
  private frameMax = 0;
  private over33 = 0;
  private over50 = 0;
  private bigSum = 0;
  private bigCount = 0;
  private readonly hist = new Uint32Array(BINS + 1);

  // The lesson: the session's, not the run's.
  private readonly lessonTicks = new Float64Array(LESSON_STEPS);

  /** Forget the run and start another. `startedAt`: ms since the epoch. */
  reset(startedAt: number): void {
    this.meta.startedAt = startedAt;
    this.lastTicks = 0;
    this.lastDistance = 0;
    this.lastPad = 0;
    this.phase = 0;
    this.hordeNow = 0;
    this.activeTicks = 0;
    this.speedSum = 0;
    this.topSpeed = 0;
    this.gearTicks.fill(0);
    this.airTicks = 0;
    this.railTicks = 0;
    this.railMetres = 0;
    this.ollies = 0;
    this.cleanOllies = 0;
    this.longestChain = 0;
    this.pads = 0;
    this.stillTicks = 0;
    this.holdTicks = 0;
    this.lowTicks = 0;
    this.lowestHp = Infinity;
    this.lowestShare = 1;
    this.peak = 0;
    this.minutes = 0;
    this.hpMinute.fill(0);
    this.hordeMinute.fill(0);
    this.gatesTaken = 0;
    this.hoopsTaken = 0;
    this.cardCount = 0;
    this.weaponSeen.fill(0);
    this.passiveSeen.fill(0);
    this.seenOpen = false;
    this.seenCount = 0;
    this.pickIndex = -1;
    this.offers = 0;
    this.choosing = 0;
    this.offerSeconds.fill(0);
    this.bossCount = 0;
    this.bossUp = false;
    this.frames = 0;
    this.frameSum = 0;
    this.frameMax = 0;
    this.over33 = 0;
    this.over50 = 0;
    this.bigSum = 0;
    this.bigCount = 0;
    this.hist.fill(0);
  }

  /** The player chose card `index` of the open offer (so a boon card can be named). */
  notePick(index: number): void {
    this.pickIndex = index;
  }

  /** One tick of the lesson is on step `step` (0-based). */
  lessonTick(step: number): void {
    if (step >= 0 && step < LESSON_STEPS) this.lessonTicks[step]++;
  }

  /** Call after every `sim.step`. `holding`: the thumb was carving on that tick. */
  afterStep(sim: Sim, holding: boolean): void {
    const w = sim.world;
    const s = sim.state;
    const m = s.mover;
    const p = w.player;
    const ticks = w.run.ticks;
    const phase = w.run.phase;
    const fx = w.fx;
    const loadout = p.loadout;

    // Cards and map things first: they read the fx queue and the offer this step ended with.
    for (let i = 0; i < fx.count; i++) {
      const type = fx.type[i];
      if (type === FX_CARD) this.takeCard(w, fx.a[i], ticks);
      else if (type === FX_THING) {
        const kind = fx.a[i];
        if (kind === THING_GATE) this.gatesTaken++;
        else if (kind === THING_HOOP) this.hoopsTaken++;
      }
    }
    for (let i = 0; i < WEAPON_COUNT; i++) this.weaponSeen[i] = loadout.weaponLevel[i];
    for (let i = 0; i < PASSIVE_COUNT; i++) this.passiveSeen[i] = loadout.passiveLevel[i];
    const o = w.offer;
    if (o.open) {
      this.seenOpen = true;
      this.seenSource = o.source;
      this.seenCount = o.count;
      for (let i = 0; i < o.count; i++) this.seenType[i] = o.type[i];
      if (this.phase !== PHASE_CHOOSE && phase === PHASE_CHOOSE) this.offers++;
    } else {
      this.seenOpen = false;
    }
    this.phase = phase;
    this.hordeNow = w.horde.count;

    // Bosses. One falling can bring the next on the same tick, so a fall is read from the count.
    if (this.bossUp && w.boss.felled > this.bossFelled0) this.closeBoss(w, ticks);
    const up = w.boss.kind >= 0;
    if (up && !this.bossUp) {
      this.bossUp = true;
      this.bossFelled0 = w.boss.felled;
      this.bossHits0 = this.hitCount(w);
      if (this.bossCount < MAX_BOSSES) {
        const b = this.bossCount++;
        this.bossKind[b] = w.boss.kind;
        this.bossIn[b] = ticks;
        this.bossOut[b] = -1;
        this.bossHits[b] = 0;
        this.bossFell[b] = 0;
      }
    } else if (!up && this.bossUp) this.closeBoss(w, ticks);

    const dist = s.distance;
    const pad = m.padCooldown;
    if (ticks > this.lastTicks) {
      this.activeTicks++;
      this.speedSum += m.speed;
      if (m.speed > this.topSpeed) this.topSpeed = m.speed;
      this.gearTicks[m.gear]++;
      if (m.rail >= 0) {
        this.railTicks++;
        this.railMetres += dist - this.lastDistance;
      } else if (!m.grounded) this.airTicks++;
      if ((s.events & EV_HOP) !== 0) this.ollies++;
      if ((s.events & EV_CLEAN_HOP) !== 0) this.cleanOllies++;
      if (m.chain > this.longestChain) this.longestChain = m.chain;
      if (pad > this.lastPad) this.pads++;
      if (m.speed < STILL_SPEED) this.stillTicks++;
      if (holding) this.holdTicks++;
      if (p.hp < this.lowestHp) this.lowestHp = p.hp;
      const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
      if (share < this.lowestShare) this.lowestShare = share;
      if (share < LOW_HEALTH) this.lowTicks++;
      if (w.horde.count > this.peak) this.peak = w.horde.count;
      if (ticks % MINUTE_TICKS === 0 && this.minutes < MAX_MINUTES) {
        this.hpMinute[this.minutes] = p.hp;
        this.hordeMinute[this.minutes] = w.horde.count;
        this.minutes++;
      }
    }
    this.lastTicks = ticks;
    this.lastDistance = dist;
    this.lastPad = pad;
  }

  /** Call once per drawn frame with its length in ms. Paused time is not a frame: do not call. */
  frame(ms: number): void {
    if (!(ms >= 0) || ms === Infinity) return;
    this.frames++;
    this.frameSum += ms;
    if (ms > this.frameMax) this.frameMax = ms;
    if (ms > SLOW_FRAME_MS) this.over33++;
    if (ms > SLOWER_FRAME_MS) this.over50++;
    let bin = Math.floor(ms / BIN_MS);
    if (bin > BINS) bin = BINS;
    this.hist[bin]++;
    if (this.hordeNow > BIG_HORDE) {
      this.bigSum += ms;
      this.bigCount++;
    }
    if (this.phase === PHASE_CHOOSE) {
      const sec = ms / 1000;
      this.choosing += sec;
      const k = this.offers - 1;
      if (k >= 0 && k < MAX_CARDS) this.offerSeconds[k] += sec;
    }
  }

  /** The card the sim just took: what it was, from the level changes and the offer last seen. */
  private takeCard(w: Sim['world'], fxType: number, ticks: number): void {
    const loadout = w.player.loadout;
    let id = -1;
    let by = 1;
    if (fxType === CARD_WEAPON) {
      for (let i = 0; i < WEAPON_COUNT; i++) {
        const d = loadout.weaponLevel[i] - this.weaponSeen[i];
        if (d > 0) {
          id = i;
          by = d;
          this.weaponSeen[i] = loadout.weaponLevel[i];
          break;
        }
      }
    } else if (fxType === CARD_PASSIVE) {
      for (let i = 0; i < PASSIVE_COUNT; i++) {
        const d = loadout.passiveLevel[i] - this.passiveSeen[i];
        if (d > 0) {
          id = i;
          by = d;
          this.passiveSeen[i] = loadout.passiveLevel[i];
          break;
        }
      }
    } else if (fxType === CARD_BOON) {
      const o = w.offer;
      // The one the player chose if we saw it; else the first boon on the table.
      if (this.seenOpen && this.pickIndex >= 0 && this.pickIndex < this.seenCount && this.seenType[this.pickIndex] === CARD_BOON && this.pickIndex < o.count) {
        id = o.id[this.pickIndex];
      } else {
        for (let i = 0; i < o.count; i++) {
          if (o.type[i] === CARD_BOON) {
            id = o.id[i];
            break;
          }
        }
      }
    }
    this.pickIndex = -1;
    // The offer's arrays survive being answered; a queued offer opening in the same step is the
    // only thing that can overwrite them, and then the copy taken a step ago is the right one.
    const from = this.seenOpen ? this.seenSource : w.offer.source;
    // A card taken while another waits behind it: the next offer is already on the table.
    if (w.run.phase === PHASE_CHOOSE) this.offers++;
    if (this.cardCount < MAX_CARDS) {
      const c = this.cardCount++;
      this.cardAt[c] = ticks / TPS;
      this.cardFrom[c] = from;
      this.cardType[c] = fxType;
      this.cardId[c] = id;
      this.cardBy[c] = by;
    }
  }

  /** The boss on the field is gone (felled, or the run ended under it): note when and how it went. */
  private closeBoss(w: Sim['world'], ticks: number): void {
    this.bossUp = false;
    const b = this.bossCount - 1;
    if (b < 0 || b >= MAX_BOSSES || this.bossOut[b] >= 0) return;
    this.bossOut[b] = ticks;
    this.bossHits[b] = this.hitCount(w) - this.bossHits0;
    this.bossFell[b] = w.boss.felled > this.bossFelled0 ? 1 : 0;
  }

  private hitCount(w: Sim['world']): number {
    let n = 0;
    const hits = w.tally.hits;
    for (let i = 0; i < HURT_COUNT; i++) n += hits[i];
    return n;
  }

  /** Percentile `q` (0..1) of frame times, ms; read from the histogram's bin middles. */
  percentile(q: number): number {
    if (this.frames === 0) return 0;
    const target = Math.max(1, Math.ceil(q * this.frames));
    let seen = 0;
    for (let i = 0; i < BINS; i++) {
      seen += this.hist[i];
      if (seen >= target) return (i + 0.5) * BIN_MS;
    }
    return this.frameMax;
  }

  /**
   * The report, as the run stands. `outcome`: left out, it follows the run's phase (`running`,
   * `dead` or `won`); pass `abandoned` for a run restarted or left.
   */
  report(sim: Sim, outcome?: Outcome): RunReport {
    const w = sim.world;
    const s = sim.state;
    const p = w.player;
    const phase = w.run.phase;
    const out: Outcome = outcome ?? (phase === PHASE_DEAD ? 'dead' : phase === PHASE_WON ? 'won' : 'running');
    const seconds = w.run.ticks / TPS;
    const active = Math.max(1, this.activeTicks);

    const cards: CardTaken[] = [];
    for (let i = 0; i < this.cardCount; i++) {
      const type = this.cardType[i];
      const id = this.cardId[i];
      let name = '?';
      if (id >= 0) {
        if (type === CARD_WEAPON) name = WEAPON_INFO[id].name;
        else if (type === CARD_PASSIVE) name = PASSIVE_INFO[id].name;
        else if (type === CARD_BOON) name = BOON_INFO[id].name;
      }
      cards.push({
        at: round(this.cardAt[i], 1),
        from: CARD_FROM[this.cardFrom[i]] ?? '?',
        type: type === CARD_WEAPON ? 'weapon' : type === CARD_PASSIVE ? 'passive' : 'boon',
        name,
        by: this.cardBy[i],
      });
    }
    const l = p.loadout;
    const weapons: NamedLevel[] = [];
    for (let i = 0; i < WEAPON_COUNT; i++) if (l.weaponLevel[i] > 0) weapons.push({ name: WEAPON_INFO[i].name, level: Math.min(MAX_LEVEL, l.weaponLevel[i]) });
    const passives: NamedLevel[] = [];
    for (let i = 0; i < PASSIVE_COUNT; i++) if (l.passiveLevel[i] > 0) passives.push({ name: PASSIVE_INFO[i].name, level: Math.min(MAX_LEVEL, l.passiveLevel[i]) });

    let total = 0;
    for (let i = 0; i < SRC_COUNT; i++) total += w.tally.dealt[i];
    const bySource: DamageShare[] = [];
    for (let i = 0; i < SRC_COUNT; i++) {
      const d = w.tally.dealt[i];
      if (d <= 0) continue;
      bySource.push({ source: i === SRC_OTHER ? 'other' : WEAPON_INFO[i].name, dealt: round(d, 1), share: total > 0 ? d / total : 0 });
    }
    bySource.sort((a, b) => b.dealt - a.dealt);

    let hits = 0;
    let hurt = 0;
    const byCause: Cause[] = [];
    for (let i = 0; i < HURT_COUNT; i++) {
      const n = w.tally.hits[i];
      const d = w.tally.hurt[i];
      hits += n;
      hurt += d;
      if (n === 0 && d === 0) continue;
      const cause = i < KINDS.length ? KINDS[i].name : i === HURT_LOB ? 'lob' : i === HURT_RING ? 'ring' : i === HURT_OTHER ? 'other' : '?';
      byCause.push({ cause, hits: n, damage: round(d, 1) });
    }
    byCause.sort((a, b) => b.damage - a.damage);

    const hpAtMinute: number[] = [];
    const hordeAtMinute: number[] = [];
    for (let i = 0; i < this.minutes; i++) {
      hpAtMinute.push(round(this.hpMinute[i], 1));
      hordeAtMinute.push(this.hordeMinute[i]);
    }

    const gearShare: number[] = [];
    for (let g = 1; g <= 5; g++) gearShare.push(this.gearTicks[g] / active);

    const t = w.things;
    let crates = 0;
    let shrines = 0;
    let slaloms = 0;
    let totems = 0;
    for (let i = 0; i < t.count; i++) {
      if (t.state[i] !== THING_DONE) continue;
      const kind = t.kind[i];
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) crates++;
      else if (kind === THING_SHRINE) shrines++;
      else if (kind === THING_TOTEM) totems++;
      else if (kind === THING_GATE && (i === 0 || t.kind[i - 1] !== THING_GATE || t.group[i - 1] !== t.group[i])) slaloms++;
    }

    const bosses: BossRecord[] = [];
    for (let b = 0; b < this.bossCount; b++) {
      const open = this.bossOut[b] < 0;
      const outTicks = open ? w.run.ticks : this.bossOut[b];
      bosses.push({
        name: KINDS[this.bossKind[b]]?.name ?? '?',
        arrived: round(this.bossIn[b] / TPS, 1),
        lived: round((outTicks - this.bossIn[b]) / TPS, 1),
        hitsWhileUp: open ? this.hitCount(w) - this.bossHits0 : this.bossHits[b],
        fell: open ? w.boss.felled > this.bossFelled0 && b === this.bossCount - 1 : this.bossFell[b] === 1,
      });
    }

    const perOffer: number[] = [];
    for (let i = 0; i < Math.min(this.offers, MAX_CARDS); i++) perOffer.push(round(this.offerSeconds[i], 1));

    let lesson: number[] | null = null;
    for (let i = 0; i < LESSON_STEPS; i++) {
      if (this.lessonTicks[i] > 0) {
        lesson = [];
        for (let k = 0; k < LESSON_STEPS; k++) lesson.push(round(this.lessonTicks[k] / TPS, 1));
        break;
      }
    }

    const meta = this.meta;
    return {
      v: REPORT_VERSION,
      id: meta.startedAt,
      outcome: out,
      seconds: round(seconds, 2),
      level: p.level,
      kills: p.kills,
      seed: w.seed,
      scheme: meta.scheme,
      build: { cards, weapons, passives },
      damage: { total: round(total, 1), bySource },
      taken: {
        hits,
        damage: round(hurt, 1),
        byCause,
        hpAtMinute,
        lowestHp: this.lowestHp === Infinity ? round(p.hp, 1) : round(this.lowestHp, 1),
        lowestShare: round(this.lowestShare, 3),
        secondsLow: round(this.lowTicks / TPS, 1),
      },
      movement: {
        distance: round(s.distance, 1),
        avgSpeed: round(this.speedSum / active, 2),
        topSpeed: round(this.topSpeed, 2),
        gearShare,
        airSeconds: round(this.airTicks / TPS, 1),
        ollies: this.ollies,
        cleanOllies: this.cleanOllies,
        longestChain: this.longestChain,
        railMetres: round(this.railMetres, 1),
        railSeconds: round(this.railTicks / TPS, 1),
        padsHit: this.pads,
        stillSeconds: round(this.stillTicks / TPS, 1),
        holdingShare: this.holdTicks / active,
      },
      map: {
        cratesOpened: crates,
        shrinesFinished: shrines,
        slalomsFinished: slaloms,
        gatesTaken: this.gatesTaken,
        hoopsTaken: this.hoopsTaken,
        totemsCalled: totems,
        tokens: p.tokens,
      },
      bosses,
      horde: { atMinute: hordeAtMinute, peak: this.peak },
      cards: { choosingSeconds: round(this.choosing, 1), perOffer },
      frames: {
        count: this.frames,
        avgMs: this.frames > 0 ? round(this.frameSum / this.frames, 2) : 0,
        p95Ms: round(this.percentile(0.95), 2),
        p99Ms: round(this.percentile(0.99), 2),
        over33: this.over33,
        over50: this.over50,
        avgMsBigHorde: this.bigCount > 0 ? round(this.bigSum / this.bigCount, 2) : null,
      },
      device: {
        userAgent: meta.userAgent,
        screenW: meta.screenW,
        screenH: meta.screenH,
        dpr: meta.dpr,
        standalone: meta.standalone,
        build: meta.build,
      },
      lesson,
    };
  }
}

// ---- text: the end card's block, and the report as pasted -----------------------------------

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The short block on the end card. */
export function statsLines(r: RunReport): string[] {
  const top = r.damage.bySource[0];
  const worst = r.taken.byCause[0];
  return [
    `${clock(r.seconds)}  level ${r.level}  ${r.kills} kills`,
    top ? `Top weapon  ${top.source} ${pct(top.share)}` : 'Top weapon  none',
    worst ? `Hurt most by  ${worst.cause} (${worst.hits} ${worst.hits === 1 ? 'hit' : 'hits'}, ${Math.round(worst.damage)} damage)` : 'Hurt most by  nothing',
  ];
}

const OUTCOME_WORD: Record<Outcome, string> = { running: 'in progress', dead: 'died', won: 'cleared', abandoned: 'left early' };

/** The report as text: about 25 readable lines, a blank line, then the JSON on one line. */
export function reportText(r: RunReport): string {
  const list = <T>(a: readonly T[], f: (x: T) => string, none = 'none'): string => (a.length > 0 ? a.map(f).join(', ') : none);
  const m = r.movement;
  const f = r.frames;
  const lines: string[] = [
    `SHMOOVE run report v${r.v}`,
    `Outcome: ${OUTCOME_WORD[r.outcome]} at ${clock(r.seconds)}, level ${r.level}, ${r.kills} kills, seed ${r.seed}, scheme ${r.scheme}`,
    `Build: ${list(r.build.weapons, (x) => `${x.name} ${x.level}`)} | ${list(r.build.passives, (x) => `${x.name} ${x.level}`)}`,
    `Cards (${r.build.cards.length}): ${list(r.build.cards, (c) => `${clock(c.at)} ${c.name} (${c.from})`)}`,
    `Damage dealt (${Math.round(r.damage.total)}): ${list(r.damage.bySource, (d) => `${d.source} ${pct(d.share)}`)}`,
    `Hurt by (${r.taken.hits} hits, ${Math.round(r.taken.damage)} damage): ${list(r.taken.byCause, (c) => `${c.cause} ${c.hits}/${Math.round(c.damage)}`)}`,
    `Health: lowest ${Math.round(r.taken.lowestHp)} (${pct(r.taken.lowestShare)}), ${r.taken.secondsLow}s under 30%, by minute ${list(r.taken.hpAtMinute, (h) => String(Math.round(h)))}`,
    `Moved: ${Math.round(m.distance)} m, avg ${m.avgSpeed} / top ${m.topSpeed} m/s, still ${m.stillSeconds}s, thumb down ${pct(m.holdingShare)}`,
    `Gears 1-5: ${m.gearShare.map(pct).join(' ')}`,
    `Air ${m.airSeconds}s, ollies ${m.ollies} (${m.cleanOllies} clean, best chain ${m.longestChain}), pads ${m.padsHit}`,
    `Rails: ${m.railMetres} m, ${m.railSeconds}s`,
    `Map: ${r.map.cratesOpened} crates, ${r.map.shrinesFinished} shrines, ${r.map.slalomsFinished} slaloms (${r.map.gatesTaken} gates), ${r.map.hoopsTaken} hoops, ${r.map.totemsCalled} totems, ${r.map.tokens} tokens`,
    `Bosses: ${list(r.bosses, (b) => `${b.name} at ${clock(b.arrived)} lived ${b.lived}s, ${b.hitsWhileUp} hits taken, ${b.fell ? 'fell' : 'stood'}`)}`,
    `Horde: peak ${r.horde.peak}, by minute ${list(r.horde.atMinute, String)}`,
    `Choosing cards: ${r.cards.choosingSeconds}s total, per offer ${list(r.cards.perOffer, (x) => `${x}s`)}`,
    `Frames: ${f.count}, avg ${f.avgMs} ms, p95 ${f.p95Ms}, p99 ${f.p99Ms}, over 33 ms ${f.over33}, over 50 ms ${f.over50}, crowd over ${BIG_HORDE} avg ${f.avgMsBigHorde ?? 'n/a'}`,
    `Device: ${r.device.screenW}x${r.device.screenH} @${r.device.dpr}x, ${r.device.standalone ? 'installed' : 'in a browser'}, build ${r.device.build}`,
    `UA: ${r.device.userAgent}`,
    `Lesson steps (s): ${r.lesson ? r.lesson.join(' ') : 'not run'}`,
    '',
    JSON.stringify(r),
  ];
  return lines.join('\n');
}
