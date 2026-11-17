/**
 * Player settings: the four the save already holds (music, effects, haptics, hints) plus two that
 * only the app cares about (reduced motion, the risograph print pass). The sim's save type keeps
 * its four; the app's two are stored alongside it by `src/app/save.ts` (see `extraOf`).
 *
 * Pure: cleaning, stepping volumes, converting to and from what is stored, and applying settings
 * through injected setters so tests need no browser, renderer or audio.
 */
import type { SaveSettings } from '../sim/game/save';

export interface AppSettings {
  /** 0..1 in steps of 1/VOLUME_STEPS. */
  music: number;
  sfx: number;
  haptics: boolean;
  hints: boolean;
  /** No camera shake, UI flips land at once. */
  reduced: boolean;
  /** The risograph print pass (misregistration, grain). */
  riso: boolean;
}

/** The app-only part, stored next to the save. */
export interface AppExtraSettings {
  reduced: boolean;
  riso: boolean;
}

/** Volume sliders have this many steps above zero. */
export const VOLUME_STEPS = 10;

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  music: 1,
  sfx: 1,
  haptics: true,
  hints: true,
  reduced: false,
  riso: true,
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A volume clamped to 0..1 and snapped to the slider's steps; `dflt` if not a finite number. */
export function cleanVolume(v: unknown, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  const c = Math.min(1, Math.max(0, v));
  return Math.round(c * VOLUME_STEPS) / VOLUME_STEPS;
}

/** The slider step (0..VOLUME_STEPS) a volume shows. */
export function volumeStep(v: number): number {
  return Math.round(cleanVolume(v, 0) * VOLUME_STEPS);
}

/** The volume for a slider step, clamped. */
export function volumeAt(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(VOLUME_STEPS, Math.max(0, Math.round(step))) / VOLUME_STEPS;
}

const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);

/** Anything into valid settings: clamps volumes, defaults what is missing or wrong, ignores unknown fields. */
export function cleanAppSettings(raw: unknown): AppSettings {
  const r = isRecord(raw) ? raw : {};
  const d = DEFAULT_APP_SETTINGS;
  return {
    music: cleanVolume(r.music, d.music),
    sfx: cleanVolume(r.sfx, d.sfx),
    haptics: bool(r.haptics, d.haptics),
    hints: bool(r.hints, d.hints),
    reduced: bool(r.reduced, d.reduced),
    riso: bool(r.riso, d.riso),
  };
}

/** Settings from what was stored: the save's settings plus the app's extra record (either may be junk). */
export function fromStored(save: unknown, extra: unknown): AppSettings {
  const s = isRecord(save) ? save : {};
  const e = isRecord(extra) ? extra : {};
  return cleanAppSettings({ music: s.music, sfx: s.sfx, haptics: s.haptics, hints: s.hints, reduced: e.reduced, riso: e.riso });
}

/** The part the sim's save holds. */
export function toSaveSettings(a: AppSettings): SaveSettings {
  return { music: a.music, sfx: a.sfx, haptics: a.haptics, hints: a.hints };
}

/** The part stored alongside the save. */
export function extraOf(a: AppSettings): AppExtraSettings {
  return { reduced: a.reduced, riso: a.riso };
}

/** A copy of `a` with `patch` applied, cleaned. */
export function patchSettings(a: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return cleanAppSettings({ ...a, ...patch });
}

/** Where settings take effect. Injected, so this module stays free of audio, render and DOM. */
export interface SettingSinks {
  setVolumes(music: number, sfx: number): void;
  /** Camera shake scale (FEEL.CAM_SHAKE). */
  setShake(scale: number): void;
  setRiso(enabled: boolean): void;
  /** UI flips and slides land at once. */
  setReducedUi(reduced: boolean): void;
}

/**
 * Apply settings through the sinks. `shakeDefault` is the shake scale to use when motion is not
 * reduced. With `prev`, only what changed is applied.
 */
export function applySettings(a: AppSettings, sinks: SettingSinks, shakeDefault: number, prev: AppSettings | null = null): void {
  if (!prev || prev.music !== a.music || prev.sfx !== a.sfx) sinks.setVolumes(a.music, a.sfx);
  if (!prev || prev.reduced !== a.reduced) {
    sinks.setShake(a.reduced ? 0 : shakeDefault);
    sinks.setReducedUi(a.reduced);
  }
  if (!prev || prev.riso !== a.riso) sinks.setRiso(a.riso);
}
