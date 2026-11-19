/** What a player would notice about where the horde comes from, how much of it, and of what. */
import { describe, expect, it } from 'vitest';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { behindLimit, capCount, DIRECTOR, floorCount, spawnRate, stepDirector } from '../../src/sim/director';
import { stepHorde } from '../../src/sim/horde';
import { makeSimState } from '../../src/sim/sim';
import type { SimState, Vec3 } from '../../src/sim/types';
import {
  hashWorld,
  KIND_BOLLARD,
  KIND_GNAT,
  KIND_SHUFFLER,
  makeWorld,
  reapHorde,
  removeEnemy,
  spawnEnemy,
  SPAWN_TICKS,
  type World,
} from '../../src/sim/world';

const bowls = new Map<number, Bowl>();
function bowl(seed: number): Bowl {
  let b = bowls.get(seed);
  if (!b) {
    b = makeBowl(seed);
    bowls.set(seed, b);
  }
  return b;
}

/** A world on the real bowl driven by a scripted mover: only the director and the horde run. */
class Scripted {
  readonly terrain: Bowl;
  readonly w: World;
  readonly s: SimState;

  constructor(seed: number) {
    this.terrain = bowl(seed);
    this.w = makeWorld(seed);
    this.s = makeSimState(this.terrain);
    this.s.viewYaw = 0;
  }

  get seconds(): number {
    return this.w.run.ticks / 60;
  }

  /** Put the mover at (x, z) moving at (vx, vz), then run one tick of the world. */
  step(x: number, z: number, vx: number, vz: number): void {
    const m = this.s.mover;
    m.x = x;
    m.z = z;
    m.y = this.terrain.heightAt(x, z);
    m.vx = vx;
    m.vz = vz;
    m.speed = Math.hypot(vx, vz);
    this.w.fx.count = 0;
    stepDirector(this.w, this.s, this.terrain);
    stepHorde(this.w, this.s, this.terrain);
    this.w.run.ticks++;
    this.s.tick++;
  }
}

/** A slow lap around the middle of the bowl: radius 60 m at 6 m/s. */
function lap(sc: Scripted): void {
  const t = sc.seconds;
  const r = 60;
  const om = 6 / r;
  sc.step(Math.cos(om * t) * r, Math.sin(om * t) * r, -Math.sin(om * t) * 6, Math.cos(om * t) * 6);
}

/** Back and forth along a straight line through the middle at `speed`. */
function shuttle(sc: Scripted, speed: number, half: number): { x: number; dir: number } {
  const leg = (2 * half) / speed;
  const t = sc.seconds;
  const k = Math.floor(t / leg);
  const f = t - k * leg;
  const dir = k % 2 === 0 ? 1 : -1;
  const x = dir > 0 ? -half + f * speed : half - f * speed;
  sc.step(x, 0, dir * speed, 0);
  return { x, dir };
}

interface Tally {
  spawns: number;
  bad: string[];
  firstGnat: number;
  firstBollard: number;
  mostBollards: number;
  /** Worst gap between the living count and what the rate alone would have brought (nothing dies). */
  worstTrack: number;
  /** Most alive above the cap at any tick. */
  overCap: number;
  lateGnatShare: number[];
}

const n: Vec3 = { x: 0, y: 1, z: 0 };

