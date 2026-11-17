import { describe, expect, it } from 'vitest';
import { resetFeel } from '../../src/sim/constants';
import { Game, type GameEvent } from '../../src/sim/game/game';
import {
  INK_SLACK,
  createProgress,
  exportProgress,
  importProgress,
  inkedCount,
  lineSegments,
  mapFraction,
} from '../../src/sim/game/progress';
import { makeVehicleState, vehicleAt, type VehicleState } from '../../src/sim/lines';
import { datan2 } from '../../src/sim/math';
import { Mode } from '../../src/sim/types';
import type { World } from '../../src/sim/world';
import { flatWorld, seekWhen, slice, teleport, testLine } from './helpers';

const TRAM = 0;
const FUNI = 1;
const vs = makeVehicleState();

function newGame(world: World = slice()): Game {
  resetFeel();
  return new Game(world, { seed: 1, startDayFrac: 0.3 });
}

/** Step `ticks` times with hold `hold(i)`; returns every game event, or stops early on `until`. */
function play(g: Game, ticks: number, hold: (i: number) => boolean = () => true, until?: (g: Game) => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    g.step({ steer: 0, hold: hold(i), hop: false });
    for (const e of g.events) out.push(e);
    if (until?.(g)) break;
  }
  return out;
}

const stillAt = (s: number) => (v: VehicleState) =>
  v.active && Math.abs(v.s - s) < 1e-3 && v.vx === 0 && v.vz === 0;

/** Stand `behind` metres behind the vehicle's origin, facing its way (just behind the bumper). */
function standBehind(g: Game, li: number, veh: number, behind = 6): void {
  vehicleAt(g.sim.world.lines[li], veh, g.sim.tick, vs);
  teleport(g.sim, vs.x - vs.hx * behind, vs.z - vs.hz * behind, datan2(vs.hx, vs.hz));
}

/** Set the clock to the first tick vehicle `veh` stands at stop `stop`, and stand behind it. */
function atStop(g: Game, li: number, veh: number, stop: number): void {
  const L = g.sim.world.lines[li];
  seekWhen(g.sim, li, veh, stillAt(L.allStops[stop].s));
  standBehind(g, li, veh);
}

/** Set the clock to the first tick vehicle `veh` is `ahead` metres past stop `stop`, moving. */
function pastStop(g: Game, li: number, veh: number, stop: number, ahead: number): void {
  const L = g.sim.world.lines[li];
  const s = L.allStops[stop].s + ahead;
  seekWhen(g.sim, li, veh, (v) => v.active && v.s >= s && v.s < s + 1 && v.dir > 0);
  standBehind(g, li, veh);
}

/** Hitched to that vehicle right now. */
function hitched(g: Game, li: number, veh: number): boolean {
  return g.sim.player.mode === Mode.HITCH && g.sim.player.hLine === li && g.sim.player.hVeh === veh;
}

function vehicleStillAt(g: Game, li: number, veh: number, stop: number): boolean {
  const L = g.sim.world.lines[li];
  vehicleAt(L, veh, g.sim.tick, vs);
  return stillAt(L.allStops[stop].s)(vs);
}

const inkedSegs = (ev: GameEvent[], line: number) =>
  ev.filter((e): e is Extract<GameEvent, { type: 'segmentInked' }> => e.type === 'segmentInked' && e.line === line).map((e) => e.segment);
const count = (ev: GameEvent[], type: GameEvent['type']) => ev.filter((e) => e.type === type).length;

