/**
 * Onboarding after the independent check (M6g): the lesson is carve, hitch, sling, ink; the hitch
 * hint leads a learner to a waiting spot at a stop before the ride comes; no ride that needs a hop is
 * pointed at before the hitch is learnt; a stalled skater is told to wiggle; only the player's own
 * release counts as the sling; the ride scan's checks; saves through the real save code.
 */
import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/sim/city';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { DEFAULT_SETTINGS, exportSave, importSave, migrate } from '../../src/sim/game/save';
import { Game, type GameEvent, type GameReducer } from '../../src/sim/game/game';
import {
  CATCH_AHEAD_TICKS,
  HITCH_NEAR,
  LANE_CLEAR,
  LEAD_TICKS,
  LEVEL_DY,
  ONBOARDING_STEPS,
  ROLL_DONE_SPEED,
  ROLL_STAND_TICKS,
  SCAN_EVERY,
  SPOT_CLEAR,
  SPOT_NEAR,
  findCatchable,
  rideToStop,
  stopSites,
  type HintId,
  type OnboardingStep,
} from '../../src/sim/game/onboarding';
import { compileLine, grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type LineDef } from '../../src/sim/lines';
import { angleDiff } from '../../src/sim/math';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame, type SimEvent } from '../../src/sim/types';
import { hintCopy } from '../../src/ui/hintCopy';
import { addSolid, createWorld, fillHeights, fillSurfaces, finalizeWorld, Surface, topHeight, type World } from '../../src/sim/world';
import { seekWhen, testLine } from './helpers';

const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };

/**
 * A flat plaza with a test tram line: by default a 120 x 180 m circuit (up x = 30 first, +z) with a
 * stop halfway up that side, at (30, 0, 0). `block` adds a 6 m high block west of the lane, its top a street above.
 */
function plaza(over: Partial<LineDef>[] = [STOPPING], block: 'none' | 'beside' | 'under' = 'none'): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = over.map((o, i) => compileLine(testLine({ id: `X${i + 1}`, ...o }), i));
  w.spawn = { x: 0, z: 0, heading: 0 };
  // Beside: a block west of the lane, its top a street above it. Under: the lane's side of the square
  // runs along the top of a block (the line's path raised to match).
  if (block === 'beside') addSolid(w, { cx: 22, cz: 0, hx: 4, hz: 30, yBase: 0, yTop: 6, surface: Surface.ROOF });
  if (block === 'under') addSolid(w, { cx: 30, cz: 0, hx: 4, hz: 94, yBase: 0, yTop: 6, surface: Surface.ROOF });
  finalizeWorld(w);
  return w;
}

/** The test tram with a stop halfway up its first side. */
const STOPPING: Partial<LineDef> = { path: [30, 0, -90, 30, 0, 90, -90, 0, 90, -90, 0, -90, 30, 0, -90], stops: [{ s: 90, name: 'Medio' }], dwell: 3 };
/** The same, its circuit 6 m up. */
const RAISED: Partial<LineDef> = { ...STOPPING, path: [30, 6, -90, 30, 6, 90, -90, 6, 90, -90, 6, -90, 30, 6, -90] };

/** Horizontal distance from (x, z) to a line's path. */
function pathDist(L: CompiledLine, x: number, z: number): number {
  const p = L.pathPts;
  let best = Infinity;
  for (let i = 3; i < p.length; i += 3) {
    const ax = p[i - 3];
    const az = p[i - 1];
    const ex = p[i] - ax;
    const ez = p[i + 2] - az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
  }
  return best;
}

function newGame(w: World, frac = 0.3, hints = true): Game {
  resetFeel();
  return new Game(w, { seed: 1, startDayFrac: frac, hints, errands: [], conductors: [] });
}

function reducer(game: Game): GameReducer {
  const r = game.reducers.find((x) => x.key === 'onboarding');
  if (!r) throw new Error('no onboarding reducer');
  return r;
}

function teach(game: Game, steps: OnboardingStep[]): void {
  reducer(game).importState?.({ v: 1, done: steps, complete: false, releases: 0 });
}

interface Run {
  shown: Set<HintId | ''>;
  events: GameEvent[];
}

