import { describe, expect, it } from 'vitest';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { DEFAULT_DECK, DEFAULT_KIT, districtFinds, tileThresholds, wornDeck } from '../../src/sim/game/finds';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { exportSave, importSave, migrate, DEFAULT_SETTINGS } from '../../src/sim/game/save';
import { compileLine, grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Mode, type InputFrame } from '../../src/sim/types';
import { District, Surface, addPickup, addZone, createWorld, fillSurfaces, finalizeWorld, type World } from '../../src/sim/world';
import { testLine } from './helpers';

/**
 * A flat plaza in two districts (Docks below z = 0, Mercado above) with water along its east edge,
 * a tram circuit round the origin, six tiles, two spots, two landmarks and one timed route.
 */
function world(): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, (x) => (x > 88 ? Surface.WATER : Surface.PLAZA));
  w.bands = [
    { district: District.DOCKS, zMin: -Infinity, zMax: 0 },
    { district: District.MERCADO, zMin: 0, zMax: Infinity },
  ];
  w.lines = [compileLine(testLine({ id: 'T1' }), 0)];
  w.spawn = { x: 0, z: -80, heading: 0 };
  finalizeWorld(w);
  // A trail up x = 0 (two on the line, one a step off it), one high in the air, one on the tram's
  // east side, one down in the Docks.
  addPickup(w, 'tile', 0, 0.8, 20, 0);
  addPickup(w, 'tile', 0, 0.8, 30, 0);
  addPickup(w, 'tile', 1.2, 1.2, 40, 1);
  addPickup(w, 'tile', -40, 4.5, 20, 2);
  addPickup(w, 'tile', 30, 1.0, 0, 1);
  addPickup(w, 'tile', -40, 0.8, -40, 0);
  // Not a tile: ignored by the counts.
  addPickup(w, 'coin', 0, 0.8, 60, 0);
  addZone(w, { id: 'gatos', name: 'Salto de los Gatos', kind: 'spot', x: -60, y: 0, z: 60, r: 4 });
  addZone(w, { id: 'tobogan', name: 'El Tobogán', kind: 'spot', x: -60, y: 0, z: -60, r: 4 });
  addZone(w, { id: 'torre', name: 'Torre del Reloj', kind: 'landmark', x: 60, y: 0, z: 60, r: 6 });
  addZone(w, { id: 'mercado', name: 'Mercado', kind: 'landmark', x: 20, y: 0, z: 80, r: 6 });
  addZone(w, { id: 'bajada_a', name: 'La Bajada', kind: 'routeStart', x: 60, y: 0, z: -60, r: 4 });
  addZone(w, { id: 'bajada_b', name: 'La Bajada', kind: 'routeEnd', x: 60, y: 0, z: -20, r: 4 });
  return w;
}

interface Log {
  events: GameEvent[];
  /** Sim events, as `type` or `flowEnd:count:bailed`. */
  sim?: string[];
}

function newGame(): Game {
  resetFeel();
  return new Game(world(), { seed: 1, startDayFrac: 0.3, errands: [], conductors: [] });
}

function step(game: Game, log: Log, input: Partial<InputFrame> = {}, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.step({ steer: input.steer ?? 0, hold: input.hold ?? false, hop: input.hop ?? false });
    for (const e of game.events) log.events.push(e);
    for (const e of game.sim.events) (log.sim ??= []).push(e.type === 'flowEnd' ? `flowEnd:${e.count}:${e.bailed}` : e.type);
  }
}

function roll(game: Game, x: number, z: number, heading: number, speed: number): void {
  placePlayer(game.sim.world, game.sim.player, x, z, heading);
  game.sim.player.speed = speed;
}

