/**
 * The vehicleAt memo (performance pass): every answer, fresh or repeated, is exactly what the
 * unmemoised computation gives, across lines, vehicles and ticks including the day wrap.
 */
import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/sim/city/index';
import { DAY_TICKS } from '../../src/sim/constants';
import { computeVehicle, makeVehicleState, vehicleAt, type VehicleState } from '../../src/sim/lines';

function same(a: VehicleState, b: VehicleState): void {
  expect(a.active).toBe(b.active);
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'hx', 'hz', 's', 'dir', 'lapTick'] as const) {
    expect(Object.is(a[k], b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBe(true);
  }
}

describe('vehicleAt memo', () => {
  const lines = buildCity(1).world.lines;

  it('answers 10 000 random (line, vehicle, tick) lookups, repeats included, exactly as computed', () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const got = makeVehicleState();
    const want = makeVehicleState();
    let prevTick = 0;
    for (let n = 0; n < 10_000; n++) {
      const L = lines[Math.floor(rand() * lines.length)];
      const vi = Math.floor(rand() * L.vehicles);
      // Half the lookups repeat the previous tick (the memo's hit path); the rest span several days,
      // negative ticks and the wrap at midnight.
      const r = rand();
      const tick =
        r < 0.5 ? prevTick : r < 0.7 ? DAY_TICKS * Math.floor(rand() * 4) - 3 + Math.floor(rand() * 6) : Math.floor((rand() - 0.2) * 5 * DAY_TICKS);
      prevTick = tick;
      vehicleAt(L, vi, tick, got);
      computeVehicle(L, vi, tick, want);
      same(got, want);
    }
  });

  it('a copy of a line with other tables does not answer from the original line memo', () => {
    const L = lines.find((l) => l.vehicles > 1 && l.windows.length > 0);
    if (L === undefined) throw new Error('no multi-vehicle line');
    const v = makeVehicleState();
    vehicleAt(L, 0, 1000, v);
    const shifted = { ...L, phaseTicks: (L.phaseTicks + 600) % L.period };
    const got = makeVehicleState();
    const want = makeVehicleState();
    vehicleAt(shifted, 0, 1000, got);
    computeVehicle(shifted, 0, 1000, want);
    same(got, want);
  });
});