function steps(game: Game, n: number, inp: (i: number) => Partial<InputFrame> = () => ({})): Run {
  const log: Run = { shown: new Set(), events: [] };
  for (let i = 0; i < n; i++) {
    game.step({ steer: inp(i).steer ?? 0, hold: inp(i).hold ?? false, hop: inp(i).hop ?? false });
    log.shown.add(game.onboarding.shown);
    for (const e of game.events) log.events.push(e);
  }
  return log;
}

/** Steer toward (x, z), wiggling to pump when slow, as a player following the pointer would. */
function steerToward(game: Game, x: number, z: number): number {
  const p = game.sim.player;
  const want = Math.atan2(x - p.x, z - p.z);
  let steer = Math.max(-1, Math.min(1, -2 * angleDiff(want, p.heading)));
  if (p.speed < 2 && Math.hypot(x - p.x, z - p.z) > SPOT_NEAR) steer = Math.max(-1, Math.min(1, steer + (Math.floor(game.sim.tick / 12) % 2 === 0 ? 0.9 : -0.9)));
  return steer;
}

const doneOrder = (events: GameEvent[]): string[] => events.flatMap((e) => (e.type === 'hintDone' ? [e.step] : []));

/** Set the clock so the tram is `secs` seconds from standing at the stop (30, 0, 0). */
function tramDue(game: Game, secs: number): void {
  const L = game.sim.world.lines[0];
  seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.z) < 0.05 && Math.abs(v.x - 30) < 0.05 && Math.hypot(v.vx, v.vz) < 0.01);
  game.sim.tick -= Math.round(secs * 60);
  vehicleAt(L, 0, game.sim.tick, vs);
}

describe('the lesson is carve, hitch, ink and sling', () => {
  it('completes without the hop or the grind, which keep showing in their situations afterwards', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve']);
    // Wait at the stop beside the lane, catch the tram, stay on to the next stop, let go.
    tramDue(game, 5);
    placePlayer(w, game.sim.player, 27.6, -4, 0);
    const log: GameEvent[] = [];
    for (let i = 0; i < 60 * 80 && !game.onboarding.done.ink; i++) log.push(...steps(game, 1, () => ({ hold: true })).events);
    expect(doneOrder(log)).toEqual(['hitch', 'ink']);
    expect(game.sim.player.mode).toBe(Mode.HITCH);
    // Then the sling hint: drag, and let go.
    const sling = steps(game, 100, () => ({ hold: true }));
    expect(sling.shown.has('sling')).toBe(true);
    const rest = steps(game, 60 * 12, (i) => ({ hold: i < 60, steer: i < 60 ? 0.8 : 0 }));
    expect(doneOrder(rest.events)).toContain('sling');
    expect(rest.events).toContainEqual({ type: 'onboardingComplete' });
    expect(game.onboarding.complete).toBe(true);
    expect(game.onboarding.done.hop).toBe(false);
    expect(game.onboarding.done.grind).toBe(false);
    // The hop still shows, after completion, rolling at something to hop.
    const hopWorld = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
    fillSurfaces(hopWorld, () => Surface.PLAZA);
    addSolid(hopWorld, { cx: 0, cz: 10, hx: 6, hz: 2, yBase: 0, yTop: 0.8, surface: Surface.PLAZA });
    hopWorld.spawn = { x: 0, z: 0, heading: 0 };
    finalizeWorld(hopWorld);
    const g2 = newGame(hopWorld);
    reducer(g2).importState?.({ v: 1, done: ['carve', 'hitch', 'sling', 'ink'], complete: true, releases: 1 });
    placePlayer(hopWorld, g2.sim.player, 0, 0, 0);
    g2.sim.player.speed = 4;
    expect(g2.onboarding.complete).toBe(true);
    expect(steps(g2, SCAN_EVERY + 2).shown.has('hop')).toBe(true);
  });
});

