/**
 * The movement controller: one skater stepping against the world for one tick.
 *
 * Heading convention: forward = (sin h, cos h) in (x, z); right = (-cos h, sin h). Steering right
 * decreases the heading.
 */
import { DT, FEEL } from './constants';
import { endChain, stepHitch, tryHitch } from './hitch';
import { makeVehicleState, vehicleAt } from './lines';
import { angleDiff, approachT, clamp, datan2, dcos, dsin, len2, len3, wrapAngle, PI } from './math';
import { FLOW_TRICKS, Mode, type BailReason, type InputFrame, type PlayerState, type SimCtx } from './types';
import {
  Surface,
  collideSolids,
  makeGroundSample,
  makeRailHit,
  makeWallHit,
  nearestRail,
  railAt,
  sampleGround,
  terrainSurface,
  topHeight,
  wallBeside,
  type GroundSample,
  type World,
} from './world';

const G = makeGroundSample();
const G2 = makeGroundSample();
const WH = makeWallHit();
const RH = makeRailHit();
const VS = makeVehicleState();

/** Housekeeping intervals and insets; not feel. */
const SAFE_INTERVAL = 0.5;
const WALL_HOLD = 0.35;
const WALL_ROOF_INSET = 0.3;

export function createPlayer(): PlayerState {
  return {
    mode: Mode.GROUND,
    modeTime: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: 0,
    speed: 0,
    steer: 0,
    surface: 0,
    onSolid: -1,
    hopBuffer: 0,
    hopCooldown: 0,
    coyote: 0,
    hitchCooldown: 0,
    relatchCooldown: 0,
    grindCooldown: 0,
    wallCooldown: 0,
    wallHold: 0,
    rail: -1,
    railS: 0,
    railV: 0,
    lastRail: -1,
    wallNx: 0,
    wallNz: 0,
    wallSolid: -1,
    hLine: -1,
    hVeh: -1,
    psi: 0,
    omega: 0,
    rope: 0,
    psiRest: 0,
    hitchTime: 0,
    yankX: 0,
    yankY: 0,
    yankZ: 0,
    yankVx: 0,
    yankVy: 0,
    yankVz: 0,
    ropeSlack: 0,
    flow: 0,
    flowTime: 0,
    flowKick: 0,
    flowKind: -1,
    flowRail: -1,
    chain: 0,
    chainAlive: 0,
    chainGround: 0,
    lastLine: -1,
    lastVeh: -1,
    bailTimer: 0,
    bailWater: 0,
    safeX: 0,
    safeY: 0,
    safeZ: 0,
    safeHeading: 0,
    safeTimer: 0,
    prevHold: 0,
  };
}

/** Put the skater at rest on top of whatever is at (x, z), facing `heading`. */
export function placePlayer(w: World, p: PlayerState, x: number, z: number, heading: number): void {
  const fresh = createPlayer();
  Object.assign(p, fresh);
  p.x = x;
  p.z = z;
  p.y = topHeight(w, x, z);
  p.heading = wrapAngle(heading);
  p.safeX = p.x;
  p.safeY = p.y;
  p.safeZ = p.z;
  p.safeHeading = p.heading;
}

function setMode(p: PlayerState, mode: Mode): void {
  p.mode = mode;
  p.modeTime = 0;
}

function tickDown(v: number): number {
  return v > DT ? v - DT : 0;
}

export function stepPlayer(ctx: SimCtx, input: InputFrame): void {
  const p = ctx.player;
  const F = FEEL;
  p.modeTime += DT;
  p.hopBuffer = tickDown(p.hopBuffer);
  p.hopCooldown = tickDown(p.hopCooldown);
  p.coyote = tickDown(p.coyote);
  p.hitchCooldown = tickDown(p.hitchCooldown);
  p.relatchCooldown = tickDown(p.relatchCooldown);
  p.grindCooldown = tickDown(p.grindCooldown);
  p.wallCooldown = tickDown(p.wallCooldown);
  p.wallHold = tickDown(p.wallHold);

  applyFlowKick(p);

  if (input.hop) p.hopBuffer = F.HOP_BUFFER;
  const steerBefore = p.steer;
  p.steer += (clamp(input.steer, -1, 1) - p.steer) * approachT(F.STEER_SMOOTH, DT);
  const steerDelta = Math.abs(p.steer - steerBefore);

  if (input.hold && p.mode !== Mode.HITCH && p.mode !== Mode.BAIL && p.hitchCooldown <= 0) tryHitch(ctx);

  switch (p.mode) {
    case Mode.GROUND:
      stepGround(ctx, steerDelta, input.brake === true);
      break;
    case Mode.AIR:
      stepAir(ctx);
      break;
    case Mode.GRIND:
      stepGrind(ctx);
      break;
    case Mode.WALL:
      stepWall(ctx);
      break;
    case Mode.HITCH:
      stepHitch(ctx, input.hold);
      break;
    case Mode.BAIL:
      stepBail(ctx);
      break;
  }

  if (p.mode === Mode.GROUND || p.mode === Mode.AIR) collideVehicles(ctx);

  // A chain survives a little rolling after a release; ground time is a budget, not a timer
  // that hopping resets.
  if (p.chainAlive === 1 && p.mode === Mode.GROUND) {
    p.chainGround += DT;
    if (p.chainGround > F.CHAIN_GROUND_GRACE) endChain(ctx, 'land');
  }

  if (p.mode === Mode.GROUND && p.surface !== Surface.WATER) {
    p.safeTimer += DT;
    // Also on the first grounded tick after a ride, a grind, a wallride or any air (the mode was
    // set to GROUND this tick), so a save just after stepping off a ride resumes where you landed.
    if (p.safeTimer >= SAFE_INTERVAL || p.modeTime === 0) {
      p.safeTimer = 0;
      // Only remember places well clear of water, or a bail at the quay respawns into the sea.
      const m = F.SAFE_MARGIN;
      const w = ctx.world;
      if (
        terrainSurface(w, p.x + m, p.z) !== Surface.WATER &&
        terrainSurface(w, p.x - m, p.z) !== Surface.WATER &&
        terrainSurface(w, p.x, p.z + m) !== Surface.WATER &&
        terrainSurface(w, p.x, p.z - m) !== Surface.WATER
      ) {
        p.safeX = p.x;
        p.safeY = p.y;
        p.safeZ = p.z;
        p.safeHeading = p.heading;
      }
    }
  }
  stepFlow(ctx);
  p.prevHold = input.hold ? 1 : 0;
}

