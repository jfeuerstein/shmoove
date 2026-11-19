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
import { makeInputFrame } from '../sim/types';
import { DebugPanel } from '../ui/debugPanel';
import { EndScreen } from '../ui/endScreen';
import { Hud } from '../ui/hud';
import { StickView } from '../ui/stickView';
import { ThreatView } from '../ui/threat';
import { applyFixture } from './fixtures';
import { FixedStepper, FrameStats, RafDriver } from './loop';
import { parseParams, type Params } from './params';
import { setupPlatform } from './platform';
import { registerPwa } from './pwa';
import { browserStorage, Settings } from './settings';
import { HookInput, installTestHook, type TestHook } from './testHook';

/** The one place the terrain is made. */
function makeTerrain(params: Params): Terrain {
  return params.flat ? flatTerrain(BOWL_RADIUS) : makeBowl(params.seed);
}

/** The one place the input source is made: the thumb, with the test hook's script laid over it. */
function makeInput(scheme: Scheme, surface: HTMLElement, hookInput: HookInput): { source: InputSource; touch: TouchInput } {
  const touch = new TouchInput(surface, scheme);
  const source: InputSource = {
    sample(out) {
      touch.sample(out);
      hookInput.overlay(out);
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
  const sim = new Sim(terrain, { seed: params.seed, horde: !params.flat && !params.solo, autoPick: true });
  if (params.horde > 0 || params.sparks > 0) applyFixture(sim, params.horde, params.sparks);
  const hookInput = new HookInput();
  const frameInput = makeInputFrame();

  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  document.body.appendChild(canvas);
  const { source: input, touch } = makeInput(settings.scheme, canvas, hookInput);
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
  const panel = params.debug ? new DebugPanel(hudRoot, settings, (s) => touch.setScheme(s)) : null;

  const stepper = new FixedStepper(DT);
  const restart = (): void => {
    sim.reset();
    if (params.horde > 0 || params.sparks > 0) applyFixture(sim, params.horde, params.sparks);
    fx.reset();
    threat.reset();
    chase.reset();
    endScreen.reset();
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
    });
  }

  driver.start();
}

boot();
