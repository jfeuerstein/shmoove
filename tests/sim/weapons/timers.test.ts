/**
 * What every weapon shares now that weapons fire on timers: each fires standing still, at its own
 * wait; Haste shortens the wait in proportion; the same field takes the same damage however the
 * mover is moving and whatever its gear; level 5 beats level 1; nothing still rising is touched;
 * the pools hold at the fastest rate; and nothing in the weapons' source reads how the mover moves.
 */
import { describe, expect, it } from 'vitest';
import {
  W_CRUMBS,
  W_LANCE,
  W_ORBIT,
  W_SEEKERS,
  W_SKIPPER,
  W_SLAM,
  W_SLIPSTREAM,
  W_STATIC,
  WEAPON_INFO,
} from '../../../src/sim/arsenal';
import { SEEKERS } from '../../../src/sim/seekers';
import type { Sim } from '../../../src/sim/sim';
import { CRUMBS } from '../../../src/sim/weapons/crumbs';
import { SKIPPER } from '../../../src/sim/weapons/skipper';
import { SLAM } from '../../../src/sim/weapons/slam';
import { STATIC } from '../../../src/sim/weapons/static';
import {
  addZone,
  FX_ARC,
  FX_SHOT,
  FX_SLAM,
  FX_STONE,
  KIND_BOLLARD,
  KIND_SHUFFLER,
  MAX_FX,
  MAX_SHOTS,
  MAX_ZONES,
  SHOT_DART,
  SHOT_STONE,
  ZONE_MINE,
  ZONE_TAR,
  type World,
} from '../../../src/sim/world';
import { place } from '../world-fixtures';
import { countFx, haste, holdPose, placeRising, poseTick, rig, ticksIn, totalHp, type Pose } from './rig';

const ALL = [W_SEEKERS, W_SLAM, W_ORBIT, W_STATIC, W_SKIPPER, W_SLIPSTREAM, W_CRUMBS, W_LANCE];
const DAMAGING = ALL.filter((id) => id !== W_SLIPSTREAM);
const name = (id: number): string => WEAPON_INFO[id].name;

function minesLaidThisTick(w: World): number {
  let n = 0;
  for (let i = 0; i < w.zones.count; i++) if (w.zones.kind[i] === ZONE_MINE && w.zones.age[i] === 0) n++;
  return n;
}

/** The weapons that fire one shot at a time on a wait, and how to see a shot go. */
const TIMED: { id: number; wait: readonly number[]; fired: (w: World) => boolean }[] = [
  { id: W_SEEKERS, wait: SEEKERS.wait, fired: (w) => countFx(w, FX_SHOT) > 0 },
  { id: W_SLAM, wait: SLAM.wait, fired: (w) => countFx(w, FX_SLAM) > 0 },
  {
    id: W_STATIC,
    wait: STATIC.wait,
    fired: (w) => {
      // The first link of a chain is numbered 0.
      for (let i = 0; i < w.fx.count; i++) if (w.fx.type[i] === FX_ARC && w.fx.a[i] === 0) return true;
      return false;
    },
  },
  { id: W_SKIPPER, wait: SKIPPER.wait, fired: (w) => countFx(w, FX_STONE) > 0 },
  { id: W_CRUMBS, wait: CRUMBS.wait, fired: (w) => minesLaidThisTick(w) > 0 },
];

/** A target that never dies, 5 m ahead: in reach of everything that aims, clear of the feet. */
function target(sim: Sim): number {
  return place(sim, KIND_BOLLARD, 0, 5);
}

/** Stand for `ticks` with a deathless target; the ticks (1-based) on which the weapon fired. */
function fireTicks(sim: Sim, fired: (w: World) => boolean, ticks: number): number[] {
  const t0 = target(sim);
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    sim.world.horde.hp[t0] = 1e9;
    poseTick(sim, 'stand', 1, t);
    if (fired(sim.world)) out.push(t + 1);
  }
  return out;
}

