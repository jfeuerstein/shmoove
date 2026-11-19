/**
 * The three-minute horde slice, played by five bots on seeds 1 to 5: a player who does nothing, one
 * who only holds the stick, a careful beginner, one who loops, and one who plays lines. Every band
 * in `docs/briefs/m2-balance.md` (as revised for round 2: the tucker by 1:00, and band 7 measured on
 * a player who cannot kill) is asserted from one set of 25 runs, a 26th run with the weapons held
 * off, and one replay per bot for determinism.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { makeCarver, makeTucker } from './bot/bots';
import { makeEvader, makeLooper, makeRider } from './bot/fighters';
import { aliveAt, playRun, type HordeRun, type RunHook } from './bot/playRun';
import type { Bot } from './bot/steer';

const SEEDS = [1, 2, 3, 4, 5];
const BOTS = ['tucker', 'carver', 'evader', 'looper', 'rider'] as const;
type BotName = (typeof BOTS)[number];

function makeBot(name: BotName, bowl: Bowl, seed: number): Bot {
  switch (name) {
    case 'tucker':
      return makeTucker();
    case 'carver':
      return makeCarver(seed);
    case 'evader':
      return makeEvader();
    case 'looper':
      return makeLooper();
    case 'rider':
      return makeRider(bowl);
  }
}

const bowls = new Map<number, Bowl>();
const runs = new Map<string, HordeRun>();
const key = (name: BotName, seed: number): string => `${name}/${seed}`;
function get(name: BotName, seed: number): HordeRun {
  const r = runs.get(key(name, seed));
  if (!r) throw new Error(`no run for ${key(name, seed)}`);
  return r;
}

/** A player who cannot kill: no weapons, and health held up so the run lasts all three minutes. */
const noKill: RunHook = (sim) => {
  const p = sim.world.player;
  p.wakeLevel = 0;
  p.seekersLevel = 0;
  p.hp = p.maxHp;
};
let unarmed: HordeRun | null = null;

beforeAll(() => {
  for (const seed of SEEDS) {
    const b = makeBowl(seed);
    bowls.set(seed, b);
    for (const name of BOTS) runs.set(key(name, seed), playRun(b, seed, makeBot(name, b, seed)));
  }
  const b1 = bowls.get(1);
  // The evader never reaches gear 3, so it does not plow either: its kill count stays at zero.
  if (b1) unarmed = playRun(b1, 1, makeEvader(), noKill);
}, 120_000);

