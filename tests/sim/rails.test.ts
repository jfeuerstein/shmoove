/** What a player would notice about rails: hop near one and you grind it. */
import { describe, expect, it } from 'vitest';
import { FEEL } from '../../src/sim/constants';
import { Sim } from '../../src/sim/sim';
import { railOver, terrainFromHeight, type Rail, type Terrain } from '../../src/sim/terrain';
import { EV_CLEAN_HOP, EV_GRIND_END, EV_GRIND_START, EV_LAND, type InputFrame } from '../../src/sim/types';
import { KIND_BOLLARD, KIND_SHUFFLER, KINDS, SPAWN_TICKS, spawnEnemy } from '../../src/sim/world';
import { FORWARD, launch, run, steer, TUCK } from './fixtures';

const LIFT = 1.2;
const hopNow = (f: InputFrame): InputFrame => ({ ...f, hop: true });

/** A world with rails standing `LIFT` above a height function. */
function park(heightAt: (x: number, z: number) => number, lines: [number, number, number, number][]): Terrain {
  const rails: Rail[] = lines.map(([x0, z0, x1, z1]) => railOver(heightAt, x0, z0, x1, z1, LIFT));
  return terrainFromHeight(heightAt, 2000, [], 0, 0, 0, rails);
}

const flat = (): number => 0;
/** One rail straight ahead of the spawn, from z = 10 to z = 40. */
const ahead = (): Terrain => park(flat, [[0, 10, 0, 40]]);

/** Ride at `speed` and hop so the rider comes down over z = `at`. Returns the events seen for `ticks`. */
function hopOnto(sim: Sim, speed: number, at: number, ticks: number, during: InputFrame = TUCK): number {
  // Hold the speed on the run-up (a slow rider would coast to a stop short of the rail).
  // A hop lasts about 0.56 s; leave the ground that far short of the spot.
  for (let t = 0; t < 2000 && sim.state.mover.z < at - speed * 0.5; t++) {
    launch(sim, speed);
    sim.step(TUCK);
  }
  launch(sim, speed);
  sim.step(hopNow(TUCK));
  let seen = 0;
  for (let t = 0; t < ticks; t++) {
    sim.step(during);
    seen |= sim.state.events;
  }
  return seen;
}

describe('catching a rail', () => {
  it('a hop that comes down along a rail locks on to it', () => {
    const sim = new Sim(ahead());
    sim.state.mover.x = 0.5;
    const seen = hopOnto(sim, 12, 16, 40);
    expect(seen & EV_GRIND_START).not.toBe(0);
    const m = sim.state.mover;
    expect(m.rail).toBe(0);
    expect(m.grounded).toBe(false);
    expect(m.x).toBeCloseTo(0, 6);
    expect(m.y).toBeCloseTo(LIFT, 6);
    expect(m.vz).toBeGreaterThan(11);
  });

  it('riding past it on the ground does nothing, and neither does hopping across it', () => {
    const under = new Sim(ahead());
    launch(under, 12);
    let seen = 0;
    for (let t = 0; t < 300; t++) {
      under.step(TUCK);
      seen |= under.state.events;
    }
    expect(seen & EV_GRIND_START).toBe(0);
    expect(under.state.mover.z).toBeGreaterThan(40);

    // A rail lying across the path, hopped over at right angles.
    const across = new Sim(park(flat, [[-15, 16, 15, 16]]));
    expect(hopOnto(across, 12, 16, 60) & EV_GRIND_START).toBe(0);
  });

  it('needs some speed', () => {
    const sim = new Sim(ahead());
    expect(hopOnto(sim, FEEL.railMinSpeed - 1.5, 16, 60) & EV_GRIND_START).toBe(0);
  });

  it('works from either end', () => {
    const sim = new Sim(park(flat, [[0, 40, 0, 10]]));
    expect(hopOnto(sim, 12, 16, 40) & EV_GRIND_START).not.toBe(0);
    expect(sim.state.mover.vz).toBeGreaterThan(11);
  });
});

