/**
 * The bots that play a whole run: the idler, the wanderer, the kiter (the careful player) and the
 * rider (the kiter plus the board). Each sees what a player sees (the horde, the rings and tar on
 * the ground, the boss and how it stands, the sparks, the things on the map) and writes one
 * `InputFrame` a tick. Cards are answered by a picker (`picks.ts`), not here.
 *
 * The kiter steers by scoring a fan of headings a tick: how close each would bring it to anything
 * that hurts within the next second and a half, how much of the crowd lies that way, whether it
 * runs into a ring that is about to land, tar, the rim or a climb, and how far it would have to
 * turn. It takes the cheapest. While a boss is up it also keeps at the distance its weapons reach,
 * and it knows each boss's trick.
 *
 * Nothing here allocates per tick (choosing an errand, a few times a minute, makes one closure).
 */
import {
  W_CRUMBS,
  W_LANCE,
  W_ORBIT,
  W_SEEKERS,
  W_SKIPPER,
  W_SLAM,
  W_STATIC,
  W_WAKE,
  WEAPON_COUNT,
} from '../../../src/sim/arsenal';
import { BOSS, BRUISER_CHARGE, BRUISER_TELL } from '../../../src/sim/bosses';
import type { Bowl } from '../../../src/sim/bowl';
import { DT, FEEL } from '../../../src/sim/constants';
import { PLAYER_RADIUS } from '../../../src/sim/balance';
import { angleDiff, datan2, dcos, dsin, PI, TAU } from '../../../src/sim/math';
import { Rng } from '../../../src/sim/rng';
import type { Sim } from '../../../src/sim/sim';
import { LANCE } from '../../../src/sim/weapons/lance';
import { SLAM } from '../../../src/sim/weapons/slam';
import { ORBIT } from '../../../src/sim/weapons/orbit';
import {
  KIND_BOLLARD,
  KIND_BRUISER,
  KIND_STANDSTILL,
  KINDS,
  SPAWN_TICKS,
  STATE_LATCHED,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  ZONE_LOB,
  ZONE_RING,
  ZONE_TAR,
  type World,
} from '../../../src/sim/world';
import { letGo, stickToward, travelYaw, yawTo, type Bot } from './steer';

// ---- the two that do not play ----------------------------------------------------------------

/** Never touches the screen. */
export function makeIdler(): Bot {
  return (_sim, out) => {
    letGo(out);
    out.hop = false;
  };
}

/** The wanderer turns back toward the middle beyond this radius, m. */
const WANDER_HOME_R = 100;

/** Holds the stick on a slow wander, blind to everything: never hops, never looks. */
export function makeWanderer(seed: number): Bot {
  const rng = new Rng(seed * 2654435761 + 1);
  let yaw = 0;
  let rate = 0;
  let next = 0;
  let started = false;
  return (sim, out) => {
    const m = sim.state.mover;
    if (!started) {
      yaw = m.heading;
      started = true;
    }
    if (next <= 0) {
      next = 60 + rng.int(120);
      rate = rng.range(-0.8, 0.8);
    }
    next--;
    yaw += rate * DT;
    if (Math.hypot(m.x, m.z) > WANDER_HOME_R) {
      const home = yawTo(m, 0, 0);
      yaw = home + angleDiff(yaw, home) * 0.5;
    }
    if (yaw > PI) yaw -= TAU;
    else if (yaw < -PI) yaw += TAU;
    stickToward(sim, yaw, 1, out);
    out.hop = false;
  };
}

// ---- the kiter and the rider -----------------------------------------------------------------

/**
 * How the kiter weighs things. Chosen by playing it, not by feel: the horizon by the hits it took in
 * the first three minutes on seeds 6 to 15 with its health held up, the rest by watching what hit it
 * and how far it kept from each boss.
 */
