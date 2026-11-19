/**
 * Boot: read the URL, make the terrain and the input source, then run the sim on the fixed 60 Hz
 * clock and draw every animation frame between its last two states.
 *
 * Each tick: `input.sample(frame)`, then `sim.step(frame)`. Each frame: mover view, camera, HUD,
 * render.
 */
import { GameAudio } from '../audio/audio';
import { ChaseCamera } from '../render/camera';
import { BossView } from '../render/bossView';
import { FxView } from '../render/fxView';
import { HordeView } from '../render/hordeView';
import { LOOK_ID, PALETTE, switchLook } from '../render/look';
import { MoverView } from '../render/moverView';
import { RailsView } from '../render/railsView';
import { Shake } from '../render/shake';
import { GameScene } from '../render/scene';
import { ShotsView } from '../render/shotsView';
import { SparksView } from '../render/sparksView';
import { makeTerrainView } from '../render/terrainView';
import { ThingsView } from '../render/thingsView';
import { WakeView } from '../render/wakeView';
import { WeaponsView } from '../render/weaponsView';
import { ZonesView } from '../render/zonesView';
import type { InputSource, Scheme } from '../input/source';
import { TouchInput } from '../input/touch';
import { DT } from '../sim/constants';
import { Rng, hashString } from '../sim/rng';
import { Sim } from '../sim/sim';
import { BOWL_RADIUS, makeBowl } from '../sim/bowl';
import { flatTerrain, type Terrain } from '../sim/terrain';
import { KIND_SHUFFLER, PHASE_CHOOSE, PHASE_DEAD, PHASE_PLAY, PHASE_WON, spawnEnemy } from '../sim/world';
import { makeInputFrame } from '../sim/types';
import { BuildBar } from '../ui/buildBar';
import { autoPickCard, Cards } from '../ui/cards';
import { DebugPanel } from '../ui/debugPanel';
import { EndScreen } from '../ui/endScreen';
import { Hud } from '../ui/hud';
import { HowTo } from '../ui/howTo';
import { ReportView } from '../ui/reportView';
import { LowHealthView } from '../ui/lowHealth';
import { makeLookSwitch } from '../ui/lookSwitch';
import { LessonView } from '../ui/lessonView';
import { Numbers } from '../ui/numbers';
import { bindAutoPause, PauseView } from '../ui/pause';
import { StickView } from '../ui/stickView';
import { ThreatView } from '../ui/threat';
import { applyArsenal, applyFixture } from './fixtures';
import { Haptics } from './haptics';
import { HitStop } from './hitstop';
import { Lesson, LESSON, lessonWanted, makeLessonSample } from './lesson';
import { FixedStepper, FrameStats, RafDriver, TimeRamp } from './loop';
import { parseParams, type Params } from './params';
import { setupPlatform } from './platform';
import { registerPwa } from './pwa';
import { ReportStore } from './reports';
import { RunLog, statsLines, type Outcome, type RunReport } from './runLog';
import { browserStorage, prefersReducedMotion, Settings } from './settings';
import { HookInput, installTestHook, type TestHook } from './testHook';

/** The one place the terrain is made. */
function makeTerrain(params: Params): Terrain {
  return params.flat ? flatTerrain(BOWL_RADIUS) : makeBowl(params.seed);
}

/** The card the player chose, waiting to go to the sim on the next tick. */
class PickBox {
  private pending = -1;

  set(index: number): void {
    this.pending = index;
  }

  /** The pending pick, once; -1 afterwards. */
  take(): number {
    const p = this.pending;
    this.pending = -1;
    return p;
  }
}

/**
 * The one place the input source is made: the thumb, with the test hook's script laid over it, and
 * the chosen card carried on exactly one frame.
 */
function makeInput(
  scheme: Scheme,
  surface: HTMLElement,
  hookInput: HookInput,
  picks: PickBox,
): { source: InputSource; touch: TouchInput } {
  const touch = new TouchInput(surface, scheme);
  const source: InputSource = {
    sample(out) {
      touch.sample(out);
      hookInput.overlay(out);
      out.pick = picks.take();
    },
  };
  return { source, touch };
}