const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Every row must be ok; a failure lists each row that is not, with the numbers that failed it. */
function expectAll(rows: { ok: boolean }[]): void {
  expect(rows.filter((r) => !r.ok)).toEqual([]);
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function table(): string {
  // hp is shown whole; with regeneration a winner can end anywhere up to full.
  const head = 'seed bot     end   time   hp  kills  lvl  wake seek  pops best  g3+%  hits  peak';
  const lines = [head, '-'.repeat(head.length)];
  for (const seed of SEEDS) {
    for (const name of BOTS) {
      const r = get(name, seed);
      lines.push(
        [
          String(seed).padStart(4),
          name.padEnd(7),
          r.end.padEnd(4),
          clock(r.seconds).padStart(5),
          String(Math.round(r.hp)).padStart(4),
          String(r.kills).padStart(6),
          String(r.level).padStart(4),
          String(r.wakeLevel).padStart(5),
          String(r.seekersLevel).padStart(4),
          String(r.pops).padStart(5),
          String(r.bestPop).padStart(4),
          String(Math.round(r.gear3plus * 100)).padStart(5),
          String(r.hits).padStart(5),
          String(r.peakHorde).padStart(5),
        ].join(' '),
      );
    }
  }
  return lines.join('\n');
}

describe('the horde slice, five bots on seeds 1 to 5, a full run each', () => {
  it('1. the tucker is dead by 1:00 on every seed', () => {
    expectAll(
      SEEDS.map((seed) => {
        const r = get('tucker', seed);
        return { seed, end: r.end, at: r1(r.seconds), ok: r.end === 'dead' && r.seconds <= 60 };
      }),
    );
  });

  it('2. the blind carver is alive at 0:20 and dead by 1:30 on every seed', () => {
    expectAll(
      SEEDS.map((seed) => {
        const r = get('carver', seed);
        return { seed, end: r.end, at: r1(r.seconds), ok: aliveAt(r, 20) && r.end === 'dead' && r.seconds <= 90 };
      }),
    );
  });

  it('3. the evader is alive at 0:45 on every seed and dies before the end on at least 3 of 5', () => {
    const rows = SEEDS.map((seed) => {
      const r = get('evader', seed);
      return { seed, end: r.end, at: r1(r.seconds), ok: aliveAt(r, 45) };
    });
    expectAll(rows);
    expect(rows.filter((r) => r.end === 'dead').length).toBeGreaterThanOrEqual(3);
  });

  /** The looper against the evader on each seed. */
  function looperRows(): { seed: number; pops: number; best: number; looper: number; evader: number; outlives: boolean }[] {
    return SEEDS.map((seed) => {
      const l = get('looper', seed);
      const e = get('evader', seed);
      const outlives = l.end === 'won' ? e.end !== 'won' || l.hp > e.hp : e.end === 'dead' && l.seconds > e.seconds;
      return { seed, pops: l.pops, best: l.bestPop, looper: r1(l.seconds), evader: r1(e.seconds), outlives };
    });
  }

  it('4a. the looper pops 3+ loops every run and outlives the evader on 4 of 5', () => {
    const rows = looperRows();
    expectAll(rows.map((r) => ({ ...r, ok: r.pops >= 3 })));
    expect(rows.filter((r) => r.outlives).length).toBeGreaterThanOrEqual(4);
  });

  it('4b. the looper has a best loop of 6+ on 3 of 5', () => {
    const rows = looperRows();
    expect(rows.filter((r) => r.best >= 6).map((r) => r.seed).length).toBeGreaterThanOrEqual(3);
  });

  it('5. the rider sees the clock run out on 3 of 5, each time with 10 to 80 health, level 8+ and 300+ kills', () => {
    const rows = SEEDS.map((seed) => {
      const r = get('rider', seed);
      const ok = r.end === 'won' && r.hp >= 10 && r.hp <= 80 && r.level >= 8 && r.kills >= 300;
      return { seed, end: r.end, at: r1(r.seconds), hp: Math.round(r.hp), level: r.level, kills: r.kills, ok };
    });
    expect(rows.filter((r) => r.ok).length).toBeGreaterThanOrEqual(3);
    // A run that wins must also have been a fight and a build.
    expectAll(rows.filter((r) => r.end === 'won'));
  });

  it('6. after the first hit nobody goes from full health to dead in under 8 s', () => {
    const rows = [];
    for (const seed of SEEDS) {
      for (const name of BOTS) {
        const r = get(name, seed);
        rows.push({ seed, name, fullToDead: r1(r.fullToDead), ok: r.fullToDead >= 8 });
      }
    }
    expectAll(rows);
  });

  it("7. a player who cannot kill faces 380+ alive by 3:00; the rider's winning runs peak at 120+ (it was a fight)", () => {
    if (!unarmed) throw new Error('no unarmed run');
    expect(unarmed.end).toBe('won');
    expect(unarmed.kills).toBe(0);
    expect(unarmed.peakHorde).toBeGreaterThanOrEqual(380);
    expectAll(
      SEEDS.filter((seed) => get('rider', seed).end === 'won').map((seed) => {
        const r = get('rider', seed);
        return { seed, peak: r.peakHorde, ok: r.peakHorde >= 120 };
      }),
    );
  });

  it('8. runs replay bit-identically, tick by tick (world and mover): one seed per bot', () => {
    const rows = [];
    for (const name of BOTS) {
      // Each bot's shortest run: every bot's code is replayed, at the least cost in test time.
      let seed = SEEDS[0];
      for (const s of SEEDS) if (get(name, s).seconds < get(name, seed).seconds) seed = s;
      const b = bowls.get(seed);
      if (!b) throw new Error(`no bowl for seed ${seed}`);
      {
        const a = get(name, seed).hashes;
        const again = playRun(b, seed, makeBot(name, b, seed)).hashes;
        let firstDiff = -1;
        for (let t = 0; t < a.length && firstDiff < 0; t++) if (a[t] !== again[t]) firstDiff = t;
        rows.push({ seed, name, ticks: again.length, firstDiff, ok: again.length === a.length && firstDiff < 0 });
      }
    }
    expectAll(rows);
  }, 120_000);

  it('9. prints the balance table (no assertion)', () => {
    console.log(`\nThe horde slice, a full run each\n${table()}\n`);
  });
});
