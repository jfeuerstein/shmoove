/**
 * The tally says who dealt and who took what: the end card and the playtest report are read from
 * it, so its sums have to be the truth.
 */
import { describe, expect, it } from 'vitest';
import { W_BUMPER, W_SEEKERS, W_SLAM } from '../../src/sim/arsenal';
import { makeBowl } from '../../src/sim/bowl';
import { setWeaponLevel } from '../../src/sim/build';
import { hurtPlayer } from '../../src/sim/contact';
import { Sim } from '../../src/sim/sim';
import type { InputFrame } from '../../src/sim/types';
import { HURT_OTHER, KIND_SHUFFLER, SRC_OTHER } from '../../src/sim/world';

const input: InputFrame = { steerX: 0.3, steerY: 1, carve: true, hop: false };

function sum(a: ArrayLike<number>): number {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += a[i];
  return t;
}

describe('the tally', () => {
  it('credits damage to the weapon that dealt it and hits to what landed them', () => {
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: false });
    const w = sim.world;
    setWeaponLevel(w, W_SLAM, 3);
    w.run.ticks = 120 * 60;
    let lost = 0;
    for (let i = 0; i < 40 * 60 && w.run.phase !== 1; i++) {
      const before = w.player.hp;
      // Never dies, never levels: the fight goes on.
      w.player.xp = 0;
      sim.step(input);
      if (w.player.hp < before) lost += before - w.player.hp;
      if (w.player.hp < 50) w.player.hp = w.player.maxHp;
    }
    const t = w.tally;
    expect(t.dealt[W_SEEKERS]).toBeGreaterThan(0);
    expect(t.dealt[W_SLAM]).toBeGreaterThan(0);
    expect(t.dealt[W_BUMPER]).toBe(0);
    expect(t.dealt[SRC_OTHER]).toBe(0);
    expect(w.player.kills).toBeGreaterThan(0);
    // Something touched the rider in 40 s among a minute-two crowd, and every point lost is accounted for.
    expect(sum(t.hits)).toBeGreaterThan(0);
    expect(t.hits[KIND_SHUFFLER]).toBeGreaterThan(0);
    expect(sum(t.hurt)).toBeCloseTo(lost, 6);
  });

  it('files a hit with no cause under other, and a restart clears it all', () => {
    const sim = new Sim(makeBowl(2), { seed: 2, horde: true, autoPick: true });
    hurtPlayer(sim.world, sim.state, 5);
    expect(sim.world.tally.hits[HURT_OTHER]).toBe(1);
    expect(sim.world.tally.hurt[HURT_OTHER]).toBe(5);
    sim.reset();
    expect(sum(sim.world.tally.hits) + sum(sim.world.tally.hurt) + sum(sim.world.tally.dealt)).toBe(0);
  });
});
