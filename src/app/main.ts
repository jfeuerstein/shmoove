/**
 * Boot: read the URL, make the terrain and the input source, then run the sim on the fixed 60 Hz
 * clock and draw every animation frame between its last two states.
 *
 * Each tick: `input.sample(frame)`, then `sim.step(frame)`. Each frame: mover view, camera, HUD,
 * render.
 */
import { ChaseCamera } from '../render/camera';
import { FxView } from '../render/fxView';
import { HordeView } from '../render/hordeView';
import { PALETTE } from '../render/look';
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
import { KIND_SHUFFLER, PHASE_CHOOSE, spawnEnemy } from '../sim/world';
import { makeInputFrame } from '../sim/types';
import { BuildBar } from '../ui/buildBar';
import { autoPickCard, Cards } from '../ui/cards';
import { DebugPanel } from '../ui/debugPanel';
import { EndScreen } from '../ui/endScreen';
import { Hud } from '../ui/hud';
import { HowTo } from '../ui/howTo';
import { LowHealthView } from '../ui/lowHealth';
import { LessonView } from '../ui/lessonView';
import { Numbers } from '../ui/numbers';
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
  const things = new ThingsView(terrain);
  const weapons = new WeaponsView();
  const groundAt = (x: number, z: number): number => terrain.heightAt(x, z);
  view.scene.add(zones.object, wake.mesh, things.object, horde.object, sparks.mesh, shots.mesh, weapons.object, fx.object);
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
  const cards = sim.horde ? new Cards(hudRoot, (i) => picks.set(i)) : null;
  const panel = params.debug
    ? new DebugPanel(hudRoot, settings, (s) => touch.setScheme(s), () => applyAutoPick())
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
  // After the last card is taken the game starts slow and climbs back to full speed.
  const ramp = new TimeRamp();
  let choosing = false;
  const restart = (intoLesson = false): void => {
    sim.reset();
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
  };
  const howTo = new HowTo(hudRoot, () => {
    settings.chooseLessonDone(false);
    restart(true);
  });
  const endScreen = new EndScreen(hudRoot, () => restart(), document, () => howTo.open());
  const stats = new FrameStats();
  const info = view.renderer.info.render;
  let stepMs = 0;
  let steps = 0;
  let hook: TestHook | null = null;

  const tick = (): void => {
    const t0 = performance.now();
    input.sample(frameInput);
    sim.step(frameInput);
    if (lesson) stepLesson(lesson);
    const m = sim.state.mover;
    fx.ingest(sim.world, m.x, m.y, m.z, sim.state);
    numbers?.ingest(sim.world);
    shake.ingest(sim.world, sim.state);
    hitStop.ingest(sim.world);
    haptics.ingest(sim.world, sim.state);
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
    zones.update(w);
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
    stick.update();
    if (panel) panel.update();
    view.render();
  };

  const finishFrame = (t0: number): void => {
    stats.record(info.calls, info.triangles, performance.now() - t0, stepMs, steps);
    if (hook && !hook.ready) hook.ready = true;
  };

  const frame = (dt: number): void => {
    const t0 = performance.now();
    stepMs = 0;
    steps = 0;
    // Settings are read each frame so the panel's switches take hold at once.
    const reduced = settings.reducedMotion;
    shake.enabled = !reduced;
    hitStop.enabled = !reduced;
    lowHealth.reduced = reduced;
    haptics.enabled = settings.haptics;
    ramp.update(dt);
    hitStop.update(dt);
    stepper.scale = ramp.scale * hitStop.scale;
    const alpha = stepper.advance(dt, tick);
    draw(alpha, dt);
    finishFrame(t0);
  };

  const driver = new RafDriver(frame);

  if (params.hook) {
    hook = installTestHook({
      sim,
      input: hookInput,
      pause(on) {
        if (on) {
          driver.pause();
          stepper.reset();
        } else driver.start();
      },
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
      pick: (index) => picks.set(index),
    });
  }

  driver.start();
}

boot();
