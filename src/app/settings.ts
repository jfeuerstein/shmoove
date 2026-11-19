/**
 * What the owner has tuned, kept between visits: the control scheme and every `FEEL` value that
 * differs from its shipped default, under one versioned `localStorage` key.
 *
 * The logic is pure (`parseStored`, `collectOverrides`, `applyOverrides`, `overridesText`); `Settings`
 * is the thin wrapper around a storage object. Storage can be missing, full or throw (private mode),
 * and the game must run the same without it.
 */
import { SCHEMES, type Scheme } from '../input/source';
import { FEEL, FEEL_DEFS, FEEL_KEYS, type FeelKey } from '../sim/constants';

export const STORAGE_KEY = 'shmoove.settings.v1';
const VERSION = 1;

export type FeelValues = Record<FeelKey, number>;
export type FeelOverrides = Partial<Record<FeelKey, number>>;

/** The part of `Storage` we use, so tests can hand in a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Stored {
  scheme: Scheme | null;
  feel: FeelOverrides;
  /** The sim answers card offers itself (for watching the game without choosing). */
  autoPick: boolean;
  /** The first-run lesson has been finished or skipped. */
  lessonDone: boolean;
}

function isScheme(v: unknown): v is Scheme {
  return typeof v === 'string' && (SCHEMES as readonly string[]).includes(v);
}

function isFeelKey(k: string): k is FeelKey {
  return Object.prototype.hasOwnProperty.call(FEEL_DEFS, k);
}

/** Clamp to the def's range. */
export function clampFeel(key: FeelKey, v: number): number {
  const d = FEEL_DEFS[key];
  return Math.min(d.max, Math.max(d.min, v));
}

/** Read saved text: anything wrong with it gives the empty settings, never a throw. */
export function parseStored(raw: string | null): Stored {
  const empty: Stored = { scheme: null, feel: {}, autoPick: false, lessonDone: false };
  if (raw === null) return empty;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (_err) {
    return empty;
  }
  if (typeof data !== 'object' || data === null) return empty;
  const rec = data as Record<string, unknown>;
  if (rec.v !== VERSION) return empty;
  const out: Stored = { scheme: isScheme(rec.scheme) ? rec.scheme : null, feel: {}, autoPick: rec.autoPick === true, lessonDone: rec.lessonDone === true };
  const feel = rec.feel;
  if (typeof feel === 'object' && feel !== null) {
    for (const [k, v] of Object.entries(feel as Record<string, unknown>)) {
      if (!isFeelKey(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
      out.feel[k] = clampFeel(k, v);
    }
  }
  return out;
}

/** The values that differ from the shipped defaults. */
export function collectOverrides(feel: Readonly<FeelValues>): FeelOverrides {
  const out: FeelOverrides = {};
  for (const k of FEEL_KEYS) if (feel[k] !== FEEL_DEFS[k].v) out[k] = feel[k];
  return out;
}

export function serialize(scheme: Scheme | null, feel: Readonly<FeelValues>, autoPick = false, lessonDone = false): string {
  const body: { v: number; scheme?: Scheme; feel: FeelOverrides; autoPick?: boolean; lessonDone?: boolean } = { v: VERSION, feel: collectOverrides(feel) };
  if (scheme !== null) body.scheme = scheme;
  if (autoPick) body.autoPick = true;
  if (lessonDone) body.lessonDone = true;
  return JSON.stringify(body);
}

/** Write the overrides into `target`. */
export function applyOverrides(target: FeelValues, overrides: FeelOverrides): void {
  for (const k of FEEL_KEYS) {
    const v = overrides[k];
    if (v !== undefined) target[k] = v;
  }
}

/** The `?scheme=` value if the URL carries a valid one. */
export function urlScheme(search: string): Scheme | null {
  const v = new URLSearchParams(search).get('scheme');
  if (v === null) return null;
  const s = v.trim().toLowerCase();
  for (const k of SCHEMES) if (k === s) return k;
  return null;
}

/** `key = value` per line for the changed constants, to paste back to whoever sets the defaults. */
export function overridesText(feel: Readonly<FeelValues>, scheme: Scheme | null = null): string {
  const lines: string[] = [];
  if (scheme !== null) lines.push(`scheme = ${scheme}`);
  const o = collectOverrides(feel);
  for (const k of FEEL_KEYS) {
    const v = o[k];
    if (v !== undefined) lines.push(`${k} = ${v}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(no changes from the defaults)';
}

/** The browser's storage, or null where it is not there or refuses to be touched. */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch (_err) {
    return null;
  }
}

export class Settings {
  /** The scheme in force: `?scheme=` if given, else the saved one, else `fallback`. */
  scheme: Scheme;
  private readonly storage: StorageLike | null;
  private readonly feel: FeelValues;
  private stored: Stored;

  /** Whether the sim answers card offers itself. Off unless the owner switched it on. */
  get autoPick(): boolean {
    return this.stored.autoPick;
  }

  /** Whether the first-run lesson has been finished or skipped. */
  get lessonDone(): boolean {
    return this.stored.lessonDone;
  }

  constructor(storage: StorageLike | null, search: string, fallback: Scheme, feel: FeelValues = FEEL) {
    this.storage = storage;
    this.feel = feel;
    let raw: string | null = null;
    try {
      raw = storage ? storage.getItem(STORAGE_KEY) : null;
    } catch (_err) {
      raw = null;
    }
    this.stored = parseStored(raw);
    this.scheme = urlScheme(search) ?? this.stored.scheme ?? fallback;
  }

  /** Put the saved values into the live constants. Call once, before anything reads them. */
  applySaved(): void {
    applyOverrides(this.feel, this.stored.feel);
  }

  /** The owner chose a scheme in the panel: it is saved, and wins until a `?scheme=` says otherwise. */
  chooseScheme(s: Scheme): void {
    this.scheme = s;
    this.stored.scheme = s;
    this.save();
  }

  /** The owner switched auto-pick on or off in the panel. */
  chooseAutoPick(on: boolean): void {
    this.stored.autoPick = on;
    this.save();
  }

  /** The lesson ended (true), or the player asked to see it again (false). */
  chooseLessonDone(done: boolean): void {
    this.stored.lessonDone = done;
    this.save();
  }

  /** Save the live constants' differences from the defaults. */
  saveFeel(): void {
    this.stored.feel = collectOverrides(this.feel);
    this.save();
  }

  text(): string {
    return overridesText(this.feel, this.scheme);
  }

  private save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, serialize(this.stored.scheme, this.feel, this.stored.autoPick, this.stored.lessonDone));
    } catch (_err) {
      // Full or refused: the settings last for this visit only.
    }
  }
}
