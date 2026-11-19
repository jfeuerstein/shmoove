/** What a player would notice touching the horde: hurt, plow, bonk. */
import { describe, expect, it } from 'vitest';
import { GEAR_REGEN, RUN_TICKS } from '../../src/sim/balance';
import { hurtPlayer } from '../../src/sim/contact';
import { flatTerrain } from '../../src/sim/terrain';
import { FEEL } from '../../src/sim/constants';
import { EV_GEAR_DOWN } from '../../src/sim/types';
import {
  KIND_BOLLARD,
  KIND_GNAT,
  KIND_SHUFFLER,
  KINDS,
  PHASE_DEAD,
  PHASE_PLAY,
  PHASE_WON,
  spawnEnemy,
} from '../../src/sim/world';
import { FORWARD, launch, run, TUCK } from './fixtures';
import { arena, place } from './world-fixtures';

const hopNow = { ...TUCK, hop: true };

describe('below the gear that plows it', () => {
  it('a shuffler hurts: health, a gear, and a moment of safety', () => {
    const sim = arena();
    place(sim, KIND_SHUFFLER, 0, 14);
    run(sim, FORWARD, 60);
    expect(sim.state.mover.gear).toBe(2);
    let dropped = false;
    for (let i = 0; i < 60 && sim.world.player.hp === 100; i++) {
      sim.step(FORWARD);
      dropped ||= (sim.state.events & EV_GEAR_DOWN) !== 0;
    }
    expect(sim.world.player.hp).toBe(100 - KINDS[KIND_SHUFFLER].damage);
    expect(dropped).toBe(true);
    expect(sim.state.mover.gear).toBe(1);
    expect(sim.world.player.invuln).toBeGreaterThan(0);
  });

  it('nothing else can hurt until the moment has passed', () => {
    const sim = arena();
    for (let k = 0; k < 6; k++) place(sim, KIND_SHUFFLER, (k - 2.5) * 0.9, 12 + (k % 2));
    run(sim, FORWARD, 60);
    let ticksToFirst = 0;
    while (sim.world.player.hp === 100 && ticksToFirst < 120) {
      sim.step(FORWARD);
      ticksToFirst++;
    }
    const after = sim.world.player.hp;
    run(sim, FORWARD, FEEL.invulnTicks - 2);
    expect(sim.world.player.hp).toBe(after);
  });

  it('a hit throws the enemies around you back', () => {
    const sim = arena();
    const hitter = place(sim, KIND_SHUFFLER, 0, 12);
    const bystander = place(sim, KIND_SHUFFLER, 2.5, 12.5);
    run(sim, FORWARD, 60);
    while (sim.world.player.hp === 100) sim.step(FORWARD);
    const h = sim.world.horde;
    const m = sim.state.mover;
    for (const i of [hitter, bystander]) {
      // Moving away from the mover, and harmless for now.
      expect((h.x[i] - m.x) * h.vx[i] + (h.z[i] - m.z) * h.vz[i]).toBeGreaterThan(0);
      expect(h.stun[i]).toBeGreaterThan(0);
    }
  });

  it('an enemy still rising out of the ground does nothing', () => {
    const sim = arena();
    const i = spawnEnemy(sim.world, KIND_SHUFFLER, 0, 0, 10);
    for (let t = 0; t < 90; t++) {
      sim.world.horde.age[i] = 0;
      sim.step(FORWARD);
    }
    expect(sim.state.mover.z).toBeGreaterThan(10);
    expect(sim.world.player.hp).toBe(100);
  });

  it('a hop clears a gnat but not a shuffler', () => {
    const over = (kind: number): number => {
      const sim = arena();
      place(sim, kind, 0, 13.5);
      run(sim, FORWARD, 60);
      // Hop so the top of the arc is over the enemy.
      while (sim.state.mover.z < 13.5 - 2.8) sim.step(FORWARD);
      sim.step({ ...FORWARD, hop: true });
      run(sim, FORWARD, 45);
      return sim.world.player.hp;
    };
    expect(over(KIND_GNAT)).toBe(100);
    expect(over(KIND_SHUFFLER)).toBeLessThan(100);
  });
});

