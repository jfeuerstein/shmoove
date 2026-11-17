/**
 * The full-game check: the shipped game can be finished by play alone.
 *
 * A scripted skater (tests/sim/bot) starts a new game exactly as the app does on first launch (the
 * city, its spawn, the new-game clock, the lesson on) and, feeding nothing but InputFrames to
 * Game.step, plays until the line map is complete, then goes on to the secret lines. Nothing here
 * writes to the sim or the game; the only way state changes is a step, or the real save code.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { NEW_GAME_DAY_FRAC } from '../../src/app/newGame';
import { buildCity } from '../../src/sim/city';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { mapFraction } from '../../src/sim/game/progress';
import { DEFAULT_SETTINGS, exportSave, importSave, migrate } from '../../src/sim/game/save';
import { SECRET_IDS } from '../../src/sim/game/secrets';
import { Mode } from '../../src/sim/types';
import type { World } from '../../src/sim/world';
import { dayTick } from './bot/geo';
import { fullGamePlan } from './bot/plan';
import { makeRunner, newBook, newGame, type Book } from './bot/run';
import { Skater } from './bot/skater';

const started = performance.now();
let world: World;

beforeAll(() => {
  resetFeel();
  world = buildCity(1).world;
});

/** Where a save is taken: the first calm moment (waiting at a stop) once `when` holds. */
interface SavePoint {
  name: string;
  when: (g: Game) => boolean;
}

interface Played {
  game: Game;
  bot: Skater;
  book: Book;
  /** Tick mapComplete came out on, or -1. */
  mapTick: number;
  /** The book as it stood at mapComplete. */
  atMap: { bails: number; longestStall: number; stallEndAt: number; maxStep: number; jumps: number; ticks: number };
  /** Tick the save was taken at (in the first game), or -1. */
  savedAt: number;
  /** Game events from the save on (or all of them), as [dayTick, event]. */
  after: [number, GameEvent][];
}

/** Ticks of play allowed after the plan ends: the last fall and its recovery. */
const SETTLE = 10 * 60;
/** Most simulated time the whole run may take, ticks: the map in 90 minutes, the secrets after. */
const MAX_TICKS = 8 * DAY_TICKS;

const PROGRESS_EVENTS = new Set(['segmentInked', 'lineComplete', 'lineDiscovered', 'mapComplete', 'secretFound', 'onboardingComplete']);

function play(save?: SavePoint): Played {
  resetFeel();
  let game = newGame(world);
  const bot = new Skater(game, fullGamePlan());
  const book = newBook(game);
  const r = makeRunner(game, bot, book);
  let mapTick = -1;
  let atMap: Played['atMap'] = { bails: 0, longestStall: 0, stallEndAt: 0, maxStep: 0, jumps: 0, ticks: 0 };
  let savedAt = -1;
  let fromEvent = 0;
  const mapDone = (): boolean => game.progress.mapComplete;
  // A save resumes the skater at rest at their last safe spot, which the game refreshes every half
  // second on the ground: take it once they stand still on a planted foot and that spot is where
  // they stand, so the loaded game starts from the same place.
  const settled = (): boolean => {
    const p = game.sim.player;
    return p.speed < 0.05 && Math.hypot(p.x - p.safeX, p.z - p.safeZ) < 0.05;
  };
  const saveDue = (): boolean => save !== undefined && savedAt < 0 && save.when(game) && bot.waiting && settled();
  // Up to the save (if any), then to the map, then to the end of the plan.
  while (!bot.done && book.ticks < MAX_TICKS) {
    r.run(MAX_TICKS - book.ticks, () => saveDue() || (mapTick < 0 && mapDone()));
    if (mapTick < 0 && mapDone()) {
      mapTick = game.sim.tick;
      atMap = { bails: book.bails, longestStall: book.longestStall, stallEndAt: book.stallEndAt, maxStep: book.maxStep, jumps: book.jumps.length, ticks: book.ticks };
    }
    if (saveDue() && save) {
      savedAt = game.sim.tick;
      fromEvent = book.events.length;
      // The real save code, through a JSON string as the app stores it.
      const json = JSON.stringify(exportSave(game, DEFAULT_SETTINGS));
      const data = migrate(JSON.parse(json));
      if (!data) throw new Error('the save did not read back');
      // A boot with a stored save: a new game, then the save put into it.
      const fresh = new Game(world, { seed: 1, startDayFrac: NEW_GAME_DAY_FRAC });
      const settings = importSave(fresh, data);
      fresh.onboardingSetHints(settings.hints);
      game = fresh;
      r.game = fresh;
      bot.rebind(fresh);
    }
  }
  if (bot.done && !bot.failure) r.run(SETTLE, undefined, true);
  const after: [number, GameEvent][] = book.events.slice(fromEvent).map((x) => [dayTick(x.tick), x.e]);
  return { game, bot, book, mapTick, atMap, savedAt, after };
}