const of = <T extends GameEvent['type']>(log: Log, type: T): Extract<GameEvent, { type: T }>[] =>
  log.events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('finds: tiles', () => {
  it('a tile is taken when the body passes within 1.8 m, only once, with counts', () => {
    const game = newGame();
    const log: Log = { events: [] };
    // Rolling up x = 2.4: 2.4 m from the first two, 1.2 m from the third.
    roll(game, 2.4, 10, 0, 9);
    step(game, log, {}, 60 * 4);
    let tiles = of(log, 'tile');
    expect(tiles.map((e) => e.index)).toEqual([2]);
    // Up the middle: the first two (the third is already taken).
    roll(game, 0, 10, 0, 9);
    step(game, log, {}, 60 * 4);
    tiles = of(log, 'tile');
    expect(tiles.map((e) => e.index)).toEqual([2, 0, 1]);
    expect(tiles.map((e) => e.count)).toEqual([1, 2, 3]);
    expect(tiles.every((e) => e.total === 6)).toBe(true);
    expect(tiles.map((e) => [e.tier, e.district])).toEqual([
      [1, District.MERCADO],
      [0, District.MERCADO],
      [0, District.MERCADO],
    ]);
    // Again: nothing more.
    roll(game, 0, 10, 0, 9);
    step(game, log, {}, 60 * 4);
    expect(of(log, 'tile')).toHaveLength(3);
    const f = game.finds;
    expect(f.count).toBe(3);
    expect(districtFinds(f, District.MERCADO)).toMatchObject({ tiles: 3, tilesTotal: 5 });
    expect(districtFinds(f, District.DOCKS)).toMatchObject({ tiles: 0, tilesTotal: 1 });
    // Per tier: Mercado has two tier 0, two tier 1, one tier 2; found two and one.
    const M = District.MERCADO * 3;
    expect(f.catalog.totals.slice(M, M + 3)).toEqual([2, 2, 1]);
    expect(f.found.slice(M, M + 3)).toEqual([2, 1, 0]);
  });

  it('an airborne skater takes a tile high in the air that the ground cannot reach', () => {
    const game = newGame();
    const log: Log = { events: [] };
    roll(game, -40, 10, 0, 9);
    step(game, log, {}, 60 * 3);
    expect(of(log, 'tile')).toHaveLength(0);
    const p = game.sim.player;
    placePlayer(game.sim.world, p, -40, 17, 0);
    p.mode = Mode.AIR;
    p.y = 3.6;
    p.vy = 1;
    p.vx = 0;
    p.vz = 9;
    step(game, log, {}, 40);
    expect(of(log, 'tile').map((e) => e.index)).toEqual([3]);
  });

  it('a towed skater takes a tile on the ride\'s path', () => {
    const game = newGame();
    const log: Log = { events: [] };
    const sim = game.sim;
    const L = sim.world.lines[0];
    const VS = makeVehicleState();
    const GP = { x: 0, y: 0, z: 0 };
    // The tram heading up the east side (+z) at speed, well south of the tile.
    for (let t = 0; t < DAY_TICKS; t++) {
      vehicleAt(L, 0, t, VS);
      if (VS.active && VS.hz > 0.9 && VS.z > -24 && VS.z < -18 && Math.hypot(VS.vx, VS.vz) > 5) {
        sim.tick = t;
        break;
      }
    }
    grabPoint(L, VS, GP);
    placePlayer(sim.world, sim.player, GP.x - VS.hx * 0.5, GP.z - VS.hz * 0.5, Math.atan2(VS.hx, VS.hz));
    for (let i = 0; i < 30 && sim.player.mode !== Mode.HITCH; i++) step(game, log, { hold: true });
    expect(sim.player.mode).toBe(Mode.HITCH);
    expect(sim.player.z).toBeLessThan(-2);
    let towedAtTile = false;
    for (let i = 0; i < 300 && of(log, 'tile').length === 0; i++) {
      step(game, log, { hold: true });
      if (of(log, 'tile').length > 0) towedAtTile = sim.player.mode === Mode.HITCH;
    }
    expect(of(log, 'tile').map((e) => e.index)).toEqual([4]);
    expect(towedAtTile).toBe(true);
  });

  it('a tile keeps a flow line alive without adding a trick to it', () => {
    // Control: a two-trick line with 0.3 s left ends in 0.3 s.
    const a = newGame();
    const la: Log = { events: [] };
    roll(a, 6, 10, 0, 9);
    a.sim.player.flow = 2;
    a.sim.player.flowTime = 0.3;
    step(a, la, {}, 30);
    expect(a.sim.player.flow).toBe(0);
    // Through a tile 0.1 s in: the window starts again; the line is still two tricks.
    const b = newGame();
    const lb: Log = { events: [] };
    const ends: Array<[number, number]> = [];
    let tricks = 0;
    // Facing away from the tile 1.2 m behind: it is taken on the first tick, and nothing else is near.
    roll(b, 0, 18.8, Math.PI, 9);
    b.sim.player.flow = 2;
    b.sim.player.flowTime = 0.3;
    for (let i = 0; i < 60 * 8 && ends.length === 0; i++) {
      step(b, lb);
      for (const e of b.sim.events) {
        if (e.type === 'flowEnd') ends.push([i, e.count]);
        else if (e.type === 'flow') tricks++;
      }
      if (i === 30) {
        expect(b.sim.player.flow).toBe(2);
        expect(b.sim.player.flowTime).toBeGreaterThan(FEEL.FLOW_WINDOW - 0.6);
      }
    }
    expect(of(lb, 'tile').map((e) => e.index)).toEqual([0]);
    // The line ran a whole window from the tile, and ended as it was: two tricks, none added.
    expect(ends).toHaveLength(1);
    expect(ends[0][0]).toBeGreaterThan(Math.round(FEEL.FLOW_WINDOW * 60) - 5);
    expect(ends[0][1]).toBe(2);
    expect(tricks).toBe(0);
  });
});

