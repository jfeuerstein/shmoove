/** The things on the map, as a rider meets them: rammed, orbited, ridden, flown through. */
import thingsSource from '../../src/sim/things.ts?raw';
import { describe, expect, it } from 'vitest';
import { P_LUCK } from '../../src/sim/arsenal';
import { setPassiveLevel } from '../../src/sim/build';
import { gearForSpeed } from '../../src/sim/flow';
import { OFFER_CRATE, OFFER_SHRINE, OFFER_TOTEM } from '../../src/sim/offer';
import { Rng } from '../../src/sim/rng';
import type { Sim } from '../../src/sim/sim';
import { powerOf } from '../../src/sim/stats';
import {
  addThing,
  CRATE_BOMB,
  CRATE_CARD,
  CRATE_HEAL,
  CRATE_MAGNET,
  crateReward,
  HOOP_TAKEN,
  SLALOM_MISSED,
} from '../../src/sim/things';
import { makeInputFrame } from '../../src/sim/types';
import {
  FX_BLAST,
  FX_HEAL,
  FX_THING,
  FX_TOKEN,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  MARK_PACK,
  spawnEnemy,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from '../../src/sim/world';
import { arena, place, root } from './world-fixtures';

const TUCK = makeInputFrame();
const TAU = 2 * Math.PI;

/** Put the mover at (x, z) on the ground, travelling along `yaw` at `speed`, in the gear that speed earns. */
function ride(sim: Sim, x: number, z: number, yaw: number, speed: number): void {
  const m = sim.state.mover;
  m.x = x;
  m.z = z;
  m.y = sim.terrain.heightAt(x, z);
  m.heading = yaw;
  m.vx = Math.sin(yaw) * speed;
  m.vy = 0;
  m.vz = Math.cos(yaw) * speed;
  m.speed = speed;
  m.grounded = true;
  m.airTicks = 0;
  m.gear = gearForSpeed(speed);
  m.gearHold = 0;
  sim.state.viewYaw = yaw;
}

/** The same, in the air at height `y`, moving level. */
function fly(sim: Sim, x: number, y: number, z: number, yaw: number, speed: number): void {
  ride(sim, x, z, yaw, speed);
  const m = sim.state.mover;
  m.y = y;
  m.grounded = false;
  m.airTicks = 10;
}

/** Every effect of a type seen while stepping, with its `a`. */
interface Seen {
  type: number;
  a: number;
}

function step(sim: Sim, ticks: number, seen?: Seen[]): void {
  for (let t = 0; t < ticks; t++) {
    sim.step(TUCK);
    if (!seen) continue;
    const f = sim.world.fx;
    for (let i = 0; i < f.count; i++) seen.push({ type: f.type[i], a: f.a[i] });
  }
}

function of(seen: Seen[], type: number): number[] {
  return seen.filter((s) => s.type === type).map((s) => s.a);
}

/** An arena whose offers are answered at once with the first card, recording where each came from. */
function recordingArena(): { sim: Sim; sources: number[] } {
  const sim = arena();
  const sources: number[] = [];
  sim.picker = (w: World) => {
    sources.push(w.offer.source);
    return 0;
  };
  return { sim, sources };
}

/** Ride straight at a thing at (0, 0) from 6 m short of it, for a second. */
function rideThrough(sim: Sim, speed: number, seen?: Seen[]): void {
  ride(sim, 0, -6, 0, speed);
  step(sim, 60, seen);
}

describe('a crate', () => {
  it('breaks when touched in gear 2', () => {
    const { sim } = recordingArena();
    const c = addThing(sim.world, THING_CRATE, 0, 0, 0, 0, 0);
    const seen: Seen[] = [];
    rideThrough(sim, 9, seen);
    expect(sim.world.things.state[c]).toBe(THING_DONE);
    expect(of(seen, FX_THING)).toContain(THING_CRATE);
  });

  it('is not touched from 1.5 m away', () => {
    const { sim } = recordingArena();
    const c = addThing(sim.world, THING_CRATE, 1.5, 0, 0, 0, 0);
    rideThrough(sim, 9);
    expect(sim.world.things.state[c]).toBe(0);
  });

  it('only rattles in gear 1, and at most once a second', () => {
    const { sim, sources } = recordingArena();
    const c = addThing(sim.world, THING_CRATE, 0, 0, 0, 0, 0);
    ride(sim, 0, 0, 0, 0);
    const seen: Seen[] = [];
    step(sim, 150, seen);
    expect(sim.world.things.state[c]).toBe(0);
    expect(sources).toHaveLength(0);
    // Leaning on it for 2.5 s: a rattle at the start, after 1 s and after 2 s.
    expect(of(seen, FX_THING)).toEqual([THING_CRATE, THING_CRATE, THING_CRATE]);
  });

  it('breaks in gear 1 while the plow grace of a higher gear lasts, and not after', () => {
    for (const late of [false, true]) {
      const { sim } = recordingArena();
      const c = addThing(sim.world, THING_CRATE, 0, 0, 0, 0, 0);
      // Cruising in gear 3, then stopped short (as by a hit) 2 m before the crate.
      ride(sim, 0, -40, 0, 13);
      step(sim, 10);
      ride(sim, 0, late ? -30 : -3.1, 0, 3);
      sim.state.mover.gear = 3;
      if (late) {
        step(sim, 120);
        ride(sim, 0, -3.1, 0, 3);
      }
      let gearAtTouch = 0;
      for (let t = 0; t < 60 && sim.world.things.state[c] === 0; t++) {
        step(sim, 1);
        gearAtTouch = sim.state.mover.gear;
      }
      if (late) {
        expect(sim.world.things.state[c]).toBe(0);
      } else {
        expect(sim.world.things.state[c]).toBe(THING_DONE);
        expect(gearAtTouch).toBe(1);
      }
    }
  });

  it('gives a card, a heal of 25, every spark, or a bomb, by the roll', () => {
    expect(crateReward(0, 0)).toBe(CRATE_CARD);
    expect(crateReward(0.49, 0)).toBe(CRATE_CARD);
    expect(crateReward(0.51, 0)).toBe(CRATE_HEAL);
    expect(crateReward(0.69, 0)).toBe(CRATE_HEAL);
    expect(crateReward(0.71, 0)).toBe(CRATE_MAGNET);
    expect(crateReward(0.84, 0)).toBe(CRATE_MAGNET);
    expect(crateReward(0.86, 0)).toBe(CRATE_BOMB);
    expect(crateReward(0.9999, 0)).toBe(CRATE_BOMB);
  });

  it('gives more cards with luck, the rest keeping their proportions', () => {
    const share = (luck: number): number[] => {
      const n = [0, 0, 0, 0];
      for (let i = 0; i < 10000; i++) n[crateReward((i + 0.5) / 10000, luck)]++;
      return n.map((v) => v / 10000);
    };
    const plain = share(0);
    expect(plain[CRATE_CARD]).toBeCloseTo(0.5, 3);
    expect(plain[CRATE_HEAL]).toBeCloseTo(0.2, 3);
    expect(plain[CRATE_MAGNET]).toBeCloseTo(0.15, 3);
    expect(plain[CRATE_BOMB]).toBeCloseTo(0.15, 3);
    const lucky = share(0.5);
    expect(lucky[CRATE_CARD]).toBeGreaterThan(0.6);
    expect(lucky[CRATE_HEAL] / lucky[CRATE_MAGNET]).toBeCloseTo(0.2 / 0.15, 1);
    expect(lucky[CRATE_MAGNET]).toBeCloseTo(lucky[CRATE_BOMB], 3);
  });

  /** A crate at the origin opened with the world's roll forced to give `reward`. */
  function openWith(reward: number, luckLevel = 0, before?: (sim: Sim) => void): { sim: Sim; sources: number[]; seen: Seen[] } {
    const { sim, sources } = recordingArena();
    if (luckLevel > 0) setPassiveLevel(sim.world, P_LUCK, luckLevel);
    const luck = sim.world.player.stats.luck;
    let seed = 1;
    while (crateReward(new Rng(seed).next(), luck) !== reward) seed++;
    addThing(sim.world, THING_CRATE, 0, 0, 0, 0, 0);
    before?.(sim);
    // Nothing else in this arena draws from the world's stream, so the crate gets the first roll.
    sim.world.rng = new Rng(seed);
    const seen: Seen[] = [];
    rideThrough(sim, 9, seen);
    expect(sim.world.things.state[sim.world.things.count - 1]).toBe(THING_DONE);
    return { sim, sources, seen };
  }

  it('card: an offer from the crate', () => {
    const { sources } = openWith(CRATE_CARD);
    expect(sources).toEqual([OFFER_CRATE]);
  });

  it('a roll that is a heal without luck is a card with it', () => {
    let seed = 1;
    while (crateReward(new Rng(seed).next(), 0) !== CRATE_HEAL || crateReward(new Rng(seed).next(), 0.5) !== CRATE_CARD) seed++;
    for (const lucky of [false, true]) {
      const { sim, sources } = recordingArena();
      if (lucky) setPassiveLevel(sim.world, P_LUCK, 5);
      sources.length = 0;
      addThing(sim.world, THING_CRATE, 0, 0, 0, 0, 0);
      sim.world.player.hp = 50;
      sim.world.rng = new Rng(seed);
      rideThrough(sim, 9);
      expect(sources).toEqual(lucky ? [OFFER_CRATE] : []);
      expect(sim.world.player.hp).toBe(lucky ? 50 : 75);
    }
  });

  it('heal: 25 health, never past the maximum', () => {
    let r = openWith(CRATE_HEAL, 0, (sim) => {
      sim.world.player.hp = 50;
    });
    expect(r.sim.world.player.hp).toBe(75);
    expect(of(r.seen, FX_HEAL)).toEqual([25]);
    expect(r.sources).toHaveLength(0);
    r = openWith(CRATE_HEAL, 0, (sim) => {
      sim.world.player.hp = 90;
    });
    expect(r.sim.world.player.hp).toBe(100);
    expect(of(r.seen, FX_HEAL)).toEqual([10]);
  });

  it('magnet: every spark on the map flies in', () => {
    const { sim } = openWith(CRATE_MAGNET, 0, (s) => {
      const sp = s.world.sparks;
      for (let i = 0; i < 20; i++) {
        sp.x[i] = 60 * Math.sin(i);
        sp.y[i] = 0.5;
        sp.z[i] = 60 * Math.cos(i) + 70;
        sp.value[i] = 1;
        sp.pull[i] = 0;
      }
      sp.count = 20;
    });
    const sp = sim.world.sparks;
    for (let i = 0; i < sp.count; i++) expect(sp.pull[i]).toBe(1);
    const xp = sim.world.player.xp + sim.world.player.level * 100;
    step(sim, 600);
    expect(sim.world.sparks.count).toBe(0);
    expect(sim.world.player.xp + sim.world.player.level * 100).toBeGreaterThan(xp);
  });

  it('bomb: 60 times power to every risen enemy within 22 m of it', () => {
    let near = -1;
    let far = -1;
    let rising = -1;
    const { sim, seen } = openWith(CRATE_BOMB, 0, (s) => {
      near = place(s, KIND_BOLLARD, 15, 10);
      far = place(s, KIND_BOLLARD, -23, 0);
      rising = spawnEnemy(s.world, KIND_BOLLARD, -12, 0, 12);
      root(s.world);
    });
    const h = sim.world.horde;
    const power = powerOf(sim.world.player.stats, 2);
    expect(h.hp[near]).toBeCloseTo(120 - 60 * power, 3);
    expect(h.hp[far]).toBe(120);
    expect(h.hp[rising]).toBe(120);
    expect(of(seen, FX_BLAST)).toEqual([22]);
  });
});

describe('a gold crate', () => {
  it('only rattles in gear 3; in gear 4 it gives a card and 5 tokens', () => {
    for (const speed of [14, 20]) {
      const { sim, sources } = recordingArena();
      const c = addThing(sim.world, THING_GOLD_CRATE, 0, 0, 0, 0, 0);
      const seen: Seen[] = [];
      rideThrough(sim, speed, seen);
      expect(of(seen, FX_THING)).toEqual([THING_GOLD_CRATE]);
      if (speed < 18) {
        expect(sim.world.things.state[c]).toBe(0);
        expect(sim.world.player.tokens).toBe(0);
        expect(sources).toHaveLength(0);
      } else {
        expect(sim.world.things.state[c]).toBe(THING_DONE);
        expect(sim.world.player.tokens).toBe(5);
        expect(of(seen, FX_TOKEN)).toEqual([5]);
        expect(sources).toEqual([OFFER_CRATE]);
      }
    }
  });
});

describe('a shrine', () => {
  /**
   * Ride round the shrine at (0, 0) at radius `r`, `laps` laps in `seconds`, starting at `from`
   * radians; `dir` 1 or -1. Each tick puts the mover on the circle moving along it.
   */
  function orbit(sim: Sim, r: number, laps: number, seconds: number, dir = 1, from = 0): number {
    const ticks = Math.round(seconds * 60);
    const w = (dir * laps * TAU) / ticks;
    const speed = Math.abs(w) * 60 * r;
    let a = from;
    for (let t = 0; t < ticks; t++) {
      ride(sim, Math.sin(a) * r, Math.cos(a) * r, a + (dir * Math.PI) / 2, speed);
      sim.step(TUCK);
      a += w;
    }
    return a;
  }

  it('three laps inside 10 s inside the ring finish it: a boon offer', () => {
    const { sim, sources } = recordingArena();
    const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
    orbit(sim, 6, 1, 3);
    expect(sim.world.things.progress[s]).toBeCloseTo(1, 1);
    orbit(sim, 6, 2.05, 6, 1, TAU);
    expect(sim.world.things.state[s]).toBe(THING_DONE);
    expect(sources).toEqual([OFFER_SHRINE]);
  });

  it('either way round, anywhere in the ring from 4 to 11 m', () => {
    for (const [r, dir] of [
      [4.2, -1],
      [10.8, 1],
    ]) {
      const { sim, sources } = recordingArena();
      const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
      orbit(sim, r, 3.05, 9.5, dir);
      expect(sim.world.things.state[s]).toBe(THING_DONE);
      expect(sources).toEqual([OFFER_SHRINE]);
    }
  });

  it('two and a half laps and out of the ring do not', () => {
    const { sim, sources } = recordingArena();
    const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
    const a = orbit(sim, 6, 2.5, 7);
    expect(sim.world.things.progress[s]).toBeCloseTo(2.5, 1);
    // Out past 11 m for a moment, then the last half lap: the count started again.
    ride(sim, Math.sin(a) * 13, Math.cos(a) * 13, a, 8);
    step(sim, 1);
    expect(sim.world.things.progress[s]).toBe(0);
    orbit(sim, 6, 0.6, 1.5, 1, a);
    expect(sim.world.things.state[s]).not.toBe(THING_DONE);
    expect(sources).toHaveLength(0);
  });

  it('riding inside 4 m does not count', () => {
    const { sim } = recordingArena();
    const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
    orbit(sim, 3.5, 3.5, 8);
    expect(sim.world.things.state[s]).not.toBe(THING_DONE);
    expect(sim.world.things.progress[s]).toBe(0);
  });

  it('a reversal starts the count again', () => {
    const { sim, sources } = recordingArena();
    const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
    let a = orbit(sim, 6, 2, 5);
    a = orbit(sim, 6, 2.5, 6, -1, a);
    expect(sim.world.things.state[s]).not.toBe(THING_DONE);
    expect(sim.world.things.progress[s]).toBeCloseTo(2.5, 1);
    orbit(sim, 6, 0.6, 1.5, -1, a);
    expect(sim.world.things.state[s]).toBe(THING_DONE);
    expect(sources).toEqual([OFFER_SHRINE]);
  });

  it('too slow starts the count again: three laps in 11 s never finish it', () => {
    const { sim, sources } = recordingArena();
    const s = addThing(sim.world, THING_SHRINE, 0, 0, 0, 0, 0);
    let a = 0;
    let most = 0;
    for (let k = 0; k < 30; k++) {
      a = orbit(sim, 6, 0.3, 1.1, 1, a);
      most = Math.max(most, sim.world.things.progress[s]);
    }
    expect(sim.world.things.state[s]).not.toBe(THING_DONE);
    expect(most).toBeLessThan(3);
    expect(sources).toHaveLength(0);
  });
});

describe('a slalom', () => {
  /** Five gates up the z axis from the origin, 18 m apart, alternating 3 m either side. */
  function slalom(sim: Sim): number {
    const first = sim.world.things.count;
    for (let k = 0; k < 5; k++) addThing(sim.world, THING_GATE, k % 2 === 0 ? 3 : -3, 0, 18 * k, 0, 1);
    return first;
  }

  /** Ride the weave from z0 to z1 at `speed`, through x = `side(z)`. */
  function weave(sim: Sim, z0: number, z1: number, speed: number, side: (z: number) => number = (z) => 3 * Math.cos((Math.PI * z) / 18)): void {
    const dir = z1 > z0 ? 1 : -1;
    const ticks = Math.ceil(Math.abs(z1 - z0) / (speed / 60));
    for (let t = 0; t <= ticks; t++) {
      const z = z0 + (dir * t * speed) / 60;
      ride(sim, side(z), z, dir > 0 ? 0 : Math.PI, speed);
      sim.step(TUCK);
    }
  }

  function states(sim: Sim, first: number): number[] {
    return [0, 1, 2, 3, 4].map((k) => sim.world.things.state[first + k]);
  }

  it('all five gates in order and in time: 12 XP and 2 tokens', () => {
    const { sim } = recordingArena();
    const g = slalom(sim);
    const seen: Seen[] = [];
    weave(sim, -5, 8, 12);
    expect(states(sim, g)).toEqual([1, 1, 1, 1, 1]);
    const xp = sim.world.player.xp;
    // Gate by gate, the state shows which is next; on the last the reward lands that tick.
    const p = sim.world.player;
    let rewardTick = -1;
    for (let t = 0; t < 400 && rewardTick < 0; t++) {
      const z = 8 + (t * 12) / 60;
      ride(sim, 3 * Math.cos((Math.PI * z) / 18), z, 0, 12);
      sim.step(TUCK);
      const f = sim.world.fx;
      for (let i = 0; i < f.count; i++) seen.push({ type: f.type[i], a: f.a[i] });
      if (sim.world.things.state[g] === THING_DONE) rewardTick = t;
    }
    expect(states(sim, g)).toEqual([THING_DONE, THING_DONE, THING_DONE, THING_DONE, THING_DONE]);
    expect(p.xp).toBe(xp + 12);
    expect(p.tokens).toBe(2);
    expect(of(seen, FX_TOKEN)).toEqual([2]);
    expect(of(seen, FX_THING)).toEqual([THING_GATE, THING_GATE, THING_GATE, THING_GATE]);
  });

  it('counts a gate crossed in either direction, between its posts only', () => {
    const { sim } = recordingArena();
    const g = slalom(sim);
    // Past gate 0 on the far side of a post: nothing.
    weave(sim, -5, 5, 12, () => 6.5);
    expect(states(sim, g)[0]).toBe(0);
    // Back through it the other way, between the posts: cleared.
    weave(sim, 5, -5, 12, () => 1);
    expect(states(sim, g)[0]).toBe(1);
  });

  it('clears gates only in order', () => {
    const { sim } = recordingArena();
    const g = slalom(sim);
    // Through gate 1 first: nothing.
    weave(sim, 12, 24, 12, () => -3);
    expect(states(sim, g)).toEqual([0, 0, 0, 0, 0]);
    weave(sim, -5, 5, 12, () => 3);
    expect(states(sim, g)).toEqual([1, 1, 1, 1, 1]);
    // Gate 2 before gate 1: nothing.
    weave(sim, 30, 40, 12, () => 3);
    expect(states(sim, g)[0]).toBe(1);
  });

  it('a gate later than 2.4 s after the last is a miss; the slalom starts again 3 s after', () => {
    const { sim } = recordingArena();
    const g = slalom(sim);
    // 18 m at 7 m/s is 2.57 s: too slow for gate 1.
    weave(sim, -2, 20, 7);
    expect(states(sim, g)[0]).toBe(SLALOM_MISSED);
    // While it waits, gate 0 does not start it.
    weave(sim, -3, 3, 12, () => 3);
    expect(states(sim, g)[0]).toBe(SLALOM_MISSED);
    ride(sim, 50, -20, 0, 0);
    step(sim, 180);
    expect(states(sim, g)[0]).toBe(0);
    // At 8 m/s (2.25 s a gate) it goes all the way.
    weave(sim, -2, 76, 8);
    expect(states(sim, g)[0]).toBe(THING_DONE);
  });
});

describe('a hoop', () => {
  /** A level pass through (x, y, 0) along +z. Returns the run tick something was taken, or -1. */
  function flyThrough(sim: Sim, x: number, y: number): number {
    fly(sim, x, y, -8, 0, 16);
    let taken = -1;
    for (let t = 0; t < 60; t++) {
      // Hold the height so the pass is level.
      const m = sim.state.mover;
      m.y = y;
      m.vy = 0;
      const before = sim.world.player.tokens;
      step(sim, 1);
      if (sim.world.player.tokens > before) taken = sim.world.run.ticks;
    }
    return taken;
  }

  function stepTo(sim: Sim, tick: number): void {
    while (sim.world.run.ticks < tick) step(sim, 1);
  }

  it('is taken by a mover in the air passing within 1.6 m of its middle: a token', () => {
    const { sim } = recordingArena();
    const h = addThing(sim.world, THING_HOOP, 0, 4, 0, 0, 0);
    const seen: Seen[] = [];
    fly(sim, 0, 5.4, -8, 0, 16);
    for (let t = 0; t < 60; t++) {
      sim.state.mover.y = 5.4;
      sim.state.mover.vy = 0;
      step(sim, 1, seen);
    }
    expect(sim.world.things.state[h]).toBe(HOOP_TAKEN);
    expect(sim.world.player.tokens).toBe(1);
    expect(of(seen, FX_TOKEN)).toEqual([1]);
    expect(of(seen, FX_THING)).toEqual([THING_HOOP]);
  });

  it('is not taken from 1.7 m away, nor from the ground', () => {
    const { sim } = recordingArena();
    const h = addThing(sim.world, THING_HOOP, 0, 4, 0, 0, 0);
    flyThrough(sim, 1.7, 4);
    expect(sim.world.things.state[h]).toBe(0);
    const g = addThing(sim.world, THING_HOOP, 30, 1, 0, 0, 0);
    ride(sim, 30, -8, 0, 16);
    step(sim, 60);
    expect(sim.world.things.state[g]).toBe(0);
    expect(sim.world.player.tokens).toBe(0);
  });

  it('pays a streak: one more token for each hoop taken in the 20 s before, and comes back after 20 s', () => {
    const { sim } = recordingArena();
    const w = sim.world;
    const a = addThing(w, THING_HOOP, 0, 4, 0, 0, 0);
    const b = addThing(w, THING_HOOP, 40, 4, 0, 0, 0);
    const c = addThing(w, THING_HOOP, 80, 4, 0, 0, 0);
    const takenA = flyThrough(sim, 0, 4);
    expect(takenA).toBeGreaterThan(0);
    expect(w.player.tokens).toBe(1);
    stepTo(sim, takenA + 5 * 60);
    flyThrough(sim, 40, 4);
    expect(w.player.tokens).toBe(1 + 2);
    stepTo(sim, takenA + 10 * 60);
    flyThrough(sim, 80, 4);
    expect(w.player.tokens).toBe(3 + 3);
    // Taken again before it is back: nothing.
    expect(flyThrough(sim, 0, 4)).toBe(-1);
    expect(w.player.tokens).toBe(6);
    // Back 20 s after it was taken, and not a tick before.
    stepTo(sim, takenA + 20 * 60 - 1);
    expect(w.things.state[a]).toBe(HOOP_TAKEN);
    step(sim, 1);
    expect(w.things.state[a]).toBe(0);
    // b and c, taken about 15 s and 10 s before, still count.
    expect(w.things.state[b]).toBe(HOOP_TAKEN);
    expect(w.things.state[c]).toBe(HOOP_TAKEN);
    flyThrough(sim, 0, 4);
    expect(w.player.tokens).toBe(6 + 3);
    // Long after, alone: one token.
    step(sim, 1300);
    expect(w.things.state[b]).toBe(0);
    expect(w.things.state[c]).toBe(0);
    flyThrough(sim, 40, 4);
    expect(w.player.tokens).toBe(9 + 1);
  });
});

describe('a totem', () => {
  it('touched in any gear is spent and asks for a pack where it stands', () => {
    const { sim } = recordingArena();
    const w = sim.world;
    const t = addThing(w, THING_TOTEM, 0, 0, 0, 0, 0);
    ride(sim, 0, -0.5, 0, 0.5);
    const seen: Seen[] = [];
    step(sim, 30, seen);
    expect(sim.state.mover.gear).toBe(1);
    expect(w.things.state[t]).toBe(THING_DONE);
    expect(of(seen, FX_THING)).toEqual([THING_TOTEM]);
    expect(w.packs).toBe(1);
    expect([w.packX[0], w.packZ[0]]).toEqual([0, 0]);
  });

  it('is spent without a request when the requests are full', () => {
    const { sim } = recordingArena();
    const w = sim.world;
    w.packs = w.packX.length;
    const t = addThing(w, THING_TOTEM, 0, 0, 0, 0, 0);
    rideThrough(sim, 9);
    expect(w.things.state[t]).toBe(THING_DONE);
    expect(w.packs).toBe(w.packX.length);
  });

  it('gives a rare card when the pack elite it called dies, and not for any other death', () => {
    const { sim, sources } = recordingArena();
    const w = sim.world;
    ride(sim, 0, 0, 0, 0);
    const plain = place(sim, KIND_SHUFFLER, 30, 30);
    const elite = place(sim, KIND_SHUFFLER, -30, 30);
    w.horde.mark[elite] |= MARK_PACK;
    root(w);
    w.horde.hp[plain] = 0;
    step(sim, 1);
    expect(sources).toEqual([]);
    const e = w.horde.mark[0] & MARK_PACK ? 0 : 1;
    w.horde.hp[e] = 0;
    step(sim, 1);
    expect(sources).toEqual([OFFER_TOTEM]);
  });
});

describe('the step', () => {
  it('allocates nothing: no new, no closures, no literals, no array methods that copy', () => {
    const src = thingsSource;
    const at = src.indexOf('// ---- the step: nothing from here down allocates');
    expect(at).toBeGreaterThan(0);
    const body = src
      .slice(at)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(body).not.toMatch(/\bnew\b/);
    expect(body).not.toMatch(/=>/);
    expect(body).not.toMatch(/\bfunction\s*\(/);
    expect(body).not.toMatch(/[=(,:]\s*\[/);
    expect(body).not.toMatch(/[=(,:]\s*\{/);
    expect(body).not.toMatch(/\.(map|filter|slice|concat|push|splice|reduce)\(/);
  });
});
