/** What a player would see the horde do: close in as a crowd, at the speed of its kind. */
import { setWeaponLevel } from '../../src/sim/build';
import { W_WAKE } from '../../src/sim/arsenal';
import { describe, expect, it } from 'vitest';
import { DT } from '../../src/sim/constants';
import { HORDE } from '../../src/sim/horde';
import { Rng } from '../../src/sim/rng';
import type { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import {
  hashWorld,
  KIND_BOLLARD,
  KIND_GNAT,
  KIND_SHUFFLER,
  KINDS,
  shoveEnemy,
  SPAWN_TICKS,
  spawnEnemy,
} from '../../src/sim/world';
import { run, steer, TUCK } from './fixtures';
import { arena, place } from './world-fixtures';

const STAND = TUCK;
const CIRCLE = steer(-0.6, 0.8);

function dist(sim: Sim, i: number): number {
  const h = sim.world.horde;
  const m = sim.state.mover;
  return Math.hypot(h.x[i] - m.x, h.z[i] - m.z);
}

function speedOf(sim: Sim, i: number): number {
  const h = sim.world.horde;
  return Math.hypot(h.vx[i], h.vz[i]);
}

/** Keep the player from being hurt (and so from throwing the horde around) without changing the ride. */
function shield(sim: Sim): void {
  sim.world.player.invuln = 1000;
}

/** A mixed crowd placed around the mover, deterministic. */
function crowd(sim: Sim, n: number, rMin: number, rMax: number, seed: number): void {
  const rng = new Rng(seed);
  for (let k = 0; k < n; k++) {
    const kind = k % 10 === 0 ? KIND_BOLLARD : k % 3 === 0 ? KIND_GNAT : KIND_SHUFFLER;
    const a = rng.next() * Math.PI * 2;
    const r = rMin + rng.next() * (rMax - rMin);
    place(sim, kind, Math.sin(a) * r, Math.cos(a) * r);
  }
}

describe('steering', () => {
  it('shufflers reach a standing mover at their speed and no faster', () => {
    const sim = arena();
    const start = 30;
    const angles = [0.3, 2.2, 4.4];
    const ids = angles.map((a) => place(sim, KIND_SHUFFLER, Math.sin(a) * start, Math.cos(a) * start));
    const h = sim.world.horde;
    const { speed, accel } = KINDS[KIND_SHUFFLER];
    const touch = KINDS[KIND_SHUFFLER].radius + 0.5 + 0.2;
    let fastest = 0;
    let ticks = 0;
    while (ids.every((i) => dist(sim, i) > touch) && ticks < 1200) {
      const px = ids.map((i) => h.x[i]);
      const pz = ids.map((i) => h.z[i]);
      sim.step(STAND);
      ticks++;
      ids.forEach((i, k) => {
        fastest = Math.max(fastest, Math.hypot(h.x[i] - px[k], h.z[i] - pz[k]) / DT);
      });
    }
    expect(sim.state.mover.speed).toBeLessThan(0.01);
    expect(fastest).toBeLessThanOrEqual(speed * 1.0001);
    expect(fastest).toBeGreaterThan(speed * 0.999);
    // Time to cover the gap at top speed, plus what getting up to it costs.
    const expected = (start - touch) / speed + speed / (2 * accel);
    expect(ticks * DT).toBeGreaterThan(expected * 0.98);
    expect(ticks * DT).toBeLessThan(expected * 1.04);
  });

  it('a gnat cloud weaves as a swarm and still arrives', () => {
    const sim = arena();
    const rng = new Rng(3);
    const ids: number[] = [];
    for (let k = 0; k < 10; k++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * 1.5;
      ids.push(place(sim, KIND_GNAT, 4 + Math.sin(a) * r, 40 + Math.cos(a) * r));
    }
    const h = sim.world.horde;
    const sx = ids.map((i) => h.x[i]);
    const sz = ids.map((i) => h.z[i]);
    const maxOff = ids.map(() => 0);
    const closest = ids.map(() => Infinity);
    let bothSides = false;
    const limit = Math.ceil((40 / KINDS[KIND_GNAT].speed) * 1.6 * 60);
    for (let t = 0; t < limit; t++) {
      // The first to touch would hurt the player and throw the rest back; this is about arriving.
      shield(sim);
      sim.step(STAND);
      let left = false;
      let right = false;
      ids.forEach((i, k) => {
        const d = dist(sim, i);
        closest[k] = Math.min(closest[k], d);
        if (d < 5) return;
        // Signed distance off the straight line from where it started to the mover.
        const lx = -sx[k];
        const lz = -sz[k];
        const ll = Math.hypot(lx, lz);
        const off = ((h.x[i] - sx[k]) * lz - (h.z[i] - sz[k]) * lx) / ll;
        maxOff[k] = Math.max(maxOff[k], Math.abs(off));
        if (off > 0.2) left = true;
        if (off < -0.2) right = true;
      });
      bothSides ||= left && right;
    }
    // Not straight lines, and not all swinging the same way at once.
    expect(maxOff.filter((o) => o > 0.4).length).toBeGreaterThanOrEqual(8);
    expect(bothSides).toBe(true);
    // Every one of them got to the mover.
    for (const c of closest) expect(c).toBeLessThan(KINDS[KIND_GNAT].radius + 0.5 + 0.6);
  });

  it('nothing ever steers faster than its kind allows (30 s among a moving mover)', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    crowd(sim, 160, 6, 45, 11);
    const h = sim.world.horde;
    let worst = 0;
    for (let t = 0; t < 30 * 60; t++) {
      shield(sim);
      sim.step(t < 60 ? steer(0, 1) : CIRCLE);
      for (let i = 0; i < h.count; i++) worst = Math.max(worst, speedOf(sim, i) / KINDS[h.kind[i]].speed);
    }
    expect(h.count).toBe(160);
    expect(worst).toBeLessThanOrEqual(1.00001);
    expect(worst).toBeGreaterThan(0.99);
  });

  it('rising enemies do not move and are not moved', () => {
    const sim = arena();
    const a = spawnEnemy(sim.world, KIND_SHUFFLER, 0, 0, 10);
    const b = spawnEnemy(sim.world, KIND_GNAT, 5, 0, 12);
    // A risen one standing on the same spot as a rising one.
    const c = place(sim, KIND_SHUFFLER, 0, 10);
    const h = sim.world.horde;
    for (let t = 0; t < SPAWN_TICKS; t++) {
      sim.step(STAND);
      expect(h.x[a]).toBe(0);
      expect(h.z[a]).toBe(10);
      expect(h.x[b]).toBe(5);
      expect(h.z[b]).toBe(12);
    }
    expect(h.z[c]).toBeLessThan(10);
    run(sim, STAND, 30);
    expect(h.z[a]).toBeLessThan(9.5);
    expect(h.z[b]).toBeLessThan(11.5);
  });
});

