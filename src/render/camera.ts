/**
 * Chase camera for a portrait screen. It sits behind the direction of travel (behind the ride
 * while hitched, so the swing reads against a steady frame), keeps the skater in the lower third,
 * pulls in rather than clipping through buildings, widens with speed, and lifts when climbing so
 * the hill ahead stays in view.
 */
import * as THREE from 'three';
import { FEEL } from '../sim/constants';
import { Mode } from '../sim/types';
import { Surface, topHeight, type World } from '../sim/world';

export interface CamTarget {
  /** Interpolated skater position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  mode: number;
  speed: number;
  surface: number;
  /** While hitched: yaw of the ride's travel. Otherwise null. */
  rideYaw: number | null;
}

const _look = new THREE.Vector3();

function wrap(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(FEEL.CAM_FOV, 9 / 19.5, 0.3, 1200);
  private yaw = 0;
  private followY = 0;
  private slope = 0;
  private extraDist = 0;
  private extraHeight = 0;
  private pull = 1;
  private fov = FEEL.CAM_FOV;
  private shake = 0;
  private time = 0;
  private lastY = 0;
  private started = false;

  /** Add a shake impulse (landings, bails, wall hits). 1 is a hard hit. */
  kick(amount: number): void {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the resting pose behind the target (spawn, teleports). */
  snap(t: CamTarget): void {
    this.yaw = this.wantedYaw(t);
    this.followY = t.y;
    this.lastY = t.y;
    this.slope = 0;
    this.extraDist = 0;
    this.extraHeight = 0;
    this.pull = 1;
    this.started = true;
  }

  private wantedYaw(t: CamTarget): number {
    if (t.rideYaw !== null) return t.rideYaw;
    const sh = Math.hypot(t.vx, t.vz);
    if (t.mode !== Mode.BAIL && sh > 1.5) return Math.atan2(t.vx, t.vz);
    if (t.mode === Mode.BAIL) return this.yaw;
    return t.heading;
  }

  update(t: CamTarget, world: World, dt: number): void {
    const F = FEEL;
    if (!this.started) this.snap(t);
    this.time += dt;
    const ease = (rate: number): number => 1 - Math.exp(-rate * dt);

    // Swing behind the direction of travel.
    this.yaw = wrap(this.yaw + wrap(this.wantedYaw(t) - this.yaw) * ease(F.CAM_YAW_RATE));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);

    // Follow height tightly on the ground, loosely in the air so hops read as hops.
    const air = t.mode === Mode.AIR || t.mode === Mode.WALL;
    this.followY += (t.y - this.followY) * ease(air ? F.CAM_POS_RATE * 0.45 : F.CAM_POS_RATE);

    // Climb rate along the travel direction: look up the hill when going up it.
    const sh = Math.hypot(t.vx, t.vz);
    const climb = dt > 0 && sh > 1 ? (t.y - this.lastY) / dt / sh : 0;
    this.lastY = t.y;
    this.slope += (Math.max(-0.5, Math.min(0.5, climb)) - this.slope) * ease(2.5);

    const speedK = Math.min(1, t.speed / F.CAM_TOP_SPEED);
    const hitched = t.mode === Mode.HITCH;
    const wantDist = speedK * F.CAM_SPEED_DIST + (hitched ? F.CAM_HITCH_DIST : 0);
    const wantHeight =
      (hitched ? F.CAM_HITCH_HEIGHT : 0) + (air ? F.CAM_AIR_HEIGHT : 0) + Math.max(0, this.slope) * 5 * F.CAM_UPHILL_HEIGHT;
    this.extraDist += (wantDist - this.extraDist) * ease(2.2);
    this.extraHeight += (wantHeight - this.extraHeight) * ease(2.2);
    const dist = F.CAM_DIST + this.extraDist;
    const height = F.CAM_HEIGHT + this.extraHeight;

    // Pull in if something stands between the skater and the camera.
    let clear = 1;
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const sx = t.x - fx * dist * k;
      const sz = t.z - fz * dist * k;
      const sy = this.followY + height * k;
      if (topHeight(world, sx, sz) + 0.4 > sy) {
        clear = Math.max(0.22, (i - 1) / steps);
        break;
      }
    }
    this.pull += (clear - this.pull) * ease(clear < this.pull ? 14 : 2.5);

    let cx = t.x - fx * dist * this.pull;
    let cz = t.z - fz * dist * this.pull;
    let cy = this.followY + height * (0.45 + 0.55 * this.pull);
    const floor = topHeight(world, cx, cz) + F.CAM_MIN_CLEAR;
    if (cy < floor) cy = floor;

    // Shake: stairs rattle continuously, impacts decay.
    const rattle = t.surface === Surface.STAIRS && t.mode === Mode.GROUND ? Math.min(1, t.speed / 6) * 0.35 : 0;
    this.shake *= Math.exp(-7 * dt);
    const amp = (this.shake + rattle) * F.CAM_SHAKE;
    if (amp > 0.0005) {
      cx += Math.sin(this.time * 71.3) * amp;
      cy += Math.sin(this.time * 93.7 + 1.3) * amp;
      cz += Math.sin(this.time * 57.1 + 2.1) * amp;
    }

    this.camera.position.set(cx, cy, cz);
    _look.set(
      t.x + fx * F.CAM_LOOK_AHEAD,
      this.followY + F.CAM_LOOK_UP + this.slope * F.CAM_LOOK_AHEAD * 0.9,
      t.z + fz * F.CAM_LOOK_AHEAD,
    );
    this.camera.lookAt(_look);

    const wantFov = F.CAM_FOV + F.CAM_FOV_SPEED * speedK;
    this.fov += (wantFov - this.fov) * ease(3);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
