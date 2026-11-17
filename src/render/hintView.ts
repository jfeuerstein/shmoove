/**
 * World pointers for onboarding hints: a bobbing mango chevron over the thing the current hint is
 * about. For `hitch` it hangs over the ride's grab point (the bumper, or the end of an overhead
 * ride's strap) and follows it; for `grind` it stands over the handrail's run-in and the rail is
 * outlined in mango. Nothing otherwise.
 *
 * One mesh, one draw call. The chevron bobs on twos by swapping between two pre-built geometries;
 * a rail's outline is built into a pair of its own when the target rail changes, and nothing is
 * rebuilt per frame.
 */
import * as THREE from 'three';
import type { Game } from '../sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt } from '../sim/lines';
import type { World } from '../sim/world';
import { MeshBuilder } from './geom';
import { INK, inkMaterial } from './look';

export interface HintView {
  update(game: Game, alpha: number, dt: number): void;
  dispose(): void;
}

/** Sim ticks per bob frame: 12 Hz, like the characters. */
const TWOS = 5;
/** Height of the chevron's point above what it points at, metres, in the two bob frames. */
const LIFT_A = 0.75;
const LIFT_B = 1.05;
/** Height of the rail outline above the rail, metres. */
const OUTLINE_Y = 0.06;

/** A downward chevron with its point at (0, lift, 0): two crossed V's so it reads from any side. */
function chevron(b: MeshBuilder, lift: number): void {
  const w = 0.55;
  const h = 0.6;
  const t = 0.1;
  // An ink stroke printed a little under the mango one, like the UI's off-register shadow: it
  // reads on bright concrete and on dark asphalt alike without hiding the mango.
  const sh = 0.12;
  for (const [ax, az] of [
    [1, 0],
    [0, 1],
  ]) {
    b.beam(0, lift - sh, 0, ax * w, lift + h - sh, az * w, t * 0.7, INK.ink, 0);
    b.beam(0, lift - sh, 0, -ax * w, lift + h - sh, -az * w, t * 0.7, INK.ink, 0);
    b.beam(0, lift, 0, ax * w, lift + h, az * w, t, INK.mango, 1);
    b.beam(0, lift, 0, -ax * w, lift + h, -az * w, t, INK.mango, 1);
  }
}

function chevronGeo(lift: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  chevron(b, lift);
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

export function createHintView(scene: THREE.Scene, world: World): HintView {
  const vehicleGeo = [chevronGeo(LIFT_A), chevronGeo(LIFT_B)];
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

  return {
    update(game: Game, alpha: number): void {
      const ob = game.onboarding;
      const t = ob.target;
      const showing = (ob.shown === 'hitch' && t.kind === 'vehicle') || (ob.shown === 'grind' && t.kind === 'rail');
      if (!showing) {
        mesh.visible = false;
        return;
      }
      const tick = game.sim.tick;
      const frame = Math.floor(tick / TWOS) % 2;
      if (t.kind === 'rail') {
        if (railFor !== t.rail) {
          for (const g of railGeos) g.dispose();
          railGeos = [railGeo(world, t.rail, t.x, t.y, t.z, LIFT_A + 0.25), railGeo(world, t.rail, t.x, t.y, t.z, LIFT_B + 0.25)];
          railFor = t.rail;
        }
        mesh.geometry = railGeos[frame];
        mesh.position.set(t.x, t.y, t.z);
      } else {
        const L = world.lines[t.line];
        // Where the sim drew it last tick and this tick, blended like everything else that moves.
        vehicleAt(L, t.veh, tick - 1, vs);
        grabPoint(L, vs, a);
        vehicleAt(L, t.veh, tick, vs);
        grabPoint(L, vs, b);
        mesh.geometry = vehicleGeo[frame];
        mesh.position.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
      }
      mesh.visible = true;
    },
    dispose(): void {
      scene.remove(mesh);
      for (const g of vehicleGeo) g.dispose();
      for (const g of railGeos) g.dispose();
    },
  };
}