describe('the hitch hint leads to a waiting spot at the stop', () => {
  it('heading for a stop with a ride due, it points at a spot beside the lane, in reach of the grab point and clear of the body', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve']);
    tramDue(game, 15);
    placePlayer(w, game.sim.player, 20, -35, 0);
    game.sim.player.speed = 4;
    steps(game, SCAN_EVERY + 1);
    const t = game.onboarding.target;
    expect(game.onboarding.shown).toBe('hitch');
    expect(t.kind).toBe('spot');
    // The first lead teaches the brake (DECISIONS 113): pull down to stop in the ring.
    expect(game.onboarding.brakeAsk).toBe(true);
    expect(hintCopy('hitch', game.onboarding)).toMatchObject({ glyph: 'pull', title: 'PULL DOWN TO STOP' });
    // Beside the stop's grab point (4 m behind the stop on a +z lane), on the skater's side.
    const L = w.lines[0];
    const off = L.bodyHalfWid + SPOT_CLEAR;
    expect(t.x).toBeCloseTo(30 - off, 5);
    expect(t.z).toBeCloseTo(-L.anchorBack, 5);
    expect(Math.abs(t.x - 30)).toBeLessThan(FEEL.HITCH_REACH);
    expect(Math.abs(t.x - 30) - L.bodyHalfWid).toBeGreaterThan(FEEL.PLAYER_RADIUS + 0.5);
  });

  it('pulling down to a stop in the ring turns the hint into "hold for the ride", and the brake is not asked for again', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve']);
    tramDue(game, 15);
    placePlayer(w, game.sim.player, 20, -35, 0);
    game.sim.player.speed = 4;
    steps(game, SCAN_EVERY + 1);
    expect(game.onboarding.brakeAsk).toBe(true);
    // Steer for the spot and pull down once there, as a player following the pointer would.
    tramDue(game, 30);
    let stood = -1;
    for (let i = 0; i < 60 * 12 && stood < 0; i++) {
      const t = game.onboarding.target;
      const p = game.sim.player;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      const brake = t.kind === 'spot' && d < SPOT_NEAR - 0.5;
      game.step({ steer: brake ? 0 : steerToward(game, t.x, t.z), hold: false, hop: false, brake });
      if (brake && game.sim.player.speed < 0.05) stood = i;
    }
    // Standing in the ring, still led to it (the ride is not yet within HITCH_NEAR).
    expect(stood).toBeGreaterThanOrEqual(0);
    expect(game.onboarding.shown).toBe('hitch');
    expect(game.onboarding.target.kind).toBe('spot');
    expect(game.onboarding.brakeAsk).toBe(false);
    expect(hintCopy('hitch', game.onboarding)).toMatchObject({ glyph: 'press', title: 'HOLD FOR THE RIDE' });
    // Rolling away and being led back: no second brake lesson.
    placePlayer(w, game.sim.player, 20, -35, 0);
    game.sim.player.speed = 4;
    steps(game, SCAN_EVERY + 1);
    expect(game.onboarding.target.kind).toBe('spot');
    expect(game.onboarding.brakeAsk).toBe(false);
  });

  it('a player who never brakes still catches the ride rolling past and learns the hitch', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve']);
    tramDue(game, 15);
    placePlayer(w, game.sim.player, 20, -35, 0);
    game.sim.player.speed = 4;
    let hitched = false;
    // Thumb on the glass the whole way, carving for the pointer, never pulling down.
    for (let i = 0; i < 60 * 40 && !hitched; i++) {
      const t = game.onboarding.target;
      const steer = t.kind === 'none' ? 0 : steerToward(game, t.x, t.z);
      game.step({ steer, hold: true, hop: false, brake: false });
      if (game.onboarding.done.hitch) hitched = true;
    }
    expect(hitched).toBe(true);
  });

  it('stays on the spot until the ride is within 30 m, then points at its grab bar; holding still there catches it', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve']);
    tramDue(game, 15);
    placePlayer(w, game.sim.player, 27.6, -4, 0);
    const L = w.lines[0];
    const kinds: string[] = [];
    let hitched = -1;
    for (let i = 0; i < 60 * 25 && hitched < 0; i++) {
      game.step({ steer: 0, hold: true, hop: false });
      if (game.sim.player.mode === Mode.HITCH) {
        hitched = i;
        break;
      }
      const k = game.onboarding.target.kind;
      if (kinds[kinds.length - 1] !== k) kinds.push(k);
      if (k === 'vehicle') {
        vehicleAt(L, 0, game.sim.tick, vs);
        grabPoint(L, vs, gp);
        expect(Math.hypot(gp.x - game.sim.player.x, gp.z - game.sim.player.z)).toBeLessThan(HITCH_NEAR + 1);
        expect(game.onboarding.target.x).toBeCloseTo(gp.x, 6);
      }
      // A skater waiting at the spot is not stalled: the roll hint never interrupts.
      expect(game.onboarding.shown).not.toBe('roll');
    }
    expect(kinds.filter((k) => k !== 'none')).toEqual(['spot', 'vehicle']);
    expect(hitched).toBeGreaterThan(0);
  });

  it('no lead without a ride due in time, for a stop behind the skater, or a stop above them', () => {
    const w = plaza();
    const late = newGame(w);
    teach(late, ['carve']);
    tramDue(late, LEAD_TICKS / 60 + 6);
    placePlayer(w, late.sim.player, 20, -35, 0);
    late.sim.player.speed = 4;
    expect(steps(late, SCAN_EVERY + 1).shown.has('hitch')).toBe(false);

    const behind = newGame(w);
    teach(behind, ['carve']);
    tramDue(behind, 15);
    placePlayer(w, behind.sim.player, 22, 30, 0);
    behind.sim.player.speed = 5;
    expect(steps(behind, SCAN_EVERY + 1).shown.has('hitch')).toBe(false);

    // A stop up on a block, the skater on the plaza below it: never led up a wall.
    const high = plaza([RAISED], 'under');
    expect(stopSites(high).ok.some((b) => b === 1)).toBe(true);
    const below = newGame(high);
    teach(below, ['carve']);
    tramDue(below, 15);
    placePlayer(high, below.sim.player, 20, -35, 0);
    below.sim.player.speed = 4;
    expect(below.sim.player.y).toBeLessThan(1);
    expect(steps(below, SCAN_EVERY + 1).shown.has('hitch')).toBe(false);
  });

  it('every waiting spot in the city is in reach of its own lane, clear of its body and of every other lane', () => {
    resetFeel();
    const w = buildCity(1).world;
    const S = stopSites(w);
    let spots = 0;
    for (let i = 0; i < S.n; i++) {
      const L = w.lines[S.line[i]];
      for (let j = 0; j < 2; j++) {
        const k = i * 2 + j;
        if (S.ok[k] === 0) continue;
        spots++;
        const own = pathDist(L, S.sx[k], S.sz[k]);
        expect(own, `${L.id} stop ${S.stop[i]}`).toBeLessThan(FEEL.HITCH_REACH);
        expect(own - L.bodyHalfWid, `${L.id} stop ${S.stop[i]}`).toBeGreaterThan(FEEL.PLAYER_RADIUS + 0.5);
        for (const M of w.lines) {
          if (M === L || M.overhead) continue;
          expect(pathDist(M, S.sx[k], S.sz[k]) - M.bodyHalfWid, `${L.id} stop ${S.stop[i]} by ${M.id}`).toBeGreaterThan(LANE_CLEAR);
        }
        expect(Math.abs(S.sy[k] - S.y[i])).toBeLessThan(0.6);
        // Nothing to land on by mistake beside it: no roof or block within a stride and a half.
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          for (const r of [0.8, 1.5]) {
            const top = topHeight(w, S.sx[k] + Math.cos(ang) * r, S.sz[k] + Math.sin(ang) * r);
            expect(top - S.sy[k], `${L.id} stop ${S.stop[i]} has something to land on beside its spot`).toBeLessThan(0.7);
          }
        }
      }
    }
    // Most stops have somewhere to wait.
    expect(spots).toBeGreaterThan(S.n * 0.6);
  });
});