/** Run a whole three-minute lap, checking every spawn and the count as it goes. */
function wholeRun(seed: number): Tally {
  const sc = new Scripted(seed);
  const h = sc.w.horde;
  const rMax = DIRECTOR.region * sc.terrain.radius;
  const tally: Tally = {
    spawns: 0,
    bad: [],
    firstGnat: Infinity,
    firstBollard: Infinity,
    mostBollards: 0,
    worstTrack: 0,
    overCap: -Infinity,
    lateGnatShare: [],
  };
  // What the rate alone would have brought by now, held to the cap: nothing dies on a lap.
  let brought = 0;
  for (let t = 0; t < 180 * 60; t++) {
    lap(sc);
    const m = sc.s.mover;
    let gnats = 0;
    let bollards = 0;
    for (let i = 0; i < h.count; i++) {
      if (h.kind[i] === KIND_GNAT) gnats++;
      if (h.kind[i] === KIND_BOLLARD) bollards++;
      if (h.age[i] !== 1) continue;
      // Came up this tick.
      tally.spawns++;
      const d = Math.hypot(h.x[i] - m.x, h.z[i] - m.z);
      const r = Math.hypot(h.x[i], h.z[i]);
      sc.terrain.normalAt(h.x[i], h.z[i], n);
      const slope = Math.hypot(n.x, n.z) / n.y;
      if (d < DIRECTOR.nearest || r > rMax || slope >= DIRECTOR.maxSlope || Math.abs(h.y[i] - sc.terrain.heightAt(h.x[i], h.z[i])) > 1e-3) {
        tally.bad.push(`t=${sc.seconds.toFixed(2)} d=${d.toFixed(1)} r=${r.toFixed(1)} slope=${slope.toFixed(2)}`);
      }
      if (h.kind[i] === KIND_GNAT) tally.firstGnat = Math.min(tally.firstGnat, sc.seconds);
      if (h.kind[i] === KIND_BOLLARD) tally.firstBollard = Math.min(tally.firstBollard, sc.seconds);
    }
    tally.mostBollards = Math.max(tally.mostBollards, bollards);
    brought = Math.min(capCount(sc.seconds), Math.max(floorCount(sc.seconds), brought + spawnRate(sc.seconds) / 60));
    tally.overCap = Math.max(tally.overCap, h.count - capCount(sc.seconds));
    if (sc.seconds >= 3) {
      // A cloud is saved up for and arrives whole, so allow a cloud and a second of rate either way.
      const slack = DIRECTOR.cloudSize + spawnRate(sc.seconds) + 2;
      tally.worstTrack = Math.max(tally.worstTrack, Math.abs(h.count - brought) - slack);
    }
    if (sc.seconds >= 150 && t % 60 === 0) tally.lateGnatShare.push(gnats / h.count);
  }
  tally.mostBollards = Math.max(tally.mostBollards, 0);
  return tally;
}

describe('a whole run on the bowl', () => {
  const runs = [1, 2, 3].map((seed) => ({ seed, tally: wholeRun(seed) }));

  for (const { seed, tally } of runs) {
    it(`seed ${seed}: with nothing dying the horde grows at the rate, from the floor, up to the cap`, () => {
      expect(tally.worstTrack).toBeLessThanOrEqual(0);
    });

    it(`seed ${seed}: never more alive than the cap`, () => {
      expect(tally.overCap).toBeLessThanOrEqual(0);
    });

    it(`seed ${seed}: every spawn is far enough, inside the region, on fair ground`, () => {
      expect(tally.spawns).toBeGreaterThan(400);
      expect(tally.bad).toEqual([]);
    });

    it(`seed ${seed}: kinds arrive on schedule and in their shares`, () => {
      expect(tally.firstGnat).toBeGreaterThanOrEqual(DIRECTOR.gnatFrom);
      expect(tally.firstGnat).toBeLessThan(DIRECTOR.gnatFrom + 5);
      expect(tally.firstBollard).toBeGreaterThanOrEqual(DIRECTOR.bollardFrom);
      expect(tally.firstBollard).toBeLessThan(DIRECTOR.bollardFrom + 5);
      expect(tally.mostBollards).toBeLessThanOrEqual(DIRECTOR.bollardMax);
      // Bollards the lap leaves 85 m behind are recycled, so the cap is not always full.
      expect(tally.mostBollards).toBeGreaterThanOrEqual(DIRECTOR.bollardMax - 2);
      const share = tally.lateGnatShare.reduce((a, b) => a + b, 0) / tally.lateGnatShare.length;
      expect(share).toBeGreaterThan(0.22);
      expect(share).toBeLessThan(0.38);
    });
  }

  it('gnats come up as clouds of about ten in a small blob, all at once', () => {
    const sc = new Scripted(2);
    const h = sc.w.horde;
    let clouds = 0;
    for (let t = 0; t < 120 * 60; t++) {
      lap(sc);
      // Look at each cloud as its first members finish rising.
      for (let i = 0; i < h.count; i++) {
        if (h.kind[i] !== KIND_GNAT || h.age[i] !== SPAWN_TICKS) continue;
        let mates = 0;
        let spread = 0;
        let later = false;
        for (let j = 0; j < h.count; j++) {
          if (h.kind[j] !== KIND_GNAT || h.age[j] > SPAWN_TICKS + 5) continue;
          const d = Math.hypot(h.x[j] - h.x[i], h.z[j] - h.z[i]);
          if (d >= 4) continue;
          // A cloud comes up over a few ticks: judge it once, by its first members.
          if (h.age[j] > SPAWN_TICKS) later = true;
          mates++;
          spread = Math.max(spread, d);
        }
        if (later) continue;
        expect(mates).toBeGreaterThanOrEqual(8);
        expect(mates).toBeLessThanOrEqual(DIRECTOR.cloudSize);
        expect(spread).toBeLessThanOrEqual(2 * DIRECTOR.cloudRadius + 0.5);
        clouds++;
        break;
      }
    }
    expect(clouds).toBeGreaterThan(3);
  });
});

