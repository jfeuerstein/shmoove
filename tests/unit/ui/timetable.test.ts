import { describe, expect, it } from 'vitest';
import { DAY_TICKS } from '../../../src/sim/constants';
import { compileLine, makeVehicleState, ticksToArrival, vehicleAt } from '../../../src/sim/lines';
import { buildSlice } from '../../../src/sim/slice';
import { District } from '../../../src/sim/world';
import {
  arrivalTicks,
  boardRows,
  followingStop,
  inService,
  nearbyStops,
  nextStopOf,
  stopIndexAt,
  stopPositions,
  type NextStop,
} from '../../../src/ui/timetable';

const world = buildSlice(1);
const vs = makeVehicleState();

function shuttleLine() {
  return compileLine(
    {
      id: 'SH',
      name: 'Shuttle',
      kind: 'funicular',
      district: District.DOCKS,
      stem: 0,
      path: [0, 0, 0, 0, 0, 100],
      loop: false,
      stops: [{ s: 50, name: 'Mid' }],
      cruise: 8,
      accel: 3,
      dwell: 2,
      vehicles: 1,
      windows: [[0.25, 0.75]],
      overhead: false,
      anchorBack: 4,
      anchorY: 1,
      hang: 0,
      rope: 3,
      bodyHalfLen: 3,
      bodyHalfWid: 1,
      bodyHeight: 3,
      livery: { base: 0, stripe: 0, accent: 0, pattern: 0 },
    },
    0,
  );
}

