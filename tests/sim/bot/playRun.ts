/**
 * Plays a bot through a whole run (until the final boss falls, it dies, or `maxSeconds` run out)
 * and records what the end card and a watcher would see: how it ended, health, kills, level, the
 * build, each boss's arrival and fall, every hit and what dealt it, the size of the horde, what was
 * used on the map, and a per-tick fingerprint for the determinism check.
 *
 * Lean on purpose: the balance harness plays dozens of these in one process, so nothing here
 * allocates per tick.
 */
import { MAX_LEVEL, PASSIVE_INFO, WEAPON_INFO } from '../../../src/sim/arsenal';
import type { Bowl } from '../../../src/sim/bowl';
import { TICK_HZ } from '../../../src/sim/constants';
import { HAZARDS } from '../../../src/sim/hazards';
import { hashSimState, Sim, type Picker } from '../../../src/sim/sim';
import { EV_GRIND_START, makeInputFrame } from '../../../src/sim/types';
import {
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_PLAYER_HIT,
  FX_THING,
  hashWorld,
  KIND_COUNT,
  KIND_MORTAR,
  KIND_STANDSTILL,
  KINDS,
  PHASE_DEAD,
  PHASE_PLAY,
  PHASE_WON,
  THING_CRATE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  ZONE_LOB,
  ZONE_RING,
  type World,
} from '../../../src/sim/world';
import { BOSS_TIMES } from '../../../src/sim/balance';
import { PLAYER_RADIUS } from '../../../src/sim/balance';
import { preferDefault } from './picks';
import type { Bot } from './steer';

/** Won (the final boss fell), dead, or still going when the time allowed ran out. */
export type RunEnd = 'won' | 'dead' | 'time';

/** How long `playRun` lets a run go by default, s: the final boss comes at 9:00. */
export const MAX_RUN_SECONDS = 12 * 60;

/**
 * What dealt a hit. Indices below `KINDS.length` are touches by that kind (bosses included); the
 * rest are things on the ground.
 */
export const SRC_LOB_RING = KINDS.length;
export const SRC_MORTAR_RING = KINDS.length + 1;
export const SRC_STAND_RING = KINDS.length + 2;
export const SRC_OTHER = KINDS.length + 3;
export const SRC_COUNT = KINDS.length + 4;

export function sourceName(src: number): string {
  if (src < KINDS.length) return KINDS[src].name;
  if (src === SRC_LOB_RING) return 'lob ring';
  if (src === SRC_MORTAR_RING) return 'mortar ring';
  if (src === SRC_STAND_RING) return 'ground ring';
  return 'other';
}

/** The boss (index 0..2 in `BOSS_TIMES`) whose doing a hit from `src` is, or -1. */
export function bossOfSource(src: number): number {
  if (src >= KIND_COUNT && src < KINDS.length) return src - KIND_COUNT;
  if (src === SRC_MORTAR_RING) return KIND_MORTAR - KIND_COUNT;
  if (src === SRC_STAND_RING) return KIND_STANDSTILL - KIND_COUNT;
  return -1;
}

export interface HordeRun {
  seed: number;
  end: RunEnd;
  /** Seconds played when the run ended. */
  seconds: number;
  hp: number;
  /** Maximum health at the end (the build can raise it). */
  maxHp: number;
  kills: number;
  /** Kills when the clock reached 6:00 (or at the end, if it ended sooner). */
  kills6: number;
  level: number;
  /** The build at the end, short: weapon and passive codes with levels. */
  build: string;
  hits: number;
  /** Hits by source (`SRC_*` or an enemy kind). */
  hitsBy: Int32Array;
  /** Hits in each minute of the run (index 0 is 0:00 to 0:59). */
  hitsByMinute: Int32Array;
  /** Level, kills, health and enemies alive at the start of each minute (index 1 is 1:00); -1 once over. */
  levelByMinute: Int32Array;
  killsByMinute: Int32Array;
  hpByMinute: Int32Array;
  hordeByMinute: Int32Array;
  /** What dealt the killing hit, or -1. */
  killedBy: number;
  /** Most enemies alive at once. */
  peakHorde: number;
  /** Enemies alive at 9:00, or -1 if the run did not get there. */
  aliveAt540: number;
  /** Seconds into the run of the first hit; -1 if never hit. */
  firstHitAt: number;
  /**
   * Shortest time from full health to dead, s: from the last tick at full health before the death.
   * Infinity if the run did not end in death.
   */
  fullToDead: number;
  bossesFelled: number;
  /** Run time, s, at which each boss came on (FX_BOSS_IN) and fell (FX_BOSS_DOWN); NaN if it did not. */
  bossIn: number[];
  bossDown: number[];
  /** Crates (and gold crates) opened, hoops taken, slalom gates passed, rails caught. */
  crates: number;
  hoops: number;
  gates: number;
  grinds: number;
  /** `hashWorld` and `hashSimState` mixed, after every tick played. */
  hashes: Uint32Array;
}