describe('line segments', () => {
  it('a loop has one segment per stop, the last back to the terminus; a shuttle one per gap', () => {
    const tram = slice().lines[TRAM];
    const segs = lineSegments(tram);
    expect(segs.length).toBe(tram.allStops.length);
    expect(segs[0].s0).toBe(0);
    expect(segs[segs.length - 1].s1).toBeCloseTo(tram.length, 6);
    expect(segs[segs.length - 1].to).toBe(0);
    const w = flatWorld([testLine({ loop: false, path: [0, 0, -80, 0, 0, 80], stops: [{ s: 80, name: 'B' }] })]);
    expect(lineSegments(w.lines[0]).map((s) => [s.from, s.to])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

describe('inking on the slice tram', () => {
  it('riding from a stop to the next inks exactly that segment, once', () => {
    const g = newGame();
    atStop(g, TRAM, 0, 1);
    const ev = play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 2));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(ev, TRAM)).toEqual([1]);
    expect(g.progress.lines[TRAM].inked).toEqual([false, true, false, false]);
    // Dwelling at the stop afterwards does not ink anything else.
    expect(inkedSegs(play(g, 120), TRAM)).toEqual([]);
  });

  it('a catch just after the tram pulls away still inks the segment', () => {
    const g = newGame();
    pastStop(g, TRAM, 0, 1, INK_SLACK * 0.5);
    const ev = play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 2));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(ev, TRAM)).toEqual([1]);
  });

  it('a catch mid-segment does not ink it, but riding on through the next stop inks the next', () => {
    const g = newGame();
    pastStop(g, TRAM, 0, 1, 40);
    const first = play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 2));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(first, TRAM)).toEqual([]);
    const second = play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 3));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(second, TRAM)).toEqual([2]);
    expect(g.progress.lines[TRAM].inked).toEqual([false, false, true, false]);
  });

  it('letting go before the stop and catching again does not ink: coverage is one unbroken hitch', () => {
    const g = newGame();
    atStop(g, TRAM, 0, 1);
    const L = g.sim.world.lines[TRAM];
    const mid = (L.allStops[1].s + L.allStops[2].s) / 2;
    // Ride half way, let go.
    const ev = play(g, 4000, () => true, (q) => {
      vehicleAt(L, 0, q.sim.tick, vs);
      return vs.s > mid;
    });
    ev.push(...play(g, 60, () => false));
    expect(g.sim.player.mode).not.toBe(Mode.HITCH);
    // Catch the same tram again from just behind it and ride to the stop.
    standBehind(g, TRAM, 0);
    ev.push(...play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 2)));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(ev, TRAM)).toEqual([]);
    // The second hitch counts from where it began: the following segment inks.
    expect(inkedSegs(play(g, 4000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 3)), TRAM)).toEqual([2]);
  });

  it('a hitch across the terminus inks the last segment and then the first', () => {
    const g = newGame();
    atStop(g, TRAM, 0, 3);
    const ev = play(g, 6000, () => true, (q) => vehicleStillAt(q, TRAM, 0, 1));
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(ev, TRAM)).toEqual([3, 0]);
  });

  it('a full lap completes the line once; both slice lines complete the map once', () => {
    const g = newGame();
    atStop(g, TRAM, 0, 0);
    const L = g.sim.world.lines[TRAM];
    const lap = play(g, L.period + 60);
    expect(hitched(g, TRAM, 0)).toBe(true);
    expect(inkedSegs(lap, TRAM).sort()).toEqual([0, 1, 2, 3]);
    expect(count(lap, 'lineComplete')).toBe(1);
    expect(count(lap, 'mapComplete')).toBe(0);
    expect(g.progress.lines[TRAM].complete).toBe(true);
    expect(mapFraction(g.progress, g.sim.world.lines)).toBeCloseTo(4 / 6, 9);

    // Another lap of the tram changes nothing.
    const again = play(g, L.period);
    expect(again).toEqual([]);

    // Now the funicular.
    play(g, 60, () => false);
    atStop(g, FUNI, 0, 0);
    const F = g.sim.world.lines[FUNI];
    const funi = play(g, F.period + 60);
    expect(hitched(g, FUNI, 0)).toBe(true);
    expect(inkedSegs(funi, FUNI).sort()).toEqual([0, 1]);
    expect(count(funi, 'lineComplete')).toBe(1);
    expect(count(funi, 'mapComplete')).toBe(1);
    expect(funi[funi.length - 1].type).toBe('mapComplete');
    expect(g.progress.mapComplete).toBe(true);
    expect(mapFraction(g.progress, g.sim.world.lines)).toBe(1);
    expect(count(play(g, F.period), 'mapComplete')).toBe(0);
  });
});