/**
 * Flow: tricks strung into a line. A grind, a wallride, an awning bounce, a jump that stayed up, a
 * sling and a catch each add to the line if the last one was within FLOW_WINDOW; the four you do
 * on the board also kick it faster, more the longer the line, and a line in progress sheds drag.
 * Skating well is how you go fast.
 */
function stepFlow(ctx: SimCtx): void {
  const p = ctx.player;
  const F = FEEL;
  const ev = ctx.events;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    let kind = -1;
    let rail = -1;
    if (e.type === 'grindStart') {
      kind = 0;
      rail = e.rail;
    } else if (e.type === 'wallStart') kind = 1;
    else if (e.type === 'bounce') kind = 2;
    else if (e.type === 'land' && (e.air ?? 0) >= F.FLOW_AIR_TIME) kind = 3;
    else if (e.type === 'release') kind = 4;
    else if (e.type === 'hitch' && e.newLink) kind = 5;
    else if (e.type === 'bail') {
      if (p.flow > 0) ev.push({ type: 'flowEnd', count: p.flow, bailed: true });
      endFlow(p);
      p.flowKick = 0;
      return;
    }
    if (kind < 0) continue;
    // The same thing twice running is not a line: hopping on and off one rail, or bouncing on
    // one awning, earns nothing the second time.
    if (p.flow > 0 && kind === p.flowKind) {
      if (kind === 0 && rail === p.flowRail) continue;
      if (F.FLOW_WINDOW - p.flowTime < F.FLOW_REPEAT) continue;
    }
    // Tricks done on the board kick it; a sling and a catch carry their own speed.
    if (kind < 4) p.flowKick += F.FLOW_KICK + F.FLOW_KICK_STEP * Math.min(p.flow, F.FLOW_CAP);
    p.flow++;
    p.flowTime = F.FLOW_WINDOW;
    p.flowKind = kind;
    p.flowRail = rail;
    ev.push({ type: 'flow', count: p.flow, trick: FLOW_TRICKS[kind] });
  }
  if (p.flow > 0 && p.mode !== Mode.HITCH) {
    // The clock stops on a ride: being towed neither builds a line nor loses one.
    p.flowTime -= DT;
    if (p.flowTime <= 0) {
      ev.push({ type: 'flowEnd', count: p.flow, bailed: false });
      endFlow(p);
    }
  }
}

function endFlow(p: PlayerState): void {
  p.flow = 0;
  p.flowTime = 0;
  p.flowKind = -1;
  p.flowRail = -1;
}

/** Add a trick's kick to the board's speed, along the way it is already going. */
function applyFlowKick(p: PlayerState): void {
  const k = p.flowKick;
  if (k <= 0) return;
  if (p.mode === Mode.GROUND) {
    p.speed = Math.min(FEEL.MAX_SPEED, p.speed + k);
  } else if (p.mode === Mode.GRIND) {
    p.railV += p.railV < 0 ? -k : k;
  } else if (p.mode === Mode.AIR) {
    const h = len2(p.vx, p.vz);
    if (h < 0.5) return;
    const f = Math.min(FEEL.MAX_SPEED, h + k) / h;
    p.vx *= f;
    p.vz *= f;
  } else if (p.mode === Mode.WALL) {
    return;
  }
  p.flowKick = 0;
}

