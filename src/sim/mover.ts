/**
 * The mover: carve, tuck, hop.
 *
 * A point riding a heightfield. On the ground its velocity lies in the surface; gravity pulls it
 * along the slope, the stick turns it and pushes it up to run speed, and everything above run speed
 * has to come from the terrain or from hop timing. In the air it is a projectile with a little steer.
 */
import { DT, FEEL } from './constants';
import { angleDiff, clamp, datan2, dcos, dsin, len2, len3 } from './math';
import type { Terrain } from './terrain';
import {
  EV_BOOST,
  EV_CHAIN_LOST,
  EV_CLEAN_HOP,
  EV_HOP,
  EV_LAND,
  type InputFrame,
  type MoverState,
  type SimState,
  type Vec3,
} from './types';

const N: Vec3 = { x: 0, y: 1, z: 0 };
/** Below this speed the direction of travel means nothing and the stick sets it outright. */
const STILL = 0.5;
const PAD_COOLDOWN_TICKS = 30;

export function makeMover(terrain: Terrain): MoverState {
  const m: MoverState = {
    x: terrain.spawnX,
    y: terrain.heightAt(terrain.spawnX, terrain.spawnZ),
    z: terrain.spawnZ,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: terrain.spawnYaw,
    speed: 0,
    grounded: true,
    tucked: true,
    sliding: false,
    airTicks: 0,
    groundTicks: 0,
    hopBuffer: 0,
    chain: 0,
    landPending: false,
    landSpeed: 0,
    impact: 0,
    padCooldown: 0,
    gear: 1,
    gearHold: 0,
    nx: 0,
    ny: 1,
    nz: 0,
  };
  terrain.normalAt(m.x, m.z, N);
  m.nx = N.x;
  m.ny = N.y;
  m.nz = N.z;
  return m;
}

/** Set the velocity to `speed` along the surface in the horizontal direction `yaw`. */
function setTangentVelocity(m: MoverState, yaw: number, speed: number): void {
  const hx = dsin(yaw);
  const hz = dcos(yaw);
  const d = hx * m.nx + hz * m.nz;
  let tx = hx - d * m.nx;
  let ty = -d * m.ny;
  let tz = hz - d * m.nz;
  const l = len3(tx, ty, tz);
  if (l < 1e-6) {
    tx = hx;
    ty = 0;
    tz = hz;
  } else {
    tx /= l;
    ty /= l;
    tz /= l;
  }
  m.vx = tx * speed;
  m.vy = ty * speed;
  m.vz = tz * speed;
}

/** Drop the part of the velocity that points into or out of the ground, keeping the speed. */
function redirectAlongGround(m: MoverState, speed: number): void {
  const vn = m.vx * m.nx + m.vy * m.ny + m.vz * m.nz;
  const tx = m.vx - vn * m.nx;
  const ty = m.vy - vn * m.ny;
  const tz = m.vz - vn * m.nz;
  const l = len3(tx, ty, tz);
  if (l < 1e-6) {
    m.vx = 0;
    m.vy = 0;
    m.vz = 0;
    return;
  }
  const k = speed / l;
  m.vx = tx * k;
  m.vy = ty * k;
  m.vz = tz * k;
}

function readNormal(m: MoverState, terrain: Terrain): void {
  terrain.normalAt(m.x, m.z, N);
  m.nx = N.x;
  m.ny = N.y;
  m.nz = N.z;
}

/** Keep the mover inside the terrain's radius. Returns true if it was pushed back. */
function holdInside(m: MoverState, terrain: Terrain): boolean {
  const r = len2(m.x, m.z);
  if (r <= terrain.radius) return false;
  const ox = m.x / r;
  const oz = m.z / r;
  m.x = ox * terrain.radius;
  m.z = oz * terrain.radius;
  const out = m.vx * ox + m.vz * oz;
  if (out > 0) {
    m.vx -= out * ox;
    m.vz -= out * oz;
  }
  return true;
}