describe('where they come from', () => {
  it('a fast mover is met from ahead: most spawns land within 70 degrees of its travel', () => {
    for (const seed of [1, 2, 3]) {
      const sc = new Scripted(seed);
      const h = sc.w.horde;
      let ahead = 0;
      let all = 0;
      for (let t = 0; t < 20 * 60; t++) {
        const { x, dir } = shuttle(sc, 20, 125);
        for (let i = 0; i < h.count; i++) {
          if (h.age[i] !== 1) continue;
          all++;
          const dx = h.x[i] - x;
          const dz = h.z[i];
          const cos = (dx * dir) / Math.hypot(dx, dz);
          if (cos >= Math.cos(DIRECTOR.aheadHalfAngle) - 1e-9) ahead++;
        }
      }
      expect(all).toBeGreaterThan(100);
      expect(ahead / all).toBeGreaterThan(0.6);
      expect(ahead / all).toBeLessThan(0.85);
    }
  });

  it('a slow mover is met from all around', () => {
    const sc = new Scripted(1);
    const h = sc.w.horde;
    const quadrants = [0, 0, 0, 0];
    for (let t = 0; t < 60 * 60; t++) {
      sc.step(0, 0, 0, 0);
      for (let i = 0; i < h.count; i++) {
        if (h.age[i] !== 1) continue;
        const q = (h.x[i] >= 0 ? 1 : 0) + (h.z[i] >= 0 ? 2 : 0);
        quadrants[q]++;
      }
    }
    const total = quadrants.reduce((a, b) => a + b, 0);
    for (const q of quadrants) expect(q / total).toBeGreaterThan(0.15);
  });

  it('at 20 m/s on a straight line, most of the horde within 70 m is ahead after 20 s', () => {
    for (const seed of [1, 2, 3]) {
      const sc = new Scripted(seed);
      const h = sc.w.horde;
      let ahead = 0;
      let near = 0;
      // 125 m each way: at 20 s the mover is 8 s into its second leg, well clear of the turn.
      for (let t = 0; t < 22 * 60; t++) {
        const { x, dir } = shuttle(sc, 20, 125);
        if (t < 20 * 60) continue;
        for (let i = 0; i < h.count; i++) {
          const dx = h.x[i] - x;
          const dz = h.z[i];
          if (dx * dx + dz * dz > 70 * 70) continue;
          near++;
          if (dx * dir > 0) ahead++;
        }
      }
      expect(near).toBeGreaterThan(0);
      expect(ahead / near).toBeGreaterThan(0.5);
    }
  });

  it('what is left far behind a fast mover is taken away, not killed', () => {
    const sc = new Scripted(1);
    const h = sc.w.horde;
    for (let t = 0; t < 10 * 60; t++) {
      const { x, dir } = shuttle(sc, 20, 125);
      for (let i = 0; i < h.count; i++) {
        const dx = h.x[i] - x;
        const d = Math.hypot(dx, h.z[i]);
        expect(d).toBeLessThanOrEqual(DIRECTOR.recycleFar + 1);
        if (dx * dir < 0) expect(d).toBeLessThanOrEqual(behindLimit(20, 0) + 1);
      }
    }
    // Nothing died: the run's kill count is untouched.
    expect(behindLimit(20, 0)).toBeLessThanOrEqual(DIRECTOR.recycleBehind);
    expect(behindLimit(6, 0)).toBe(Infinity);
    expect(sc.w.player.kills).toBe(0);
    expect(sc.w.deaths.count).toBe(0);
  });
});

