/**
 * The errand and conductor content on the real city: every id exists, the counts and spread are
 * as specified, every errand can be done inside its limit, every conductor number is achievable
 * but not free. Then errands and challenges are played for real by small closed-loop bots that
 * read the sim (steer for a point, arm the hold near a wanted vehicle, let go at a stop), so the
 * play-throughs survive the city moving a few metres or its timetables shifting.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { CONDUCTORS } from '../../src/sim/game/content/conductors';
import { ERRANDS } from '../../src/sim/game/content/errands';
import { stopZoneId, type ConductorDef } from '../../src/sim/game/conductors';
import { errandOpen, inZone, type ErrandDef } from '../../src/sim/game/errands';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { grabPoint, makeVehicleState, pathAt, ticksToArrival, vehicleAt, type CompiledLine } from '../../src/sim/lines';
import { angleDiff, clamp } from '../../src/sim/math';
import { placePlayer } from '../../src/sim/player';
import { Sim } from '../../src/sim/sim';
import { Mode, type InputFrame, type PlayerState } from '../../src/sim/types';
import { District, districtAt, findZone, type World, type Zone } from '../../src/sim/world';

let city: City;
let W: World;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
  W = city.world;
});

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };
const PA = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };

function zone(id: string): Zone {
  const z = findZone(W, id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
}

function line(id: string): CompiledLine {
  const l = W.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

function stopPos(L: CompiledLine, k: number): { x: number; y: number; z: number } {
  pathAt(L, L.allStops[k].s, PA);
  return { x: PA.x, y: PA.y, z: PA.z };
}

/** The stop of `L` nearest to (x, z) in plan, and how far. */
function nearestStop(L: CompiledLine, x: number, z: number): { k: number; d: number } {
  let best = { k: -1, d: Infinity };
  for (let k = 0; k < L.allStops.length; k++) {
    const p = stopPos(L, k);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best.d) best = { k, d };
  }
  return best;
}

const REGULAR = ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4', 'A1', 'A2', 'A3'];

// ---------------------------------------------------------------------------------------------
// Feasibility: a lower bound on the time an errand needs, from geometry and timetables.

/** A generous skating speed for straight-line legs, m/s (faster than the spine is ever ridden on stairs). */
const V_GENEROUS = 12;
/** Seconds between sampled start times across an errand's hours. */
const SAMPLE_EVERY = 10;
const MAX_STOP_DIST = 40;

interface Bound {
  /** Mean over start times in the errand's hours, seconds. */
  seconds: number;
  /** The worst (longest) over start times in the errand's hours, seconds. */
  worst: number;
  problems: string[];
}

/** Ride time from arc s0 to s1 along a line at cruise (forward round a loop; either way on a shuttle). */
function rideSeconds(L: CompiledLine, s0: number, s1: number): number {
  const d = L.loop ? (((s1 - s0) % L.length) + L.length) % L.length : Math.abs(s1 - s0);
  return d / L.cruise;
}

function startTicks(def: ErrandDef): number[] {
  const out: number[] = [];
  for (let t = 0; t < DAY_TICKS; t += SAMPLE_EVERY * 60) if (errandOpen(def, t / DAY_TICKS)) out.push(t);
  return out;
}

