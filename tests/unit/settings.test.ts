import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  VOLUME_STEPS,
  applySettings,
  cleanAppSettings,
  cleanVolume,
  extraOf,
  fromStored,
  patchSettings,
  toSaveSettings,
  volumeAt,
  volumeStep,
  type AppSettings,
  type SettingSinks,
} from '../../src/app/settings';
import { FEEL_DEFS } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { exportSave, importSave, migrate } from '../../src/sim/game/save';
import { buildSlice } from '../../src/sim/slice';

describe('settings defaults and cleaning', () => {
  it('defaults to full volume, haptics and hints on, motion on, the print pass on', () => {
    expect(cleanAppSettings(undefined)).toEqual({ music: 1, sfx: 1, haptics: true, hints: true, reduced: false, riso: true });
    expect(cleanAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(cleanAppSettings([1, 2])).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('clamps volumes to 0..1 and snaps them to the slider steps', () => {
    expect(cleanVolume(-3, 1)).toBe(0);
    expect(cleanVolume(7, 0)).toBe(1);
    expect(cleanVolume(0.43, 1)).toBe(0.4);
    expect(cleanVolume(0.46, 1)).toBe(0.5);
    expect(cleanVolume(Number.NaN, 0.7)).toBe(0.7);
    expect(cleanVolume('0.5', 0.7)).toBe(0.7);
    expect(volumeStep(0.6)).toBe(6);
    expect(volumeAt(11)).toBe(1);
    expect(volumeAt(-2)).toBe(0);
    expect(volumeAt(3)).toBe(3 / VOLUME_STEPS);
  });

  it('defaults each wrong field on its own and ignores unknown fields', () => {
    const s = cleanAppSettings({ music: 0.3, sfx: 'loud', haptics: 'yes', hints: false, reduced: true, riso: 0, cheat: true });
    expect(s).toEqual({ music: 0.3, sfx: 1, haptics: true, hints: false, reduced: true, riso: true });
    expect('cheat' in s).toBe(false);
  });

  it('patches without letting a patch break the shape', () => {
    const s = patchSettings(DEFAULT_APP_SETTINGS, { music: 2, haptics: false });
    expect(s.music).toBe(1);
    expect(s.haptics).toBe(false);
    expect(DEFAULT_APP_SETTINGS.haptics).toBe(true);
  });
});

describe('settings round trip through the save', () => {
  it('keeps every setting: the four in the sim save, the app two alongside', () => {
    const chosen: AppSettings = { music: 0.6, sfx: 0.2, haptics: false, hints: false, reduced: true, riso: false };
    const game = new Game(buildSlice(1), { seed: 1, startDayFrac: 0.3 });
    // What src/app/save.ts writes: the sim save (with its settings) and the app record beside it.
    const saveJson = JSON.stringify(exportSave(game, toSaveSettings(chosen)));
    const appJson = JSON.stringify({ settings: extraOf(chosen), playTicks: 0 });
    const data = migrate(JSON.parse(saveJson));
    expect(data).not.toBeNull();
    if (!data) return;
    const fresh = new Game(buildSlice(1), { seed: 1, startDayFrac: 0.3 });
    const saveSettings = importSave(fresh, data);
    const app = JSON.parse(appJson) as { settings: unknown };
    expect(fromStored(saveSettings, app.settings)).toEqual(chosen);
  });

  it('falls back to defaults for whatever part is missing or junk', () => {
    expect(fromStored(undefined, undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(fromStored({ music: 0.5, sfx: 0.5, haptics: false, hints: true }, 'junk')).toEqual({
      ...DEFAULT_APP_SETTINGS,
      music: 0.5,
      sfx: 0.5,
      haptics: false,
    });
    expect(fromStored(null, { reduced: true, riso: false, music: 0 })).toEqual({ ...DEFAULT_APP_SETTINGS, reduced: true, riso: false });
  });

  it('puts only the sim save fields into the save, and only the app fields beside it', () => {
    const s: AppSettings = { music: 0.1, sfx: 0.9, haptics: true, hints: false, reduced: true, riso: false };
    expect(toSaveSettings(s)).toEqual({ music: 0.1, sfx: 0.9, haptics: true, hints: false });
    expect(extraOf(s)).toEqual({ reduced: true, riso: false });
  });
});

describe('applying settings through injected setters', () => {
  const recorder = (): { sinks: SettingSinks; log: string[]; state: { shake: number; riso: boolean; reducedUi: boolean; vol: [number, number] } } => {
    const log: string[] = [];
    const state = { shake: -1, riso: true, reducedUi: false, vol: [-1, -1] as [number, number] };
    return {
      log,
      state,
      sinks: {
        setVolumes(m, s) {
          log.push('volumes');
          state.vol = [m, s];
        },
        setShake(v) {
          log.push('shake');
          state.shake = v;
        },
        setRiso(on) {
          log.push('riso');
          state.riso = on;
        },
        setReducedUi(on) {
          log.push('reducedUi');
          state.reducedUi = on;
        },
      },
    };
  };
  const SHAKE = FEEL_DEFS.CAM_SHAKE[0];

  it('applies everything the first time', () => {
    const r = recorder();
    applySettings({ ...DEFAULT_APP_SETTINGS, music: 0.3, sfx: 0.8 }, r.sinks, SHAKE);
    expect(r.state).toEqual({ shake: SHAKE, riso: true, reducedUi: false, vol: [0.3, 0.8] });
  });

  it('reduced motion stops the camera shake and makes the UI instant; turning it off restores the shake', () => {
    const r = recorder();
    const a = { ...DEFAULT_APP_SETTINGS };
    applySettings(a, r.sinks, SHAKE);
    const b = patchSettings(a, { reduced: true });
    applySettings(b, r.sinks, SHAKE, a);
    expect(r.state.shake).toBe(0);
    expect(r.state.reducedUi).toBe(true);
    applySettings(a, r.sinks, SHAKE, b);
    expect(r.state.shake).toBe(SHAKE);
    expect(r.state.reducedUi).toBe(false);
  });

  it('the print toggle switches the riso pass', () => {
    const r = recorder();
    const a = { ...DEFAULT_APP_SETTINGS };
    applySettings(a, r.sinks, SHAKE);
    const b = patchSettings(a, { riso: false });
    r.log.length = 0;
    applySettings(b, r.sinks, SHAKE, a);
    expect(r.state.riso).toBe(false);
    expect(r.log).toEqual(['riso']);
  });

  it('with a previous state, touches only what changed', () => {
    const r = recorder();
    const a = { ...DEFAULT_APP_SETTINGS };
    applySettings(a, r.sinks, SHAKE);
    r.log.length = 0;
    applySettings(patchSettings(a, { haptics: false, hints: false }), r.sinks, SHAKE, a);
    expect(r.log).toEqual([]);
    applySettings(patchSettings(a, { music: 0.5 }), r.sinks, SHAKE, a);
    expect(r.log).toEqual(['volumes']);
  });
});
