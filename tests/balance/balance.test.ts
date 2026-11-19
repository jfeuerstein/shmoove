/**
 * The full balance harness (`npm run balance`): every bot on seeds 1 to 5, the parity runs, the
 * player who cannot kill, and the replays. Prints the run, parity and band tables, records the
 * results with the hash of the tuned tables in `last.json`, and fails if any band is not met.
 *
 * Not part of `npm test` or the gate: it takes minutes. `tests/sim/balance.test.ts` is the light
 * version that is, and it checks `last.json` is up to date with the tables.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bandTable, judge, parityTable, playAll, runTable, summarize } from './harness';
import { tablesHash } from './tables';

/** Where the results are recorded, next to this file. */
const LAST = new URL('./last.json', import.meta.url);

function say(text: string): void {
  console.log(text);
}

describe('the balance of the ten-minute run', () => {
  it('meets every band', () => {
    const t0 = performance.now();
    const res = playAll((line) => say(`[balance] ${line}`));
    const bands = judge(res);
    const took = (performance.now() - t0) / 1000;
    say('\nRuns (seeds 1 to 5; time is game time):\n');
    say(runTable(res));
    say('\nParity (the kiter, taking one weapon whenever it is dealt):\n');
    say(parityTable(res));
    say('\nBands:\n');
    say(bandTable(bands));
    say(`\n[balance] ${took.toFixed(1)} s in all (${Object.entries(res.took).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(', ')})`);
    writeFileSync(LAST, `${JSON.stringify(summarize(res, bands, tablesHash()), null, 2)}\n`);
    expect(bands.filter((b) => !b.ok).map((b) => `${b.id}. ${b.name}: ${b.detail}`)).toEqual([]);
  });
});
