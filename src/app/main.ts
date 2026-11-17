// Temporary boot: a harness fixture that proves build, input, the fixed-step loop and the test hook
// work end to end. The lead replaces this file with the real game boot.
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { getParams } from './params';
import { installHook, type SkitchPerfStats, type SkitchTestState } from './testHook';

const STEP_MS = 1000 / 60;
const MAX_CATCH_UP = 4;
const SPIN_PER_TICK = 0.02;
const CAMERA_Z = 6;
const FOV_DEG = 50;

const params = getParams();
const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#game canvas missing');

const renderer = new WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(new Color('#D9D2C3'), 1);

const scene = new Scene();
const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
camera.position.set(0, 0, CAMERA_Z);
scene.add(new HemisphereLight(0xffffff, 0x8a7f6a, 1.2));
const sun = new DirectionalLight(0xffffff, 1.6);
sun.position.set(2, 3, 4);
scene.add(sun);
const cube = new Mesh(
  new BoxGeometry(0.8, 0.8, 0.8),
  new MeshLambertMaterial({ color: new Color('#FFAE1A'), flatShading: true }),
);
cube.rotation.x = 0.5;
scene.add(cube);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

// Input: the current touch x in CSS px, or null when no finger is down.
let touchX: number | null = null;
canvas.addEventListener('pointerdown', (e) => {
  touchX = e.clientX;
});
canvas.addEventListener('pointermove', (e) => {
  if (touchX !== null) touchX = e.clientX;
});
const release = (): void => {
  touchX = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// Sim state for the fixture.
let tick = 0;
let cubeX = 0;

function step(): void {
  if (touchX !== null) {
    const halfH = Math.tan((FOV_DEG * Math.PI) / 360) * CAMERA_Z;
    const halfW = halfH * camera.aspect;
    cubeX = ((touchX / window.innerWidth) * 2 - 1) * halfW;
  }
  cube.position.x = cubeX;
  cube.rotation.y += SPIN_PER_TICK;
  tick++;
}

// Perf stats since the last reset.
let workMs: number[] = [];
let drawCalls = 0;
let triangles = 0;

function render(): void {
  renderer.render(scene, camera);
  drawCalls = renderer.info.render.calls;
  triangles = renderer.info.render.triangles;
}

function frame(steps: number): void {
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) step();
  render();
  workMs.push(performance.now() - t0);
}

let acc = 0;
let last = -1;
function loop(now: number): void {
  if (last >= 0) acc += now - last;
  last = now;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_CATCH_UP) {
    acc -= STEP_MS;
    steps++;
  }
  if (steps === MAX_CATCH_UP) acc = Math.min(acc, STEP_MS);
  frame(steps);
  requestAnimationFrame(loop);
}

installHook({
  ready: false,
  manual: params.e2e,
  advance(ticks: number): void {
    if (!params.e2e) throw new Error('advance() is only available with ?e2e');
    frame(Math.max(0, Math.floor(ticks)));
  },
  state(): SkitchTestState {
    return { tick, mode: 'BOOT', x: cubeX, y: 0, z: 0, speed: 0, chain: 0, hitchedLine: null, dayFrac: 0 };
  },
  stats(): SkitchPerfStats {
    return { frames: workMs.length, workMs: workMs.slice(), drawCalls, triangles };
  },
  resetStats(): void {
    workMs = [];
  },
});

render();
if (!params.e2e) requestAnimationFrame(loop);
const hook = window.__skitch;
if (hook) hook.ready = true;
