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
  EV_GRIND_END,
  EV_GRIND_START,
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
/** Ticks after leaving a rail before another can be caught (so stepping off does not step back on). */
const RAIL_COOLDOWN_TICKS = 18;
/** A powerslide is over when the mover is within this of where the stick points, rad. */
const SLIDE_DONE = 0.3;

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
    latched: false,
    latchYaw: 0,
    airTicks: 0,
    groundTicks: 0,
    hopBuffer: 0,
    chain: 0,
    landPending: false,
    landSpeed: 0,
    impact: 0,
    lastAir: 0,
    padCooldown: 0,
    rail: -1,
    railT: 0,
    railDir: 1,
    railCooldown: 0,
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

/**
 * Set the velocity to `speed` along the surface, heading `yaw` as seen from above.
 *
 * The tangent is the one whose horizontal part points along `yaw`, with the vertical part solved
 * from the surface. (Projecting the horizontal heading onto the surface along the normal is not the
 * same thing: on a side slope it swings the heading uphill and cancels the pull of the fall line.)
 */
function setTangentVelocity(m: MoverState, yaw: number, speed: number): void {
  const hx = dsin(yaw);
  const hz = dcos(yaw);
  const ty = m.ny > 1e-6 ? -(hx * m.nx + hz * m.nz) / m.ny : 0;
  const k = speed / len3(hx, ty, hz);
  m.vx = hx * k;
  m.vy = ty * k;
  m.vz = hz * k;
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

/**
 * The world yaw the stick is asking for. The stick is read against the view, which swings behind
 * the mover as it turns, so a stick held to one side keeps turning. Pulled back is different: the
 * direction is fixed when the stick goes back and held until it comes forward again, so pulling
 * back turns you round once instead of spinning you for as long as you hold it.
 */
function wantedYaw(m: MoverState, s: SimState, input: InputFrame): number {
  const stickAngle = datan2(input.steerX, input.steerY);
  if (Math.abs(stickAngle) <= FEEL.slideAngle) {
    m.latched = false;
    return s.viewYaw - stickAngle;
  }
  if (!m.latched) {
    m.latched = true;
    m.latchYaw = s.viewYaw - stickAngle;
  }
  return m.latchYaw;
}

function hop(m: MoverState, s: SimState): void {
  if (m.landPending) {
    // Clean: the landing scrub never happens, and the hop adds a little along the direction of
    // travel, less the faster you already go. It adds to the speed the mover has now: what the
    // touchdown took (the part of the fall that pointed into the ground) stays taken.
    const h = len2(m.vx, m.vz);
    if (h > 1e-6) {
      const k = (h + FEEL.cleanHopBonus * clamp(1 - h / FEEL.cleanHopFade, 0, 1)) / h;
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
  m.vy += FEEL.hopSpeed * s.mods.hopSpeed;
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
  const before = len3(m.vx, m.vy, m.vz);
  const g = FEEL.gravity * DT;
  m.vx += g * m.ny * m.nx;
  m.vy -= g * (1 - m.ny * m.ny);
  m.vz += g * m.ny * m.nz;

  let speed = len3(m.vx, m.vy, m.vz);
  // Slopes pay in full only when tucked. With the thumb down the edges are dug in: above run speed
  // a downhill adds only a share of what it would. (Uphill always costs in full.)
  if (input.carve && speed > before && speed > FEEL.runSpeed) {
    const from = Math.max(before, FEEL.runSpeed);
    speed = from + (speed - from) * FEEL.carveSlopeGain;
  }
  const hs = len2(m.vx, m.vz);
  let yaw = hs > 1e-4 ? datan2(m.vx, m.vz) : m.heading;

  // A hard landing that was not hopped out of costs speed once the clean window has closed.
  if (m.landPending && m.groundTicks >= FEEL.cleanWindowTicks + s.mods.hopWindow) {
    speed *= 1 - FEEL.landScrub * clamp(m.impact / FEEL.landScrubImpact, 0, 1);
    m.landPending = false;
    if (m.chain > 0) {
      m.chain = 0;
      s.events |= EV_CHAIN_LOST;
    }
  }

  const mods = s.mods;
  // Whatever is holding on drags, tucked or not.
  const drag = FEEL.tuckDrag * mods.drag + mods.cling;
  if (m.tucked) {
    speed -= (drag * speed + FEEL.rollFriction) * DT;
  } else {
    speed -= drag * speed * DT;
    if (speed > FEEL.runSpeed) speed -= FEEL.carveDrag * mods.scrub * (speed - FEEL.runSpeed) * DT;
    if (!steering) speed -= FEEL.idleBrake * DT;
  }
  if (speed < 0) speed = 0;

  if (steering) {
    const want = wantedYaw(m, s, input);
    if (speed < STILL) {
      yaw = want;
    } else {
      const off = angleDiff(want, yaw);
      // A powerslide lasts while the mover is still coming round to a pulled-back stick.
      m.sliding = m.latched && speed > FEEL.runSpeed * 0.6 && Math.abs(off) > SLIDE_DONE;
      let maxTurn = Math.min(FEEL.turnMax, FEEL.grip / speed) * DT;
      if (m.sliding) maxTurn *= FEEL.slideTurn;
      const turn = clamp(off, -maxTurn, maxTurn);
      yaw += turn;
      if (speed > FEEL.runSpeed) speed -= FEEL.carveScrub * mods.scrub * Math.abs(turn) * speed;
      if (m.sliding) speed = Math.max(0, speed - FEEL.slideBrake * DT);
    }
    const target = FEEL.runSpeed * steerLen;
    if (!m.sliding && speed < target) speed = Math.min(target, speed + FEEL.runAccel * DT);
  } else {
    m.latched = false;
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
  const mods = s.mods;
  m.tucked = !input.carve;
  // On the way up the build can make the air hold you a little longer.
  m.vy -= FEEL.gravity * (m.vy > 0 ? mods.hang : 1) * DT;
  const drag = 1 - (FEEL.airDrag * mods.drag + mods.cling) * DT;
  m.vx *= drag;
  m.vz *= drag;

  let hs = len2(m.vx, m.vz);
  if (hs > FEEL.maxSpeed) {
    const k = FEEL.maxSpeed / hs;
    m.vx *= k;
    m.vz *= k;
    hs = FEEL.maxSpeed;
  }
  if (input.carve && hs > STILL && len2(input.steerX, input.steerY) > 1e-3) {
    const want = wantedYaw(m, s, input);
    const yaw = datan2(m.vx, m.vz);
    const airTurn = FEEL.airTurn * mods.airTurn * DT;
    const turned = yaw + clamp(angleDiff(want, yaw), -airTurn, airTurn);
    m.vx = dsin(turned) * hs;
    m.vz = dcos(turned) * hs;
  }
  if (hs > STILL) m.heading = datan2(m.vx, m.vz);

  m.x += m.vx * DT;
  m.y += m.vy * DT;
  m.z += m.vz * DT;
  holdInside(m, terrain);
  m.airTicks++;
  if (catchRail(m, s, terrain)) return;

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
  m.lastAir = m.airTicks;
  if (m.airTicks >= FEEL.minAirTicks) {
    m.landPending = true;
    m.landSpeed = landH;
    m.impact = vn < 0 ? -vn : 0;
    s.events |= EV_LAND;
  }
  m.airTicks = 0;
}

/**
 * An airborne rider coming down near a rail, and going mostly along it, catches it: the board
 * locks on and all of its speed goes along the rail.
 */
function catchRail(m: MoverState, s: SimState, terrain: Terrain): boolean {
  if (m.railCooldown > 0 || m.vy > 1) return false;
  const rails = terrain.rails;
  const hs = len2(m.vx, m.vz);
  if (hs < FEEL.railMinSpeed) return false;
  for (let i = 0; i < rails.length; i++) {
    const r = rails[i];
    const dx = r.x1 - r.x0;
    const dz = r.z1 - r.z0;
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-6) continue;
    const t = ((m.x - r.x0) * dx + (m.z - r.z0) * dz) / l2;
    if (t < 0 || t > 1) continue;
    const px = r.x0 + dx * t;
    const pz = r.z0 + dz * t;
    const ox = m.x - px;
    const oz = m.z - pz;
    if (ox * ox + oz * oz > FEEL.railSnap * FEEL.railSnap) continue;
    const ry = r.y0 + (r.y1 - r.y0) * t;
    if (m.y < ry - FEEL.railReachUp || m.y > ry + FEEL.railReachDown) continue;
    const l = Math.sqrt(l2);
    const along = (m.vx * dx + m.vz * dz) / l;
    if (Math.abs(along) < FEEL.railAlong * hs) continue;

    m.rail = i;
    m.railT = t;
    m.railDir = along >= 0 ? 1 : -1;
    m.x = px;
    m.y = ry;
    m.z = pz;
    setRailVelocity(m, r, hs);
    m.landPending = false;
    m.sliding = false;
    m.latched = false;
    s.events |= EV_GRIND_START;
    return true;
  }
  return false;
}

/** Point the velocity along the rail, in the direction of travel, at `speed`. */
function setRailVelocity(m: MoverState, r: Terrain['rails'][number], speed: number): void {
  const dx = r.x1 - r.x0;
  const dy = r.y1 - r.y0;
  const dz = r.z1 - r.z0;
  const k = (m.railDir * speed) / len3(dx, dy, dz);
  m.vx = dx * k;
  m.vy = dy * k;
  m.vz = dz * k;
}

/** Let go of the rail: the rider is in the air with whatever velocity it has. */
function leaveRail(m: MoverState, s: SimState): void {
  m.rail = -1;
  m.railCooldown = RAIL_COOLDOWN_TICKS;
  m.grounded = false;
  // Long enough in the air that the landing that follows counts as one.
  m.airTicks = FEEL.minAirTicks;
  s.events |= EV_GRIND_END;
}

/**
 * On a rail. No steering: the rail decides where the board goes. Its slope pulls, the grind adds
 * a little, and a tap hops off with everything kept. Riding off the end is a small pop into the air.
 */
function stepGrind(m: MoverState, s: SimState, input: InputFrame, terrain: Terrain): void {
  const r = terrain.rails[m.rail];
  const dx = r.x1 - r.x0;
  const dy = r.y1 - r.y0;
  const dz = r.z1 - r.z0;
  const l = len3(dx, dy, dz);
  m.tucked = !input.carve;

  let speed = len3(m.vx, m.vy, m.vz);
  // Gravity along the rail, in the direction of travel: downhill is negative dy for railDir +1.
  speed += ((-FEEL.gravity * dy * m.railDir) / l + FEEL.grindPush - (FEEL.grindDrag * s.mods.drag + s.mods.cling) * speed) * DT;
  if (speed > FEEL.maxSpeed) speed = FEEL.maxSpeed;

  if (m.hopBuffer > 0) {
    // Off with a hop. It counts as a clean one: a grind is a landing you never stopped making.
    setRailVelocity(m, r, speed);
    m.vy += FEEL.hopSpeed * s.mods.hopSpeed;
    m.hopBuffer = 0;
    m.chain++;
    s.events |= EV_HOP | EV_CLEAN_HOP;
    leaveRail(m, s);
    m.airTicks = 0;
    return;
  }

  if (speed < FEEL.railMinSpeed * 0.5) {
    // Too slow to stay on: it drops off where it is.
    setRailVelocity(m, r, speed < 0 ? 0 : speed);
    leaveRail(m, s);
    return;
  }

  m.railT += (m.railDir * speed * DT) / l;
  if (m.railT <= 0 || m.railT >= 1) {
    // Off the end, with a little pop.
    const t = m.railT <= 0 ? 0 : 1;
    m.x = r.x0 + dx * t;
    m.y = r.y0 + dy * t;
    m.z = r.z0 + dz * t;
    setRailVelocity(m, r, speed);
    m.vy += FEEL.railExitPop;
    leaveRail(m, s);
    return;
  }
  m.x = r.x0 + dx * m.railT;
  m.y = r.y0 + dy * m.railT;
  m.z = r.z0 + dz * m.railT;
  setRailVelocity(m, r, speed);
  m.heading = datan2(m.vx, m.vz);
  m.airTicks++;
}

/** Advance the mover one tick. */
export function stepMover(s: SimState, input: InputFrame, terrain: Terrain): void {
  const m = s.mover;
  const px = m.x;
  const py = m.y;
  const pz = m.z;

  // A tap stays live for a few ticks so one made just before touchdown still hops on landing.
  if (input.hop) m.hopBuffer = FEEL.hopBufferTicks + 1;
  if (m.railCooldown > 0) m.railCooldown--;
  if (m.rail >= 0) {
    stepGrind(m, s, input, terrain);
  } else {
    if (m.grounded && m.hopBuffer > 0) hop(m, s);
    if (m.grounded) stepGround(m, s, input, terrain);
    else stepAir(m, s, input, terrain);
  }
  if (m.hopBuffer > 0) m.hopBuffer--;

  m.speed = m.grounded || m.rail >= 0 ? len3(m.vx, m.vy, m.vz) : len2(m.vx, m.vz);
  s.distance += len3(m.x - px, m.y - py, m.z - pz);

  // The view swings behind the direction of travel; the stick is read against it.
  const hs = len2(m.vx, m.vz);
  if (hs > FEEL.viewMinSpeed) {
    const k = FEEL.viewFollow * DT;
    s.viewYaw += angleDiff(datan2(m.vx, m.vz), s.viewYaw) * (k / (1 + k));
  }
}

