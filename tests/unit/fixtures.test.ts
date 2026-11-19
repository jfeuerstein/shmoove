import { describe, expect, it } from 'vitest';
import {
  applyArsenal,
  applyFixture,
  ARSENAL_LEVEL,
  CROWD_ELITES,
  CROWD_MIX,
  FIXTURE_CLEAR,
  FIXTURE_HP,
  FIXTURE_RADIUS,
  ROW_FAR,
  ROW_KINDS,
  ROW_NEAR,
  ROW_SIDE,
  ZONE_KINDS,
} from '../../src/app/fixtures';
import { WEAPON_COUNT } from '../../src/sim/arsenal';
import { BOWL_RADIUS, makeBowl } from '../../src/sim/bowl';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { makeInputFrame } from '../../src/sim/types';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_NONE,
  ELITE_SHIELD,
  KIND_COUNT,
  KIND_CUTTER,
  KIND_SHUFFLER,
  MARK_ELITE,
  SPAWN_TICKS,
  THING_GATE,
  THING_HOOP,
  ZONE_LOB,
  ZONE_MINE,
  ZONE_TAR,
} from '../../src/sim/world';

function crowd(seed: number, enemies: number, sparks = 0): Sim {
  const sim = new Sim(makeBowl(seed), { seed, horde: true, autoPick: true });
  applyFixture(sim, enemies, sparks);
  return sim;
}

