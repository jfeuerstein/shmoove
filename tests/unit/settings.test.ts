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
import { CONTINUE_PLAY_TICKS, worthContinuing } from '../../src/app/save';
import { FEEL_DEFS } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { exportSave, importSave, migrate } from '../../src/sim/game/save';
import { buildSlice } from '../../src/sim/slice';
import { ticketSerial } from '../../src/ui/title';
import { RESET_TIMEOUT_MS, ResetConfirm, SLIDER_STEPS, sliderStepAt, sliderTap } from '../../src/ui/settings';

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

describe('CONTINUE is offered only for a game worth continuing', () => {
  const sectionsOf = (game: Game): Record<string, unknown> => exportSave(game, toSaveSettings(DEFAULT_APP_SETTINGS)).reducers;

  it('a first launch with only settings changed is not a game to continue', () => {
    const game = new Game(buildSlice(1), { seed: 1, startDayFrac: 0.3 });
    const changed = exportSave(game, toSaveSettings({ ...DEFAULT_APP_SETTINGS, music: 0.3, haptics: false }));
    expect(worthContinuing(changed.reducers, 0)).toBe(false);
    expect(worthContinuing(changed.reducers, CONTINUE_PLAY_TICKS - 1)).toBe(false);
  });

  it('30 s of play is', () => {
    const game = new Game(buildSlice(1), { seed: 1, startDayFrac: 0.3 });
    expect(CONTINUE_PLAY_TICKS).toBe(30 * 60);
    expect(worthContinuing(sectionsOf(game), CONTINUE_PLAY_TICKS)).toBe(true);
  });

  it('an inked segment is, read from the real progress section', () => {
    const game = new Game(buildSlice(1), { seed: 1, startDayFrac: 0.3 });
    expect(game.progress.lines.length).toBeGreaterThan(0);
    game.progress.lines[0].inked[0] = true;
    expect(worthContinuing(sectionsOf(game), 0)).toBe(true);
  });

  it('a chalk line, a done errand, a punched conductor or a found secret is', () => {
    const base = { progress: { v: 1, lines: [{ id: 'X', inked: [false, false], discovered: true }] }, chalk: { v: 1, lines: [] }, errands: { v: 1, done: {} }, conductors: { v: 1, punched: [] }, secrets: { v: 1, found: {} } };
    expect(worthContinuing(base, 0)).toBe(false);
    expect(worthContinuing({ ...base, chalk: { v: 1, lines: [{ code: 'SK2-x', best: 0 }] } }, 0)).toBe(true);
    expect(worthContinuing({ ...base, errands: { v: 1, done: { fish_run: 4000 } } }, 0)).toBe(true);
    expect(worthContinuing({ ...base, conductors: { v: 1, punched: ['D1'] } }, 0)).toBe(true);
    expect(worthContinuing({ ...base, secrets: { v: 1, found: { gull: 10 } } }, 0)).toBe(true);
    // Junk sections never count.
    expect(worthContinuing({ progress: 7, chalk: null, errands: 'x', conductors: { punched: 'D1' } }, 0)).toBe(false);
  });
});

describe('settings slider: one control, the value from the touch x', () => {
  // Ten cells across 200 px starting at x = 100.
  const at = (x: number): number => sliderStepAt(x, 100, 200, SLIDER_STEPS);

  it('a touch on a cell picks that cell; at or left of the row is 0, past its end is full', () => {
    expect(at(101)).toBe(1);
    expect(at(119.9)).toBe(1);
    expect(at(120.1)).toBe(2);
    expect(at(210)).toBe(6);
    expect(at(299)).toBe(10);
    expect(at(100)).toBe(0);
    expect(at(40)).toBe(0);
    expect(at(400)).toBe(10);
    expect(sliderStepAt(150, 100, 0, SLIDER_STEPS)).toBe(0);
    expect(sliderStepAt(Number.NaN, 100, 200, SLIDER_STEPS)).toBe(0);
  });

  it('a tap on the lit top cell turns it off; any other cell is taken as is', () => {
    expect(sliderTap(6, 6)).toBe(5);
    expect(sliderTap(1, 1)).toBe(0);
    expect(sliderTap(3, 6)).toBe(3);
    expect(sliderTap(9, 6)).toBe(9);
    expect(sliderTap(0, 4)).toBe(0);
  });
});

describe('RESET SAVE confirmation', () => {
  it('needs the button, then two different confirmations, before it wipes', () => {
    const r = new ResetConfirm();
    expect(r.confirmFirst(0)).toBeUndefined();
    expect(r.stage).toBe(0);
    expect(r.confirmSecond(0)).toBe(false);
    r.open(0);
    expect(r.stage).toBe(1);
    // The second confirmation's control does nothing before the first.
    expect(r.confirmSecond(10)).toBe(false);
    expect(r.stage).toBe(1);
    r.confirmFirst(20);
    expect(r.stage).toBe(2);
    // The first confirmation's control again does not wipe.
    r.confirmFirst(30);
    expect(r.stage).toBe(2);
    expect(r.confirmSecond(40)).toBe(true);
    expect(r.stage).toBe(3);
    expect(r.confirmSecond(50)).toBe(false);
  });

  it('KEEP goes back to the start; a wiped save stays wiped until the screen reopens', () => {
    const r = new ResetConfirm();
    r.open(0);
    r.confirmFirst(1);
    r.cancel();
    expect(r.stage).toBe(0);
    r.open(2);
    r.confirmFirst(3);
    r.confirmSecond(4);
    r.cancel();
    expect(r.stage).toBe(3);
    r.reset();
    expect(r.stage).toBe(0);
  });

  it('lapses after 3 s without input; input keeps it open', () => {
    expect(RESET_TIMEOUT_MS).toBe(3000);
    const r = new ResetConfirm();
    r.open(1000);
    expect(r.expire(3999)).toBe(false);
    r.input(3500);
    expect(r.expire(5000)).toBe(false);
    r.confirmFirst(6000);
    expect(r.expire(8999)).toBe(false);
    expect(r.stage).toBe(2);
    expect(r.expire(9000)).toBe(true);
    expect(r.stage).toBe(0);
    // Nothing to lapse when idle or wiped.
    expect(r.expire(1e9)).toBe(false);
    r.open(0);
    r.confirmFirst(0);
    r.confirmSecond(0);
    expect(r.expire(1e9)).toBe(false);
    expect(r.stage).toBe(3);
  });
});

describe('the NEW GAME ticket serial', () => {
  it('six digits made from the play time: stable for a save, never a blank 000000', () => {
    for (const t of [0, 1, 59.9, 3600, 123456]) {
      expect(ticketSerial(t)).toMatch(/^Nº [1-9]\d{5}$/);
      expect(ticketSerial(t)).toBe(ticketSerial(t));
    }
    expect(ticketSerial(61)).not.toBe(ticketSerial(62));
    expect(ticketSerial(Number.NaN)).toBe(ticketSerial(0));
  });
});
