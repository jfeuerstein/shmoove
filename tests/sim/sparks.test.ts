/** What a player would notice about sparks: the dead drop them, the magnet draws them, XP is levels. */
import { describe, expect, it } from 'vitest';
import { LEVEL_GRANTS, MAGNET_BASE, MAGNET_PER_GEAR, WEAPON_MAX_LEVEL, xpForLevel } from '../../src/sim/balance';
import type { Sim } from '../../src/sim/sim';
import { SPARK_CAP } from '../../src/sim/sparks';
import { FX_LEVEL_UP, FX_SPARK, KIND_BOLLARD, KIND_SHUFFLER, KINDS, MARK_SWEPT, SPAWN_TICKS } from '../../src/sim/world';
import { FORWARD, run, TUCK } from './fixtures';
import { arena, place, root, stepCounting } from './world-fixtures';

/** Put a resting spark in the world. */
function addSpark(sim: Sim, x: number, z: number, value: number, pull = 0): number {
  const s = sim.world.sparks;
  const i = s.count++;
  s.x[i] = x;
  s.y[i] = 0.5;
  s.z[i] = z;
  s.value[i] = value;
  s.pull[i] = pull;
  return i;
}

/** A point on the ground `d` metres from the mover along `bearing` radians off its heading. */
function pointAt(sim: Sim, d: number, bearing = 0): { x: number; z: number } {
  const m = sim.state.mover;
  const a = m.heading + bearing;
  return { x: m.x + Math.sin(a) * d, z: m.z + Math.cos(a) * d };
}

/** Kill enemy i the way the game does: its health runs out and the reaper takes it next tick. */
function kill(sim: Sim, i: number): void {
  sim.world.horde.hp[i] = 0;
}

describe('drops', () => {
  it('a killed shuffler leaves one spark where it died, worth its xp, just above the ground', () => {
    const sim = arena();
    const at = pointAt(sim, 40);
    const e = place(sim, KIND_SHUFFLER, at.x, at.z);
    kill(sim, e);
    // Rooted, so "where it died" is where it was placed.
    root(sim.world);
    sim.step(TUCK);
    const s = sim.world.sparks;
    expect(s.count).toBe(1);
    expect(s.x[0]).toBeCloseTo(at.x, 3);
    expect(s.z[0]).toBeCloseTo(at.z, 3);
    expect(s.y[0]).toBeCloseTo(0.5, 3);
    expect(s.value[0]).toBe(KINDS[KIND_SHUFFLER].xp);
    expect(s.pull[0]).toBe(0);
  });

  it('a spark out of magnet range stays put for ten seconds', () => {
    const sim = arena();
    const at = pointAt(sim, MAGNET_BASE + 6);
    addSpark(sim, at.x, at.z, 1);
    run(sim, TUCK, 600);
    const s = sim.world.sparks;
    expect(s.count).toBe(1);
    expect(s.x[0]).toBe(at.x);
    expect(s.z[0]).toBe(at.z);
    expect(sim.world.player.xp).toBe(0);
  });

  it('a spark from a death inside a swept loop flies in from far away', () => {
    const sim = arena();
    const at = pointAt(sim, 60);
    const e = place(sim, KIND_SHUFFLER, at.x, at.z);
    sim.world.horde.mark[e] = MARK_SWEPT;
    kill(sim, e);
    sim.step(TUCK);
    expect(sim.world.sparks.count).toBe(1);
    expect(sim.world.sparks.pull[0]).toBe(1);
    run(sim, TUCK, 60 * 5);
    expect(sim.world.sparks.count).toBe(0);
    expect(sim.world.player.xp).toBe(KINDS[KIND_SHUFFLER].xp);
  });
});

describe('the magnet', () => {
  it('walking near a spark pulls it in and its value becomes xp', () => {
    const sim = arena();
    const at = pointAt(sim, 12);
    addSpark(sim, at.x, at.z, 2);
    const counts = new Map<number, number>();
    stepCounting(sim, FORWARD, 120, counts);
    expect(sim.world.sparks.count).toBe(0);
    expect(sim.world.player.xp).toBe(2);
    expect(counts.get(FX_SPARK)).toBe(1);
  });

  it('is wider in a higher gear', () => {
    const pulled = (gear: number): number => {
      const sim = arena();
      const at = pointAt(sim, MAGNET_BASE + MAGNET_PER_GEAR * 2 - 0.5);
      addSpark(sim, at.x, at.z, 1);
      sim.state.mover.gear = gear;
      sim.step(TUCK);
      return sim.world.sparks.pull[0];
    };
    expect(pulled(1)).toBe(0);
    expect(pulled(3)).toBe(1);
  });

  it('a pulled spark keeps coming even if the mover moves out of magnet range', () => {
    const sim = arena();
    const at = pointAt(sim, 3);
    addSpark(sim, at.x, at.z, 1, 1);
    run(sim, FORWARD, 90);
    expect(sim.world.player.xp).toBe(1);
  });
});

