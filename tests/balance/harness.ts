/**
 * The balance harness: plays the bots through the run on seeds 1 to 5, checks the bands, and
 * prints the run table and the parity table. `npm run balance` runs all of it; the light test in
 * `npm test` uses pieces of it on seed 1.
 *
 * Everything is played in sequence in one process. A full run is up to 43 200 ticks.
 */
import { WEAPON_COUNT, WEAPON_INFO, W_SEEKERS } from '../../src/sim/arsenal';
import { BOSS_TIMES } from '../../src/sim/balance';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { setWeaponLevel } from '../../src/sim/build';
import type { Sim } from '../../src/sim/sim';
import { KIND_BOLLARD, KIND_CUTTER, KIND_SLUDGE, KINDS } from '../../src/sim/world';
import { makeIdler, makeKiter, makeRider, makeWanderer } from '../sim/bot/fight';
import { preferDefault, preferWeapon } from '../sim/bot/picks';
import {
  aliveAt,
  bossOfSource,
  bossTook,
  MAX_RUN_SECONDS,
  playRun,
  sourceName,
  SRC_COUNT,
  SRC_LOB_RING,
  type HordeRun,
  type PlayOptions,
} from '../sim/bot/playRun';
import type { Bot } from '../sim/bot/steer';

export const SEEDS = [1, 2, 3, 4, 5];
export const PARITY_SEEDS = [1, 2, 3];
export type BotName = 'idler' | 'wanderer' | 'kiter' | 'rider';
export const BOT_NAMES: readonly BotName[] = ['idler', 'wanderer', 'kiter', 'rider'];

/** The weapons the parity band compares: all but the starter. */
export const PARITY_WEAPONS: readonly number[] = Array.from({ length: WEAPON_COUNT }, (_, i) => i).filter((i) => i !== W_SEEKERS);

/** How long each bot's runs are allowed, s: long enough to judge its bands, no longer. */
export const BOT_SECONDS: Readonly<Record<BotName, number>> = {
  idler: 90,
  wanderer: 240,
  kiter: MAX_RUN_SECONDS,
  rider: MAX_RUN_SECONDS,
};

/** The boss kill-time bands, s, in the order of `BOSS_TIMES`. */
export const BOSS_BANDS: readonly [number, number][] = [
  [20, 60],
  [25, 75],
  [40, 120],
];
export const BOSS_NAMES = ['Bruiser', 'Mortar', 'Standstill'];

const bowls = new Map<number, Bowl>();
export function bowlOf(seed: number): Bowl {
  let b = bowls.get(seed);
  if (!b) {
    b = makeBowl(seed);
    bowls.set(seed, b);
  }
  return b;
}

export function makeBot(name: BotName, seed: number): Bot {
  switch (name) {
    case 'idler':
      return makeIdler();
    case 'wanderer':
      return makeWanderer(seed);
    case 'kiter':
      return makeKiter();
    case 'rider':
      return makeRider(bowlOf(seed));
  }
}

/** One bot on one seed, as the harness plays it. */
export function playBot(name: BotName, seed: number, options: PlayOptions = {}): HordeRun {
  return playRun(bowlOf(seed), seed, makeBot(name, seed), { maxSeconds: BOT_SECONDS[name], ...options });
}

/** Holds every weapon at level 0 and health full: a player who cannot kill and cannot die. */
const cannotKill = (sim: Sim): void => {
  const w = sim.world;
  const l = w.player.loadout;
  for (let id = 0; id < WEAPON_COUNT; id++) if (l.weaponLevel[id] > 0) setWeaponLevel(w, id, 0);
  w.player.hp = w.player.maxHp;
};

