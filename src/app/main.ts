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
import { GameScene } from '../render/scene';
import { ShotsView } from '../render/shotsView';
import { SparksView } from '../render/sparksView';
import { makeTerrainView } from '../render/terrainView';
import { WakeView } from '../render/wakeView';
import type { InputSource, Scheme } from '../input/source';
import { TouchInput } from '../input/touch';
import { DT } from '../sim/constants';
import { Sim } from '../sim/sim';
import { BOWL_RADIUS, makeBowl } from '../sim/bowl';
import { flatTerrain, type Terrain } from '../sim/terrain';
import { PHASE_CHOOSE } from '../sim/world';
import { makeInputFrame } from '../sim/types';
import { BuildBar } from '../ui/buildBar';
import { autoPickCard, Cards } from '../ui/cards';
import { DebugPanel } from '../ui/debugPanel';
import { EndScreen } from '../ui/endScreen';
import { Hud } from '../ui/hud';
import { Numbers } from '../ui/numbers';
import { StickView } from '../ui/stickView';
import { ThreatView } from '../ui/threat';
import { applyFixture } from './fixtures';
import { FixedStepper, FrameStats, RafDriver, TimeRamp } from './loop';
import { parseParams, type Params } from './params';
import { setupPlatform } from './platform';
import { registerPwa } from './pwa';
import { browserStorage, Settings } from './settings';
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

  const settings = new Settings(browserStorage(), window.location.search, params.scheme);
  settings.applySaved();

  const terrain = makeTerrain(params);
  const sim = new Sim(terrain, { seed: params.seed, horde: !params.flat && !params.solo });
  // Off unless the owner switched it on in the panel: the cards are the game. A measured (`?perf`)
  // run has nobody to choose, and the world would hold at the first level.
  const applyAutoPick = (): void => {
    sim.picker = settings.autoPick || params.perf ? autoPickCard : null;
  };
  applyAutoPick();
  const picks = new PickBox();
  if (params.horde > 0 || params.sparks > 0) applyFixture(sim, params.horde, params.sparks);
  const hookInput = new HookInput();
  const frameInput = makeInputFrame();

  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  document.body.appendChild(canvas);
  const { source: input, touch } = makeInput(settings.scheme, canvas, hookInput, picks);
  const view = new GameScene(canvas);
  view.scene.add(makeTerrainView(terrain));
  const mover = new MoverView();
  view.scene.add(mover.object);
  // The horde, sparks, shots, the Wake and effects: drawn from the world, never writing it.
  const horde = new HordeView();
  const sparks = new SparksView();
  const shots = new ShotsView();
  const wake = new WakeView();
  const fx = new FxView(terrain);
  const groundAt = (x: number, z: number): number => terrain.heightAt(x, z);
  view.scene.add(wake.mesh, horde.object, sparks.mesh, shots.mesh, fx.object);
  const chase = new ChaseCamera(view.camera);
  const hudRoot = document.getElementById('hud') ?? document.body;
  const hud = new Hud(hudRoot, { run: sim.horde, debug: params.debug });
  const stick = new StickView(hudRoot, touch.gestures);
  const threat = new ThreatView(hudRoot);
  const numbers = sim.horde ? new Numbers(hudRoot) : null;
  const buildBar = sim.horde ? new BuildBar(hudRoot) : null;
  const cards = sim.horde ? new Cards(hudRoot, (i) => picks.set(i)) : null;
  const panel = params.debug
    ? new DebugPanel(hudRoot, settings, (s) => touch.setScheme(s), () => applyAutoPick())
    : null;

  const stepper = new FixedStepper(DT);
  // After the last card is taken the game starts slow and climbs back to full speed.
  const ramp = new TimeRamp();
  let choosing = false;
  const restart = (): void => {
    sim.reset();
    if (params.horde > 0 || params.sparks > 0) applyFixture(sim, params.horde, params.sparks);
    fx.reset();
    threat.reset();
    chase.reset();
    endScreen.reset();
    numbers?.reset();
    picks.take();
    ramp.reset();
    stepper.scale = 1;
    choosing = false;
    stepper.reset();
  };
  const endScreen = new EndScreen(hudRoot, restart);
  const stats = new FrameStats();
  const info = view.renderer.info.render;
  let stepMs = 0;
  let steps = 0;
  let hook: TestHook | null = null;

  const tick = (): void => {
    const t0 = performance.now();
    input.sample(frameInput);
    sim.step(frameInput);
    fx.ingest(sim.world);
    numbers?.ingest(sim.world);
    const nowChoosing = sim.world.run.phase === PHASE_CHOOSE;
    if (choosing && !nowChoosing) ramp.begin();
    choosing = nowChoosing;
    stepMs += performance.now() - t0;
    steps++;
  };

  const draw = (alpha: number, dt: number): void => {
    mover.update(sim.prev, sim.state, alpha, terrain);
    chase.update(sim.prev, sim.state, alpha, dt, terrain);
    const w = sim.world;
    const a = sim.prev.mover;
    const b = sim.state.mover;
    const mx = a.x + (b.x - a.x) * alpha;
    const mz = a.z + (b.z - a.z) * alpha;
    const now = performance.now() / 1000;
    horde.update(w, alpha, now, mx, mz);
    sparks.update(w, now);
    shots.update(w, alpha);
    wake.update(w.wake, mx, mz, groundAt);
    fx.update(dt);
    threat.update(w, sim.state, view.camera, dt, fx.hitTint, window.innerWidth, window.innerHeight);
    hud.update(sim);
    numbers?.updateCamera(dt, view.camera, window.innerWidth, window.innerHeight);
    buildBar?.update(w.player.loadout);
    cards?.update(w, dt);
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
    ramp.update(dt);
    stepper.scale = ramp.scale;
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
      restart,
      stats: () => stats.summary(),
      pick: (index) => picks.set(index),
    });
  }

  driver.start();
}

boot();