export const KITE = {
  /** Headings scored a tick. */
  fan: 24,
  /** How far ahead a heading is judged, s. */
  horizon: 2.2,
  /** Below this the kiter judges as if it were going this fast, m/s. */
  minSpeed: 7,
  /** Enemies within this are seen, m. */
  sight: 32,
  /** Room kept between the rider and an enemy's edge, m; more for the heavy ones. */
  margin: 1.8,
  heavyMargin: 2.6,
  /** Weight of a near miss, and of the crowd lying in a direction. */
  missWeight: 12,
  crowdWeight: 3,
  /** Beyond this share of the bowl's radius the rim starts to cost. */
  home: 0.62,
  rimWeight: 0.5,
  /** Cost per metre of climb over the next 8 m. */
  climbWeight: 0.3,
  /** Cost per radian of turn. */
  turnWeight: 0.35,
  /** A ring that lands with the rider within this of it, m, costs ringWeight. */
  ringPad: 1.4,
  ringWeight: 9,
  tarWeight: 1.5,
  /** Sparks within this are wanted, m, and how much. */
  sparkSight: 22,
  sparkWeight: 0.6,
  /** While a boss is up: cost per metre off the distance its weapons want, and the Bruiser's lane. */
  engageWeight: 1.5,
  /** The Standstill comes to you and its slow is small: the kiter holds its distance to it harder. */
  standstillEngage: 3,
  /** Never further from a boss's edge than this while engaging, m: nearer than the horde, so the weapons pick it. */
  closeGap: 6,
  /** While a boss is up the crowd lying in a direction counts this much: the boss is the job. */
  bossCrowd: 0.6,
  /** A boss walks slowly (its charge is judged by its lane): its body is judged this far ahead, s. */
  bossHorizon: 0.5,
  laneWeight: 14,
  /** The Standstill's slow reaches this far; the kiter stays this much further out. */
  auraPad: 0.8,
  auraWeight: 4,
  /** Hop when the Standstill's ring front will reach the rider within this, s. */
  ringHop: 0.12,
};

/** Share of an enemy's height the rider must clear to pass over it in the air (as contact judges it). */
const HOP_CLEAR = 0.6;

/** When something at (rx, rz) moving at (ux, uz) relative to the rider comes within `r`, s (0 if it is; Infinity if never). */
function closingIn(rx: number, rz: number, ux: number, uz: number, r: number): number {
  const c = rx * rx + rz * rz - r * r;
  if (c <= 0) return 0;
  const a = ux * ux + uz * uz;
  const b = rx * ux + rz * uz;
  if (a < 1e-9 || b >= 0) return Infinity;
  const disc = b * b - a * c;
  if (disc <= 0) return Infinity;
  return (-b - Math.sqrt(disc)) / a;
}

/** What the board adds for the rider. */
export const BOARD = {
  /** Pressed: this many enemies within `pressNear` m. */
  pressCount: 4,
  pressNear: 9,
  /** Worth per metre of fall over the next 8 m, when pressed. */
  downhillWeight: 0.8,
  /**
   * Ollies over what is coming: an enemy whose touch the rider's present line enters within
   * `hopLook` s is hopped over when the ollie would carry the rider clear of its head (contact's
   * share of its height, plus `hopPad` m) for the whole crossing, starting as late as it can (no
   * more than `hopEarly` s before it must), and only if everything else met before landing is
   * cleared too. Bollards stand too tall for an ollie; the fan steers round them.
   */
  hopLook: 0.8,
  hopPad: 0.1,
  hopEarly: 0.1,
  /** Pads within this are a way out when pressed, m, and how much one is wanted. */
  padSight: 22,
  padWeight: 3,
  /** Errands (a crate, a slalom, a rail, a hoop) are started only with nothing within this, m. */
  calmNear: 8,
  /** ... and no more than this many within `sight`. */
  calmCount: 80,
  /** Below this share of its health the rider only goes for crates. */
  errandHealth: 0.6,
  /** Errands are looked for within this, m; one that takes longer than errandTicks is given up. */
  errandSight: 45,
  errandTicks: 720,
  /** The rider goes straight along an errand's heading when its near-miss cost is below this. */
  errandMiss: 0.05,
  /** Above this speed with an errand's next point within errandBrakeNear m, the rider brakes, m/s. */
  errandSpeed: 13,
  errandBrakeNear: 35,
  /** Cost per radian off the errand's heading. */
  errandWeight: 2.2,
  /** A rail is hopped onto from this far behind its end, m, after a run-up from runUp m back. */
  railHop: 1.1,
  runUp: 16,
  /** A hoop's kicker is ridden at from this far back, m. */
  hoopRunUp: 16,
  /** A slalom's first gate is ridden at from this far above it, m. */
  slalomRunUp: 12,
};

/** How far each weapon reaches from the rider, roughly, for keeping a boss in range, m. */
function reachOf(w: World, id: number, level: number): number {
  const area = w.player.stats.area;
  switch (id) {
    case W_SEEKERS:
      return 18;
    case W_SKIPPER:
      return 14;
    case W_STATIC:
      return 8;
    case W_LANCE:
      return LANCE.length[level - 1] * area * 0.8;
    case W_SLAM:
      return SLAM.radius[level - 1] * area * 0.8;
    case W_ORBIT:
      return ORBIT.radius * area + ORBIT.reach * 0.5;
    case W_CRUMBS:
      return 5;
    case W_WAKE:
      return 3;
    default:
      return -1;
  }
}