describe('inking on other kinds of line', () => {
  const shuttle = (): World =>
    flatWorld([
      testLine({
        id: 'SH',
        loop: false,
        path: [0, 0, -80, 0, 0, 80],
        stops: [{ s: 80, name: 'B' }],
        cruise: 6,
      }),
    ]);

  it('a shuttle inks a segment riding it outward', () => {
    const g = newGame(shuttle());
    atStop(g, 0, 0, 0);
    const ev = play(g, 3000, () => true, (q) => vehicleStillAt(q, 0, 0, 1));
    expect(hitched(g, 0, 0)).toBe(true);
    expect(inkedSegs(ev, 0)).toEqual([0]);
  });

  it('a shuttle inks a segment riding it back the other way', () => {
    const g = newGame(shuttle());
    const L = g.sim.world.lines[0];
    // Just after the vehicle turns at the far end and heads back.
    seekWhen(g.sim, 0, 0, (v) => v.active && v.dir < 0 && v.s < L.length - 1 && v.s > L.length - 4);
    standBehind(g, 0, 0);
    const ev = play(g, 3000, () => true, (q) => vehicleStillAt(q, 0, 0, 1));
    expect(hitched(g, 0, 0)).toBe(true);
    expect(inkedSegs(ev, 0)).toEqual([1]);
    expect(g.progress.lines[0].inked).toEqual([false, true]);
    // Staying on back to the start inks the other segment and completes the line.
    const rest = play(g, 3000, () => true, (q) => vehicleStillAt(q, 0, 0, 0));
    expect(inkedSegs(rest, 0)).toEqual([0]);
    expect(count(rest, 'lineComplete')).toBe(1);
    expect(count(rest, 'mapComplete')).toBe(1);
  });

  it('a secret line is hidden until first ridden, and never counts toward the map', () => {
    const square = (r: number) => [r, 0, -r, r, 0, r, -r, 0, r, -r, 0, -r, r, 0, -r];
    const w = flatWorld([
      testLine({ id: 'R1', path: square(30), stops: [{ s: 120, name: 'Half' }], cruise: 6 }),
      testLine({ id: 'S9', path: square(60), stops: [{ s: 240, name: 'Far' }], cruise: 6, secret: true }),
    ]);
    const g = newGame(w);
    expect(g.progress.lines.map((l) => l.discovered)).toEqual([true, false]);

    atStop(g, 1, 0, 0);
    const ev = play(g, g.sim.world.lines[1].period + 60);
    expect(hitched(g, 1, 0)).toBe(true);
    expect(count(ev, 'lineDiscovered')).toBe(1);
    expect(ev[0]).toEqual({ type: 'lineDiscovered', line: 1 });
    expect(g.progress.lines[1].discovered).toBe(true);
    expect(g.progress.lines[1].complete).toBe(true);
    expect(count(ev, 'mapComplete')).toBe(0);
    expect(mapFraction(g.progress, w.lines)).toBe(0);

    // Hitching it again is not a new discovery.
    play(g, 60, () => false);
    atStop(g, 1, 0, 1);
    expect(count(play(g, 120), 'lineDiscovered')).toBe(0);

    // The regular line alone completes the map.
    play(g, 60, () => false);
    atStop(g, 0, 0, 0);
    const reg = play(g, g.sim.world.lines[0].period + 60);
    expect(count(reg, 'lineDiscovered')).toBe(0);
    expect(count(reg, 'lineComplete')).toBe(1);
    expect(count(reg, 'mapComplete')).toBe(1);
  });
});

describe('progress persistence', () => {
  it('round-trips through JSON', () => {
    const lines = slice().lines;
    const p = createProgress(lines);
    p.lines[TRAM].inked[1] = true;
    p.lines[TRAM].inked[3] = true;
    p.lines[FUNI].inked = [true, true];
    p.lines[FUNI].complete = true;
    const back = importProgress(lines, JSON.parse(JSON.stringify(exportProgress(p))));
    expect(back).toEqual(p);
    expect(inkedCount(back, TRAM)).toBe(2);
  });

  it('tolerates data that no longer matches the lines', () => {
    const lines = slice().lines;
    const fresh = createProgress(lines);
    expect(importProgress(lines, null)).toEqual(fresh);
    expect(importProgress(lines, 'garbage')).toEqual(fresh);
    expect(importProgress(lines, { v: 1, lines: 'nope' })).toEqual(fresh);

    const p = importProgress(lines, {
      v: 1,
      lines: [
        { id: 'T5', inked: [true, true, true, true, true, true], discovered: true }, // more segments than now
        { id: 'T1', inked: [true] }, // fewer segments than now
        { id: 'GONE', inked: [true, true] }, // a line that no longer exists
        { id: 7, inked: [true] },
        'junk',
      ],
    });
    expect(p.lines[TRAM].inked).toEqual([true, true, true, true]);
    expect(p.lines[TRAM].complete).toBe(true);
    expect(p.lines[FUNI].inked).toEqual([true, false]);
    expect(p.lines[FUNI].complete).toBe(false);
    expect(p.mapComplete).toBe(false);

    // Completion is recomputed from the ink, never trusted.
    const all = importProgress(lines, {
      v: 1,
      lines: [
        { id: 'T5', inked: [true, true, true, true] },
        { id: 'T1', inked: [true, true] },
      ],
    });
    expect(all.mapComplete).toBe(true);
  });

  it('a secret line with saved ink comes back discovered', () => {
    const square = [30, 0, -30, 30, 0, 30, -30, 0, 30, -30, 0, -30, 30, 0, -30];
    const w = flatWorld([testLine({ id: 'S9', path: square, secret: true })]);
    expect(importProgress(w.lines, { v: 1, lines: [{ id: 'S9', inked: [true] }] }).lines[0].discovered).toBe(true);
    expect(importProgress(w.lines, { v: 1, lines: [{ id: 'S9', inked: [false] }] }).lines[0].discovered).toBe(false);
  });
});

describe('determinism', () => {
  it('two games fed the same inputs end with equal progress and equal sim hashes', () => {
    const script = (i: number) => ({ steer: Math.sin(i / 41) * 0.6, hold: i % 900 < 700, hop: i % 333 === 0 });
    const a = newGame();
    const b = newGame();
    for (const g of [a, b]) {
      atStop(g, TRAM, 0, 2);
      for (let i = 0; i < 5000; i++) g.step(script(i));
    }
    expect(exportProgress(a.progress)).toEqual(exportProgress(b.progress));
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.sim.tick).toBe(b.sim.tick);
  });
});