export interface Results {
  runs: Record<BotName, HordeRun[]>;
  /** By weapon id (only the parity weapons are filled), the kiter with that weapon's picker on PARITY_SEEDS. */
  parity: (HordeRun[] | null)[];
  /** The kiter with no weapons and health held full, to 9:00. */
  cannotKill: HordeRun;
  /** For each bot, whether its shortest run replayed tick for tick. */
  replay: Record<BotName, { seed: number; ok: boolean; firstDiff: number }>;
  /** Wall-clock seconds each part took. */
  took: Record<string, number>;
}

/** Play everything the bands need. `log` is told as each part finishes. */
export function playAll(log: (line: string) => void = () => {}): Results {
  const took: Record<string, number> = {};
  const runs = { idler: [], wanderer: [], kiter: [], rider: [] } as Record<BotName, HordeRun[]>;
  for (const name of BOT_NAMES) {
    const t0 = performance.now();
    for (const seed of SEEDS) runs[name].push(playBot(name, seed));
    took[name] = (performance.now() - t0) / 1000;
    log(`${name}: ${SEEDS.length} runs in ${took[name].toFixed(1)} s`);
  }

  const t1 = performance.now();
  const parity: (HordeRun[] | null)[] = new Array<HordeRun[] | null>(WEAPON_COUNT).fill(null);
  for (const id of PARITY_WEAPONS) {
    parity[id] = PARITY_SEEDS.map((seed) => playBot('kiter', seed, { picker: preferWeapon(id), maxSeconds: 360 }));
  }
  took.parity = (performance.now() - t1) / 1000;
  log(`parity: ${PARITY_WEAPONS.length * PARITY_SEEDS.length} runs in ${took.parity.toFixed(1)} s`);

  const t2 = performance.now();
  const ck = playBot('kiter', 1, { hook: cannotKill, picker: preferDefault, maxSeconds: 541 });
  took.cannotKill = (performance.now() - t2) / 1000;

  const t3 = performance.now();
  const replay = {} as Results['replay'];
  for (const name of BOT_NAMES) {
    let shortest = runs[name][0];
    for (const r of runs[name]) if (r.seconds < shortest.seconds) shortest = r;
    const again = playBot(name, shortest.seed);
    let firstDiff = again.hashes.length === shortest.hashes.length ? -1 : Math.min(again.hashes.length, shortest.hashes.length);
    for (let t = 0; t < Math.min(again.hashes.length, shortest.hashes.length); t++) {
      if (again.hashes[t] !== shortest.hashes[t]) {
        firstDiff = t;
        break;
      }
    }
    replay[name] = { seed: shortest.seed, ok: firstDiff < 0, firstDiff };
  }
  took.replay = (performance.now() - t3) / 1000;
  return { runs, parity, cannotKill: ck, replay, took };
}

// ---- the bands --------------------------------------------------------------------------------

export interface Band {
  id: number;
  name: string;
  ok: boolean;
  /** What was measured. */
  detail: string;
}

function count(rs: HordeRun[], f: (r: HordeRun) => boolean): number {
  let n = 0;
  for (const r of rs) if (f(r)) n++;
  return n;
}

const won = (r: HordeRun): boolean => r.end === 'won';

/** Rider did at least as well as kiter: further, or both cleared and as much health left or more. */
export function riderAtLeast(rider: HordeRun, kiter: HordeRun): boolean {
  if (won(rider) && won(kiter)) return rider.hp >= kiter.hp;
  if (won(rider)) return true;
  if (won(kiter)) return false;
  return rider.seconds >= kiter.seconds;
}