describe('finds: spots, postcards, lines and runs', () => {
  it('a spot needs air or speed; it is found once', () => {
    const game = newGame();
    const log: Log = { events: [] };
    // Slowly through it: nothing.
    roll(game, -60, 50, 0, 4);
    step(game, log, {}, 60 * 5);
    expect(game.sim.player.z).toBeGreaterThan(66);
    expect(of(log, 'spot')).toHaveLength(0);
    // In the air, slowly: found.
    const p = game.sim.player;
    placePlayer(game.sim.world, p, -60, 57, 0);
    p.mode = Mode.AIR;
    p.y = 1.5;
    p.vy = 2;
    p.vx = 0;
    p.vz = 4;
    step(game, log, {}, 60);
    expect(of(log, 'spot').map((e) => e.name)).toEqual(['Salto de los Gatos']);
    // At speed on the ground: the other one.
    roll(game, -60, -75, 0, 11);
    step(game, log, {}, 60 * 2);
    expect(of(log, 'spot').map((e) => e.id)).toEqual(['gatos', 'tobogan']);
    roll(game, -60, -75, 0, 11);
    step(game, log, {}, 60 * 2);
    expect(of(log, 'spot')).toHaveLength(2);
  });

  it('a postcard comes once, the first time a landmark is reached', () => {
    const game = newGame();
    const log: Log = { events: [] };
    roll(game, 60, 40, 0, 6);
    step(game, log, {}, 60 * 6);
    roll(game, 60, 40, 0, 6);
    step(game, log, {}, 60 * 6);
    expect(of(log, 'postcard').map((e) => e.id)).toEqual(['torre']);
    expect(game.finds.postcards.torre).toBeGreaterThan(0);
  });

  it('the best line of a district changes only when beaten, never from a bailed line', () => {
    const game = newGame();
    const log: Log = { events: [] };
    const p = game.sim.player;
    const line = (n: number, x: number, z: number): void => {
      roll(game, x, z, 0, 3);
      p.flow = n;
      p.flowTime = 0.1;
      step(game, log, {}, 30);
    };
    line(3, -20, 50);
    line(2, -20, 50);
    line(3, -20, 50);
    line(4, -20, -50);
    line(5, -20, 50);
    // A six-trick line that ends in the water: bailed.
    roll(game, 84, 50, Math.PI / 2, 8);
    p.flow = 6;
    p.flowTime = 3;
    log.sim = [];
    step(game, log, {}, 60 * 5);
    expect(log.sim).toContain('bail');
    expect(log.sim).toContain('flowEnd:6:true');
    expect(of(log, 'bestLine').map((e) => [e.district, e.count, e.first])).toEqual([
      [District.MERCADO, 3, true],
      [District.DOCKS, 4, true],
      [District.MERCADO, 5, false],
    ]);
    expect(game.finds.bestLines[District.MERCADO]).toBe(5);
  });

  it('the best run of a route changes only when beaten, never from a run with a bail', () => {
    const game = newGame();
    const log: Log = { events: [] };
    const run = (speed: number): void => {
      roll(game, 60, -62, 0, speed);
      step(game, log, {}, 60 * 8);
    };
    run(8);
    run(14);
    run(9);
    const runs = of(log, 'bestRun');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ name: 'La Bajada', first: true });
    expect(runs[1].first).toBe(false);
    expect(runs[1].ticks).toBeLessThan(runs[0].ticks);
    // About 36 m from leaving the start to entering the end.
    expect(runs[1].ticks / 60).toBeGreaterThan(36 / 16);
    expect(runs[1].ticks / 60).toBeLessThan(36 / 11);
    // Out of the start into the water, then (put back) straight into the end: no run.
    roll(game, 60, -60, Math.PI / 2, 14);
    log.sim = [];
    step(game, log, {}, 60 * 4);
    expect(log.sim).toContain('bail');
    expect(log.events.some((e) => e.type === 'bestRun' && e !== runs[0] && e !== runs[1])).toBe(false);
    roll(game, 60, -21, 0, 1);
    step(game, log, {}, 30);
    expect(of(log, 'bestRun')).toHaveLength(2);
    expect(game.finds.bestRuns['La Bajada']).toBe(runs[1].ticks);
  });
});