describe('grinding', () => {
  it('follows the rail whatever the stick says, and picks up a little speed', () => {
    const sim = new Sim(ahead());
    hopOnto(sim, 12, 14, 20);
    expect(sim.state.mover.rail).toBe(0);
    const before = sim.state.mover.speed;
    run(sim, steer(-1, 0), 45);
    expect(sim.state.mover.rail).toBe(0);
    expect(sim.state.mover.x).toBeCloseTo(0, 6);
    expect(sim.state.mover.y).toBeCloseTo(LIFT, 6);
    expect(sim.state.mover.speed).toBeGreaterThan(before + 0.5);
  });

  it('a downhill rail is faster than a level one, and an uphill one slower', () => {
    const endSpeed = (fall: number): number => {
      const h = (_x: number, z: number): number => -fall * z;
      const sim = new Sim(park(h, [[0, 10, 0, 40]]));
      hopOnto(sim, 12, 14, 20);
      expect(sim.state.mover.rail, `fall ${fall}`).toBe(0);
      run(sim, TUCK, 60);
      return sim.state.mover.speed;
    };
    const level = endSpeed(0);
    expect(endSpeed(0.15)).toBeGreaterThan(level + 1.5);
    expect(endSpeed(-0.15)).toBeLessThan(level - 1.5);
  });

  it('runs off the end into the air with its speed, and lands', () => {
    const sim = new Sim(ahead());
    hopOnto(sim, 12, 14, 10);
    let ended = false;
    let landed = false;
    let speedAtEnd = 0;
    for (let t = 0; t < 400 && !landed; t++) {
      sim.step(TUCK);
      if ((sim.state.events & EV_GRIND_END) !== 0) {
        ended = true;
        speedAtEnd = sim.state.mover.speed;
        expect(sim.state.mover.z).toBeCloseTo(40, 0);
        expect(sim.state.mover.vy).toBeGreaterThan(0);
      }
      if (ended && (sim.state.events & EV_LAND) !== 0) landed = true;
    }
    expect(ended).toBe(true);
    expect(landed).toBe(true);
    expect(speedAtEnd).toBeGreaterThan(12);
    expect(sim.state.mover.rail).toBe(-1);
    expect(sim.state.mover.grounded).toBe(true);
    expect(sim.state.mover.z).toBeGreaterThan(42);
  });

  it('a tap hops off, keeping everything, and counts as a clean hop', () => {
    const sim = new Sim(ahead());
    hopOnto(sim, 12, 14, 20);
    const speed = sim.state.mover.speed;
    const chain = sim.state.mover.chain;
    sim.step(hopNow(TUCK));
    expect(sim.state.events & EV_CLEAN_HOP).not.toBe(0);
    expect(sim.state.events & EV_GRIND_END).not.toBe(0);
    expect(sim.state.mover.rail).toBe(-1);
    expect(sim.state.mover.chain).toBe(chain + 1);
    expect(sim.state.mover.vy).toBeGreaterThan(5);
    sim.step(TUCK);
    expect(sim.state.mover.speed).toBeGreaterThan(speed - 0.5);
    // And it does not snap straight back on.
    run(sim, TUCK, 10);
    expect(sim.state.mover.rail).toBe(-1);
  });

  it('from one rail to the next: a hop off the first can catch a second', () => {
    const sim = new Sim(park(flat, [
      [0, 10, 0, 30],
      [0, 36, 0, 60],
    ]));
    hopOnto(sim, 12, 14, 10);
    let caught = 0;
    for (let t = 0; t < 300; t++) {
      sim.step(TUCK);
      if ((sim.state.events & EV_GRIND_START) !== 0) caught++;
    }
    // Off the end of the first with a pop, and down onto the second.
    expect(caught).toBe(1);
    expect(sim.state.mover.z).toBeGreaterThan(60);
  });
});

describe('a rail and the horde', () => {
  it('carries you over the small ones, not over a bollard', () => {
    const ride = (kind: number): number => {
      const sim = new Sim(ahead(), { seed: 3, horde: true, autoPick: true });
      sim.world.spawning = false;
      sim.world.player.loadout.weaponLevel.fill(0);
      const i = spawnEnemy(sim.world, kind, 0, 0, 26);
      sim.world.horde.age[i] = SPAWN_TICKS;
      for (let t = 0; t < 2000 && sim.state.mover.z < 14 - 6; t++) {
        launch(sim, 12);
        sim.step(TUCK);
      }
      sim.step(hopNow(TUCK));
      for (let t = 0; t < 150; t++) {
        // Keep it under the rail.
        sim.world.horde.x[0] = 0;
        sim.world.horde.z[0] = 26;
        sim.world.horde.vx[0] = 0;
        sim.world.horde.vz[0] = 0;
        sim.step(TUCK);
      }
      expect(sim.state.mover.z).toBeGreaterThan(30);
      return sim.world.player.hp;
    };
    expect(LIFT).toBeGreaterThan(KINDS[KIND_SHUFFLER].height * 0.6);
    expect(ride(KIND_SHUFFLER)).toBe(100);
    expect(ride(KIND_BOLLARD)).toBeLessThan(100);
  });
});

describe('determinism', () => {
  it('the same ride over rails is the same every time', () => {
    const play = (): number[] => {
      const sim = new Sim(park((_x, z) => -0.05 * z, [
        [0, 10, 0, 40],
        [2, 50, -4, 90],
      ]));
      launch(sim, 12);
      const out: number[] = [];
      for (let t = 0; t < 900; t++) {
        sim.step(t % 37 === 0 ? hopNow(FORWARD) : t % 90 < 60 ? FORWARD : TUCK);
        if (t % 60 === 0) out.push(sim.state.mover.x, sim.state.mover.y, sim.state.mover.z, sim.state.mover.rail);
      }
      return out;
    };
    expect(play()).toEqual(play());
  });
});