/** Sum over the parity runs of a weapon of the kills by 6:00. */
export function parityKills(rs: HordeRun[]): number {
  let k = 0;
  for (const r of rs) k += r.kills6;
  return k;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const t = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function judge(res: Results): Band[] {
  const { runs } = res;
  const out: Band[] = [];
  const push = (id: number, name: string, ok: boolean, detail: string): void => {
    out.push({ id, name, ok, detail });
  };

  // 1, 2, 3, 4
  const idle = runs.idler;
  push(1, 'idler dead by 1:00 on every seed', idle.every((r) => r.end === 'dead' && r.seconds <= 60), idle.map((r) => `${r.end} ${t(r.seconds)}`).join(', '));
  const wand = runs.wanderer;
  push(
    2,
    'wanderer alive at 0:20 and dead by 3:00 on every seed',
    wand.every((r) => aliveAt(r, 20) && r.end === 'dead' && r.seconds <= 180),
    wand.map((r) => `${r.end} ${t(r.seconds)}`).join(', '),
  );
  const kit = runs.kiter;
  const k3 = count(kit, (r) => aliveAt(r, 180));
  const kB = count(kit, (r) => r.bossesFelled >= 1);
  const k9 = count(kit, (r) => aliveAt(r, 540));
  const kW = count(kit, won);
  push(
    3,
    'kiter: alive at 3:00 on 5/5, fells the Bruiser on 4+, alive at 9:00 on 3+, clears 1 to 4',
    k3 === 5 && kB >= 4 && k9 >= 3 && kW >= 1 && kW <= 4,
    `alive at 3:00 ${k3}/5, Bruiser felled ${kB}/5, alive at 9:00 ${k9}/5, cleared ${kW}/5`,
  );
  const rid = runs.rider;
  const rW = count(rid, won);
  let atLeast = 0;
  for (let i = 0; i < SEEDS.length; i++) if (riderAtLeast(rid[i], kit[i])) atLeast++;
  push(4, 'rider: clears 2+, at least as well as the kiter on 3+', rW >= 2 && atLeast >= 3, `cleared ${rW}/5, at least as well as the kiter on ${atLeast}/5`);

  // 5
  const cleared = [...kit, ...rid].filter(won);
  const bad5 = cleared.filter((r) => r.level < 20 || r.peakHorde < 250);
  push(
    5,
    'every cleared run: level 20+, horde peaked at 250+',
    bad5.length === 0,
    cleared.length === 0 ? 'no cleared runs' : cleared.map((r) => `L${r.level}/peak ${r.peakHorde}`).join(', '),
  );

  // 6
  const everyone: HordeRun[] = [...idle, ...wand, ...kit, ...rid];
  for (const p of res.parity) if (p) everyone.push(...p);
  let fastest = Infinity;
  for (const r of everyone) if (r.end === 'dead' && r.fullToDead < fastest) fastest = r.fullToDead;
  push(6, 'nobody goes from full health to dead in under 6 s', fastest >= 6, `fastest full-to-dead ${Number.isFinite(fastest) ? fastest.toFixed(1) + ' s' : 'none'}`);

  // 7
  push(7, 'a player who cannot kill faces 380+ alive by 9:00', res.cannotKill.aliveAt540 >= 380, `${res.cannotKill.aliveAt540} alive at 9:00`);

  // 8
  const fought = [...kit, ...rid];
  const bossHits = [0, 0, 0];
  const deathsBy = [0, 0, 0];
  let deaths = 0;
  for (const r of fought) {
    for (let s = 0; s < SRC_COUNT; s++) {
      const b = bossOfSource(s);
      if (b >= 0) bossHits[b] += r.hitsBy[s];
    }
    if (r.end === 'dead') {
      deaths++;
      const b = r.killedBy >= 0 ? bossOfSource(r.killedBy) : -1;
      if (b >= 0) deathsBy[b]++;
    }
  }
  const parts8: string[] = [];
  let ok8 = true;
  for (let k = 0; k < BOSS_TIMES.length; k++) {
    const times = fought.filter((r) => !Number.isNaN(r.bossDown[k])).map((r) => bossTook(r, k));
    const met = fought.filter((r) => !Number.isNaN(r.bossIn[k])).length;
    // A run that ran out of time with the boss still up met a wall.
    const walls = fought.filter((r) => r.end === 'time' && !Number.isNaN(r.bossIn[k]) && Number.isNaN(r.bossDown[k])).length;
    const [lo, hi] = BOSS_BANDS[k];
    const mid = times.length > 0 ? median(times) : NaN;
    const outside = times.filter((x) => x < lo || x > hi).length;
    if (!(mid >= lo && mid <= hi) || walls > 0 || bossHits[k] < 1 || deathsBy[k] * 2 > deaths) ok8 = false;
    parts8.push(
      `${BOSS_NAMES[k]}: met ${met}, felled ${times.length}, median ${Number.isNaN(mid) ? '-' : mid.toFixed(0)} s (band ${lo}-${hi}; ${outside} of ${times.length} outside: ${times.map((x) => x.toFixed(0)).join('/') || '-'}), ${walls} walls, ${bossHits[k]} hits, ${deathsBy[k]}/${deaths} deaths`,
    );
  }
  push(8, 'bosses are fights, not walls (median time to fell in band, no run timed out on a boss)', ok8, parts8.join('; '));

  // 9
  const sums: number[] = [];
  const alive6: number[] = [];
  for (const id of PARITY_WEAPONS) {
    const p = res.parity[id];
    if (!p) continue;
    sums.push(parityKills(p));
    alive6.push(count(p, (r) => aliveAt(r, 360)));
  }
  const med = median(sums);
  const parts9: string[] = [];
  let ok9 = true;
  PARITY_WEAPONS.forEach((id, k) => {
    const ratio = sums[k] / med;
    if (ratio < 0.6 || ratio > 1.6 || alive6[k] < 1) ok9 = false;
    parts9.push(`${WEAPON_INFO[id].name} ${ratio.toFixed(2)}${alive6[k] < 1 ? ' (dead by 6:00 on every seed)' : ''}`);
  });
  push(9, 'parity: each weapon 0.6 to 1.6 of the median kills by 6:00, alive at 6:00 once', ok9, `median ${med}; ${parts9.join(', ')}`);

  // 10
  const hits = new Int32Array(SRC_COUNT);
  for (const r of fought) for (let s = 0; s < SRC_COUNT; s++) hits[s] += r.hitsBy[s];
  let total = 0;
  let most = 0;
  let mostSrc = 0;
  for (let s = 0; s < SRC_COUNT; s++) {
    total += hits[s];
    if (hits[s] > most) {
      most = hits[s];
      mostSrc = s;
    }
  }
  const need = [KIND_CUTTER, SRC_LOB_RING, KIND_SLUDGE, KIND_BOLLARD];
  const ok10 = need.every((s) => hits[s] >= 1) && most * 2 <= total;
  push(
    10,
    'every enemy bites, none decides',
    ok10,
    `${need.map((s) => `${sourceName(s)} ${hits[s]}`).join(', ')}; most is ${sourceName(mostSrc)} with ${most}/${total}`,
  );

  // 11
  let crates = 0;
  let hoopsGates = 0;
  let grinds = 0;
  for (const r of rid) {
    crates += r.crates;
    hoopsGates += r.hoops + r.gates;
    grinds += r.grinds;
  }
  push(11, 'the map pays: rider opens 10+ crates, 5+ hoops or gates, 5+ grinds', crates >= 10 && hoopsGates >= 5 && grinds >= 5, `${crates} crates, ${hoopsGates} hoops and gates, ${grinds} grinds`);

  // 12
  const rp = BOT_NAMES.map((n) => `${n} seed ${res.replay[n].seed} ${res.replay[n].ok ? 'same' : `differs at tick ${res.replay[n].firstDiff}`}`);
  push(12, "deterministic: each bot's shortest run replayed tick by tick", BOT_NAMES.every((n) => res.replay[n].ok), rp.join(', '));
  return out;
}

// ---- the tables -------------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function hitsText(r: HordeRun): string {
  const parts: string[] = [];
  for (let s = 0; s < SRC_COUNT; s++) if (r.hitsBy[s] > 0) parts.push(`${sourceName(s)} ${r.hitsBy[s]}`);
  return parts.join(', ');
}

