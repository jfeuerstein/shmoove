/**
 * The view: owns the WebGL renderer and the scene, and draws one frame from sim state. It reads
 * the sim and never writes it.
 */
import * as THREE from 'three';
import { FEEL } from '../sim/constants';
import { slingPreview } from '../sim/hitch';
import type { Sim } from '../sim/sim';
import { Mode, type SimEvent } from '../sim/types';
import { makeGroundSample, sampleGround, type World } from '../sim/world';
import { ChaseCamera, type CamTarget } from './camera';
import { MeshBuilder } from './geom';
import { INK, applyTimeOfDay, createRiso, createSky, inkMaterial, type Riso } from './look';
import { createSkaterView, type SkaterFrame } from './skater';
import { createVehicleView } from './vehicles';
import { createStaticWorldView, type WorldView } from './worldView';

export interface ViewOpts {
  /** Build the drawn world. Defaults to the static whole-world mesher. */
  worldView?: (world: World) => WorldView;
}

export interface View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly chase: ChaseCamera;
  readonly riso: Riso;
  /** Draw a frame: `alpha` of the way from `prev` (skater position before the last step) to now. */
  render(sim: Sim, prev: { x: number; y: number; z: number }, alpha: number, dt: number, events: readonly SimEvent[]): void;
  resize(): void;
  /** Draw calls and triangles of the last frame (scene pass plus print pass). */
  info(): { drawCalls: number; triangles: number };
  dispose(): void;
}

const _grab = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _g = makeGroundSample();

export function createView(canvas: HTMLCanvasElement, world: World, opts: ViewOpts = {}): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.info.autoReset = false;
  renderer.setClearColor(INK.paper, 1);

  const scene = new THREE.Scene();
  const chase = new ChaseCamera();
  const riso = createRiso();
  scene.add(createSky());

  const worldView = (opts.worldView ?? createStaticWorldView)(world);
  scene.add(worldView.group);
  const vehicles = createVehicleView(world);
  scene.add(vehicles.group);
  const skater = createSkaterView();
  scene.add(skater.group);

  // The strap between hand and grab point: a unit beam stretched each frame.
  const strapB = new MeshBuilder();
  strapB.box(0, 0, 0.5, 0.5, 0.5, 0.5, 1, 0, INK.pink, { bottom: true });
  const strap = new THREE.Mesh(strapB.build(), inkMaterial());
  strap.frustumCulled = false;
  strap.visible = false;
  scene.add(strap);

  // The aim tick: a ground arrow showing where a release would throw you.
  const aimB = new MeshBuilder();
  aimB.quad(-0.09, 0, 0, -0.09, 0, 1, 0.09, 0, 1, 0.09, 0, 0, INK.mango, 1);
  const tip0 = aimB.vert(-0.32, 0, 1, INK.mango, 1);
  const tip1 = aimB.vert(0, 0, 1.55, INK.mango, 1);
  const tip2 = aimB.vert(0.32, 0, 1, INK.mango, 1);
  aimB.tri(tip0, tip1, tip2);
  const aim = new THREE.Mesh(aimB.build(), inkMaterial());
  aim.frustumCulled = false;
  aim.visible = false;
  scene.add(aim);

  let last = { drawCalls: 0, triangles: 0 };
  let snapped = false;
  const frame: SkaterFrame = { x: 0, y: 0, z: 0, yaw: 0, mode: 0, steer: 0, speed: 0, vy: 0, hanging: false, groundY: 0, tick: 0 };
  const target: CamTarget = { x: 0, y: 0, z: 0, vx: 0, vz: 0, heading: 0, mode: 0, speed: 0, surface: 0, rideYaw: null };

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    riso.setSize(w, h, pr);
    chase.setAspect(w / h);
  };
  resize();

  return {
    renderer,
    scene,
    chase,
    riso,
    resize,
    render(sim, prev, alpha, dt, events) {
      const p = sim.player;
      const x = prev.x + (p.x - prev.x) * alpha;
      const y = prev.y + (p.y - prev.y) * alpha;
      const z = prev.z + (p.z - prev.z) * alpha;

      for (const e of events) {
        if (e.type === 'land') chase.kick(Math.min(1, e.impact / 14));
        else if (e.type === 'bail') chase.kick(1.2);
        else if (e.type === 'wallHit') chase.kick(Math.min(0.8, e.speed / 12));
        else if (e.type === 'hitch') chase.kick(0.25);
        else if (e.type === 'bounce') chase.kick(0.4);
        else if (e.type === 'recover') snapped = false;
      }

      applyTimeOfDay(sim.dayFrac);
      vehicles.update(sim.tick, alpha);
      worldView.update(chase.camera.position.x, chase.camera.position.z, sim.dayFrac);

      sampleGround(world, x, y, z, FEEL.STEP_UP, _g);
      const hitched = p.mode === Mode.HITCH;
      let yaw = p.heading;
      let rideYaw: number | null = null;
      let hanging = false;
      if (hitched) {
        const line = world.lines[p.hLine];
        vehicles.grabAt(p.hLine, p.hVeh, sim.tick, alpha, _grab);
        if (Math.hypot(_grab.x - x, _grab.z - z) > 0.3) yaw = Math.atan2(_grab.x - x, _grab.z - z);
        rideYaw = p.psiRest + Math.PI;
        hanging = line.overhead && y - _g.y > 0.4;
        // Strap from the leading hand to the grab point.
        if (hanging) _hand.set(x, y + 1.78, z);
        else _hand.set(x + Math.sin(yaw) * 0.45, y + 1.3, z + Math.cos(yaw) * 0.45);
        const len = _hand.distanceTo(_grab);
        strap.visible = len > 0.05;
        strap.position.copy(_hand);
        strap.lookAt(_grab);
        strap.scale.set(0.05, 0.05, len);
        // Aim tick along the exit a release would give now.
        const pre = slingPreview(sim);
        if (pre) {
          aim.visible = true;
          aim.position.set(x, _g.y + 0.08, z);
          aim.rotation.y = Math.atan2(pre.x, pre.z);
          const s = 1.6 + pre.speed * 0.16;
          aim.scale.set(1.4, 1, s);
        }
      } else {
        strap.visible = false;
        aim.visible = false;
      }

      frame.x = x;
      frame.y = y;
      frame.z = z;
      frame.yaw = yaw;
      frame.mode = p.mode;
      frame.steer = p.steer;
      frame.speed = p.speed;
      frame.vy = p.vy;
      frame.hanging = hanging;
      frame.groundY = _g.y;
      frame.tick = sim.tick;
      skater.update(frame);

      target.x = x;
      target.y = y;
      target.z = z;
      target.vx = p.vx;
      target.vz = p.vz;
      target.heading = p.heading;
      target.mode = p.mode;
      target.speed = p.speed;
      target.surface = p.surface;
      target.rideYaw = rideYaw;
      if (!snapped) {
        chase.snap(target);
        snapped = true;
      }
      chase.update(target, world, dt);

      renderer.info.reset();
      riso.render(renderer, scene, chase.camera);
      last = { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    info: () => last,
    dispose() {
      worldView.dispose();
      vehicles.dispose();
      skater.dispose();
      riso.dispose();
      renderer.dispose();
    },
  };
}
