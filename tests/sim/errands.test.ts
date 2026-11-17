import { describe, expect, it } from 'vitest';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { ERRANDS } from '../../src/sim/game/content/errands';
import type { ErrandDef, StepDef } from '../../src/sim/game/errands';
import { OFFER_FILL_TICKS } from '../../src/sim/game/errands';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame } from '../../src/sim/types';
import { addRail, addZone, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';
import { compileLine } from '../../src/sim/lines';
import { testLine } from './helpers';

const MIN = 3600;

/** A flat plaza with one test tram circuit, a sloping rail and hand-placed zones. */
function world(): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = [compileLine(testLine({ vehicles: 2 }), 0)];
  w.spawn = { x: 0, z: 0, heading: 0 };
  // A rail falling 4 m over 40 m, along +z, west of the plaza's middle.
  addRail(w, [-60, 4.5, -20, -60, 0.5, 20], 'handrail');
  finalizeWorld(w);
  const zone = (id: string, x: number, z: number, r = 5, y = 0): void => {
    addZone(w, { id, name: id, kind: 'landmark', x, y, z, r });
  };
  zone('giver', 0, 0);
  zone('giver2', -20, -20);
  zone('east', 20, 0);
  // On the tram circuit's far side (the line runs x = -30 from z = 30 down to z = -30).
  zone('far', -30, 0, 6);
  return w;
}

function errand(steps: StepDef[], over: Partial<ErrandDef> = {}): ErrandDef {
  return { id: 'e1', title: 'Test', giver: 'giver', district: 0, brief: 'Do it.', limitTicks: 2 * MIN, steps, ...over };
}

function newGame(w: World, defs: ErrandDef[], startDayFrac = 0.3): Game {
  resetFeel();
  return new Game(w, { seed: 1, startDayFrac, errands: defs, conductors: [] });
}

interface Log {
  events: GameEvent[];
}

function step(game: Game, log: Log, input: Partial<InputFrame> = {}, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.step({ steer: input.steer ?? 0, hold: input.hold ?? false, hop: input.hop ?? false });
    for (const e of game.events) log.events.push(e);
  }
}

const types = (log: Log): string[] => log.events.filter((e) => e.type.startsWith('errand')).map((e) => e.type);

/** Hold still in the giver's zone until the errand starts. */
function accept(game: Game, log: Log): void {
  const p = game.sim.player;
  placePlayer(game.sim.world, p, 0, 0, 0);
  step(game, log, { hold: true }, OFFER_FILL_TICKS + 2);
  expect(game.errands.active, 'errand accepted').not.toBeNull();
  step(game, log, {}, 1);
}

function teleport(game: Game, x: number, z: number, speed = 0, heading = 0): void {
  placePlayer(game.sim.world, game.sim.player, x, z, heading);
  game.sim.player.speed = speed;
}

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };

/** Put the skater just behind vehicle `veh`'s bumper as it runs up the circuit's first side, and hold until hitched. */
function catchTram(game: Game, log: Log, veh = 0, chain: { links: number; line: number; veh: number } | null = null): void {
  const sim = game.sim;
  const L = sim.world.lines[0];
  const day = Math.floor(sim.tick / DAY_TICKS) * DAY_TICKS;
  let t = day;
  for (; t < day + DAY_TICKS; t++) {
    vehicleAt(L, veh, t, VS);
    if (VS.active && VS.x > 29 && VS.z > -14 && VS.z < -12 && VS.vz > 3) break;
  }
  sim.tick = t;
  grabPoint(L, VS, GP);
  placePlayer(sim.world, sim.player, GP.x - VS.hx * 0.5, GP.z - VS.hz * 0.5, 0);
  if (chain) {
    // Scripted: arrive as if slung off another ride, the chain still alive.
    const p = sim.player;
    p.chain = chain.links;
    p.chainAlive = 1;
    p.lastLine = chain.line;
    p.lastVeh = chain.veh;
  }
  for (let i = 0; i < 30 && sim.player.mode !== Mode.HITCH; i++) step(game, log, { hold: true });
  expect(sim.player.mode).toBe(Mode.HITCH);
}

