/**
 * Boot and main loop. Fixed 60 Hz sim steps from an accumulator; rendering interpolates. With
 * `?e2e` nothing runs on its own: the test harness advances time through the hook.
 */
import { createAudio } from '../audio/index';
import { Gestures, attachGestures } from '../input/gestures';
import { createChalkView } from '../render/chalkView';
import { createCityView } from '../render/cityView';
import { createView } from '../render/view';
import { DT, FEEL } from '../sim/constants';
import { Game, type GameEvent } from '../sim/game/game';
import { placePlayer } from '../sim/player';
import { MODE_NAMES, type InputFrame, type SimEvent } from '../sim/types';
import { createUi } from '../ui/index';
import type { ShellHost } from '../ui/titleShell';
import { createAudioView } from './audioView';
import { createDebugPanel, type DebugPanel } from './debugPanel';
import { createHaptics } from './haptics';
import { getParams } from './params';
import { appVersion, createPwa } from './pwa';
import { getRoute } from './routes';
import { createSaveGlue } from './save';
import {
  DEFAULT_APP_SETTINGS,
  VOLUME_STEPS,
  applySettings,
  extraOf,
  fromStored,
  patchSettings,
  toSaveSettings,
  type AppSettings,
  type SettingSinks,
} from './settings';
import { installHook } from './testHook';
import { buildWorld, isStreamed } from './world';

const MAX_CATCH_UP = 4;
const STATS_CAP = 20000;