describe('at the gear that plows it', () => {
  it('a shuffler is run down: it dies, you are not hurt, and it costs a little speed', () => {
    const sim = arena();
    place(sim, KIND_SHUFFLER, 0, 8);
    launch(sim, 16);
    sim.step(TUCK);
    expect(sim.state.mover.gear).toBe(3);
    const before = sim.state.mover.speed;
    run(sim, TUCK, 40);
    expect(sim.world.player.hp).toBe(100);
    expect(sim.world.player.kills).toBe(1);
    expect(sim.world.horde.count).toBe(0);
    const lost = before - sim.state.mover.speed;
    expect(lost).toBeGreaterThan(FEEL.plowSpeedCost * 0.9);
    expect(lost).toBeLessThan(FEEL.plowSpeedCost + 1.5);
  });

  it('plowing a crowd costs speed for each, until you are no longer plowing', () => {
    const sim = arena();
    for (let k = 0; k < 30; k++) place(sim, KIND_SHUFFLER, ((k % 3) - 1) * 0.5, 8 + k * 1.2);
    launch(sim, 13.5);
    run(sim, TUCK, 240);
    expect(sim.world.player.kills).toBeGreaterThan(3);
    expect(sim.world.player.hp).toBeLessThan(100);
  });
});

describe('losing the gear inside a crowd', () => {
  it('still goes through for a moment, then hurts', () => {
    // A mover that has just dropped out of gear 3 meets a shuffler straight away, or a while later.
    const meet = (ticksAfter: number): number => {
      const sim = arena();
      launch(sim, 16);
      sim.step(TUCK);
      expect(sim.state.mover.gear).toBe(3);
      // Lose the gear without being hit: slow to run speed and let it drop.
      const m = sim.state.mover;
      m.vz = 9;
      while (sim.state.mover.gear > 2) sim.step(FORWARD);
      run(sim, FORWARD, ticksAfter);
      place(sim, KIND_SHUFFLER, sim.state.mover.x, sim.state.mover.z + 1.5);
      run(sim, FORWARD, 20);
      return sim.world.player.hp;
    };
    expect(meet(5)).toBe(100);
    expect(meet(FEEL.plowGraceTicks + 30)).toBeLessThan(100);
  });

  it('a hit ends the grace', () => {
    const sim = arena();
    launch(sim, 16);
    sim.step(TUCK);
    hurtPlayer(sim.world, sim.state, 5);
    // Take the moment of safety away so only the grace could protect now.
    sim.world.player.invuln = 0;
    place(sim, KIND_SHUFFLER, sim.state.mover.x, sim.state.mover.z + 1.5);
    run(sim, FORWARD, 20);
    expect(sim.world.player.hp).toBeLessThan(95);
  });
});

describe('health', () => {
  it('comes back in gear 3 and higher, faster the higher, and not at all below', () => {
    const after = (speed: number): number => {
      const sim = arena(flatTerrain(100000));
      sim.world.player.hp = 50;
      for (let t = 0; t < 600; t++) {
        launch(sim, speed);
        sim.step(TUCK);
      }
      return sim.world.player.hp;
    };
    expect(after(9)).toBe(50);
    expect(after(15)).toBeCloseTo(50 + GEAR_REGEN[2] * 10, 0);
    expect(after(30)).toBeGreaterThan(after(15) + 5);
    // Never past full.
    const sim = arena(flatTerrain(100000));
    for (let t = 0; t < 300; t++) {
      launch(sim, 30);
      sim.step(TUCK);
    }
    expect(sim.world.player.hp).toBe(100);
  });
});

