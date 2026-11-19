/**
 * Each weapon alone at level 3 on the same 60 s scripted ride through a placed crowd, in gear 2 and
 * in gear 4: kills and damage dealt. The table is printed for the balance pass to read; the test
 * holds what must be true of every row.
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
import { CROWD_SHUFFLER_HP, RIDE_TICKS, rideField, rideThroughCrowd, rig } from './rig';

const DAMAGING = [W_SLAM, W_ORBIT, W_STATIC, W_SKIPPER, W_CRUMBS, W_LANCE];
/** The two M2 weapons, for scale. */
const REFERENCE = [W_WAKE, W_SEEKERS];

describe('the ride table', () => {
  it('every weapon kills on the ride', () => {
    const rows: string[] = [];
    const row = (name: string, id: number, keepWake = false): { k2: number; k4: number; d2: number; d4: number } => {
      const two = rideThroughCrowd(rig(id, 3, keepWake), 2, RIDE_TICKS);
      const four = rideThroughCrowd(rig(id, 3, keepWake), 4, RIDE_TICKS);
      rows.push(
        `| ${name.padEnd(18)} | ${String(two.kills).padStart(5)} | ${two.damage.toFixed(0).padStart(6)} | ` +
          `${String(four.kills).padStart(5)} | ${four.damage.toFixed(0).padStart(6)} |`,
      );
      return { k2: two.kills, k4: four.kills, d2: two.damage, d4: four.damage };
    };

    const results = DAMAGING.map((id) => row(WEAPON_INFO[id].name, id));
    // No damage of its own: its row is the Wake (level 1) with it.
    const slip = row('Slipstream + Wake 1', W_SLIPSTREAM, true);
    for (const id of REFERENCE) row(`${WEAPON_INFO[id].name} (M2)`, id);
    const wake = rideThroughCrowd(rig(W_WAKE, 1), 2, RIDE_TICKS);
    rows.push(`| ${'Wake 1 alone'.padEnd(18)} | ${String(wake.kills).padStart(5)} | ${wake.damage.toFixed(0).padStart(6)} |       |        |`);

    console.log(
      [
        `Level 3, ${RIDE_TICKS / 60} s, ${rideField().x.length} placed (shufflers at ${CROWD_SHUFFLER_HP / 2}-${(CROWD_SHUFFLER_HP * 3) / 2} hp, bollards)`,
        '| weapon             | k g2  | dmg g2 | k g4  | dmg g4 |',
        '| ------------------ | ----- | ------ | ----- | ------ |',
        ...rows,
      ].join('\n'),
    );

    for (const r of results) {
      expect(r.k2).toBeGreaterThan(0);
    }
    expect(slip.k2).toBeGreaterThan(wake.kills);
  });
});
