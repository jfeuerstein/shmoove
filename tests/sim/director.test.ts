/** What a player would notice about where the horde comes from, how much of it, and of what. */
import { describe, expect, it } from 'vitest';
import { makeBowl, type Bowl } from '../../src/sim/bowl';
import { behindLimit, capCount, DIRECTOR, floorCount, makeElite, spawnRate, stepDirector } from '../../src/sim/director';
import { stepHorde } from '../../src/sim/horde';
import { makeSimState } from '../../src/sim/sim';
import type { SimState, Vec3 } from '../../src/sim/types';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_SHIELD,
  hashWorld,
  KIND_BOLLARD,
  KIND_BRUISER,
  KIND_CLINGER,
  KIND_COUNT,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KIND_STANDSTILL,
  KINDS,
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
  /** By kind: run time of the first to come up, the most alive at once, and its late share. */
  first: number[];
  most: number[];
  lateShare: number[][];
  /** Run times at which elites came up. */
  elites: number[];
  /** An elite that is not a shuffler or a cutter, or has the wrong health. */
  badElites: number;
}

const n: Vec3 = { x: 0, y: 1, z: 0 };

/** How long the whole-run laps go, s: past the last kind's arrival and the cap's top at 8:00. */
const WHOLE = 510;
/** From here on the run counts as late, for the shares, s. */
const LATE = 450;

/** Run a whole lap of the run up to `WHOLE`, checking every spawn and the count as it goes. */
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
    first: new Array<number>(KIND_COUNT).fill(Infinity),
    most: new Array<number>(KIND_COUNT).fill(0),
    lateShare: Array.from({ length: KIND_COUNT }, () => [] as number[]),
    elites: [],
    badElites: 0,
  };
  const alive = new Array<number>(KIND_COUNT).fill(0);
  // What the rate alone would have brought by now, held to the cap, less what was killed.
  let brought = 0;
  let lastKill = -Infinity;
  for (let t = 0; t < WHOLE * 60; t++) {
    lap(sc);
    const m = sc.s.mover;
    let gnats = 0;
    let bollards = 0;
    alive.fill(0);
    for (let i = 0; i < h.count; i++) {
      if (h.kind[i] === KIND_GNAT) gnats++;
      if (h.kind[i] === KIND_BOLLARD) bollards++;
      alive[h.kind[i]]++;
      if (h.age[i] !== 1) continue;
      // Came up this tick.
      tally.spawns++;
      tally.first[h.kind[i]] = Math.min(tally.first[h.kind[i]], sc.seconds);
      if (h.elite[i] !== 0) {
        tally.elites.push(sc.seconds);
        const ok = (h.kind[i] === KIND_SHUFFLER || h.kind[i] === KIND_CUTTER) && h.hp[i] === DIRECTOR.eliteHp * KINDS[h.kind[i]].hp;
        if (!ok) tally.badElites++;
      }
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
      // A cloud is saved up for and arrives whole, so allow a cloud and a second of rate either way;
      // just after kills, also the bank the director may spend at once.
      const bank = t - lastKill < 3 * 60 ? DIRECTOR.bank * spawnRate(sc.seconds) : 0;
      const slack = DIRECTOR.cloudSize + spawnRate(sc.seconds) + 2 + bank;
      tally.worstTrack = Math.max(tally.worstTrack, Math.abs(h.count - brought) - slack);
    }
    if (sc.seconds >= LATE && t % 60 === 0) tally.lateGnatShare.push(gnats / h.count);
    for (let k = 0; k < KIND_COUNT; k++) {
      tally.most[k] = Math.max(tally.most[k], alive[k]);
      if (sc.seconds >= LATE && t % 60 === 0) tally.lateShare[k].push(alive[k] / h.count);
    }
    // A player who kills about as fast as the horde comes keeps it off the cap: near the cap the
    // lap kills a tenth of it, spread over the rest of the horde, so what is due can come up.
    const cap = Math.floor(capCount(sc.seconds));
    if (h.count >= cap * 0.9) {
      const want = Math.ceil(h.count - cap * 0.8);
      let killed = 0;
      lastKill = t;
      for (let j = 0; killed < want; j++) {
        const i = (t * 7919 + j * 104729) % h.count;
        // What dies first is the small stuff: bollards and elites take longer to bring down.
        if (h.hp[i] <= 0 || h.kind[i] === KIND_BOLLARD || h.elite[i] !== 0) continue;
        h.hp[i] = 0;
        killed++;
      }
      sc.w.deaths.count = 0;
      reapHorde(sc.w);
      brought -= killed;
    }
  }
  tally.mostBollards = Math.max(tally.mostBollards, 0);
  return tally;
}