function bossText(r: HordeRun): string {
  const parts: string[] = [];
  for (let k = 0; k < BOSS_TIMES.length; k++) {
    if (!Number.isNaN(r.bossDown[k])) parts.push(`${BOSS_NAMES[k][0]} ${bossTook(r, k).toFixed(0)}s`);
  }
  return parts.join(' ') || '-';
}

export function runTable(res: Results): string {
  const head = '| bot | seed | end | time | hp | kills | lvl | build | bosses felled (took) | hits by kind | peak |';
  const rows = [head, '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const name of BOT_NAMES) {
    for (const r of res.runs[name]) {
      rows.push(
        `| ${name} | ${r.seed} | ${r.end === 'won' ? 'cleared' : r.end} | ${t(r.seconds)} | ${Math.round(r.hp)}/${r.maxHp} | ${r.kills} | ${r.level} | ${r.build} | ${bossText(r)} | ${hitsText(r)} | ${r.peakHorde} |`,
      );
    }
  }
  const ck = res.cannotKill;
  rows.push(`| no weapons, health held | 1 | ${ck.end} | ${t(ck.seconds)} | - | ${ck.kills} | ${ck.level} | - | - | ${ck.hits} hits | ${ck.peakHorde} (${ck.aliveAt540} at 9:00) |`);
  return rows.join('\n');
}