const lineIds = (): string[] => world.lines.map((l) => l.id);
const regular = (): number[] => world.lines.filter((l) => l.secret !== true).map((l) => l.index);

/**
 * The skater's fields a load resets that are only memory of the past: where they resume (the last
 * safe spot) and the half-second clock that refreshes it, which a load restarts from zero, and the
 * last handrail ground (its state is kept after stepping off it). Everything else about the skater
 * is compared bit for bit.
 */
const RESUME_FIELDS = new Set(['safeX', 'safeY', 'safeZ', 'safeHeading', 'safeTimer', 'rail', 'railS', 'railV', 'lastRail']);
const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);

/**
 * The game's state as a string: the skater bit for bit (but for RESUME_FIELDS) and the time of day,
 * the map, the secrets and the lesson. The day count is left out: a save keeps the time of day, not
 * the day, so a loaded game counts its days from zero again.
 */
function stateHash(g: Game): string {
  if (g.sim.player.mode === Mode.GRIND) throw new Error('compare state off the rails');
  let h = 0x811c9dc5 ^ dayTick(g.sim.tick);
  const rec = g.sim.player as unknown as Record<string, number>;
  for (const k of Object.keys(rec)) {
    if (RESUME_FIELDS.has(k)) continue;
    _f64[0] = rec[k];
    h = Math.imul(h ^ _u32[0], 0x01000193);
    h = Math.imul(h ^ _u32[1], 0x01000193);
  }
  const found = SECRET_IDS.map((id) => (g.secrets.found[id] === undefined ? '-' : 'y')).join('');
  const map = g.progress.lines.map((l) => l.inked.map((b) => (b ? 1 : 0)).join('')).join('/');
  return `${h >>> 0} ${map} ${found} ${g.onboarding.complete ? 'lesson' : 'no-lesson'}`;
}

function progressEvents(list: [number, GameEvent][]): string[] {
  return list.filter(([, e]) => PROGRESS_EVENTS.has(e.type)).map(([t, e]) => `${t} ${JSON.stringify(e)}`);
}

let full: Played;