describe('thrown', () => {
  it('slides without steering, stops within a second or so, then comes on again', () => {
    const sim = arena();
    const i = place(sim, KIND_SHUFFLER, 0, 20);
    const h = sim.world.horde;
    const throwSpeed = 9;
    const stun = 90;
    shoveEnemy(sim.world, i, 1, 0, throwSpeed, stun);
    let stoppedAt = -1;
    for (let t = 0; t < stun; t++) {
      sim.step(STAND);
      // Straight on along the throw: nothing pulls it toward the mover.
      expect(h.vz[i]).toBe(0);
      expect(h.z[i]).toBeCloseTo(20, 5);
      expect(h.vx[i]).toBeGreaterThanOrEqual(0);
      if (stoppedAt < 0 && h.vx[i] === 0) stoppedAt = t + 1;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt * DT).toBeLessThan(1.3);
    expect(stoppedAt * DT).toBeGreaterThan(0.8);
    const slid = h.x[i];
    expect(slid).toBeGreaterThan((throwSpeed * throwSpeed) / (2 * HORDE.throwDecel) * 0.9);
    expect(slid).toBeLessThan((throwSpeed * throwSpeed) / (2 * HORDE.throwDecel) * 1.1);
    // Free again: back to closing on the mover.
    const before = dist(sim, i);
    run(sim, STAND, 60);
    expect(dist(sim, i)).toBeLessThan(before - 3);
    const m = sim.state.mover;
    const toward = (-(h.x[i] - m.x) * h.vx[i] - (h.z[i] - m.z) * h.vz[i]) / dist(sim, i);
    expect(toward).toBeGreaterThan(KINDS[KIND_SHUFFLER].speed * 0.95);
  });
});

