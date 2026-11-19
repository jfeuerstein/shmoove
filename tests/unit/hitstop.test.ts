import { describe, expect, it } from 'vitest';
import { HitStop, HITSTOP_BOSS, HITSTOP_HIT, HITSTOP_SCALE } from '../../src/app/hitstop';
import { RAMP_SECONDS, RAMP_START, TimeRamp } from '../../src/app/loop';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { emitFx, FX_BOSS_DOWN, FX_PLAYER_HIT, FX_SLAM } from '../../src/sim/world';

/** Frames of `dt` until the stop is over. */
function framesActive(h: HitStop, dt: number): number {
  let n = 0;
  while (h.active && n < 10000) {
    h.update(dt);
    n++;
  }
  return n;
}

describe('hit-stop', () => {
  it('is normal speed until something happens', () => {
    const h = new HitStop();
    h.update(0.016);
    expect(h.scale).toBe(1);
    expect(h.active).toBe(false);
  });

  it('runs at 0.05 for 70 ms after a hit, then goes back', () => {
    expect(HITSTOP_SCALE).toBe(0.05);
    expect(HITSTOP_HIT).toBe(0.07);
    const h = new HitStop();
    h.trigger(HITSTOP_HIT);
    expect(h.scale).toBe(HITSTOP_SCALE);
    h.update(0.06);
    expect(h.scale).toBe(HITSTOP_SCALE);
    h.update(0.011);
    expect(h.scale).toBe(1);
  });

  it('lasts 250 ms for a boss falling', () => {
    expect(HITSTOP_BOSS).toBe(0.25);
    const h = new HitStop();
    h.trigger(HITSTOP_BOSS);
    expect(framesActive(h, 0.01)).toBe(25);
  });

  it('is started by the effects queue: a hit and a boss, not a slam', () => {
    const s = new Sim(flatTerrain(60), { seed: 1, horde: false });
    const h = new HitStop();
    s.world.fx.count = 0;
    emitFx(s.world, FX_SLAM, 0, 0, 0, 3);
    h.ingest(s.world);
    expect(h.active).toBe(false);
    emitFx(s.world, FX_PLAYER_HIT, 0, 0, 0, 3);
    h.ingest(s.world);
    expect(framesActive(h, 0.01)).toBe(7);
    s.world.fx.count = 0;
    emitFx(s.world, FX_BOSS_DOWN, 0, 0, 0, 0);
    h.ingest(s.world);
    expect(framesActive(h, 0.01)).toBe(25);
  });

  it('keeps the longer stop when a shorter one lands inside it', () => {
    const h = new HitStop();
    h.trigger(HITSTOP_BOSS);
    h.trigger(HITSTOP_HIT);
    expect(framesActive(h, 0.01)).toBe(25);
  });

  it('composes with the card ramp, a hit inside the ramp', () => {
    const ramp = new TimeRamp();
    const h = new HitStop();
    ramp.begin();
    expect(ramp.scale * h.scale).toBeCloseTo(RAMP_START);
    h.trigger(HITSTOP_HIT);
    expect(ramp.scale * h.scale).toBeCloseTo(RAMP_START * HITSTOP_SCALE);
    ramp.update(0.1);
    h.update(0.1);
    // The stop is over and the ramp carried on underneath it.
    expect(h.scale).toBe(1);
    expect(ramp.scale).toBeCloseTo(RAMP_START + (1 - RAMP_START) * (0.1 / RAMP_SECONDS));
  });

  it('composes with the card ramp, the ramp starting inside a stop', () => {
    const ramp = new TimeRamp();
    const h = new HitStop();
    h.trigger(HITSTOP_HIT);
    ramp.begin();
    expect(ramp.scale * h.scale).toBeCloseTo(RAMP_START * HITSTOP_SCALE);
    h.update(0.08);
    ramp.update(0.08);
    expect(h.scale).toBe(1);
    expect(ramp.scale).toBeGreaterThan(RAMP_START);
    ramp.update(1);
    expect(ramp.scale * h.scale).toBe(1);
  });

  it('is turned off by reduced motion, before or during a stop', () => {
    const h = new HitStop();
    h.enabled = false;
    h.trigger(HITSTOP_BOSS);
    expect(h.scale).toBe(1);
    const g = new HitStop();
    g.trigger(HITSTOP_BOSS);
    g.enabled = false;
    g.update(0.001);
    expect(g.scale).toBe(1);
  });
});
