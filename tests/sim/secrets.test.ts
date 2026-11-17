import { describe, expect, it } from 'vitest';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { compileLine, grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame } from '../../src/sim/types';
import { addZone, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';
import { testLine } from './helpers';

/** A plaza with a "ghost tram" (S1) and a "blimp" circuit (S2, a ground stand-in), the needle and the tunnel zones. */
function world(): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = [
    compileLine(testLine({ id: 'S1' }), 0),
    compileLine(testLine({ id: 'S2', path: [80, 0, -80, 80, 0, -40, 50, 0, -40, 50, 0, -80, 80, 0, -80] }), 1),
  ];
  w.spawn = { x: 0, z: 0, heading: 0 };
  finalizeWorld(w);
  addZone(w, { id: 'needle', name: 'La Aguja', kind: 'secret', x: -50, y: 0, z: 50, r: 4 });
  addZone(w, { id: 'ghost_tunnel', name: 'Túnel', kind: 'secret', x: 0, y: 0, z: 60, r: 8 });
  return w;
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

const found = (log: Log): string[] => log.events.flatMap((e) => (e.type === 'secretFound' ? [e.id] : []));

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };

function catchLine(game: Game, log: Log, li: number): void {
  const sim = game.sim;
  const L = sim.world.lines[li];
  for (let t = sim.tick + 600; t < sim.tick + DAY_TICKS; t++) {
    vehicleAt(L, 0, t, VS);
    if (VS.active && Math.hypot(VS.vx, VS.vz) > 5) {
      sim.tick = t;
      break;
    }
  }
  grabPoint(L, VS, GP);
  placePlayer(sim.world, sim.player, GP.x - VS.hx * 0.5, GP.z - VS.hz * 0.5, Math.atan2(VS.hx, VS.hz));
  for (let i = 0; i < 30 && sim.player.mode !== Mode.HITCH; i++) step(game, log, { hold: true });
  expect(sim.player.mode).toBe(Mode.HITCH);
  step(game, log, { hold: true }, 30);
  step(game, log, { hold: false }, 90);
}

function newGame(): Game {
  resetFeel();
  return new Game(world(), { seed: 1, startDayFrac: 0.3, errands: [], conductors: [] });
}

describe('secrets', () => {
  it('hitching the ghost tram and the blimp each find their secret, once', () => {
    const game = newGame();
    const log: Log = { events: [] };
    catchLine(game, log, 0);
    expect(found(log)).toEqual(['ghost']);
    catchLine(game, log, 0);
    expect(found(log)).toEqual(['ghost']);
    catchLine(game, log, 1);
    expect(found(log)).toEqual(['ghost', 'blimp']);
    expect(Object.keys(game.secrets.found).sort()).toEqual(['blimp', 'ghost']);
  });

  it('the needle is found by touching down in its zone, not by flying through it', () => {
    const game = newGame();
    const log: Log = { events: [] };
    const p = game.sim.player;
    // Passing over it in the air, 3 m up and moving on: nothing.
    placePlayer(game.sim.world, p, -50, 44, 0);
    p.mode = Mode.AIR;
    p.y = 3;
    p.vy = 6;
    p.vz = 14;
    step(game, log, {}, 30);
    expect(found(log)).toEqual([]);
    // Dropping onto it.
    placePlayer(game.sim.world, p, -50, 50, 0);
    p.mode = Mode.AIR;
    p.y = 3;
    p.vy = 0;
    step(game, log, {}, 20);
    expect(found(log)).toEqual([]);
    step(game, log, {}, 60);
    expect(found(log)).toEqual(['needle']);
    step(game, log, {}, 60);
    expect(found(log)).toEqual(['needle']);
  });

  it('rolling into the ghost tunnel finds it, once', () => {
    const game = newGame();
    const log: Log = { events: [] };
    placePlayer(game.sim.world, game.sim.player, 0, 40, 0);
    game.sim.player.speed = 6;
    step(game, log, {}, 30);
    expect(found(log)).toEqual([]);
    step(game, log, {}, 120);
    expect(found(log)).toEqual(['tunnel']);
    placePlayer(game.sim.world, game.sim.player, 0, 60, 0);
    step(game, log, {}, 10);
    expect(found(log)).toEqual(['tunnel']);
  });

  it('found secrets round-trip through a save and are not found again', () => {
    const game = newGame();
    const log: Log = { events: [] };
    placePlayer(game.sim.world, game.sim.player, 0, 60, 0);
    step(game, log);
    const tick = game.sim.tick;
    const data = JSON.parse(JSON.stringify(game.reducers.find((r) => r.key === 'secrets')?.exportState?.()));
    const other = newGame();
    const r = other.reducers.find((x) => x.key === 'secrets');
    r?.importState?.(data);
    expect(other.secrets.found).toEqual({ tunnel: tick });
    const ol: Log = { events: [] };
    placePlayer(other.sim.world, other.sim.player, 0, 60, 0);
    step(other, ol, {}, 5);
    expect(found(ol)).toEqual([]);
    r?.importState?.({ v: 1, found: { tunnel: -1, ghost: 'x', bogus: 3 } });
    expect(other.secrets.found).toEqual({});
  });
});