describe('hold to accept', () => {
  it('an offer appears in the giver zone and fills over 0.6 s of holding still, then starts', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }])]);
    const log: Log = { events: [] };
    teleport(game, 0, 0);
    step(game, log);
    expect(game.errands.offered).toBe('e1');
    expect(game.errands.offerFill).toBe(0);
    step(game, log, { hold: true }, OFFER_FILL_TICKS / 2);
    expect(game.errands.offerFill).toBeGreaterThan(0.4);
    expect(game.errands.offerFill).toBeLessThan(0.6);
    expect(game.errands.active).toBeNull();
    step(game, log, { hold: true }, OFFER_FILL_TICKS / 2);
    expect(game.errands.active?.id).toBe('e1');
    expect(types(log)).toEqual(['errandOffer', 'errandStart']);
  });

  it('releasing the touch empties the fill; rolling out of the zone withdraws the offer', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }])]);
    const log: Log = { events: [] };
    teleport(game, 0, 0);
    step(game, log, { hold: true }, 20);
    expect(game.errands.offerFill).toBeGreaterThan(0.5);
    step(game, log, { hold: false });
    expect(game.errands.offerFill).toBe(0);
    step(game, log, { hold: true }, 20);
    teleport(game, 8, 0);
    step(game, log, { hold: true });
    expect(game.errands.offered).toBeNull();
    expect(game.errands.offerFill).toBe(0);
    step(game, log, { hold: true }, 60);
    expect(game.errands.active).toBeNull();
    expect(types(log)).toEqual(['errandOffer']);
  });

  it('does not fill while rolling fast, while hitched, or with a ride in reach', () => {
    // Fast: rolling through the zone at 7 m/s.
    const fast = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }])]);
    const log: Log = { events: [] };
    teleport(fast, 0, -4, 7);
    step(fast, log, { hold: true }, 8);
    expect(fast.errands.offered).toBe('e1');
    expect(fast.errands.offerFill).toBe(0);

    // Hitched: a giver zone on the tram's path; riding through it offers nothing.
    const w = world();
    addZone(w, { id: 'onLine', name: 'onLine', kind: 'landmark', x: 30, y: 0, z: 0, r: 8 });
    const hitched = newGame(w, [errand([{ kind: 'reach', zone: 'east' }], { giver: 'onLine' })]);
    const hl: Log = { events: [] };
    catchTram(hitched, hl);
    for (let i = 0; i < 300; i++) {
      step(hitched, hl, { hold: true });
      expect(hitched.errands.offered).toBeNull();
    }
    expect(hitched.errands.active).toBeNull();

    // A ride in reach: standing at the tram's stop as it waits there, the hold is for the tram.
    const w2 = world();
    addZone(w2, { id: 'atStop', name: 'atStop', kind: 'landmark', x: 30, y: 0, z: -30, r: 8 });
    const reach = newGame(w2, [errand([{ kind: 'reach', zone: 'east' }], { giver: 'atStop' })]);
    const rl: Log = { events: [] };
    const L = reach.sim.world.lines[0];
    // A tick when vehicle 0 is about to stand at the terminus (30, -30).
    for (let t = 0; t < DAY_TICKS; t++) {
      vehicleAt(L, 0, t, VS);
      if (VS.active && Math.abs(VS.z + 30) < 0.01 && VS.vx === 0 && VS.vz === 0) {
        reach.sim.tick = t;
        break;
      }
    }
    vehicleAt(L, 0, reach.sim.tick, VS);
    grabPoint(L, VS, GP);
    // Beside and ahead of the bumper: in reach, but not grabbable from in front of it.
    teleport(reach, GP.x - 2.2, GP.z + 2.5);
    step(reach, rl, { hold: true }, 2);
    expect(reach.errands.offered).toBe('e1');
    expect(reach.errands.offerFill).toBe(0);
  });

  it('nothing is offered while another errand is active, or outside the errand hours', () => {
    const defs = [
      errand([{ kind: 'reach', zone: 'east' }]),
      errand([{ kind: 'reach', zone: 'east' }], { id: 'e2', giver: 'giver2' }),
      errand([{ kind: 'reach', zone: 'east' }], { id: 'late', giver: 'giver2', hours: [0.5, 0.6] }),
    ];
    const game = newGame(world(), defs);
    const log: Log = { events: [] };
    accept(game, log);
    teleport(game, -20, -20);
    step(game, log, { hold: true }, 60);
    expect(game.errands.offered).toBeNull();
    expect(game.errands.active?.id).toBe('e1');

    // Hours: only the all-day errand is offered at 0.3; at 0.55 the first open one in the list.
    const timed = newGame(world(), [defs[2]]);
    const tl: Log = { events: [] };
    teleport(timed, -20, -20);
    step(timed, tl, { hold: true }, 60);
    expect(timed.errands.offered).toBeNull();
    timed.sim.setDayFrac(0.55);
    step(timed, tl, { hold: true }, OFFER_FILL_TICKS + 2);
    expect(timed.errands.active?.id).toBe('late');
  });

  it('after an errand starts the touch must lift before anything else can fill', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'giver' }])]);
    const log: Log = { events: [] };
    teleport(game, 0, 0);
    // Accept, finish at once (the target is the giver zone), keep holding: no second start.
    step(game, log, { hold: true }, OFFER_FILL_TICKS + 120);
    expect(types(log)).toEqual(['errandOffer', 'errandStart', 'errandStep', 'errandDone', 'errandOffer']);
    step(game, log, { hold: false });
    step(game, log, { hold: true }, OFFER_FILL_TICKS + 1);
    expect(types(log).filter((t) => t === 'errandStart').length).toBe(2);
  });
});