describe('bodies', () => {
  it('sixty shufflers dropped on one spot spread out within 3 s', () => {
    const sim = arena();
    for (let k = 0; k < 60; k++) place(sim, KIND_SHUFFLER, 20, 20);
    run(sim, STAND, 180);
    const h = sim.world.horde;
    const r = KINDS[KIND_SHUFFLER].radius;
    let worst = 0;
    for (let i = 0; i < h.count; i++) {
      for (let j = i + 1; j < h.count; j++) {
        worst = Math.max(worst, 2 * r - Math.hypot(h.x[i] - h.x[j], h.z[i] - h.z[j]));
      }
    }
    expect(h.count).toBe(60);
    expect(worst).toBeLessThanOrEqual(r / 5);
  });

  it('a light enemy cannot push a bollard', () => {
    const sim = arena();
    const b = place(sim, KIND_BOLLARD, 0, 10);
    for (let k = 0; k < 12; k++) place(sim, KIND_SHUFFLER, (k % 4) * 1.3 - 2, 13 + Math.floor(k / 4) * 1.3);
    const h = sim.world.horde;
    let pressed = 0;
    for (let t = 0; t < 300; t++) {
      // The bollard stands still; the shufflers walk into it on their way to the mover.
      h.stun[b] = 255;
      h.vx[b] = 0;
      h.vz[b] = 0;
      sim.step(STAND);
      expect(h.x[b]).toBe(0);
      expect(h.z[b]).toBe(10);
      for (let i = 0; i < h.count; i++) {
        if (i !== b && Math.hypot(h.x[i] - h.x[b], h.z[i] - h.z[b]) < KINDS[KIND_BOLLARD].radius + 0.7) pressed++;
      }
    }
    expect(pressed).toBeGreaterThan(30);
  });

  it('a bollard pushes through lights as if they were not there', () => {
    const path = (withCrowd: boolean): { x: number; z: number; moved: number } => {
      const sim = arena();
      const b = place(sim, KIND_BOLLARD, 0, 22);
      const lights: number[] = [];
      const lx: number[] = [];
      const lz: number[] = [];
      if (withCrowd) {
        for (let k = 0; k < 9; k++) {
          const x = (k % 3) * 1.2 - 1.2;
          const z = 15 + Math.floor(k / 3) * 1.2;
          lights.push(place(sim, KIND_SHUFFLER, x, z));
          lx.push(x);
          lz.push(z);
        }
      }
      const h = sim.world.horde;
      for (let t = 0; t < 360; t++) {
        for (const i of lights) {
          h.stun[i] = 255;
          h.vx[i] = 0;
          h.vz[i] = 0;
        }
        sim.step(STAND);
      }
      let moved = 0;
      lights.forEach((i, k) => {
        moved = Math.max(moved, Math.hypot(h.x[i] - lx[k], h.z[i] - lz[k]));
      });
      return { x: h.x[b], z: h.z[b], moved };
    };
    const alone = path(false);
    const through = path(true);
    expect(alone.z).toBeLessThan(22 - 8);
    expect(through.x).toBeCloseTo(alone.x, 5);
    expect(through.z).toBeCloseTo(alone.z, 5);
    expect(through.moved).toBeGreaterThan(1);
  });
});

