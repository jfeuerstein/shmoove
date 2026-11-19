/**
 * Each weapon alone at level 3 for 60 s among the same crowd, standing still and riding the
 * scripted ride: kills and damage dealt. The crowd keeps its places around the mover (see
 * `crowdRide`), so standing and riding face the same thing. The table is printed for the balance
 * pass to read; the test holds what must be true of every row.
 */
import { describe, expect, it } from 'vitest';
import {
  W_CRUMBS,
  W_LANCE,
  W_ORBIT,
  W_SEEKERS,
  W_SKIPPER,
  W_SLAM,
  W_SLIPSTREAM,
  W_STATIC,
  W_WAKE,
  WEAPON_INFO,
} from '../../../src/sim/arsenal';
import { CROWD_RESPAWN, CROWD_SHUFFLER_HP, CROWD_SIZE, crowdRide, RIDE_TICKS, rig, type CrowdResult } from './rig';

/** Weapons that hurt, and fire on a timer whatever the mover does. */
const TIMED = [W_SEEKERS, W_SLAM, W_ORBIT, W_STATIC, W_SKIPPER, W_CRUMBS, W_LANCE];
/**
 * Those whose hits land where the crowd is at the moment they fire. The Skipper's stones fly
 * unguided and the Crumbs' mines stay where they were dropped, while this crowd is carried along
 * with a riding mover (at 10 m/s, turning with it): stones thrown sideways miss more, and the crowd
 * is swept over mines left behind. Those two differ between standing and riding because of where
 * things are, not because the weapon reads the mover (`timers.test.ts` holds the mover still and
 * shows them the same); the balance pass reads their rows.
 */
const WHERE_THEY_ARE = [W_SEEKERS, W_SLAM, W_ORBIT, W_STATIC, W_LANCE];

interface Row {
  name: string;
  still: CrowdResult;
  riding: CrowdResult;
}

function measure(name: string, id: number, level: number, keepWake = false): Row {
  return {
    name,
    still: crowdRide(rig(id, level, keepWake), false, RIDE_TICKS),
    riding: crowdRide(rig(id, level, keepWake), true, RIDE_TICKS),
  };
}

function format(r: Row): string {
  const ratio = r.still.damage > 0 ? (r.riding.damage / r.still.damage).toFixed(2) : '-';
  return (
    `| ${r.name.padEnd(19)} | ${String(r.still.kills).padStart(7)} | ${r.still.damage.toFixed(0).padStart(9)} | ` +
    `${String(r.riding.kills).padStart(8)} | ${r.riding.damage.toFixed(0).padStart(10)} | ${ratio.padStart(10)} |`
  );
}

describe('the table', () => {
  it('every timed weapon kills standing still and riding, and does about as well either way', () => {
    const timed = TIMED.map((id) => measure(WEAPON_INFO[id].name, id, 3));
    // No damage of its own: its row is the Wake (level 1) with it.
    const slip = measure('Slipstream + Wake 1', W_SLIPSTREAM, 3, true);
    const wake = measure('Wake 3', W_WAKE, 3);
    const wake1 = measure('Wake 1', W_WAKE, 1);

    console.log(
      [
        `Level 3 alone, ${RIDE_TICKS / 60} s, a crowd of ${CROWD_SIZE} kept round the mover ` +
          `(shufflers at ${CROWD_SHUFFLER_HP / 2}-${(CROWD_SHUFFLER_HP * 3) / 2} hp, bollards; back ${CROWD_RESPAWN / 60} s after dying)`,
        '| weapon              | k still | dmg still | k riding | dmg riding | ride/still |',
        '| ------------------- | ------- | --------- | -------- | ---------- | ---------- |',
        ...[...timed, slip, wake, wake1].map(format),
      ].join('\n'),
    );

    for (const r of timed) {
      expect(r.still.kills, r.name).toBeGreaterThan(0);
      expect(r.riding.kills, r.name).toBeGreaterThan(0);
    }
    TIMED.forEach((id, k) => {
      if (!WHERE_THEY_ARE.includes(id)) return;
      const r = timed[k];
      expect(r.riding.damage / r.still.damage, r.name).toBeGreaterThan(0.9);
      expect(r.riding.damage / r.still.damage, r.name).toBeLessThan(1.1);
    });
    // The Wake is laid by moving: it is the one weapon that does nothing standing still.
    expect(wake.still.damage).toBe(0);
    expect(wake.riding.kills).toBeGreaterThan(0);
    expect(slip.riding.kills).toBeGreaterThan(wake1.riding.kills);
  });
});