function surfaceDrag(surface: number): number {
  if (surface === Surface.STAIRS) return FEEL.STAIR_DRAG;
  if (surface === Surface.DIRT || surface === Surface.GRASS) return FEEL.ROUGH_DRAG;
  return 0;
}

function hopSpeed(rollSpeed: number): number {
  return FEEL.HOP_V + Math.min(rollSpeed * FEEL.HOP_SPEED_BONUS, FEEL.HOP_BONUS_MAX);
}

/** Keep (x, z) inside the world; returns true if it had to be moved. */
function clampToWorld(w: World, pos: { x: number; z: number }): boolean {
  const m = 1;
  let moved = false;
  if (pos.x < w.minX + m) {
    pos.x = w.minX + m;
    moved = true;
  } else if (pos.x > w.maxX - m) {
    pos.x = w.maxX - m;
    moved = true;
  }
  if (pos.z < w.minZ + m) {
    pos.z = w.minZ + m;
    moved = true;
  } else if (pos.z > w.maxZ - m) {
    pos.z = w.maxZ - m;
    moved = true;
  }
  return moved;
}

const _pos = { x: 0, z: 0 };

// ---------------------------------------------------------------------------------------------
// Ground

function stepGround(ctx: SimCtx, steerDelta: number, foot: boolean): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;

  if (p.hopBuffer > 0 && p.hopCooldown <= 0) {
    p.vy = Math.max(p.vy, 0) + hopSpeed(p.speed);
    p.hopBuffer = 0;
    p.hopCooldown = F.HOP_COOLDOWN;
    p.coyote = 0;
    ctx.events.push({ type: 'hop' });
    setMode(p, Mode.AIR);
    stepAir(ctx);
    return;
  }

  sampleGround(w, p.x, p.y, p.z, F.STEP_UP, G);
  let v = p.speed;

  // Steering: tight when slow, grip-limited when fast.
  const rate = Math.min(F.TURN_RATE_MAX, F.LAT_ACCEL_MAX / Math.max(v, 0.5));
  let heading = p.heading - p.steer * rate * DT;

  // Foot down (the finger pulled down): a deliberate brake. It slows the board from any speed,
  // holds it on anything but stairs-steep ground, and keeps a standing board from swinging
  // downhill or being pumped. A resting thumb never brakes.
  const planted = foot;

  // A slow board swings toward the fall line.
  const grad = len2(G.gx, G.gz);
  if (grad > 1e-4 && v < F.FALLLINE_SPEED && p.wallHold <= 0 && !(planted && v < 1)) {
    const delta = angleDiff(datan2(-G.gx, -G.gz), heading);
    const low = 1 - v / F.FALLLINE_SPEED;
    const turn = ((F.FALLLINE_GAIN * F.GRAVITY * grad * Math.abs(dsin(delta))) / Math.max(v, 1)) * low * DT;
    const ad = Math.abs(delta);
    heading += (delta >= 0 ? 1 : -1) * Math.min(ad, turn);
  }
  heading = wrapAngle(heading);

  let fx = dsin(heading);
  let fz = dcos(heading);
  const m = G.gx * fx + G.gz * fz;
  const inv = 1 / Math.sqrt(1 + m * m);
  const gravAlong = -F.GRAVITY * m * inv;

  // A line in progress carries its speed: each trick in it takes a share of the drag away.
  const carry = 1 - Math.min(p.flow, F.FLOW_CAP) * F.FLOW_HOLD;
  v += (gravAlong - F.AIR_DRAG * carry * v * v - surfaceDrag(G.surface) * v - F.CARVE_SCRUB * Math.abs(p.steer) * v) * DT;
  // Rolling resistance brakes but never reverses.
  const resist = F.ROLL_RESIST * carry + (planted ? F.FOOT_BRAKE : 0);
  v -= resist * DT;
  if (v <= 0) {
    v = 0;
    if (-gravAlong > resist) {
      // Stalled facing uphill: kickturn and let gravity take over.
      heading = wrapAngle(heading + PI);
      fx = -fx;
      fz = -fz;
      ctx.events.push({ type: 'kickturn' });
    }
  }
  // Tic-tac: carving back and forth trickles in speed at walking pace.
  // Pumping: carving back and forth drives the board, strongly from a standstill and fading out
  // toward PUMP_SPEED_CAP. It works on the flat and downhill, not up a hill: `m` is the rise per
  // metre along the heading, and past PUMP_UPHILL there is nothing to gain.
  if (v < F.PUMP_SPEED_CAP && !planted && steerDelta > 0) {
    const flat = m <= 0 ? 1 : Math.max(0, 1 - m / F.PUMP_UPHILL);
    const room = Math.min(1, 2 * (1 - v / F.PUMP_SPEED_CAP));
    v = Math.min(F.PUMP_SPEED_CAP, v + F.PUMP_GAIN * steerDelta * flat * room);
  }
  if (v > F.MAX_SPEED) v = F.MAX_SPEED;

  const vh = v * inv;
  _pos.x = p.x + fx * vh * DT;
  _pos.z = p.z + fz * vh * DT;
  if (clampToWorld(w, _pos)) {
    // The edge of the world turns you back.
    heading = wrapAngle(heading + PI);
    fx = -fx;
    fz = -fz;
    v *= F.WALL_BOUNCE;
  }
  let nx = _pos.x;
  let nz = _pos.z;

  for (let pass = 0; pass < 2; pass++) {
    collideSolids(w, nx, p.y, nz, F.PLAYER_RADIUS, F.PLAYER_HEIGHT, F.STEP_UP, WH);
    if (!WH.hit) break;
    nx += WH.nx * WH.depth;
    nz += WH.nz * WH.depth;
    const into = -(fx * WH.nx + fz * WH.nz);
    if (into <= 0) continue;
    const hitSpeed = v * into;
    if (hitSpeed > F.WALL_BAIL_SPEED) {
      p.x = nx;
      p.z = nz;
      p.speed = v * F.WALL_BOUNCE;
      p.vx = -fx * p.speed;
      p.vz = -fz * p.speed;
      p.heading = heading;
      bail(ctx, 'wall');
      return;
    }
    if (hitSpeed > 1) ctx.events.push({ type: 'wallHit', speed: hitSpeed });
    p.wallHold = WALL_HOLD;
    let dx: number;
    let dz: number;
    if (into > F.WALL_HEAD_ON && v > F.WALL_SLIDE_SPEED) {
      // Fast and square on: bounce back.
      dx = fx + 2 * into * WH.nx;
      dz = fz + 2 * into * WH.nz;
      v *= F.WALL_BOUNCE;
    } else {
      // Otherwise turn along the wall and scrub.
      dx = fx + into * WH.nx;
      dz = fz + into * WH.nz;
      if (len2(dx, dz) < 0.2) {
        // Dead square: pick the side the thumb leans to, else the downhill side.
        const tx = -WH.nz;
        const tz = WH.nx;
        const lean = Math.abs(p.steer) > 0.05 ? p.steer * (-fz * tx + fx * tz) : -(G.gx * tx + G.gz * tz);
        const sgn = lean >= 0 ? 1 : -1;
        dx = tx * sgn;
        dz = tz * sgn;
      }
      v *= 1 - F.WALL_SCRUB * into;
    }
    const dl = len2(dx, dz);
    if (dl > 1e-6) {
      fx = dx / dl;
      fz = dz / dl;
      heading = datan2(fx, fz);
    }
  }

  sampleGround(w, nx, p.y, nz, F.STEP_UP, G2);
  p.heading = heading;
  p.x = nx;
  p.z = nz;
  p.vx = fx * vh;
  p.vz = fz * vh;

  // If the ground falls away faster than a ballistic arc, we are flying.
  const yFree = p.y + p.vy * DT - 0.5 * F.GRAVITY * DT * DT;
  if (G2.y < yFree - F.GROUND_STICK) {
    p.y = yFree;
    p.vy -= F.GRAVITY * DT;
    p.speed = len3(p.vx, p.vy, p.vz);
    p.surface = -1;
    p.onSolid = -1;
    p.coyote = F.COYOTE_TIME;
    setMode(p, Mode.AIR);
    return;
  }

  p.y = G2.y;
  p.vy = vh * (G2.gx * fx + G2.gz * fz);
  p.speed = v;
  p.surface = G2.surface;
  p.onSolid = G2.solid;
  if (G2.surface === Surface.WATER) {
    bail(ctx, 'water');
  } else if (G2.surface === Surface.AWNING) {
    // Rolled onto an awning: it throws you.
    p.vy = F.AWNING_BOUNCE * F.AWNING_ROLL_THROW;
    ctx.events.push({ type: 'bounce', speed: p.vy });
    p.surface = -1;
    p.onSolid = -1;
    setMode(p, Mode.AIR);
  }
}