/** True if the run was still going (or had been won) at `seconds`; one stopped on the clock at `seconds` was. */
export function aliveAt(r: HordeRun, seconds: number): boolean {
  return r.end === 'won' || r.seconds > seconds || (r.end === 'time' && r.seconds >= seconds);
}

/** Seconds the boss `k` took from arriving to falling, or NaN. */
export function bossTook(r: HordeRun, k: number): number {
  return r.bossDown[k] - r.bossIn[k];
}

/**
 * Something a test does to the world before every tick, after the bot has chosen (to hold a
 * weapon at level 0, say, or health up).
 */
export type RunHook = (sim: Sim) => void;

export interface PlayOptions {
  hook?: RunHook | null;
  picker?: Picker;
  /** Stop after this long if the run is still going, s. */
  maxSeconds?: number;
  /** Stop as soon as this many bosses have fallen. */
  stopAfterFelled?: number;
}

/** The build as the end card would list it: `SK5 SL3 | MT2 HT1`. */
export function describeBuild(w: World): string {
  const l = w.player.loadout;
  const ws: string[] = [];
  for (let i = 0; i < l.weapons.length; i++) {
    const id = l.weapons[i];
    if (id >= 0) ws.push(`${WEAPON_INFO[id].code}${Math.min(MAX_LEVEL, l.weaponLevel[id])}`);
  }
  const ps: string[] = [];
  for (let i = 0; i < l.passives.length; i++) {
    const id = l.passives[i];
    if (id >= 0) ps.push(`${PASSIVE_INFO[id].code}${Math.min(MAX_LEVEL, l.passiveLevel[id])}`);
  }
  return `${ws.join(' ')}${ps.length > 0 ? ' | ' + ps.join(' ') : ''}`;
}

/** Lob rings that land on the coming tick with the mover inside, before the tick: who threw each. */
const landing = { lobber: false, mortar: false };

function lookAtLandings(w: World, x: number, z: number): void {
  landing.lobber = false;
  landing.mortar = false;
  const zn = w.zones;
  for (let i = 0; i < zn.count; i++) {
    if (zn.kind[i] !== ZONE_LOB || zn.life[i] > 2) continue;
    const dx = x - zn.x[i];
    const dz = z - zn.z[i];
    const r = zn.r[i] + 0.4;
    if (dx * dx + dz * dz > r * r) continue;
    // A lobber's ring lives `lobTicks`; the Mortar's lives its own flight time.
    if (zn.life[i] + zn.age[i] === HAZARDS.lobTicks) landing.lobber = true;
    else landing.mortar = true;
  }
}

/** What dealt a hit of `taken` this tick, judged after the step, as a watcher would. */
function sourceOfHit(w: World, x: number, z: number, taken: number): number {
  const h = w.horde;
  const armour = w.player.stats.armour;
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < h.count; i++) {
    const kind = KINDS[h.kind[i]];
    if (kind.damage <= 0 || Math.max(1, kind.damage - armour) !== taken) continue;
    const gap = Math.hypot(h.x[i] - x, h.z[i] - z) - kind.radius - PLAYER_RADIUS;
    if (gap < 0.45 && gap < bestGap) {
      bestGap = gap;
      best = h.kind[i];
    }
  }
  if (best >= 0) return best;
  // Something that touched and was killed on the same tick is among this tick's dead.
  const d = w.deaths;
  for (let i = 0; i < d.count; i++) {
    const kind = KINDS[d.kind[i]];
    if (kind.damage <= 0 || Math.max(1, kind.damage - armour) !== taken) continue;
    const gap = Math.hypot(d.x[i] - x, d.z[i] - z) - kind.radius - PLAYER_RADIUS;
    if (gap < 0.45 && gap < bestGap) {
      bestGap = gap;
      best = d.kind[i];
    }
  }
  if (best >= 0) return best;
  if (landing.lobber) return SRC_LOB_RING;
  if (landing.mortar) return SRC_MORTAR_RING;
  const zn = w.zones;
  for (let i = 0; i < zn.count; i++) if (zn.kind[i] === ZONE_RING) return SRC_STAND_RING;
  return SRC_OTHER;
}