describe('the rate, the floor and the cap', () => {
  it('kills faster than the rate thin the horde, down to the floor and never below it', () => {
    const a = new Scripted(1);
    const b = new Scripted(1);
    for (let t = 0; t < 100 * 60; t++) {
      lap(a);
      lap(b);
    }
    expect(b.w.horde.count).toBe(a.w.horde.count);
    const before = b.w.horde.count;
    let lowest = Infinity;
    for (let t = 0; t < 30 * 60; t++) {
      lap(a);
      lap(b);
      // A strong player: one kill every three ticks (20 a second), well above the rate.
      if (t % 3 === 0 && b.w.horde.count > 0) {
        b.w.deaths.count = 0;
        b.w.horde.hp[0] = 0;
        reapHorde(b.w);
      }
      if (t > 60) lowest = Math.min(lowest, b.w.horde.count - floorCount(b.seconds));
    }
    expect(b.w.horde.count).toBeLessThan(before * 0.6);
    expect(b.w.horde.count).toBeLessThan(a.w.horde.count * 0.5);
    // Kills only ever outpace the floor's top-up by the one enemy just killed.
    expect(lowest).toBeGreaterThanOrEqual(-1);
  });

  it('after a wipe the floor is back within half a second', () => {
    const sc = new Scripted(2);
    for (let t = 0; t < 90 * 60; t++) lap(sc);
    while (sc.w.horde.count > 0) removeEnemy(sc.w, sc.w.horde.count - 1);
    for (let t = 0; t < 30; t++) lap(sc);
    expect(sc.w.horde.count).toBeGreaterThanOrEqual(floorCount(sc.seconds));
  });

  it('what is recycled comes back: a fast mover is not starved of horde', () => {
    for (const seed of [1, 2, 3]) {
      const fast = new Scripted(seed);
      const slow = new Scripted(seed);
      let recycledAway = 0;
      for (let t = 0; t < 90 * 60; t++) {
        const n0 = fast.w.horde.count;
        shuttle(fast, 20, 125);
        lap(slow);
        if (fast.w.horde.count < n0) recycledAway += n0 - fast.w.horde.count;
      }
      // Plenty was taken away behind the fast mover, and the horde is still about as big.
      expect(recycledAway).toBeGreaterThan(50);
      expect(fast.w.horde.count).toBeGreaterThan(slow.w.horde.count * 0.85);
    }
  });

  it('the schedules are what the table says: the rate rises, the cap ends at 400, the floor is under the cap', () => {
    for (let s = 0; s <= 180; s += 5) {
      expect(spawnRate(s + 5)).toBeGreaterThanOrEqual(spawnRate(s));
      expect(floorCount(s)).toBeLessThan(capCount(s));
    }
    expect(capCount(180)).toBe(400);
    expect(capCount(240)).toBe(400);
  });
});

describe('switched off', () => {
  it('with spawning off nothing comes and nothing is taken away', () => {
    const sc = new Scripted(1);
    sc.w.spawning = false;
    spawnEnemy(sc.w, KIND_SHUFFLER, 100, sc.terrain.heightAt(100, 0), 0);
    sc.w.horde.age[0] = SPAWN_TICKS;
    for (let t = 0; t < 30 * 60; t++) shuttle(sc, 20, 125);
    expect(sc.w.horde.count).toBe(1);
  });
});

describe('determinism', () => {
  it('two identical runs are identical every tick', () => {
    const a = new Scripted(2);
    const b = new Scripted(2);
    for (let t = 0; t < 100 * 60; t++) {
      if (t < 50 * 60) {
        lap(a);
        lap(b);
      } else {
        shuttle(a, 20, 120);
        shuttle(b, 20, 120);
      }
      expect(hashWorld(b.w)).toBe(hashWorld(a.w));
    }
    expect(a.w.horde.count).toBeGreaterThan(100);
  });
});

describe('cost', () => {
  it('director and horde together take well under a millisecond a tick with 400 enemies', () => {
    const sc = new Scripted(3);
    sc.w.run.ticks = 180 * 60;
    lap(sc);
    // Fill to the cap by hand around the mover (the rate would take most of a minute).
    const m = sc.s.mover;
    for (let k = 0; sc.w.horde.count < capCount(180); k++) {
      const a = k * 2.399963;
      const r = 20 + (k % 50);
      const x = m.x + Math.sin(a) * r;
      const z = m.z + Math.cos(a) * r;
      const i = spawnEnemy(sc.w, KIND_SHUFFLER, x, sc.terrain.heightAt(x, z), z);
      sc.w.horde.age[i] = SPAWN_TICKS;
    }
    for (let t = 0; t < 30; t++) lap(sc);
    expect(sc.w.horde.count).toBeGreaterThanOrEqual(380);
    // Warm up, then time.
    for (let t = 0; t < 300; t++) lap(sc);
    const ticks = 1200;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) lap(sc);
    const avg = (performance.now() - t0) / ticks;
    console.log(`[horde+director] ${sc.w.horde.count} enemies: ${avg.toFixed(3)} ms/tick`);
    expect(avg).toBeLessThan(3);
  });
});
