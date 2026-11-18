import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { MEETINGS, buildCityLines } from '../../src/sim/city/lines';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { grabPoint, inWindows, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../../src/sim/lines';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { placePlayer } from '../../src/sim/player';
import { Sim } from '../../src/sim/sim';
import { Mode, NO_INPUT, type SimEvent } from '../../src/sim/types';
import { District, Surface, collideSolids, findZone, makeWallHit, terrainSurface, topHeight } from '../../src/sim/world';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const D = District;
const DAWN = 0.22;
const DAY = 0.3;
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
  /** Vanishes once its lap is run instead of waiting at the terminus (secrets). */
  parkHidden?: boolean;
}[] = [
  { id: 'D1', kind: 'crane', district: D.DOCKS, stem: 0, vehicles: 1, hours: [[0, 1]] },
  { id: 'D2', kind: 'forklift', district: D.DOCKS, stem: 1, vehicles: 9, hours: [[DAWN, NIGHT]] },
  { id: 'D3', kind: 'truck', district: D.DOCKS, stem: 2, vehicles: 6, hours: [[DAWN, NIGHT]] },
  { id: 'M1', kind: 'moped', district: D.MERCADO, stem: 0, vehicles: 6, hours: [[DAWN, NIGHT]] },
  { id: 'M2', kind: 'handcart', district: D.MERCADO, stem: 1, vehicles: 6, hours: [[DAWN, NIGHT]] },
  { id: 'M3', kind: 'parade', district: D.MERCADO, stem: 2, vehicles: 1, hours: [[0.55, 0.72]] },
  { id: 'T1', kind: 'funicular', district: D.TERRACES, stem: 0, vehicles: 4, hours: [[0, 1]] },
  { id: 'T2', kind: 'tram', district: D.TERRACES, stem: 1, vehicles: 12, hours: [[0, 1]] },
  { id: 'T3', kind: 'tram', district: D.TERRACES, stem: 2, vehicles: 6, hours: [[0, 1]] },
  // Night only: its laps leave from nightfall to midnight, so the last is home before dawn.
  { id: 'T4', kind: 'bus', district: D.TERRACES, stem: 3, vehicles: 4, hours: [[NIGHT, 1]] },
  { id: 'A1', kind: 'cablecar', district: D.ANTENNA, stem: 0, vehicles: 4, hours: [[0, 1]] },
  { id: 'A2', kind: 'cablecar', district: D.ANTENNA, stem: 1, vehicles: 3, hours: [[DAY, NIGHT]] },
  { id: 'A3', kind: 'kite', district: D.ANTENNA, stem: 2, vehicles: 5, hours: [[0.35, 0.7]] },
  { id: 'S1', kind: 'ghosttram', district: D.TERRACES, stem: 3, vehicles: 1, hours: [[0, 0.06]], secret: true, parkHidden: true },
  { id: 'S2', kind: 'blimp', district: D.ANTENNA, stem: 3, vehicles: 1, hours: [[0.76, 0.77]], secret: true, parkHidden: true },
  { id: 'S3', kind: 'kite', district: D.ANTENNA, stem: 3, vehicles: 1, hours: [[0.35, 0.7]], secret: true, minChain: 4, parkHidden: true },
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
function lapStart(v: VehicleState, tick: number): number {
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

  it('compiles every line quickly, the same way each time', () => {
    // Best of five, so a busy machine (other test workers) does not fail it: the work takes ~15 ms.
    let best = Infinity;
    let again = buildCityLines(city.world, city.routes);
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      again = buildCityLines(city.world, city.routes);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(150);
    expect(again.map((l) => [l.period, l.length, l.phaseTicks])).toEqual(city.world.lines.map((l) => [l.period, l.length, l.phaseTicks]));
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
          let want = inWindows(r.hours, lapStart(vs, t) / DAY_TICKS);
          if (r.parkHidden === true && vs.lapTick >= l.runTicks) want = false;
          expect(vs.active, `${r.id} vehicle ${i} at ${t}`).toBe(want);
          if (vs.active) activeSamples++;
        }
      }
      expect(activeSamples, r.id).toBeGreaterThan(0);
    }
  });

  it('keeps the night bus off the road by day: no T4 vehicle between 0.25 and 0.78', () => {
    const l = line('T4');
    let night = 0;
    for (let t = 0; t < DAY_TICKS; t += 10) {
      for (let i = 0; i < l.vehicles; i++) {
        vehicleAt(l, i, t, vs);
        const f = t / DAY_TICKS;
        if (f > 0.25 && f < 0.78) expect(vs.active, `T4 vehicle ${i} at ${f.toFixed(3)}`).toBe(false);
        else if (vs.active) night++;
        // Every lap is home (back at the terminus) by 0.24.
        if (vs.active && vs.lapTick < l.runTicks && f < 0.5) expect(f, 'lap still running').toBeLessThan(0.24);
      }
    }
    expect(night).toBeGreaterThan(0);
  });

  it('sends the blimp on exactly one pass a day and the ghost tram only after midnight', () => {
    for (const id of ['S2', 'S1']) {
      const l = line(id);
      const starts = new Set<number>();
      for (let t = 0; t < DAY_TICKS; t++) {
        vehicleAt(l, 0, t, vs);
        if (vs.active) starts.add(lapStart(vs, t));
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

  it('keeps every corner of every ground vehicle body at least 1 m from any solid, all lap', () => {
    const solids = city.world.solids.filter((o) => !o.oneWay);
    const problems: string[] = [];
    for (const l of city.world.lines) {
      if (l.overhead || l.bodyHeight <= 0) continue;
      for (let t = 0; t < l.period; t += 10) {
        vehicleAt(l, 0, t - l.phaseTicks, vs);
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          // Corner of the body rectangle: along the heading and to its side.
          const cx = vs.x + vs.hx * l.bodyHalfLen * a - vs.hz * l.bodyHalfWid * b;
          const cz = vs.z + vs.hz * l.bodyHalfLen * a + vs.hx * l.bodyHalfWid * b;
          for (const o of solids) {
            if (o.yTop <= vs.y + 0.4 || o.yBase >= vs.y + l.bodyHeight) continue;
            const dx = cx - o.cx;
            const dz = cz - o.cz;
            const lx = Math.abs(dx * o.cosR + dz * o.sinR) - o.hx;
            const lz = Math.abs(-dx * o.sinR + dz * o.cosR) - o.hz;
            const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
            if (d < 1.0) problems.push(`${l.id} corner ${d.toFixed(2)} m from ${o.kind} at ${cx.toFixed(1)},${cz.toFixed(1)}`);
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('never lets two vehicles overlap, of the same ground line or different ones, all day', () => {
    const ground = city.world.lines.filter((l) => !l.overhead);
    const states = ground.map((l) => Array.from({ length: l.vehicles }, () => makeVehicleState()));
    const hits: string[] = [];
    for (let t = 0; t < DAY_TICKS; t += 10) {
      for (let a = 0; a < ground.length; a++) for (let i = 0; i < ground[a].vehicles; i++) vehicleAt(ground[a], i, t, states[a][i]);
      for (let a = 0; a < ground.length; a++) {
        // The same line too: a car home from its lap must not stand on the one leaving.
        for (let b = a; b < ground.length; b++) {
          for (const [i, A] of states[a].entries()) {
            if (!A.active) continue;
            for (const [j, B] of states[b].entries()) {
              if (a === b && j <= i) continue;
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

describe('a whole day of traffic', () => {
  for (const id of ['spawn', 'spawn_docks', 'spawn_mercado', 'spawn_terraces', 'spawn_antenna']) {
    it(`never runs down a skater left at ${id}`, () => {
      const z = findZone(city.world, id);
      expect(z).not.toBeNull();
      if (!z) return;
      const sim = new Sim(city.world, { seed: 1, startDayFrac: 0 });
      placePlayer(city.world, sim.player, z.x, z.z, city.world.spawn.heading);
      let bails = 0;
      for (let t = 0; t < DAY_TICKS; t++) {
        sim.step(NO_INPUT);
        for (const e of sim.events) if (e.type === 'bail' && e.reason === 'vehicle') bails++;
      }
      expect(bails).toBe(0);
    });
  }
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

// ---------------------------------------------------------------------------------------------
// Two-link chains at the meetings: hitch line a, sling, catch line b as it comes past.

interface Overtake {
  /** Day tick when b's vehicle is level with a's vehicle near the zone. */
  tick: number;
  va: number;
  vb: number;
}

/** The first moment in the day when a vehicle of b draws level with a vehicle of a at the zone. */
function findOvertake(aId: string, bId: string, zone: string): Overtake {
  const a = line(aId);
  const b = line(bId);
  const z = findZone(city.world, zone);
  if (!z) throw new Error(zone);
  const A = makeVehicleState();
  const B = makeVehicleState();
  for (let t = 0; t < DAY_TICKS; t += 2) {
    for (let i = 0; i < a.vehicles; i++) {
      vehicleAt(a, i, t, A);
      if (!A.active || Math.hypot(A.x - z.x, A.z - z.z) > z.r + 12) continue;
      for (let j = 0; j < b.vehicles; j++) {
        vehicleAt(b, j, t, B);
        if (!B.active || Math.hypot(A.x - B.x, A.z - B.z) > 12) continue;
        // Same way, b level with a and faster.
        const along = (B.x - A.x) * A.hx + (B.z - A.z) * A.hz;
        const vrel = (B.vx - A.vx) * A.hx + (B.vz - A.vz) * A.hz;
        if (A.hx * B.hx + A.hz * B.hz > 0.8 && Math.abs(along) < 1 && vrel > 1) return { tick: t, va: i, vb: j };
      }
    }
  }
  throw new Error(`${bId} never overtakes ${aId} at ${zone}`);
}

interface ChainRun {
  links: number;
  events: SimEvent[];
}

/**
 * Wait beside a's lane ahead of its vehicle, ride it, lean away and crack the whip toward b
 * (`sign` picks the side), let go `release` ticks after the overtake moment, re-arm, and ride
 * whatever is caught for a second.
 */
function chainRun(aId: string, bId: string, o: Overtake, lead: number, release: number, whip: number, sign: number, far = false): ChainRun {
  const a = line(aId);
  const b = line(bId);
  const sim = new Sim(city.world, { seed: 1, startDayFrac: 0 });
  sim.tick = o.tick - lead;
  // Stand where a's vehicle origin will be 1.5 s from now, beside it on b's side.
  const A = makeVehicleState();
  const B = makeVehicleState();
  vehicleAt(a, o.va, sim.tick + 90, A);
  vehicleAt(b, o.vb, o.tick, B);
  // On b's side of a's lane, or (`far`) the other side, out of b's reach while waiting for a.
  const side = ((B.x - A.x) * -A.hz + (B.z - A.z) * A.hx >= 0 ? 1 : -1) * (far ? -1 : 1);
  const off = a.bodyHalfWid + 0.9;
  placePlayer(city.world, sim.player, A.x - A.hz * side * off, A.z + A.hx * side * off, Math.atan2(A.hx, A.hz));
  sim.player.speed = Math.min(3, a.cruise * 0.5);
  const events: SimEvent[] = [];
  let hitchedA = false;
  let released = -1;
  let caught = -1;
  let links = 0;
  const end = lead + release;
  for (let i = 0; i < lead + release + 400; i++) {
    let steer = 0;
    let hold = true;
    if (released < 0) {
      if (i >= end - whip) steer = sign;
      else if (i >= end - whip - 45) steer = -sign;
      hold = !hitchedA || i < end;
    } else if (caught < 0) hold = i > released + 4;
    else hold = i < caught + 60;
    sim.step({ steer, hold, hop: false });
    for (const e of sim.events) {
      events.push(e);
      if (e.type === 'hitch') {
        if (!hitchedA) {
          if (e.line !== a.index) return { links: 0, events };
          hitchedA = true;
        } else if (released >= 0 && caught < 0) {
          caught = i;
          links = e.line === b.index ? e.chain : 0;
        }
      }
      if (e.type === 'release' && released < 0) released = i;
    }
    if (!hitchedA && i > lead + 60) return { links: 0, events };
    if (caught >= 0 && i > caught + 60) break;
    if (released >= 0 && caught < 0 && i > released + 240) break;
  }
  return { links, events };
}

/**
 * Search release time, whip length and which side of a's lane to wait on for a script that chains
 * a into b. The search runs with the test, so it re-finds itself whenever the controller or the
 * timetable changes.
 */
function findCityChain(aId: string, bId: string, zone: string): { params: number[]; run: ChainRun } {
  resetFeel();
  const o = findOvertake(aId, bId, zone);
  for (const lead of [240, 420]) {
    for (let release = -150; release <= 150; release += 6) {
      for (const whip of [0, 16, 28]) {
        for (const sign of [1, -1]) {
          for (const far of [false, true]) {
            const run = chainRun(aId, bId, o, lead, release, whip, sign, far);
            if (run.links === 2) return { params: [lead, release, whip, sign, far ? 1 : 0], run };
          }
        }
      }
    }
  }
  throw new Error(`no ${aId} -> ${bId} chain found`);
}

describe('two-link chains at the meetings', () => {
  for (const [a, b, zone] of [
    ['D2', 'D3', 'chain_D2_D3'],
    ['D2', 'T2', 'chain_D2_T2'],
    ['M2', 'M1', 'chain_M1_M2'],
  ]) {
    it(`a skater hitches ${a}, slings, and catches ${b} as it comes past`, () => {
      const { run } = findCityChain(a, b, zone);
      const catchB = run.events.find((e) => e.type === 'hitch' && e.line === line(b).index);
      expect(catchB).toMatchObject({ chain: 2, newLink: true });
      expect(run.events.find((e) => e.type === 'hitch')).toMatchObject({ line: line(a).index, chain: 1 });
      expect(run.events.some((e) => e.type === 'chainEnd')).toBe(false);
      expect(run.events.some((e) => e.type === 'bail')).toBe(false);
    });
  }
});

describe('the blimp', () => {
  it('runs only on its one pass of the day', () => {
    const l = line('S2');
    let on = 0;
    for (let t = 0; t < DAY_TICKS; t++) {
      vehicleAt(l, 0, t, vs);
      if (!vs.active) continue;
      on++;
      // Active only from its 0.76 departure until its lap is done.
      const since = t - Math.round(0.76 * DAY_TICKS);
      expect(since, `active at ${t}`).toBeGreaterThanOrEqual(0);
      expect(since, `active at ${t}`).toBeLessThan(l.runTicks);
    }
    expect(on).toBeGreaterThan(0);
  });

  it('sweeps its ladder a hop above the hill station platform for 3 s, out of standing reach', () => {
    // Standing, a hand reaches HAND_HEIGHT + HITCH_REACH_Y above the board; a hop adds its apex.
    const l = line('S2');
    const hs = findZone(city.world, 'hill_station');
    expect(hs).not.toBeNull();
    if (!hs) return;
    const hopApex = (FEEL.HOP_V * FEEL.HOP_V) / (2 * FEEL.GRAVITY);
    let ticks = 0;
    for (let t = 0; t < DAY_TICKS; t++) {
      vehicleAt(l, 0, t, vs);
      if (!vs.active) continue;
      grabPoint(l, vs, gp);
      const o = topHeight(city.world, gp.x, gp.z);
      if (Math.abs(o - hs.y) > 0.05 || Math.hypot(gp.x - hs.x, gp.z - hs.z) > 20) continue;
      const need = gp.y - (hs.y + FEEL.HAND_HEIGHT);
      // Over the platform the ladder is never low enough to take standing.
      expect(need, 'out of standing reach').toBeGreaterThan(FEEL.HITCH_REACH_Y + 0.3);
      if (need <= FEEL.HITCH_REACH_Y + hopApex * 0.8) ticks++;
    }
    expect(ticks / 60).toBeGreaterThanOrEqual(3);
  });

  it('a skater waiting on the hill station platform at 0.76 hops onto its ladder, is carried high, and finds the secret', () => {
    resetFeel();
    const l = line('S2');
    const w = city.world;
    const hs = findZone(w, 'hill_station');
    if (!hs) throw new Error('no hill_station');
    const game = new Game(w, { seed: 1, startDayFrac: 0.76 });
    const sim = game.sim;
    const p = sim.player;
    // Wait on the platform's west half, where the ladder passes.
    placePlayer(w, p, 19, 1038.5, 0);
    const events: GameEvent[] = [];
    let hitched = -1;
    let high = 0;
    const V = makeVehicleState();
    const G = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 4 * 60 * 60 && (hitched < 0 || i < hitched + 60 * 60); i++) {
      let hop = false;
      let hold = false;
      let steer = 0;
      if (p.mode === Mode.HITCH) hold = true;
      else {
        vehicleAt(l, 0, sim.tick, V);
        if (V.active) {
          grabPoint(l, V, G);
          const d = Math.hypot(G.x - p.x, G.z - p.z);
          // Closed loop: arm as the ladder comes near, hop when its end is about to pass.
          hold = d < 4;
          hop = p.mode === Mode.GROUND && d < 1.6 && G.y - (p.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y;
          // Shuffle under the ladder's line of travel.
          const want = Math.atan2(G.x - p.x, G.z - p.z);
          if (d < 12 && p.mode === Mode.GROUND) steer = Math.max(-1, Math.min(1, -2 * (((want - p.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)));
        }
      }
      game.step({ steer, hold, hop });
      for (const e of game.events) events.push(e);
      if (hitched < 0 && p.mode === Mode.HITCH && w.lines[p.hLine].id === 'S2') hitched = i;
      if (hitched >= 0 && p.mode === Mode.HITCH) high = Math.max(high, p.y - topHeight(w, p.x, p.z));
    }
    expect(hitched, 'hitched the blimp').toBeGreaterThanOrEqual(0);
    expect(high, 'carried above 25 m').toBeGreaterThan(25);
    expect(events.some((e) => e.type === 'secretFound' && e.id === 'blimp')).toBe(true);
  });
});