describe('standing still, each weapon fires at its own wait', () => {
  for (const spec of TIMED) {
    for (let level = 1; level <= 5; level++) {
      it(`${name(spec.id)} level ${level}: the first after one full wait, then one every wait`, () => {
        const wait = ticksIn(spec.wait[level - 1]);
        const shots = fireTicks(rig(spec.id, level), spec.fired, wait * 10 + wait / 2);
        expect(shots.length).toBe(10);
        for (let k = 0; k < shots.length; k++) expect(shots[k]).toBe(wait * (k + 1));
      });
    }
  }
});

describe('Haste shortens the wait in proportion', () => {
  for (const spec of TIMED) {
    it(`${name(spec.id)}: at the most Haste there is, shots come that much more often`, () => {
      const ticks = ticksIn(60);
      const plain = fireTicks(rig(spec.id, 3), spec.fired, ticks).length;
      const sim = rig(spec.id, 3);
      const k = haste(sim, 5);
      expect(k).toBeLessThan(0.75);
      const quick = fireTicks(sim, spec.fired, ticks).length;
      expect(plain).toBe(Math.floor(60 / spec.wait[2]));
      // A wait that is not a whole number of ticks still averages out: within one shot of the rate.
      expect(Math.abs(quick - 60 / (spec.wait[2] * k))).toBeLessThanOrEqual(1);
      expect(quick / plain).toBeCloseTo(1 / k, 1);
    });
  }
});

// ---- the same field, however the mover moves ------------------------------------------------

/**
 * Where the field stands, around the mover at the origin facing +z: one at its feet, a ring at
 * the discs' distance, a line in the beam, some behind in the draft, more scattered further out,
 * and a few bollards. Light enemies' health varies so that kills and damage both mean something.
 */
const FIELD: [number, number, number][] = [
  [KIND_SHUFFLER, 1.5, 0.4],
  [KIND_SHUFFLER, -2.6, 0.5],
  [KIND_SHUFFLER, 2.2, -1.6],
  [KIND_SHUFFLER, -1.0, -2.5],
  [KIND_SHUFFLER, 0.2, 3.5],
  [KIND_SHUFFLER, -0.3, 6],
  [KIND_SHUFFLER, 0.4, 8.5],
  [KIND_SHUFFLER, 3, 6],
  [KIND_SHUFFLER, -4, 5],
  [KIND_SHUFFLER, 5, -3],
  [KIND_SHUFFLER, -6, -4],
  [KIND_SHUFFLER, 7, 2],
  [KIND_SHUFFLER, -8, 1],
  [KIND_SHUFFLER, 2, -9],
  [KIND_SHUFFLER, -3, 10],
  [KIND_SHUFFLER, 9, 8],
  [KIND_SHUFFLER, -10, -8],
  [KIND_SHUFFLER, 1.5, -5],
  [KIND_SHUFFLER, -2, -7],
  [KIND_SHUFFLER, 3, -10],
  [KIND_BOLLARD, 6, 9],
  [KIND_BOLLARD, -7, 7],
  [KIND_BOLLARD, 0, -13],
];

/** Lay the field; light enemies get `hp` times a spread of 0.6..1.6 (a shuffler has 10). */
function layField(sim: Sim, hp: number, rising = false): void {
  FIELD.forEach(([kind, x, z], k) => {
    const i = rising ? placeRising(sim, kind, x, z) : place(sim, kind, x, z);
    if (kind === KIND_SHUFFLER) sim.world.horde.hp[i] = hp * (0.6 + ((k * 0.618034) % 1));
  });
}

interface Outcome {
  damage: number;
  kills: number;
  /** Sum of every enemy's x and z at the end, for the draft, which moves rather than hurts. */
  where: number;
}

function hold(id: number, level: number, pose: Pose, gear: number, seconds: number, hp = 30): Outcome {
  const sim = rig(id, level);
  layField(sim, hp);
  let damage = 0;
  for (let t = 0; t < ticksIn(seconds); t++) {
    const before = totalHp(sim.world);
    poseTick(sim, pose, gear, t);
    damage += before - totalHp(sim.world);
  }
  const h = sim.world.horde;
  let where = 0;
  for (let i = 0; i < h.count; i++) where += h.x[i] * 3 + h.z[i];
  return { damage, kills: sim.world.player.kills, where };
}

