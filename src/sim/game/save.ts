/**
 * Saves, pure part: what a save holds, how it is made from a Game, validated, upgraded from older
 * versions and put back. The browser glue (localStorage, autosave timing) is `src/app/save.ts`.
 *
 * Each reducer that implements `exportState` gets a section under its `key`; the save code never
 * looks inside. A malformed section only resets that reducer.
 */
import { DAY_TICKS, FEEL } from '../constants';
import { placePlayer } from '../player';
import { Surface, makeGroundSample, sampleGround, terrainSurface, type World } from '../world';
import type { Game } from './game';

export const SAVE_VERSION = 2;

export interface SaveSettings {
  /** 0..1 */
  music: number;
  /** 0..1 */
  sfx: number;
  haptics: boolean;
  hints: boolean;
}

export const DEFAULT_SETTINGS: Readonly<SaveSettings> = Object.freeze({ music: 1, sfx: 1, haptics: true, hints: true });

export interface SaveData {
  version: 2;
  savedAtTick: number;
  /** Where the skater resumes (their last safe spot), the time of day and the day count (from 0). */
  player: { x: number; z: number; heading: number; dayTick: number; day: number };
  settings: SaveSettings;
  reducers: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The time of day of an absolute tick, 0..DAY_TICKS-1. */
function dayTickOf(tick: number): number {
  return ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

export function exportSave(game: Game, settings: SaveSettings): SaveData {
  const sim = game.sim;
  const p = sim.player;
  const reducers: Record<string, unknown> = {};
  for (const r of game.reducers) if (r.exportState) reducers[r.key] = r.exportState();
  return {
    version: 2,
    savedAtTick: sim.tick,
    player: { x: p.safeX, z: p.safeZ, heading: p.safeHeading, dayTick: dayTickOf(sim.tick), day: Math.max(0, Math.floor(sim.tick / DAY_TICKS)) },
    settings: cleanSettings(settings),
    reducers,
  };
}

const _g = makeGroundSample();

/** A point the skater can be put down at: inside the world, on a top surface that is not water. */
export function isRestingSpot(w: World, x: number, z: number): boolean {
  if (!finite(x) || !finite(z)) return false;
  if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) return false;
  sampleGround(w, x, 1e9, z, 0, _g);
  if (_g.surface === Surface.WATER) return false;
  if (_g.solid >= 0) return true;
  const m = FEEL.SAFE_MARGIN;
  return (
    terrainSurface(w, x + m, z) !== Surface.WATER &&
    terrainSurface(w, x - m, z) !== Surface.WATER &&
    terrainSurface(w, x, z + m) !== Surface.WATER &&
    terrainSurface(w, x, z - m) !== Surface.WATER
  );
}

/**
 * Put a (migrated) save into a game: every reducer's state, the skater at rest at the saved spot
 * (the world spawn if that spot is not safe ground), and the clock at the saved day and time of day.
 * Returns the saved settings.
 */
export function importSave(game: Game, data: SaveData): SaveSettings {
  for (const r of game.reducers) {
    if (!r.importState) continue;
    const section = data.reducers[r.key];
    try {
      r.importState(section);
    } catch (_e) {
      // A reducer that chokes on its section starts fresh; the others are unaffected.
      try {
        r.importState(undefined);
      } catch (_e2) {
        /* left as it was */
      }
    }
  }
  const sim = game.sim;
  const w = sim.world;
  let { x, z, heading } = data.player;
  if (!isRestingSpot(w, x, z) || !finite(heading)) {
    x = w.spawn.x;
    z = w.spawn.z;
    heading = w.spawn.heading;
  }
  placePlayer(w, sim.player, x, z, heading);
  sim.tick = data.player.day * DAY_TICKS + data.player.dayTick;
  return cleanSettings(data.settings);
}

function unit(v: unknown, dflt: number): number {
  return finite(v) ? Math.min(1, Math.max(0, v)) : dflt;
}

function cleanSettings(s: unknown): SaveSettings {
  const r = isRecord(s) ? s : {};
  return {
    music: unit(r.music, DEFAULT_SETTINGS.music),
    sfx: unit(r.sfx, DEFAULT_SETTINGS.sfx),
    haptics: typeof r.haptics === 'boolean' ? r.haptics : DEFAULT_SETTINGS.haptics,
    hints: typeof r.hints === 'boolean' ? r.hints : DEFAULT_SETTINGS.hints,
  };
}

type Upgrade = (d: Record<string, unknown>) => Record<string, unknown> | null;

/** Most days a save may claim (a clock this far on would lose precision long before). */
const MAX_DAY = 1e6;

/**
 * UPGRADES[v] turns a version-v save into a version v+1 save (or null if it cannot). A new version
 * adds its step here, bumps SAVE_VERSION and the SaveData type.
 */
const UPGRADES: Record<number, Upgrade> = {
  // Version 2 saves the day count; a version 1 save kept only the time of day, so it loads on day 0.
  1: (d) => (isRecord(d.player) ? { ...d, version: 2, player: { ...d.player, day: 0 } } : null),
};

/** Validate the current version's shape. Required: version and player; the rest defaults. */
function validate(d: Record<string, unknown>): SaveData | null {
  if (d.version !== SAVE_VERSION) return null;
  const p = d.player;
  if (!isRecord(p)) return null;
  if (!finite(p.x) || !finite(p.z) || !finite(p.heading)) return null;
  const dt = p.dayTick;
  if (typeof dt !== 'number' || !Number.isInteger(dt) || dt < 0 || dt >= DAY_TICKS) return null;
  const day = p.day;
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > MAX_DAY) return null;
  const at = d.savedAtTick;
  const reducers: Record<string, unknown> = {};
  if (isRecord(d.reducers)) for (const k of Object.keys(d.reducers)) reducers[k] = d.reducers[k];
  return {
    version: 2,
    savedAtTick: typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : 0,
    player: { x: p.x, z: p.z, heading: p.heading, dayTick: dt, day },
    settings: cleanSettings(d.settings),
    reducers,
  };
}

/** Parse anything into a current SaveData, upgrading older versions; null if unrecognisable. */
export function migrate(raw: unknown): SaveData | null {
  try {
    if (!isRecord(raw)) return null;
    let d: Record<string, unknown> = raw;
    const v0 = d.version;
    if (typeof v0 !== 'number' || !Number.isInteger(v0) || v0 < 1 || v0 > SAVE_VERSION) return null;
    let v: number = v0;
    while (v < SAVE_VERSION) {
      const up: Upgrade | undefined = UPGRADES[v];
      if (!up) return null;
      const next = up(d);
      if (!next || next.version !== v + 1) return null;
      d = next;
      v = v + 1;
    }
    return validate(d);
  } catch (_e) {
    return null;
  }
}