describe('no ride that needs a hop before the hitch is learnt', () => {
  /** An overhead ride whose strap hangs just out of a standing reach, coming up x = 30. */
  function strapWorld(): World {
    return plaza([{ overhead: true, anchorBack: 0, anchorY: 1 + FEEL.HITCH_REACH_Y + 0.4, hang: 0, bodyHalfLen: 0, bodyHalfWid: 0, bodyHeight: 0 }]);
  }
  function coming(game: Game): void {
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.x - 30) < 0.5 && v.z > -26 && v.z < -25 && v.vz > 1);
    placePlayer(game.sim.world, game.sim.player, 29, -8, 0);
  }

  it('is never pointed at until then; afterwards it is, with its own copy', () => {
    const w = strapWorld();
    const found = { line: -1, veh: -1, hop: false };
    const learner = newGame(w);
    teach(learner, ['carve']);
    coming(learner);
    expect(steps(learner, 120).shown.has('hitch')).toBe(false);
    findCatchable(w, learner.sim.tick, 29, 0, -8, 0, found, false);
    expect(found.line).toBe(-1);

    const knows = newGame(w);
    teach(knows, ['carve', 'hitch']);
    coming(knows);
    steps(knows, SCAN_EVERY + 1);
    expect(knows.onboarding.shown).toBe('ink');
    expect(knows.onboarding.target).toMatchObject({ kind: 'vehicle', hop: true });
    expect(hintCopy('ink', knows.onboarding).title).toBe('FLICK UP, THEN HOLD');
  });
});