// ---------------------------------------------------------------------------------------------
// Air

function stepAir(ctx: SimCtx): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;

  if (p.hopBuffer > 0 && p.coyote > 0 && p.hopCooldown <= 0) {
    p.vy = Math.max(p.vy, 0) + hopSpeed(len2(p.vx, p.vz));
    p.hopBuffer = 0;
    p.hopCooldown = F.HOP_COOLDOWN;
    p.coyote = 0;
    ctx.events.push({ type: 'hop' });
  }

  p.vy -= F.GRAVITY * DT;
  const ang = -p.steer * F.AIR_STEER * DT;
  const c = dcos(ang);
  const s = dsin(ang);
  const rvx = p.vx * c + p.vz * s;
  const rvz = p.vz * c - p.vx * s;
  const drag = Math.max(0.9, 1 - F.AIR_DRAG * len3(rvx, p.vy, rvz) * DT);
  p.vx = rvx * drag;
  p.vz = rvz * drag;
  p.vy *= drag;

  _pos.x = p.x + p.vx * DT;
  _pos.z = p.z + p.vz * DT;
  if (clampToWorld(w, _pos)) {
    p.vx = -p.vx * F.WALL_BOUNCE;
    p.vz = -p.vz * F.WALL_BOUNCE;
  }
  let nx = _pos.x;
  let nz = _pos.z;
  const ny = p.y + p.vy * DT;

  // Rails: land on one roughly along it and it takes you.
  if (p.vy <= F.RAIL_ENTRY_VY) {
    nearestRail(w, nx, ny, nz, F.RAIL_SNAP, F.RAIL_SNAP_UP, F.RAIL_SNAP_DOWN, p.grindCooldown > 0 ? p.lastRail : -1, RH);
    if (RH.hit) {
      const sp = len3(p.vx, p.vy, p.vz);
      const along = p.vx * RH.tx + p.vy * RH.ty + p.vz * RH.tz;
      if (sp > 0.5 && Math.abs(along) >= F.GRIND_ALIGN * sp) {
        p.rail = RH.rail;
        p.railS = RH.s;
        p.railV = (along >= 0 ? 1 : -1) * (Math.max(Math.abs(along), F.GRIND_MIN_SPEED) + F.GRIND_ENTRY_BOOST);
        p.x = RH.x;
        p.y = RH.y;
        p.z = RH.z;
        p.vx = RH.tx * p.railV;
        p.vy = RH.ty * p.railV;
        p.vz = RH.tz * p.railV;
        p.speed = Math.abs(p.railV);
        p.surface = -1;
        p.onSolid = -1;
        setMode(p, Mode.GRIND);
        ctx.events.push({ type: 'grindStart', rail: p.rail });
        return;
      }
    }
  }

  // Walls: shallow contact is a wallride, steep contact is a bonk.
  collideSolids(w, nx, ny, nz, F.PLAYER_RADIUS, F.PLAYER_HEIGHT, F.STEP_UP, WH);
  if (WH.hit) {
    nx += WH.nx * WH.depth;
    nz += WH.nz * WH.depth;
    const vn = p.vx * WH.nx + p.vz * WH.nz;
    if (vn < 0) {
      const sh = len2(p.vx, p.vz);
      const tx = -WH.nz;
      const tz = WH.nx;
      const vt = p.vx * tx + p.vz * tz;
      const o = w.solids[WH.solid];
      const aligned = Math.abs(vt) >= F.WALL_ALIGN * sh;
      if (-vn > F.WALL_BAIL_SPEED && !aligned) {
        p.x = nx;
        p.y = ny;
        p.z = nz;
        p.vx -= F.AIR_BONK_BAIL * vn * WH.nx;
        p.vz -= F.AIR_BONK_BAIL * vn * WH.nz;
        bail(ctx, 'wall');
        return;
      }
      if (aligned && sh >= F.WALL_MIN_SPEED && p.wallCooldown <= 0 && o.yTop - ny > F.STEP_UP) {
        p.vx = tx * vt * F.WALL_KEEP;
        p.vz = tz * vt * F.WALL_KEEP;
        p.vy = Math.max(p.vy, F.WALL_ENTRY_UP);
        p.wallNx = WH.nx;
        p.wallNz = WH.nz;
        p.wallSolid = WH.solid;
        p.x = nx;
        p.y = ny;
        p.z = nz;
        p.speed = len3(p.vx, p.vy, p.vz);
        p.heading = datan2(p.vx, p.vz);
        setMode(p, Mode.WALL);
        ctx.events.push({ type: 'wallStart' });
        return;
      }
      p.vx -= F.AIR_BONK * vn * WH.nx;
      p.vz -= F.AIR_BONK * vn * WH.nz;
      if (-vn > 1) ctx.events.push({ type: 'wallHit', speed: -vn });
    }
  }

  sampleGround(w, nx, p.y, nz, F.STEP_UP, G2);
  if (ny <= G2.y) {
    p.x = nx;
    p.z = nz;
    land(ctx, G2);
    return;
  }
  p.x = nx;
  p.y = ny;
  p.z = nz;
  p.speed = len3(p.vx, p.vy, p.vz);
  if (len2(p.vx, p.vz) > 1) p.heading = datan2(p.vx, p.vz);
  p.surface = -1;
  p.onSolid = -1;
}

