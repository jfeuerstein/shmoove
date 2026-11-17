import { beforeAll, describe, expect, it } from 'vitest';
import { NEW_GAME_DAY_FRAC } from '../../src/app/newGame';
import { buildCity, type City } from '../../src/sim/city';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { OFFER_FILL_TICKS, type ErrandDef } from '../../src/sim/game/errands';
import { Game, type GameEvent, type GameReducer } from '../../src/sim/game/game';
import {
  CARVE_SHOW_TICKS,
  HINT_LINGER_TICKS,
  LESSON_STEPS,
  LIFT_TICKS,
  MAP_TICKS,
  SCAN_EVERY,
  findCatchable,
  type HintId,
  type OnboardingStep,
} from '../../src/sim/game/onboarding';
import { grabPoint, makeVehicleState, pathAt, vehicleAt, type CompiledLine, type VehicleState } from '../../src/sim/lines';
import { angleDiff, clamp } from '../../src/sim/math';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame, type SimEvent } from '../../src/sim/types';
import { addRail, addZone, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';
import { compileLine } from '../../src/sim/lines';
import { seekWhen, testLine } from './helpers';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };

function reducer(game: Game): GameReducer {
  const r = game.reducers.find((x) => x.key === 'onboarding');
  if (!r) throw new Error('no onboarding reducer');
  return r;
}

/** Mark steps learnt, as a save would. */
function teach(game: Game, steps: OnboardingStep[]): void {
  reducer(game).importState?.({ v: 1, done: steps, complete: false, releases: 0 });
}

interface Run {
  shown: Set<HintId | ''>;
  events: GameEvent[];
}

function step(game: Game, inp: Partial<InputFrame>, log: Run): void {
  game.step({ steer: inp.steer ?? 0, hold: inp.hold ?? false, hop: inp.hop ?? false });
  log.shown.add(game.onboarding.shown);
  for (const e of game.events) log.events.push(e);
}

function steps(game: Game, n: number, inp: (i: number) => Partial<InputFrame> = () => ({})): Run {
  const log: Run = { shown: new Set(), events: [] };
  for (let i = 0; i < n; i++) step(game, inp(i), log);
  return log;
}

const doneOrder = (events: GameEvent[]): string[] => events.flatMap((e) => (e.type === 'hintDone' ? [e.step] : []));

// ---------------------------------------------------------------------------------------------
// A small world: a flat plaza, a test tram circuit (x = 30 going +z), a level handrail and a box
// with a ledge to hop off.

function plaza(lines: Parameters<typeof testLine>[0][] = [{}]): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = lines.map((over, i) => compileLine(testLine({ id: `X${i + 1}`, ...over }), i));
  w.spawn = { x: 0, z: 0, heading: 0 };
  // A level handrail along +z far west of the middle; its run-ins are both ends.
  addRail(w, [-60, 0.9, -10, -60, 0.9, 30], 'handrail');
  finalizeWorld(w);
  addZone(w, { id: 'giver', name: 'giver', kind: 'landmark', x: 0, y: 0, z: 0, r: 5 });
  addZone(w, { id: 'nowhere_near', name: 'far corner', kind: 'landmark', x: 90, y: 0, z: 90, r: 2 });
  return w;
}

function plazaGame(w: World, opts: { hints?: boolean; errands?: ErrandDef[]; frac?: number } = {}): Game {
  resetFeel();
  return new Game(w, { seed: 1, startDayFrac: opts.frac ?? 0.3, hints: opts.hints ?? true, errands: opts.errands ?? [], conductors: [] });
}

/** Put the skater down rolling at `speed`. */
function roll(game: Game, x: number, z: number, heading: number, speed: number): void {
  placePlayer(game.sim.world, game.sim.player, x, z, heading);
  game.sim.player.speed = speed;
}

/** Carve both ways from rest on the plaza (done in about a second). */
const carveInput = (i: number): Partial<InputFrame> => ({ steer: i < 30 ? 0.9 : -0.9 });