function hop(m: MoverState, s: SimState): void {
  if (m.landPending) {
    // Clean: the landing costs nothing and the hop adds a little, less the faster you already go.
    const h = len2(m.vx, m.vz);
    const base = Math.max(h, m.landSpeed);
    const target = base + FEEL.cleanHopBonus * clamp(1 - base / FEEL.cleanHopFade, 0, 1);
    if (h > 1e-6) {
      const k = target / h;
      m.vx *= k;
      m.vz *= k;
    }
    m.chain++;
    s.events |= EV_CLEAN_HOP;
  } else if (m.chain > 0) {
    m.chain = 0;
    s.events |= EV_CHAIN_LOST;
  }
  m.landPending = false;
  m.vy += FEEL.hopSpeed;
  m.grounded = false;
  m.airTicks = 0;
  m.hopBuffer = 0;
  m.sliding = false;
  s.events |= EV_HOP;
}

function stepGround(m: MoverState, s: SimState, input: InputFrame, terrain: Terrain): void {
  const steerLen = Math.min(1, len2(input.steerX, input.steerY));
  const steering = input.carve && steerLen > 1e-3;
  m.tucked = !input.carve;
  m.sliding = false;

  // Gravity along the slope. This is where all the speed above run speed comes from.
  const g = FEEL.gravity * DT;
  m.vx += g * m.ny * m.nx;
  m.vy -= g * (1 - m.ny * m.ny);
  m.vz += g * m.ny * m.nz;

  let speed = len3(m.vx, m.vy, m.vz);
  const hs = len2(m.vx, m.vz);
  let yaw = hs > 1e-4 ? datan2(m.vx, m.vz) : m.heading;

  // A hard landing that was not hopped out of costs speed once the clean window has closed.
  if (m.landPending && m.groundTicks >= FEEL.cleanWindowTicks) {
    speed *= 1 - FEEL.landScrub * clamp(m.impact / FEEL.landScrubImpact, 0, 1);
    m.landPending = false;
    if (m.chain > 0) {
      m.chain = 0;
      s.events |= EV_CHAIN_LOST;
    }
  }

  if (m.tucked) {
    speed -= (FEEL.tuckDrag * speed + FEEL.rollFriction) * DT;
  } else {
    speed -= FEEL.tuckDrag * speed * DT;
    if (speed > FEEL.runSpeed) speed -= FEEL.carveDrag * (speed - FEEL.runSpeed) * DT;
    if (!steering) speed -= FEEL.idleBrake * DT;
  }
  if (speed < 0) speed = 0;

  if (steering) {
    const stickAngle = datan2(input.steerX, input.steerY);
    const want = s.viewYaw - stickAngle;
    if (speed < STILL) {
      yaw = want;
    } else {
      m.sliding = Math.abs(stickAngle) > FEEL.slideAngle && speed > FEEL.runSpeed * 0.6;
      let maxTurn = Math.min(FEEL.turnMax, FEEL.grip / speed) * DT;
      if (m.sliding) maxTurn *= FEEL.slideTurn;
      const turn = clamp(angleDiff(want, yaw), -maxTurn, maxTurn);
      yaw += turn;
      if (speed > FEEL.runSpeed) speed -= FEEL.carveScrub * Math.abs(turn) * speed;
      if (m.sliding) speed = Math.max(0, speed - FEEL.slideBrake * DT);
    }
    const target = FEEL.runSpeed * steerLen;
    if (!m.sliding && speed < target) speed = Math.min(target, speed + FEEL.runAccel * DT);
  }
  if (speed > FEEL.maxSpeed) speed = FEEL.maxSpeed;

  setTangentVelocity(m, yaw, speed);
  if (len2(m.vx, m.vz) > STILL) m.heading = datan2(m.vx, m.vz);
  else if (steering) m.heading = yaw;

  // Move, then decide whether the ground is still there.
  const y0 = m.y;
  const vy0 = m.vy;
  m.x += m.vx * DT;
  m.z += m.vz * DT;
  if (holdInside(m, terrain)) speed = len3(m.vx, m.vy, m.vz);
  const h = terrain.heightAt(m.x, m.z);
  const cling = y0 + vy0 * DT - 0.5 * (FEEL.gravity + FEEL.stickAccel) * DT * DT;
  if (h >= cling) {
    m.y = h;
    readNormal(m, terrain);
    redirectAlongGround(m, speed);
    m.groundTicks++;
    if (m.padCooldown > 0) m.padCooldown--;
    else ridePads(m, s, terrain, speed);
  } else {
    // The ground fell away faster than the mover could follow: it is flying.
    m.y = y0 + vy0 * DT - 0.5 * FEEL.gravity * DT * DT;
    m.vy = vy0 - FEEL.gravity * DT;
    m.grounded = false;
    m.airTicks = 1;
    if (m.y < h) m.y = h;
  }
}