function errandBound(def: ErrandDef): Bound {
  const problems: string[] = [];
  const starts = startTicks(def);
  let total = 0;
  let worst = 0;
  for (const s0 of starts) {
    const g = zone(def.giver);
    let x = g.x;
    let z = g.z;
    let t = 0;
    let riding: CompiledLine | null = null;
    let rideFrom = 0;
    const walk = (zx: number, zz: number): void => {
      t += Math.hypot(zx - x, zz - z) / V_GENEROUS;
      x = zx;
      z = zz;
    };
    const board = (L: CompiledLine): void => {
      const ns = nearestStop(L, x, z);
      if (ns.d > MAX_STOP_DIST) problems.push(`${def.id}: ${L.id} has no stop within ${MAX_STOP_DIST} m of the boarding point (${ns.d.toFixed(0)} m)`);
      const sp = stopPos(L, ns.k);
      walk(sp.x, sp.z);
      const wait = ticksToArrival(L, ns.k, s0 + Math.round(t * 60));
      if (!Number.isFinite(wait)) problems.push(`${def.id}: ${L.id} does not run at ${(s0 / DAY_TICKS).toFixed(3)}`);
      else t += wait / 60;
      riding = L;
      rideFrom = L.allStops[ns.k].s;
    };
    for (const st of def.steps) {
      switch (st.kind) {
        case 'reach':
        case 'deliver': {
          const zz = zone(st.zone);
          walk(zz.x, zz.z);
          riding = null;
          break;
        }
        case 'hitch': {
          const L = line(st.line);
          if (riding !== L) board(L);
          break;
        }
        case 'rideTo': {
          const L = line(st.line);
          if (riding !== L) board(L);
          const zz = zone(st.zone);
          const ns = nearestStop(L, zz.x, zz.z);
          if (ns.d > MAX_STOP_DIST) problems.push(`${def.id}: ${L.id} has no stop within ${MAX_STOP_DIST} m of ${st.zone} (${ns.d.toFixed(0)} m)`);
          t += rideSeconds(L, rideFrom, L.allStops[ns.k].s);
          rideFrom = L.allStops[ns.k].s;
          x = zz.x;
          z = zz.z;
          break;
        }
        case 'chain':
        case 'grind':
        case 'air': {
          if (st.at !== undefined) {
            const zz = zone(st.at);
            walk(zz.x, zz.z);
          }
          if (st.kind === 'grind') t += st.metres / V_GENEROUS;
          if (st.kind === 'air') t += st.seconds;
          break;
        }
      }
    }
    total += t;
    worst = Math.max(worst, t);
  }
  return { seconds: starts.length > 0 ? total / starts.length : Infinity, worst: starts.length > 0 ? worst : Infinity, problems };
}

describe('errand content on the city', () => {
  it('every errand references existing zones and lines, and the game takes all of them', () => {
    for (const e of ERRANDS) {
      expect(findZone(W, e.giver), `${e.id} giver ${e.giver}`).not.toBeNull();
      for (const s of e.steps) {
        if (s.kind === 'reach' || s.kind === 'deliver' || s.kind === 'rideTo') expect(findZone(W, s.zone), `${e.id} ${s.zone}`).not.toBeNull();
        if ((s.kind === 'chain' || s.kind === 'grind' || s.kind === 'air') && s.at !== undefined) expect(findZone(W, s.at), `${e.id} ${s.at}`).not.toBeNull();
        if (s.kind === 'hitch' || s.kind === 'rideTo') expect(REGULAR, `${e.id} rides a regular line`).toContain(s.line);
      }
    }
    const game = new Game(W, { seed: 1 });
    expect(game.errands.list.map((e) => e.id)).toEqual(ERRANDS.map((e) => e.id));
  });

  it('at least 10 errands, two or more given in each district (by where the giver stands), limits of 2 to 4 minutes', () => {
    expect(ERRANDS.length).toBeGreaterThanOrEqual(10);
    const per = [0, 0, 0, 0];
    for (const e of ERRANDS) {
      const g = zone(e.giver);
      expect(districtAt(W, g.z), `${e.id} district`).toBe(e.district);
      per[e.district]++;
      expect(e.limitTicks).toBeGreaterThanOrEqual(2 * 3600);
      expect(e.limitTicks).toBeLessThanOrEqual(4 * 3600);
      expect(e.brief.length).toBeLessThan(60);
    }
    for (const d of [District.DOCKS, District.MERCADO, District.TERRACES, District.ANTENNA]) expect(per[d], `district ${d}`).toBeGreaterThanOrEqual(2);
  });

  it('the mix: downhill deliveries, rides uphill, chains, a long grind, a time of day', () => {
    const rides = (e: ErrandDef): boolean => e.steps.some((s) => s.kind === 'hitch' || s.kind === 'rideTo' || s.kind === 'chain');
    const downhill = ERRANDS.filter((e) => !rides(e) && e.steps[e.steps.length - 1].kind === 'deliver');
    expect(downhill.length).toBeGreaterThanOrEqual(3);
    const uphill = ERRANDS.filter((e) =>
      e.steps.some((s) => {
        if (s.kind !== 'rideTo') return false;
        const L = line(s.line);
        const from = nearestStop(L, zone(e.giver).x, zone(e.giver).z);
        return zone(s.zone).y > stopPos(L, from.k).y + 5;
      }),
    );
    expect(uphill.length).toBeGreaterThanOrEqual(3);
    expect(ERRANDS.filter((e) => e.steps.some((s) => s.kind === 'chain' && s.links >= 2)).length).toBeGreaterThanOrEqual(2);
    expect(ERRANDS.filter((e) => e.steps.some((s) => s.kind === 'grind' && s.metres >= 25)).length).toBeGreaterThanOrEqual(1);
    expect(ERRANDS.filter((e) => e.hours !== undefined).length).toBeGreaterThanOrEqual(1);
  });

  it('every errand that is all skating (no rides) ends lower than it starts', () => {
    for (const e of ERRANDS) {
      if (e.steps.some((s) => s.kind === 'hitch' || s.kind === 'rideTo' || s.kind === 'chain')) continue;
      const last = e.steps[e.steps.length - 1];
      if (last.kind !== 'deliver' && last.kind !== 'reach') continue;
      expect(zone(last.zone).y, `${e.id} ends below ${e.giver}`).toBeLessThan(zone(e.giver).y);
    }
  });

  it('feasible: the time a skater needs at least (geometry + timetable waits) at the worst offered start time is under 80% of the limit; rides stop near where they are needed and run then', () => {
    const report: string[] = [];
    for (const e of ERRANDS) {
      const b = errandBound(e);
      expect(b.problems, e.id).toEqual([]);
      const limit = e.limitTicks / 60;
      report.push(`${e.id}: mean ${b.seconds.toFixed(0)} s, worst ${b.worst.toFixed(0)} s of ${limit} s`);
      // The worst start, not the mean: an errand offered at a time it cannot be done in is a broken
      // promise however good the average is. The bound is a lower bound at a generous speed, so it
      // must leave a fifth of the limit for real skating.
      expect(b.worst, report.join('\n')).toBeLessThan(0.8 * limit);
    }
  });
});

