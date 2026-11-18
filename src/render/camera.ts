/**
 * Chase camera for a portrait screen. It sits behind the direction of travel (behind the ride
 * while hitched, so the swing reads against a steady frame), keeps the skater in the lower third,
 * pulls in rather than clipping through buildings, widens with speed, and lifts when climbing so
 * the hill ahead stays in view.
 */
import * as THREE from 'three';
import { FEEL } from '../sim/constants';
import { Mode } from '../sim/types';
import { Surface, makeGroundSample, pointBlocked, sampleGround, terrainHeight, type World } from '../sim/world';

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
  /** The carve, -1 (left) .. 1 (right): the camera rolls into it. */
  steer?: number;
}

const _look = new THREE.Vector3();
const _floor = makeGroundSample();

function wrap(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

const DEG = Math.PI / 180;
/** Spacing of the obstruction samples between skater and camera, m. Thinner things than this are too thin to hide the skater. */
const CAM_PROBE_STEP = 0.4;
/** The sight line starts this far above the board (the skater's chest), m. */
const CAM_CHEST = 1;
/** The second sight line ends this far above the board, m; it starts CAM_BOARD_SKIP from the skater with CAM_BOARD_MARGIN of clearance. */
const CAM_BOARD = 0.2;
const CAM_BOARD_SKIP = 0.9;
const CAM_BOARD_MARGIN = 0.08;
/** Ducked, the camera sits this far above the board: over the skater's shoulder, m. */
const CAM_DUCK_HEIGHT = 1.35;
/** How many distances the camera tries between full and CAM_PULL_MIN when its view is blocked. */
const CAM_PULL_TRIES = 9;
/** How close the sight line may pass to a surface, m. */
const CAM_PROBE_MARGIN = 0.25;

/** Fraction of the way to a target covered in `dt` at an exponential `rate`. */
function ease(dt: number, rate: number): number {
  return 1 - Math.exp(-rate * dt);
}

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(FEEL.CAM_FOV, 9 / 19.5, 0.3, 1200);
  private yaw = 0;
  private followY = 0;
  private slope = 0;
  private tilt = 0;
  private extraDist = 0;
  private extraHeight = 0;
  private pull = 1;
  /** 0 the usual height, 1 ducked to shoulder height behind the skater (under low cover). */
  private duck = 0;
  private roll = 0;
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
    this.tilt = 0;
    this.extraDist = 0;
    this.extraHeight = 0;
    this.pull = 1;
    this.duck = 0;
    this.roll = 0;
    this.started = true;
  }

  private wantedYaw(t: CamTarget): number {
    if (t.rideYaw !== null) return t.rideYaw;
    const sh = Math.hypot(t.vx, t.vz);
    if (t.mode !== Mode.BAIL && sh > 1.5) return Math.atan2(t.vx, t.vz);
    if (t.mode === Mode.BAIL) return this.yaw;
    return t.heading;
  }

  /** Camera height pulled in to share `p` of its distance and ducked by `duck` (0..1). */
  private camHeight(t: CamTarget, height: number, p: number, duck: number): number {
    const usual = this.followY + height * (1 - FEEL.CAM_PULL_DROP + FEEL.CAM_PULL_DROP * p);
    return usual + (t.y + CAM_DUCK_HEIGHT - usual) * duck;
  }

  /**
   * Whether a camera `back` metres behind the skater at height `camY` would see them: the lines
   * from it to their chest and to their board, sampled every CAM_PROBE_STEP or so (coarser, and a
   * pillar slips between two samples and ends up filling the frame), the camera's own position
   * included. The skater is where they really are (`t.y`), not where the lagging follow height
   * has them: dropping off a ledge, it is the ledge that hides them. The board counts as well as
   * the chest because an awning between the camera and the skater's legs fills the frame.
   */
  private sightClear(world: World, t: CamTarget, fx: number, fz: number, back: number, camY: number): boolean {
    const chestY = t.y + CAM_CHEST;
    const boardY = t.y + CAM_BOARD;
    const n = Math.max(3, Math.ceil(back / CAM_PROBE_STEP));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const x = t.x - fx * back * k;
      const z = t.z - fz * back * k;
      if (pointBlocked(world, x, chestY + (camY - chestY) * k, z, CAM_PROBE_MARGIN)) return false;
      // The board's line hugs the ground at first: start it a stride away, with less margin.
      if (back * k > CAM_BOARD_SKIP && pointBlocked(world, x, boardY + (camY - boardY) * k, z, CAM_BOARD_MARGIN)) return false;
    }
    return true;
  }

  update(t: CamTarget, world: World, dt: number): void {
    const F = FEEL;
    if (!this.started) this.snap(t);
    this.time += dt;

    // Swing behind the direction of travel.
    this.yaw = wrap(this.yaw + wrap(this.wantedYaw(t) - this.yaw) * ease(dt, F.CAM_YAW_RATE));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);

    // Follow height tightly on the ground, loosely in the air so hops read as hops.
    const air = t.mode === Mode.AIR || t.mode === Mode.WALL;
    this.followY += (t.y - this.followY) * ease(dt, air ? F.CAM_POS_RATE * F.CAM_AIR_FOLLOW : F.CAM_POS_RATE);

    // Climb rate along the travel direction: look up the hill when going up it.
    const sh = Math.hypot(t.vx, t.vz);
    const climb = dt > 0 && sh > 1 ? (t.y - this.lastY) / dt / sh : 0;
    this.lastY = t.y;
    this.slope += (Math.max(-0.5, Math.min(0.5, climb)) - this.slope) * ease(dt, F.CAM_CLIMB_RATE);

    const speedK = Math.min(1, t.speed / F.CAM_TOP_SPEED);
    const hitched = t.mode === Mode.HITCH;
    const wantDist = speedK * F.CAM_SPEED_DIST + (hitched ? F.CAM_HITCH_DIST : 0);
    const wantHeight =
      (hitched ? F.CAM_HITCH_HEIGHT : 0) + (air ? F.CAM_AIR_HEIGHT : 0) + Math.max(0, this.slope) * F.CAM_UPHILL_GAIN * F.CAM_UPHILL_HEIGHT;
    this.extraDist += (wantDist - this.extraDist) * ease(dt, F.CAM_EXTRA_RATE);
    this.extraHeight += (wantHeight - this.extraHeight) * ease(dt, F.CAM_EXTRA_RATE);
    const dist = F.CAM_DIST + this.extraDist;
    const height = F.CAM_HEIGHT + this.extraHeight;

    // Find somewhere to see the skater from: the furthest of a few distances at the usual
    // height, and failing all of those (a low awning between even the closest of them and the
    // skater), the same distances ducked to shoulder height behind them. What counts is what the
    // sight lines pass through, not the tallest thing under them: under an awning the camera
    // goes under with the skater instead of climbing onto the roof.
    let clear = F.CAM_PULL_MIN;
    let duck = 1;
    search: for (let d = 0; d <= 1; d++) {
      for (let c = 0; c < CAM_PULL_TRIES; c++) {
        const p = 1 - ((1 - F.CAM_PULL_MIN) * c) / (CAM_PULL_TRIES - 1);
        if (this.sightClear(world, t, fx, fz, dist * p, this.camHeight(t, height, p, d))) {
          clear = p;
          duck = d;
          break search;
        }
      }
    }
    // In quickly, out calmly; and never left behind something while easing.
    this.pull += (clear - this.pull) * ease(dt, clear < this.pull ? F.CAM_PULL_IN_RATE : F.CAM_PULL_OUT_RATE);
    this.duck += (duck - this.duck) * ease(dt, duck > this.duck ? F.CAM_PULL_IN_RATE : F.CAM_PULL_OUT_RATE);
    if (!this.sightClear(world, t, fx, fz, dist * this.pull, this.camHeight(t, height, this.pull, this.duck))) {
      this.pull = clear;
      this.duck = duck;
    }

    let cx = t.x - fx * dist * this.pull;
    let cz = t.z - fz * dist * this.pull;
    let cy = this.camHeight(t, height, this.pull, this.duck);
    // Keep clear of the ground and of roofs at or below the camera (not of what is overhead).
    sampleGround(world, cx, cy, cz, 0, _floor);
    const floor = _floor.y + F.CAM_MIN_CLEAR;
    if (cy < floor) cy = floor;

    // Shake: stairs rattle continuously, impacts decay.
    const rattle = t.surface === Surface.STAIRS && t.mode === Mode.GROUND ? Math.min(1, t.speed / F.CAM_STAIR_SPEED) * F.CAM_STAIR_RATTLE : 0;
    this.shake *= Math.exp(-F.CAM_SHAKE_DECAY * dt);
    const amp = (this.shake + rattle) * F.CAM_SHAKE;
    if (amp > 0.0005) {
      cx += Math.sin(this.time * 71.3) * amp;
      cy += Math.sin(this.time * 93.7 + 1.3) * amp;
      cz += Math.sin(this.time * 57.1 + 2.1) * amp;
    }

    this.camera.position.set(cx, cy, cz);
    // Look where the ground goes: down into the city when it falls away ahead, up the hill when
    // it rises. This is what fills a portrait frame with streets instead of sky.
    const far = F.CAM_LOOK_FAR;
    const ahead = terrainHeight(world, t.x + fx * far, t.z + fz * far) - terrainHeight(world, t.x, t.z);
    const wantTilt = Math.max(-F.CAM_LOOK_TILT_MAX, Math.min(F.CAM_LOOK_TILT_MAX, ahead * F.CAM_LOOK_SLOPE));
    this.tilt += (wantTilt - this.tilt) * ease(dt, F.CAM_TILT_RATE);
    _look.set(t.x + fx * F.CAM_LOOK_AHEAD, this.followY + F.CAM_LOOK_UP + this.tilt, t.z + fz * F.CAM_LOOK_AHEAD);
    // Never lose the skater off the bottom: squeezed against a wall, lifted over a roof or looking
    // up a steep hill, the camera sits high and close, and a look target far ahead would aim over
    // their head. Pitch down just enough to keep them within CAM_FRAME_MAX of the centre.
    const toSkater = Math.atan2(this.followY - cy, Math.hypot(t.x - cx, t.z - cz));
    const lookRun = Math.hypot(_look.x - cx, _look.z - cz);
    const lowest = toSkater + F.CAM_FRAME_MAX * DEG;
    if (Math.atan2(_look.y - cy, lookRun) > lowest) _look.y = cy + Math.tan(lowest) * lookRun;
    this.camera.lookAt(_look);
    // Lean into the carve: the horizon tips the way the board turns, more the faster it goes.
    const lean = t.mode === Mode.GROUND || t.mode === Mode.HITCH ? (t.steer ?? 0) : 0;
    const wantRoll = -lean * F.CAM_BANK * DEG * (0.35 + 0.65 * speedK);
    this.roll += (wantRoll - this.roll) * ease(dt, F.CAM_BANK_RATE);
    if (Math.abs(this.roll) > 1e-4) this.camera.rotateZ(this.roll);

    const wantFov = F.CAM_FOV + F.CAM_FOV_SPEED * speedK;
    this.fov += (wantFov - this.fov) * ease(dt, F.CAM_FOV_RATE);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
