/**
 * Hitch, slingshot and chain.
 *
 * Hitched, the skater is a pendulum on a rope behind the ride: `psi` is the world angle of the
 * skater's offset from the grab point, pulled toward "straight behind the ride's velocity". The
 * skater's world velocity is therefore ride velocity + swing velocity, and that is the direction a
 * release throws them in: timing the release against the swing sets the exit angle.
 */
import { DT, FEEL } from './constants';
import { grabPoint, makeVehicleState, vehicleAt } from './lines';
import {
  angleDiff,
  approachT,
  clamp,
  datan2,
  dcos,
  dsin,
  len2,
  len3,
  lerp,
  moveToward,
  smoothstep,
  wrapAngle,
} from './math';
import { Mode, type SimCtx } from './types';
import { collideSolids, makeGroundSample, makeWallHit, sampleGround } from './world';

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };
const G = makeGroundSample();
const WH = makeWallHit();

/** Pauses that stop event spam; not feel. */
const DENIED_COOLDOWN = 0.6;
const POST_SLING_COOLDOWN = 0.12;

export function endChain(ctx: SimCtx, reason: 'land' | 'bail'): void {
  const p = ctx.player;
  if (p.chain > 0) ctx.events.push({ type: 'chainEnd', chain: p.chain, reason });
  p.chain = 0;
  p.chainAlive = 0;
  p.chainGround = 0;
}

/** Look for a ride in reach and latch onto the nearest. Called while the touch is armed. */
export function tryHitch(ctx: SimCtx): boolean {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;
  const handY = p.y + F.HAND_HEIGHT;
  const R = F.HITCH_REACH;
  const Ry = F.HITCH_REACH_Y;
  const chainNow = p.chainAlive === 1 ? p.chain : 0;
  let best = 1;
  let bestLine = -1;
  let bestVeh = -1;
  let deniedLine = -1;
  for (let li = 0; li < w.lines.length; li++) {
    const L = w.lines[li];
    const m = R + L.anchorBack + 1;
    if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, ctx.tick, VS);
      if (!VS.active) continue;
      grabPoint(L, VS, GP);
      const dx = p.x - GP.x;
      const dy = handY - GP.y;
      const dz = p.z - GP.z;
      const d = (dx * dx + dz * dz) / (R * R) + (dy * dy) / (Ry * Ry);
      if (d >= best) continue;
      // A bumper is grabbed as it comes past, not from in front of it.
      if (!L.overhead && dx * VS.hx + dz * VS.hz > F.HITCH_AHEAD) continue;
      if (li === p.lastLine && vi === p.lastVeh && p.relatchCooldown > 0) continue;
      if (chainNow + 1 < L.minChainN) {
        deniedLine = li;
        continue;
      }
      best = d;
      bestLine = li;
      bestVeh = vi;
    }
  }
  if (bestLine < 0) {
    if (deniedLine >= 0) {
      ctx.events.push({ type: 'denied', line: deniedLine, need: w.lines[deniedLine].minChainN });
      p.hitchCooldown = DENIED_COOLDOWN;
    }
    return false;
  }
  latch(ctx, bestLine, bestVeh);
  return true;
}

function latch(ctx: SimCtx, li: number, vi: number): void {
  const p = ctx.player;
  const L = ctx.world.lines[li];
  vehicleAt(L, vi, ctx.tick, VS);
  grabPoint(L, VS, GP);

  if (p.mode === Mode.GRIND) {
    ctx.events.push({ type: 'grindEnd', rail: p.rail });
    p.lastRail = p.rail;
    p.grindCooldown = FEEL.GRIND_COOLDOWN;
  } else if (p.mode === Mode.WALL) {
    ctx.events.push({ type: 'wallEnd', jumped: false, topped: false });
    p.wallCooldown = FEEL.WALL_COOLDOWN;
  }

  const dx = p.x - GP.x;
  const dz = p.z - GP.z;
  const d = len2(dx, dz);
  p.psiRest = datan2(-VS.hx, -VS.hz);
  p.psi = d > 1e-3 ? datan2(dx, dz) : p.psiRest;
  p.rope = Math.max(d, 0.2);
  // Swing rate from the skater's velocity relative to the ride, across the rope.
  const rvx = p.vx - VS.vx;
  const rvz = p.vz - VS.vz;
  p.omega = clamp((rvx * dcos(p.psi) - rvz * dsin(p.psi)) / Math.max(p.rope, 1), -FEEL.SWING_LATCH_MAX, FEEL.SWING_LATCH_MAX);

  p.yankX = p.x;
  p.yankY = p.y;
  p.yankZ = p.z;
  p.yankVx = p.vx;
  p.yankVy = p.vy;
  p.yankVz = p.vz;

  let newLink = false;
  if (p.chainAlive === 1) {
    if (li !== p.lastLine || vi !== p.lastVeh) {
      p.chain += 1;
      newLink = true;
    }
  } else {
    p.chain = 1;
    newLink = true;
  }
  p.chainAlive = 0;
  p.chainGround = 0;

  p.hLine = li;
  p.hVeh = vi;
  p.hitchTime = 0;
  p.mode = Mode.HITCH;
  p.modeTime = 0;
  ctx.events.push({ type: 'hitch', line: li, vehicle: vi, chain: p.chain, newLink });
}