describe('conductor content on the city', () => {
  it('one conductor per regular line, standing at one of its own stops; zones exist and the needle is not a landing', () => {
    expect(CONDUCTORS.map((c) => c.line).sort()).toEqual([...REGULAR].sort());
    for (const c of CONDUCTORS) {
      const L = line(c.line);
      expect(c.stop, c.line).toBeGreaterThanOrEqual(0);
      expect(c.stop, c.line).toBeLessThan(L.allStops.length);
      // The stop zone the city made for that stop is where the conductor stands.
      const sz = zone(stopZoneId(c.line, c.stop));
      const sp = stopPos(L, c.stop);
      expect(Math.hypot(sz.x - sp.x, sz.z - sp.z), c.line).toBeLessThan(8);
      if (c.task.kind === 'stopToStop') {
        for (const k of [c.task.from, c.task.to]) {
          expect(k).toBeLessThan(L.allStops.length);
          const z = zone(stopZoneId(c.line, k));
          const p = stopPos(L, k);
          expect(Math.hypot(z.x - p.x, z.z - p.z)).toBeLessThan(8);
        }
      }
      if (c.task.kind === 'landOn') {
        expect(c.task.zone).not.toBe('needle');
        expect(findZone(W, c.task.zone)).not.toBeNull();
      }
    }
    const game = new Game(W, { seed: 1 });
    expect(game.conductors.list.length).toBe(13);
  });

  it('sling numbers are achievable but not free: under 0.8 of the best measured release, above a lazy one', () => {
    const report: string[] = [];
    for (const c of CONDUCTORS) {
      const t = c.task;
      if (t.kind !== 'slingDistance' && t.kind !== 'slingAir') continue;
      const m = slingTrials(c);
      const ok =
        t.kind === 'slingDistance'
          ? t.metres <= 0.8 * m.bestDist && t.metres > m.worstDist
          : t.seconds <= 0.8 * m.bestAir && t.seconds > m.worstAir;
      report.push(`${ok ? 'ok ' : 'BAD'} ${c.line} ${t.kind} ${t.kind === 'slingDistance' ? t.metres : t.seconds}: dist ${m.worstDist.toFixed(1)}..${m.bestDist.toFixed(1)} m, air ${m.worstAir.toFixed(2)}..${m.bestAir.toFixed(2)} s`);
    }
    expect(report.filter((r) => r.startsWith('BAD')), report.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Bots

/** The pose of a line's vehicle standing at stop k (the lane, not the route centre line). */
function standingPose(L: CompiledLine, k: number): { x: number; z: number; hx: number; hz: number } {
  const st = L.allStops[k];
  for (let t = 0; t < L.period; t++) {
    if (Math.abs(L.lapS[t] - st.s) < 0.05 && L.lapS[t] === L.lapS[t + 1]) {
      vehicleAt(L, 0, t - L.phaseTicks, VS);
      return { x: VS.x, z: VS.z, hx: VS.hx, hz: VS.hz };
    }
  }
  throw new Error(`${L.id} never stands at stop ${k}`);
}

/** Where to wait for a bumper ride at stop k: beside the lane, level with the rear bumper. */
function waitPoint(L: CompiledLine, k: number): [number, number] {
  const s = standingPose(L, k);
  return [s.x - s.hx * L.anchorBack - s.hz * 2.6, s.z - s.hz * L.anchorBack + s.hx * 2.6];
}

/** A polyline (x, z pairs) from a point down the spine to another point. */
function viaSpine(from: [number, number], to: [number, number]): [number, number][] {
  const s = city.spine;
  const n = s.length / 3;
  const near = (x: number, z: number): number => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(s[i * 3] - x, s[i * 3 + 2] - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const i0 = near(from[0], from[1]);
  const i1 = near(to[0], to[1]);
  const out: [number, number][] = [from];
  const dir = i1 >= i0 ? 1 : -1;
  for (let i = i0; i !== i1 + dir; i += dir) out.push([s[i * 3], s[i * 3 + 2]]);
  out.push(to);
  return out;
}

/** Pure pursuit along a polyline: steer for a point `ahead` metres along it from the nearest point. */
class Follower {
  private idx = 0;
  constructor(
    readonly path: [number, number][],
    readonly ahead = 10,
  ) {}
  done(p: PlayerState, r = 3): boolean {
    const end = this.path[this.path.length - 1];
    return Math.hypot(p.x - end[0], p.z - end[1]) < r;
  }
  steer(p: PlayerState, tick: number): number {
    const P = this.path;
    let best = Infinity;
    for (let j = this.idx; j < Math.min(P.length, this.idx + 40); j++) {
      const d = Math.hypot(P[j][0] - p.x, P[j][1] - p.z);
      if (d < best) {
        best = d;
        this.idx = j;
      }
    }
    let j = this.idx;
    let acc = 0;
    while (j < P.length - 1 && acc < this.ahead) {
      acc += Math.hypot(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]);
      j++;
    }
    return steerFor(p, P[j][0], P[j][1], tick);
  }
}

/** Steer for (x, z); tic-tac when slow on the ground and not there yet. */
function steerFor(p: PlayerState, x: number, z: number, tick: number): number {
  const want = Math.atan2(x - p.x, z - p.z);
  let steer = clamp(-2 * angleDiff(want, p.heading), -1, 1);
  if (p.mode === Mode.GROUND && p.speed < 2.4 && Math.hypot(x - p.x, z - p.z) > 2) steer = clamp(steer + (Math.floor(tick / 12) % 2 === 0 ? 0.9 : -0.9), -1, 1);
  return steer;
}

/** Arm only when the nearest grab point of any ride is a vehicle of `want`, within 9 m; hop for a high strap. */
function armFor(sim: Sim, want: CompiledLine): { hold: boolean; hop: boolean } {
  const p = sim.player;
  let nearest = Infinity;
  let wanted = false;
  let hop = false;
  for (const M of sim.world.lines) {
    for (let k = 0; k < M.vehicles; k++) {
      vehicleAt(M, k, sim.tick, VS);
      if (!VS.active) continue;
      grabPoint(M, VS, GP);
      const d = Math.hypot(GP.x - p.x, GP.z - p.z);
      if (d < nearest) {
        nearest = d;
        wanted = M.index === want.index;
      }
      if (M.index === want.index && M.overhead && d < 2.5 && p.mode === Mode.GROUND && GP.y - (p.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.75) hop = true;
    }
  }
  return { hold: wanted && nearest < 9, hop };
}

/** Lean against the swing so a ride does not slam the skater into the walls of the road. */
function rideQuietly(sim: Sim): number {
  const p = sim.player;
  const H = sim.world.lines[p.hLine];
  vehicleAt(H, p.hVeh, sim.tick, VS);
  if (Math.hypot(VS.vx, VS.vz) <= 4) return 0;
  return clamp(-(1.5 * angleDiff(p.psi, p.psiRest) + 0.5 * p.omega), -1, 1);
}

interface Played {
  events: GameEvent[];
  trace: string[];
  ticks: number;
}

function newGame(dayFrac: number): Game {
  resetFeel();
  return new Game(W, { seed: 1, startDayFrac: dayFrac });
}

function play(game: Game, maxTicks: number, brain: (sim: Sim, i: number) => Partial<InputFrame>, stop: (e: GameEvent) => boolean): Played {
  const out: Played = { events: [], trace: [], ticks: -1 };
  const p = game.sim.player;
  for (let i = 0; i < maxTicks; i++) {
    const inp = brain(game.sim, i);
    game.step({ steer: inp.steer ?? 0, hold: inp.hold ?? false, hop: inp.hop ?? false });
    let end = false;
    for (const e of game.events) {
      out.events.push(e);
      out.trace.push(`${(i / 60).toFixed(1)}s ${e.type} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`);
      if (stop(e)) end = true;
    }
    for (const e of game.sim.events) if (e.type === 'hitch' || e.type === 'release' || e.type === 'bail') out.trace.push(`${(i / 60).toFixed(1)}s ${e.type} ${e.type !== 'bail' ? W.lines[e.line].id : ''} at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`);
    if (i % 600 === 0) out.trace.push(`${(i / 60).toFixed(0)}s at ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)} mode ${p.mode} v ${p.speed.toFixed(1)}`);
    if (end) {
      out.ticks = i + 1;
      break;
    }
  }
  return out;
}

/** Stand in the giver's zone and hold still until the errand starts. */
function acceptAt(game: Game, id: string): void {
  const def = ERRANDS.find((e) => e.id === id);
  if (!def) throw new Error(id);
  const g = zone(def.giver);
  const sim = game.sim;
  for (let tries = 0; tries < 20 && !game.errands.active; tries++) {
    placePlayer(W, sim.player, g.x, g.z, W.spawn.heading);
    for (let i = 0; i < 120 && !game.errands.active; i++) {
      game.step({ steer: 0, hold: sim.player.mode !== Mode.HITCH, hop: false });
    }
    // A ride standing in the zone: wait for it to go and try again.
    if (!game.errands.active) for (let i = 0; i < 300; i++) game.step({ steer: 0, hold: false, hop: false });
  }
  expect(game.errands.active?.id).toBe(id);
}

const errandOver = (e: GameEvent): boolean => e.type === 'errandDone' || e.type === 'errandFail';
const conductorOver = (e: GameEvent): boolean => e.type === 'conductorPunch' || e.type === 'conductorFail';

describe('errands played for real', () => {
  it('a pure downhill delivery: the night driver\'s keys, from Terraza 727 down to the garage at the docks', () => {
    const game = newGame(0.85);
    acceptAt(game, 'night_keys');
    const from = zone('stop_T4_2');
    const to = zone('stop_T4_0');
    const f = new Follower(viaSpine([from.x, from.z], [to.x, to.z]));
    const r = play(game, 4 * 3600, (sim, i) => ({ steer: f.steer(sim.player, i) }), errandOver);
    expect(r.events.filter((e) => e.type.startsWith('errand')).map((e) => e.type), r.trace.join('\n')).toEqual(['errandStep', 'errandDone']);
    expect(r.events.some((e) => e.type === 'errandDone' && e.best)).toBe(true);
  });

  it('a ride uphill: a valve for the funicular, from the lookout to the top station', () => {
    const game = newGame(0.4);
    acceptAt(game, 'funicular_valve');
    const T1 = line('T1');
    const base = zone('funicular_base');
    const [wx, wz] = waitPoint(T1, 0);
    let leg = 0;
    const r = play(
      game,
      4 * 3600,
      (sim, i) => {
        const p = sim.player;
        if (p.mode === Mode.HITCH) return { hold: true, steer: rideQuietly(sim) };
        // First the funicular's base landmark, then beside the car's rear bumper.
        if (leg === 0 && inZone(base, p.x, p.y, p.z)) leg = 1;
        const [tx, tz] = leg === 0 ? [base.x, base.z] : [wx, wz];
        return { steer: steerFor(p, tx, tz, i), ...(leg === 1 ? armFor(sim, T1) : {}) };
      },
      errandOver,
    );
    const kinds = r.events.filter((e) => e.type.startsWith('errand')).map((e) => e.type);
    expect(kinds, r.trace.join('\n')).toEqual(['errandStep', 'errandStep', 'errandDone']);
    expect(game.sim.player.y).toBeGreaterThan(base.y + 60);
  });

  it('downhill across open hill: valves from the summit to the radio shack, without a fall', () => {
    const game = newGame(0.4);
    acceptAt(game, 'radio_valves');
    const to = zone('radio_shack');
    const r = play(game, 3 * 3600, (sim, i) => ({ steer: steerFor(sim.player, to.x, to.z, i) }), errandOver);
    expect(r.events.filter((e) => e.type.startsWith('errand')).map((e) => e.type), r.trace.join('\n')).toEqual(['errandStep', 'errandDone']);
  });

  it('two cable cars as one chain: a kite spool from the funicular top to the ridge', () => {
    const game = newGame(0.4);
    acceptAt(game, 'kite_spool');
    const A1 = line('A1');
    const A2 = line('A2');
    /** Under the strap of a car standing at stop k. */
    const under = (L: CompiledLine, k: number): [number, number] => {
      const s = standingPose(L, k);
      return [s.x - s.hx * L.anchorBack, s.z - s.hz * L.anchorBack];
    };
    const a1 = under(A1, 0);
    const a2 = under(A2, 0);
    const standing = (L: CompiledLine, k: number, tick: number): boolean => {
      for (let i = 0; i < L.vehicles; i++) {
        vehicleAt(L, i, tick, VS);
        if (VS.active && Math.abs(VS.s - L.allStops[k].s) < 0.05 && Math.hypot(VS.vx, VS.vz) < 0.05) return true;
      }
      return false;
    };
    let leg = 0;
    const r = play(
      game,
      4 * 3600,
      (sim, i) => {
        const p = sim.player;
        if (p.mode === Mode.HITCH) {
          const H = sim.world.lines[p.hLine];
          if (H.index === A1.index) {
            vehicleAt(H, p.hVeh, sim.tick, VS);
            // At the hill station, let go as a summit car waits beside it.
            if (Math.abs(VS.s - A1.allStops[1].s) < 3 && standing(A2, 0, sim.tick)) {
              leg = 1;
              return { hold: false };
            }
          }
          return { hold: true };
        }
        const [tx, tz] = leg === 0 ? a1 : a2;
        return { steer: steerFor(p, tx, tz, i), ...armFor(sim, leg === 0 ? A1 : A2) };
      },
      errandOver,
    );
    const kinds = r.events.filter((e) => e.type.startsWith('errand')).map((e) => e.type);
    expect(kinds, r.trace.join('\n')).toEqual(['errandStep', 'errandStep', 'errandStep', 'errandDone']);
  });
});

/** Seconds from letting go to the punch in the stopToStop plays, for the report. */
const measured: Record<string, number> = {};

/** Ride `c`'s line from near its conductor's stop to stop `from`, let go there, then roll via the spine to stop `to`. */
function playStopToStop(c: ConductorDef, dayFrac: number): Played {
  const t = c.task;
  if (t.kind !== 'stopToStop') throw new Error('not stopToStop');
  const L = line(c.line);
  const game = newGame(dayFrac);
  const [wx, wz] = waitPoint(L, c.stop);
  placePlayer(W, game.sim.player, wx, wz, W.spawn.heading);
  const fromZ = zone(stopZoneId(c.line, t.from));
  const toZ = zone(stopZoneId(c.line, t.to));
  let follower: Follower | null = null;
  let releasedAt = -1;
  const r = play(
    game,
    12 * 3600,
    (sim, i) => {
      const p = sim.player;
      if (p.mode === Mode.HITCH) {
        if (game.conductors.active && inZone(fromZ, p.x, p.y, p.z)) {
          releasedAt = i;
          follower = new Follower(viaSpine([p.x, p.z], [toZ.x, toZ.z]));
          return { hold: false };
        }
        return { hold: true, steer: rideQuietly(sim) };
      }
      if (follower) return { steer: follower.steer(p, i) };
      return { steer: steerFor(p, wx, wz, i), ...armFor(sim, L) };
    },
    conductorOver,
  );
  if (releasedAt >= 0 && r.ticks > 0) measured[c.line] = (r.ticks - releasedAt) / 60;
  return r;
}

describe('a conductor challenge played for real', () => {
  it('tram 9: caught at Zigzag Oeste, let go at Terraza Alta, rolled down to Terraza Baja in time', () => {
    const c = CONDUCTORS.find((x) => x.line === 'T3');
    if (!c || c.task.kind !== 'stopToStop') throw new Error('T3 conductor');
    const r = playStopToStop(c, 0.4);
    const kinds = r.events.filter((e) => e.type.startsWith('conductor')).map((e) => e.type);
    expect(kinds, r.trace.join('\n')).toEqual(['conductorStart', 'conductorPunch']);
    // Not free: the time is within 1.6x of what the steering bot needed.
    expect(c.task.seconds, `bot took ${measured.T3} s`).toBeLessThan(1.6 * measured.T3);
  });

  it('the night bus: caught at Rampa Este, let go at Terraza 727, rolled down to the garage in time', () => {
    const c = CONDUCTORS.find((x) => x.line === 'T4');
    if (!c || c.task.kind !== 'stopToStop') throw new Error('T4 conductor');
    const r = playStopToStop(c, 0.84);
    const kinds = r.events.filter((e) => e.type.startsWith('conductor')).map((e) => e.type);
    expect(kinds, r.trace.join('\n')).toEqual(['conductorStart', 'conductorPunch']);
    expect(c.task.seconds, `bot took ${measured.T4} s`).toBeLessThan(1.6 * measured.T4);
  });
});

// ---------------------------------------------------------------------------------------------
// Sling measurements

/**
 * Catch the line as it leaves the conductor's stop, ride while pumping the swing for a range of
 * durations, let go (plain and with a swipe up) and measure each flight to its first touch down.
 */
function slingTrials(c: ConductorDef): { bestDist: number; worstDist: number; bestAir: number; worstAir: number } {
  const L = line(c.line);
  const target = L.allStops[c.stop].s;
  let t0 = -1;
  for (let t = 0; t < DAY_TICKS * 2 && t0 < 0; t++) {
    vehicleAt(L, 0, t, VS);
    const standing = Math.abs(VS.s - target) < 0.05 && Math.hypot(VS.vx, VS.vz) < 0.01;
    const active = VS.active;
    vehicleAt(L, 0, t + 1, VS);
    if (standing && active && Math.hypot(VS.vx, VS.vz) > 0.01) t0 = t - 60;
  }
  expect(t0, `${c.line} leaves its conductor's stop`).toBeGreaterThan(0);
  const m = { bestDist: 0, worstDist: Infinity, bestAir: 0, worstAir: Infinity };
  for (let ride = 60; ride <= 900; ride += 15) {
    for (const hop of [false, true]) {
      resetFeel();
      const sim = new Sim(W, { seed: 1, startDayFrac: 0 });
      sim.tick = t0;
      vehicleAt(L, 0, sim.tick, VS);
      grabPoint(L, VS, GP);
      placePlayer(W, sim.player, GP.x - VS.hx * 0.5, GP.z - VS.hz * 0.5, Math.atan2(VS.hx, VS.hz));
      const p = sim.player;
      const needHop = GP.y - (p.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.8;
      for (let i = 0; i < 400 && p.mode !== Mode.HITCH; i++) sim.step({ steer: 0, hold: true, hop: needHop && i % 40 === 0 });
      if (p.mode !== Mode.HITCH) continue;
      let ok = true;
      for (let i = 0; i < ride && ok; i++) {
        sim.step({ steer: clamp(p.omega * 2, -1, 1), hold: true, hop: false });
        ok = p.mode === Mode.HITCH;
      }
      if (!ok) continue;
      sim.step({ steer: 0, hold: hop, hop });
      if (hop) sim.step({ steer: 0, hold: false, hop: false });
      const rx = p.x;
      const rz = p.z;
      let air = 0;
      while ((p.mode as Mode) === Mode.AIR && air < 1200) {
        sim.step({ steer: 0, hold: false, hop: false });
        air++;
      }
      const d = Math.hypot(p.x - rx, p.z - rz);
      m.bestDist = Math.max(m.bestDist, d);
      m.worstDist = Math.min(m.worstDist, d);
      m.bestAir = Math.max(m.bestAir, air / 60);
      m.worstAir = Math.min(m.worstAir, air / 60);
    }
  }
  return m;
}
