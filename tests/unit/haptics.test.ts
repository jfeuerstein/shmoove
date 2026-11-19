import { describe, expect, it } from 'vitest';
import {
  Haptics,
  HAPTIC_MIN_GAP_MS,
  patternForEvents,
  patternForFx,
  PATTERN_BOSS,
  PATTERN_HIT,
  PATTERN_HOP,
  PATTERN_LEVEL,
  type Pattern,
} from '../../src/app/haptics';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { EV_CLEAN_HOP, EV_HOP } from '../../src/sim/types';
import { emitFx, FX_BOSS_DOWN, FX_BOSS_IN, FX_LEVEL_UP, FX_PLAYER_HIT, FX_SLAM } from '../../src/sim/world';

function rig(): { sim: Sim; calls: Pattern[]; time: { t: number }; h: Haptics } {
  const sim = new Sim(flatTerrain(60), { seed: 1, horde: false });
  sim.world.fx.count = 0;
  sim.state.events = 0;
  const calls: Pattern[] = [];
  const time = { t: 1000 };
  const h = new Haptics(
    (p) => {
      calls.push(p);
      return true;
    },
    () => time.t,
  );
  return { sim, calls, time, h };
}

describe('haptic patterns', () => {
  it('has one for each thing that should buzz', () => {
    expect(patternForFx(FX_PLAYER_HIT)).toBe(PATTERN_HIT);
    expect(patternForFx(FX_LEVEL_UP)).toEqual(PATTERN_LEVEL);
    expect(PATTERN_LEVEL.length).toBe(3);
    expect(patternForFx(FX_BOSS_IN)).toBe(PATTERN_BOSS);
    expect(patternForFx(FX_BOSS_DOWN)).toBe(PATTERN_BOSS);
    expect(PATTERN_BOSS).toBeGreaterThan(PATTERN_HIT);
    expect(patternForFx(FX_SLAM)).toBe(0);
    expect(patternForEvents(EV_CLEAN_HOP)).toBe(PATTERN_HOP);
    expect(PATTERN_HOP).toBeLessThan(PATTERN_HIT);
    expect(patternForEvents(EV_HOP)).toBe(0);
  });
});

describe('Haptics', () => {
  it('vibrates for a hit, a clean ollie and a level', () => {
    const { sim, calls, time, h } = rig();
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    h.ingest(sim.world, sim.state);
    sim.world.fx.count = 0;
    time.t += 100;
    sim.state.events = EV_CLEAN_HOP;
    h.ingest(sim.world, sim.state);
    sim.state.events = 0;
    time.t += 100;
    emitFx(sim.world, FX_LEVEL_UP, 0, 0, 0, 2);
    h.ingest(sim.world, sim.state);
    expect(calls).toEqual([PATTERN_HIT, PATTERN_HOP, PATTERN_LEVEL]);
  });

  it('plays the stronger of two in one tick', () => {
    const { sim, calls, h } = rig();
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    emitFx(sim.world, FX_BOSS_IN, 0, 0, 0, 0);
    h.ingest(sim.world, sim.state);
    expect(calls).toEqual([PATTERN_BOSS]);
  });

  it('is called at most once per 50 ms', () => {
    const { sim, calls, time, h } = rig();
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    h.ingest(sim.world, sim.state);
    time.t += HAPTIC_MIN_GAP_MS - 1;
    h.ingest(sim.world, sim.state);
    expect(calls.length).toBe(1);
    time.t += 1;
    h.ingest(sim.world, sim.state);
    expect(calls.length).toBe(2);
  });

  it('is silent when the setting is off', () => {
    const { sim, calls, h } = rig();
    h.enabled = false;
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    h.ingest(sim.world, sim.state);
    h.play(PATTERN_BOSS);
    expect(calls).toEqual([]);
  });

  it('is silent, and does not throw, with no vibrate', () => {
    const { sim } = rig();
    const h = new Haptics(null, () => 0);
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    expect(() => h.ingest(sim.world, sim.state)).not.toThrow();
    expect(() => h.play(PATTERN_HIT)).not.toThrow();
  });

  it('survives a vibrate that throws', () => {
    const { sim, time } = rig();
    const h = new Haptics(() => {
      throw new Error('blocked');
    }, () => time.t);
    emitFx(sim.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    expect(() => h.ingest(sim.world, sim.state)).not.toThrow();
  });
});
