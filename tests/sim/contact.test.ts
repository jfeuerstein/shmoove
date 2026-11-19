/** What a player would notice touching the horde: it hurts, at any speed, and then there is room. */
import { describe, expect, it } from 'vitest';
import { P_HIDE, P_REGEN, W_BUMPER, W_WAKE } from '../../src/sim/arsenal';
import { RUN_TICKS } from '../../src/sim/balance';
import { setPassiveLevel, setWeaponLevel } from '../../src/sim/build';
import { FEEL } from '../../src/sim/constants';
import { BUMPER } from '../../src/sim/stats';
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

describe('touching an enemy', () => {
  it('hurts at walking pace and at full tilt alike', () => {
    for (const speed of [4, 12, 30]) {
      const sim = arena();
      // Nothing of the player's own may hurt it: this is about the touch.
      setWeaponLevel(sim.world, W_WAKE, 0);
      place(sim, KIND_SHUFFLER, 0, 8);
      launch(sim, speed);
      for (let t = 0; t < 300 && sim.world.player.hp === 100; t++) sim.step(TUCK);
      expect(sim.world.player.hp, `at ${speed} m/s`).toBe(100 - KINDS[KIND_SHUFFLER].damage);
      // And the enemy is none the worse for it.
      expect(sim.world.player.kills).toBe(0);
    }
  });

  it('does not take your speed or your gear', () => {
    const sim = arena();
    place(sim, KIND_SHUFFLER, 0, 8);
    launch(sim, 20);
    sim.step(TUCK);
    const gear = sim.state.mover.gear;
    let before = sim.state.mover.speed;
    while (sim.world.player.hp === 100) {
      before = sim.state.mover.speed;
      sim.step(TUCK);
    }
    expect(sim.state.mover.speed).toBeGreaterThan(before - 0.2);
    expect(sim.state.mover.gear).toBe(gear);
  });

  it('gives a moment when nothing else can hurt', () => {
    const sim = arena();
    for (let k = 0; k < 6; k++) place(sim, KIND_SHUFFLER, (k - 2.5) * 0.9, 12 + (k % 2));
    run(sim, FORWARD, 60);
    while (sim.world.player.hp === 100) sim.step(FORWARD);
    const after = sim.world.player.hp;
    expect(sim.world.player.invuln).toBeGreaterThan(0);
    run(sim, FORWARD, FEEL.invulnTicks - 2);
    expect(sim.world.player.hp).toBe(after);
  });

  it('throws the enemies around you back, harmless for a while', () => {
    const sim = arena();
    const hitter = place(sim, KIND_SHUFFLER, 0, 12);
    const bystander = place(sim, KIND_SHUFFLER, 2.5, 12.5);
    run(sim, FORWARD, 60);
    while (sim.world.player.hp === 100) sim.step(FORWARD);
    const h = sim.world.horde;
    const m = sim.state.mover;
    for (const i of [hitter, bystander]) {
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

describe('a bollard', () => {
  it('is in the way: it hurts, it is not hurt, and you do not go through it', () => {
    const sim = arena();
    const b = place(sim, KIND_BOLLARD, 0, 10);
    launch(sim, 20);
    run(sim, TUCK, 60);
    expect(sim.world.player.hp).toBe(100 - KINDS[KIND_BOLLARD].damage);
    expect(sim.world.horde.hp[b]).toBe(KINDS[KIND_BOLLARD].hp);
    expect(sim.state.mover.z).toBeLessThan(10);
  });

  it('lets a glancing touch slide round', () => {
    const sim = arena();
    place(sim, KIND_BOLLARD, 0, 10);
    sim.state.mover.x = KINDS[KIND_BOLLARD].radius + 0.2;
    launch(sim, 15);
    run(sim, TUCK, 90);
    expect(sim.state.mover.z).toBeGreaterThan(14);
    expect(sim.state.mover.speed).toBeGreaterThan(8);
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

describe('the build and being hit', () => {
  it('Hide takes a little off every hit', () => {
    const sim = arena();
    setPassiveLevel(sim.world, P_HIDE, 3);
    place(sim, KIND_SHUFFLER, 0, 8);
    launch(sim, 10);
    for (let t = 0; t < 300 && sim.world.player.hp === 100; t++) sim.step(TUCK);
    expect(sim.world.player.hp).toBe(100 - (KINDS[KIND_SHUFFLER].damage - 3));
  });

  it('the Bumper hurts everything the hit throws back', () => {
    const hurtOthers = (level: number): number => {
      const sim = arena();
      setWeaponLevel(sim.world, W_BUMPER, level);
      const a = place(sim, KIND_BOLLARD, 30, 30);
      const near = place(sim, KIND_SHUFFLER, 0, 8);
      place(sim, KIND_SHUFFLER, 1.6, 8.6);
      launch(sim, 10);
      while (sim.world.player.hp === 100) sim.step(TUCK);
      void a;
      return KINDS[KIND_SHUFFLER].hp - Math.max(0, sim.world.horde.hp[near]);
    };
    expect(hurtOthers(0)).toBe(0);
    expect(hurtOthers(1)).toBe(Math.min(KINDS[KIND_SHUFFLER].hp, BUMPER.thorns[0]));
  });

  it('Regen brings health back at any speed, standing still included; nothing else does', () => {
    const after = (level: number, speed: number): number => {
      const sim = arena();
      setPassiveLevel(sim.world, P_REGEN, level);
      sim.world.player.hp = 50;
      for (let t = 0; t < 600; t++) {
        launch(sim, speed);
        sim.step(TUCK);
      }
      return sim.world.player.hp;
    };
    expect(after(0, 0)).toBe(50);
    expect(after(0, 30)).toBe(50);
    expect(after(5, 0)).toBeCloseTo(50 + 1.6 * 10, 0);
    expect(after(5, 30)).toBeCloseTo(after(5, 0), 3);
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
    expect(sim.state.mover.speed).toBe(0);
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

  it('is won when the clock runs out', () => {
    const sim = arena();
    run(sim, TUCK, RUN_TICKS - 1);
    expect(sim.world.run.phase).toBe(PHASE_PLAY);
    sim.step(TUCK);
    expect(sim.world.run.phase).toBe(PHASE_WON);
  });
});