describe('steps', () => {
  it('reach completes on entering the zone (plan radius and height), not before', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }])]);
    const log: Log = { events: [] };
    accept(game, log);
    teleport(game, 14, 0);
    step(game, log, {}, 5);
    expect(game.errands.active?.step).toBe(0);
    // Right place, but 6 m above it: not there.
    teleport(game, 20, 0);
    game.sim.player.mode = Mode.AIR;
    game.sim.player.y = 6;
    game.sim.player.vy = 0;
    step(game, log);
    expect(game.errands.active?.step).toBe(0);
    teleport(game, 20, 0);
    step(game, log);
    expect(game.errands.active).toBeNull();
    expect(types(log).slice(-2)).toEqual(['errandStep', 'errandDone']);
  });

  it('hitch completes on catching that line', () => {
    const w = world();
    const game = newGame(w, [errand([{ kind: 'hitch', line: 'X1' }])]);
    const log: Log = { events: [] };
    accept(game, log);
    step(game, log, {}, 30);
    expect(game.errands.active?.step).toBe(0);
    catchTram(game, log);
    step(game, log, { hold: true });
    expect(types(log).slice(-2)).toEqual(['errandStep', 'errandDone']);
  });

  it('rideTo completes arriving hitched, or within 3 s of letting go, not later and not unhitched', () => {
    // Hitched all the way round to the far side.
    const a = newGame(world(), [errand([{ kind: 'rideTo', line: 'X1', zone: 'far' }], { limitTicks: 4 * MIN })]);
    const al: Log = { events: [] };
    accept(a, al);
    catchTram(a, al);
    let ticks = 0;
    while (a.errands.active && ticks < 3000) {
      step(a, al, { hold: true });
      ticks++;
      if (a.errands.active) expect(Math.hypot(a.sim.player.x + 30, a.sim.player.z)).toBeGreaterThan(5.9);
    }
    expect(types(al).slice(-1)).toEqual(['errandDone']);

    // Let go, then be put in the zone 2 s later: counts. 4 s later: does not.
    for (const [delay, done] of [
      [120, true],
      [240, false],
    ] as const) {
      const g = newGame(world(), [errand([{ kind: 'rideTo', line: 'X1', zone: 'far' }])]);
      const gl: Log = { events: [] };
      accept(g, gl);
      catchTram(g, gl);
      step(g, gl, { hold: true }, 40);
      step(g, gl, { hold: false });
      expect(gl.events.length).toBeGreaterThan(0);
      step(g, gl, {}, delay - 1);
      teleport(g, -30, 0);
      step(g, gl);
      expect(g.errands.active === null, `delay ${delay}`).toBe(done);
    }

    // Walking into the zone without the ride: nothing.
    const c = newGame(world(), [errand([{ kind: 'rideTo', line: 'X1', zone: 'far' }])]);
    const cl: Log = { events: [] };
    accept(c, cl);
    teleport(c, -30, 0);
    step(c, cl, {}, 30);
    expect(c.errands.active?.step).toBe(0);
  });

  it('deliver needs the ground and, with maxSpeed, a slow arrival', () => {
    const game = newGame(world(), [errand([{ kind: 'deliver', zone: 'east', maxSpeed: 3 }])]);
    const log: Log = { events: [] };
    accept(game, log);
    teleport(game, 18, 0, 6, Math.PI / 2);
    step(game, log);
    expect(game.errands.active?.step).toBe(0);
    teleport(game, 20, 0, 1);
    game.sim.player.mode = Mode.AIR;
    game.sim.player.y = 1.5;
    step(game, log);
    expect(game.errands.active?.step).toBe(0);
    teleport(game, 20, 0, 1);
    step(game, log);
    expect(types(log).slice(-1)).toEqual(['errandDone']);
  });

  it('chain completes when the chain reaches that many links', () => {
    const game = newGame(world(), [errand([{ kind: 'chain', links: 2 }], { limitTicks: 4 * MIN })]);
    const log: Log = { events: [] };
    accept(game, log);
    // First link: vehicle 0.
    catchTram(game, log, 0);
    step(game, log, { hold: true }, 60);
    expect(game.errands.active?.step).toBe(0);
    expect(game.errands.active?.progress).toBe(1);
    // Let go: the chain is alive in the air.
    step(game, log, { hold: false });
    const p = game.sim.player;
    expect(p.chainAlive).toBe(1);
    expect(game.errands.active?.step).toBe(0);
    // Catch the other tram while it is still alive.
    catchTram(game, log, 1, { links: 1, line: 0, veh: 0 });
    expect(p.chain).toBe(2);
    step(game, log, { hold: true });
    expect(types(log).slice(-1)).toEqual(['errandDone']);
  });

  it('grind counts metres along rails since the step began', () => {
    const game = newGame(world(), [errand([{ kind: 'grind', metres: 20 }])]);
    const log: Log = { events: [] };
    accept(game, log);
    // Drop onto the sloping rail along it.
    teleport(game, -60, -19);
    const p = game.sim.player;
    p.mode = Mode.AIR;
    p.y = 4.9;
    p.vy = 0;
    p.vz = 6;
    p.vx = 0;
    p.heading = 0;
    let grindTicks = 0;
    let doneAtZ = Number.NaN;
    for (let i = 0; i < 600 && game.errands.active; i++) {
      step(game, log);
      if ((p.mode as Mode) === Mode.GRIND) grindTicks++;
      if (!game.errands.active) doneAtZ = p.z;
    }
    expect(grindTicks).toBeGreaterThan(30);
    expect(types(log).slice(-1)).toEqual(['errandDone']);
    // 20 m along the rail from where it was joined, give or take a step.
    expect(doneAtZ).toBeGreaterThan(-19 + 18);
    expect(doneAtZ).toBeLessThan(-19 + 23);
  });

  it('air needs one flight of that length, not several short ones', () => {
    const game = newGame(world(), [errand([{ kind: 'air', seconds: 1 }])]);
    const log: Log = { events: [] };
    accept(game, log);
    const p = game.sim.player;
    // Three hops: each well under a second.
    for (let k = 0; k < 3; k++) {
      step(game, log, { hop: true });
      step(game, log, {}, 70);
    }
    expect(game.errands.active?.step).toBe(0);
    expect(game.errands.active?.progress).toBeGreaterThan(0.2);
    expect(game.errands.active?.progress).toBeLessThan(1);
    // A drop from 13 m: about 1.14 s in the air (gravity is 20 m/s^2).
    teleport(game, 0, 10);
    p.mode = Mode.AIR;
    p.y = 13;
    p.vy = 0;
    step(game, log, {}, 55);
    expect(game.errands.active?.step).toBe(0);
    step(game, log, {}, 10);
    expect(types(log).slice(-1)).toEqual(['errandDone']);
  });
});