export function stepHitch(ctx: SimCtx, hold: boolean): void {
  const p = ctx.player;
  const w = ctx.world;
  const F = FEEL;
  const L = w.lines[p.hLine];
  vehicleAt(L, p.hVeh, ctx.tick, VS);
  p.hitchTime += DT;
  if (!VS.active) {
    // The ride went out of service under us: let go without a sling.
    letGo(ctx);
    return;
  }
  grabPoint(L, VS, GP);

  const rideSpeed = len2(VS.vx, VS.vz);
  if (rideSpeed > 0.3) {
    const target = datan2(-VS.vx, -VS.vz);
    p.psiRest = wrapAngle(p.psiRest + clamp(angleDiff(target, p.psiRest), -F.SWING_REST_RATE * DT, F.SWING_REST_RATE * DT));
  }
  const th = angleDiff(p.psi, p.psiRest);
  const w2 = F.SWING_FREQ * F.SWING_FREQ * clamp(rideSpeed / F.SWING_REF_SPEED, 0.15, 1.6);
  // The strap soaks up the catch: heavy damping right after latching, easing to the normal value.
  const settle = p.hitchTime < F.SWING_SETTLE_TIME ? F.SWING_SETTLE_DAMP * (1 - p.hitchTime / F.SWING_SETTLE_TIME) : 0;
  let acc = -w2 * dsin(th) - (F.SWING_DAMP + settle) * p.omega + p.steer * F.SWING_STEER;
  if (rideSpeed > 1) {
    // Keep a minimum swing alive so there is always a release to time.
    const energy = 0.5 * p.omega * p.omega + w2 * (1 - dcos(th));
    const want = w2 * (1 - dcos(F.SWING_MIN_AMP));
    if (energy < want) acc += F.SWING_PUMP * (1 - energy / want) * (p.omega >= 0 ? 1 : -1);
  }
  if (th > F.SWING_MAX) acc -= F.SWING_STOP * (th - F.SWING_MAX);
  else if (th < -F.SWING_MAX) acc -= F.SWING_STOP * (th + F.SWING_MAX);
  p.omega = clamp(p.omega + acc * DT, -F.SWING_OMEGA_MAX, F.SWING_OMEGA_MAX);
  p.psi = wrapAngle(p.psi + p.omega * DT);
  p.rope = moveToward(p.rope, L.rope, F.REEL_RATE * DT);

  let X = GP.x + p.rope * dsin(p.psi);
  let Z = GP.z + p.rope * dcos(p.psi);

  // The strap takes up slack: blend from where the skater was going to where the rope puts them.
  let k = 1;
  if (p.hitchTime < F.YANK_TIME) {
    k = smoothstep(p.hitchTime / F.YANK_TIME);
    p.yankX += p.yankVx * DT;
    p.yankY += p.yankVy * DT;
    p.yankZ += p.yankVz * DT;
    X = lerp(p.yankX, X, k);
    Z = lerp(p.yankZ, Z, k);
  }

  collideSolids(w, X, p.y, Z, F.PLAYER_RADIUS, F.PLAYER_HEIGHT, F.STEP_UP, WH);
  if (WH.hit) {
    X += WH.nx * WH.depth;
    Z += WH.nz * WH.depth;
    if (k >= 1) {
      const ox = X - GP.x;
      const oz = Z - GP.z;
      p.rope = Math.max(len2(ox, oz), 0.2);
      p.psi = datan2(ox, oz);
      p.omega *= -0.3;
      if (p.rope > L.rope + F.HITCH_REACH) {
        // Dragged round a corner behind a wall: the strap slips.
        letGo(ctx);
        return;
      }
    }
  }

  sampleGround(w, X, p.y, Z, F.STEP_UP, G);
  const targetY = L.overhead ? Math.max(G.y, GP.y - F.HAND_HEIGHT) : G.y;
  let Y: number;
  if (!L.overhead && p.y - G.y < 0.5) Y = G.y;
  else Y = p.y + (targetY - p.y) * approachT(F.HITCH_Y_RATE, DT);
  if (k < 1) Y = lerp(Math.max(p.yankY, G.y), Y, k);
  if (Y < G.y) Y = G.y;

  p.vx = (X - p.x) / DT;
  p.vy = (Y - p.y) / DT;
  p.vz = (Z - p.z) / DT;
  p.x = X;
  p.y = Y;
  p.z = Z;
  p.speed = len2(p.vx, p.vz);
  if (p.speed > 0.5) p.heading = datan2(p.vx, p.vz);
  const grounded = Y <= G.y + 0.02;
  p.surface = grounded ? G.surface : -1;
  p.onSolid = grounded ? G.solid : -1;

  const hop = p.hopBuffer > 0;
  if (p.hitchTime >= F.HITCH_MIN_TIME && (!hold || hop)) sling(ctx, hop);
}