/** Touch down on `g` at the current (x, z). */
function land(ctx: SimCtx, g: GroundSample): void {
  const p = ctx.player;
  const F = FEEL;
  p.y = g.y;
  if (g.surface === Surface.WATER) {
    bail(ctx, 'water');
    return;
  }
  const nl = Math.sqrt(g.gx * g.gx + 1 + g.gz * g.gz);
  const nx = -g.gx / nl;
  const ny = 1 / nl;
  const nz = -g.gz / nl;
  const vn = p.vx * nx + p.vy * ny + p.vz * nz;
  const impact = vn < 0 ? -vn : 0;

  if (g.surface === Surface.AWNING && impact > 1) {
    p.vy = Math.max(F.AWNING_BOUNCE, -p.vy * F.AWNING_KEEP);
    // Never bounce on the spot: a skater who comes straight down is sent off along their heading.
    if (len2(p.vx, p.vz) < F.AWNING_NUDGE) {
      p.vx = dsin(p.heading) * F.AWNING_NUDGE;
      p.vz = dcos(p.heading) * F.AWNING_NUDGE;
    }
    p.coyote = 0;
    ctx.events.push({ type: 'bounce', speed: p.vy });
    return;
  }
  if (impact > F.BAIL_IMPACT) {
    p.vy = 0;
    bail(ctx, 'impact');
    return;
  }
  // Keep the part of the velocity that lies in the surface: landing on a downslope keeps speed.
  p.vx -= vn * nx;
  p.vy -= vn * ny;
  p.vz -= vn * nz;
  if (len2(p.vx, p.vz) > 0.3) p.heading = datan2(p.vx, p.vz);
  p.speed = len3(p.vx, p.vy, p.vz);
  p.surface = g.surface;
  p.onSolid = g.solid;
  p.coyote = F.COYOTE_TIME;
  const air = p.mode === Mode.AIR ? p.modeTime : 0;
  setMode(p, Mode.GROUND);
  ctx.events.push({ type: 'land', impact, surface: g.surface, air });
}

