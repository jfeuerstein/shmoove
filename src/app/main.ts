/**
 * Boot and main loop. Fixed 60 Hz sim steps from an accumulator; rendering interpolates. With
 * `?e2e` nothing runs on its own: the test harness advances time through the hook.
 */
import { createAudio } from '../audio/index';
import { Gestures, attachGestures } from '../input/gestures';
import { createChalkView } from '../render/chalkView';
import { chunkGrid, chunkOf, createCityView, type CityView } from '../render/cityView';
import { createHintView } from '../render/hintView';
import { createMarkersView } from '../render/markersView';
import { VIEW_PARTS, createView } from '../render/view';
import { DT, FEEL, START_DAY_FRAC } from '../sim/constants';
import { Game, type GameEvent } from '../sim/game/game';
import { placePlayer } from '../sim/player';
import { MODE_NAMES, type InputFrame, type SimEvent } from '../sim/types';
import { districtAt } from '../sim/world';
import { createUi } from '../ui/index';
import type { ShellHost } from '../ui/titleShell';
import { createAudioView } from './audioView';
import { createDebugPanel, type DebugPanel } from './debugPanel';
import { createHaptics } from './haptics';
import { NEW_GAME_DAY_FRAC, isFixture } from './newGame';
import { getParams } from './params';
import { appVersion, createPwa } from './pwa';
import { getRoute, routeWindows } from './routes';
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

/**
 * Frame accounting for the perf harness: what each part of a frame cost, in fixed buffers (no
 * allocation). Per frame: the parts below plus VIEW_PARTS; per sim step: the game step's cost.
 * `steps` is the number of sim steps the frame carried; `sim` is the game step minus its reducers.
 */
const REDUCER_PARTS = ['progress', 'chalk', 'errands', 'conductors', 'secrets'] as const;
const FRAME_PARTS = ['steps', 'game', 'sim', ...REDUCER_PARTS, 'route', 'saves', 'chalkView', 'markers', ...VIEW_PARTS, 'ui', 'haptics', 'audio'] as const;
type FramePart = (typeof FRAME_PARTS)[number];
const PART: Record<FramePart, number> = Object.fromEntries(FRAME_PARTS.map((n, i) => [n, i])) as Record<FramePart, number>;
const VIEW_PART0 = PART[VIEW_PARTS[0]];
/**
 * Where each frame was, for the perf harness to cut a run into windows and check it went
 * somewhere: route tick after the frame, skater x/z, district, streaming chunk, hitches in the
 * frame, chunk meshes the world view finished in the frame, the frame's draw calls and triangles,
 * ride releases (slings) in the frame, and the longest chunk-build piece of the frame (ms).
 */
const TRACK = ['tick', 'x', 'z', 'district', 'chunk', 'hitches', 'built', 'draws', 'tris', 'slings', 'piece'] as const;