function setThemeColour(colour: number): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', `#${colour.toString(16).padStart(6, '0')}`);
}

function boot(): void {
  // First, before anything that can throw (no WebGL, a bad seed): a broken build must still be able
  // to receive a fixed one.
  registerPwa();
  const params = parseParams(window.location.search);
  setThemeColour(PALETTE.sky);
  setupPlatform();

  const settings = new Settings(browserStorage(), window.location.search, params.scheme, undefined, prefersReducedMotion());
  settings.applySaved();

  const terrain = makeTerrain(params);
  const sim = new Sim(terrain, { seed: params.seed, horde: !params.flat && !params.solo });
  // Off unless the owner switched it on in the panel: the cards are the game. A measured (`?perf`)
  // run has nobody to choose, and the world would hold at the first level.
  const applyAutoPick = (): void => {
    sim.picker = settings.autoPick || params.perf || params.arsenal ? autoPickCard : null;
  };
  applyAutoPick();
  const picks = new PickBox();
  // The playtest report: what the run measured, kept for the last ten runs.
  const runLog = new RunLog();
  const reportStore = new ReportStore(browserStorage());
  let finished: RunReport | null = null;
  const makeReport = (outcome?: Outcome): RunReport => {
    runLog.meta.scheme = settings.scheme;
    return runLog.report(sim, outcome);
  };
  /** The run on screen, finished or so far. */
  const currentReport = (): RunReport => finished ?? makeReport();
  /** A run restarted or left while it was still going is kept as abandoned. */
  const abandonRun = (): void => {
    const phase = sim.world.run.phase;
    if (finished === null && sim.horde && (phase === PHASE_PLAY || phase === PHASE_CHOOSE)) reportStore.keep(makeReport('abandoned'));
  };
  const meta = runLog.meta;
  meta.look = LOOK_ID;
  meta.userAgent = navigator.userAgent;
  meta.screenW = window.screen.width;
  meta.screenH = window.screen.height;
  meta.dpr = window.devicePixelRatio;
  meta.standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  meta.build = __SHMOOVE_BUILD__ ? 'unknown (no service worker cache found)' : 'dev';
  if (__SHMOOVE_BUILD__) {
    // The service worker's cache name is the build's id.
    void (async () => {
      try {
        const name = (await caches.keys()).find((k) => k.startsWith('shmoove-'));
        if (name !== undefined) meta.build = name;
      } catch (_err) {
        meta.build = 'unknown (caches unavailable)';
      }
    })();
  }
  runLog.reset(Date.now());
  const applyFixtures = (): void => {
    if (params.horde > 0 || params.sparks > 0) applyFixture(sim, params.horde, params.sparks);
    if (params.arsenal) applyArsenal(sim);
  };
  applyFixtures();
  const hookInput = new HookInput();
  const frameInput = makeInputFrame();

  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  document.body.appendChild(canvas);
  const { source: input, touch } = makeInput(settings.scheme, canvas, hookInput, picks);
  const view = new GameScene(canvas);
  view.scene.add(makeTerrainView(terrain));
  // The rails never move: drawn once, from the terrain, with nothing to update per frame.
  view.scene.add(new RailsView(terrain).object);
  const mover = new MoverView();
  view.scene.add(mover.object);
  // The horde, sparks, shots, the Wake and effects: drawn from the world, never writing it.
  const horde = new HordeView(terrain);
  const sparks = new SparksView();
  const shots = new ShotsView();
  const wake = new WakeView();
  const fx = new FxView(terrain);
  const zones = new ZonesView(terrain);
  const bosses = new BossView(terrain);
  const things = new ThingsView(terrain);
  const weapons = new WeaponsView();
  const groundAt = (x: number, z: number): number => terrain.heightAt(x, z);
  view.scene.add(bosses.object, zones.object, wake.mesh, things.object, horde.object, sparks.mesh, shots.mesh, weapons.object, fx.object);
  const chase = new ChaseCamera(view.camera);
  const hudRoot = document.getElementById('hud') ?? document.body;
  const hud = new Hud(hudRoot, { run: sim.horde, debug: params.debug });
  const stick = new StickView(hudRoot, touch.gestures);
  const threat = new ThreatView(hudRoot);
  const lowHealth = new LowHealthView(hudRoot);
  const shake = new Shake();
  const hitStop = new HitStop();
  const haptics = Haptics.browser();
  const numbers = sim.horde ? new Numbers(hudRoot) : null;
  const buildBar = sim.horde ? new BuildBar(hudRoot) : null;
  const cards = sim.horde ? new Cards(hudRoot, (i) => {
        runLog.notePick(i);
        picks.set(i);
      }) : null;
  // Sound: silent until the first touch (browsers insist); `?mute` silences one visit.
  const audio = new GameAudio({
    muted: params.mute || settings.mute,
    volume: settings.musicVolume,
    seed: params.seed,
    save: (muted, volume) => settings.chooseSound(muted, volume),
  });
  const panel = params.debug
    ? new DebugPanel(hudRoot, settings, (s) => touch.setScheme(s), () => applyAutoPick(), audio)
    : null;

  // The first-run lesson: on the real bowl, with the horde held back until the player can use it.
  const lessonSample = makeLessonSample();
  let lesson: Lesson | null = null;
  const lessonView = sim.horde ? new LessonView(hudRoot, () => endLesson(), { debug: params.debug }) : null;
  const lessonGate = {
    force: params.lesson,
    skip: params.nolesson,
    done: settings.lessonDone,
    flat: params.flat,
    solo: params.solo,
    horde: params.horde > 0 || params.sparks > 0,
    arsenal: params.arsenal,
    perf: params.perf,
  };
  /** A lesson has no crates or shrines to open cards over it. */
  const startLesson = (): void => {
    lesson = new Lesson();
    sim.world.spawning = false;
    sim.world.things.count = 0;
    // Cards are never picked for the player during the lesson.
    sim.picker = null;
  };
  if (sim.horde && lessonWanted(lessonGate)) startLesson();
  /** Eight shufflers come up 25 to 35 m ahead of the mover, inside the map. */
  const spawnLessonCrowd = (): void => {
    const w = sim.world;
    const m = sim.state.mover;
    const rng = new Rng(hashString('lesson-crowd', w.seed + sim.state.tick));
    const limit = Math.max(0, terrain.radius - 4);
    for (let n = 0; n < LESSON.crowd; n++) {
      let x = m.x;
      let z = m.z;
      for (let tries = 0; tries < 24; tries++) {
        const dist = rng.range(LESSON.crowdNear, LESSON.crowdFar);
        // Ahead, in a fan; if that is off the map, anywhere round.
        const a = tries < 8 ? sim.state.viewYaw + rng.range(-0.5, 0.5) : rng.range(0, Math.PI * 2);
        x = m.x + Math.sin(a) * dist;
        z = m.z + Math.cos(a) * dist;
        if (x * x + z * z <= limit * limit) break;
      }
      spawnEnemy(w, KIND_SHUFFLER, x, terrain.heightAt(x, z), z);
    }
  };
  /** Once a tick while the lesson runs: what it holds still, what it reads, what it brings on. */
  const stepLesson = (l: Lesson): void => {
    const w = sim.world;
    const s = sim.state;
    const m = s.mover;
    // The run is not on the clock, nobody dies, and no card opens before the sparks step.
    w.run.ticks = 0;
    if (w.player.hp < LESSON.minHp) w.player.hp = LESSON.minHp;
    if (l.step < 4 && w.player.xp > w.player.xpNext - 1) w.player.xp = w.player.xpNext - 1;
    const q = lessonSample;
    q.carve = frameInput.carve;
    q.distance = s.distance;
    q.speed = m.speed;
    q.events = s.events;
    q.kills = w.player.kills;
    q.offerOpen = w.run.phase === PHASE_CHOOSE;
    const before = l.step;
    l.update(q);
    if (l.ended) {
      endLesson();
      return;
    }
    if (l.takeTopUp()) w.player.xp = w.player.xpNext;
    // Eight come up when the step begins; if they are somehow gone before three are dead, more do.
    if (l.step === 3 && (before !== 3 || w.horde.count < LESSON.kills)) spawnLessonCrowd();
  };
  /** The lesson is over, finished or skipped: remember it and start the real run. */
  const endLesson = (): void => {
    settings.chooseLessonDone(true);
    restart();
  };

  const stepper = new FixedStepper(DT);
  let pauseView: PauseView | null = null;
  // After the last card is taken the game starts slow and climbs back to full speed.
  const ramp = new TimeRamp();
  let choosing = false;
  const restart = (intoLesson = false): void => {
    // A new run (REPLAY THE LESSON from the pause sheet's HOW TO PLAY) is not a paused one.
    pauseView?.resume();
    abandonRun();
    sim.reset();
    finished = null;
    runLog.reset(Date.now());
    lesson = null;
    lessonView?.hide();
    applyAutoPick();
    sim.world.spawning = true;
    if (intoLesson && sim.horde) startLesson();
    applyFixtures();
    fx.reset();
    threat.reset();
    lowHealth.reset();
    shake.reset();
    hitStop.reset();
    chase.reset();
    endScreen.reset();
    numbers?.reset();
    picks.take();
    ramp.reset();
    stepper.scale = 1;
    choosing = false;
    stepper.reset();
    audio.restart();
  };
  const howTo = new HowTo(
    hudRoot,
    () => {
      settings.chooseLessonDone(false);
      restart(true);
    },
    document,
    audio,
  );
  const reportView = new ReportView(hudRoot, reportStore);
  const endScreen = new EndScreen(hudRoot, () => restart(), document, () => howTo.open(), {
    lines: () => statsLines(currentReport()),
    copy: (button) => void reportView.copy(currentReport(), button),
  });
  const stats = new FrameStats();
  const info = view.renderer.info.render;
  let stepMs = 0;
  let steps = 0;
  let hook: TestHook | null = null;

  const tick = (): void => {
    const t0 = performance.now();
    input.sample(frameInput);
    sim.step(frameInput);
    if (lesson) {
      runLog.lessonTick(lesson.step);
      stepLesson(lesson);
    }
    runLog.afterStep(sim, frameInput.carve);
    const phase = sim.world.run.phase;
    if (finished === null && (phase === PHASE_DEAD || phase === PHASE_WON)) {
      finished = makeReport();
      reportStore.keep(finished);
    }
    const m = sim.state.mover;
    fx.ingest(sim.world, m.x, m.y, m.z, sim.state);
    numbers?.ingest(sim.world);
    shake.ingest(sim.world, sim.state);
    hitStop.ingest(sim.world);
    haptics.ingest(sim.world, sim.state);
    audio.tick(sim.world.fx, sim.state.events, m, sim.world.run.phase);
    const nowChoosing = sim.world.run.phase === PHASE_CHOOSE;
    if (choosing && !nowChoosing) ramp.begin();
    choosing = nowChoosing;
    stepMs += performance.now() - t0;
    steps++;
  };

  const draw = (alpha: number, dt: number): void => {
    mover.update(sim.prev, sim.state, alpha, terrain, dt);
    chase.update(sim.prev, sim.state, alpha, dt, terrain);
    shake.update(dt);
    shake.apply(view.camera);
    const w = sim.world;
    const a = sim.prev.mover;
    const b = sim.state.mover;
    const mx = a.x + (b.x - a.x) * alpha;
    const my = a.y + (b.y - a.y) * alpha;
    const mz = a.z + (b.z - a.z) * alpha;
    let turn = (b.heading - a.heading) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    else if (turn < -Math.PI) turn += Math.PI * 2;
    const heading = a.heading + turn * alpha;
    const now = performance.now() / 1000;
    horde.update(w, alpha, now, mx, mz, my, heading);
    sparks.update(w, now);
    shots.update(w, alpha, now);
    bosses.update(w, alpha);
    zones.update(w, alpha);
    things.update(w, now);
    weapons.update(w, sim.prev, sim.state, alpha, now);
    wake.update(w.wake, mx, mz, groundAt);
    fx.update(dt);
    threat.update(w, sim.state, view.camera, dt, fx.hitTint, window.innerWidth, window.innerHeight);
    hud.update(sim);
    lowHealth.update(w.player.maxHp > 0 ? w.player.hp / w.player.maxHp : 1, dt);
    numbers?.updateCamera(dt, view.camera, window.innerWidth, window.innerHeight);
    buildBar?.update(w.player.loadout);
    cards?.update(w, dt);
    if (lesson) lessonView?.update(lesson);
    if (sim.horde) endScreen.update(sim.world, dt);
    pauseView?.update(w.run.phase, lesson !== null);
    stick.update();
    if (panel) panel.update();
    view.render();
  };

  const finishFrame = (t0: number): void => {
    stats.record(info.calls, info.triangles, performance.now() - t0, stepMs, steps);
    if (hook && !hook.ready) hook.ready = true;
  };

  const frame = (dt: number): void => {
    // Paused, nothing moves; the last frame drawn stays on the canvas under the overlay.
    if (pauseView?.paused === true) return;
    const t0 = performance.now();
    stepMs = 0;
    steps = 0;
    // Settings are read each frame so the panel's switches take hold at once.
    const reduced = settings.reducedMotion;
    shake.enabled = !reduced;
    hitStop.enabled = !reduced;
    lowHealth.reduced = reduced;
    haptics.enabled = settings.haptics;
    if (dt > 0) runLog.frame(dt * 1000);
    ramp.update(dt);
    hitStop.update(dt);
    stepper.scale = ramp.scale * hitStop.scale;
    const alpha = stepper.advance(dt, tick);
    draw(alpha, dt);
    finishFrame(t0);
  };

  const driver = new RafDriver(frame);
  /** The test hook holds the real-time clock (its `pause(true)`): the game's own resume leaves it stopped. */
  let hookHeld = false;

  // Pause: the button, the overlay, and pausing itself when the page goes away. Only with a run:
  // the bare bowl (`?solo`, `?flat`) has nothing to lose.
  pauseView = sim.horde
    ? new PauseView(
        hudRoot,
        {
          onPause() {
            driver.pause();
            stepper.reset();
            audio.setPaused(true);
          },
          onResume() {
            // No catch-up: the clock starts from nothing, the rider where it was.
            stepper.reset();
            audio.setPaused(false);
            if (!hookHeld) driver.start();
          },
          onHowTo: () => howTo.open(),
          onReports: () => reportView.open(),
        },
        { debug: params.debug, reports: true, extra: makeLookSwitch(document, LOOK_ID, switchLook) },
      )
    : null;
  if (pauseView) {
    const pv = pauseView;
    bindAutoPause(window, document, () => pv.pause());
    // Closing the page mid-run keeps what was measured so far.
    window.addEventListener('pagehide', abandonRun);
    // A resize clears the canvas: while paused, draw the held frame again once it has settled.
    window.addEventListener('resize', () => {
      if (!pv.paused) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (pv.paused) draw(stepper.alpha, 0);
      }));
    });
  }

  if (params.hook) {
    hook = installTestHook({
      sim,
      input: hookInput,
      pause(on) {
        hookHeld = on;
        if (on) {
          driver.pause();
          stepper.reset();
        } else if (pauseView?.paused !== true) driver.start();
      },
      paused: () => pauseView?.paused === true,
      stepNow(n) {
        const t0 = performance.now();
        stepMs = 0;
        steps = 0;
        for (let i = 0; i < n; i++) tick();
        draw(1, n * DT);
        finishFrame(t0);
      },
      restart: () => restart(),
      stats: () => stats.summary(),
      pick: (index) => {
        runLog.notePick(index);
        picks.set(index);
      },
      report: () => (sim.horde ? currentReport() : null),
      sound: () => audio.report(),
    });
  }

  driver.start();
}

boot();
