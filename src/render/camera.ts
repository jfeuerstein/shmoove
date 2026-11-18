/**
 * The chase camera.
 *
 * It sits behind the sim's view yaw (the direction of travel, lagged), not behind the stick, looks
 * down the line ahead, and pulls back and widens with each gear. Portrait is a tall, narrow frame:
 * the camera is high and aims well ahead of the mover so the frame is spent on where you are going.
 */
import type { PerspectiveCamera } from 'three';
import { FEEL } from '../sim/constants';
import type { Terrain } from '../sim/terrain';
import { EV_LAND, type SimState } from '../sim/types';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Share of a gap closed in `dt` seconds at `rate` per second. */
function ease(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class ChaseCamera {
  private readonly camera: PerspectiveCamera;
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private zoom = 0;
  private kick = 0;
  private kickTick = -1;
  private started = false;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Forget all smoothing; the next update starts from the mover. */
  reset(): void {
    this.started = false;
    this.kick = 0;
    this.kickTick = -1;
  }

  /**
   * Place the camera for a frame `alpha` of the way from `prev` to `cur` (0..1).
   * `dt` is the real time since the last frame, in seconds.
   */
  update(prev: SimState, cur: SimState, alpha: number, dt: number, terrain: Terrain): void {
    const a = prev.mover;
    const b = cur.mover;
    const px = lerp(a.x, b.x, alpha);
    const py = lerp(a.y, b.y, alpha);
    const pz = lerp(a.z, b.z, alpha);
    const yaw = lerpAngle(prev.viewYaw, cur.viewYaw, alpha);
    const zoomTarget = b.gear - 1;

    if (!this.started) {
      this.started = true;
      this.fx = px;
      this.fy = py;
      this.fz = pz;
      this.zoom = zoomTarget;
    }

    // The focus follows the mover closely on the ground plane and loosely in height while it is
    // airborne, so a hop moves the mover on screen instead of bouncing the whole world.
    const k = ease(FEEL.camPosRate, dt);
    this.fx += (px - this.fx) * k;
    this.fz += (pz - this.fz) * k;
    this.fy += (py - this.fy) * (b.grounded ? k : ease(FEEL.camPosRate * 0.25, dt));
    this.zoom += (zoomTarget - this.zoom) * ease(FEEL.camZoomRate, dt);

    if (cur.tick !== this.kickTick) {
      this.kickTick = cur.tick;
      if ((cur.events & EV_LAND) !== 0) this.kick += b.impact * FEEL.camLandKick;
    }
    this.kick *= 1 - ease(10, dt);

    const dist = FEEL.camDist + FEEL.camDistPerGear * this.zoom;
    const height = FEEL.camHeight + FEEL.camHeightPerGear * this.zoom;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);

    const cx = this.fx - sx * dist;
    const cz = this.fz - sz * dist;
    let cy = this.fy + height - this.kick;
    const floor = terrain.heightAt(cx, cz) + FEEL.camGroundClear;
    if (cy < floor) cy = floor;

    const cam = this.camera;
    cam.position.set(cx, cy, cz);
    cam.lookAt(this.fx + sx * FEEL.camLookAhead, this.fy + 1 - this.kick, this.fz + sz * FEEL.camLookAhead);
    const fov = FEEL.camFov + FEEL.camFovPerGear * this.zoom;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
