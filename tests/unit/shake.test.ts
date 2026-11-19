import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  AREA_RANGE,
  LAND_IMPACT,
  MAX_OFFSET,
  MAX_ROLL,
  noise,
  Shake,
  TRAUMA_AREA,
  TRAUMA_BOSS,
  TRAUMA_HIT,
  TRAUMA_SECONDS,
  traumaFor,
} from '../../src/render/shake';
import { Sim } from '../../src/sim/sim';
import { EV_LAND } from '../../src/sim/types';
import { flatTerrain } from '../../src/sim/terrain';
import { emitFx, FX_BLAST, FX_BONK, FX_BOSS_DOWN, FX_BOSS_IN, FX_ENEMY_HIT, FX_PLAYER_HIT, FX_SLAM } from '../../src/sim/world';

function sim(): Sim {
  const s = new Sim(flatTerrain(60), { seed: 1, horde: false });
  s.world.fx.count = 0;
  s.state.events = 0;
  return s;
}

describe('trauma', () => {
  it('is added by the big effects and not by small ones', () => {
    expect(traumaFor(FX_PLAYER_HIT, 0)).toBe(TRAUMA_HIT);
    expect(traumaFor(FX_BONK, 0)).toBeGreaterThan(0);
    expect(traumaFor(FX_BONK, 0)).toBeLessThan(TRAUMA_HIT);
    expect(traumaFor(FX_BOSS_IN, 0)).toBe(TRAUMA_BOSS);
    expect(traumaFor(FX_BOSS_DOWN, 0)).toBe(TRAUMA_BOSS);
    expect(traumaFor(FX_ENEMY_HIT, 0)).toBe(0);
  });

  it('falls off with distance for slams and blasts', () => {
    for (const t of [FX_SLAM, FX_BLAST]) {
      expect(traumaFor(t, 0)).toBe(TRAUMA_AREA);
      expect(traumaFor(t, 5)).toBeLessThan(traumaFor(t, 0));
      expect(traumaFor(t, AREA_RANGE)).toBe(0);
      expect(traumaFor(t, 100)).toBe(0);
    }
  });

  it('is taken from the effects queue and from a hard landing only', () => {
    const s = sim();
    const sk = new Shake();
    emitFx(s.world, FX_PLAYER_HIT, 0, 0, 0, 5);
    sk.ingest(s.world, s.state);
    expect(sk.trauma).toBeCloseTo(TRAUMA_HIT);

    const soft = new Shake();
    s.world.fx.count = 0;
    s.state.events = EV_LAND;
    s.state.mover.impact = LAND_IMPACT - 1;
    soft.ingest(s.world, s.state);
    expect(soft.trauma).toBe(0);
    s.state.mover.impact = LAND_IMPACT + 4;
    soft.ingest(s.world, s.state);
    expect(soft.trauma).toBeGreaterThan(0);
  });

  it('takes a slam near the mover but not one far off', () => {
    const s = sim();
    const near = new Shake();
    const far = new Shake();
    emitFx(s.world, FX_SLAM, s.state.mover.x + 2, 0, s.state.mover.z, 4);
    near.ingest(s.world, s.state);
    s.world.fx.count = 0;
    emitFx(s.world, FX_SLAM, s.state.mover.x + 50, 0, s.state.mover.z, 4);
    far.ingest(s.world, s.state);
    expect(near.trauma).toBeGreaterThan(0);
    expect(far.trauma).toBe(0);
  });

  it('caps at 1 and decays to nothing in about 0.4 s', () => {
    const sk = new Shake();
    sk.add(0.9);
    sk.add(0.9);
    expect(sk.trauma).toBe(1);
    sk.update(TRAUMA_SECONDS / 2);
    expect(sk.trauma).toBeCloseTo(0.5);
    sk.update(TRAUMA_SECONDS);
    expect(sk.trauma).toBe(0);
  });
});

describe('offset', () => {
  it('is zero at zero trauma and bounded at full trauma', () => {
    const sk = new Shake();
    sk.update(1 / 60);
    expect([sk.x, sk.y, sk.roll]).toEqual([0, 0, 0]);
    let worst = 0;
    let worstRoll = 0;
    for (let i = 0; i < 2000; i++) {
      sk.trauma = 1;
      sk.update(1 / 60);
      worst = Math.max(worst, Math.abs(sk.x), Math.abs(sk.y));
      worstRoll = Math.max(worstRoll, Math.abs(sk.roll));
    }
    expect(worst).toBeLessThanOrEqual(MAX_OFFSET);
    expect(worst).toBeGreaterThan(MAX_OFFSET * 0.3);
    expect(worstRoll).toBeLessThanOrEqual(MAX_ROLL);
    // A jolt, not a blur: a few centimetres and under two degrees.
    expect(MAX_OFFSET).toBeLessThanOrEqual(0.06);
    expect(MAX_ROLL).toBeLessThanOrEqual((2 * Math.PI) / 180);
  });

  it('scales with trauma squared', () => {
    const a = new Shake();
    const b = new Shake();
    a.trauma = 1;
    b.trauma = 0.5;
    a.update(0);
    b.update(0);
    expect(Math.abs(a.x)).toBeGreaterThan(0);
    expect(b.x / a.x).toBeCloseTo(0.25, 6);
  });

  it('is the same for the same inputs', () => {
    const run = (): number[] => {
      const sk = new Shake();
      const out: number[] = [];
      sk.add(0.8);
      for (let i = 0; i < 20; i++) {
        sk.update(1 / 60);
        out.push(sk.x, sk.y, sk.roll);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('noise is smooth and bounded', () => {
    let prev = noise(0, 0);
    for (let t = 0.01; t < 50; t += 0.01) {
      const v = noise(t, 0);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
  });

  it('moves the camera, and leaves it alone at zero', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(1, 2, 3);
    const sk = new Shake();
    sk.apply(cam);
    expect(cam.position.toArray()).toEqual([1, 2, 3]);
    sk.add(1);
    sk.update(1 / 60);
    sk.apply(cam);
    const moved = cam.position.distanceTo(new Vector3(1, 2, 3));
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(MAX_OFFSET * Math.SQRT2 + 1e-9);
  });
});

describe('reduced motion', () => {
  it('turns shake off', () => {
    const s = sim();
    const sk = new Shake();
    sk.enabled = false;
    sk.add(1);
    emitFx(s.world, FX_PLAYER_HIT, 0, 0, 0, 5);
    sk.ingest(s.world, s.state);
    sk.update(1 / 60);
    expect(sk.trauma).toBe(0);
    expect([sk.x, sk.y, sk.roll]).toEqual([0, 0, 0]);
  });

  it('cuts a shake in progress', () => {
    const sk = new Shake();
    sk.add(1);
    sk.enabled = false;
    sk.update(1 / 60);
    expect(sk.trauma).toBe(0);
  });
});