describe('failing', () => {
  it('the time limit fails the errand', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }], { limitTicks: 2 * MIN })]);
    const log: Log = { events: [] };
    accept(game, log);
    const left = game.errands.active?.ticksLeft ?? 0;
    expect(left).toBeGreaterThan(2 * MIN - 10);
    step(game, log, {}, left - 1);
    expect(game.errands.active).not.toBeNull();
    step(game, log, {}, 1);
    expect(game.errands.active).toBeNull();
    expect(log.events.slice(-1)).toEqual([{ type: 'errandFail', id: 'e1', reason: 'time' }]);
    expect(game.errands.failedLast).toEqual({ id: 'e1', reason: 'time' });
  });

  it('noBail fails on a bail; without it a bail is fine', () => {
    for (const noBail of [true, false]) {
      const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east', noBail }])]);
      const log: Log = { events: [] };
      accept(game, log);
      // A hard landing from a big drop.
      const p = game.sim.player;
      teleport(game, -10, 10);
      p.mode = Mode.AIR;
      p.y = 1;
      p.vy = -26;
      step(game, log, {}, 3);
      expect(log.events.length).toBeGreaterThan(0);
      expect(game.sim.player.mode).toBe(Mode.BAIL);
      if (noBail) expect(log.events.slice(-1)).toEqual([{ type: 'errandFail', id: 'e1', reason: 'bail' }]);
      else expect(game.errands.active).not.toBeNull();
    }
  });

  it('noGround fails after that much rolling since the step began; air time does not count', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }, { kind: 'reach', zone: 'far', noGround: 1 }], { limitTicks: 4 * MIN })]);
    const log: Log = { events: [] };
    accept(game, log);
    // Rolling for the whole first step does not count against the second.
    step(game, log, {}, 200);
    teleport(game, 20, 0);
    step(game, log);
    expect(game.errands.active?.step).toBe(1);
    // Half a second on the ground, then a drop from 8 m: about 0.9 s in the air, which does not count.
    step(game, log, {}, 30);
    const p = game.sim.player;
    p.mode = Mode.AIR;
    p.y = 8;
    p.vy = 0;
    step(game, log, {}, 50);
    expect(p.mode).toBe(Mode.AIR);
    expect(game.errands.active?.step).toBe(1);
    teleport(game, 20, 0);
    step(game, log, {}, 27);
    expect(game.errands.active).not.toBeNull();
    step(game, log, {}, 4);
    expect(log.events.slice(-1)).toEqual([{ type: 'errandFail', id: 'e1', reason: 'ground' }]);
  });

  it('errandAbandon gives the errand up (its event comes with the next step)', () => {
    const game = newGame(world(), [errand([{ kind: 'reach', zone: 'east' }])]);
    const log: Log = { events: [] };
    expect(game.errandAbandon().ok).toBe(false);
    accept(game, log);
    expect(game.errandAbandon().ok).toBe(true);
    expect(game.errands.active).toBeNull();
    step(game, log);
    expect(log.events.filter((e) => e.type === 'errandFail')).toEqual([{ type: 'errandFail', id: 'e1', reason: 'abandon' }]);
  });
});