describe('finds: unlocks and the wardrobe', () => {
  /** Take every tile by putting the skater on each in turn. */
  function takeAll(game: Game, log: Log): void {
    for (const t of game.sim.world.pickups) {
      const p = game.sim.player;
      placePlayer(game.sim.world, p, t.x, t.z - 0.5, 0);
      p.mode = Mode.AIR;
      p.y = t.y - 0.5;
      p.vy = 0;
      p.vz = 1;
      step(game, log, {}, 2);
    }
  }

  it('each threshold unlocks once, scaled to the world; postcards and a district\'s spots unlock too', () => {
    expect(tileThresholds(60)).toEqual([5, 15, 30, 45, 60]);
    expect(tileThresholds(6)).toEqual([1, 2, 3, 5, 6]);
    const game = newGame();
    const log: Log = { events: [] };
    takeAll(game, log);
    takeAll(game, log);
    expect(game.finds.count).toBe(6);
    const tileUnlocks = of(log, 'unlock');
    expect(tileUnlocks.map((e) => e.name)).toEqual(['Mango Check', 'Cobalt Stripe', 'Pink Dip', 'Sea Bands', 'Gold Run']);
    // The 5th tile was the 5th unlock's: unlocks come right after the tile that earned them.
    const idx = log.events.findIndex((e) => e.type === 'unlock' && e.name === 'Sea Bands');
    expect(log.events[idx - 1]).toMatchObject({ type: 'tile', count: 5 });
    // A postcard: its kit.
    roll(game, 20, 70, 0, 6);
    step(game, log, {}, 60 * 3);
    expect(of(log, 'unlock').slice(5).map((e) => [e.slot, e.name])).toEqual([['kit', 'Brick & Paper']]);
    // Both spots are in different districts: each district's deck comes with its last spot.
    roll(game, -60, -75, 0, 11);
    step(game, log, {}, 60 * 2);
    expect(of(log, 'unlock').slice(6).map((e) => [e.slot, e.name])).toEqual([['deck', 'Brick Bands']]);
    roll(game, -60, 45, 0, 11);
    step(game, log, {}, 60 * 2);
    expect(of(log, 'unlock').slice(7).map((e) => [e.slot, e.name])).toEqual([['deck', 'Leaf Stripe']]);
  });

  it('findsWear accepts only an unlocked deck or kit', () => {
    const game = newGame();
    const log: Log = { events: [] };
    expect(game.finds.deck).toBe(DEFAULT_DECK.id);
    expect(game.finds.kit).toBe(DEFAULT_KIT.id);
    expect(game.findsWear('deck.mangoCheck').ok).toBe(false);
    expect(game.findsWear('no.such').ok).toBe(false);
    expect(game.finds.deck).toBe(DEFAULT_DECK.id);
    takeAll(game, log);
    expect(game.findsWear('deck.mangoCheck').ok).toBe(true);
    expect(wornDeck(game.finds).name).toBe('Mango Check');
    // A kit from a postcard not yet sent: no.
    expect(game.findsWear('kit.seaSalt').ok).toBe(false);
    roll(game, 60, 50, 0, 6);
    step(game, log, {}, 60 * 3);
    expect(game.findsWear('kit.seaSalt').ok).toBe(true);
    expect(game.finds.kit).toBe('kit.seaSalt');
    // Wearing a kit leaves the deck on; the street deck is always there.
    expect(game.finds.deck).toBe('deck.mangoCheck');
    expect(game.findsWear(DEFAULT_DECK.id).ok).toBe(true);
    expect(game.finds.deck).toBe(DEFAULT_DECK.id);
  });
});

