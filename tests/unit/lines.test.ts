import { describe, expect, it } from 'vitest';
import { DAY_TICKS, DT } from '../../src/sim/constants';
import {
  compileLine,
  dayFrac,
  grabPoint,
  inWindows,
  makeVehicleState,
  nearestArc,
  padPeriod,
  smoothPath,
  ticksToArrival,
  vehicleAt,
  type LineDef,
} from '../../src/sim/lines';
import { District } from '../../src/sim/world';

function line(over: Partial<LineDef> = {}): LineDef {
  return {
    id: 'X1',
    name: 'Test',
    kind: 'tram',
    district: District.DOCKS,
    stem: 0,
    path: [0, 0, 0, 0, 0, 100, 0, 10, 200],
    loop: false,
    stops: [{ s: 100, name: 'Mid' }],
    cruise: 8,
    accel: 2,
    dwell: 2,
    vehicles: 2,
    windows: [[0, 1]],
    overhead: false,
    anchorBack: 4,
    anchorY: 1,
    hang: 0,
    rope: 3,
    bodyHalfLen: 4,
    bodyHalfWid: 1.2,
    bodyHeight: 3,
    livery: { base: 0, stripe: 0, accent: 0, pattern: 0 },
    ...over,
  };
}

const LOOP_PATH = [0, 0, 0, 60, 0, 0, 60, 0, 60, 0, 0, 60, 0, 0, 0];

describe('line compilation', () => {
  it('pads every lap to a period that divides the day', () => {
    for (const cruise of [3, 7, 11, 16]) {
      const l = compileLine(line({ cruise }), 0);
      expect(DAY_TICKS % l.period).toBe(0);
      expect(l.period).toBeGreaterThanOrEqual(l.runTicks);
      expect(padPeriod(l.runTicks)).toBe(l.period);
    }
  });

  it('implies termini and keeps stops in order', () => {
    const l = compileLine(line(), 0);
    expect(l.allStops.map((s) => Math.round(s.s))).toEqual([0, 100, Math.round(l.length)]);
    const loop = compileLine(line({ path: LOOP_PATH, loop: true, stops: [{ s: 120, name: 'Far' }] }), 0);
    expect(loop.allStops.map((s) => Math.round(s.s))).toEqual([0, 120]);
  });

  it('rejects a loop that does not close and a stop off the path', () => {
    expect(() => compileLine(line({ loop: true }), 0)).toThrow(/loop/);
    expect(() => compileLine(line({ stops: [{ s: 999, name: 'Nowhere' }] }), 0)).toThrow(/off the path/);
  });

  it('never exceeds cruise speed, never teleports, and stops at every stop', () => {
    const l = compileLine(line(), 0);
    const v = makeVehicleState();
    let maxStep = 0;
    const dwelledAt = new Set<number>();
    let px = NaN;
    let py = NaN;
    let pz = NaN;
    for (let t = 0; t <= l.period * 2; t++) {
      vehicleAt(l, 0, t, v);
      if (!Number.isNaN(px)) maxStep = Math.max(maxStep, Math.hypot(v.x - px, v.y - py, v.z - pz));
      px = v.x;
      py = v.y;
      pz = v.z;
      if (v.vx === 0 && v.vy === 0 && v.vz === 0) dwelledAt.add(Math.round(v.s));
    }
    expect(maxStep).toBeLessThanOrEqual(l.cruise * DT * 1.001);
    expect([...dwelledAt].sort((a, b) => a - b)).toEqual([0, 100, Math.round(l.length)]);
  });

  it('a shuttle comes back the way it went, facing the way it travels', () => {
    const l = compileLine(line(), 0);
    const v = makeVehicleState();
    let sawOut = false;
    let sawBack = false;
    for (let t = 0; t < l.period; t++) {
      vehicleAt(l, 0, t, v);
      if (v.vz > 1) {
        sawOut = true;
        expect(v.hz).toBeGreaterThan(0.9);
        expect(v.dir).toBe(1);
      }
      if (v.vz < -1) {
        sawBack = true;
        expect(v.hz).toBeLessThan(-0.9);
        expect(v.dir).toBe(-1);
      }
    }
    expect(sawOut && sawBack).toBe(true);
    vehicleAt(l, 0, l.period, v);
    expect(v.s).toBeCloseTo(0, 5);
  });

  it('a loop ends each lap exactly where the next begins', () => {
    const l = compileLine(line({ path: LOOP_PATH, loop: true, stops: [] }), 0);
    const a = makeVehicleState();
    const b = makeVehicleState();
    vehicleAt(l, 0, l.period - 1, a);
    vehicleAt(l, 0, l.period, b);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(l.cruise * DT * 1.001);
  });

  it('spreads vehicles evenly round the lap and honours the phase', () => {
    const l = compileLine(line({ vehicles: 4 }), 0);
    const a = makeVehicleState();
    const b = makeVehicleState();
    vehicleAt(l, 0, 1000 + l.period / 4, a);
    vehicleAt(l, 1, 1000, b);
    expect(a.s).toBe(b.s);
    const shifted = compileLine(line({ vehicles: 4, phase: 300 }), 0);
    vehicleAt(l, 0, 1300, a);
    vehicleAt(shifted, 0, 1000, b);
    expect(a.s).toBe(b.s);
  });

  it('is the same every day', () => {
    const l = compileLine(line(), 0);
    const a = makeVehicleState();
    const b = makeVehicleState();
    for (const t of [0, 777, 12345, 40000]) {
      vehicleAt(l, 1, t, a);
      vehicleAt(l, 1, t + DAY_TICKS * 3, b);
      expect(b).toEqual(a);
    }
  });
});