/** Release with the slingshot. */
function sling(ctx: SimCtx, hop: boolean): void {
  const p = ctx.player;
  const F = FEEL;
  const sh = len2(p.vx, p.vz);
  let dx: number;
  let dz: number;
  if (sh > 0.5) {
    dx = p.vx / sh;
    dz = p.vz / sh;
  } else {
    dx = dsin(p.heading);
    dz = dcos(p.heading);
  }
  let exit = Math.max(sh * F.SLING_GAIN, F.SLING_MIN) + F.LINK_BONUS * p.chain;
  const cap = Math.max(F.SLING_CAP, sh);
  if (exit > cap) exit = cap;
  p.vx = dx * exit;
  p.vz = dz * exit;
  p.vy = clamp(p.vy, 0, F.SLING_VY_CARRY) + F.SLING_POP + (hop ? F.SLING_HOP_POP : 0);
  p.speed = len3(p.vx, p.vy, p.vz);
  p.heading = datan2(dx, dz);
  if (hop) {
    p.hopBuffer = 0;
    p.hopCooldown = F.HOP_COOLDOWN;
  }
  ctx.events.push({ type: 'release', line: p.hLine, vehicle: p.hVeh, speed: exit, chain: p.chain, hop });
  detach(ctx);
}

/** Release without a sling (ride left service, strap slipped). The chain stays alive. */
function letGo(ctx: SimCtx): void {
  const p = ctx.player;
  ctx.events.push({
    type: 'release',
    line: p.hLine,
    vehicle: p.hVeh,
    speed: len2(p.vx, p.vz),
    chain: p.chain,
    hop: false,
  });
  detach(ctx);
}

function detach(ctx: SimCtx): void {
  const p = ctx.player;
  p.lastLine = p.hLine;
  p.lastVeh = p.hVeh;
  p.relatchCooldown = FEEL.RELATCH_COOLDOWN;
  p.hitchCooldown = POST_SLING_COOLDOWN;
  p.chainAlive = 1;
  p.chainGround = 0;
  p.coyote = 0;
  p.surface = -1;
  p.onSolid = -1;
  p.mode = Mode.AIR;
  p.modeTime = 0;
}

const _aim = { x: 0, z: 0, speed: 0 };

/** The exit vector a release would give right now (for the aim tick). Null when not hitched. */
export function slingPreview(ctx: SimCtx): { x: number; z: number; speed: number } | null {
  const p = ctx.player;
  if (p.mode !== Mode.HITCH) return null;
  const F = FEEL;
  const sh = len2(p.vx, p.vz);
  if (sh > 0.5) {
    _aim.x = p.vx / sh;
    _aim.z = p.vz / sh;
  } else {
    _aim.x = dsin(p.heading);
    _aim.z = dcos(p.heading);
  }
  _aim.speed = Math.min(Math.max(sh * F.SLING_GAIN, F.SLING_MIN) + F.LINK_BONUS * p.chain, Math.max(F.SLING_CAP, sh));
  return _aim;
}
