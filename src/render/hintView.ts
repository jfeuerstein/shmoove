/**
 * World pointers for onboarding hints: a big bobbing mango chevron over the thing the current hint is
 * about. For a ride it floats clear above the vehicle (roof, parasol and all) over its grab point and
 * follows it; for a waiting spot it stands over a ring on the ground where to stop and hold; for a
 * handrail it stands over the run-in and the rail is outlined in mango. Nothing otherwise.
 *
 * It also projects the target to the screen each frame (`screen`, in normalised device coordinates),
 * so the UI can turn an arrow at the screen edge toward a target that is off-screen or behind the HUD.
 *
 * One mesh, one draw call. The chevron bobs on twos by swapping between two pre-built geometries;
 * a rail's outline is built into a pair of its own when the target rail changes; a vehicle's height
 * is measured once per line from its drawn geometry. Nothing is rebuilt per frame.
 */
import * as THREE from 'three';
import type { Game } from '../sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt } from '../sim/lines';
import type { World } from '../sim/world';
import { MeshBuilder } from './geom';
import { INK, inkMaterial } from './look';
import { buildKind } from './vehicleKinds';

/** Where the pointer's target is on screen this frame. */
export interface HintScreen {
  /** A target is pointed at. */
  active: boolean;
  /** Normalised device coordinates (-1..1 across the view), valid when `active`. */
  nx: number;
  ny: number;
  /** The target is behind the camera (nx, ny are then mirrored through the centre). */
  behind: boolean;
}

export interface HintView {
  readonly screen: HintScreen;
  update(game: Game, alpha: number, dt: number): void;
  dispose(): void;
}

/** Sim ticks per bob frame: 12 Hz, like the characters. */
const TWOS = 5;
/** Height of the chevron's point above what it points at, metres, in the two bob frames. */
const LIFT_A = 0.35;
const LIFT_B = 0.7;
/** The chevron: height, half span and stroke, metres (at least 1.2 m tall: it must be impossible to miss). */
const CHEV_H = 1.35;
const CHEV_W = 0.85;
const CHEV_T = 0.17;
/** Clearance above the top of a vehicle, metres. */
const ROOF_CLEAR = 0.45;
/** Height of the rail outline above the rail, metres. */
const OUTLINE_Y = 0.06;
/** The waiting spot's ring on the ground: radius and stroke, metres. */
const RING_R = 0.85;
const RING_T = 0.09;

/** A downward chevron with its point at (0, lift, 0): two crossed V's so it reads from any side. */
function chevron(b: MeshBuilder, lift: number): void {
  // An ink stroke printed a little under the mango one, like the UI's off-register shadow: it
  // reads on bright concrete and on dark asphalt alike without hiding the mango.
  const sh = 0.16;
  for (const [ax, az] of [
    [1, 0],
    [0, 1],
  ]) {
    b.beam(0, lift - sh, 0, ax * CHEV_W, lift + CHEV_H - sh, az * CHEV_W, CHEV_T * 0.75, INK.ink, 0);
    b.beam(0, lift - sh, 0, -ax * CHEV_W, lift + CHEV_H - sh, -az * CHEV_W, CHEV_T * 0.75, INK.ink, 0);
    b.beam(0, lift, 0, ax * CHEV_W, lift + CHEV_H, az * CHEV_W, CHEV_T, INK.mango, 1);
    b.beam(0, lift, 0, -ax * CHEV_W, lift + CHEV_H, -az * CHEV_W, CHEV_T, INK.mango, 1);
  }
}

function chevronGeo(lift: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  chevron(b, lift);
  return b.build();
}

/** Chevron over a mango ring on the ground (the waiting spot), the ring at y = 0. */
function spotGeo(lift: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  chevron(b, lift);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    b.beam(RING_R * Math.cos(a0), 0.05, RING_R * Math.sin(a0), RING_R * Math.cos(a1), 0.05, RING_R * Math.sin(a1), RING_T, INK.mango, 1);
  }
  return b.build();
}

/** Chevron plus the whole rail outlined, relative to the run-in point (ox, oy, oz). */
function railGeo(world: World, rail: number, ox: number, oy: number, oz: number, lift: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  chevron(b, lift);
  const p = world.rails[rail].pts;
  for (let i = 3; i < p.length; i += 3) {
    b.beam(p[i - 3] - ox, p[i - 2] - oy + OUTLINE_Y, p[i - 1] - oz, p[i] - ox, p[i + 1] - oy + OUTLINE_Y, p[i + 2] - oz, 0.07, INK.mango, 1);
  }
  return b.build();
}

