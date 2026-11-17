import { describe, expect, it } from 'vitest';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { CHALK_MIN_TICKS, encodeChalk } from '../../src/sim/game/chalk';
import { Game } from '../../src/sim/game/game';
import { inkedCount } from '../../src/sim/game/progress';
import { DEFAULT_SETTINGS, SAVE_VERSION, exportSave, importSave, migrate, type SaveData } from '../../src/sim/game/save';
import { Mode } from '../../src/sim/types';
import { Surface, terrainSurface, type World } from '../../src/sim/world';
import { seekVehicle, slice, teleport } from './helpers';

function newGame(): Game {
  resetFeel();
  return new Game(slice(), { seed: 1, startDayFrac: 0.3 });
}

const roundTrip = (d: SaveData): unknown => JSON.parse(JSON.stringify(d));

/** A game with some ink (rode the tram a while) and one raced chalk line with a best time. */
function playedGame(): Game {
  const g = newGame();
  seekVehicle(g.sim, 0, 0, 60, 1, 60);
  teleport(g.sim, -1.5, 62, 0, 5);
  g.step({ steer: 0, hold: false, hop: false });
  expect(g.chalkStartRecording().ok).toBe(true);
  for (let i = 0; i < 3600; i++) g.step({ steer: 0, hold: true, hop: false });
  expect(g.chalkStopRecording('Tram run').ok).toBe(true);
  // Let go and roll a while so the safe spot is somewhere new.
  for (let i = 0; i < 400; i++) g.step({ steer: 0.2, hold: false, hop: false });
  const line = g.chalk.lines[0];
  line.bestTicks = 3550;
  return g;
}

function firstWater(w: World): { x: number; z: number } {
  for (let z = w.minZ + 2; z < w.maxZ; z += 2) {
    for (let x = w.minX + 2; x < w.maxX; x += 2) if (terrainSurface(w, x, z) === Surface.WATER) return { x, z };
  }
  throw new Error('no water in the slice');
}