function boot(): void {
  const params = getParams();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;

  const world = buildWorld(params);
  // A fresh boot is a new game at the new-game clock; a stored save puts its own clock back below.
  // A scripted route (perf, tour) keeps the sim's own start clock: its legs were found on it.
  const startDayFrac = params.t ?? (params.route !== null ? START_DAY_FRAC : NEW_GAME_DAY_FRAC);
  const game = new Game(world, { seed: params.seed, startDayFrac });
  const sim = game.sim;
  // Before anything reads game state: a stored save puts progress, chalk lines and the skater back.
  const saves = createSaveGlue(game, { e2e: params.e2e });
  const gestures = new Gestures();
  attachGestures(canvas, gestures);
  let cityView: CityView | null = null;
  const view = createView(canvas, world, isStreamed(params) ? { worldView: (w) => (cityView = createCityView(w, () => view.chase.camera)) } : {});
  const chalkView = createChalkView(view.scene, world);
  const markersView = createMarkersView(view.scene, world, game);
  const hintView = createHintView(view.scene, world, view.chase.camera);
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
  // The onboarding lesson follows the hints setting, except in fixtures (an explicit clock, the slice, a route).
  const fixture = isFixture(params);
  const syncHints = (): void => game.onboardingSetHints(settings.hints && !fixture);
  syncHints();
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
      syncHints();
      saves.setSettings(toSaveSettings(settings), { ...extraOf(settings) });
    },
    hasSave: () => saves.hasSave,
    play() {
      audio.unlock();
      if (!params.e2e) pwa.enterFullscreen();
    },
    newGame() {
      saves.resetSave(true);
      sim.setDayFrac(NEW_GAME_DAY_FRAC);
      const w = sim.world;
      placePlayer(w, sim.player, w.spawn.x, w.spawn.z, w.spawn.heading);
      prev.x = sim.player.x;
      prev.y = sim.player.y;
      prev.z = sim.player.z;
    },
    resetSave() {
      const before = settings;
      saves.resetSave(false);
      sim.setDayFrac(NEW_GAME_DAY_FRAC);
      // The skater is back at the spawn: do not interpolate from where they were.
      prev.x = sim.player.x;
      prev.y = sim.player.y;
      prev.z = sim.player.z;
      settings = { ...DEFAULT_APP_SETTINGS };
      applySettings(settings, sinks, shakeDefault, before);
      syncHints();
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

  // Frame accounting: `cur` accumulates this frame's parts; `stepMs` holds each game step's cost.
  const cur = new Float64Array(FRAME_PARTS.length);
  const partBuf: Float64Array[] = FRAME_PARTS.map(() => new Float64Array(STATS_CAP));
  const workBuf = new Float64Array(STATS_CAP);
  const stepBuf = new Float64Array(STATS_CAP * MAX_CATCH_UP);
  let statFrames = 0;
  let statSteps = 0;
  const trackBuf: Float64Array[] = TRACK.map(() => new Float64Array(STATS_CAP));
  const grid = chunkGrid(world);
  let frameHitches = 0;
  let frameSlings = 0;
  let lastBuilt = 0;
  // Time each reducer where Game.step calls it (wrapped once here; one clock read per boundary).
  for (let ri = 0; ri < game.reducers.length && ri < REDUCER_PARTS.length; ri++) {
    const r = game.reducers[ri];
    const inner = r.step.bind(r);
    const slot = PART[REDUCER_PARTS[ri]];
    r.step = (g: Game): void => {
      const a = performance.now();
      inner(g);
      cur[slot] += performance.now() - a;
    };
  }

  const step = (): void => {
    prev.x = sim.player.x;
    prev.y = sim.player.y;
    prev.z = sim.player.z;
    let input = gestures.sample();
    let t0 = performance.now();
    if (route) {
      route(sim, routeTick++, scripted);
      input = scripted;
      // The script may have moved the skater: do not interpolate across that.
      prev.x = sim.player.x;
      prev.y = sim.player.y;
      prev.z = sim.player.z;
      const t1 = performance.now();
      cur[PART.route] += t1 - t0;
      t0 = t1;
    }
    game.step(input);
    const t1 = performance.now();
    const stepCost = t1 - t0;
    cur[PART.game] += stepCost;
    cur[PART.steps]++;
    if (statSteps < stepBuf.length) stepBuf[statSteps++] = stepCost;
    saves.afterStep(game.events);
    cur[PART.saves] += performance.now() - t1;
    for (const e of sim.events) {
      pending.push(e);
      if (eventLog.length < 4096) eventLog.push(e.type);
      if (e.type === 'hitch') frameHitches++;
      else if (e.type === 'release') frameSlings++;
    }
    for (const e of game.events) pendingGame.push(e);
  };

  let frames = 0;
  let lastWork = 0;
  const uiFrame = { game, armed: false, simEvents: pending, gameEvents: pendingGame, dt: 0, pointer: hintView.screen };
  const draw = (alpha: number, dt: number): void => {
    let t0 = performance.now();
    chalkView.update(game, alpha, dt);
    let t1 = performance.now();
    cur[PART.chalkView] = t1 - t0;
    t0 = t1;
    markersView.update(game, alpha, dt);
    hintView.update(game, alpha, dt);
    t1 = performance.now();
    cur[PART.markers] = t1 - t0;
    view.render(sim, prev, alpha, dt, pending);
    for (let i = 0; i < VIEW_PARTS.length; i++) cur[VIEW_PART0 + i] = view.partMs[i];
    t0 = performance.now();
    uiFrame.armed = gestures.isArmed;
    uiFrame.dt = dt;
    ui.update(uiFrame);
    t1 = performance.now();
    cur[PART.ui] = t1 - t0;
    t0 = t1;
    haptics.frame(pending, pendingGame, dt);
    t1 = performance.now();
    cur[PART.haptics] = t1 - t0;
    t0 = t1;
    audio.update(audioView(sim, ui.paused), pending, world.lines, dt);
    cur[PART.audio] = performance.now() - t0;
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
    cur.fill(0);
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
    // A scripted route stands in for the player's thumb: its own cost is reported as a part, not
    // counted as the game's frame work.
    lastWork = performance.now() - t0 - cur[PART.route];
    frames++;
    if (statFrames < STATS_CAP) {
      let reducers = 0;
      for (const r of REDUCER_PARTS) reducers += cur[PART[r]];
      cur[PART.sim] = Math.max(0, cur[PART.game] - reducers);
      workBuf[statFrames] = lastWork;
      for (let i = 0; i < cur.length; i++) partBuf[i][statFrames] = cur[i];
      const p = sim.player;
      const built = cityView === null ? 0 : cityView.built();
      trackBuf[0][statFrames] = routeTick;
      trackBuf[1][statFrames] = p.x;
      trackBuf[2][statFrames] = p.z;
      trackBuf[3][statFrames] = districtAt(world, p.z);
      trackBuf[4][statFrames] = chunkOf(grid, p.x, p.z);
      trackBuf[5][statFrames] = frameHitches;
      trackBuf[6][statFrames] = built - lastBuilt;
      lastBuilt = built;
      const info = view.info();
      trackBuf[7][statFrames] = info.drawCalls;
      trackBuf[8][statFrames] = info.triangles;
      trackBuf[9][statFrames] = frameSlings;
      trackBuf[10][statFrames] = cityView === null ? 0 : cityView.framePieceMs();
      statFrames++;
    }
    frameHitches = 0;
    frameSlings = 0;
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
      cur.fill(0);
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
      const parts: Record<string, number[]> = {};
      for (let i = 0; i < FRAME_PARTS.length; i++) parts[FRAME_PARTS[i]] = Array.from(partBuf[i].subarray(0, statFrames));
      return {
        frames,
        workMs: Array.from(workBuf.subarray(0, statFrames)),
        drawCalls: info.drawCalls,
        triangles: info.triangles,
        parts,
        stepMs: Array.from(stepBuf.subarray(0, statSteps)),
        track: Object.fromEntries(TRACK.map((n, i) => [n, Array.from(trackBuf[i].subarray(0, statFrames))])),
        windows: routeWindows(params.route),
        stream: cityView === null ? undefined : cityView.stats(),
      };
    },
    resetStats() {
      statFrames = 0;
      statSteps = 0;
      frames = 0;
      frameHitches = 0;
      frameSlings = 0;
    },
  });

  if (params.e2e) draw(1, DT);
  else requestAnimationFrame(frame);
}

boot();
