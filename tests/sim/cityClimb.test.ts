import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../../src/sim/lines';
import { angleDiff, clamp } from '../../src/sim/math';
import { placePlayer } from '../../src/sim/player';
import { Sim } from '../../src/sim/sim';
import { Mode } from '../../src/sim/types';
import { findZone } from '../../src/sim/world';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };

function line(id: string): CompiledLine {
  const l = city.world.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

/** First day tick at which vehicle 0 of `l` starts a lap in service. */
function lapStartTick(l: CompiledLine): number {
  for (let t = 0; t < DAY_TICKS; t++) {
    vehicleAt(l, 0, t, vs);
    if (vs.lapTick === 0 && vs.active) return t;
  }
  throw new Error(`${l.id} never starts a lap`);
}

// ---------------------------------------------------------------------------------------------
// The climb: from the docks to the summit on rides alone.

interface Leg {
  line: string;
  /** Where to wait for the ride (x, z); for a bumper ride, beside its lane. */
  wait: (sim: Sim) => [number, number];
  /** True when it is time to let go of the ride. */
  alight: (v: VehicleState, sim: Sim) => boolean;
}

interface ClimbLog {
  reached: number;
  ladder: string[];
  maxStep: number;
  maxStepAt: string;
  /** Most height gained, off a ride, above where the skater last left one (or started). */
  worstFreeClimb: number;
  bails: number;
  trace: string[];
}

/** Where vehicle `vi` of `l` stands at stop `k`, and its heading there. */
function stopPose(l: CompiledLine, k: number): { x: number; y: number; z: number; hx: number; hz: number } {
  const st = l.allStops[k];
  for (let t = 0; t < l.period; t++) {
    if (Math.abs(l.lapS[t] - st.s) < 0.05 && l.lapS[t] === l.lapS[t + 1]) {
      vehicleAt(l, 0, t - l.phaseTicks, vs);
      return { x: vs.x, y: vs.y, z: vs.z, hx: vs.hx, hz: vs.hz };
    }
  }
  throw new Error(`${l.id} never stands at stop ${k}`);
}

/** Has vehicle state v come to rest at stop k of l? */
function atStop(l: CompiledLine, v: VehicleState, k: number): boolean {
  return Math.abs(v.s - l.allStops[k].s) < 0.05 && Math.hypot(v.vx, v.vz) < 0.05;
}

/** Is any vehicle of l standing at stop k at this tick? */
function anyAtStop(l: CompiledLine, k: number, tick: number): boolean {
  const V = makeVehicleState();
  for (let i = 0; i < l.vehicles; i++) {
    vehicleAt(l, i, tick, V);
    if (V.active && atStop(l, V, k)) return true;
  }
  return false;
}

/**
 * A small closed-loop climber. On the ground it steers for the next ride's waiting point,
 * tic-tacs when slow, keeps the touch armed only when a vehicle of the wanted line is close, and
 * hops for a strap that is out of standing reach. Riding, it holds on until the leg says to let
 * go. After the last leg it rolls for the summit.
 */
function climb(legs: Leg[], startZone: string, endZone: string, maxTicks: number): ClimbLog {
  const w = city.world;
  const start = findZone(w, startZone);
  const end = findZone(w, endZone);
  if (!start || !end) throw new Error('zones');
  const sim = new Sim(w, { seed: 1, startDayFrac: 0.3 });
  placePlayer(w, sim.player, start.x, start.z, w.spawn.heading);
  const p = sim.player;
  const log: ClimbLog = { reached: -1, ladder: [], maxStep: 0, maxStepAt: '', worstFreeClimb: 0, bails: 0, trace: [] };
  let leg = 0;
  let freeBase = p.y;
  let px = p.x;
  let py = p.y;
  let pz = p.z;
  let wasHitched = false;
  const V = makeVehicleState();
  const G = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < maxTicks; i++) {
    let steer = 0;
    let hold = false;
    let hop = false;
    const L = leg < legs.length ? line(legs[leg].line) : null;
    if (p.mode === Mode.HITCH) {
      const H = w.lines[p.hLine];
      vehicleAt(H, p.hVeh, sim.tick, V);
      if (!L || H.index !== L.index) hold = false;
      else if (legs[leg].alight(V, sim)) {
        hold = false;
        leg++;
      } else hold = true;
      // Ride quietly: lean against the swing so it does not slam into the walls of the road.
      if (Math.hypot(V.vx, V.vz) > 4) steer = clamp(-(1.5 * angleDiff(p.psi, p.psiRest) + 0.5 * p.omega), -1, 1);
    } else {
      // Steer for the waiting point, or the end zone after the last leg.
      const [tx, tz] = L ? legs[leg].wait(sim) : [end.x, end.z];
      const want = Math.atan2(tx - p.x, tz - p.z);
      const dist = Math.hypot(tx - p.x, tz - p.z);
      steer = clamp(-2 * angleDiff(want, p.heading), -1, 1);
      if (p.mode === Mode.GROUND && p.speed < 2.4 && dist > 2) steer = clamp(steer + (Math.floor(i / 12) % 2 === 0 ? 0.9 : -0.9), -1, 1);
      if (L) {
        // Arm the touch when a vehicle of the wanted line is near and nothing else is nearer to
        // hand; hop for a high strap.
        let nearest = Infinity;
        let nearestWanted = false;
        for (const M of w.lines) {
          for (let k = 0; k < M.vehicles; k++) {
            vehicleAt(M, k, sim.tick, V);
            if (!V.active) continue;
            grabPoint(M, V, G);
            const d = Math.hypot(G.x - p.x, G.z - p.z);
            if (d < nearest) {
              nearest = d;
              nearestWanted = M.index === L.index;
            }
            if (M.index !== L.index) continue;
            const high = G.y - (p.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.75;
            if (L.overhead && high && d < 2.5 && p.mode === Mode.GROUND) hop = true;
          }
        }
        hold = nearestWanted && nearest < 9;
      }
    }
    sim.step({ steer, hold, hop });
    for (const e of sim.events) {
      if (e.type === 'bail') log.bails++;
      if (e.type === 'hitch') {
        log.ladder.push(w.lines[e.line].id);
        log.trace.push(`${(i / 60).toFixed(1)}s hitch ${w.lines[e.line].id} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`);
      }
      if (e.type === 'release') log.trace.push(`${(i / 60).toFixed(1)}s release ${w.lines[e.line].id} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`);
    }
    const hitched = p.mode === Mode.HITCH;
    if (wasHitched && !hitched) freeBase = p.y;
    if (!hitched) log.worstFreeClimb = Math.max(log.worstFreeClimb, p.y - freeBase);
    if (!hitched && p.y < freeBase) freeBase = p.y;
    wasHitched = hitched;
    const step = Math.max(Math.hypot(p.x - px, p.z - pz) * 60, Math.abs(p.y - py) * 60);
    if (step > log.maxStep) {
      log.maxStep = step;
      log.maxStepAt = `${(i / 60).toFixed(2)}s mode ${p.mode} d ${(Math.hypot(p.x - px, p.z - pz) * 60).toFixed(1)} dy ${((p.y - py) * 60).toFixed(1)} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
    }
    px = p.x;
    py = p.y;
    pz = p.z;
    if (i % 600 === 0) log.trace.push(`${(i / 60).toFixed(0)}s leg ${leg} ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} mode ${p.mode} v ${p.speed.toFixed(1)}`);
    if (leg >= legs.length && Math.hypot(p.x - end.x, p.z - end.z) < end.r && !hitched) {
      log.reached = i;
      break;
    }
  }
  return log;
}

describe('the climb', () => {
  it('a skater gets from the docks to the summit on rides alone, in under 12 minutes', () => {
    const T2 = line('T2');
    const A1 = line('A1');
    const A2 = line('A2');
    const muelle = stopPose(T2, 0);
    const puerta = T2.allStops.findIndex((s) => s.name === 'Puerta de la Antena');
    const a1Base = stopPose(A1, 0);
    const a2Base = stopPose(A2, 0);
    const legs: Leg[] = [
      {
        // Tram 5 from its docks terminus: wait beside the lane at the rear bumper, on its left,
        // out of the mopeds' lane to its right.
        line: 'T2',
        wait: () => [muelle.x - muelle.hx * T2.anchorBack + muelle.hz * 2.6, muelle.z - muelle.hz * T2.anchorBack - muelle.hx * 2.6],
        // Let go at the Antenna gate stop, under the lower cable car's base.
        alight: (v) => atStop(T2, v, puerta),
      },
      {
        line: 'A1',
        wait: () => [a1Base.x, a1Base.z],
        // At the hill station, let go as a summit cable car waits beside it.
        alight: (v, sim) => Math.abs(v.s - A1.allStops[1].s) < 3 && anyAtStop(A2, 0, sim.tick),
      },
      {
        line: 'A2',
        wait: () => [a2Base.x, a2Base.z],
        alight: (v) => atStop(A2, v, 1),
      },
    ];
    const log = climb(legs, 'spawn_docks', 'summit', 12 * 60 * 60);
    expect(log.reached, log.trace.slice(-12).join('\n')).toBeGreaterThan(0);
    expect(log.ladder).toEqual(['T2', 'A1', 'A2']);
    expect(log.bails).toBe(0);
    // No teleports: never faster than the fastest ride plus a full whip, or the sling cap.
    const fastest = Math.max(...city.world.lines.map((l) => l.cruise));
    expect(log.maxStep, log.maxStepAt).toBeLessThan(Math.max(FEEL.SLING_CAP, fastest + FEEL.SWING_OMEGA_MAX * 4) + 1);
    // Height is won on rides: off a ride, never more than a hop or a sling's pop above where it let go.
    expect(log.worstFreeClimb).toBeLessThan(3);
  });
});

const REGULAR = ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4', 'A1', 'A2', 'A3'];

describe('inking the line map', () => {
  it('riding one full lap of each of the 13 regular lines completes it, and all 13 complete the map', () => {
    const game = new Game(city.world, { seed: 1, startDayFrac: 0 });
    const sim = game.sim;
    const events: GameEvent[] = [];
    for (const id of REGULAR) {
      const l = line(id);
      const t0 = lapStartTick(l);
      // Arrive at the terminus while vehicle 0 waits there to leave.
      sim.tick = t0 + 30;
      vehicleAt(l, 0, sim.tick, vs);
      grabPoint(l, vs, gp);
      const heading = Math.atan2(vs.hx, vs.hz);
      if (l.overhead) {
        // Stand under the strap.
        placePlayer(city.world, sim.player, gp.x, gp.z, heading);
      } else {
        // Stand just behind the bumper.
        placePlayer(city.world, sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, heading);
      }
      // A strap above standing reach is caught with a hop.
      const needHop = gp.y - (sim.player.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.8;
      let hitched = -1;
      let lostAt = -1;
      const ticks = l.runTicks + 60;
      for (let i = 0; i < ticks; i++) {
        game.step({ steer: 0, hold: true, hop: needHop && hitched < 0 && i % 40 === 0 });
        for (const e of game.events) events.push(e);
        if (hitched < 0 && sim.player.mode === Mode.HITCH) hitched = i;
        if (hitched >= 0 && lostAt < 0 && sim.player.mode !== Mode.HITCH) lostAt = i;
      }
      expect(hitched, `${id} hitched`).toBeGreaterThanOrEqual(0);
      expect(hitched, `${id} hitched at the terminus`).toBeLessThan(l.dwell * 60);
      expect(sim.player.hLine, id).toBe(l.index);
      expect(sim.player.hVeh, `${id} vehicle`).toBe(0);
      expect(lostAt, `${id} stayed on all lap`).toBe(-1);
      const lp = game.progress.lines[l.index];
      expect(lp.inked.every((b) => b), `${id} inked ${lp.inked.map((b) => (b ? 1 : 0)).join('')}`).toBe(true);
      expect(lp.complete, id).toBe(true);
      expect(events.some((e) => e.type === 'lineComplete' && e.line === l.index)).toBe(true);
      // Let go before the next ride.
      game.step({ steer: 0, hold: false, hop: false });
      expect(game.progress.mapComplete).toBe(id === REGULAR[REGULAR.length - 1]);
    }
    expect(events.filter((e) => e.type === 'mapComplete').length).toBe(1);
  });
});