const POSES: { pose: Pose; gear: number; says: string }[] = [
  { pose: 'stand', gear: 5, says: 'standing in gear 5' },
  { pose: 'ride', gear: 1, says: 'riding (tucking, carving, hopping, landing) in gear 1' },
  { pose: 'ride', gear: 3, says: 'riding in gear 3' },
  { pose: 'launch', gear: 5, says: 'launched at 30 m/s in gear 5' },
];

describe('the same field takes the same damage however the mover moves', () => {
  for (const id of ALL) {
    it(`${name(id)}: standing in gear 1 is the same as riding, flying and any gear`, () => {
      const still = hold(id, 3, 'stand', 1, 12);
      expect(still.damage).toBeGreaterThan(0);
      for (const p of POSES) {
        const moving = hold(id, 3, p.pose, p.gear, 12);
        expect(moving.kills, p.says).toBe(still.kills);
        expect(moving.damage, p.says).toBeCloseTo(still.damage, 3);
        expect(moving.where, p.says).toBeCloseTo(still.where, 3);
      }
    });
  }
});

describe('level 5 beats level 1', () => {
  for (const id of DAMAGING) {
    it(`${name(id)}: more damage to the same field`, () => {
      const one = hold(id, 1, 'stand', 1, 20, 1e4);
      const five = hold(id, 5, 'stand', 1, 20, 1e4);
      expect(one.damage).toBeGreaterThan(0);
      expect(five.damage).toBeGreaterThan(one.damage * 1.3);
    });
  }

  it('Slipstream: drags the same field further', () => {
    const sim0 = rig(W_SLIPSTREAM, 1);
    layField(sim0, 1e4);
    const start = sim0.world.horde.x.slice(0, sim0.world.horde.count);
    const drift = (level: number): number => {
      const sim = rig(W_SLIPSTREAM, level);
      layField(sim, 1e4);
      holdPose(sim, 'stand', 1, ticksIn(1));
      let d = 0;
      for (let i = 0; i < sim.world.horde.count; i++) d += Math.abs(sim.world.horde.x[i] - start[i]);
      return d;
    };
    expect(drift(1)).toBeGreaterThan(0);
    expect(drift(5)).toBeGreaterThan(drift(1) * 1.3);
  });
});

describe('enemies still rising are left alone', () => {
  for (const id of ALL) {
    it(`${name(id)}: 10 s among a field that never finishes rising touches none of it`, () => {
      const sim = rig(id, 5);
      layField(sim, 30, true);
      const h = sim.world.horde;
      const n = h.count;
      const hp = h.hp.slice(0, n);
      const x = h.x.slice(0, n);
      const z = h.z.slice(0, n);
      for (let t = 0; t < ticksIn(10); t++) {
        for (let i = 0; i < h.count; i++) h.age[i] = 0;
        poseTick(sim, t % 300 < 150 ? 'stand' : 'ride', 3, t);
      }
      expect(h.count).toBe(n);
      for (let i = 0; i < n; i++) {
        expect(h.hp[i]).toBe(hp[i]);
        expect(h.x[i]).toBe(x[i]);
        expect(h.z[i]).toBe(z[i]);
      }
      expect(sim.world.player.kills).toBe(0);
    });
  }
});