/**
 * The gap from a boss's edge the kiter keeps: within reach of its best weapon (the highest level;
 * the shorter reach between equals), never less than 2.5 m.
 */
function engageGap(w: World): number {
  const l = w.player.loadout;
  let bestLevel = 0;
  let gap = 18;
  for (let id = 0; id < WEAPON_COUNT; id++) {
    const level = l.weaponLevel[id];
    if (level === 0) continue;
    const r = reachOf(w, id, level);
    if (r < 0) continue;
    if (level > bestLevel || (level === bestLevel && r < gap)) {
      bestLevel = level;
      gap = r;
    }
  }
  return gap < 2.5 ? 2.5 : gap;
}

type ErrandKind = 'none' | 'crate' | 'slalom' | 'rail' | 'hoop';

/** The careful player. */
export function makeKiter(): Bot {
  return makeFighter(null);
}

/** The careful player who also rides: slopes, pads, ollies, rails, crates, slaloms and hoops. */
export function makeRider(bowl: Bowl): Bot {
  return makeFighter(bowl);
}

function makeFighter(bowl: Bowl | null): Bot {
  const board = bowl !== null;
  const N = KITE.fan;
  const cx = new Float64Array(N);
  const cz = new Float64Array(N);
  const cyaw = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    cyaw[k] = (k / N) * TAU - PI;
    cx[k] = dsin(cyaw[k]);
    cz[k] = dcos(cyaw[k]);
  }
  const cost = new Float64Array(N);
  const miss = new Float64Array(N);
  // The enemies in sight this tick.
  const MAXN = 512;
  const ex = new Float64Array(MAXN);
  const ez = new Float64Array(MAXN);
  const evx = new Float64Array(MAXN);
  const evz = new Float64Array(MAXN);
  const esafe = new Float64Array(MAXN);
  const ewt = new Float64Array(MAXN);
  /** The height to clear to pass over each, m, and how near its middle it touches, m. */
  const eclear = new Float64Array(MAXN);
  const etouch = new Float64Array(MAXN);
  const MAXS = 96;
  const sx = new Float64Array(MAXS);
  const sz = new Float64Array(MAXS);
  const sv = new Float64Array(MAXS);

  // The errand under way (rider only).
  let errand: ErrandKind = 'none';
  let errandIdx = -1;
  let errandTicks = 0;
  let errandStep = 0;
  let cooldown = 0;
  /** Things given up on lately, not tried again for a while. */
  const skipUntil = new Int32Array(256);
  let tick = 0;

  function endErrand(skip: boolean): void {
    if (skip && errandIdx >= 0 && errandIdx < skipUntil.length) skipUntil[errand === 'rail' ? 128 + errandIdx : errandIdx] = tick + 60 * 40;
    errand = 'none';
    errandIdx = -1;
    errandTicks = 0;
    errandStep = 0;
    cooldown = 90;
  }

  /** Pick an errand worth riding for, or none. */
  function chooseErrand(sim: Sim, cratesOnly: boolean): void {
    if (!bowl) return;
    const w = sim.world;
    const m = sim.state.mover;
    const t = w.things;
    let best = Infinity;
    let pick: ErrandKind = 'none';
    let pickIdx = -1;
    const ty = travelYaw(m);
    const consider = (kind: ErrandKind, idx: number, x: number, z: number, worth: number): void => {
      if (cratesOnly && kind !== 'crate') return;
      const key = kind === 'rail' ? 128 + idx : idx;
      if (key < skipUntil.length && skipUntil[key] > tick) return;
      const d = Math.hypot(x - m.x, z - m.z);
      if (d > BOARD.errandSight) return;
      const c = d + 8 * Math.abs(angleDiff(yawTo(m, x, z), ty)) - worth;
      if (c < best) {
        best = c;
        pick = kind;
        pickIdx = idx;
      }
    };
    for (let i = 0; i < t.count; i++) {
      const kind = t.kind[i];
      if (kind === THING_CRATE || kind === THING_GOLD_CRATE) {
        if (t.state[i] !== THING_DONE) consider('crate', i, t.x[i], t.z[i], kind === THING_GOLD_CRATE ? 12 : 6);
      } else if (kind === THING_GATE) {
        // The first gate of a slalom not yet finished, sought at the gate that is next (a slalom keeps
        // the gates already taken).
        if ((i === 0 || t.kind[i - 1] !== THING_GATE || t.group[i - 1] !== t.group[i]) && t.state[i] !== THING_DONE) {
          const g = i + t.state[i];
          if (g < t.count && t.kind[g] === THING_GATE && t.group[g] === t.group[i]) {
            consider('slalom', i, t.x[g] - dsin(t.yaw[g]) * 6, t.z[g] - dcos(t.yaw[g]) * 6, 8);
          }
        }
      } else if (kind === THING_HOOP) {
        if (t.state[i] === 0) {
          consider('hoop', i, t.x[i] - dsin(t.yaw[i]) * BOARD.hoopRunUp, t.z[i] - dcos(t.yaw[i]) * BOARD.hoopRunUp, 4);
        }
      }
    }
    const rails = bowl.features.rails;
    for (let r = 0; r < rails.length; r++) {
      const rs = rails[r];
      const len = Math.hypot(rs.x1 - rs.x0, rs.z1 - rs.z0);
      const ux = (rs.x1 - rs.x0) / len;
      const uz = (rs.z1 - rs.z0) / len;
      consider('rail', r, rs.x0 - ux * BOARD.runUp, rs.z0 - uz * BOARD.runUp, 10);
    }
    if (pick !== 'none') {
        errand = pick;
      errandIdx = pickIdx;
      errandTicks = 0;
      errandStep = 0;
    }
  }

  /**
   * Line up with a line through (x, z) along (ux, uz): ride to a point `back` m before it, then
   * along the line. Once within `hopAt` m of the point (or at it, when hopAt is 0), with the board
   * on the line and going along it, the errand moves to its next step (with a hop if `hop`); if it
   * gets there off the line (more than `tol` m to the side) it is given up. Returns the heading to ride.
   */
  function lineUp(sim: Sim, x: number, z: number, ux: number, uz: number, back: number, hopAt: number, hop: boolean, tol = 0.6): number {
    const m = sim.state.mover;
    const along = (m.x - x) * ux + (m.z - z) * uz;
    const side = (m.x - x) * uz - (m.z - z) * ux;
    const lineYaw = datan2(ux, uz);
    errandDist = Math.hypot(m.x - x, m.z - z);
    if (errandStep === 0) {
      // To the start of the run-up, coming at it from behind.
      const sx = x - ux * back;
      const sz = z - uz * back;
      if (Math.hypot(m.x - sx, m.z - sz) < 2.5 || (along < -back * 0.5 && along > -back - 3 && Math.abs(side) < 1)) errandStep = 1;
      else {
        // From in front of the line, go round: aim further back along it.
        const extra = along > -back ? 8 : 0;
        return yawTo(m, sx - ux * extra + uz * Math.sign(side) * extra * 0.5, sz - uz * extra - ux * Math.sign(side) * extra * 0.5);
      }
    }
    // On the run-up: pursue a point a little way ahead on the line.
    const lined = Math.abs(side) < tol && Math.abs(angleDiff(travelYaw(m), lineYaw)) < 0.3 + tol * 0.1;
    if (along > -hopAt - 0.4) {
      if (lined && m.grounded && m.speed > 5) {
        if (hop) wantHop = true;
        errandStep = 2;
        errandTicks = 0;
        return lineYaw;
      }
      endErrand(true);
      return NaN;
    }
    if (Math.abs(side) > 4 || along < -back - 6) {
      errandStep = 0;
      return yawTo(m, x - ux * back, z - uz * back);
    }
    const look = 4;
    return yawTo(m, x + ux * (along + look), z + uz * (along + look));
  }

  /** The heading the errand wants now, or NaN when it is over. Sets `wantHop`. */
  let wantHop = false;
  /** How far the errand's next point is, m (0 when it does not say). */
  let errandDist = 0;
  function errandYaw(sim: Sim): number {
    if (!bowl) return NaN;
    const w = sim.world;
    const m = sim.state.mover;
    const t = w.things;
    wantHop = false;
    errandTicks++;
    if (errandTicks > BOARD.errandTicks) {
      endErrand(true);
      return NaN;
    }
    if (errand === 'crate') {
      if (t.state[errandIdx] === THING_DONE) {
        endErrand(false);
        return NaN;
      }
      errandDist = Math.hypot(t.x[errandIdx] - m.x, t.z[errandIdx] - m.z);
      return yawTo(m, t.x[errandIdx], t.z[errandIdx]);
    }
    if (errand === 'slalom') {
      const g = errandIdx + errandStep;
      const group = t.group[errandIdx];
      if (t.state[errandIdx] === THING_DONE) {
        endErrand(false);
        return NaN;
      }
      if (g >= t.count || t.kind[g] !== THING_GATE || t.group[g] !== group) {
        endErrand(true);
        return NaN;
      }
      // The slalom's own count of gates passed (its state) says which gate is next.
      const passed = t.state[errandIdx];
      const gi = errandIdx + passed;
      const fx = dsin(t.yaw[gi]);
      const fz = dcos(t.yaw[gi]);
      if (passed === 0 && errandStep < 2) {
        // Come at the first gate from above, down its line: the slalom falls.
        return lineUp(sim, t.x[gi], t.z[gi], fx, fz, BOARD.slalomRunUp, 0, false, 2.5);
      }
      // Through each gate's middle, a little past it.
      errandDist = Math.hypot(t.x[gi] - m.x, t.z[gi] - m.z);
      return yawTo(m, t.x[gi] + fx * 2, t.z[gi] + fz * 2);
    }
    if (errand === 'rail') {
      const rs = bowl.features.rails[errandIdx];
      const len = Math.hypot(rs.x1 - rs.x0, rs.z1 - rs.z0);
      const ux = (rs.x1 - rs.x0) / len;
      const uz = (rs.z1 - rs.z0) / len;
      const railYaw = datan2(ux, uz);
      if (m.rail >= 0) {
        // On it: the rail steers. Done when it lets go.
        errandStep = 3;
        return railYaw;
      }
      if (errandStep === 3) {
        endErrand(false);
        return NaN;
      }
      if (errandStep === 2) {
        // Hopped: in the air over the run-up. Landing without a catch is a miss.
        if (m.grounded && errandTicks > 4) endErrand(true);
        return railYaw;
      }
      return lineUp(sim, rs.x0, rs.z0, ux, uz, BOARD.runUp, BOARD.railHop, true);
    }
    if (errand === 'hoop') {
      if (t.state[errandIdx] !== 0) {
        endErrand(false);
        return NaN;
      }
      const fx = dsin(t.yaw[errandIdx]);
      const fz = dcos(t.yaw[errandIdx]);
      // Ride the kicker straight along its line, through the hoop standing on its top.
      const kx = t.x[errandIdx];
      const kz = t.z[errandIdx];
      if (errandStep === 2) {
        const along = (m.x - kx) * fx + (m.z - kz) * fz;
        if (along > 12 || (m.grounded && along > 3)) endErrand(true);
        return datan2(fx, fz);
      }
      return lineUp(sim, kx, kz, fx, fz, BOARD.hoopRunUp, 0, false);
    }
    return NaN;
  }

  /**
   * Whether to ollie now to pass over what the rider's present line runs into (see `BOARD.hopLook`).
   * The ollie is judged on level ground, keeping the rider's speed and the enemies' own.
   */
  function hopOver(sim: Sim, n: number, bi: number): boolean {
    const m = sim.state.mover;
    const vy = FEEL.hopSpeed * sim.state.mods.hopSpeed;
    const g = FEEL.gravity;
    const apex = (vy * vy) / (2 * g);
    const air = (2 * vy) / g;
    const look = Math.max(air, BOARD.hopLook);
    let want = false;
    if (bi >= 0) {
      // Nothing clears a boss, and the air is no place to be when one is about to touch.
      const h = sim.world.horde;
      const rx = h.x[bi] - m.x;
      const rz = h.z[bi] - m.z;
      const ux = h.vx[bi] - m.vx;
      const uz = h.vz[bi] - m.vz;
      const t = closingIn(rx, rz, ux, uz, KINDS[h.kind[bi]].radius + PLAYER_RADIUS + 1);
      if (t < air + 0.2) return false;
    }
    for (let i = 0; i < n; i++) {
      const rx = ex[i];
      const rz = ez[i];
      const ux = evx[i] - m.vx;
      const uz = evz[i] - m.vz;
      // When |r + u t| = touch: a t^2 + 2 b t + c = 0.
      const a = ux * ux + uz * uz;
      const bb = rx * ux + rz * uz;
      const rr = etouch[i] + 0.1;
      const c = rx * rx + rz * rz - rr * rr;
      if (a < 1e-9) continue;
      const disc = bb * bb - a * c;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const tIn = (-bb - sq) / a;
      const tOut = (-bb + sq) / a;
      if (tOut <= 0 || tIn > look) continue;
      // Anything met before landing must be cleared, or this is no time to leave the ground.
      const ch = eclear[i];
      let lo = Infinity;
      let hi = -Infinity;
      if (ch < apex) {
        // The ollie is above ch between these times after take-off.
        const s2 = Math.sqrt(vy * vy - 2 * g * ch);
        lo = (vy - s2) / g;
        hi = (vy + s2) / g;
      }
      if (tIn < lo || tOut > hi) {
        if (tIn < air) return false;
        continue;
      }
      if (tIn <= lo + BOARD.hopEarly) want = true;
    }
    return want;
  }

  return (sim, out) => {
    tick++;
    const w = sim.world;
    const m = sim.state.mover;
    const h = w.horde;
    const terrain = sim.terrain;
    out.hop = false;

    const v = Math.max(Math.hypot(m.vx, m.vz), KITE.minSpeed);
    const T = KITE.horizon;
    const ty = travelYaw(m);

    // What is in sight.
    let n = 0;
    let near = 0;
    const sight2 = KITE.sight * KITE.sight;
    for (let i = 0; i < h.count && n < MAXN; i++) {
      if (h.hp[i] <= 0) continue;
      const kind = KINDS[h.kind[i]];
      if (kind.boss === true) continue;
      if (kind.latches === true && h.state[i] === STATE_LATCHED) continue;
      const dx = h.x[i] - m.x;
      const dz = h.z[i] - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > sight2) continue;
      // Still rising: it cannot touch yet, but it will.
      ex[n] = dx;
      ez[n] = dz;
      evx[n] = h.stun[i] > 0 || h.age[i] < SPAWN_TICKS ? 0 : h.vx[i];
      evz[n] = h.stun[i] > 0 || h.age[i] < SPAWN_TICKS ? 0 : h.vz[i];
      const heavy = h.kind[i] === KIND_BOLLARD;
      esafe[n] = kind.radius + 0.5 + (heavy ? KITE.heavyMargin : KITE.margin);
      ewt[n] = kind.damage <= 0 ? 0.4 : kind.damage / 8;
      if (d2 < BOARD.pressNear * BOARD.pressNear) near++;
      eclear[n] = kind.height * HOP_CLEAR + BOARD.hopPad;
      etouch[n] = kind.radius + PLAYER_RADIUS;
      n++;
    }
    const pressed = near >= BOARD.pressCount;

    // Sparks worth going for.
    let ns = 0;
    const sp = w.sparks;
    const ss2 = KITE.sparkSight * KITE.sparkSight;
    for (let i = 0; i < sp.count && ns < MAXS; i++) {
      if (sp.pull[i] !== 0) continue;
      const dx = sp.x[i] - m.x;
      const dz = sp.z[i] - m.z;
      if (dx * dx + dz * dz > ss2) continue;
      sx[ns] = dx;
      sz[ns] = dz;
      sv[ns] = sp.value[i];
      ns++;
    }

    // The boss, if one is up and risen.
    const b = w.boss;
    let bi = -1;
    if (b.kind >= 0) {
      for (let i = 0; i < h.count; i++) {
        if (KINDS[h.kind[i]].boss === true) {
          bi = i;
          break;
        }
      }
    }
    let lane = false;
    let laneX = 0;
    let laneZ = 0;
    let engage = 0;
    if (bi >= 0) {
      const kind = h.kind[bi];
      const r = KINDS[kind].radius;
      engage = r + 0.5 + Math.min(engageGap(w), KITE.closeGap);
      if (kind === KIND_STANDSTILL) engage = Math.max(engage, BOSS.standstill.auraReach + KITE.auraPad + 0.5);
      if (kind === KIND_BRUISER && (h.state[bi] === BRUISER_TELL || h.state[bi] === BRUISER_CHARGE)) {
        // It faces where it will charge: its lean (or its charge) shows the line.
        const l = Math.hypot(h.vx[bi], h.vz[bi]);
        if (l > 1e-4) {
          lane = true;
          laneX = h.vx[bi] / l;
          laneZ = h.vz[bi] / l;
        }
      }
    }

    // Errands, for the rider, when it is calm.
    let errandWant = NaN;
    if (board) {
      if (cooldown > 0) cooldown--;
      let calm = n <= BOARD.calmCount && bi < 0;
      if (calm) {
        for (let k = 0; k < n; k++) {
          if (ex[k] * ex[k] + ez[k] * ez[k] < BOARD.calmNear * BOARD.calmNear) {
            calm = false;
            break;
          }
        }
      }
      // Hurt, it only goes out of its way for what might heal it: a crate.
      if (errand === 'none' && calm && cooldown === 0) chooseErrand(sim, w.player.hp < w.player.maxHp * BOARD.errandHealth);
      if (errand !== 'none') {
        // A boss calls it off; so does being pressed before it is committed (on a rail, or in the air
        // for one): a crate is not worth a crowd. Danger on the way is weighed by the fan, below.
        if (bi >= 0) endErrand(false);
        else if (pressed && m.rail < 0 && errandStep < 2) endErrand(true);
        else errandWant = errandYaw(sim);
      }
    }

    // Score the fan.
    let bestK = 0;
    let bestCost = Infinity;
    const hereY = m.y;
    const R = terrain.radius * KITE.home;
    for (let k = 0; k < N; k++) {
      const dx = cx[k];
      const dz = cz[k];
      const pvx = dx * v;
      const pvz = dz * v;
      let c = 0;
      let mc = 0;
      for (let i = 0; i < n; i++) {
        const rx = ex[i];
        const rz = ez[i];
        const ux = evx[i] - pvx;
        const uz = evz[i] - pvz;
        const uu = ux * ux + uz * uz;
        let t = uu > 1e-9 ? -(rx * ux + rz * uz) / uu : 0;
        if (t < 0) t = 0;
        else if (t > T) t = T;
        const qx = rx + ux * t;
        const qz = rz + uz * t;
        const dmin = Math.sqrt(qx * qx + qz * qz);
        const safe = esafe[i];
        if (dmin < safe) {
          const f = (safe - dmin) / safe;
          mc += ewt[i] * f * f * (2 - t / T);
        }
        const d = Math.sqrt(rx * rx + rz * rz);
        const ahead = (rx * dx + rz * dz) / (d > 1e-6 ? d : 1e-6);
        if (ahead > 0) c += (ewt[i] * ahead * ahead) / (d > 3 ? d : 3);
      }
      miss[k] = mc;
      c = c * KITE.crowdWeight * (bi >= 0 ? KITE.bossCrowd : 1) + mc * KITE.missWeight;

      // The rim.
      const fx = m.x + dx * v * T;
      const fz = m.z + dz * v * T;
      const fr = Math.hypot(fx, fz);
      if (fr > R) c += (fr - R) * KITE.rimWeight;
      // The climb (and, for the rider when pressed, the fall).
      const climb = terrain.heightAt(m.x + dx * 8, m.z + dz * 8) - hereY;
      if (climb > 0) c += climb * KITE.climbWeight;
      else if (board && pressed) c += climb * BOARD.downhillWeight;
      // Turning.
      c += Math.abs(angleDiff(cyaw[k], ty)) * KITE.turnWeight;

      // Rings about to land, and tar.
      const zn = w.zones;
      for (let z = 0; z < zn.count; z++) {
        const kind = zn.kind[z];
        if (kind === ZONE_LOB) {
          const tl = zn.life[z] * DT;
          if (tl > T + 0.3) continue;
          const px = m.x + pvx * tl - zn.x[z];
          const pz = m.z + pvz * tl - zn.z[z];
          const rr = zn.r[z] + KITE.ringPad;
          if (px * px + pz * pz < rr * rr) c += KITE.ringWeight;
        } else if (kind === ZONE_TAR) {
          for (let s = 1; s <= 3; s++) {
            const tt = 0.3 * s;
            const px = m.x + pvx * tt - zn.x[z];
            const pz = m.z + pvz * tt - zn.z[z];
            const rr = zn.r[z] + 0.4;
            if (px * px + pz * pz < rr * rr) c += KITE.tarWeight;
          }
        }
      }

      // Sparks, when nothing is close that way.
      if (mc < 0.05) {
        let want = 0;
        for (let s = 0; s < ns; s++) {
          const d = Math.hypot(sx[s], sz[s]);
          const a = (sx[s] * dx + sz[s] * dz) / (d > 1e-6 ? d : 1e-6);
          if (a > 0.7) want += (sv[s] * a * a * a * a) / (d > 3 ? d : 3);
        }
        c -= Math.min(want, 3) * KITE.sparkWeight;
      }

      // The boss.
      if (bi >= 0) {
        const kind = h.kind[bi];
        const bx = h.x[bi];
        const bz = h.z[bi];
        const r = KINDS[kind].radius;
        const qx = m.x + pvx * 0.8 - bx;
        const qz = m.z + pvz * 0.8 - bz;
        const qd = Math.hypot(qx, qz);
        c += Math.abs(qd - engage) * (kind === KIND_STANDSTILL ? KITE.standstillEngage : KITE.engageWeight);
        // Its body.
        const ux = h.vx[bi] - pvx;
        const uz = h.vz[bi] - pvz;
        const rx = bx - m.x;
        const rz = bz - m.z;
        const uu = ux * ux + uz * uz;
        let t = uu > 1e-9 ? -(rx * ux + rz * uz) / uu : 0;
        if (t < 0) t = 0;
        else if (t > KITE.bossHorizon) t = KITE.bossHorizon;
        const dmin = Math.hypot(rx + ux * t, rz + uz * t);
        const safe = r + 0.5 + KITE.heavyMargin;
        if (dmin < safe) c += KITE.missWeight * 3 * (safe - dmin) / safe;
        if (lane) {
          // The Bruiser's charge line: be off it.
          for (let s = 1; s <= 8; s++) {
            const tt = 0.2 * s;
            const px = m.x + pvx * tt - bx;
            const pz = m.z + pvz * tt - bz;
            const along = px * laneX + pz * laneZ;
            const side = Math.abs(px * laneZ - pz * laneX);
            if (along > -r && along < BOSS.bruiser.chargeFar + r && side < r + 0.5 + 2) {
              c += KITE.laneWeight / 8;
            }
          }
        }
        if (kind === KIND_STANDSTILL) {
          const lim = BOSS.standstill.auraReach + 0.5;
          if (qd < lim) c += KITE.auraWeight * (lim - qd) / lim + KITE.auraWeight * 0.5;
        }
      }

      // The rider's pads, when pressed.
      if (board && pressed && bowl) {
        const pads = bowl.pads;
        for (let p = 0; p < pads.length; p++) {
          const px = pads[p].x - m.x;
          const pz = pads[p].z - m.z;
          const d = Math.hypot(px, pz);
          if (d > BOARD.padSight) continue;
          const a = (px * dx + pz * dz) / (d > 1e-6 ? d : 1e-6);
          if (a > 0.9) c -= BOARD.padWeight * a;
        }
      }

      // The errand.
      if (!Number.isNaN(errandWant)) c += Math.abs(angleDiff(cyaw[k], errandWant)) * BOARD.errandWeight;

      cost[k] = c;
      if (c < bestCost) {
        bestCost = c;
        bestK = k;
      }
    }

    // On an errand with nothing close the way it wants, go straight at it. With something close
    // that way the fan weighs the errand against the danger; an errand that takes too long is given up.
    let yaw = cyaw[bestK];
    if (!Number.isNaN(errandWant)) {
      let k = Math.round(((errandWant + PI) / TAU) * N) % N;
      if (k < 0) k += N;
      if (miss[k] < BOARD.errandMiss) yaw = errandWant;
    }
    // Too fast to line up for an errand close by: ease off (a centred stick brakes) while on line.
    const brake =
      !Number.isNaN(errandWant) &&
      m.grounded &&
      m.rail < 0 &&
      m.speed > BOARD.errandSpeed &&
      errandDist < BOARD.errandBrakeNear &&
      Math.abs(angleDiff(yaw, ty)) < 0.25;
    stickToward(sim, yaw, brake ? 0 : 1, out);

    // Hops. The Standstill's ring: up as its front arrives.
    const zn = w.zones;
    if (m.grounded) {
      for (let z = 0; z < zn.count; z++) {
        if (zn.kind[z] !== ZONE_RING) continue;
        const dx = m.x - zn.x[z];
        const dz = m.z - zn.z[z];
        const d = Math.hypot(dx, dz);
        const gap = d - zn.r[z];
        if (gap < 0) continue;
        const outward = d > 1e-6 ? (m.vx * dx + m.vz * dz) / d : 0;
        const closing = BOSS.standstill.ringSpeed - outward;
        if (closing > 0 && gap / closing < KITE.ringHop) out.hop = true;
      }
      if (board) {
        if (hopOver(sim, n, bi)) out.hop = true;
        if (w.player.latched > 0) out.hop = true;
        if (wantHop) out.hop = true;
      }
    }
  };
}

