/**
 * Bots playing the real bowl. Everything about the feel slice a machine can judge: the stick alone
 * does not make speed, a good line does, a sloppy one does worse but never gets stuck, letting go is
 * never a dead end, and the whole thing is deterministic.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { makeCarver, makeLiner, makeMasher, makeTucker } from './bot/bots';
import { play, shareAtLeast, type RunStats } from './bot/play';
import type { Bot } from './bot/steer';

const SEEDS = [1, 2, 3, 4, 5];
const SECONDS = 120;
const BOTS = ['tucker', 'carver', 'liner', 'masher'] as const;
type BotName = (typeof BOTS)[number];

function makeBot(name: BotName, bowl: Bowl, seed: number): Bot {
  switch (name) {
    case 'tucker':
      return makeTucker();
    case 'carver':
      return makeCarver(seed);
    case 'liner':
      return makeLiner(bowl);
    case 'masher':
      return makeMasher(bowl, seed);
  }
}

const bowls = new Map<number, Bowl>();
const runs = new Map<string, RunStats>();
const key = (name: BotName, seed: number): string => `${name}/${seed}`;
function get(name: BotName, seed: number): RunStats {
  const r = runs.get(key(name, seed));
  if (!r) throw new Error(`no run for ${key(name, seed)}`);
  return r;
}

const pct = (x: number): string => `${Math.round(x * 100)}`.padStart(3);
const num = (x: number, w: number, d = 1): string => x.toFixed(d).padStart(w);

const at = (s: number): string => (s < 0 ? '-' : s.toFixed(0)).padStart(4);

function table(): string {
  const head = `seed bot     avg m/s  g1  g2  g3  g4  g5 (%)  top m/s  chain  hops clean  pads  dist m  g4 s  g5 s`;
  const lines = [head, '-'.repeat(head.length)];
  for (const seed of SEEDS) {
    for (const name of BOTS) {
      const r = get(name, seed);
      const shares = r.gearShare.map(pct).join(' ');
      lines.push(
        `${String(seed).padStart(4)} ${name.padEnd(7)} ${num(r.avgSpeed, 7)}  ${shares}      ${num(r.topSpeed, 7)}  ${String(r.longestChain).padStart(5)}  ${String(r.hops).padStart(4)} ${String(r.cleanHops).padStart(5)}  ${String(r.boosts).padStart(4)}  ${num(r.distance, 6, 0)}  ${at(r.gearAt[3])}  ${at(r.gearAt[4])}`,
      );
    }
  }
  return lines.join('\n');
}

beforeAll(() => {
  for (const seed of SEEDS) {
    const b = makeBowl(seed);
    bowls.set(seed, b);
    for (const name of BOTS) runs.set(key(name, seed), play(b, makeBot(name, b, seed), SECONDS));
  }
});

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Every row must be ok; a failure lists each row that is not, with the numbers that failed it. */
function expectAll(rows: { ok: boolean }[]): void {
  expect(rows.filter((r) => !r.ok)).toEqual([]);
}

describe('bots on the bowl, seeds 1 to 5, 120 s each', () => {
  it('1. the carver never passes gear 3 and spends at least 80% of its time in gears 1 and 2', () => {
    expectAll(
      SEEDS.map((seed) => {
        const r = get('carver', seed);
        const low = r.gearShare[0] + r.gearShare[1];
        return { seed, topGear: r.topGear, topSpeed: r1(r.topSpeed), gear12: r2(low), ok: r.topGear <= 3 && low >= 0.8 };
      }),
    );
  });

  it('2. the liner reaches gear 4 within 30 s and gear 5 within 90 s, and spends at least 40% in gear 3+', () => {
    expectAll(
      SEEDS.map((seed) => {
        const r = get('liner', seed);
        const g4 = r.gearAt[3];
        const g5 = r.gearAt[4];
        const high = shareAtLeast(r, 3);
        const ok = g4 >= 0 && g4 <= 30 && g5 >= 0 && g5 <= 90 && high >= 0.4;
        return { seed, gear4At: r1(g4), gear5At: r1(g5), gear3plus: r2(high), ok };
      }),
    );
  });

  it("3. the liner's average speed is at least 1.6 times the carver's", () => {
    expectAll(
      SEEDS.map((seed) => {
        const liner = get('liner', seed).avgSpeed;
        const carver = get('carver', seed).avgSpeed;
        return { seed, liner: r1(liner), carver: r1(carver), ratio: r2(liner / carver), ok: liner >= 1.6 * carver };
      }),
    );
  });

  it('4. the masher does clearly worse than the liner (less gear 3+, shorter chain) but is never stuck: 600 m+', () => {
    expectAll(
      SEEDS.map((seed) => {
        const l = get('liner', seed);
        const m = get('masher', seed);
        const mHigh = shareAtLeast(m, 3);
        const lHigh = shareAtLeast(l, 3);
        const ok = mHigh < lHigh && m.longestChain < l.longestChain && m.distance >= 600;
        return {
          seed,
          gear3plus: `${r2(mHigh)} vs ${r2(lHigh)}`,
          chain: `${m.longestChain} vs ${l.longestChain}`,
          distance: Math.round(m.distance),
          ok,
        };
      }),
    );
  });

  it('5. the tucker from spawn is moving within 5 s and travels at least 150 m in 60 s', () => {
    expectAll(
      SEEDS.map((seed) => {
        const r = get('tucker', seed);
        const ok = r.movingAt >= 0 && r.movingAt <= 5 && r.distance60 >= 150;
        return { seed, movingAt: r1(r.movingAt), distance60: Math.round(r.distance60), ok };
      }),
    );
  });

  it('6. nobody leaves the radius, produces a non-finite number, or stops for more than 4 s holding the stick', () => {
    const rows = [];
    for (const seed of SEEDS) {
      const radius = bowls.get(seed)?.radius ?? 0;
      for (const name of BOTS) {
        const r = get(name, seed);
        const ok = r.finite && r.maxRadius <= radius + 1e-9 && r.longestStuckHolding <= 4;
        rows.push({ seed, name, finite: r.finite, maxRadius: r1(r.maxRadius), stuckHolding: r1(r.longestStuckHolding), ok });
      }
    }
    expectAll(rows);
  });

  it("7. the liner's longest clean-hop chain is at least 8", () => {
    expectAll(
      SEEDS.map((seed) => {
        const chain = get('liner', seed).longestChain;
        return { seed, chain, ok: chain >= 8 };
      }),
    );
  });

  it('8. two runs of the same bot on the same seed are bit-identical, tick by tick', () => {
    const rows = [];
    for (const seed of SEEDS) {
      const b = bowls.get(seed);
      if (!b) throw new Error(`no bowl for seed ${seed}`);
      for (const name of BOTS) {
        const a = get(name, seed).hashes;
        const again = play(b, makeBot(name, b, seed), SECONDS).hashes;
        let firstDiff = -1;
        for (let t = 0; t < a.length && firstDiff < 0; t++) if (a[t] !== again[t]) firstDiff = t;
        rows.push({ seed, name, ticks: again.length, firstDiff, ok: again.length === a.length && firstDiff < 0 });
      }
    }
    expectAll(rows);
  });

  it('9. prints the balance table (no assertion)', () => {
    console.log(`\nBots on the bowl, ${SECONDS} s each\n${table()}\n`);
  });
});