describe('saves', () => {
  it('a save round-trips through JSON into a fresh game: progress, chalk lines, clock and skater', () => {
    const g = playedGame();
    let inked = 0;
    for (let i = 0; i < g.progress.lines.length; i++) inked += inkedCount(g.progress, i);
    expect(inked).toBeGreaterThan(0);
    const settings = { music: 0.4, sfx: 0.7, haptics: false, hints: true };
    const data = migrate(roundTrip(exportSave(g, settings)));
    expect(data).not.toBeNull();
    if (!data) return;
    const h = newGame();
    const back = importSave(h, data);
    expect(back).toEqual(settings);
    expect(h.progress.lines.map((l) => l.inked)).toEqual(g.progress.lines.map((l) => l.inked));
    expect(h.progress.lines.map((l) => l.complete)).toEqual(g.progress.lines.map((l) => l.complete));
    expect(h.chalk.lines.length).toBe(1);
    expect(h.chalk.lines[0]).toEqual(g.chalk.lines[0]);
    expect(h.chalk.lines[0].bestTicks).toBe(3550);
    expect(h.sim.tick % DAY_TICKS).toBe(g.sim.tick % DAY_TICKS);
    const p = h.sim.player;
    expect(p.mode).toBe(Mode.GROUND);
    expect(p.speed).toBe(0);
    expect(p.x).toBe(g.sim.player.safeX);
    expect(p.z).toBe(g.sim.player.safeZ);
    expect(p.heading).toBe(g.sim.player.safeHeading);
    // And the game runs on from there.
    for (let i = 0; i < 120; i++) h.step({ steer: 0, hold: false, hop: false });
    expect(Number.isFinite(h.sim.player.x)).toBe(true);
  });

  it('garbage, unknown versions and missing required fields migrate to null without throwing', () => {
    const good = roundTrip(exportSave(newGame(), DEFAULT_SETTINGS)) as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'save',
      [],
      {},
      { ...good, version: 0 },
      { ...good, version: SAVE_VERSION + 1 },
      { ...good, version: '1' },
      { ...good, player: undefined },
      { ...good, player: { x: 1, z: 2, heading: 0 } },
      { ...good, player: { x: null, z: 2, heading: 0, dayTick: 5 } },
      { ...good, player: { x: 1, z: 2, heading: 0, dayTick: DAY_TICKS } },
      { ...good, player: { x: 1, z: 2, heading: 0, dayTick: 1.5 } },
    ];
    for (const b of bad) expect(migrate(b)).toBeNull();
    // A throwing getter is unrecognisable too, not a crash.
    const evil = { version: 1, get player(): unknown { throw new Error('boom'); } };
    expect(migrate(evil)).toBeNull();
  });

  it('missing optional fields take defaults', () => {
    const g = newGame();
    const d = roundTrip(exportSave(g, DEFAULT_SETTINGS)) as Record<string, unknown>;
    delete d.settings;
    delete d.reducers;
    delete d.savedAtTick;
    const m = migrate(d);
    expect(m).not.toBeNull();
    expect(m?.settings).toEqual(DEFAULT_SETTINGS);
    expect(m?.reducers).toEqual({});
    expect(m?.savedAtTick).toBe(0);
    const s = migrate({ ...d, settings: { music: 3, sfx: 'loud', haptics: 1, hints: false } });
    expect(s?.settings).toEqual({ music: 1, sfx: 1, haptics: true, hints: false });
  });

  it('a malformed reducer section resets only that reducer', () => {
    const g = playedGame();
    const base = roundTrip(exportSave(g, DEFAULT_SETTINGS)) as SaveData;
    const inkOf = (q: Game): boolean[][] => q.progress.lines.map((l) => l.inked);

    const junkProgress = migrate({ ...base, reducers: { ...base.reducers, progress: 'junk' } });
    if (!junkProgress) throw new Error('should migrate');
    const a = newGame();
    importSave(a, junkProgress);
    expect(inkOf(a)).toEqual(inkOf(newGame()));
    expect(a.chalk.lines.length).toBe(1);

    const junkChalk = migrate({ ...base, reducers: { ...base.reducers, chalk: { lines: [{ code: 'SK1-nope', best: 3 }, 7, null] } } });
    if (!junkChalk) throw new Error('should migrate');
    const b = newGame();
    importSave(b, junkChalk);
    expect(b.chalk.lines.length).toBe(0);
    expect(inkOf(b)).toEqual(inkOf(g));

    // A bad best time keeps the line but not the time.
    const code = encodeChalk(g.chalk.lines[0]);
    const badBest = migrate({ ...base, reducers: { ...base.reducers, chalk: { v: 1, lines: [{ code, best: -4 }] } } });
    if (!badBest) throw new Error('should migrate');
    const c = newGame();
    importSave(c, badBest);
    expect(c.chalk.lines.length).toBe(1);
    expect(c.chalk.lines[0].bestTicks).toBe(0);
  });

  it('importing a save drops a recording or race in progress', () => {
    const g = playedGame();
    const data = migrate(roundTrip(exportSave(g, DEFAULT_SETTINGS)));
    if (!data) throw new Error('should migrate');
    const h = newGame();
    for (let i = 0; i < 30; i++) h.step({ steer: 0, hold: false, hop: false });
    expect(h.chalkStartRecording().ok).toBe(true);
    for (let i = 0; i < CHALK_MIN_TICKS + 10; i++) h.step({ steer: 0, hold: false, hop: false });
    importSave(h, data);
    expect(h.chalk.mode).toBe('idle');
    expect(h.chalkStartRace(h.chalk.lines[0].id).ok).toBe(true);
    importSave(h, data);
    expect(h.chalk.mode).toBe('idle');
    expect(h.chalk.ghost).toBeNull();
  });

  it('a save never puts the skater over water', () => {
    const w = slice();
    const wet = firstWater(w);
    const g = newGame();
    const d = exportSave(g, DEFAULT_SETTINGS);
    for (const spot of [wet, { x: Number.NaN, z: 0 }, { x: w.maxX + 50, z: 0 }]) {
      const data = migrate(roundTrip({ ...d, player: { ...d.player, x: spot.x, z: spot.z } }));
      const h = newGame();
      if (!data) {
        // NaN becomes null in JSON and is rejected outright: the game keeps its own start.
        expect(Number.isNaN(spot.x)).toBe(true);
        continue;
      }
      importSave(h, data);
      expect(terrainSurface(w, h.sim.player.x, h.sim.player.z)).not.toBe(Surface.WATER);
      expect(h.sim.player.x).toBe(w.spawn.x);
      expect(h.sim.player.z).toBe(w.spawn.z);
    }
    // A skater who rolled into the sea and bailed saves their last dry spot.
    const s = newGame();
    teleport(s.sim, wet.x, wet.z + 0.01, 0, 0);
    for (let i = 0; i < 30; i++) s.step({ steer: 0, hold: false, hop: false });
    const data = migrate(roundTrip(exportSave(s, DEFAULT_SETTINGS)));
    if (!data) throw new Error('should migrate');
    const h = newGame();
    importSave(h, data);
    expect(terrainSurface(w, h.sim.player.x, h.sim.player.z)).not.toBe(Surface.WATER);
    expect(h.sim.player.mode).toBe(Mode.GROUND);
  });
});
