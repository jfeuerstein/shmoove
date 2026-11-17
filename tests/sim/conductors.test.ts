import { describe, expect, it } from 'vitest';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { CONDUCTORS } from '../../src/sim/game/content/conductors';
import type { ConductorDef, ConductorTask } from '../../src/sim/game/conductors';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { compileLine, grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame } from '../../src/sim/types';
import { addZone, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';
import { testLine } from './helpers';

/**
 * A flat plaza with the test tram circuit (60 m square, anticlockwise from (30, -30), two trams)
 * and its stops at the middle of each side, plus a second line far away on another circuit.
 */
function world(stops = [
  { s: 30, name: 'East' },
  { s: 90, name: 'North' },
  { s: 150, name: 'West' },
  { s: 210, name: 'South' },
]): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = [
    compileLine(testLine({ vehicles: 2, stops }), 0),
    compileLine(testLine({ id: 'X2', path: [80, 0, -80, 80, 0, -40, 50, 0, -40, 50, 0, -80, 80, 0, -80] }), 1),
  ];
  w.spawn = { x: 0, z: 0, heading: 0 };
  finalizeWorld(w);
  const at = [
    [30, -30],
    [30, 0],
    [0, 30],
    [-30, 0],
    [0, -30],
  ];
  at.forEach(([x, z], k) => addZone(w, { id: `stop_X1_${k}`, name: `stop ${k}`, kind: 'stop', x, y: 0, z, r: 6 }));
  addZone(w, { id: 'pad', name: 'pad', kind: 'landmark', x: 60, y: 0, z: 40, r: 5 });
  // Another line's stop zone lying across X1's east side, where X1 itself has no stop when the
  // world is built without its East stop.
  addZone(w, { id: 'stop_X2_1', name: 'X2 stop on the tram tracks', kind: 'stop', x: 30, y: 0, z: 10, r: 6 });
  return w;
}

interface Log {
  events: GameEvent[];
}

function newGame(task: ConductorTask, stop = 0, extra: ConductorDef[] = [], w: World = world()): Game {
  resetFeel();
  return new Game(w, { seed: 1, startDayFrac: 0.3, errands: [], conductors: [{ line: 'X1', stop, task }, ...extra] });
}

function step(game: Game, log: Log, input: Partial<InputFrame> = {}, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.step({ steer: input.steer ?? 0, hold: input.hold ?? false, hop: input.hop ?? false });
    for (const e of game.events) log.events.push(e);
  }
}

const kinds = (log: Log): string[] => log.events.filter((e) => e.type.startsWith('conductor')).map((e) => e.type);

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };

/**
 * Put the skater just behind a vehicle's bumper as it passes plan point (x, z) going along +z
 * (east side) or -z (west side), and hold until hitched. `chain` arrives as if slung off another ride.
 */
function catchAt(game: Game, log: Log, li: number, veh: number, x: number, z: number, chain: { links: number; line: number; veh: number } | null = null): void {
  const sim = game.sim;
  const L = sim.world.lines[li];
  const day = Math.floor(sim.tick / DAY_TICKS) * DAY_TICKS + DAY_TICKS;
  let t = day;
  for (; t < day + DAY_TICKS; t++) {
    vehicleAt(L, veh, t, VS);
    if (VS.active && Math.abs(VS.x - x) < 1.5 && Math.abs(VS.z - z) < 0.2 && Math.hypot(VS.vx, VS.vz) > 3) break;
  }
  if (t === day + DAY_TICKS) throw new Error('vehicle never passes');
  sim.tick = t;
  grabPoint(L, VS, GP);
  placePlayer(sim.world, sim.player, GP.x - VS.hx * 0.5, GP.z - VS.hz * 0.5, Math.atan2(VS.hx, VS.hz));
  if (chain) {
    const p = sim.player;
    p.chain = chain.links;
    p.chainAlive = 1;
    p.lastLine = chain.line;
    p.lastVeh = chain.veh;
  }
  for (let i = 0; i < 30 && sim.player.mode !== Mode.HITCH; i++) step(game, log, { hold: true });
  expect(sim.player.mode).toBe(Mode.HITCH);
  expect(sim.player.hLine).toBe(li);
}

/** Catch tram `veh` of X1 17 m past its terminus (conductor stop 0 at (30, -30)). */
const catchNear = (game: Game, log: Log, veh = 0, chain: { links: number; line: number; veh: number } | null = null): void =>
  catchAt(game, log, 0, veh, 30, -13, chain);