export function parityTable(res: Results): string {
  const sums = PARITY_WEAPONS.map((id) => parityKills(res.parity[id] ?? []));
  const med = median(sums);
  const rows = [
    `| weapon picked | kills by 6:00 (seeds ${PARITY_SEEDS.join(', ')}) | sum | / median | alive at 6:00 | builds at the end |`,
    '| --- | --- | --- | --- | --- | --- |',
  ];
  PARITY_WEAPONS.forEach((id, k) => {
    const p = res.parity[id] ?? [];
    rows.push(
      `| ${pad(WEAPON_INFO[id].name, 10)} | ${p.map((r) => r.kills6).join(' / ')} | ${sums[k]} | ${(sums[k] / med).toFixed(2)} | ${count(p, (r) => aliveAt(r, 360))}/${p.length} | ${p.map((r) => r.build).join('; ')} |`,
    );
  });
  return rows.join('\n');
}

export function bandTable(bands: Band[]): string {
  const rows = ['| band | | measured |', '| --- | --- | --- |'];
  for (const b of bands) rows.push(`| ${b.id}. ${b.name} | ${b.ok ? 'met' : 'FAILED'} | ${b.detail} |`);
  return rows.join('\n');
}

/** What `last.json` holds: the hash of the tables these results are for, and the results in short. */
export interface LastResults {
  tablesHash: string;
  allMet: boolean;
  bands: Band[];
  runs: Record<BotName, { seed: number; end: string; seconds: number; hp: number; kills: number; level: number; build: string; bossesFelled: number }[]>;
  parity: { weapon: string; kills6: number[] }[];
}

export function summarize(res: Results, bands: Band[], hash: string): LastResults {
  const runs = {} as LastResults['runs'];
  for (const name of BOT_NAMES) {
    runs[name] = res.runs[name].map((r) => ({
      seed: r.seed,
      end: r.end,
      seconds: Math.round(r.seconds * 100) / 100,
      hp: Math.round(r.hp),
      kills: r.kills,
      level: r.level,
      build: r.build,
      bossesFelled: r.bossesFelled,
    }));
  }
  return {
    tablesHash: hash,
    allMet: bands.every((b) => b.ok),
    bands,
    runs,
    parity: PARITY_WEAPONS.map((id) => ({ weapon: WEAPON_INFO[id].name, kills6: (res.parity[id] ?? []).map((r) => r.kills6) })),
  };
}

/** Exported so tests and tables agree on which kinds exist. */
export const KIND_NAMES = KINDS.map((k) => k.name);
