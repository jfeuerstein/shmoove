/**
 * Regenerates the scripted routes the city tests replay, by search. Skipped unless asked for:
 *
 *   SKITCH_FIND_SUMMIT=1 npx vitest run tests/sim/findRoutes.test.ts --silent=false
 *
 * prints the summit route's keys (paste them into `SUMMIT` in tests/sim/citySummit.test.ts and
 * `SUMMIT.keys` in tests/sim/bot/secrets.ts). Run it whenever the controller, the city or the
 * timetable changes and the summit tests fail. docs/briefs/README.md lists every such command.
 */
import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/sim/city';
import { resetFeel } from '../../src/sim/constants';
import { findLink, replayChain, type ChainStart, type Key } from './bot/findChain';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(!ENV.SKITCH_FIND_SUMMIT)('find the summit route', () => {
  it('lower cable car, summit cable car, kite, king kite', () => {
    resetFeel();
    // Under the lower cable car's strap at the Antenna gate as a car stands there, at the later of
    // the route's two daily windows (citySummit.test.ts checks the earlier one too).
    const c: ChainStart = { world: buildCity(1).world, start: 27540, x: -15.557336845398943, z: 947.2993933173871 };
    let keys: Key[] = [[0, 0, 1, 1]];
    const first = replayChain(c, keys, 300).hitches[0];
    expect(first?.link).toBe('A1:1');
    let caught = first.at;
    const links: string[] = [];
    for (const [line, chain] of [
      ['A2', 2],
      ['A3', 3],
      ['S3', 4],
    ] as const) {
      const found = findLink(c, keys, line, chain, caught + 60, caught + 2400);
      expect(found, `no release onto ${line}`).not.toBeNull();
      if (!found) return;
      keys = found.keys;
      const r = replayChain(c, keys, keys[keys.length - 1][0] + 240);
      const h = r.hitches.find((x) => x.link === `${line}:${chain}`);
      caught = h ? h.at : caught;
      links.push(`${line}: release ${keys[keys.length - 2][0]} (works ${found.from}..${found.to})`);
    }
    console.info(`summit route\n${links.join('\n')}\nkeys: ${JSON.stringify(keys)}`);
  }, 600_000);
});
