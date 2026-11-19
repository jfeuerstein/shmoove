/** What a player would notice about Seekers: a volley every second or so, moving or not, and darts find enemies. */
import { setPassiveLevel, setWeaponLevel } from '../../src/sim/build';
import { P_HASTE, W_SEEKERS } from '../../src/sim/arsenal';
import { describe, expect, it } from 'vitest';
import { DART_LIFE_TICKS, SEEKERS } from '../../src/sim/seekers';
import type { Sim } from '../../src/sim/sim';
import { hashWorld, KIND_BOLLARD, KIND_SHUFFLER, KINDS, MAX_SHOTS, removeEnemy, spawnEnemy, FX_SHOT } from '../../src/sim/world';
import { FORWARD, run, steer, TUCK } from './fixtures';
import { arena, place, root, stepCounting } from './world-fixtures';

/** A ground point `d` metres from the mover, `bearing` radians off its heading. */
function pointAt(sim: Sim, d: number, bearing = 0): { x: number; z: number } {
  const m = sim.state.mover;
  const a = m.heading + bearing;
  return { x: m.x + Math.sin(a) * d, z: m.z + Math.cos(a) * d };
}

/** The wait between volleys now, s. */
function waitNow(sim: Sim): number {
  return SEEKERS.wait[sim.world.player.loadout.weaponLevel[W_SEEKERS] - 1] * sim.world.player.stats.haste;
}

/** Force the next step to fire if it can. */
function charge(sim: Sim): void {
  sim.world.seekerMeter = waitNow(sim);
}

describe('the wait', () => {
  it('fires nothing at level 0', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 0);
    const at = pointAt(sim, 15);
    place(sim, KIND_BOLLARD, at.x, at.z);
    const counts = new Map<number, number>();
    for (let t = 0; t < 600; t++) {
      root(sim.world);
      stepCounting(sim, FORWARD, 1, counts);
    }
    expect(counts.get(FX_SHOT) ?? 0).toBe(0);
    expect(sim.world.seekerMeter).toBe(0);
  });

  /** Volleys over `ticks` with a tough target always in range, and the tick of the first. */
  function volleys(sim: Sim, input: typeof FORWARD, ticks: number): { count: number; first: number; darts: number } {
    const e = place(sim, KIND_BOLLARD, 0, 0);
    const h = sim.world.horde;
    let count = 0;
    let first = -1;
    let darts = 0;
    for (let t = 1; t <= ticks; t++) {
      // A tough target that keeps pace ahead of the mover so there is always something in range.
      const a = pointAt(sim, 12);
      h.x[e] = a.x;
      h.z[e] = a.z;
      h.hp[e] = 1000;
      root(sim.world);
      const counts = new Map<number, number>();
      stepCounting(sim, input, 1, counts);
      const n = counts.get(FX_SHOT) ?? 0;
      if (n > 0) {
        count++;
        darts += n;
        if (first < 0) first = t;
      }
    }
    return { count, first, darts };
  }

  for (let level = 1; level <= 5; level++) {
    it(`level ${level}: a volley every wait, the first after a full wait, standing or riding`, () => {
      for (const input of [TUCK, FORWARD]) {
        const sim = arena();
        setWeaponLevel(sim.world, W_SEEKERS, level);
        const wait = Math.round(SEEKERS.wait[level - 1] * 60);
        const got = volleys(sim, input, 60 * 20);
        expect(got.first).toBe(wait);
        expect(got.count).toBe(Math.floor((60 * 20) / wait));
        expect(got.darts).toBe(got.count * SEEKERS.darts[level - 1]);
      }
    });
  }

  it('Haste shortens the wait in proportion', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 2);
    setPassiveLevel(sim.world, P_HASTE, 5);
    const k = sim.world.player.stats.haste;
    expect(k).toBeLessThan(0.75);
    const got = volleys(sim, TUCK, 60 * 30);
    expect(Math.abs(got.count - 30 / (SEEKERS.wait[1] * k))).toBeLessThanOrEqual(1);
  });
});