describe('each hint shows in its situation, after its prerequisites', () => {
  it('carve: after a second of rolling, until the skater has carved past 0.4 both ways', () => {
    const game = plazaGame(plaza([]));
    roll(game, 0, -40, 0, 7);
    const early = steps(game, CARVE_SHOW_TICKS - 2);
    expect(early.shown.has('carve')).toBe(false);
    const later = steps(game, 10);
    expect(game.onboarding.shown).toBe('carve');
    expect(later.events).toContainEqual({ type: 'hintShow', step: 'carve' });
    // One way only is not a carve.
    steps(game, 40, () => ({ steer: 0.9 }));
    expect(game.onboarding.done.carve).toBe(false);
    const both = steps(game, 40, () => ({ steer: -0.9 }));
    expect(game.onboarding.done.carve).toBe(true);
    expect(doneOrder(both.events)).toEqual(['carve']);
    expect(game.onboarding.shown).toBe('');
  });

  it('carve never shows while the skater stands still', () => {
    const game = plazaGame(plaza([]));
    const run = steps(game, 300);
    expect(run.shown).toEqual(new Set(['']));
  });

  it('hop: only after carve, rolling toward a ledge, stair top or rail; done on a hop', () => {
    const w = plaza([]);
    // Rolling at the handrail's south run-in from 10 m off: a rail ahead.
    const fresh = plazaGame(w);
    roll(fresh, -60, -22, 0, 4);
    const before = steps(fresh, 120);
    expect(before.shown.has('hop')).toBe(false);
    const game = plazaGame(w);
    teach(game, ['carve']);
    roll(game, -60, -22, 0, 4);
    const run = steps(game, SCAN_EVERY + 2);
    expect(game.onboarding.shown).toBe('hop');
    expect(run.events).toContainEqual({ type: 'hintShow', step: 'hop' });
    const hop = steps(game, 2, (i) => ({ hop: i === 0 }));
    expect(doneOrder(hop.events)).toEqual(['hop']);
    expect(game.onboarding.shown).toBe('');
  });

  it('hop does not show rolling across an open plaza', () => {
    const game = plazaGame(plaza([]));
    teach(game, ['carve']);
    roll(game, 20, -60, 0, 6);
    expect(steps(game, 300).shown.has('hop')).toBe(false);
  });

  it('grind: only after hop, near a handrail run-in and heading for it; points at the run-in; done on a grind', () => {
    const w = plaza([]);
    const noHop = plazaGame(w);
    teach(noHop, ['carve']);
    roll(noHop, -60, -16, 0, 4);
    expect(steps(noHop, 60).shown.has('grind')).toBe(false);

    const game = plazaGame(w);
    teach(game, ['carve', 'hop']);
    roll(game, -60, -16, 0, 4);
    steps(game, SCAN_EVERY + 1);
    expect(game.onboarding.shown).toBe('grind');
    expect(game.onboarding.target).toMatchObject({ kind: 'rail', rail: 0, x: -60, z: -10 });
    // Hop onto it.
    const run = steps(game, 90, (i) => ({ hop: i === 30 }));
    expect(run.events.some((e) => e.type === 'hintDone' && e.step === 'grind')).toBe(true);
    expect(game.onboarding.done.grind).toBe(true);
  });

  it('grind does not show rolling away from the rail', () => {
    const game = plazaGame(plaza([]));
    teach(game, ['carve', 'hop']);
    roll(game, -60, -14, Math.PI, 4);
    expect(steps(game, 60).shown.has('grind')).toBe(false);
  });

  it('hitch: only after carve, for a ride coming within 30 m; points at it; done on a hitch', () => {
    const w = plaza();
    const setup = (game: Game): void => {
      // The tram runs up x = 30 (+z); stand beside its lane ahead of it as it comes.
      seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.x - 30) < 0.5 && v.z > -26 && v.z < -25 && v.vz > 1);
      placePlayer(w, game.sim.player, 28, -8, 0);
    };
    const fresh = plazaGame(w);
    setup(fresh);
    expect(steps(fresh, 60).shown.has('hitch')).toBe(false);

    const game = plazaGame(w);
    teach(game, ['carve']);
    setup(game);
    steps(game, SCAN_EVERY + 1);
    expect(game.onboarding.shown).toBe('hitch');
    expect(game.onboarding.target).toMatchObject({ kind: 'vehicle', line: 0, veh: 0 });
    const run = steps(game, 240, () => ({ hold: true }));
    expect(doneOrder(run.events)).toEqual(['hitch']);
    expect(game.sim.player.mode).toBe(Mode.HITCH);
  });

  it('hitch never points at a gated line or a ride out of service', () => {
    for (const over of [{ minChain: 2 }, { windows: [[0.5, 0.6]] as Array<[number, number]> }]) {
      const w = plaza([over]);
      const game = plazaGame(w);
      teach(game, ['carve']);
      // The tram's lap as if it ran: stand ahead of where it would come.
      game.sim.tick = 0;
      placePlayer(w, game.sim.player, 28, -20, 0);
      const run = steps(game, 600);
      expect(run.shown.has('hitch'), JSON.stringify(over)).toBe(false);
    }
  });

  it('sling: after 1.5 s hitched; done by a whip release', () => {
    const w = plaza();
    const game = plazaGame(w);
    teach(game, ['carve']);
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.x - 30) < 0.5 && v.z > -26 && v.z < -25 && v.vz > 1);
    placePlayer(w, game.sim.player, 28, -8, 0);
    let hitchedAt = -1;
    let slingAt = -1;
    for (let i = 0; i < 400 && slingAt < 0; i++) {
      game.step({ steer: 0, hold: true, hop: false });
      if (hitchedAt < 0 && game.sim.player.mode === Mode.HITCH) hitchedAt = i;
      if (game.onboarding.shown === 'sling') slingAt = i;
    }
    expect(hitchedAt).toBeGreaterThanOrEqual(0);
    expect(slingAt - hitchedAt).toBeGreaterThanOrEqual(89);
    expect(slingAt - hitchedAt).toBeLessThanOrEqual(92);
  });
});