describe('the crowd fixture', () => {
  it('mixes every kind of enemy in the shares of CROWD_MIX', () => {
    expect(CROWD_MIX.length).toBe(KIND_COUNT);
    expect(CROWD_MIX.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    const w = crowd(3, 500).world;
    expect(w.horde.count).toBe(500);
    const n = new Array<number>(KIND_COUNT).fill(0);
    for (let i = 0; i < w.horde.count; i++) n[w.horde.kind[i]]++;
    for (let k = 0; k < KIND_COUNT; k++) {
      // Every kind is there, within a binomial spread of its share.
      const want = CROWD_MIX[k] * 500;
      const spread = 3.5 * Math.sqrt(want * (1 - CROWD_MIX[k]));
      expect(n[k], `kind ${k}`).toBeGreaterThan(0);
      expect(Math.abs(n[k] - want), `kind ${k}`).toBeLessThan(spread);
    }
  });

  it('crowns one elite of each aura, the shufflers and cutters nearest the spawn', () => {
    const sim = crowd(3, 300);
    const w = sim.world;
    const t = sim.terrain;
    const auras: number[] = [];
    let farthestElite = 0;
    for (let i = 0; i < w.horde.count; i++) {
      if (w.horde.elite[i] === ELITE_NONE) continue;
      auras.push(w.horde.elite[i]);
      expect([KIND_SHUFFLER, KIND_CUTTER]).toContain(w.horde.kind[i]);
      expect(w.horde.mark[i] & MARK_ELITE).toBe(MARK_ELITE);
      farthestElite = Math.max(farthestElite, Math.hypot(w.horde.x[i] - t.spawnX, w.horde.z[i] - t.spawnZ));
    }
    expect(auras.sort()).toEqual([ELITE_HASTE, ELITE_SHIELD, ELITE_JAM].sort());
    expect(CROWD_ELITES.length).toBe(3);
    // No ordinary shuffler or cutter is nearer the spawn than the farthest elite.
    for (let i = 0; i < w.horde.count; i++) {
      const k = w.horde.kind[i];
      if (w.horde.elite[i] !== ELITE_NONE || (k !== KIND_SHUFFLER && k !== KIND_CUTTER)) continue;
      expect(Math.hypot(w.horde.x[i] - t.spawnX, w.horde.z[i] - t.spawnZ)).toBeGreaterThanOrEqual(farthestElite);
    }
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

  it('keeps the player hard to kill through levels and cards', () => {
    const sim = crowd(4, 10);
    const w = sim.world;
    w.player.xp += w.player.xpNext * 3;
    const input = makeInputFrame();
    for (let t = 0; t < 5; t++) sim.step(input);
    expect(w.player.level).toBeGreaterThan(1);
    expect(w.player.maxHp).toBeGreaterThanOrEqual(FIXTURE_HP);
    expect(w.player.hp).toBeGreaterThan(FIXTURE_HP * 0.99);
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

describe('the arsenal fixture', () => {
  function arsenal(seed: number, enemies = 0): Sim {
    const sim = new Sim(makeBowl(seed), { seed, horde: true, autoPick: true });
    if (enemies > 0) applyFixture(sim, enemies, 0);
    applyArsenal(sim);
    return sim;
  }

  it('gives the player every weapon at level 3, the slots holding four', () => {
    const w = arsenal(2).world;
    const l = w.player.loadout;
    for (let id = 0; id < WEAPON_COUNT; id++) expect(l.weaponLevel[id], `weapon ${id}`).toBe(ARSENAL_LEVEL);
    expect(Array.from(l.weapons)).toEqual([0, 1, 2, 3]);
    expect(w.player.hp).toBe(FIXTURE_HP);
  });

  it('puts one of each thing in a row 12 to 40 m ahead of the spawn, off to one side, the gate and hoop facing along it', () => {
    const sim = arsenal(4);
    const t = sim.terrain;
    const th = sim.world.things;
    expect(th.count).toBe(ROW_KINDS.length);
    expect(Array.from(th.kind.subarray(0, th.count)).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const fx = Math.sin(t.spawnYaw);
    const fz = Math.cos(t.spawnYaw);
    let last = 0;
    for (let i = 0; i < th.count; i++) {
      const dx = th.x[i] - t.spawnX;
      const dz = th.z[i] - t.spawnZ;
      const ahead = dx * fx + dz * fz;
      expect(ahead).toBeGreaterThanOrEqual(ROW_NEAR - 1e-4);
      expect(ahead).toBeLessThanOrEqual(ROW_FAR + 1e-4);
      expect(ahead).toBeGreaterThan(last);
      last = ahead;
      expect(dx * fz - dz * fx).toBeCloseTo(ROW_SIDE, 4);
      expect(th.state[i]).toBe(0);
      const ground = t.heightAt(th.x[i], th.z[i]);
      if (th.kind[i] === THING_HOOP) expect(th.y[i]).toBeGreaterThan(ground + 1.6);
      else expect(th.y[i]).toBeCloseTo(ground, 4);
      if (th.kind[i] === THING_GATE || th.kind[i] === THING_HOOP) expect(th.yaw[i]).toBeCloseTo(t.spawnYaw, 6);
    }
  });

  it('puts one of each zone on the other side of the way, the lob ring half full', () => {
    const sim = arsenal(4);
    const w = sim.world;
    const z = w.zones;
    const t = sim.terrain;
    for (let i = 0; i < z.count; i++) {
      const side = (z.x[i] - t.spawnX) * Math.cos(t.spawnYaw) - (z.z[i] - t.spawnZ) * Math.sin(t.spawnYaw);
      expect(side).toBeCloseTo(-ROW_SIDE, 4);
    }
    expect(z.count).toBe(ZONE_KINDS.length);
    expect(Array.from(z.kind.subarray(0, z.count)).sort()).toEqual([ZONE_MINE, ZONE_TAR, ZONE_LOB].sort());
    for (let i = 0; i < z.count; i++) {
      if (z.kind[i] === ZONE_LOB) expect(z.age[i]).toBe(z.life[i]);
      else expect(z.life[i]).toBeGreaterThan(60 * 60);
    }
  });

  it('is the same stage every time, and goes back up after a restart', () => {
    const a = arsenal(7, 120).world;
    const b = arsenal(7, 120).world;
    expect(Array.from(b.things.x.subarray(0, b.things.count))).toEqual(Array.from(a.things.x.subarray(0, a.things.count)));
    expect(Array.from(b.zones.z.subarray(0, b.zones.count))).toEqual(Array.from(a.zones.z.subarray(0, a.zones.count)));
    expect(b.horde.count).toBe(120);
    const sim = arsenal(7, 120);
    sim.reset();
    applyFixture(sim, 120, 0);
    applyArsenal(sim);
    expect(sim.world.things.count).toBe(ROW_KINDS.length);
    expect(sim.world.zones.count).toBe(ZONE_KINDS.length);
    expect(sim.world.player.loadout.weaponLevel[WEAPON_COUNT - 1]).toBe(ARSENAL_LEVEL);
  });

  it('runs: every weapon steps against the crowd without the stage breaking', () => {
    const sim = arsenal(5, 120);
    const input = { steerX: 0, steerY: 1, carve: true, hop: false };
    for (let t = 0; t < 300; t++) {
      input.hop = t % 40 === 0;
      input.carve = t < 150;
      sim.step(input);
    }
    expect(sim.world.run.phase).toBe(0);
    expect(sim.world.player.kills).toBeGreaterThan(0);
  });
});