describe('next stop of a hitched vehicle', () => {
  it('agrees with vehicleAt: ridden forward that many ticks, the vehicle stands at that stop', () => {
    const out: NextStop = { stop: -1, ticks: 0 };
    for (const line of world.lines) {
      for (let v = 0; v < line.vehicles; v++) {
        for (let t = 0; t < DAY_TICKS; t += 487) {
          expect(nextStopOf(line, v, t, out)).toBe(true);
          vehicleAt(line, v, t + out.ticks, vs);
          const stopS = line.allStops[out.stop].s;
          const atS = Math.abs(vs.s - stopS) < 1e-3 || (out.stop === 0 && Math.abs(vs.s - line.length) < 1e-3);
          expect(atS).toBe(true);
          expect(vs.vx === 0 && vs.vz === 0).toBe(true);
          // And it is not standing there any earlier on the way.
          vehicleAt(line, v, t + out.ticks - 1, vs);
          expect(vs.vx !== 0 || vs.vz !== 0).toBe(true);
        }
      }
    }
  });

  it('while dwelling at a stop, the next stop is the following one', () => {
    const tram = world.lines[0];
    const out: NextStop = { stop: -1, ticks: 0 };
    let checked = 0;
    for (let t = 0; t < tram.period && checked < 3; t++) {
      vehicleAt(tram, 0, t, vs);
      const at = stopIndexAt(tram, vs.s);
      if (at < 0 || vs.vx !== 0 || vs.vz !== 0) continue;
      vehicleAt(tram, 0, t - 1, vs);
      if (vs.vx === 0 && vs.vz === 0) continue; // only the first tick of each dwell
      nextStopOf(tram, 0, t, out);
      expect(out.stop).toBe((at + 1) % tram.allStops.length);
      checked++;
    }
    expect(checked).toBe(3);
  });

  it('works on a shuttle in both directions', () => {
    const sh = shuttleLine();
    const out: NextStop = { stop: -1, ticks: 0 };
    const t0 = Math.round(0.3 * DAY_TICKS);
    const seen = new Set<number>();
    for (let t = t0; t < t0 + sh.period; t += 13) {
      nextStopOf(sh, 0, t, out);
      seen.add(out.stop);
      vehicleAt(sh, 0, t + out.ticks, vs);
      expect(vs.s).toBeCloseTo(sh.allStops[out.stop].s, 3);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});

describe('stop board rows', () => {
  it('lists the lines at a stop soonest first with the stop each arrival heads for', () => {
    const tram = world.lines[0];
    const stops = stopPositions(world.lines);
    // Escalera on the up lane.
    const esc = stops.find((s) => s.line === 0 && s.stop === 1);
    expect(esc).toBeDefined();
    if (!esc) return;
    const near = nearbyStops(stops, esc.x + 3, esc.z, 14, () => true);
    expect(near[0].line).toBe(0);
    expect(near[0].stop).toBe(1);
    // Both Escalera stops (up and down lanes, 8 m apart) are in reach; nothing else.
    expect(near.map((n) => n.stop).sort()).toEqual([1, 3]);
    const t = Math.round(0.4 * DAY_TICKS);
    const rows = boardRows(world.lines, near, t);
    expect(rows.length).toBe(2);
    expect(rows[0].ticks).toBeLessThanOrEqual(rows[1].ticks);
    for (const r of rows) {
      expect(r.service).toBe(true);
      expect(r.ticks).toBe(arrivalTicks(tram, r.stop, t));
      expect(r.ticks).toBe(ticksToArrival(tram, r.stop, t));
      expect(r.next).toBe((r.stop + 1) % tram.allStops.length);
    }
    expect(nearbyStops(stops, esc.x, esc.z, 14, (li) => li !== 0)).toEqual([]);
  });

  it('counts a vehicle waiting out its lap at a loop terminus as standing there', () => {
    for (const line of world.lines) {
      let shorter = 0;
      for (let t = 0; t < DAY_TICKS; t += 211) {
        for (let stop = 1; stop < line.allStops.length; stop++) {
          expect(arrivalTicks(line, stop, t)).toBe(ticksToArrival(line, stop, t));
        }
        const k = arrivalTicks(line, 0, t);
        const plain = ticksToArrival(line, 0, t);
        expect(k).toBeLessThanOrEqual(plain);
        if (k < plain) shorter++;
        let standing = false;
        for (let v = 0; v < line.vehicles; v++) {
          vehicleAt(line, v, t + k, vs);
          const there = vs.s < 1e-3 || Math.abs(vs.s - line.length) < 1e-3;
          if (vs.active && there && vs.vx === 0 && vs.vz === 0) standing = true;
        }
        expect(standing).toBe(true);
      }
      expect(shorter).toBeGreaterThan(0);
    }
  });

  it('caps at four rows and puts lines out of service last', () => {
    const sh = shuttleLine();
    const night = Math.round(0.9 * DAY_TICKS);
    expect(inService(sh, night)).toBe(false);
    expect(inService(sh, Math.round(0.5 * DAY_TICKS))).toBe(true);
    const lines = [sh];
    const near = [0, 1, 2, 1, 0].map((stop) => ({ line: 0, stop, x: 0, z: 0 }));
    const rows = boardRows(lines, near, night);
    expect(rows.length).toBe(4);
    for (const r of rows) expect(r.service).toBe(false);
    const day = Math.round(0.5 * DAY_TICKS);
    const dayRows = boardRows(lines, near, day);
    for (let i = 1; i < dayRows.length; i++) expect(dayRows[i].ticks).toBeGreaterThanOrEqual(dayRows[i - 1].ticks);
  });

  it('a shuttle arrival at a middle stop heads on in its direction of travel', () => {
    const sh = shuttleLine();
    const t = Math.round(0.3 * DAY_TICKS);
    const ticks = ticksToArrival(sh, 1, t);
    expect(Number.isFinite(ticks)).toBe(true);
    const next = followingStop(sh, 1, t, ticks);
    // Find what the vehicle does after that dwell.
    let k = ticks;
    vehicleAt(sh, 0, t + k, vs);
    while (vs.vx === 0 && vs.vz === 0) vehicleAt(sh, 0, t + ++k, vs);
    expect(next).toBe(vs.dir > 0 ? 2 : 0);
    expect(followingStop(sh, 0, t, 0)).toBe(1);
    expect(followingStop(sh, 2, t, 0)).toBe(1);
  });
});