describe('the cap', () => {
  it('merges values into a neighbour and loses no xp', () => {
    const sim = arena();
    const s = sim.world.sparks;
    for (let i = 0; i < SPARK_CAP; i++) {
      addSpark(sim, 100 + (i % 30) * 3, 100 + Math.floor(i / 30) * 3, 1);
    }
    const before = s.value.slice(0, s.count).reduce((a, b) => a + b, 0);
    let added = 0;
    for (let i = 0; i < 6; i++) {
      const e = place(sim, KIND_BOLLARD, 105 + i * 2, 105);
      kill(sim, e);
      added += KINDS[KIND_BOLLARD].xp;
    }
    sim.step(TUCK);
    expect(s.count).toBe(SPARK_CAP);
    const after = s.value.slice(0, s.count).reduce((a, b) => a + b, 0);
    expect(after).toBe(before + added);
  });

  it('with no spark within 8 m, merges into the first', () => {
    const sim = arena();
    const s = sim.world.sparks;
    for (let i = 0; i < SPARK_CAP; i++) addSpark(sim, 200 + i, 300, 1);
    const e = place(sim, KIND_BOLLARD, -100, -100);
    kill(sim, e);
    sim.step(TUCK);
    expect(s.count).toBe(SPARK_CAP);
    expect(s.value[0]).toBe(1 + KINDS[KIND_BOLLARD].xp);
  });
});

describe('levels', () => {
  it('go up at the thresholds, one spark at a time', () => {
    const sim = arena();
    const p = sim.world.player;
    const first = p.xpNext;
    addSpark(sim, sim.state.mover.x, sim.state.mover.z, first - 0.5, 1);
    sim.step(TUCK);
    sim.step(TUCK);
    expect(p.level).toBe(1);
    addSpark(sim, sim.state.mover.x, sim.state.mover.z, 0.5, 1);
    const counts = new Map<number, number>();
    stepCounting(sim, TUCK, 3, counts);
    expect(p.level).toBe(2);
    expect(p.xp).toBeCloseTo(0, 5);
    expect(p.xpNext).toBe(xpForLevel(2));
    expect(counts.get(FX_LEVEL_UP)).toBe(1);
  });

  it('grant the weapons in LEVEL_GRANTS order', () => {
    const sim = arena();
    const p = sim.world.player;
    let seekers = p.seekersLevel;
    let wake = p.wakeLevel;
    for (let lvl = 2; lvl <= 5; lvl++) {
      p.xp = p.xpNext;
      sim.step(TUCK);
      expect(p.level).toBe(lvl);
      if (LEVEL_GRANTS[lvl - 2] === 'seekers') seekers++;
      else wake++;
      expect(p.seekersLevel).toBe(seekers);
      expect(p.wakeLevel).toBe(wake);
    }
  });

  it('stop raising a weapon at the maximum', () => {
    const sim = arena();
    const p = sim.world.player;
    p.seekersLevel = WEAPON_MAX_LEVEL;
    p.wakeLevel = WEAPON_MAX_LEVEL;
    p.xp = 100000;
    sim.step(TUCK);
    expect(p.seekersLevel).toBe(WEAPON_MAX_LEVEL);
    expect(p.wakeLevel).toBe(WEAPON_MAX_LEVEL);
    expect(p.level).toBeGreaterThan(LEVEL_GRANTS.length + 1);
  });

  it('several levels from one big spark all happen', () => {
    const sim = arena();
    const p = sim.world.player;
    addSpark(sim, sim.state.mover.x, sim.state.mover.z, 60, 1);
    const counts = new Map<number, number>();
    stepCounting(sim, TUCK, 5, counts);
    // Four levels' worth, whatever the curve is, with the rest left over.
    const four = xpForLevel(1) + xpForLevel(2) + xpForLevel(3) + xpForLevel(4);
    expect(four).toBeLessThanOrEqual(60);
    expect(four + xpForLevel(5)).toBeGreaterThan(60);
    expect(p.level).toBe(5);
    expect(counts.get(FX_LEVEL_UP)).toBe(4);
    expect(p.xp).toBeCloseTo(60 - four, 4);
    expect(p.seekersLevel).toBe(2);
    expect(p.wakeLevel).toBe(3);
  });

  it('a risen enemy placed on top of nothing does not disturb xp', () => {
    const sim = arena();
    const at = pointAt(sim, 30);
    place(sim, KIND_SHUFFLER, at.x, at.z);
    for (let t = 0; t < SPAWN_TICKS; t++) {
      root(sim.world);
      sim.step(TUCK);
    }
    expect(sim.world.player.xp).toBe(0);
  });
});