describe('the ride scan', () => {
  it('a ride about to leave service is not pointed at; the same ride a lap earlier is', () => {
    // Service ends at midday: find the moment the tram stands at its terminus at the end of the last lap.
    const w = plaza([{ windows: [[0.25, 0.5]] }]);
    const L = w.lines[0];
    let t = -1;
    for (let k = Math.round(0.45 * DAY_TICKS); k < Math.round(0.55 * DAY_TICKS) && t < 0; k += 5) {
      vehicleAt(L, 0, k, vs);
      const on = vs.active;
      vehicleAt(L, 0, k + CATCH_AHEAD_TICKS - 10, vs);
      if (on && !vs.active) t = k;
    }
    expect(t).toBeGreaterThan(0);
    vehicleAt(L, 0, t, vs);
    grabPoint(L, vs, gp);
    const found = { line: -1, veh: -1 };
    // Standing 8 m from it, behind its bumper.
    const x = gp.x - vs.hx * 8;
    const z = gp.z - vs.hz * 8;
    findCatchable(w, t, x, 0, z, 0, found);
    expect(found.line).toBe(-1);
    findCatchable(w, t - L.period, x, 0, z, 0, found);
    expect(found.line).toBe(0);
    // The lead's look ahead holds to the same rule.
    expect(rideToStop(L, vs.s, t, 60, { veh: -1 })).toBe(-1);
    expect(rideToStop(L, vs.s, t - L.period, 60, { veh: -1 })).toBe(0);
  });

  it('a ride on a street below a wall is not pointed at; the same ride from the street is', () => {
    const w = plaza([{}], 'beside');
    const game = newGame(w);
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(v.x - 30) < 0.5 && v.z > -26 && v.z < -25 && v.vz > 1);
    const found = { line: -1, veh: -1 };
    // On the block's roof, 6 m above the lane, 4 m from it.
    placePlayer(w, game.sim.player, 25.5, -8, 0);
    const p = game.sim.player;
    expect(p.y).toBeGreaterThan(LEVEL_DY);
    findCatchable(w, game.sim.tick, p.x, p.y, p.z, 0, found);
    expect(found.line).toBe(-1);
    findCatchable(w, game.sim.tick, 27.5, 0, -8, 0, found);
    expect(found.line).toBe(0);
  });
});

describe('a stalled skater is told to wiggle', () => {
  it('standing on the flat for 3 s without holding: WIGGLE TO ROLL, done once they pump past 2 m/s', () => {
    const game = newGame(plaza([]));
    const early = steps(game, ROLL_STAND_TICKS - 5);
    expect(early.shown.has('roll')).toBe(false);
    steps(game, 10);
    expect(game.onboarding.shown).toBe('roll');
    expect(hintCopy('roll', game.onboarding)).toMatchObject({ glyph: 'slide', title: 'WIGGLE TO ROLL' });
    let top = 0;
    const run = steps(game, 400, (i) => {
      top = Math.max(top, game.sim.player.speed);
      return { steer: Math.floor(i / 10) % 2 === 0 ? 0.9 : -0.9 };
    });
    expect(top).toBeGreaterThan(ROLL_DONE_SPEED);
    expect(doneOrder(run.events)).toContain('roll');
    expect(game.onboarding.done.roll).toBe(true);
    // Not part of the lesson.
    expect(game.onboarding.complete).toBe(false);
  });

  it('holding a still finger (waiting) or standing on a slope is not stalled', () => {
    const waiting = newGame(plaza([]));
    expect(steps(waiting, 400, () => ({ hold: true })).shown.has('roll')).toBe(false);
    const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
    fillSurfaces(w, () => Surface.PLAZA);
    w.spawn = { x: 0, z: 0, heading: 0 };
    fillHeights(w, (_x, z) => (z + 100) * 0.12);
    finalizeWorld(w);
    const slope = newGame(w);
    expect(steps(slope, 400).shown.has('roll')).toBe(false);
  });
});