// ---------------------------------------------------------------------------------------------
// The sling's whip rule, by feeding the reducer releases at a known ride speed.

describe('the sling counts a real whip, or the second release', () => {
  /** A game hitched-learnt, with the tram cruising at 8 m/s on the straight. */
  function cruising(): Game {
    const game = plazaGame(plaza());
    teach(game, ['carve', 'hop', 'grind', 'hitch']);
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(Math.hypot(v.vx, v.vz) - 8) < 0.01 && Math.abs(v.x - 30) < 0.5);
    return game;
  }
  function release(game: Game, speed: number): void {
    const ev: SimEvent = { type: 'release', line: 0, vehicle: 0, speed, chain: 1, hop: false };
    game.events.length = 0;
    game.sim.events.length = 0;
    game.sim.events.push(ev);
    reducer(game).step(game);
  }

  it('exit at 1.15x the ride speed or more is a whip', () => {
    const game = cruising();
    release(game, 8 * 1.15 + 0.01);
    expect(game.onboarding.done.sling).toBe(true);
    expect(doneOrder(game.events)).toEqual(['sling']);
  });

  it('a plain release asks for a carve first, once; the second release counts regardless', () => {
    const game = cruising();
    release(game, 8 * 1.14);
    expect(game.onboarding.done.sling).toBe(false);
    expect(game.onboarding.slingRetry).toBe(true);
    release(game, 8 * 1.14);
    expect(game.onboarding.done.sling).toBe(true);
    expect(game.onboarding.slingRetry).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Ink, chain, independence, suppression, saves.

describe('ink, the closing tickets, the chain', () => {
  it('after sling, a hitch shows the stop it will ink at; the ink, then map and lift tickets, then complete', () => {
    const w = plaza([{ stops: [{ s: 60, name: 'Esquina' }, { s: 120, name: 'Fondo' }], dwell: 3 }]);
    const game = plazaGame(w);
    teach(game, ['carve', 'hop', 'grind', 'hitch', 'sling']);
    const L = w.lines[0];
    // Arrive at the terminus as the tram waits there, just behind its bumper.
    seekWhen(game.sim, 0, 0, (v) => v.active && v.lapTick === 30);
    vehicleAt(L, 0, game.sim.tick, vs);
    grabPoint(L, vs, gp);
    placePlayer(w, game.sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, Math.atan2(vs.hx, vs.hz));
    const log: Run = { shown: new Set(), events: [] };
    let sawStop = '';
    for (let i = 0; i < 60 * 40 && !game.onboarding.done.ink; i++) {
      step(game, { hold: true }, log);
      if (game.onboarding.shown === 'ink') sawStop = game.onboarding.stopName;
    }
    expect(sawStop).toBe('Esquina');
    expect(game.onboarding.done.ink).toBe(true);
    expect(log.events.some((e) => e.type === 'segmentInked')).toBe(true);
    expect(game.onboarding.shown).toBe('map');
    const map = steps(game, MAP_TICKS - 5, () => ({ hold: true }));
    expect(map.shown).toEqual(new Set(['map']));
    const lift = steps(game, LIFT_TICKS + 10, () => ({ hold: true }));
    expect(lift.shown.has('lift')).toBe(true);
    expect(lift.events).toContainEqual({ type: 'onboardingComplete' });
    expect(game.onboarding.complete).toBe(true);
    // After completion nothing of the lesson shows again.
    const after = steps(game, 600, (i) => ({ hold: i < 300, steer: Math.sin(i / 20) }));
    expect([...after.shown].filter((s) => s !== '' && s !== 'chain')).toEqual([]);
  });

  it('the chain shows after a release with another line close, until a second link or the chain ends', () => {
    const w = plaza([{}, { path: [26, 0, -30, 26, 0, 30, -34, 0, 30, -34, 0, -30, 26, 0, -30] }]);
    const game = plazaGame(w);
    teach(game, ['carve', 'hop', 'grind', 'hitch', 'sling']);
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.x - 30) < 0.5 && v.z > -5 && v.z < 0 && v.vz > 1);
    vehicleAt(w.lines[1], 0, game.sim.tick, vs);
    const p = game.sim.player;
    placePlayer(w, p, vs.x - 3, vs.z, 0);
    p.mode = Mode.AIR;
    p.chain = 1;
    p.chainAlive = 1;
    p.y = 1;
    game.events.length = 0;
    game.sim.events.length = 0;
    game.sim.events.push({ type: 'release', line: 0, vehicle: 0, speed: 10, chain: 1, hop: false });
    reducer(game).step(game);
    expect(game.onboarding.shown).toBe('chain');
    game.events.length = 0;
    game.sim.events.length = 0;
    game.sim.events.push({ type: 'hitch', line: 1, vehicle: 0, chain: 2, newLink: true });
    reducer(game).step(game);
    expect(doneOrder(game.events)).toEqual(['chain']);
    expect(game.onboarding.shown).toBe('');
  });

  it('ignoring the hop and grind hints does not block the hitch, sling or ink', () => {
    const w = plaza([{ stops: [{ s: 60, name: 'Esquina' }], dwell: 3 }]);
    const game = plazaGame(w);
    roll(game, 0, -40, 0, 5);
    steps(game, 70, carveInput);
    expect(game.onboarding.done.carve).toBe(true);
    const L = w.lines[0];
    seekWhen(game.sim, 0, 0, (v) => v.active && v.lapTick === 30);
    vehicleAt(L, 0, game.sim.tick, vs);
    grabPoint(L, vs, gp);
    placePlayer(w, game.sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, Math.atan2(vs.hx, vs.hz));
    const log: Run = { shown: new Set(), events: [] };
    // Hold for 2 s, let go (a release counts toward the sling, the first plain one or a whip).
    for (let i = 0; i < 160; i++) step(game, { hold: i < 140 }, log);
    for (let i = 0; i < 160; i++) step(game, { hold: false }, log);
    if (!game.onboarding.done.sling) {
      // A plain first release: hitch again and let go again.
      seekWhen(game.sim, 0, 0, (v) => v.active && v.lapTick === 30);
      vehicleAt(L, 0, game.sim.tick, vs);
      grabPoint(L, vs, gp);
      placePlayer(w, game.sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, Math.atan2(vs.hx, vs.hz));
      for (let i = 0; i < 160; i++) step(game, { hold: i < 140 }, log);
    }
    expect(game.onboarding.done.sling).toBe(true);
    seekWhen(game.sim, 0, 0, (v) => v.active && v.lapTick === 30);
    vehicleAt(L, 0, game.sim.tick, vs);
    grabPoint(L, vs, gp);
    placePlayer(w, game.sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, Math.atan2(vs.hx, vs.hz));
    for (let i = 0; i < 60 * 30 && !game.onboarding.done.ink; i++) step(game, { hold: true }, log);
    expect(log.shown.has('hitch') || log.events.some((e) => e.type === 'hintDone' && e.step === 'hitch')).toBe(true);
    expect(log.shown.has('ink')).toBe(true);
    expect(doneOrder(log.events)).toEqual(['hitch', 'sling', 'ink']);
    expect(game.onboarding.done.hop).toBe(false);
    expect(game.onboarding.done.grind).toBe(false);
  });
});

describe('when hints never show', () => {
  it('with hints off nothing shows, though steps are still counted', () => {
    const game = plazaGame(plaza(), { hints: false });
    roll(game, 0, -40, 0, 7);
    const run = steps(game, 200, (i) => (i > 80 ? carveInput(i - 80) : {}));
    expect(run.shown).toEqual(new Set(['']));
    expect(run.events.some((e) => e.type === 'hintShow')).toBe(false);
    expect(game.onboarding.done.carve).toBe(true);
  });

  it('turning hints off hides the hint up now; on again brings it back', () => {
    const game = plazaGame(plaza([]));
    roll(game, 0, -60, 0, 8);
    steps(game, CARVE_SHOW_TICKS + 5);
    expect(game.onboarding.shown).toBe('carve');
    game.onboardingSetHints(false);
    expect(game.onboarding.shown).toBe('');
    expect(steps(game, 30).shown).toEqual(new Set(['']));
    game.onboardingSetHints(true);
    steps(game, 2);
    expect(game.onboarding.shown).toBe('carve');
  });

  it('nothing shows while chalking a line or racing one', () => {
    const game = plazaGame(plaza([]));
    roll(game, 0, -60, 0, 8);
    expect(game.chalkStartRecording().ok).toBe(true);
    const rec = steps(game, 6 * 60);
    expect(rec.shown).toEqual(new Set(['']));
    const id = game.chalk.lines.length;
    expect(game.chalkStopRecording('test').ok).toBe(true);
    expect(game.chalk.lines.length).toBe(id + 1);
    expect(game.chalkStartRace(game.chalk.lines[0].id).ok).toBe(true);
    const race = steps(game, 5 * 60);
    expect(game.chalk.mode === 'racing' || game.chalk.mode === 'countdown').toBe(true);
    expect(race.shown).toEqual(new Set(['']));
  });

  it('after onboardingSkip nothing shows ever again, and it says so once', () => {
    const game = plazaGame(plaza());
    game.onboardingSkip();
    roll(game, 0, -40, 0, 7);
    const run = steps(game, 300);
    expect(run.shown).toEqual(new Set(['']));
    expect(run.events.filter((e) => e.type === 'onboardingComplete')).toHaveLength(1);
    expect(game.onboarding.complete).toBe(true);
  });

  it('a hint lingers briefly after its situation ends rather than flickering', () => {
    const game = plazaGame(plaza([]));
    roll(game, 0, -60, 0, 8);
    steps(game, CARVE_SHOW_TICKS + 5);
    expect(game.onboarding.shown).toBe('carve');
    game.sim.player.speed = 0;
    game.sim.player.vx = 0;
    game.sim.player.vz = 0;
    steps(game, HINT_LINGER_TICKS - 5);
    expect(game.onboarding.shown).toBe('carve');
    steps(game, 20);
    expect(game.onboarding.shown).toBe('');
  });
});

describe('errands wait their turn', () => {
  const offer: ErrandDef = { id: 'e1', title: 'Test', giver: 'giver', district: 0, brief: 'Do it.', limitTicks: 7200, steps: [{ kind: 'reach', zone: 'giver' }] };
  /** Hold still in the giver's zone for a second; return whether the offer showed and whether it started. */
  function tryOffer(game: Game): { offered: boolean; started: boolean } {
    placePlayer(game.sim.world, game.sim.player, 0, 0, 0);
    let offered = false;
    let started = false;
    for (let i = 0; i < 30 + OFFER_FILL_TICKS + 30; i++) {
      game.step({ steer: 0, hold: true, hop: false });
      if (game.errands.offered === 'e1') offered = true;
      if (game.errands.active) started = true;
    }
    return { offered, started };
  }

  it('no offer shows or fills before the hitch is learnt', () => {
    const game = plazaGame(plaza([]), { errands: [offer] });
    teach(game, ['carve', 'hop', 'grind']);
    expect(tryOffer(game)).toEqual({ offered: false, started: false });
    expect(game.errandsOpen).toBe(false);
  });

  it('offers work once the hitch is learnt', () => {
    const game = plazaGame(plaza([]), { errands: [offer] });
    teach(game, ['carve', 'hitch']);
    expect(tryOffer(game)).toEqual({ offered: true, started: true });
  });

  it('with hints off, or onboarding skipped, offers work from the start', () => {
    expect(tryOffer(plazaGame(plaza([]), { errands: [offer], hints: false }))).toEqual({ offered: true, started: true });
    const skipped = plazaGame(plaza([]), { errands: [offer] });
    skipped.onboardingSkip();
    expect(tryOffer(skipped)).toEqual({ offered: true, started: true });
  });

  it('in the city a new game at the lookout is not offered the funicular errand until the hitch is learnt', () => {
    resetFeel();
    const game = new Game(city.world, { seed: 1, startDayFrac: NEW_GAME_DAY_FRAC, hints: true });
    for (let i = 0; i < 60; i++) game.step({ steer: 0, hold: true, hop: false });
    expect(game.errands.offered).toBe(null);
    const open = new Game(city.world, { seed: 1, startDayFrac: NEW_GAME_DAY_FRAC, hints: false });
    open.step({ steer: 0, hold: false, hop: false });
    expect(open.errands.offered).toBe('funicular_valve');
  });

  it('an errand in progress hides hints', () => {
    const game = plazaGame(plaza([]), { errands: [{ ...offer, steps: [{ kind: 'reach', zone: 'nowhere_near' }] }] });
    teach(game, ['hitch']);
    tryOffer(game);
    expect(game.errands.active).not.toBe(null);
    roll(game, 0, -60, 0, 8);
    const run = steps(game, 200);
    expect(run.shown).toEqual(new Set(['']));
  });
});

describe('saves and determinism', () => {
  it('state round-trips through the save; junk leaves it fresh; a junk complete flag cannot skip the lesson', () => {
    const game = plazaGame(plaza());
    teach(game, ['carve', 'hop']);
    const data = reducer(game).exportState?.();
    const other = plazaGame(plaza());
    reducer(other).importState?.(JSON.parse(JSON.stringify(data)));
    expect(other.onboarding.done).toEqual(game.onboarding.done);
    for (const junk of [null, 7, 'x', [], { done: 'carve' }, { done: ['carve', 'fly', 3] }]) {
      reducer(other).importState?.(junk);
      const n = Object.values(other.onboarding.done).filter((b) => b).length;
      expect(n, JSON.stringify(junk)).toBeLessThanOrEqual(1);
    }
    reducer(other).importState?.({ v: 1, done: ['carve'], complete: true, releases: 0 });
    expect(other.onboarding.complete).toBe(false);
    const all = plazaGame(plaza());
    reducer(all).importState?.({ v: 1, done: [...LESSON_STEPS], complete: true, releases: 1 });
    expect(all.onboarding.complete).toBe(true);
    // onboardingReset starts over.
    all.onboardingReset();
    expect(all.onboarding.complete).toBe(false);
    expect(Object.values(all.onboarding.done).some((b) => b)).toBe(false);
  });

  it('two games with the same inputs end in the same state with the same events', () => {
    const a = firstLaunch(NEW_GAME_DAY_FRAC);
    const b = firstLaunch(NEW_GAME_DAY_FRAC);
    expect(b.log).toEqual(a.log);
    expect(JSON.stringify(b.game.onboarding)).toBe(JSON.stringify(a.game.onboarding));
    expect(b.game.sim.hash()).toBe(a.game.sim.hash());
  });
});

// ---------------------------------------------------------------------------------------------
// The scan for rides to point at agrees with what tryHitch accepts.

describe('the ride pointed at can be caught', () => {
  it('in the city, across the day, every ride the hint would point at is caught by a holding skater at its grab point', () => {
    resetFeel();
    const w = city.world;
    const found = { line: -1, veh: -1 };
    let checked = 0;
    let contested = 0;
    const seen = new Set<string>();
    for (let k = 0; k < 96; k++) {
      const tick = Math.floor((k * DAY_TICKS) / 96) + 37;
      for (const L of w.lines) {
        for (let vi = 0; vi < L.vehicles; vi++) {
          vehicleAt(L, vi, tick, vs);
          if (!vs.active) continue;
          // A skater 12 m behind the ride, on the ground or the roof there.
          grabPoint(L, vs, gp);
          const sx = gp.x - vs.hx * 12;
          const sz = gp.z - vs.hz * 12;
          if (sx < w.minX || sx > w.maxX || sz < w.minZ || sz > w.maxZ) continue;
          const game = new Game(w, { seed: 1, startDayFrac: 0, hints: true, errands: [], conductors: [] });
          game.sim.tick = tick;
          placePlayer(w, game.sim.player, sx, sz, 0);
          const p = game.sim.player;
          findCatchable(w, tick, p.x, p.y, p.z, 0, found);
          if (found.line < 0) continue;
          const T = w.lines[found.line];
          expect(T.minChainN, T.id).toBe(1);
          vehicleAt(T, found.veh, tick, vs);
          expect(vs.active, T.id).toBe(true);
          // Stand at the pointed grab point and hold: it must latch that line. Behind a bumper; for a
          // strap, where it will be at the top of a hop.
          grabPoint(T, vs, gp);
          const heading = Math.atan2(vs.hx, vs.hz);
          if (T.overhead) placePlayer(w, p, gp.x + vs.vx * 0.35, gp.z + vs.vz * 0.35, heading);
          else placePlayer(w, p, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, heading);
          const high = gp.y - (p.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.8;
          let caught = -1;
          for (let i = 0; i < 60 && caught < 0; i++) {
            game.step({ steer: 0, hold: true, hop: high && i % 20 === 0 });
            for (const e of game.sim.events) if (e.type === 'hitch') caught = e.line;
          }
          // Another ride nearer to hand there wins the latch (tryHitch takes the nearest): fine, rare.
          if (caught >= 0 && caught !== found.line) contested++;
          else expect(caught, `${T.id} at tick ${tick}`).toBe(found.line);
          checked++;
          seen.add(T.id);
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(contested).toBeLessThanOrEqual(checked * 0.1);
    expect(seen.size).toBeGreaterThan(6);
  });

  it('never points at the gated summit kite, even standing under it', () => {
    resetFeel();
    const w = city.world;
    const S3 = w.lines.find((l) => l.id === 'S3');
    if (!S3) throw new Error('no S3');
    const found = { line: -1, veh: -1 };
    let tested = 0;
    for (let t = 0; t < DAY_TICKS; t += 600) {
      vehicleAt(S3, 0, t, vs);
      if (!vs.active) continue;
      grabPoint(S3, vs, gp);
      findCatchable(w, t, gp.x, gp.y - 2, gp.z, 0, found);
      expect(found.line === S3.index).toBe(false);
      findCatchable(w, t, gp.x, gp.y - 2, gp.z, 3, found);
      tested++;
    }
    expect(tested).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The first launch, in the city.

/** Rellano 410: the first ground stop on the way down from the lookout (handcarts M2, mopeds M1). */
const FIRST_STOP = 'Rellano 410';
/** A ride is at the stop when it is within the stop zone's radius of the line's stop point. */
const STOP_R = 6;

function stopPoint(L: CompiledLine, name: string): { x: number; z: number } | null {
  const st = L.allStops.find((s) => s.name === name);
  if (!st) return null;
  const o = { x: 0, y: 0, z: 0, hx: 0, hz: 0 };
  pathAt(L, st.s, o);
  return { x: o.x, z: o.z };
}

interface Launch {
  game: Game;
  log: string[];
  /** Tick the skater first came within 14 m of the stop (the stop board's range) or caught a ride on its landing, or -1. */
  arrival: number;
  bails: number;
}

/**
 * A closed-loop new player that follows the hints: carves both ways when DRAG shows, flicks up at
 * FLICK UP, lines up with the stair handrail and hops onto it at its run-in for LAND ON THE RAIL,
 * then rolls down to the first stop's landing and goes for the ride the pointer is over, holding
 * still behind its bumper. Hitched, it rides quietly until DRAG... THEN LET GO, then lets go as the
 * swing carries it fastest. After that it goes for the nearest ride by the stop and holds on until
 * the segment is inked.
 */
function firstLaunch(frac: number, maxTicks = 4 * 60 * 60): Launch {
  resetFeel();
  const w = city.world;
  const game = new Game(w, { seed: 1, startDayFrac: frac, hints: true });
  const sim = game.sim;
  const p = sim.player;
  const M2 = w.lines.find((l) => l.id === 'M2');
  const stop = M2 ? stopPoint(M2, FIRST_STOP) : null;
  if (!stop) throw new Error('no first stop');
  const log: string[] = [];
  const V: VehicleState = makeVehicleState();
  const G = { x: 0, y: 0, z: 0 };
  let carveT = 0;
  let arrival = -1;
  let bails = 0;
  /** The second flight's handrail (x = 3), its run-in at z = 508 on the second landing. */
  const RAIL_X = 3;
  const RUN_IN_Z = 508;
  for (let i = 0; i < maxTicks && !game.onboarding.complete; i++) {
    const ob = game.onboarding;
    let steer = 0;
    let hold = false;
    let hop = false;
    if (p.mode === Mode.HITCH) {
      const H = w.lines[p.hLine];
      vehicleAt(H, p.hVeh, sim.tick, V);
      const rideSpeed = Math.hypot(V.vx, V.vz);
      hold = true;
      // Let go when a release would be a whip.
      if (ob.shown === 'sling' && Math.max(Math.hypot(p.vx, p.vz) * FEEL.SLING_GAIN, FEEL.SLING_MIN) >= 1.2 * rideSpeed) hold = false;
      if (rideSpeed > 4) steer = clamp(-(1.5 * angleDiff(p.psi, p.psiRest) + 0.5 * p.omega), -1, 1);
    } else if (!ob.done.carve) {
      if (ob.shown === 'carve' || p.speed > 0.6) steer = carveT++ < 30 ? 0.9 : -0.9;
    } else if (p.z > 422) {
      // Down the stairs on the handrail's line to the third landing, then the spine.
      const tx = p.z > 470 ? RAIL_X : 0;
      steer = clamp(-2 * angleDiff(Math.atan2(tx - p.x, -6), p.heading), -1, 1);
      if (ob.shown === 'hop' && p.mode === Mode.GROUND) hop = true;
      if (ob.shown === 'grind' && p.mode === Mode.GROUND && Math.abs(p.z - (RUN_IN_Z + 2)) < 0.5) hop = true;
    } else {
      // The stop's landing: the ride the pointer is over, else (after the sling) the nearest ride
      // close by, else wait at the stop with a shoulder to the wall north of it.
      let tl = ob.target.kind === 'vehicle' ? ob.target.line : -1;
      let tv = ob.target.veh;
      if (ob.done.sling) {
        let best = 15;
        for (const M of w.lines) {
          if (M.minChainN > 1) continue;
          for (let k = 0; k < M.vehicles; k++) {
            vehicleAt(M, k, sim.tick, V);
            if (!V.active) continue;
            grabPoint(M, V, G);
            const d = Math.hypot(G.x - p.x, G.z - p.z);
            if (d < best && Math.abs(G.y - p.y) < 3) {
              best = d;
              tl = M.index;
              tv = k;
            }
          }
        }
      }
      let tx = stop.x - 5;
      let tz = stop.z + 4.5;
      if (tl >= 0) {
        const L = w.lines[tl];
        vehicleAt(L, tv, sim.tick, V);
        grabPoint(L, V, G);
        tx = G.x - V.hx * 0.8;
        tz = G.z - V.hz * 0.8;
        hold = Math.hypot(G.x - p.x, G.z - p.z) < 6;
      }
      const dist = Math.hypot(tx - p.x, tz - p.z);
      steer = clamp(-2 * angleDiff(Math.atan2(tx - p.x, tz - p.z), p.heading), -1, 1);
      if (p.mode === Mode.GROUND && p.speed < 2.4 && dist > 2) steer = clamp(steer + (Math.floor(i / 12) % 2 === 0 ? 0.9 : -0.9), -1, 1);
    }
    game.step({ steer, hold, hop });
    // Arrived: within the stop board's range of the stop, or already on a ride on its landing.
    if (arrival < 0 && (Math.hypot(p.x - stop.x, p.z - stop.z) < 14 || (p.mode === Mode.HITCH && p.z < 422))) arrival = sim.tick;
    for (const e of sim.events) {
      if (e.type === 'bail') bails++;
      if (e.type === 'hitch' || e.type === 'release') log.push(`${i} ${e.type} ${w.lines[e.line].id}`);
    }
    for (const e of game.events) {
      if (e.type === 'hintShow' || e.type === 'hintDone') log.push(`${i} ${e.type} ${e.step}`);
      else if (e.type === 'segmentInked' || e.type === 'onboardingComplete') log.push(`${i} ${e.type}`);
    }
  }
  return { game, log, arrival, bails };
}

describe('the first launch', () => {
  it('a new player who follows the hints learns all six in order, in under 4 minutes, at the new-game clock', () => {
    expect(NEW_GAME_DAY_FRAC).toBeGreaterThanOrEqual(0.3);
    expect(NEW_GAME_DAY_FRAC).toBeLessThanOrEqual(0.45);
    const run = firstLaunch(NEW_GAME_DAY_FRAC);
    const ev = run.log.join('\n');
    expect(run.game.onboarding.complete, ev).toBe(true);
    expect(run.log.filter((l) => l.endsWith('hintDone ' + l.split(' ').pop())).map((l) => l.split(' ').pop()), ev).toEqual([...LESSON_STEPS]);
    expect(run.log.some((l) => l.endsWith('onboardingComplete'))).toBe(true);
    expect(run.bails).toBe(0);
    // Each hint was shown before it was learnt, except carve, which can be learnt at once.
    for (const s of ['hop', 'grind', 'hitch', 'sling', 'ink']) {
      const shown = run.log.findIndex((l) => l.endsWith(`hintShow ${s}`));
      const done = run.log.findIndex((l) => l.endsWith(`hintDone ${s}`));
      expect(shown, s).toBeGreaterThanOrEqual(0);
      expect(shown, s).toBeLessThan(done);
    }
    // The first ride is caught at the first stop's landing, from the line the pointer showed.
    const first = run.log.find((l) => l.includes(' hitch '));
    expect(first, ev).toMatch(/ hitch M[12]$/);
  });

  it('a vehicle is at the first stop, or due within 12 s, for a player arriving up to 20 s after a typical arrival', () => {
    const run = firstLaunch(NEW_GAME_DAY_FRAC);
    expect(run.arrival).toBeGreaterThan(0);
    const w = city.world;
    const serving: { L: CompiledLine; x: number; z: number }[] = [];
    for (const L of w.lines) {
      const sp = stopPoint(L, FIRST_STOP);
      if (sp) serving.push({ L, ...sp });
    }
    expect(serving.map((s) => s.L.id).sort()).toEqual(['M1', 'M2']);
    const atStop = (t: number): boolean => {
      for (const s of serving) {
        for (let k = 0; k < s.L.vehicles; k++) {
          vehicleAt(s.L, k, t, vs);
          if (vs.active && Math.hypot(vs.x - s.x, vs.z - s.z) < STOP_R) return true;
        }
      }
      return false;
    };
    const rideWithin12s = (a: number): boolean => {
      for (let t = a; t <= a + 12 * 60; t++) if (atStop(t)) return true;
      return false;
    };
    // Typical arrival (the hint-following player), then up to 20 s of carving around.
    for (let d = 0; d <= 20 * 60; d += 15) expect(rideWithin12s(run.arrival + d), `arriving ${d / 60}s late`).toBe(true);
    // Tolerance: the whole 20 s range still holds if the typical arrival itself is 12 s earlier or later.
    for (const shift of [-12 * 60, 12 * 60]) {
      for (let d = 0; d <= 20 * 60; d += 15) expect(rideWithin12s(run.arrival + shift + d), `shift ${shift / 60}s, +${d / 60}s`).toBe(true);
    }
  });

  it('the bot reaches the first stop about 22 s in (the timing above assumes it)', () => {
    const run = firstLaunch(NEW_GAME_DAY_FRAC, 40 * 60);
    const start = Math.round(NEW_GAME_DAY_FRAC * DAY_TICKS);
    expect((run.arrival - start) / 60).toBeGreaterThan(15);
    expect((run.arrival - start) / 60).toBeLessThan(30);
  });
});