describe('the pools hold at the fastest rate there is', () => {
  /** Level 5, the most Haste, a packed crowd that never dies, and the shared pools all but full. */
  function flood(id: number, fill: (w: World) => void): Sim {
    const sim = rig(id, 5);
    haste(sim, 5);
    // Those that throw things get the crowd a little way off, so their shots are in the air a while.
    const inner = id === W_SEEKERS || id === W_SKIPPER ? 8 : 1.5;
    for (let k = 0; k < 300; k++) {
      const a = k * 2.399;
      const r = inner + Math.sqrt(k) * 0.7;
      place(sim, k % 9 === 0 ? KIND_BOLLARD : KIND_SHUFFLER, Math.sin(a) * r, Math.cos(a) * r);
    }
    fill(sim.world);
    return sim;
  }

  /** Shots of a kind the weapon under test does not fly, so they stay put and keep the pool full. */
  function fillShots(w: World, kind: number, leave: number): void {
    const sh = w.shots;
    while (sh.count < MAX_SHOTS - leave) {
      const i = sh.count++;
      sh.x[i] = 500;
      sh.z[i] = 500;
      sh.kind[i] = kind;
      sh.life[i] = 1000;
    }
  }

  for (const id of ALL) {
    it(`${name(id)}: shots, zones and effects stay within their pools`, () => {
      const sim = flood(id, (w) => {
        if (id === W_SEEKERS) fillShots(w, SHOT_STONE, 2);
        if (id === W_SKIPPER) fillShots(w, SHOT_DART, 2);
        if (id === W_CRUMBS) {
          while (w.zones.count < MAX_ZONES - 4) addZone(w, ZONE_TAR, 500, 0, 500, 1, 60000, 0);
        }
      });
      let peakShots = 0;
      for (let t = 0; t < ticksIn(20); t++) {
        const h = sim.world.horde;
        for (let i = 0; i < h.count; i++) h.hp[i] = 1e9;
        poseTick(sim, t % 600 < 300 ? 'stand' : 'ride', 5, t);
        expect(sim.world.shots.count).toBeLessThanOrEqual(MAX_SHOTS);
        expect(sim.world.zones.count).toBeLessThanOrEqual(MAX_ZONES);
        expect(sim.world.fx.count).toBeLessThanOrEqual(MAX_FX);
        peakShots = Math.max(peakShots, sim.world.shots.count);
        let mines = 0;
        for (let i = 0; i < sim.world.zones.count; i++) if (sim.world.zones.kind[i] === ZONE_MINE) mines++;
        expect(mines).toBeLessThanOrEqual(CRUMBS.maxMines);
      }
      // Those that throw things did fill the pool up to the top, and no further.
      if (id === W_SEEKERS || id === W_SKIPPER) expect(peakShots).toBe(MAX_SHOTS);
    });
  }
});

// ---- the source ---------------------------------------------------------------------------

const SOURCES = {
  ...import.meta.glob<string>('../../../src/sim/weapons/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../../../src/sim/seekers.ts', { query: '?raw', import: 'default', eager: true }),
};

/** Reads that tie a weapon to how the mover moves. */
const FORBIDDEN: { what: string; re: RegExp }[] = [
  { what: 'hop events', re: /\bEV_(CLEAN_)?HOP\b/ },
  { what: 'landing events', re: /\bEV_LAND\b/ },
  { what: "the mover's events", re: /\bs\.events\b/ },
  { what: 'the tuck', re: /\.tucked\b/ },
  { what: 'speed', re: /\.speed\b/ },
  { what: 'the last flight', re: /\blastAir\b|\bairTicks\b/ },
  { what: 'the landing impact', re: /\bimpact\b|\blandSpeed\b/ },
  { what: "the mover's velocity (distance travelled)", re: /\b(m|mover)\.v[xyz]\b/ },
  { what: 'grounded or not', re: /\.grounded\b/ },
];

/** The source without its comments, so words in prose do not count. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the source', () => {
  it('finds every weapon file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(10);
  });

  it('no weapon reads how the mover moves: not hops, landings, tucks, speed, flights or distance', () => {
    const found: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      const lines = code(src).split('\n');
      lines.forEach((line, n) => {
        for (const f of FORBIDDEN) if (f.re.test(line)) found.push(`${file}:${n + 1} reads ${f.what}: ${line.trim()}`);
        // The gear only as what powerOf is given (which ignores it).
        const gears = line.match(/\.gear\b/g)?.length ?? 0;
        const passed = line.match(/powerOf\([^()]*\.gear\)/g)?.length ?? 0;
        if (gears > passed) found.push(`${file}:${n + 1} reads the gear: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