describe('the full game, by play alone', () => {
  beforeAll(() => {
    full = play();
  });

  it('a new game is played to a complete line map: the lesson, every regular segment, mapComplete once, in under 90 minutes', () => {
    const { game, bot, book, atMap, mapTick } = full;
    expect(bot.failure, bot.log.slice(-15).join('\n')).toBe('');
    expect(mapTick).toBeGreaterThan(0);
    const ev = book.events.map((x) => x.e);
    // The lesson completes, and before the map does.
    const lesson = book.events.findIndex((x) => x.e.type === 'onboardingComplete');
    const map = book.events.findIndex((x) => x.e.type === 'mapComplete');
    expect(lesson).toBeGreaterThanOrEqual(0);
    expect(lesson).toBeLessThan(map);
    expect(game.onboarding.complete).toBe(true);
    // Every segment of every regular line, and the map exactly once.
    for (const li of regular()) {
      const lp = game.progress.lines[li];
      expect(lp.inked.every((b) => b), `${lineIds()[li]} ${lp.inked.join(',')}`).toBe(true);
      expect(lp.complete).toBe(true);
    }
    expect(ev.filter((e) => e.type === 'mapComplete').length).toBe(1);
    expect(game.progress.mapComplete).toBe(true);
    // No teleports: never further in a tick than a skater can go (the rail magnet included), and
    // no bails at all on the way to the map.
    expect(atMap.jumps, book.jumps.join('; ')).toBe(0);
    expect(atMap.bails, book.bailLog.join('; ')).toBe(0);
    // Never stuck: something new (a segment, a district) at least every 3 minutes.
    expect(atMap.longestStall, `stall ending at day tick ${dayTick(atMap.stallEndAt)}`).toBeLessThan(3 * 60 * 60);
    // Under 90 simulated minutes from the first tick to mapComplete.
    expect(mapTick - book.startTick).toBeLessThan(90 * 60 * 60);
    expect(atMap.ticks).toBe(mapTick - book.startTick);
  });

  it('then the secrets: the ghost tram at night, the summit chain onto the king kite and the needle, the blimp', () => {
    const { game, bot, book } = full;
    expect(bot.failure, bot.log.slice(-15).join('\n')).toBe('');
    expect(bot.done).toBe(true);
    // All four secrets found, each once.
    const found = book.events.flatMap((x) => (x.e.type === 'secretFound' ? [x.e.id] : []));
    expect(found.slice().sort()).toEqual([...SECRET_IDS].sort());
    for (const id of SECRET_IDS) expect(game.secrets.found[id], id).toBeDefined();
    // The summit route is a four-link chain ending on the king kite.
    const links = bot.log.filter((l) => l.includes('] link '));
    expect(links.map((l) => l.split('] link ')[1].split(' @')[0])).toEqual(['A1 chain 1', 'A2 chain 2', 'A3 chain 3', 'S3 chain 4']);
    // The ghost tram's and the king kite's laps ink their whole lines.
    const byId = (id: string) => game.progress.lines[world.lines.findIndex((l) => l.id === id)];
    expect(byId('S1').complete).toBe(true);
    expect(byId('S3').complete).toBe(true);
    // The blimp is ridden and inks the leg it can be caught on: it is caught as its ladder sweeps
    // the hill station platform, already past its first segment, which starts 28 m above the
    // summit with nothing under it to reach from (a finding: S2 can never be completed).
    const s2 = byId('S2');
    expect(s2.discovered).toBe(true);
    expect(s2.inked).toEqual([false, true]);
    // Every line but the blimp is complete.
    for (const l of world.lines) if (l.id !== 'S2') expect(game.progress.lines[l.index].complete, l.id).toBe(true);
    // A modest number of bails, all after the map: the drop off the needle and the blimp's.
    expect(book.bails, book.bailLog.join('; ')).toBeLessThanOrEqual(3);
    expect(book.jumps, book.jumps.join('; ')).toEqual([]);
  });

  const SAVES: SavePoint[] = [
    { name: 'after the lesson', when: (g) => g.onboarding.complete },
    { name: 'at half the segments', when: (g) => mapFraction(g.progress, g.sim.world.lines) >= 0.5 },
    {
      name: 'just before the last segment (waiting for the last line)',
      when: (g) => g.progress.lines.filter((l, i) => g.sim.world.lines[i].secret !== true && !l.complete).length === 1,
    },
  ];

  for (const sp of SAVES) {
    it(`a save ${sp.name}, loaded into a fresh game, plays on to the same map and secrets`, () => {
      const s = play(sp);
      expect(s.bot.failure, s.bot.log.slice(-15).join('\n')).toBe('');
      expect(s.savedAt).toBeGreaterThan(0);
      // The same state at the end: the skater bit for bit, the time of day, the map, the secrets, the lesson.
      expect(stateHash(s.game)).toBe(stateHash(full.game));
      // mapComplete exactly once over the whole session, before and after the load.
      expect(s.book.events.filter((x) => x.e.type === 'mapComplete').length).toBe(1);
      // From the save on, the same game events in the same order as the uninterrupted run, and every
      // progress event (ink, lines, secrets) at the same time of day.
      const ref = full.book.events.filter((x) => x.tick > s.savedAt).map((x): [number, GameEvent] => [dayTick(x.tick), x.e]);
      expect(s.after.map(([, e]) => JSON.stringify(e))).toEqual(ref.map(([, e]) => JSON.stringify(e)));
      expect(progressEvents(s.after)).toEqual(progressEvents(ref));
    });
  }

  it('is deterministic: a second run ends in the same state with the same events', () => {
    const again = play();
    expect(again.game.sim.hash()).toBe(full.game.sim.hash());
    expect(stateHash(again.game)).toBe(stateHash(full.game));
    expect(again.book.events.length).toBe(full.book.events.length);
    expect(again.book.events.map((x) => `${x.tick} ${JSON.stringify(x.e)}`)).toEqual(full.book.events.map((x) => `${x.tick} ${JSON.stringify(x.e)}`));
  });

  it('costs under 90 s of wall time for the whole file', () => {
    const s = (performance.now() - started) / 1000;
    expect(s).toBeLessThan(90);
  });
});

