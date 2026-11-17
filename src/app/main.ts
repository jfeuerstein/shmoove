/**
 * Boot and main loop. Fixed 60 Hz sim steps from an accumulator; rendering interpolates. With
 * `?e2e` nothing runs on its own: the test harness advances time through the hook.
 */
import { Gestures, attachGestures } from '../input/gestures';
import { createView } from '../render/view';
import { DT } from '../sim/constants';
import { Game, type GameEvent } from '../sim/game/game';
import { buildSlice } from '../sim/slice';
import { MODE_NAMES, type InputFrame, type SimEvent } from '../sim/types';
import { createUi } from '../ui/index';
import { createDebugPanel, type DebugPanel } from './debugPanel';
import { getParams } from './params';
import { getRoute } from './routes';
import { installHook } from './testHook';

const MAX_CATCH_UP = 4;
const STATS_CAP = 20000;

function boot(): void {
  const params = getParams();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui') as HTMLElement;

  const world = buildSlice(params.seed);
  const game = new Game(world, { seed: params.seed, startDayFrac: params.t ?? undefined });
  const sim = game.sim;
  const gestures = new Gestures();
  attachGestures(canvas, gestures);
  const view = createView(canvas, world);
  const route = getRoute(params.route);
  const panel: DebugPanel | null = params.debug ? createDebugPanel(uiRoot) : null;
  // After the panel, so the UI can keep its controls clear of it.
  const ui = createUi(uiRoot, game, null);

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
    view.render(sim, prev, alpha, dt, pending);
    uiFrame.armed = gestures.isArmed;
    uiFrame.dt = dt;
    ui.update(uiFrame);
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