// ---------------------------------------------------------------------------------------------
// Grind

function leaveRail(ctx: SimCtx): void {
  const p = ctx.player;
  ctx.events.push({ type: 'grindEnd', rail: p.rail });
  p.lastRail = p.rail;
  p.grindCooldown = FEEL.GRIND_COOLDOWN;
  p.coyote = 0;
  setMode(p, Mode.AIR);
}

function stepGrind(ctx: SimCtx): void {
  const p = ctx.player;
  const F = FEEL;
  const r = ctx.world.rails[p.rail];
  railAt(r, p.railS, RH);
  const sign = p.railV >= 0 ? 1 : -1;

  if (p.hopBuffer > 0 && p.hopCooldown <= 0) {
    // Hop off: along the rail, up, and to the side the thumb is leaning.
    const hl = len2(RH.tx, RH.tz);
    const fx = hl > 1e-6 ? (sign * RH.tx) / hl : dsin(p.heading);
    const fz = hl > 1e-6 ? (sign * RH.tz) / hl : dcos(p.heading);
    p.vx = RH.tx * p.railV + -fz * p.steer * F.GRIND_HOP_SIDE;
    p.vz = RH.tz * p.railV + fx * p.steer * F.GRIND_HOP_SIDE;
    p.vy = Math.max(RH.ty * p.railV, 0) + hopSpeed(Math.abs(p.railV));
    p.hopBuffer = 0;
    p.hopCooldown = F.HOP_COOLDOWN;
    ctx.events.push({ type: 'hop' });
    leaveRail(ctx);
    return;
  }

  let v = p.railV - F.GRAVITY * RH.ty * DT;
  const fr = F.GRIND_FRICTION * DT;
  v = v > 0 ? Math.max(0, v - fr) : Math.min(0, v + fr);
  v = clamp(v, -F.MAX_SPEED, F.MAX_SPEED);
  const s = p.railS + v * DT;

  if (s <= 0 || s >= r.length) {
    railAt(r, s, RH);
    p.x = RH.x;
    p.y = RH.y;
    p.z = RH.z;
    p.vx = RH.tx * v;
    p.vy = RH.ty * v + F.GRIND_EXIT_POP;
    p.vz = RH.tz * v;
    p.speed = len3(p.vx, p.vy, p.vz);
    leaveRail(ctx);
    return;
  }
  if (Math.abs(v) < F.GRIND_STALL_SPEED && Math.abs(RH.ty) < F.GRIND_FLAT_SLOPE) {
    // Stalled on a flat rail: step off.
    p.vx = RH.tx * v;
    p.vy = 0;
    p.vz = RH.tz * v;
    leaveRail(ctx);
    return;
  }

  railAt(r, s, RH);
  p.railS = s;
  p.railV = v;
  p.x = RH.x;
  p.y = RH.y;
  p.z = RH.z;
  p.vx = RH.tx * v;
  p.vy = RH.ty * v;
  p.vz = RH.tz * v;
  p.speed = Math.abs(v);
  if (len2(p.vx, p.vz) > 0.3) p.heading = datan2(p.vx, p.vz);
}

// ---------------------------------------------------------------------------------------------
// Wallride

function leaveWall(ctx: SimCtx, jumped: boolean, topped: boolean): void {
  const p = ctx.player;
  p.wallCooldown = FEEL.WALL_COOLDOWN;
  p.coyote = 0;
  ctx.events.push({ type: 'wallEnd', jumped, topped });
  setMode(p, Mode.AIR);
}