describe('only a release the player makes counts as the sling', () => {
  function riding(): Game {
    const game = newGame(plaza([{}]));
    teach(game, ['carve', 'hitch', 'ink']);
    seekWhen(game.sim, 0, 0, (v) => v.active && Math.abs(Math.hypot(v.vx, v.vz) - 8) < 0.01 && Math.abs(v.x - 30) < 0.5);
    return game;
  }
  function release(game: Game, hold: boolean): void {
    const ev: SimEvent = { type: 'release', line: 0, vehicle: 0, speed: 20, chain: 1, hop: false };
    game.events.length = 0;
    game.sim.events.length = 0;
    game.sim.events.push(ev);
    game.applied.hold = hold;
    game.applied.hop = false;
    reducer(game).step(game);
  }

  it('the ride letting go (finger still down) never counts, however fast; lifting the finger does', () => {
    const game = riding();
    release(game, true);
    release(game, true);
    expect(game.onboarding.done.sling).toBe(false);
    expect(game.onboarding.slingRetry).toBe(false);
    release(game, false);
    expect(game.onboarding.done.sling).toBe(true);
  });
});

describe('saves through the real save code', () => {
  it('the lesson round-trips: exportSave, JSON, migrate, importSave', () => {
    const w = plaza();
    const game = newGame(w);
    teach(game, ['carve', 'hop', 'hitch']);
    const json = JSON.stringify(exportSave(game, DEFAULT_SETTINGS));
    const data = migrate(JSON.parse(json));
    if (!data) throw new Error('should migrate');
    const back = newGame(w);
    importSave(back, data);
    expect(back.onboarding.done).toEqual(game.onboarding.done);
    expect(back.onboarding.complete).toBe(false);
    expect(back.errandsOpen).toBe(true);
  });

  it('a save from before onboarding with any progress has learnt the game; an empty one gets the lesson', () => {
    const w = plaza();
    const fresh = JSON.parse(JSON.stringify(exportSave(newGame(w), DEFAULT_SETTINGS))) as { reducers: Record<string, unknown> };
    delete fresh.reducers.onboarding;
    const sections: Record<string, unknown>[] = [
      { progress: { v: 1, lines: [{ id: 'X1', inked: [true, false], discovered: true }] } },
      { errands: { v: 1, done: { funicular_valve: 3000 } } },
      { conductors: { v: 1, punched: ['T1'] } },
      { chalk: { v: 1, lines: [{ code: 'SK2-whatever', best: 0 }] } },
    ];
    for (const extra of sections) {
      const old = { ...fresh, reducers: { ...fresh.reducers, ...extra } };
      const data = migrate(old);
      if (!data) throw new Error('should migrate');
      const g = newGame(w);
      importSave(g, data);
      expect(g.onboarding.complete, Object.keys(extra)[0]).toBe(true);
      for (const s of ONBOARDING_STEPS) expect(g.onboarding.done[s], s).toBe(true);
      expect(g.errandsOpen).toBe(true);
      expect(steps(g, 300).shown).toEqual(new Set(['']));
    }
    const empty = migrate(fresh);
    if (!empty) throw new Error('should migrate');
    const g = newGame(w);
    importSave(g, empty);
    expect(g.onboarding.complete).toBe(false);
    expect(Object.values(g.onboarding.done).some((b) => b)).toBe(false);
    expect(g.errandsOpen).toBe(false);
  });
});