describe('service hours', () => {
  it('window test handles plain and wrap-around windows', () => {
    expect(inWindows([[0.3, 0.7]], 0.5)).toBe(true);
    expect(inWindows([[0.3, 0.7]], 0.7)).toBe(false);
    expect(inWindows([[0.8, 0.2]], 0.9)).toBe(true);
    expect(inWindows([[0.8, 0.2]], 0.1)).toBe(true);
    expect(inWindows([[0.8, 0.2]], 0.5)).toBe(false);
    expect(dayFrac(DAY_TICKS * 2 + DAY_TICKS / 4)).toBeCloseTo(0.25, 12);
  });

  it('a vehicle is in service exactly for laps that leave the terminus in service hours', () => {
    const l = compileLine(line({ windows: [[0.25, 0.5]], vehicles: 1 }), 0);
    const v = makeVehicleState();
    let activeTicks = 0;
    for (let t = 0; t < DAY_TICKS; t++) {
      vehicleAt(l, 0, t, v);
      const lapStart = t - v.lapTick;
      const shouldRun = lapStart / DAY_TICKS >= 0.25 && lapStart / DAY_TICKS < 0.5;
      expect(v.active).toBe(shouldRun);
      if (v.active) activeTicks++;
    }
    expect(activeTicks).toBeGreaterThan(0);
    expect(activeTicks % l.period).toBe(0);
  });

  it('parkHidden vehicles vanish while waiting at the terminus', () => {
    const l = compileLine(line({ parkHidden: true, vehicles: 1, cruise: 9 }), 0);
    expect(l.period).toBeGreaterThan(l.runTicks);
    const v = makeVehicleState();
    vehicleAt(l, 0, l.runTicks - 1, v);
    expect(v.active).toBe(true);
    vehicleAt(l, 0, l.runTicks, v);
    expect(v.active).toBe(false);
  });

  it('ticksToArrival agrees with where the vehicle actually is', () => {
    const l = compileLine(line({ vehicles: 2 }), 0);
    const v = makeVehicleState();
    for (const now of [0, 500, 3333]) {
      const eta = ticksToArrival(l, 1, now);
      expect(Number.isFinite(eta)).toBe(true);
      let there = false;
      for (let i = 0; i < l.vehicles; i++) {
        vehicleAt(l, i, now + eta, v);
        if (Math.abs(v.s - 100) < 0.05 && v.vz === 0) there = true;
      }
      expect(there).toBe(true);
    }
  });
});

describe('path helpers', () => {
  it('the grab point trails the vehicle by anchorBack and hangs by the strap', () => {
    const l = compileLine(line({ overhead: true, anchorY: 9, hang: 4, anchorBack: 2 }), 0);
    const v = makeVehicleState();
    vehicleAt(l, 0, l.period / 4, v);
    const g = { x: 0, y: 0, z: 0 };
    grabPoint(l, v, g);
    expect(g.y).toBeCloseTo(v.y + 5, 6);
    expect(Math.hypot(g.x - v.x, g.z - v.z)).toBeCloseTo(2, 6);
    expect((v.x - g.x) * v.hx + (v.z - g.z) * v.hz).toBeCloseTo(2, 6);
  });

  it('smoothPath passes through its control points and closes loops', () => {
    const ctrl = [0, 0, 0, 30, 0, 0, 30, 0, 30, 0, 0, 30];
    const p = smoothPath(ctrl, 2, true);
    expect(p.slice(-3)).toEqual(p.slice(0, 3));
    for (let i = 0; i < 4; i++) {
      const s = nearestArc(p, ctrl[i * 3], ctrl[i * 3 + 2]);
      expect(Number.isFinite(s)).toBe(true);
    }
    let maxGap = 0;
    for (let i = 3; i < p.length; i += 3) maxGap = Math.max(maxGap, Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]));
    expect(maxGap).toBeLessThan(3.5);
    const open = smoothPath(ctrl, 2, false);
    expect(open.slice(0, 3)).toEqual([0, 0, 0]);
    expect(open.slice(-3)).toEqual([0, 0, 30]);
  });
});
