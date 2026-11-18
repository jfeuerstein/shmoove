/**
 * Boot: read the URL, make the terrain and the input source, then run the sim on the fixed 60 Hz
 * clock and draw every animation frame between its last two states.
 *
 * Each tick: `input.sample(frame)`, then `sim.step(frame)`. Each frame: mover view, camera, HUD,
 * render.
 */
import { ChaseCamera } from '../render/camera';
import { PALETTE } from '../render/look';
import { MoverView } from '../render/moverView';
import { GameScene } from '../render/scene';
import { makeTerrainView } from '../render/terrainView';
import type { InputSource } from '../input/source';
import { DT } from '../sim/constants';
import { Sim } from '../sim/sim';
import { flatTerrain, type Terrain } from '../sim/terrain';
import { makeInputFrame } from '../sim/types';
import { Hud } from '../ui/hud';
import { FixedStepper, FrameStats, RafDriver } from './loop';
import { parseParams, type Params } from './params';
import { setupPlatform } from './platform';
import { HookInput, installTestHook, type TestHook } from './testHook';

/** Radius of the play area until the bowl lands, m (the bowl's own radius). */
const PLAY_RADIUS = 170;

/** The one place the terrain is made. */
function makeTerrain(_params: Params): Terrain {
  return flatTerrain(PLAY_RADIUS);
}

/** The one place the input source is made. */
function makeInput(_params: Params, hookInput: HookInput): InputSource {
  return hookInput;
}

function setThemeColour(colour: number): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', `#${colour.toString(16).padStart(6, '0')}`);
}

function boot(): void {
  const params = parseParams(window.location.search);
  setThemeColour(PALETTE.sky);
  setupPlatform();

  const terrain = makeTerrain(params);
  const sim = new Sim(terrain);
  const hookInput = new HookInput();
  const input = makeInput(params, hookInput);
  const frameInput = makeInputFrame();

  const canvas = document.createElement('canvas');
  canvas.className = 'game';
  document.body.appendChild(canvas);
  const view = new GameScene(canvas);
  view.scene.add(makeTerrainView(terrain));
  const mover = new MoverView();
  view.scene.add(mover.object);
  const chase = new ChaseCamera(view.camera);
  const hudRoot = document.getElementById('hud') ?? document.body;
  const hud = new Hud(hudRoot);

  const stepper = new FixedStepper(DT);
  const stats = new FrameStats();
  const info = view.renderer.info.render;
  let stepMs = 0;
  let steps = 0;
  let hook: TestHook | null = null;

  const tick = (): void => {
    const t0 = performance.now();
    input.sample(frameInput);
    sim.step(frameInput);
    stepMs += performance.now() - t0;
    steps++;
  };

  const draw = (alpha: number, dt: number): void => {
    mover.update(sim.prev, sim.state, alpha, terrain);
    chase.update(sim.prev, sim.state, alpha, dt, terrain);
    hud.update(sim.state);
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
      stats: () => stats.summary(),
    });
  }

  driver.start();
}

boot();
