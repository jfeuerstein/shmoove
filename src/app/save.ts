/**
 * Save glue: localStorage in and out, autosave timing. The save format and its validation are the
 * pure `src/sim/game/save.ts`.
 *
 * Loads `skitch.save.v1` on boot (falling back to the backup if the main slot is unreadable), keeps
 * the previous good save in `skitch.save.bak` before overwriting, and autosaves on progress and
 * chalk events, every 15 s of play, and when the page is hidden or unloaded. Storage can be missing
 * or full (private mode, quota): every access is guarded and failure only means no save.
 *
 * `?e2e` runs neither read nor write storage unless the URL also has `save`, so routes stay
 * deterministic.
 */
import type { Game, GameEvent } from '../sim/game/game';
import { DEFAULT_SETTINGS, exportSave, importSave, migrate, type SaveData, type SaveSettings } from '../sim/game/save';

export const SAVE_KEY = 'skitch.save.v1';
export const BACKUP_KEY = 'skitch.save.bak';
/** Autosave interval in sim ticks of play (15 s). */
export const AUTOSAVE_TICKS = 15 * 60;

const SAVE_ON: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>([
  'segmentInked',
  'lineComplete',
  'chalkRecordStop',
  'chalkFinish',
]);

export interface SaveGlue {
  /** Storage is in use (false in e2e runs without `save`, or when storage is unavailable). */
  readonly enabled: boolean;
  /** A save was found and loaded at boot. */
  readonly loaded: boolean;
  /** Settings from the save (defaults if none); kept and written back with every save. */
  readonly settings: SaveSettings;
  /** Call after every game step with that step's events. */
  afterStep(events: readonly GameEvent[]): void;
  /** Write a save now. Returns whether it reached storage. */
  saveNow(): boolean;
  /** Wipe the stored save and its backup and start the game's systems fresh. */
  resetSave(): void;
  dispose(): void;
}

function getStorage(): Storage | null {
  try {
    const s = window.localStorage;
    return s ?? null;
  } catch (_e) {
    return null;
  }
}

/** A stored save and the exact string it was read from, or null if missing or unreadable. */
function read(s: Storage, key: string): { data: SaveData; raw: string } | null {
  try {
    const raw = s.getItem(key);
    if (raw === null) return null;
    const data = migrate(JSON.parse(raw));
    return data ? { data, raw } : null;
  } catch (_e) {
    return null;
  }
}

export function createSaveGlue(game: Game, opts: { e2e: boolean }): SaveGlue {
  const wanted = !opts.e2e || new URLSearchParams(location.search).has('save');
  const storage = wanted ? getStorage() : null;
  let settings: SaveSettings = { ...DEFAULT_SETTINGS };
  let loaded = false;
  let sinceSave = 0;
  /**
   * The last save known to be good: the string read at boot, then each string this session wrote.
   * It becomes the backup on the next write, so autosaves never read storage back or re-parse it.
   */
  let lastGood: string | null = null;

  if (storage) {
    const found = read(storage, SAVE_KEY) ?? read(storage, BACKUP_KEY);
    if (found) {
      try {
        settings = importSave(game, found.data);
        loaded = true;
        lastGood = found.raw;
      } catch (_e) {
        // A save that cannot be applied is ignored; the game starts fresh.
      }
    }
  }

  const saveNow = (): boolean => {
    if (!storage) return false;
    sinceSave = 0;
    try {
      const json = JSON.stringify(exportSave(game, settings));
      // Keep the last good save before overwriting it.
      if (lastGood !== null) storage.setItem(BACKUP_KEY, lastGood);
      storage.setItem(SAVE_KEY, json);
      lastGood = json;
      return true;
    } catch (_e) {
      return false;
    }
  };

  const onHide = (): void => {
    if (document.visibilityState === 'hidden') saveNow();
  };
  const onPageHide = (): void => {
    saveNow();
  };
  if (storage) {
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
  }

  return {
    get enabled() {
      return storage !== null;
    },
    get loaded() {
      return loaded;
    },
    get settings() {
      return settings;
    },
    afterStep(events) {
      if (!storage) return;
      sinceSave++;
      let due = sinceSave >= AUTOSAVE_TICKS;
      if (!due) {
        for (const e of events) {
          if (SAVE_ON.has(e.type)) {
            due = true;
            break;
          }
        }
      }
      if (due) saveNow();
    },
    saveNow,
    resetSave() {
      if (storage) {
        try {
          storage.removeItem(SAVE_KEY);
          storage.removeItem(BACKUP_KEY);
        } catch (_e) {
          /* nothing stored, nothing to remove */
        }
      }
      for (const r of game.reducers) {
        try {
          r.importState?.(undefined);
        } catch (_e) {
          /* a reducer that cannot reset keeps its state */
        }
      }
      settings = { ...DEFAULT_SETTINGS };
      sinceSave = 0;
      lastGood = null;
    },
    dispose() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}