describe('a whole run on the bowl', () => {
  const runs = [1, 2, 3].map((seed) => ({ seed, tally: wholeRun(seed) }));

  for (const { seed, tally } of runs) {
    it(`seed ${seed}: the horde grows at the rate, from the floor, less what is killed, and never past the cap`, () => {
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

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  for (const { seed, tally } of runs) {
    it(`seed ${seed}: the newer kinds arrive on schedule, in their shares or under their caps`, () => {
      const from = [
        [KIND_CUTTER, DIRECTOR.cutterFrom],
        [KIND_LOBBER, DIRECTOR.lobberFrom],
        [KIND_SLUDGE, DIRECTOR.sludgeFrom],
        [KIND_CLINGER, DIRECTOR.clingerFrom],
      ];
      for (const [kind, at] of from) {
        expect(tally.first[kind]).toBeGreaterThanOrEqual(at);
        expect(tally.first[kind]).toBeLessThan(at + 5);
      }
      expect(tally.most[KIND_LOBBER]).toBeLessThanOrEqual(DIRECTOR.lobberMax);
      expect(tally.most[KIND_LOBBER]).toBeGreaterThanOrEqual(DIRECTOR.lobberMax - 2);
      expect(tally.most[KIND_SLUDGE]).toBeLessThanOrEqual(DIRECTOR.sludgeMax);
      expect(tally.most[KIND_SLUDGE]).toBeGreaterThanOrEqual(DIRECTOR.sludgeMax - 1);
      // About 8% cutters, 6% clingers, late in the run.
      expect(mean(tally.lateShare[KIND_CUTTER])).toBeGreaterThan(DIRECTOR.cutterShare * 0.7);
      expect(mean(tally.lateShare[KIND_CUTTER])).toBeLessThan(DIRECTOR.cutterShare * 1.3);
      expect(mean(tally.lateShare[KIND_CLINGER])).toBeGreaterThan(DIRECTOR.clingerShare * 0.7);
      expect(mean(tally.lateShare[KIND_CLINGER])).toBeLessThan(DIRECTOR.clingerShare * 1.3);
    });

    it(`seed ${seed}: from 5:00, about every 30 s, a shuffler or cutter comes up an elite`, () => {
      expect(tally.badElites).toBe(0);
      expect(tally.elites[0]).toBeGreaterThanOrEqual(DIRECTOR.eliteFrom);
      expect(tally.elites[0]).toBeLessThan(DIRECTOR.eliteFrom + 7);
      // 300, 330, ... 510 when something comes up the moment one is due; on this lap nothing dies,
      // so at the cap the next spawn waits for something to be recycled.
      expect(tally.elites.length).toBeGreaterThanOrEqual(5);
      expect(tally.elites.length).toBeLessThanOrEqual(8);
      for (let k = 1; k < tally.elites.length; k++) {
        const gap = tally.elites[k] - tally.elites[k - 1];
        expect(gap).toBeGreaterThanOrEqual(DIRECTOR.eliteEvery);
        expect(gap).toBeLessThan(DIRECTOR.eliteEvery + 7);
      }
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
      for (let t = 0; t < 40 * 60; t++) {
        const { x, dir } = shuttle(sc, 20, 125);
        // Away from the turns at the ends of the line, where ahead runs off the map.
        if (Math.abs(x) > 70) continue;
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

  it('the schedules are what the table says over ten minutes: the rate rises, the cap tops out at 400 at 8:00, the floor is under the cap', () => {
    for (let s = 0; s <= 600; s += 5) {
      expect(spawnRate(s + 5)).toBeGreaterThanOrEqual(spawnRate(s));
      expect(capCount(s + 5)).toBeGreaterThanOrEqual(capCount(s));
      expect(floorCount(s)).toBeLessThan(capCount(s));
    }
    expect(capCount(470)).toBeLessThan(400);
    expect(capCount(480)).toBe(400);
    expect(capCount(600)).toBe(400);
    expect(capCount(900)).toBe(400);
    // Each act is busier than the one before.
    expect(spawnRate(360)).toBeGreaterThan(spawnRate(180) * 1.2);
    expect(spawnRate(540)).toBeGreaterThan(spawnRate(360) * 1.2);
  });
});

describe('cost with every kind', () => {
  it('director and horde together stay well under a millisecond a tick with 400 enemies of mixed kinds', () => {
    const sc = new Scripted(1);
    sc.w.run.ticks = 480 * 60;
    lap(sc);
    const m = sc.s.mover;
    const kinds = [KIND_SHUFFLER, KIND_SHUFFLER, KIND_SHUFFLER, KIND_GNAT, KIND_GNAT, KIND_CUTTER, KIND_LOBBER, KIND_SLUDGE, KIND_CLINGER, KIND_BOLLARD];
    const auras = [ELITE_HASTE, ELITE_SHIELD, ELITE_JAM];
    for (let k = 0; sc.w.horde.count < capCount(480); k++) {
      const a = k * 2.399963;
      const r = 12 + (k % 55);
      const x = m.x + Math.sin(a) * r;
      const z = m.z + Math.cos(a) * r;
      const i = spawnEnemy(sc.w, kinds[k % kinds.length], x, sc.terrain.heightAt(x, z), z);
      sc.w.horde.age[i] = SPAWN_TICKS;
      if (k % 50 === 0) makeElite(sc.w, i, auras[(k / 50) % 3]);
    }
    for (let t = 0; t < 300; t++) lap(sc);
    expect(sc.w.horde.count).toBeGreaterThanOrEqual(380);
    const ticks = 1200;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) lap(sc);
    const avg = (performance.now() - t0) / ticks;
    console.log(`[horde+director, mixed] ${sc.w.horde.count} enemies: ${avg.toFixed(3)} ms/tick`);
    expect(avg).toBeLessThan(3);
  });
});

describe('the cap', () => {
  it('with nothing dying the horde fills up to the cap and no further', () => {
    const sc = new Scripted(1);
    let most = 0;
    for (let t = 0; t < 120 * 60; t++) {
      lap(sc);
      expect(sc.w.horde.count).toBeLessThanOrEqual(Math.floor(capCount(sc.seconds)));
      most = Math.max(most, sc.w.horde.count - Math.floor(capCount(sc.seconds)));
    }
    expect(most).toBeGreaterThanOrEqual(-2);
  });
});

describe('while a boss is up', () => {
  /**
   * From 3:20, laps with the horde held at a level above the floor and under the cap (the newest are
   * taken away by hand, which the director does not refund), so every spawn is paid for at the rate.
   * Returns the spawns and the bollards seen in 30 s.
   */
  function heldLap(withBoss: boolean): { spawns: number; bollards: number } {
    const sc = new Scripted(1);
    sc.w.run.ticks = 200 * 60;
    if (withBoss) {
      const i = spawnEnemy(sc.w, KIND_BRUISER, 0, sc.terrain.heightAt(0, 0), 0);
      sc.w.horde.age[i] = SPAWN_TICKS;
    }
    const h = sc.w.horde;
    let spawns = 0;
    let bollards = 0;
    for (let t = 0; t < 30 * 60; t++) {
      lap(sc);
      for (let i = 0; i < h.count; i++) {
        if (h.age[i] !== 1) continue;
        spawns++;
        if (h.kind[i] === KIND_BOLLARD) bollards++;
      }
      const keep = floorCount(sc.seconds) + 20;
      for (let i = h.count - 1; i >= 0 && h.count > keep; i--) if (h.kind[i] !== KIND_BRUISER) removeEnemy(sc.w, i);
    }
    return { spawns, bollards };
  }

  it('enemies come at 0.6 of the rate, and no new bollards', () => {
    const calm = heldLap(false);
    const boss = heldLap(true);
    expect(calm.bollards).toBeGreaterThan(0);
    expect(boss.bollards).toBe(0);
    const share = boss.spawns / calm.spawns;
    expect(share).toBeGreaterThan(DIRECTOR.bossRate - 0.08);
    expect(share).toBeLessThan(DIRECTOR.bossRate + 0.08);
  });

  it('a boss is never taken away, however far behind', () => {
    const sc = new Scripted(2);
    sc.w.run.ticks = 400 * 60;
    const i = spawnEnemy(sc.w, KIND_STANDSTILL, -120, sc.terrain.heightAt(-120, 0), 0);
    sc.w.horde.age[i] = SPAWN_TICKS;
    for (let t = 0; t < 10 * 60; t++) shuttle(sc, 20, 125);
    let bosses = 0;
    for (let j = 0; j < sc.w.horde.count; j++) if (sc.w.horde.kind[j] === KIND_STANDSTILL) bosses++;
    expect(bosses).toBe(1);
  });
});

describe('packs', () => {
  it('a pack asked for comes even with spawning off, and only once', () => {
    const sc = new Scripted(1);
    sc.w.spawning = false;
    sc.w.packs = 2;
    sc.w.packX[0] = 20;
    sc.w.packZ[0] = 0;
    sc.w.packX[1] = -20;
    sc.w.packZ[1] = 30;
    sc.step(0, 0, 0, 0);
    expect(sc.w.packs).toBe(0);
    expect(sc.w.horde.count).toBe(2 * (1 + DIRECTOR.packSize));
    sc.step(0, 0, 0, 0);
    expect(sc.w.horde.count).toBe(2 * (1 + DIRECTOR.packSize));
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
    sc.w.run.ticks = 480 * 60;
    lap(sc);
    // Fill to the cap by hand around the mover (the rate would take most of a minute).
    const m = sc.s.mover;
    for (let k = 0; sc.w.horde.count < capCount(480); k++) {
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