describe('the ground', () => {
  it('enemies never leave 0.86 of the radius', () => {
    const radius = 30;
    const sim = arena(flatTerrain(radius));
    const rng = new Rng(5);
    const h = sim.world.horde;
    for (let k = 0; k < 40; k++) {
      const a = rng.next() * Math.PI * 2;
      const kind = k % 2 === 0 ? KIND_GNAT : KIND_SHUFFLER;
      const i = place(sim, kind, Math.sin(a) * 24, Math.cos(a) * 24);
      shoveEnemy(sim.world, i, Math.sin(a), Math.cos(a), 9, 60);
    }
    const limit = 0.86 * radius;
    let worst = 0;
    for (let t = 0; t < 600; t++) {
      shield(sim);
      sim.step(t < 60 ? steer(0, 1) : CIRCLE);
      for (let i = 0; i < h.count; i++) worst = Math.max(worst, Math.hypot(h.x[i], h.z[i]));
    }
    expect(worst).toBeLessThanOrEqual(limit + 1e-4);
    expect(worst).toBeGreaterThan(limit - 0.5);
  });

  it('stands on the ground', () => {
    const terrain = flatTerrain();
    const sloped = { ...terrain, heightAt: (x: number, z: number) => 0.1 * x + 0.05 * z };
    const sim = arena(sloped);
    crowd(sim, 30, 5, 30, 2);
    run(sim, STAND, 120);
    const h = sim.world.horde;
    for (let i = 0; i < h.count; i++) expect(h.y[i]).toBeCloseTo(0.1 * h.x[i] + 0.05 * h.z[i], 4);
  });
});

describe('far away', () => {
  it('enemies far from the mover close at the right average speed', () => {
    const sim = arena();
    const starts = [100, 110, 120, 105, 115];
    const ids = starts.map((r, k) => {
      const a = (k / starts.length) * Math.PI * 2;
      return place(sim, KIND_SHUFFLER, Math.sin(a) * r, Math.cos(a) * r);
    });
    const seconds = 5;
    run(sim, STAND, seconds * 60);
    const { speed, accel } = KINDS[KIND_SHUFFLER];
    const expected = speed * seconds - (speed * speed) / (2 * accel);
    ids.forEach((i, k) => {
      const closed = starts[k] - dist(sim, i);
      expect(dist(sim, i)).toBeGreaterThan(HORDE.farDist);
      expect(closed).toBeGreaterThan(expected * 0.97);
      expect(closed).toBeLessThan(expected * 1.03);
    });
  });
});

describe('a big horde', () => {
  it('has no non-finite numbers after 60 s with 400 enemies', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    crowd(sim, 400, 3, 60, 9);
    const h = sim.world.horde;
    for (let t = 0; t < 60 * 60; t++) {
      shield(sim);
      sim.step(t < 120 ? steer(0, 1) : CIRCLE);
      if (t % 30 !== 0) continue;
      for (let i = 0; i < h.count; i++) {
        const ok =
          Number.isFinite(h.x[i]) &&
          Number.isFinite(h.y[i]) &&
          Number.isFinite(h.z[i]) &&
          Number.isFinite(h.vx[i]) &&
          Number.isFinite(h.vz[i]);
        expect(ok).toBe(true);
      }
    }
    expect(h.count).toBeGreaterThan(300);
  });

  it('two identical runs are identical every tick', () => {
    const a = arena();
    const b = arena();
    crowd(a, 200, 4, 50, 4);
    crowd(b, 200, 4, 50, 4);
    for (let t = 0; t < 900; t++) {
      const input = t < 60 ? steer(0, 1) : CIRCLE;
      a.step(input);
      b.step(input);
      expect(hashWorld(b.world)).toBe(hashWorld(a.world));
    }
  });
});