describe('a volley', () => {
  it('sends darts to different targets when there are enough', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 3);
    const l = pointAt(sim, 12, -1.2);
    const r = pointAt(sim, 12, 1.2);
    const a = place(sim, KIND_BOLLARD, l.x, l.z);
    const b = place(sim, KIND_BOLLARD, r.x, r.z);
    charge(sim);
    sim.step(TUCK);
    const sh = sim.world.shots;
    expect(sh.count).toBe(2);
    const m = sim.state.mover;
    const side = (i: number): number => (sh.x[i] - m.x) * Math.cos(m.heading) - (sh.z[i] - m.z) * Math.sin(m.heading);
    expect(Math.sign(side(0))).not.toBe(Math.sign(side(1)));
    // Run it out: both enemies are hurt, so each dart found its own.
    for (let t = 0; t < 40; t++) {
      root(sim.world);
      sim.step(TUCK);
    }
    expect(sim.world.horde.hp[a]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
    expect(sim.world.horde.hp[b]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
  });

  it('a single dart goes to the nearest enemy', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    const near = pointAt(sim, 8);
    const mid = pointAt(sim, 18, 1);
    const far = pointAt(sim, 25, -1);
    const n = place(sim, KIND_BOLLARD, near.x, near.z);
    const mi = place(sim, KIND_BOLLARD, mid.x, mid.z);
    const f = place(sim, KIND_BOLLARD, far.x, far.z);
    charge(sim);
    for (let t = 0; t < 60; t++) {
      root(sim.world);
      sim.step(TUCK);
    }
    const h = sim.world.horde;
    expect(h.hp[n]).toBeLessThan(KINDS[KIND_BOLLARD].hp);
    expect(h.hp[mi]).toBe(KINDS[KIND_BOLLARD].hp);
    expect(h.hp[f]).toBe(KINDS[KIND_BOLLARD].hp);
  });

  it('a dart reaches and damages a target 20 m away, and a shuffler falls in the expected hits', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    const at = pointAt(sim, 20);
    const e = place(sim, KIND_SHUFFLER, at.x, at.z);
    const hit = SEEKERS.damage[0] * sim.world.player.stats.might;
    const hits = Math.ceil(KINDS[KIND_SHUFFLER].hp / hit);
    expect(hits).toBeGreaterThanOrEqual(2);

    for (let n = 1; n < hits; n++) {
      charge(sim);
      for (let t = 0; t < 60; t++) {
        root(sim.world);
        sim.step(TUCK);
      }
      expect(sim.world.horde.hp[e]).toBeCloseTo(KINDS[KIND_SHUFFLER].hp - n * hit, 4);
      expect(sim.world.player.kills).toBe(0);
    }

    charge(sim);
    for (let t = 0; t < 60; t++) {
      root(sim.world);
      sim.step(TUCK);
    }
    expect(sim.world.player.kills).toBe(1);
    expect(sim.world.horde.count).toBe(0);
  });

  it('does not target enemies that are still rising', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    const at = pointAt(sim, 10);
    const e = spawnEnemy(sim.world, KIND_SHUFFLER, at.x, 0, at.z);
    expect(sim.world.horde.age[e]).toBe(0);
    charge(sim);
    sim.step(TUCK);
    expect(sim.world.shots.count).toBe(0);
    expect(sim.world.seekerMeter).toBe(waitNow(sim));
  });

  it('waits with nothing in range and fires the moment something comes in', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    run(sim, FORWARD, 60 * 6);
    expect(sim.world.shots.count).toBe(0);
    expect(sim.world.seekerMeter).toBe(waitNow(sim));

    const at = pointAt(sim, 20);
    place(sim, KIND_BOLLARD, at.x, at.z);
    const counts = new Map<number, number>();
    stepCounting(sim, FORWARD, 1, counts);
    expect(counts.get(FX_SHOT)).toBe(1);
    expect(sim.world.seekerMeter).toBeLessThan(waitNow(sim));
  });
});

describe('a dart', () => {
  it('that finds nothing expires', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    const at = pointAt(sim, 25);
    const e = place(sim, KIND_SHUFFLER, at.x, at.z);
    charge(sim);
    sim.step(TUCK);
    expect(sim.world.shots.count).toBe(1);
    // The target vanishes before the dart arrives.
    removeEnemy(sim.world, e);
    for (let t = 0; t < DART_LIFE_TICKS - 2; t++) sim.step(TUCK);
    expect(sim.world.shots.count).toBe(1);
    for (let t = 0; t < 4; t++) sim.step(TUCK);
    expect(sim.world.shots.count).toBe(0);
  });

  it('is gone once it hits', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 1);
    const at = pointAt(sim, 10);
    place(sim, KIND_BOLLARD, at.x, at.z);
    charge(sim);
    sim.step(TUCK);
    for (let t = 0; t < 30; t++) {
      root(sim.world);
      sim.step(TUCK);
    }
    expect(sim.world.shots.count).toBe(0);
  });

  it('the shot pool never overflows under the fastest fire rate', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 5);
    for (let i = 0; i < 8; i++) {
      const p = pointAt(sim, 26, -0.4 + i * 0.1);
      place(sim, KIND_BOLLARD, p.x, p.z);
    }
    let peak = 0;
    for (let t = 0; t < 600; t++) {
      root(sim.world);
      for (let i = 0; i < sim.world.horde.count; i++) sim.world.horde.hp[i] = 1000;
      charge(sim);
      sim.step(TUCK);
      peak = Math.max(peak, sim.world.shots.count);
      expect(sim.world.shots.count).toBeLessThanOrEqual(MAX_SHOTS);
    }
    expect(peak).toBe(MAX_SHOTS);
  });
});

describe('determinism', () => {
  function scripted(): number {
    const sim = arena();
    setWeaponLevel(sim.world, W_SEEKERS, 2);
    for (let i = 0; i < 24; i++) {
      const a = i * 0.7;
      place(sim, i % 5 === 0 ? KIND_BOLLARD : KIND_SHUFFLER, Math.sin(a) * (14 + i), Math.cos(a) * (14 + i) + 30);
    }
    for (let t = 0; t < 60 * 30; t++) {
      root(sim.world);
      sim.step(t % 400 < 250 ? steer(0.15, 0.9) : steer(-0.7, 0.7));
    }
    expect(sim.world.player.kills).toBeGreaterThan(0);
    return hashWorld(sim.world);
  }

  it('a 30 s run with hand-placed enemies gives the same hash twice', () => {
    expect(scripted()).toBe(scripted());
  });
});