function stepWall(ctx: SimCtx): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;
  const o = w.solids[p.wallSolid];

  if (p.hopBuffer > 0 && p.hopCooldown <= 0) {
    p.vx += p.wallNx * F.WALL_JUMP_OUT;
    p.vz += p.wallNz * F.WALL_JUMP_OUT;
    p.vy = F.WALL_JUMP_UP;
    p.hopBuffer = 0;
    p.hopCooldown = F.HOP_COOLDOWN;
    ctx.events.push({ type: 'hop' });
    leaveWall(ctx, true, false);
    return;
  }

  p.vy -= F.WALL_GRAVITY * DT;
  let nx = p.x + p.vx * DT;
  let nz = p.z + p.vz * DT;
  const ny = p.y + p.vy * DT;

  if (ny >= o.yTop - 0.05 && !o.oneWay) {
    // Over the lip: onto the roof.
    p.x = nx - p.wallNx * (F.PLAYER_RADIUS + WALL_ROOF_INSET);
    p.z = nz - p.wallNz * (F.PLAYER_RADIUS + WALL_ROOF_INSET);
    p.y = o.yTop;
    p.vy = 0;
    p.speed = len2(p.vx, p.vz);
    p.heading = datan2(p.vx, p.vz);
    p.surface = o.surface;
    p.onSolid = o.index;
    p.wallCooldown = F.WALL_COOLDOWN;
    ctx.events.push({ type: 'wallEnd', jumped: false, topped: true });
    ctx.events.push({ type: 'land', impact: 0, surface: o.surface, air: 0 });
    setMode(p, Mode.GROUND);
    return;
  }

  collideSolids(w, nx, ny, nz, F.PLAYER_RADIUS, F.PLAYER_HEIGHT, F.STEP_UP, WH);
  if (WH.hit) {
    nx += WH.nx * WH.depth;
    nz += WH.nz * WH.depth;
    if (WH.solid !== p.wallSolid) {
      // Ran into something else: bonk off it.
      const vn = p.vx * WH.nx + p.vz * WH.nz;
      if (vn < 0) {
        p.vx -= F.AIR_BONK * vn * WH.nx;
        p.vz -= F.AIR_BONK * vn * WH.nz;
      }
      p.x = nx;
      p.y = ny;
      p.z = nz;
      leaveWall(ctx, false, false);
      return;
    }
  }

  sampleGround(w, nx, p.y, nz, F.STEP_UP, G2);
  if (ny <= G2.y) {
    p.x = nx;
    p.z = nz;
    p.wallCooldown = F.WALL_COOLDOWN;
    ctx.events.push({ type: 'wallEnd', jumped: false, topped: false });
    land(ctx, G2);
    return;
  }

  p.x = nx;
  p.y = ny;
  p.z = nz;
  p.speed = len3(p.vx, p.vy, p.vz);

  const beside = wallBeside(o, nx, nz, p.wallNx, p.wallNz, F.PLAYER_RADIUS + 0.35);
  if (!beside || p.modeTime > F.WALL_TIME || ny + F.PLAYER_HEIGHT * 0.5 < o.yBase) {
    p.vx += p.wallNx * F.WALL_EXIT_PUSH;
    p.vz += p.wallNz * F.WALL_EXIT_PUSH;
    leaveWall(ctx, false, false);
  }
}

// ---------------------------------------------------------------------------------------------
// Vehicle bodies

/**
 * Vehicles are not part of the static world. Their bodies shove the skater out sideways, bail
 * them on a hard head-on or rear-end hit, and bounce them off the roof.
 */