describe('a bollard', () => {
  it('stops you dead and hurts below gear 5, and is not hurt itself', () => {
    const sim = arena();
    const b = place(sim, KIND_BOLLARD, 0, 10);
    launch(sim, 20);
    let minZSpeed = Infinity;
    for (let i = 0; i < 60; i++) {
      sim.step(TUCK);
      minZSpeed = Math.min(minZSpeed, sim.state.mover.vz);
    }
    expect(sim.world.player.hp).toBe(100 - KINDS[KIND_BOLLARD].damage);
    expect(minZSpeed).toBeLessThan(0);
    expect(sim.state.mover.speed).toBeLessThan(FEEL.bonkBounce + 0.5);
    expect(sim.world.horde.hp[b]).toBe(KINDS[KIND_BOLLARD].hp);
    expect(sim.state.mover.z).toBeLessThan(10);
  });

  it('takes your gears with your speed: stopped against it, you do not plow what touches you next', () => {
    const sim = arena();
    place(sim, KIND_BOLLARD, 0, 10);
    launch(sim, 20);
    while (sim.world.player.hp === 100) sim.step(TUCK);
    // Stopped dead: the gear went with the speed, on the same tick.
    expect(sim.state.mover.speed).toBeLessThan(FEEL.bonkBounce + 0.5);
    expect(sim.state.mover.gear).toBe(1);

    // And a gear the mover still shows but no longer has the speed for does not plow either.
    const slow = arena();
    place(slow, KIND_SHUFFLER, 0, 1.5);
    launch(slow, 3);
    slow.state.mover.gear = 4;
    slow.state.mover.gearHold = 0;
    run(slow, FORWARD, 30);
    expect(slow.world.player.hp).toBeLessThan(100);
    expect(slow.world.player.kills).toBe(0);
  });

  it('shatters in gear 5', () => {
    const sim = arena();
    place(sim, KIND_BOLLARD, 0, 10);
    launch(sim, 30);
    run(sim, TUCK, 40);
    expect(sim.world.player.hp).toBe(100);
    expect(sim.world.player.kills).toBe(1);
    expect(sim.state.mover.z).toBeGreaterThan(15);
    expect(sim.state.mover.speed).toBeGreaterThan(20);
  });

  it('cannot be hopped over', () => {
    const sim = arena();
    place(sim, KIND_BOLLARD, 0, 12);
    run(sim, FORWARD, 60);
    while (sim.state.mover.z < 12 - 3.4) sim.step(FORWARD);
    sim.step(hopNow);
    run(sim, FORWARD, 45);
    expect(sim.world.player.hp).toBeLessThan(100);
  });
});

describe('the run', () => {
  it('ends when health runs out, holds still, and starts again on reset', () => {
    const sim = arena();
    sim.world.player.hp = 5;
    place(sim, KIND_SHUFFLER, 0, 12);
    run(sim, FORWARD, 200);
    expect(sim.world.run.phase).toBe(PHASE_DEAD);
    expect(sim.world.player.hp).toBe(0);
    const tick = sim.state.tick;
    const z = sim.state.mover.z;
    run(sim, FORWARD, 30);
    expect(sim.state.tick).toBe(tick);
    expect(sim.state.mover.z).toBe(z);

    sim.reset();
    expect(sim.world.run.phase).toBe(PHASE_PLAY);
    expect(sim.world.player.hp).toBe(100);
    expect(sim.world.horde.count).toBe(0);
    expect(sim.state.tick).toBe(0);
    expect(sim.state.mover.z).toBe(sim.terrain.spawnZ);
    run(sim, FORWARD, 60);
    expect(sim.state.mover.z).toBeGreaterThan(5);
  });

  it('counts what you killed on the tick you died', () => {
    const sim = arena();
    sim.world.player.hp = 1;
    // In gear 3 a shuffler is plowed and a bollard right behind it is not.
    place(sim, KIND_SHUFFLER, 0, 6);
    place(sim, KIND_BOLLARD, 0, 6 + 1.6);
    launch(sim, 16);
    run(sim, TUCK, 60);
    expect(sim.world.run.phase).toBe(PHASE_DEAD);
    expect(sim.world.player.kills).toBe(1);
    expect(sim.world.horde.count).toBe(1);
    expect(sim.state.mover.speed).toBe(0);
  });

  it('is won when the clock runs out', () => {
    const sim = arena();
    run(sim, TUCK, RUN_TICKS - 1);
    expect(sim.world.run.phase).toBe(PHASE_PLAY);
    sim.step(TUCK);
    expect(sim.world.run.phase).toBe(PHASE_WON);
  });
});
