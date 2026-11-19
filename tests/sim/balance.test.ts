/**
 * The light balance check that stays in `npm test`: seed 1 only. The player who never touches the
 * screen is dead within the minute, the one who wanders blind lasts past 0:20 and is dead by 3:00,
 * the careful player is alive at 3:00 and brings the Bruiser down, the idler's run replays tick
 * for tick, and the full harness (`npm run balance`) was last run on the tables as they are now.
 */
import { describe, expect, it } from 'vitest';
import last from '../balance/last.json';
import { playBot } from '../balance/harness';
import { tablesHash } from '../balance/tables';
import { aliveAt } from './bot/playRun';

describe('balance on seed 1', () => {
  const idler = playBot('idler', 1);
  const wanderer = playBot('wanderer', 1);

  it('the idler is dead by 1:00', () => {
    expect(idler.end).toBe('dead');
    expect(idler.seconds).toBeLessThanOrEqual(60);
  });

  it('the wanderer is alive at 0:20 and dead by 3:00', () => {
    expect(aliveAt(wanderer, 20)).toBe(true);
    expect(wanderer.end).toBe('dead');
    expect(wanderer.seconds).toBeLessThanOrEqual(180);
  });

  it('the kiter is alive at 3:00 and fells the Bruiser', () => {
    const kiter = playBot('kiter', 1, { stopAfterFelled: 1, maxSeconds: 360 });
    expect(aliveAt(kiter, 180)).toBe(true);
    expect(kiter.bossesFelled).toBeGreaterThanOrEqual(1);
  });

  it("the idler's run replays tick for tick", () => {
    const again = playBot('idler', 1);
    expect(again.hashes.length).toBe(idler.hashes.length);
    let first = -1;
    for (let t = 0; t < idler.hashes.length && first < 0; t++) if (again.hashes[t] !== idler.hashes[t]) first = t;
    expect(first, 'first tick that differs').toBe(-1);
  });

  it('the full harness was run on the tables as they are (npm run balance)', () => {
    expect(last.tablesHash, 'a tuned table changed since `npm run balance` last ran: run it and commit tests/balance/last.json').toBe(tablesHash());
  });
});
