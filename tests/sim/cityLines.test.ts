import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { MEETINGS } from '../../src/sim/city/lines';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { grabPoint, inWindows, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../../src/sim/lines';
import { District, Surface, collideSolids, findZone, makeWallHit, terrainSurface, topHeight } from '../../src/sim/world';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const D = District;
const DAWN = 0.22;
const DAY = 0.3;
const DUSK = 0.72;
const NIGHT = 0.8;

/** DESIGN section 5, written out independently of the ride data. */
const ROSTER: {
  id: string;
  kind: string;
  district: number;
  stem: number;
  vehicles: number;
  hours: [number, number][];
  secret?: boolean;
  minChain?: number;
}[] = [
  { id: 'D1', kind: 'crane', district: D.DOCKS, stem: 0, vehicles: 1, hours: [[0, 1]] },
  { id: 'D2', kind: 'forklift', district: D.DOCKS, stem: 1, vehicles: 3, hours: [[DAY, DUSK]] },
  { id: 'D3', kind: 'truck', district: D.DOCKS, stem: 2, vehicles: 2, hours: [[DAWN, 0.5]] },
  { id: 'M1', kind: 'moped', district: D.MERCADO, stem: 0, vehicles: 4, hours: [[DAY, NIGHT]] },
  { id: 'M2', kind: 'handcart', district: D.MERCADO, stem: 1, vehicles: 3, hours: [[DAWN, 0.65]] },
  { id: 'M3', kind: 'parade', district: D.MERCADO, stem: 2, vehicles: 1, hours: [[0.55, 0.72]] },
  { id: 'T1', kind: 'funicular', district: D.TERRACES, stem: 0, vehicles: 2, hours: [[0, 1]] },
  { id: 'T2', kind: 'tram', district: D.TERRACES, stem: 1, vehicles: 3, hours: [[0, 1]] },
  { id: 'T3', kind: 'tram', district: D.TERRACES, stem: 2, vehicles: 2, hours: [[DAY, NIGHT]] },
  { id: 'T4', kind: 'bus', district: D.TERRACES, stem: 3, vehicles: 2, hours: [[NIGHT, DAWN]] },
  { id: 'A1', kind: 'cablecar', district: D.ANTENNA, stem: 0, vehicles: 4, hours: [[0, 1]] },
  { id: 'A2', kind: 'cablecar', district: D.ANTENNA, stem: 1, vehicles: 3, hours: [[DAY, NIGHT]] },
  { id: 'A3', kind: 'kite', district: D.ANTENNA, stem: 2, vehicles: 5, hours: [[0.35, 0.7]] },
  { id: 'S1', kind: 'ghosttram', district: D.TERRACES, stem: 3, vehicles: 1, hours: [[0, 0.06]], secret: true },
  { id: 'S2', kind: 'blimp', district: D.ANTENNA, stem: 3, vehicles: 1, hours: [[0.76, 0.77]], secret: true },
  { id: 'S3', kind: 'kite', district: D.ANTENNA, stem: 3, vehicles: 1, hours: [[0.35, 0.7]], secret: true, minChain: 4 },
];

const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };
const WH = makeWallHit();