describe('records and saves', () => {
  it('events fire once each, in order, and the best time only improves', () => {
    const def = errand([{ kind: 'reach', zone: 'east' }, { kind: 'reach', zone: 'giver2' }]);
    const game = newGame(world(), [def]);
    const log: Log = { events: [] };
    const run = (wait: number): void => {
      accept(game, log);
      step(game, log, {}, wait);
      teleport(game, 20, 0);
      step(game, log);
      teleport(game, -20, -20);
      step(game, log);
      step(game, log, {}, 2);
    };
    run(100);
    const first = game.errands.done.e1.bestTicks;
    expect(types(log)).toEqual(['errandOffer', 'errandStart', 'errandStep', 'errandStep', 'errandDone']);
    expect(log.events.filter((e) => e.type === 'errandStep').map((e) => (e.type === 'errandStep' ? e.step : -1))).toEqual([0, 1]);
    const done1 = log.events.find((e) => e.type === 'errandDone');
    expect(done1).toEqual({ type: 'errandDone', id: 'e1', ticks: first, best: true });
    // Slower: the best stays.
    log.events.length = 0;
    run(300);
    expect(game.errands.done.e1.bestTicks).toBe(first);
    expect(log.events.find((e) => e.type === 'errandDone')).toMatchObject({ best: false });
    // Faster: improves.
    log.events.length = 0;
    run(10);
    expect(game.errands.done.e1.bestTicks).toBeLessThan(first);
    expect(log.events.find((e) => e.type === 'errandDone')).toMatchObject({ best: true });
  });

  it('done errands and best times round-trip through export/import; an active errand is dropped', () => {
    const def = errand([{ kind: 'reach', zone: 'east' }]);
    const w = world();
    const game = newGame(w, [def, errand([{ kind: 'reach', zone: 'east' }], { id: 'e2', giver: 'giver2' })]);
    const log: Log = { events: [] };
    accept(game, log);
    teleport(game, 20, 0);
    step(game, log);
    const saved = JSON.parse(JSON.stringify(game.errandsReducer.exportState()));
    accept(game, log);
    expect(game.errands.active).not.toBeNull();

    const other = newGame(w, [def, errand([{ kind: 'reach', zone: 'east' }], { id: 'e2', giver: 'giver2' })]);
    other.errandsReducer.importState(saved);
    expect(other.errands.done).toEqual(game.errands.done);
    game.errandsReducer.importState(saved);
    expect(game.errands.active).toBeNull();
    // Junk leaves it fresh rather than throwing; unknown ids and bad times are ignored.
    other.errandsReducer.importState({ v: 1, done: { e1: -4, nope: 100, e2: 'x' } });
    expect(other.errands.done).toEqual({});
    other.errandsReducer.importState('garbage');
    expect(other.errands.done).toEqual({});
  });

  it('two games fed the same inputs stay identical', () => {
    const defs = [errand([{ kind: 'reach', zone: 'east' }, { kind: 'rideTo', line: 'X1', zone: 'far' }], { limitTicks: 4 * MIN })];
    const play = (): { hash: number; events: string } => {
      const g = newGame(world(), defs);
      const log: Log = { events: [] };
      for (let i = 0; i < 3000; i++) {
        step(g, log, { steer: Math.round(Math.sin(i / 23) * 31) / 31, hold: i % 400 < 250, hop: i % 333 === 0 });
      }
      return { hash: g.sim.hash(), events: JSON.stringify(log.events) + JSON.stringify(g.errands) };
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
  });

  it('the city content is valid data: unique ids, a giver, steps, briefs under 60 characters', () => {
    const ids = new Set(ERRANDS.map((e) => e.id));
    expect(ids.size).toBe(ERRANDS.length);
    for (const e of ERRANDS) {
      expect(e.steps.length).toBeGreaterThan(0);
      expect(e.brief.length).toBeLessThan(60);
    }
  });
});