describe('finds: saves and determinism', () => {
  it('everything survives a save through the real save code; an old save loads with nothing found', () => {
    const game = newGame();
    const log: Log = { events: [] };
    roll(game, 0, 10, 0, 9);
    step(game, log, {}, 60 * 4);
    roll(game, 60, 50, 0, 6);
    step(game, log, {}, 60 * 3);
    roll(game, -60, -75, 0, 11);
    step(game, log, {}, 60 * 2);
    roll(game, 60, -62, 0, 12);
    step(game, log, {}, 60 * 6);
    expect(game.findsWear('deck.cobaltStripe').ok).toBe(true);
    expect(game.findsWear('kit.seaSalt').ok).toBe(true);
    const before = JSON.parse(JSON.stringify(game.reducers.find((r) => r.key === 'finds')?.exportState?.()));
    const saved = JSON.parse(JSON.stringify(exportSave(game, DEFAULT_SETTINGS)));
    const data = migrate(saved);
    if (!data) throw new Error('the save should migrate');
    const other = newGame();
    importSave(other, data);
    const f = other.finds;
    expect(f.count).toBe(3);
    expect(Object.keys(f.spots)).toEqual(['tobogan']);
    expect(Object.keys(f.postcards)).toEqual(['torre']);
    expect(f.bestRuns['La Bajada']).toBe(game.finds.bestRuns['La Bajada']);
    expect(f.deck).toBe('deck.cobaltStripe');
    expect(f.kit).toBe('kit.seaSalt');
    expect(f.unlocked).toEqual(game.finds.unlocked);
    expect(JSON.parse(JSON.stringify(other.reducers.find((r) => r.key === 'finds')?.exportState?.()))).toEqual(before);
    // Taken tiles stay taken.
    const ol: Log = { events: [] };
    roll(other, 0, 10, 0, 9);
    step(other, ol, {}, 60 * 4);
    expect(of(ol, 'tile')).toHaveLength(0);

    // A version 2 save (before finds), even one carrying a stray section: nothing found.
    const old = migrate({ ...saved, version: 2 });
    if (!old) throw new Error('a version 2 save should migrate');
    const fresh = newGame();
    importSave(fresh, old);
    expect(fresh.finds.count).toBe(0);
    expect(fresh.finds.unlocked).toEqual({});
    expect(fresh.finds.deck).toBe(DEFAULT_DECK.id);
    // Malformed sections leave it fresh; a saved deck that is not unlocked is not worn.
    const r = fresh.reducers.find((x) => x.key === 'finds');
    r?.importState?.({ v: 1, tiles: [-1, 99, 'x', 6], spots: { gatos: -3, nope: 4 }, deck: 'deck.goldRun', kit: 7 });
    expect(fresh.finds.count).toBe(0);
    expect(fresh.finds.spots).toEqual({});
    expect(fresh.finds.deck).toBe(DEFAULT_DECK.id);
  });

  it('is deterministic', () => {
    const script = (game: Game): string => {
      const log: Log = { events: [] };
      roll(game, 0, 10, 0.05, 11);
      for (let i = 0; i < 60 * 10; i++) step(game, log, { steer: ((i >> 5) & 1) === 0 ? 0.4 : -0.4, hop: i % 97 === 0 });
      return JSON.stringify([log.events, game.reducers.find((r) => r.key === 'finds')?.exportState?.(), game.sim.hash()]);
    };
    expect(script(newGame())).toBe(script(newGame()));
  });
});
