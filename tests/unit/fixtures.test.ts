import { describe, expect, it } from 'vitest';
import { applyFixture, FIXTURE_CLEAR, FIXTURE_HP, FIXTURE_RADIUS } from '../../src/app/fixtures';
import { BOWL_RADIUS, makeBowl } from '../../src/sim/bowl';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { makeInputFrame } from '../../src/sim/types';
import { KIND_BOLLARD, KIND_GNAT, KIND_SHUFFLER, SPAWN_TICKS } from '../../src/sim/world';

function crowd(seed: number, enemies: number, sparks = 0): Sim {
  const sim = new Sim(makeBowl(seed), { seed, horde: true, autoPick: true });
  applyFixture(sim, enemies, sparks);
  return sim;
}

describe('the crowd fixture', () => {
  it('mixes the kinds about 80 / 15 / 5', () => {
    const w = crowd(3, 500).world;
    expect(w.horde.count).toBe(500);
    const n = [0, 0, 0];
    for (let i = 0; i < w.horde.count; i++) {
      const k = w.horde.kind[i];
      if (k === KIND_SHUFFLER) n[0]++;
      else if (k === KIND_GNAT) n[1]++;
      else if (k === KIND_BOLLARD) n[2]++;
    }
    expect(n[0] + n[1] + n[2]).toBe(500);
    expect(n[0] / 500).toBeGreaterThan(0.74);
    expect(n[0] / 500).toBeLessThan(0.86);
    expect(n[1] / 500).toBeGreaterThan(0.10);
    expect(n[1] / 500).toBeLessThan(0.20);
    expect(n[2] / 500).toBeGreaterThan(0.02);
    expect(n[2] / 500).toBeLessThan(0.09);
  });

  it('keeps every enemy and spark 8 m clear of the spawn, within the disc and inside the map', () => {
    expect(FIXTURE_CLEAR).toBe(8);
    for (const terrain of [makeBowl(5), flatTerrain(BOWL_RADIUS)]) {
      const sim = new Sim(terrain, { seed: 5, horde: true, autoPick: true });
      applyFixture(sim, 500, 600);
      const w = sim.world;
      const within = (x: number, z: number): void => {
        const d = Math.hypot(x - terrain.spawnX, z - terrain.spawnZ);
        expect(d).toBeGreaterThanOrEqual(FIXTURE_CLEAR - 1e-6);
        expect(d).toBeLessThanOrEqual(FIXTURE_RADIUS + 1e-6);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(terrain.radius);
      };
      for (let i = 0; i < w.horde.count; i++) within(w.horde.x[i], w.horde.z[i]);
      for (let i = 0; i < w.sparks.count; i++) within(w.sparks.x[i], w.sparks.z[i]);
      expect(w.sparks.count).toBe(600);
    }
  });

  it('puts the enemies down already risen', () => {
    const w = crowd(2, 50).world;
    for (let i = 0; i < w.horde.count; i++) expect(w.horde.age[i]).toBeGreaterThanOrEqual(SPAWN_TICKS);
  });

  it('is the same crowd for the same seed and a different one for another', () => {
    const a = crowd(9, 300, 100).world;
    const b = crowd(9, 300, 100).world;
    const c = crowd(10, 300, 100).world;
    const xs = (w: typeof a): number[] => Array.from(w.horde.x.subarray(0, 300));
    expect(xs(b)).toEqual(xs(a));
    expect(Array.from(b.horde.z.subarray(0, 300))).toEqual(Array.from(a.horde.z.subarray(0, 300)));
    expect(Array.from(b.horde.kind.subarray(0, 300))).toEqual(Array.from(a.horde.kind.subarray(0, 300)));
    expect(Array.from(b.sparks.x.subarray(0, 100))).toEqual(Array.from(a.sparks.x.subarray(0, 100)));
    expect(xs(c)).not.toEqual(xs(a));
  });

  it('turns the spawn director off: nobody joins the crowd', () => {
    const sim = crowd(4, 100);
    expect(sim.world.spawning).toBe(false);
    const input = makeInputFrame();
    for (let t = 0; t < 600; t++) sim.step(input);
    // Some of the crowd may die in ten seconds; none may arrive.
    expect(sim.world.horde.count + sim.world.player.kills).toBe(100);
  });

  it('makes the player hard to kill, so a measurement is not cut short', () => {
    const w = crowd(4, 10).world;
    expect(w.player.hp).toBe(FIXTURE_HP);
    expect(w.player.maxHp).toBe(FIXTURE_HP);
    // And a plain run is left alone.
    const plain = new Sim(flatTerrain(BOWL_RADIUS), { seed: 4, horde: true, autoPick: true });
    applyFixture(plain, 0, 0);
    expect(plain.world.player.maxHp).toBeLessThan(FIXTURE_HP);
  });

  it('puts the same crowd back when applied again after a restart', () => {
    const sim = crowd(6, 200, 50);
    const before = Array.from(sim.world.horde.x.subarray(0, 200));
    sim.reset();
    expect(sim.world.horde.count).toBe(0);
    applyFixture(sim, 200, 50);
    expect(sim.world.horde.count).toBe(200);
    expect(sim.world.sparks.count).toBe(50);
    expect(Array.from(sim.world.horde.x.subarray(0, 200))).toEqual(before);
    expect(sim.world.spawning).toBe(false);
  });
});