function boot(): void {
  const params = getParams();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;

  const world = buildWorld(params);
  const game = new Game(world, { seed: params.seed, startDayFrac: params.t ?? undefined });
  const sim = game.sim;
  // Before anything reads game state: a stored save puts progress, chalk lines and the skater back.
  const saves = createSaveGlue(game, { e2e: params.e2e });
  const gestures = new Gestures();
  attachGestures(canvas, gestures);
  const view = createView(canvas, world, isStreamed(params) ? { worldView: createCityView } : {});
  const chalkView = createChalkView(view.scene, world);
  const route = getRoute(params.route);
  const panel: DebugPanel | null = params.debug ? createDebugPanel(uiRoot) : null;
  // After the panel, so the UI can keep its controls clear of it.
  const audio = createAudio();
  audio.setMuted(params.mute);
  const audioView = createAudioView();

  // App shell: settings, PWA, haptics, title / pause / settings screens.
  const query = new URLSearchParams(location.search);
  const pwa = createPwa({ e2e: params.e2e, sw: query.has('sw'), onChange: () => undefined });
  /** Camera shake when motion is not reduced: whatever FEEL holds at boot. */
  const shakeDefault = FEEL.CAM_SHAKE;
  const sinks: SettingSinks = {
    setVolumes: (m, s) => audio.setVolumes(m, s),
    setShake: (v) => {
      FEEL.CAM_SHAKE = v;
    },
    setRiso: (on) => {
      view.riso.enabled = on;
    },
    setReducedUi: (on) => {
      uiRoot.classList.toggle('sk-reduced', on);
    },
  };
  let settings: AppSettings = fromStored(saves.settings, saves.appData.settings);
  applySettings(settings, sinks, shakeDefault);
  const storedFacts = (out: Record<string, string | number | boolean>): void => {
    const st = saves.stored();
    let saved: unknown = null;
    let app: unknown = null;
    try {
      saved = st.save === null ? null : JSON.parse(st.save);
      app = st.app === null ? null : JSON.parse(st.app);
    } catch (_e) {
      /* unreadable: reported as missing */
    }
    const rec = (v: unknown, k: string): unknown =>
      typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined;
    const ss = rec(saved, 'settings');
    const as = rec(app, 'settings');
    const music = rec(ss, 'music');
    const haptics = rec(ss, 'haptics');
    const reduced = rec(as, 'reduced');
    out.storedMusic = typeof music === 'number' ? Math.round(music * VOLUME_STEPS) : -1;
    out.storedHaptics = typeof haptics === 'boolean' ? String(haptics) : '';
    out.storedReduced = typeof reduced === 'boolean' ? String(reduced) : '';
  };
  // Called only from frames, after `ui` exists.
  const haptics = createHaptics({ enabled: () => settings.haptics && !ui.paused });
  const shellHost: ShellHost = {
    showTitle: params.route === null && (!params.e2e || query.has('title')),
    celebrate: params.e2e && query.has('celebrate'),
    autoPause: !params.e2e && params.route === null,
    version: appVersion(),
    values: () => settings,
    change(patch) {
      const prev = settings;
      settings = patchSettings(settings, patch);
      applySettings(settings, sinks, shakeDefault, prev);
      saves.setSettings(toSaveSettings(settings), { ...extraOf(settings) });
    },
    hasSave: () => saves.hasSave,
    play() {
      audio.unlock();
      if (!params.e2e) pwa.enterFullscreen();
    },
    newGame() {
      saves.resetSave(true);
      const w = sim.world;
      placePlayer(w, sim.player, w.spawn.x, w.spawn.z, w.spawn.heading);
      prev.x = sim.player.x;
      prev.y = sim.player.y;
      prev.z = sim.player.z;
    },
    resetSave() {
      const before = settings;
      saves.resetSave(false);
      settings = { ...DEFAULT_APP_SETTINGS };
      applySettings(settings, sinks, shakeDefault, before);
    },
    quitToTitle() {
      saves.saveNow();
    },
    playSeconds: () => saves.playTicks * DT,
    installAvailable: () => pwa.installAvailable,
    iosHint: () => pwa.iosHint,
    promptInstall: () => pwa.promptInstall(),
    updateReady: () => pwa.updateReady,
    applyUpdate: () => pwa.applyUpdate(),
    testFacts(out) {
      storedFacts(out);
      out.haptic = haptics.last;
      out.swState = pwa.swState;
    },
  };
  const ui = createUi(uiRoot, game, audio, shellHost);
  // A shared chalk link (?chalk=SK2-...) opens the import box with the code pasted.
  const sharedChalk = new URLSearchParams(location.search).get('chalk');
  if (sharedChalk) ui.openChalkImport(sharedChalk);
  // Browsers only start audio from a user gesture: the first touch or key unlocks it.
  const unlock = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const prev = { x: sim.player.x, y: sim.player.y, z: sim.player.z };
  const pending: SimEvent[] = [];
  const pendingGame: GameEvent[] = [];
  const eventLog: string[] = [];
  const scripted: InputFrame = { steer: 0, hold: false, hop: false };
  let routeTick = 0;

  const step = (): void => {
    prev.x = sim.player.x;
    prev.y = sim.player.y;
    prev.z = sim.player.z;
    let input = gestures.sample();
    if (route) {
      route(sim, routeTick++, scripted);
      input = scripted;
      // The script may have moved the skater: do not interpolate across that.
      prev.x = sim.player.x;
      prev.y = sim.player.y;
      prev.z = sim.player.z;
    }
    game.step(input);
    saves.afterStep(game.events);
    for (const e of sim.events) {
      pending.push(e);
      if (eventLog.length < 4096) eventLog.push(e.type);
    }
    for (const e of game.events) pendingGame.push(e);
  };

  let workMs: number[] = [];
  let frames = 0;
  let lastWork = 0;
  const uiFrame = { game, armed: false, simEvents: pending, gameEvents: pendingGame, dt: 0 };
  const draw = (alpha: number, dt: number): void => {
    chalkView.update(game, alpha, dt);
    view.render(sim, prev, alpha, dt, pending);
    uiFrame.armed = gestures.isArmed;
    uiFrame.dt = dt;
    ui.update(uiFrame);
    haptics.frame(pending, pendingGame, dt);
    audio.update(audioView(sim, ui.paused), pending, world.lines, dt);
    pending.length = 0;
    pendingGame.length = 0;
    panel?.update(sim, { ...view.info(), workMs: lastWork });
  };

  window.addEventListener('resize', () => view.resize());

  let acc = 0;
  let lastTime = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = lastTime === 0 ? DT : Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    let steps = 0;
    if (ui.paused) {
      // A screen that pauses play is open: render, but do not let time pile up.
      acc = 0;
    } else {
      acc += dt;
      while (acc >= DT && steps < MAX_CATCH_UP) {
        step();
        acc -= DT;
        steps++;
      }
      // Drop time we could not simulate rather than spiral.
      if (acc > DT) acc = 0;
    }
    draw(ui.paused ? 1 : acc / DT, dt);
    lastWork = performance.now() - t0;
    frames++;
    if (workMs.length < STATS_CAP) workMs.push(lastWork);
  };

  const audioState = (): { running: boolean; track: number; stems: number; fullBand: boolean; wheel: number } => {
    const d = audio.debug();
    return {
      running: d.running,
      track: d.track ?? -1,
      stems: d.stemTargets.filter((g) => g > 0.5).length,
      fullBand: d.fullBand,
      wheel: d.wheelLevel,
    };
  };

  installHook({
    ready: true,
    manual: params.e2e,
    advance(ticks) {
      // While the UI pauses play, frames still render (screenshots, state) but time stands still.
      if (!ui.paused) for (let i = 0; i < ticks; i++) step();
      draw(1, Math.max(1, ticks) * DT);
      frames++;
    },
    state() {
      const p = sim.player;
      const events = eventLog.splice(0, eventLog.length);
      return {
        tick: sim.tick,
        mode: MODE_NAMES[p.mode],
        x: p.x,
        y: p.y,
        z: p.z,
        speed: p.speed,
        chain: p.chain,
        hitchedLine: p.mode === 4 ? world.lines[p.hLine].id : null,
        dayFrac: sim.dayFrac,
        events,
        steer: p.steer,
        armed: gestures.isArmed,
        feelRows: panel ? document.querySelectorAll('[data-feel]').length : 0,
        ui: ui.testState(),
        audio: audioState(),
      };
    },
    stats() {
      const info = view.info();
      return { frames, workMs: workMs.slice(), drawCalls: info.drawCalls, triangles: info.triangles };
    },
    resetStats() {
      workMs = [];
      frames = 0;
    },
  });

  if (params.e2e) draw(1, DT);
  else requestAnimationFrame(frame);
}

boot();