function ridePads(m: MoverState, s: SimState, terrain: Terrain, speed: number): void {
  const pads = terrain.pads;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const dx = m.x - p.x;
    const dz = m.z - p.z;
    if (dx * dx + dz * dz > p.radius * p.radius) continue;
    m.padCooldown = PAD_COOLDOWN_TICKS;
    if (speed >= FEEL.boostCap || speed < 1e-3) return;
    const boosted = Math.min(FEEL.boostCap, speed + FEEL.boostPadSpeed);
    const k = boosted / speed;
    m.vx *= k;
    m.vy *= k;
    m.vz *= k;
    s.events |= EV_BOOST;
    return;
  }
}

function stepAir(m: MoverState, s: SimState, input: InputFrame, terrain: Terrain): void {
  m.tucked = !input.carve;
  m.vy -= FEEL.gravity * DT;
  const drag = 1 - FEEL.airDrag * DT;
  m.vx *= drag;
  m.vz *= drag;

  const hs = len2(m.vx, m.vz);
  if (input.carve && hs > STILL && len2(input.steerX, input.steerY) > 1e-3) {
    const want = s.viewYaw - datan2(input.steerX, input.steerY);
    const yaw = datan2(m.vx, m.vz);
    const turned = yaw + clamp(angleDiff(want, yaw), -FEEL.airTurn * DT, FEEL.airTurn * DT);
    m.vx = dsin(turned) * hs;
    m.vz = dcos(turned) * hs;
  }
  if (hs > STILL) m.heading = datan2(m.vx, m.vz);

  m.x += m.vx * DT;
  m.y += m.vy * DT;
  m.z += m.vz * DT;
  holdInside(m, terrain);
  m.airTicks++;

  const h = terrain.heightAt(m.x, m.z);
  if (m.y > h) return;

  // Touchdown. What points into the ground is lost; what runs along it is kept, so landing on a
  // slope that matches the fall keeps nearly everything.
  m.y = h;
  readNormal(m, terrain);
  const landH = len2(m.vx, m.vz);
  const vn = m.vx * m.nx + m.vy * m.ny + m.vz * m.nz;
  m.vx -= vn * m.nx;
  m.vy -= vn * m.ny;
  m.vz -= vn * m.nz;
  m.grounded = true;
  m.groundTicks = 0;
  if (m.airTicks >= FEEL.minAirTicks) {
    m.landPending = true;
    m.landSpeed = landH;
    m.impact = vn < 0 ? -vn : 0;
    s.events |= EV_LAND;
  }
  m.airTicks = 0;
}

/** Advance the mover one tick. */
export function stepMover(s: SimState, input: InputFrame, terrain: Terrain): void {
  const m = s.mover;
  const px = m.x;
  const py = m.y;
  const pz = m.z;

  if (input.hop) m.hopBuffer = FEEL.hopBufferTicks + 1;
  if (m.hopBuffer > 0) m.hopBuffer--;

  if (m.grounded && (input.hop || m.hopBuffer > 0)) hop(m, s);
  if (m.grounded) stepGround(m, s, input, terrain);
  else stepAir(m, s, input, terrain);

  m.speed = m.grounded ? len3(m.vx, m.vy, m.vz) : len2(m.vx, m.vz);
  s.distance += len3(m.x - px, m.y - py, m.z - pz);

  // The view swings behind the direction of travel; the stick is read against it.
  const hs = len2(m.vx, m.vz);
  if (hs > FEEL.viewMinSpeed) {
    const k = FEEL.viewFollow * DT;
    s.viewYaw += angleDiff(datan2(m.vx, m.vz), s.viewYaw) * (k / (1 + k));
  }
}