/** Ride, then let go; returns once the skater touches down (or `max` ticks). */
function releaseAndLand(game: Game, log: Log, max = 600): void {
  step(game, log, { hold: false });
  for (let i = 0; i < max && game.sim.player.mode === Mode.AIR; i++) step(game, log);
}

describe('starting', () => {
  it('hitching the line within 30 m of the conductor stop starts it; farther away, or another line, does not', () => {
    const game = newGame({ kind: 'stayOn', segments: 2 }, 0, [{ line: 'X2', stop: 0, task: { kind: 'stayOn', segments: 1 } }]);
    const log: Log = { events: [] };
    // About 35 m from the terminus: too far.
    catchAt(game, log, 0, 0, 30, 10);
    expect(game.conductors.active).toBeNull();
    step(game, log, { hold: false }, 120);
    expect(kinds(log)).toEqual([]);
    // Another line's hitch starts that line's conductor, not X1's.
    catchAt(game, log, 1, 0, 80, -70);
    expect(game.conductors.active?.line).toBe(1);
    step(game, log, { hold: false }, 120);
    log.events.length = 0;
    catchNear(game, log);
    expect(kinds(log)).toEqual(['conductorStart']);
    expect(log.events.find((e) => e.type === 'conductorStart')).toEqual({ type: 'conductorStart', line: 0 });
    expect(game.conductors.active).toMatchObject({ line: 0, kind: 'stayOn', goal: 2 });
  });

  it('a punched line never restarts', () => {
    const game = newGame({ kind: 'slingAir', seconds: 0.2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    step(game, log, { hold: true }, 30);
    releaseAndLand(game, log);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
    expect(game.conductors.punched).toEqual({ X1: true });
    step(game, log, {}, 60);
    catchNear(game, log, 1);
    step(game, log, { hold: true }, 30);
    releaseAndLand(game, log);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
    expect(game.conductors.active).toBeNull();
  });
});

describe('challenge types', () => {
  it('chainFrom: punches when the chain from this hitch reaches N; fails silently when it ends, and can be retried', () => {
    const game = newGame({ kind: 'chainFrom', links: 2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    step(game, log, { hold: true }, 20);
    // Let go and land: the chain ends.
    releaseAndLand(game, log);
    step(game, log, {}, 60);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorFail']);
    expect(game.conductors.active).toBeNull();
    // Retry: catch, let go, catch the other tram while the chain lives.
    log.events.length = 0;
    catchNear(game, log, 0);
    expect(game.conductors.active?.progress).toBe(1);
    step(game, log, { hold: true }, 20);
    step(game, log, { hold: false });
    expect(game.sim.player.chainAlive).toBe(1);
    expect(kinds(log)).toEqual(['conductorStart']);
    catchAt(game, log, 0, 1, 30, 10, { links: 1, line: 0, veh: 0 });
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
  });

  it('chainFrom: when the conductor hitch is already link 2 of a chain, progress counts from that hitch (link 2 shows 1) and links: 2 punches only at chain 3', () => {
    const game = newGame({ kind: 'chainFrom', links: 2 });
    const log: Log = { events: [] };
    // Arrive slung off line X2: this catch is link 2 of the chain.
    catchNear(game, log, 0, { links: 1, line: 1, veh: 0 });
    expect(game.sim.player.chain).toBe(2);
    expect(kinds(log)).toEqual(['conductorStart']);
    expect(game.conductors.active?.progress).toBe(1);
    step(game, log, { hold: true }, 20);
    expect(kinds(log)).toEqual(['conductorStart']);
    step(game, log, { hold: false });
    expect(game.sim.player.chainAlive).toBe(1);
    expect(kinds(log)).toEqual(['conductorStart']);
    // The other tram: chain 3, the second link counted from the conductor's hitch.
    catchAt(game, log, 0, 1, 30, 10, { links: 2, line: 0, veh: 0 });
    expect(game.sim.player.chain).toBe(3);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
  });

  it('slingDistance: plan distance from the release to the first touch down', () => {
    for (const [metres, result] of [
      [2, 'conductorPunch'],
      [40, 'conductorFail'],
    ] as const) {
      const game = newGame({ kind: 'slingDistance', metres });
      const log: Log = { events: [] };
      catchNear(game, log);
      step(game, log, { hold: true }, 30);
      const p = game.sim.player;
      step(game, log, { hold: false });
      const rx = p.x;
      const rz = p.z;
      expect(kinds(log)).toEqual(['conductorStart']);
      for (let i = 0; i < 600 && p.mode === Mode.AIR; i++) step(game, log);
      const flown = Math.hypot(p.x - rx, p.z - rz);
      expect(flown).toBeGreaterThan(2);
      expect(flown).toBeLessThan(40);
      expect(kinds(log)).toEqual(['conductorStart', result]);
    }
  });

  it('slingDistance: a flight that ends in a bail fails, however far it went', () => {
    const game = newGame({ kind: 'slingDistance', metres: 2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    step(game, log, { hold: true }, 30);
    const p = game.sim.player;
    step(game, log, { hold: false });
    const rx = p.x;
    const rz = p.z;
    for (let i = 0; i < 600 && p.mode === Mode.AIR && Math.hypot(p.x - rx, p.z - rz) < 2.2; i++) step(game, log);
    expect(p.mode).toBe(Mode.AIR);
    expect(Math.hypot(p.x - rx, p.z - rz)).toBeGreaterThan(2);
    // Slam into the ground.
    p.y = 1;
    p.vy = -26;
    step(game, log, {}, 3);
    expect(p.mode).toBe(Mode.BAIL);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorFail']);
  });

  it('slingAir: time from the release to the first touch down', () => {
    for (const [seconds, result] of [
      [0.25, 'conductorPunch'],
      [2, 'conductorFail'],
    ] as const) {
      const game = newGame({ kind: 'slingAir', seconds });
      const log: Log = { events: [] };
      catchNear(game, log);
      step(game, log, { hold: true }, 30);
      step(game, log, { hold: false });
      let air = 0;
      while (game.sim.player.mode === Mode.AIR && air < 600) {
        step(game, log);
        air++;
      }
      expect(air / 60).toBeGreaterThan(0.25);
      expect(air / 60).toBeLessThan(2);
      expect(kinds(log)).toEqual(['conductorStart', result]);
    }
  });

  it('stayOn: punches after N stops on one vehicle; letting go first fails', () => {
    const game = newGame({ kind: 'stayOn', segments: 2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    // Ride through the first stop only.
    let i = 0;
    while (game.conductors.active && game.conductors.active.progress < 1 && i++ < 2000) step(game, log, { hold: true });
    expect(game.conductors.active?.progress).toBe(1);
    step(game, log, { hold: true }, 120);
    expect(kinds(log)).toEqual(['conductorStart']);
    step(game, log, { hold: false }, 120);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorFail']);
    // Again, all the way.
    log.events.length = 0;
    catchNear(game, log);
    for (i = 0; i < 3000 && game.conductors.active; i++) step(game, log, { hold: true });
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
    // The punch came at the second stop (North, at (0, 30)): the tram stands there.
    vehicleAt(game.sim.world.lines[0], game.sim.player.hVeh, game.sim.tick, VS);
    expect(Math.hypot(VS.x, VS.z - 30)).toBeLessThan(0.1);
  });

  it('stayOn: a stop counts only when the vehicle stands at one of its own line\'s stops; rolling through a stop zone does not count', () => {
    // X1 with only the North stop: on the way there the tram rolls through stop_X2_1 at (30, 10).
    const w = world([{ s: 90, name: 'North' }]);
    const game = newGame({ kind: 'stayOn', segments: 1 }, 0, [], w);
    const log: Log = { events: [] };
    catchNear(game, log);
    const zx = w.zones.find((z) => z.id === 'stop_X2_1');
    expect(zx).toBeDefined();
    const L = game.sim.world.lines[0];
    let through = 0;
    for (let i = 0; i < 3000 && game.conductors.active; i++) {
      step(game, log, { hold: true });
      vehicleAt(L, game.sim.player.hVeh, game.sim.tick, VS);
      if (Math.hypot(VS.x - 30, VS.z - 10) < 6) {
        through++;
        expect(game.conductors.active?.progress, 'rolling through a stop zone').toBe(0);
      }
    }
    expect(through).toBeGreaterThan(10);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorPunch']);
    // The punch came at North (0, 30), where the tram stands.
    expect(Math.hypot(VS.x, VS.z - 30)).toBeLessThan(0.1);
  });

  it('stopToStop: let go inside the from stop, reach the to stop on your own, in time', () => {
    const task: ConductorTask = { kind: 'stopToStop', from: 1, to: 3, seconds: 5 };
    /** Ride until the skater is inside the East stop zone (30, 0), then let go. */
    const rideToEast = (game: Game, log: Log): void => {
      catchNear(game, log);
      const p = game.sim.player;
      for (let i = 0; i < 600 && Math.hypot(p.x - 30, p.z) > 4; i++) step(game, log, { hold: true });
      step(game, log, { hold: false });
    };
    // In time.
    const a = newGame(task);
    const al: Log = { events: [] };
    rideToEast(a, al);
    step(a, al, {}, 120);
    expect(kinds(al)).toEqual(['conductorStart']);
    placePlayer(a.sim.world, a.sim.player, -30, 0, 0);
    step(a, al);
    expect(kinds(al)).toEqual(['conductorStart', 'conductorPunch']);
    // Too late.
    const b = newGame(task);
    const bl: Log = { events: [] };
    rideToEast(b, bl);
    step(b, bl, {}, 5 * 60 + 2);
    expect(kinds(bl)).toEqual(['conductorStart', 'conductorFail']);
    // Let go in the from stop, then catch another ride: not under your own momentum, fails at once.
    const d = newGame(task);
    const dl: Log = { events: [] };
    rideToEast(d, dl);
    step(d, dl, {}, 10);
    expect(kinds(dl)).toEqual(['conductorStart']);
    catchAt(d, dl, 1, 0, 80, -70);
    expect(kinds(dl)).toEqual(['conductorStart', 'conductorFail']);
    // Let go outside the from stop: fails at once.
    const c = newGame(task);
    const cl: Log = { events: [] };
    catchNear(c, cl);
    step(c, cl, { hold: true }, 30);
    step(c, cl, { hold: false });
    expect(kinds(cl)).toEqual(['conductorStart', 'conductorFail']);
  });

  it('landOn: the next touch down after letting go must be inside the zone', () => {
    for (const onPad of [true, false]) {
      const game = newGame({ kind: 'landOn', zone: 'pad' });
      const log: Log = { events: [] };
      catchNear(game, log);
      step(game, log, { hold: true }, 30);
      step(game, log, { hold: false });
      // Scripted flight: carried over the pad (or short of it) high in the air.
      const p = game.sim.player;
      p.x = onPad ? 60 : 45;
      p.z = 40;
      p.y = 3;
      p.vx = 0;
      p.vz = 0;
      p.vy = 0;
      for (let i = 0; i < 300 && p.mode === Mode.AIR; i++) step(game, log);
      expect(kinds(log)).toEqual(['conductorStart', onPad ? 'conductorPunch' : 'conductorFail']);
    }
  });

  it('a bail fails a running challenge', () => {
    const game = newGame({ kind: 'slingAir', seconds: 0.2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    step(game, log, { hold: true }, 30);
    step(game, log, { hold: false });
    const p = game.sim.player;
    expect(p.mode).toBe(Mode.AIR);
    p.y = 1;
    p.vy = -26;
    step(game, log, {}, 3);
    expect(p.mode).toBe(Mode.BAIL);
    expect(kinds(log)).toEqual(['conductorStart', 'conductorFail']);
  });
});

describe('saves', () => {
  it('punched lines round-trip through export/import; junk leaves it fresh', () => {
    const game = newGame({ kind: 'slingAir', seconds: 0.2 });
    const log: Log = { events: [] };
    catchNear(game, log);
    step(game, log, { hold: true }, 30);
    releaseAndLand(game, log);
    const data = JSON.parse(JSON.stringify(game.conductorsReducer.exportState()));
    const other = newGame({ kind: 'slingAir', seconds: 0.2 });
    other.conductorsReducer.importState(data);
    expect(other.conductors.punched).toEqual({ X1: true });
    other.conductorsReducer.importState({ v: 1, punched: ['Q9', 4] });
    expect(other.conductors.punched).toEqual({});
    other.conductorsReducer.importState(null);
    expect(other.conductors.punched).toEqual({});
  });

  it('the city content has one conductor per regular line, every type used', () => {
    const lines = CONDUCTORS.map((c) => c.line);
    expect(new Set(lines).size).toBe(13);
    expect(lines.sort()).toEqual(['A1', 'A2', 'A3', 'D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4']);
    const types = new Set(CONDUCTORS.map((c) => c.task.kind));
    expect([...types].sort()).toEqual(['chainFrom', 'landOn', 'slingAir', 'slingDistance', 'stayOn', 'stopToStop']);
  });
});
