/** Each passive, taken in a real run, does what its card says. */
import { describe, expect, it } from 'vitest';
import {
  P_HASTE,
  P_HEART,
  P_HIDE,
  P_LUCK,
  P_MAGNET,
  P_MIGHT,
  P_REGEN,
  P_SPRINGS,
  P_WAX,
  P_WIDE_LOAD,
  P_WINGS,
  PASSIVE_COUNT,
  PASSIVE_INFO,
} from '../../src/sim/arsenal';
import { MAGNET_BASE, MAGNET_PER_GEAR } from '../../src/sim/balance';
import { setPassiveLevel } from '../../src/sim/build';
import { FEEL } from '../../src/sim/constants';
import { hurtPlayer } from '../../src/sim/contact';
import type { Sim } from '../../src/sim/sim';
import { powerOf } from '../../src/sim/stats';
import { flatTerrain } from '../../src/sim/terrain';
import { KIND_BOLLARD, KINDS } from '../../src/sim/world';
import { FORWARD, launch, run, steer, TUCK } from './fixtures';
import { arena, place, root } from './world-fixtures';

const wide = (): Sim => arena(flatTerrain(100000));

describe('movement passives reach the mover', () => {
  const coast = (set: (sim: Sim) => void): number => {
    const sim = wide();
    set(sim);
    launch(sim, 25);
    run(sim, TUCK, 300);
    return sim.state.mover.speed;
  };

  it('Wax: a tuck holds its speed longer', () => {
    expect(coast((sim) => setPassiveLevel(sim.world, P_WAX, 5))).toBeGreaterThan(coast(() => {}) + 0.4);
  });

  it('Springs: hops go higher', () => {
    const peak = (level: number): number => {
      const sim = wide();
      setPassiveLevel(sim.world, P_SPRINGS, level);
      run(sim, FORWARD, 60);
      sim.step({ ...FORWARD, hop: true });
      let top = 0;
      while (!sim.state.mover.grounded) {
        sim.step(FORWARD);
        top = Math.max(top, sim.state.mover.y);
      }
      return top;
    };
    expect(peak(5)).toBeGreaterThan(peak(0) * 1.4);
  });

  it('Wings: more steer in the air', () => {
    const drift = (level: number): number => {
      const sim = wide();
      setPassiveLevel(sim.world, P_WINGS, level);
      launch(sim, 15);
      sim.step({ ...steer(-1, 0), hop: true });
      while (!sim.state.mover.grounded) sim.step(steer(-1, 0));
      return sim.state.mover.x;
    };
    expect(drift(5)).toBeGreaterThan(drift(0) * 1.8);
  });
});

describe('the rest', () => {
  it('Heart: more health, and that much more now', () => {
    const sim = wide();
    sim.world.player.hp = 60;
    setPassiveLevel(sim.world, P_HEART, 2);
    expect(sim.world.player.maxHp).toBe(140);
    expect(sim.world.player.hp).toBe(100);
  });

  it('Hide: every hit hurts a little less, never nothing', () => {
    const sim = wide();
    setPassiveLevel(sim.world, P_HIDE, 3);
    hurtPlayer(sim.world, sim.state, 8);
    expect(sim.world.player.hp).toBe(100 - 5);
    sim.world.player.invuln = 0;
    hurtPlayer(sim.world, sim.state, 2);
    expect(sim.world.player.hp).toBe(100 - 5 - 1);
  });

  it('Regen: health comes back all the time', () => {
    const sim = wide();
    setPassiveLevel(sim.world, P_REGEN, 5);
    sim.world.player.hp = 40;
    run(sim, TUCK, 300);
    expect(sim.world.player.hp).toBeCloseTo(40 + 1.6 * 5, 0);
  });

  it('Haste: the stat every weapon waits by goes down', () => {
    const sim = wide();
    expect(sim.world.player.stats.haste).toBe(1);
    setPassiveLevel(sim.world, P_HASTE, 5);
    expect(sim.world.player.stats.haste).toBeCloseTo(0.68, 6);
  });

  it('Magnet: sparks come from further away', () => {
    const taken = (level: number): number => {
      const sim = wide();
      setPassiveLevel(sim.world, P_MAGNET, level);
      const s = sim.world.sparks;
      s.count = 1;
      s.x[0] = MAGNET_BASE + MAGNET_PER_GEAR + 3;
      s.z[0] = 0;
      s.y[0] = 0.5;
      s.value[0] = 1;
      run(sim, TUCK, 120);
      return sim.world.player.xp;
    };
    expect(taken(0)).toBe(0);
    expect(taken(5)).toBe(1);
  });

  it('Might: everything hits harder, in any gear', () => {
    const sim = wide();
    const st = sim.world.player.stats;
    expect(powerOf(st, 1)).toBe(1);
    expect(powerOf(st, 5)).toBe(1);
    setPassiveLevel(sim.world, P_MIGHT, 5);
    expect(powerOf(st, 1)).toBeCloseTo(1.5, 6);
    expect(powerOf(st, 5)).toBeCloseTo(1.5, 6);
  });

  it('Wide Load: the trail burns wider', () => {
    const burnt = (level: number): boolean => {
      const sim = wide();
      setPassiveLevel(sim.world, P_WIDE_LOAD, level);
      // Just outside the plain trail's reach, inside the widened one.
      const off = FEEL.wakeWidth + KINDS[KIND_BOLLARD].radius + 0.3;
      const b = place(sim, KIND_BOLLARD, off, 14);
      for (let t = 0; t < 240; t++) {
        root(sim.world);
        sim.step(FORWARD);
      }
      return sim.world.horde.hp[b] < KINDS[KIND_BOLLARD].hp;
    };
    expect(burnt(0)).toBe(false);
    expect(burnt(5)).toBe(true);
  });

  it('Luck: only shifts what is offered (the stat is set)', () => {
    const sim = wide();
    setPassiveLevel(sim.world, P_LUCK, 4);
    expect(sim.world.player.stats.luck).toBeCloseTo(0.4, 6);
  });

  it('every passive changes at least one stat at every level', () => {
    for (let id = 0; id < PASSIVE_COUNT; id++) {
      for (const fx of PASSIVE_INFO[id].effects) {
        for (let level = 1; level < 5; level++) {
          const a = fx.byLevel[level - 1];
          const b = fx.byLevel[level];
          // Each level is strictly more of the same thing.
          expect(fx.mode === 'mul' && a < 1 ? b < a : b > a, `${PASSIVE_INFO[id].name} level ${level + 1}`).toBe(true);
        }
      }
    }
  });
});