export function createHintView(scene: THREE.Scene, world: World, camera: THREE.Camera | null = null): HintView {
  const vehicleGeo = [chevronGeo(LIFT_A), chevronGeo(LIFT_B)];
  const spotGeos = [spotGeo(LIFT_A + 0.3), spotGeo(LIFT_B + 0.3)];
  let railGeos: THREE.BufferGeometry[] = [];
  let railFor = -1;
  const mesh = new THREE.Mesh(vehicleGeo[0], inkMaterial());
  mesh.name = 'hintPointer';
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  const vs = makeVehicleState();
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  /** Height of each line's vehicle above its path, measured from the drawn geometry (NaN until needed). */
  const tops = new Float64Array(world.lines.length).fill(Number.NaN);
  const topOf = (li: number): number => {
    if (Number.isNaN(tops[li])) {
      const mb = new MeshBuilder();
      buildKind(mb, world.lines[li], 0);
      const g = mb.build();
      g.computeBoundingBox();
      tops[li] = g.boundingBox ? g.boundingBox.max.y : world.lines[li].bodyHeight;
      g.dispose();
    }
    return tops[li];
  };
  const screen: HintScreen = { active: false, nx: 0, ny: 0, behind: false };
  const p = new THREE.Vector3();

  return {
    screen,
    update(game: Game, alpha: number): void {
      const ob = game.onboarding;
      const t = ob.target;
      const id = ob.shown;
      const showing =
        ((id === 'hitch' || id === 'ink' || id === 'chain') && (t.kind === 'vehicle' || t.kind === 'spot')) || (id === 'grind' && t.kind === 'rail');
      if (!showing) {
        mesh.visible = false;
        screen.active = false;
        return;
      }
      const tick = game.sim.tick;
      const frame = Math.floor(tick / TWOS) % 2;
      // Where the target itself is (what the edge arrow turns toward).
      let tx = t.x;
      let ty = t.y;
      let tz = t.z;
      if (t.kind === 'rail') {
        if (railFor !== t.rail) {
          for (const g of railGeos) g.dispose();
          railGeos = [railGeo(world, t.rail, t.x, t.y, t.z, LIFT_A + 0.25), railGeo(world, t.rail, t.x, t.y, t.z, LIFT_B + 0.25)];
          railFor = t.rail;
        }
        mesh.geometry = railGeos[frame];
        mesh.position.set(t.x, t.y, t.z);
      } else if (t.kind === 'spot') {
        mesh.geometry = spotGeos[frame];
        mesh.position.set(t.x, t.y, t.z);
      } else {
        const L = world.lines[t.line];
        // Where the sim drew it last tick and this tick, blended like everything else that moves.
        vehicleAt(L, t.veh, tick - 1, vs);
        grabPoint(L, vs, a);
        const ay = vs.y;
        vehicleAt(L, t.veh, tick, vs);
        grabPoint(L, vs, b);
        tx = a.x + (b.x - a.x) * alpha;
        tz = a.z + (b.z - a.z) * alpha;
        ty = a.y + (b.y - a.y) * alpha;
        // Over the grab point, but clear above the whole vehicle (a strap's end is pointed at directly).
        const roof = L.overhead ? -Infinity : ay + (vs.y - ay) * alpha + topOf(t.line) + ROOF_CLEAR;
        mesh.geometry = vehicleGeo[frame];
        mesh.position.set(tx, Math.max(ty, roof - LIFT_A), tz);
      }
      mesh.visible = true;
      if (camera) {
        p.set(tx, ty, tz);
        p.applyMatrix4(camera.matrixWorldInverse);
        screen.behind = p.z > 0;
        p.applyMatrix4(camera.projectionMatrix);
        screen.nx = screen.behind ? -p.x : p.x;
        screen.ny = screen.behind ? -p.y : p.y;
        screen.active = Number.isFinite(screen.nx) && Number.isFinite(screen.ny);
      }
    },
    dispose(): void {
      scene.remove(mesh);
      for (const g of vehicleGeo) g.dispose();
      for (const g of spotGeos) g.dispose();
      for (const g of railGeos) g.dispose();
    },
  };
}