function collideVehicles(ctx: SimCtx): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;
  const r = F.PLAYER_RADIUS;
  for (let li = 0; li < w.lines.length; li++) {
    const L = w.lines[li];
    if (L.bodyHeight <= 0) continue;
    const m = L.bodyHalfLen + r + 1;
    if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, ctx.tick, VS);
      if (!VS.active) continue;
      const dx = p.x - VS.x;
      const dz = p.z - VS.z;
      const lon = dx * VS.hx + dz * VS.hz;
      if (lon > L.bodyHalfLen + r || lon < -L.bodyHalfLen - r) continue;
      // Sideways axis of the vehicle: (-hz, hx).
      const lat = -dx * VS.hz + dz * VS.hx;
      const reach = L.bodyHalfWid + r;
      if (lat > reach || lat < -reach) continue;
      const top = VS.y + L.bodyHeight;
      if (p.y >= top || p.y < VS.y - F.PLAYER_HEIGHT) continue;

      if (p.mode === Mode.AIR && p.vy < 0 && p.y >= top - 0.7) {
        p.y = top;
        p.vy = Math.max(F.RIDE_ROOF_BOUNCE, -p.vy * F.AWNING_KEEP);
        ctx.events.push({ type: 'bounce', speed: p.vy });
        continue;
      }

      const side = lat >= 0 ? 1 : -1;
      const push = reach - Math.abs(lat);
      p.x += -VS.hz * side * push;
      p.z += VS.hx * side * push;
      // Speed of the vehicle toward the skater along its travel: positive in front means run down,
      // negative behind means the skater rammed the back.
      const closing = (VS.vx - p.vx) * VS.hx + (VS.vz - p.vz) * VS.hz;
      const ram = lon > 0 ? closing : -closing;
      if (ram > F.RIDE_BAIL_SPEED) {
        p.vx = VS.vx * F.BAIL_KNOCK_CARRY - VS.hz * side * F.BAIL_KNOCK_SIDE;
        p.vz = VS.vz * F.BAIL_KNOCK_CARRY + VS.hx * side * F.BAIL_KNOCK_SIDE;
        p.vy = F.BAIL_KNOCK_UP;
        bail(ctx, 'vehicle');
        return;
      }
      // Side contact: how fast the skater is going into the flank.
      const vlat = -p.vx * VS.hz + p.vz * VS.hx;
      const into = -vlat * side;
      if (into > 0) {
        if (into > F.WALL_BAIL_SPEED) {
          p.vx = VS.vx * F.BAIL_KNOCK_CARRY - VS.hz * side * F.BAIL_KNOCK_SIDE;
          p.vz = VS.vz * F.BAIL_KNOCK_CARRY + VS.hx * side * F.BAIL_KNOCK_SIDE;
          p.vy = F.BAIL_KNOCK_UP;
          bail(ctx, 'vehicle');
          return;
        }
        // Bounce off the flank and get brushed along with the vehicle, rather than stopping
        // dead: a skater with no push must never be parked by passing traffic.
        const out = Math.max(into * F.RIDE_SIDE_BOUNCE, F.RIDE_SIDE_NUDGE);
        const dl = (out - vlat * side) * side;
        p.vx += -VS.hz * dl;
        p.vz += VS.hx * dl;
        // Brushed along: bring the skater's speed along the vehicle's travel up to a share of the
        // vehicle's. A target, not an impulse: contact can last many ticks and must not add up.
        const want = len2(VS.vx, VS.vz) * F.RIDE_SIDE_DRAG;
        const along = p.vx * VS.hx + p.vz * VS.hz;
        if (along < want) {
          p.vx += VS.hx * (want - along);
          p.vz += VS.hz * (want - along);
        }
        if (into > 1) ctx.events.push({ type: 'wallHit', speed: into });
        if (p.mode === Mode.GROUND) {
          const after = len2(p.vx, p.vz);
          p.speed = after;
          if (after > 0.5) p.heading = datan2(p.vx, p.vz);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bail

export function bail(ctx: SimCtx, reason: BailReason): void {
  const p = ctx.player;
  if (p.mode === Mode.BAIL) return;
  endChain(ctx, 'bail');
  p.bailTimer = FEEL.BAIL_TIME;
  p.bailWater = reason === 'water' ? 1 : 0;
  p.hopBuffer = 0;
  setMode(p, Mode.BAIL);
  ctx.events.push({ type: 'bail', reason });
}

function stepBail(ctx: SimCtx): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;

  const sh = len2(p.vx, p.vz);
  if (sh > 0) {
    const k = Math.max(0, sh - F.BAIL_FRICTION * DT) / sh;
    p.vx *= k;
    p.vz *= k;
  }
  p.vy -= F.GRAVITY * DT;
  _pos.x = p.x + p.vx * DT;
  _pos.z = p.z + p.vz * DT;
  clampToWorld(w, _pos);
  let nx = _pos.x;
  let nz = _pos.z;
  let ny = p.y + p.vy * DT;
  collideSolids(w, nx, ny, nz, F.PLAYER_RADIUS, F.PLAYER_HEIGHT, F.STEP_UP, WH);
  if (WH.hit) {
    nx += WH.nx * WH.depth;
    nz += WH.nz * WH.depth;
    const vn = p.vx * WH.nx + p.vz * WH.nz;
    if (vn < 0) {
      p.vx -= vn * WH.nx;
      p.vz -= vn * WH.nz;
    }
  }
  sampleGround(w, nx, p.y, nz, F.STEP_UP, G2);
  if (ny <= G2.y) {
    ny = G2.y;
    p.vy = 0;
    p.surface = G2.surface;
    p.onSolid = G2.solid;
    if (G2.surface === Surface.WATER) p.bailWater = 1;
  }
  p.x = nx;
  p.y = ny;
  p.z = nz;
  p.speed = len3(p.vx, p.vy, p.vz);

  p.bailTimer -= DT;
  if (p.bailTimer <= 0 && (ny <= G2.y || p.bailWater === 1)) {
    if (p.bailWater === 1) {
      p.x = p.safeX;
      p.y = p.safeY;
      p.z = p.safeZ;
      // Face back the way they came, away from the water.
      p.heading = wrapAngle(p.safeHeading + PI);
      sampleGround(w, p.x, p.y, p.z, F.STEP_UP, G2);
      p.surface = G2.surface;
      p.onSolid = G2.solid;
    }
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.speed = 0;
    p.bailWater = 0;
    p.coyote = 0;
    setMode(p, Mode.GROUND);
    ctx.events.push({ type: 'recover' });
  }
}