function line(id: string): CompiledLine {
  const l = city.world.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

/** Day tick at which the lap vehicle i is on at `tick` left the terminus. */
function lapStart(l: CompiledLine, v: VehicleState, tick: number): number {
  return (((tick - v.lapTick) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

/** Do two vehicle bodies (oriented boxes in plan) overlap? */
function bodiesOverlap(a: CompiledLine, A: VehicleState, b: CompiledLine, B: VehicleState): boolean {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const axes = [A.hx, A.hz, -A.hz, A.hx, B.hx, B.hz, -B.hz, B.hx];
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i];
    const uz = axes[i + 1];
    const ra = a.bodyHalfLen * Math.abs(A.hx * ux + A.hz * uz) + a.bodyHalfWid * Math.abs(-A.hz * ux + A.hx * uz);
    const rb = b.bodyHalfLen * Math.abs(B.hx * ux + B.hz * uz) + b.bodyHalfWid * Math.abs(-B.hz * ux + B.hx * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

describe('the roster', () => {
  it('has the 16 lines of the DESIGN table with their kinds, districts, stems, fleets and flags', () => {
    const L = city.world.lines;
    expect(L.map((l) => l.id)).toEqual(ROSTER.map((r) => r.id));
    for (const r of ROSTER) {
      const l = line(r.id);
      expect(l.kind, r.id).toBe(r.kind);
      expect(l.district, r.id).toBe(r.district);
      expect(l.stem, r.id).toBe(r.stem);
      expect(l.vehicles, r.id).toBe(r.vehicles);
      expect(l.secret === true, r.id).toBe(r.secret === true);
      expect(l.minChainN, r.id).toBe(r.minChain ?? 1);
      expect(l.overhead, r.id).toBe(city.routes[r.id].overhead);
      // Two or more stops, so at least two segments to ink.
      expect(l.allStops.length, r.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('every lap period divides the day, so the timetable repeats exactly', () => {
    for (const l of city.world.lines) {
      expect(DAY_TICKS % l.period, l.id).toBe(0);
      expect(l.runTicks, l.id).toBeLessThanOrEqual(l.period);
    }
  });

  it('runs every vehicle only on laps that leave the terminus inside its service hours', () => {
    for (const r of ROSTER) {
      const l = line(r.id);
      let activeSamples = 0;
      for (let t = 0; t < DAY_TICKS; t += 30) {
        for (let i = 0; i < l.vehicles; i++) {
          vehicleAt(l, i, t, vs);
          let want = inWindows(r.hours, lapStart(l, vs, t) / DAY_TICKS);
          if (l.parkHidden === true && vs.lapTick >= l.runTicks) want = false;
          expect(vs.active, `${r.id} vehicle ${i} at ${t}`).toBe(want);
          if (vs.active) activeSamples++;
        }
      }
      expect(activeSamples, r.id).toBeGreaterThan(0);
    }
  });

  it('sends the blimp on exactly one pass a day and the ghost tram only after midnight', () => {
    for (const id of ['S2', 'S1']) {
      const l = line(id);
      const starts = new Set<number>();
      for (let t = 0; t < DAY_TICKS; t++) {
        vehicleAt(l, 0, t, vs);
        if (vs.active) starts.add(lapStart(l, vs, t));
      }
      expect(starts.size, id).toBe(1);
      const [s] = [...starts];
      if (id === 'S2') expect(s / DAY_TICKS).toBeCloseTo(0.76, 6);
      else expect(s / DAY_TICKS).toBeLessThan(0.06);
    }
    // The ghost tram is gone long before dawn.
    const g = line('S1');
    for (let t = Math.round(0.2 * DAY_TICKS); t < DAY_TICKS; t += 30) {
      vehicleAt(g, 0, t, vs);
      expect(vs.active).toBe(false);
    }
  });

  it('gives every line its own livery', () => {
    const seen = new Set<string>();
    for (const l of city.world.lines) {
      const k = `${l.livery.base}/${l.livery.pattern}`;
      expect(seen.has(k), l.id).toBe(false);
      seen.add(k);
    }
  });

  it('keeps ground vehicles on street, track or plaza and well clear of solid walls all lap', () => {
    const ok = new Set<number>([Surface.STREET, Surface.TRACK, Surface.PLAZA]);
    const problems: string[] = [];
    for (const l of city.world.lines) {
      if (l.overhead) continue;
      for (let t = 0; t < l.period; t += 10) {
        // Vehicle 0's lap tick equals t when the day tick is t - phase.
        vehicleAt(l, 0, t - l.phaseTicks, vs);
        const s = terrainSurface(city.world, vs.x, vs.z);
        if (!ok.has(s)) problems.push(`${l.id} on surface ${s} at ${vs.x.toFixed(0)},${vs.z.toFixed(0)}`);
        collideSolids(city.world, vs.x, vs.y, vs.z, l.bodyHalfWid + 1.4, l.bodyHeight, 0.4, WH);
        if (WH.hit) {
          const o = city.world.solids[WH.solid];
          problems.push(`${l.id} within 1.4 m of ${o.kind} at ${vs.x.toFixed(1)},${vs.z.toFixed(1)}`);
        }
      }
    }
    expect(problems.slice(0, 60)).toEqual([]);
  });

  it('never lets two vehicles of different ground lines overlap, all day', () => {
    const ground = city.world.lines.filter((l) => !l.overhead);
    const states = ground.map((l) => Array.from({ length: l.vehicles }, () => makeVehicleState()));
    const hits: string[] = [];
    for (let t = 0; t < DAY_TICKS; t += 10) {
      for (let a = 0; a < ground.length; a++) for (let i = 0; i < ground[a].vehicles; i++) vehicleAt(ground[a], i, t, states[a][i]);
      for (let a = 0; a < ground.length; a++) {
        for (let b = a + 1; b < ground.length; b++) {
          for (const A of states[a]) {
            if (!A.active) continue;
            for (const B of states[b]) {
              if (!B.active || Math.abs(A.y - B.y) > 4) continue;
              if (bodiesOverlap(ground[a], A, ground[b], B)) hits.push(`${ground[a].id}/${ground[b].id} at ${t} (${A.x.toFixed(0)},${A.z.toFixed(0)})`);
            }
          }
        }
      }
    }
    expect(hits.slice(0, 10)).toEqual([]);
  });

  it('hangs overhead straps clear of every solid, at least 2.2 m above whatever is under them', () => {
    const problems: string[] = [];
    for (const l of city.world.lines) {
      if (!l.overhead) continue;
      for (let t = 0; t < l.period; t += 10) {
        vehicleAt(l, 0, t - l.phaseTicks, vs);
        grabPoint(l, vs, gp);
        const under = topHeight(city.world, gp.x, gp.z);
        if (gp.y - under < 2.2) problems.push(`${l.id} strap ${(gp.y - under).toFixed(2)} m up at ${gp.x.toFixed(0)},${gp.z.toFixed(0)}`);
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('lets a skater hop to the strap of the crane, the lower cable car and the summit cable car at a stop', () => {
    const hopApex = (FEEL.HOP_V * FEEL.HOP_V) / (2 * FEEL.GRAVITY);
    const reachableStops = (id: string): number => {
      const l = line(id);
      let n = 0;
      for (const st of l.allStops) {
        // Where vehicle 0 stands at this stop.
        for (let t = 0; t < l.period; t++) {
          if (Math.abs(l.lapS[t] - st.s) < 0.05 && l.lapS[t] === l.lapS[t + 1]) {
            vehicleAt(l, 0, t - l.phaseTicks, vs);
            grabPoint(l, vs, gp);
            const need = gp.y - (topHeight(city.world, gp.x, gp.z) + FEEL.HAND_HEIGHT);
            if (need <= FEEL.HITCH_REACH_Y + hopApex * 0.9) n++;
            break;
          }
        }
      }
      return n;
    };
    expect(reachableStops('D1')).toBe(line('D1').allStops.length);
    expect(reachableStops('A1')).toBe(line('A1').allStops.length);
    expect(reachableStops('A2')).toBeGreaterThanOrEqual(1);
  });
});

describe('meetings', () => {
  /** Ticks (sampled every 10) at which both lines are in service, and at which they meet. */
  function scan(m: (typeof MEETINGS)[number]): { service: Uint8Array; met: Uint8Array } {
    const a = line(m.a);
    const b = line(m.b);
    const z = findZone(city.world, m.zone);
    if (!z) throw new Error(`no zone ${m.zone}`);
    const n = DAY_TICKS / 10;
    const service = new Uint8Array(n);
    const met = new Uint8Array(n);
    const A = Array.from({ length: a.vehicles }, () => makeVehicleState());
    const B = Array.from({ length: b.vehicles }, () => makeVehicleState());
    const ga = { x: 0, y: 0, z: 0 };
    const gb = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < n; k++) {
      const t = k * 10;
      A.forEach((v, i) => vehicleAt(a, i, t, v));
      B.forEach((v, i) => vehicleAt(b, i, t, v));
      if (!A.some((v) => v.active) || !B.some((v) => v.active)) continue;
      service[k] = 1;
      for (const va of A) {
        if (!va.active || Math.hypot(va.x - z.x, va.z - z.z) > z.r + 12) continue;
        for (const vb of B) {
          if (!vb.active || Math.hypot(vb.x - z.x, vb.z - z.z) > z.r + 12) continue;
          if (Math.hypot(va.x - vb.x, va.z - vb.z) > 12) continue;
          // Compatible heights: where a hand can go from one grab point to the other.
          grabPoint(a, va, ga);
          grabPoint(b, vb, gb);
          if (Math.abs(ga.y - gb.y) <= 4) met[k] = 1;
        }
      }
    }
    return { service, met };
  }

  it('lists at least six designed meetings at the city chain spots', () => {
    expect(MEETINGS.length).toBeGreaterThanOrEqual(6);
    const zones = new Set(MEETINGS.map((m) => m.zone));
    expect(zones.size).toBe(MEETINGS.length);
    for (const m of MEETINGS) {
      expect(findZone(city.world, m.zone)?.kind, m.zone).toBe('chain');
      expect(m.everyTicks).toBeLessThanOrEqual(4 * 60 * 60);
    }
  });

  for (const m of MEETINGS) {
    it(`${m.a} meets ${m.b} at ${m.zone} at least every ${m.everyTicks / 60} s while both run`, () => {
      const { service, met } = scan(m);
      const n = service.length;
      let meetings = 0;
      let worst = 0;
      let run = 0;
      // Two passes round the (cyclic) day so a gap spanning midnight is measured whole.
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < n; k++) {
          if (met[k]) {
            if (pass === 0) meetings++;
            run = 0;
          } else if (service[k]) {
            run++;
            if (pass === 1) worst = Math.max(worst, run * 10);
          } else run = 0;
        }
      }
      expect(meetings).toBeGreaterThan(0);
      expect(worst).toBeLessThanOrEqual(m.everyTicks);
    });
  }
});