export function playRun(bowl: Bowl, seed: number, bot: Bot, options: PlayOptions = {}): HordeRun {
  const hook = options.hook ?? null;
  const picker = options.picker ?? preferDefault;
  const stopAfter = options.stopAfterFelled ?? Infinity;
  const maxTicks = Math.round((options.maxSeconds ?? MAX_RUN_SECONDS) * TICK_HZ);
  const sim = new Sim(bowl, { seed, horde: true, autoPick: picker });
  const w = sim.world;
  const s = sim.state;
  const p = w.player;
  const m = s.mover;
  const input = makeInputFrame();
  const hashes = new Uint32Array(maxTicks);
  const hitsBy = new Int32Array(SRC_COUNT);
  const minutes = Math.ceil(maxTicks / (60 * TICK_HZ)) + 1;
  const hitsByMinute = new Int32Array(minutes);
  const levelByMinute = new Int32Array(minutes).fill(-1);
  const killsByMinute = new Int32Array(minutes).fill(-1);
  const hpByMinute = new Int32Array(minutes).fill(-1);
  const hordeByMinute = new Int32Array(minutes).fill(-1);
  const bossIn = BOSS_TIMES.map(() => NaN);
  const bossDown = BOSS_TIMES.map(() => NaN);
  const tick540 = 540 * TICK_HZ;
  const tick360 = 360 * TICK_HZ;
  let ticks = 0;
  let hits = 0;
  let peak = 0;
  let firstHit = -1;
  let lastFull = 0;
  let kills6 = -1;
  let aliveAt540 = -1;
  let crates = 0;
  let hoops = 0;
  let gates = 0;
  let grinds = 0;
  let killedBy = -1;
  let bossNext = 0;
  let downNext = 0;

  while (w.run.phase === PHASE_PLAY && ticks < maxTicks && w.boss.felled < stopAfter) {
    bot(sim, input);
    if (hook) hook(sim);
    lookAtLandings(w, m.x, m.z);
    sim.step(input);
    hashes[ticks] = Math.imul(hashWorld(w) ^ 0x9e3779b9, 0x01000193) ^ hashSimState(s);
    ticks++;
    if ((s.events & EV_GRIND_START) !== 0) grinds++;
    const f = w.fx;
    for (let i = 0; i < f.count; i++) {
      const type = f.type[i];
      if (type === FX_BOSS_IN && bossNext < bossIn.length) bossIn[bossNext++] = w.run.ticks / TICK_HZ;
      else if (type === FX_BOSS_DOWN && downNext < bossDown.length) bossDown[downNext++] = w.run.ticks / TICK_HZ;
      else if (type === FX_THING) {
        const kind = f.a[i];
        if (kind === THING_CRATE || kind === THING_GOLD_CRATE) crates++;
        else if (kind === THING_HOOP) hoops++;
        else if (kind === THING_GATE) gates++;
      } else if (type === FX_PLAYER_HIT) {
        const src = sourceOfHit(w, m.x, m.z, f.a[i]);
        hits++;
        hitsBy[src]++;
        hitsByMinute[Math.floor(w.run.ticks / (60 * TICK_HZ))]++;
        if (firstHit < 0) firstHit = ticks;
        if (p.hp <= 0) killedBy = src;
      }
    }
    if (p.hp >= p.maxHp) lastFull = ticks;
    if (w.horde.count > peak) peak = w.horde.count;
    if (w.run.ticks % (60 * TICK_HZ) === 0) {
      const k = w.run.ticks / (60 * TICK_HZ);
      levelByMinute[k] = p.level;
      killsByMinute[k] = p.kills;
      hpByMinute[k] = Math.round(p.hp);
      hordeByMinute[k] = w.horde.count;
    }
    if (w.run.ticks === tick360) kills6 = p.kills;
    if (w.run.ticks === tick540) aliveAt540 = w.horde.count;
  }

  const dead = w.run.phase === PHASE_DEAD;
  const won = w.run.phase === PHASE_WON;
  if (!dead && !won && w.run.phase !== PHASE_PLAY) throw new Error(`run ended in phase ${w.run.phase}`);
  return {
    seed,
    end: dead ? 'dead' : won ? 'won' : 'time',
    seconds: ticks / TICK_HZ,
    hp: p.hp,
    maxHp: p.maxHp,
    kills: p.kills,
    kills6: kills6 < 0 ? p.kills : kills6,
    level: p.level,
    build: describeBuild(w),
    hits,
    hitsBy,
    hitsByMinute,
    levelByMinute,
    killsByMinute,
    hpByMinute,
    hordeByMinute,
    killedBy,
    peakHorde: peak,
    aliveAt540,
    firstHitAt: firstHit < 0 ? -1 : firstHit / TICK_HZ,
    fullToDead: dead ? (ticks - lastFull) / TICK_HZ : Infinity,
    bossesFelled: w.boss.felled,
    bossIn,
    bossDown,
    crates,
    hoops,
    gates,
    grinds,
    hashes: hashes.subarray(0, ticks),
  };
}
