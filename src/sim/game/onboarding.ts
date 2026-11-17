/**
 * Onboarding: a first launch that teaches the game by play, one hint at a time. Nothing blocks: a
 * hint shows while its situation holds (and a moment after, so it does not flicker) and comes back
 * the next time the situation does.
 *
 * The lesson is four things: carve, hitch, sling, ink. Once they are done, two closing tickets follow
 * ('map': where the map is; 'lift': no pushing, everything that moves is a lift) and the lesson is
 * complete. Four more hints show in their situations until each has been done once, before or after
 * completion, and hold nothing back: hop, grind, chain and roll (the rescue for a stalled skater).
 *
 * | step  | shows when                                                              | done when                     |
 * | carve | rolling on the ground for 1 s                                           | steer past ±0.4 both ways     |
 * | hop   | rolling at a ledge, stair top or rail within 12 m ahead (after carve)   | a hop                         |
 * | grind | within 8 m of a handrail's run-in, rolling or airborne (after hop)       | a grind starts                |
 * | hitch | a ride to catch: see below (after carve)                                | a hitch                       |
 * | sling | hitched for 1.5 s (after hitch)                                         | the player lets go in a whip  |
 * | ink   | hitched, or a ride to catch (after sling)                               | a segment inked               |
 * | chain | released with another line's ride within 25 m (after sling)             | a hitch as the 2nd link       |
 * | roll  | standing on flat ground for 3 s without holding                         | pumped above 2 m/s            |
 *
 * **A ride to catch** leads the player to it rather than announcing it as it goes by: when the skater
 * is heading for a stop (within LEAD_NEAR, no higher than them, on their way) where a ground ride
 * they could grab will stand or pass within LEAD_TICKS, the pointer is over a waiting spot beside the
 * lane (within reach of where the grab point passes, clear of every vehicle's body) and the hint says
 * to press and hold still, which plants a foot and stops them there. Once that ride is within
 * HITCH_NEAR the pointer moves to its grab bar. With no stop to lead to, a ride coming at the skater
 * or standing close by is pointed at directly. Until the hitch is learnt, no ride that needs a hop to
 * reach is ever pointed at.
 *
 * A step counts whenever its condition happens, even before its hint has shown. Only a release the
 * player makes (lifting the finger, or a flick) counts toward the sling; a ride that lets go of them
 * does not.
 *
 * Nothing shows with the hints setting off, during a chalk recording or race, or during an errand.
 * Until the hitch step is done (and while the lesson runs with hints on) errands do not offer
 * themselves: a new player's first sight should not be an offer asking them to hold still before
 * they know what holding does (`Game.errandsOpen`).
 *
 * World scans (rides and stops near the skater, ledges ahead, handrail run-ins) run every SCAN_EVERY
 * ticks, only for the hints that could show, with bounding-box rejects and no allocation.
 */
import { DT, FEEL } from '../constants';
import { computeVehicle, grabPoint, makeVehicleState, pathAt, vehicleAt, type CompiledLine } from '../lines';
import { dcos, dsin, len2 } from '../math';
import { Mode } from '../types';
import { Surface, makeGroundSample, makeRailHit, nearestRail, sampleGround, terrainSurface, topHeight, type World } from '../world';
import type { Game, GameReducer } from './game';
import { lineSegments, segmentSlack, type Segment } from './progress';

/** The four things the lesson teaches; all four done (then the closing tickets) completes it. */
export const LESSON_STEPS = ['carve', 'hitch', 'sling', 'ink'] as const;
export type LessonStep = (typeof LESSON_STEPS)[number];
/** Hints that show in their situations until done once and are not part of completion. */
export const EXTRA_STEPS = ['hop', 'grind', 'chain', 'roll'] as const;
export type ExtraStep = (typeof EXTRA_STEPS)[number];
/** Every step with a hint. */
export type OnboardingStep = LessonStep | ExtraStep;
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['carve', 'hop', 'grind', 'hitch', 'sling', 'ink', 'chain', 'roll'];
/** What the hint stub can show: a step, or one of the two closing tickets. */
export type HintId = OnboardingStep | 'map' | 'lift';

/** Ticks rolling on the ground before the carve hint shows (1 s). */
export const CARVE_SHOW_TICKS = 60;
/** Steer the skater must carve past, each way. */
export const CARVE_STEER = 0.4;
/** Rolling: faster than this, m/s. */
export const ROLLING_SPEED = 0.5;
/** How far ahead a ledge, stair top or rail prompts the hop hint, metres. */
export const HOP_AHEAD = 12;
/** How close to a handrail's run-in the grind hint shows, metres. */
export const GRIND_NEAR = 8;
/** A moving ride this close and coming prompts the hitch hint; the lead's ride this close is pointed at, metres. */
export const HITCH_NEAR = 30;
/** A ride standing at a stop this close prompts it, metres. */
export const HITCH_STOP_NEAR = 20;
/** A moving ride must pass this close sideways to count as coming at the skater, metres. */
export const HITCH_LATERAL = 10;
/** A ride's ground may be this far above or below the skater and still be pointed at, metres. */
export const LEVEL_DY = 4;
/** A ride must stay in service this long to be pointed at (2 s). */
export const CATCH_AHEAD_TICKS = 120;
/** A stop this close (horizontally) can be led to, metres. */
export const LEAD_NEAR = 45;
/** A stop being led to keeps the lead out to this distance, metres. */
export const LEAD_KEEP_NEAR = 55;
/** A stop may be at most this far above the skater to be led to, metres. */
export const LEAD_ABOVE = 1;
/** A ride must reach the stop within this many ticks for the lead to start (20 s). */
export const LEAD_TICKS = 20 * 60;
/** A lead already shown holds while a ride reaches its stop within this many ticks (45 s). */
export const LEAD_KEEP_TICKS = 45 * 60;
/** Rolling faster than this, a stop must be ahead to be on the skater's way, m/s. */
export const LEAD_MOVING = 1.5;
/** Ahead: within this cosine of the direction of travel (60 degrees), unless closer than LEAD_CLOSE. */
export const LEAD_COS = 0.5;
/** A stop this close is on the way whichever way the skater is going, metres. */
export const LEAD_CLOSE = 15;
/** A waiting spot stands this far beyond the side of the ride's body, metres. */
export const SPOT_CLEAR = 1.2;
/** ...and at least this far beyond the side of every other ride's body, metres. */
export const LANE_CLEAR = 1.0;
/** Within this of the waiting spot the skater is waiting there, metres. */
export const SPOT_NEAR = 3;
/** Hitched this long, the sling hint shows (1.5 s). */
export const SLING_SHOW_TICKS = 90;
/** A release whose exit speed is at least this times the ride's speed is a whip. */
export const WHIP_RATIO = 1.15;
/** Another line's ride this close at a release introduces the chain, metres. */
export const CHAIN_NEAR = 25;
/** Standing: slower than this, m/s. */
export const STAND_SPEED = 0.3;
/** Standing this long on flat ground without holding shows the roll hint (3 s). */
export const ROLL_STAND_TICKS = 180;
/** Ground this flat (rise over run) has no slope to take a standing skater. */
export const ROLL_FLAT = 0.06;
/** Pumped above this, the roll is learnt, m/s. */
export const ROLL_DONE_SPEED = 2;
/** World scans run every this many ticks. */
export const SCAN_EVERY = 10;
/** A hint stays this long after its situation stops holding (0.75 s). */
export const HINT_LINGER_TICKS = 45;
/** The map pointer shows this long once the lesson's steps are done (4 s). */
export const MAP_TICKS = 240;
/** The last ticket shows this long, then the lesson is complete (5 s). */
export const LIFT_TICKS = 300;

/** Display priority, highest first: a fleeting chance beats one that comes back. */
const PRIORITY: readonly OnboardingStep[] = ['sling', 'ink', 'roll', 'hitch', 'grind', 'hop', 'chain', 'carve'];

/** Arrival samples: how often a ride's place on its lap is checked when looking ahead (0.5 s). */
const ARRIVE_STEP = 30;
/** A ride is at a stop when its arc position is this close to the stop's, metres. */
const AT_STOP = 0.6;

export type HintTargetKind = 'none' | 'rail' | 'vehicle' | 'spot';

/**
 * What the world pointer is over, and where: the run-in point for a rail, the grab point (this tick)
 * for a vehicle, the ground at the waiting spot for a spot.
 */
export interface HintTarget {
  kind: HintTargetKind;
  line: number;
  veh: number;
  rail: number;
  x: number;
  y: number;
  z: number;
  /** The ride pointed at needs a hop to reach (never before the hitch is learnt). */
  hop: boolean;
}

export interface OnboardingState {
  done: Record<OnboardingStep, boolean>;
  /** The hint showing now, or ''. */
  shown: HintId | '';
  /** The lesson's steps and the closing tickets are done. */
  complete: boolean;
  /** The hints setting. Off: nothing shows and errands are open. Not saved (settings are). */
  enabled: boolean;
  /** The sling hint asks for a real whip: the last release was a plain one. */
  slingRetry: boolean;
  /** The ink hint is asking to catch a ride first (not hitched). */
  inkCatch: boolean;
  /** The ink hint: the stop where the current hitch will ink its first segment ('' if unknown). */
  stopName: string;
  /** What the world pointer is over while `shown` is 'grind', 'hitch' or a catching 'ink'. */
  readonly target: HintTarget;
}

export interface OnboardingData {
  v: 1;
  done: OnboardingStep[];
  complete: boolean;
  releases: number;
}

function freshDone(): Record<OnboardingStep, boolean> {
  return { carve: false, hop: false, grind: false, hitch: false, sling: false, ink: false, chain: false, roll: false };
}

/** Count of done lesson steps. */
export function lessonDoneCount(st: Pick<OnboardingState, 'done'>): number {
  let n = 0;
  for (const s of LESSON_STEPS) if (st.done[s]) n++;
  return n;
}

const VS = makeVehicleState();
const VS2 = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };
const PA = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
const RH = makeRailHit();
const GS = makeGroundSample();

/** A standing hop's height, with a margin: what a skater on the ground can add to their reach. */
function hopReach(): number {
  return (0.6 * FEEL.HOP_V * FEEL.HOP_V) / (2 * FEEL.GRAVITY);
}

/**
 * The best ride to point at for a skater at (x, y, z) with `chain` links alive, at `tick`: a ride
 * tryHitch would accept (in service now and for CATCH_AHEAD_TICKS more, not gated above the next
 * link, its grab point within vertical reach of the ground under it, or a hop's reach for a strap
 * when `allowHop`, that ground within LEVEL_DY of the skater's height) that is standing within
 * HITCH_STOP_NEAR or moving within HITCH_NEAR toward the skater and passing within HITCH_LATERAL.
 * Writes the line and vehicle into `out` (line -1 when none) and whether it needs a hop. Pure.
 */
export function findCatchable(
  w: World,
  tick: number,
  x: number,
  y: number,
  z: number,
  chain: number,
  out: { line: number; veh: number; hop?: boolean },
  allowHop = false,
): void {
  out.line = -1;
  out.veh = -1;
  out.hop = false;
  const reachY = FEEL.HITCH_REACH_Y;
  const hopUp = hopReach();
  let best = Infinity;
  for (let li = 0; li < w.lines.length; li++) {
    const L = w.lines[li];
    if (chain + 1 < L.minChainN) continue;
    const m = HITCH_NEAR + L.anchorBack + 2;
    if (x < L.minX - m || x > L.maxX + m || z < L.minZ - m || z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, tick, VS);
      if (!VS.active) continue;
      grabPoint(L, VS, GP);
      const dx = x - GP.x;
      const dz = z - GP.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= HITCH_NEAR || d >= best) continue;
      // Judged from the ground under the grab point, where the skater would stand to catch it, and
      // that ground must be about the skater's level (not a street below a wall).
      const under = topHeight(w, GP.x, GP.z);
      if (under - y > LEVEL_DY || y - under > LEVEL_DY) continue;
      const dy = GP.y - (under + FEEL.HAND_HEIGHT);
      if (dy < -reachY) continue;
      const needHop = dy > reachY;
      if (needHop && !(allowHop && L.overhead && dy <= reachY + hopUp)) continue;
      const sp = len2(VS.vx, VS.vz);
      if (sp < 0.05) {
        if (d >= HITCH_STOP_NEAR) continue;
      } else {
        // Coming at the skater, and passing close enough to reach as it goes by.
        const closing = (dx * VS.vx + dz * VS.vz) / sp;
        const lateral = Math.abs(dx * VS.vz - dz * VS.vx) / sp;
        if (closing <= 0 || lateral > HITCH_LATERAL) continue;
      }
      vehicleAt(L, vi, tick + CATCH_AHEAD_TICKS, VS2);
      if (!VS2.active) continue;
      best = d;
      out.line = li;
      out.veh = vi;
      out.hop = needHop;
    }
  }
}

/** Squared horizontal distance from (x, z) to the nearest segment of a line's path. */
function pathDist2(L: CompiledLine, x: number, z: number, limit: number): number {
  if (x < L.minX - limit || x > L.maxX + limit || z < L.minZ - limit || z > L.maxZ + limit) return Infinity;
  const p = L.pathPts;
  let best = Infinity;
  for (let i = 3; i < p.length; i += 3) {
    const ax = p[i - 3];
    const az = p[i - 1];
    const bx = p[i];
    const bz = p[i + 2];
    if ((x < ax - limit && x < bx - limit) || (x > ax + limit && x > bx + limit)) continue;
    if ((z < az - limit && z < bz - limit) || (z > az + limit && z > bz + limit)) continue;
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = ax + ex * t - x;
    const qz = az + ez * t - z;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * Stops a ground ride can be caught at, each with up to two waiting spots: beside the lane, level
 * with the grab point where the ride stands (so it passes within reach), SPOT_CLEAR beyond the side
 * of its body and LANE_CLEAR beyond every other ride's, on level ground that is not stairs or water,
 * with nothing in the way between spot and lane.
 */
export interface StopSites {
  n: number;
  line: Int32Array;
  stop: Int32Array;
  s: Float64Array;
  /** The stop on the path. */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Two spots per stop: (x, y, z) at [2i] and [2i+1]; ok[k] says whether spot k exists. */
  sx: Float64Array;
  sy: Float64Array;
  sz: Float64Array;
  ok: Uint8Array;
}

export function stopSites(w: World): StopSites {
  const line: number[] = [];
  const stop: number[] = [];
  const s: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const sx: number[] = [];
  const sy: number[] = [];
  const sz: number[] = [];
  const ok: number[] = [];
  const ground = w.lines.filter((L) => !L.overhead);
  for (const L of w.lines) {
    if (L.overhead) continue;
    const off = Math.min(L.bodyHalfWid + SPOT_CLEAR, FEEL.HITCH_REACH - 1);
    for (let k = 0; k < L.allStops.length; k++) {
      // A loop's closing terminus is its first stop again.
      if (L.loop && k > 0 && L.allStops[k].s >= L.length - 1e-6) continue;
      pathAt(L, L.allStops[k].s, PA);
      const gx = PA.x - PA.hx * L.anchorBack;
      const gz = PA.z - PA.hz * L.anchorBack;
      const grabY = PA.y + L.anchorY - L.hang;
      line.push(L.index);
      stop.push(k);
      s.push(L.allStops[k].s);
      x.push(PA.x);
      y.push(PA.y);
      z.push(PA.z);
      for (const side of [1, -1]) {
        const qx = gx + side * PA.hz * off;
        const qz = gz - side * PA.hx * off;
        let good = qx > w.minX + 1 && qx < w.maxX - 1 && qz > w.minZ + 1 && qz < w.maxZ - 1;
        let qy = PA.y;
        if (good) {
          qy = topHeight(w, qx, qz);
          const surf = terrainSurface(w, qx, qz);
          const mid = topHeight(w, (qx + gx) * 0.5, (qz + gz) * 0.5);
          const dy = grabY - (qy + FEEL.HAND_HEIGHT);
          good =
            Math.abs(qy - PA.y) < 0.6 &&
            Math.abs(mid - PA.y) < 0.6 &&
            surf !== Surface.WATER &&
            surf !== Surface.STAIRS &&
            dy >= -FEEL.HITCH_REACH_Y &&
            dy <= FEEL.HITCH_REACH_Y;
        }
        if (good) {
          for (const M of ground) {
            const clear = M === L ? off - 0.2 : M.bodyHalfWid + LANE_CLEAR + 0.35;
            if (pathDist2(M, qx, qz, clear) < clear * clear) {
              good = false;
              break;
            }
          }
        }
        sx.push(qx);
        sy.push(qy);
        sz.push(qz);
        ok.push(good ? 1 : 0);
      }
    }
  }
  return {
    n: line.length,
    line: Int32Array.from(line),
    stop: Int32Array.from(stop),
    s: Float64Array.from(s),
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    z: Float64Array.from(z),
    sx: Float64Array.from(sx),
    sy: Float64Array.from(sy),
    sz: Float64Array.from(sz),
    ok: Uint8Array.from(ok),
  };
}

/**
 * Ticks until a vehicle of `L` stands at or passes arc position `s0` (0 if one is there now), within
 * `limit` ticks, and stays in service CATCH_AHEAD_TICKS beyond; -1 if none. The vehicle goes in
 * `out.veh`. Pure (it does not touch the vehicle memo).
 */
export function rideToStop(L: CompiledLine, s0: number, tick: number, limit: number, out: { veh: number }): number {
  let best = -1;
  out.veh = -1;
  const half = L.length * 0.5;
  for (let vi = 0; vi < L.vehicles; vi++) {
    let prevS = 0;
    let prevOn = false;
    for (let k = 0; k <= limit && (best < 0 || k < best); k += ARRIVE_STEP) {
      computeVehicle(L, vi, tick + k, VS2);
      const on = VS2.active;
      let at = false;
      if (on) {
        let ds = VS2.s - s0;
        if (L.loop && ds > half) ds -= L.length;
        else if (L.loop && ds < -half) ds += L.length;
        if (ds < AT_STOP && ds > -AT_STOP) at = true;
        else if (prevOn) {
          const step = VS2.s - prevS;
          if (step < half && step > -half && (prevS - s0) * (VS2.s - s0) <= 0) at = true;
        }
      }
      prevS = VS2.s;
      prevOn = on;
      if (!at) continue;
      computeVehicle(L, vi, tick + k + CATCH_AHEAD_TICKS, VS2);
      if (!VS2.active) continue;
      best = k;
      out.veh = vi;
      break;
    }
  }
  return best;
}

/**
 * Handrail run-ins: where a skater gets on. The top end of a sloping rail; both ends of a level one.
 * Flat array of (x, y, z, rail) quadruples.
 */
export function handrailRunIns(w: World): Float64Array {
  const out: number[] = [];
  for (const r of w.rails) {
    if (r.kind !== 'handrail') continue;
    const p = r.pts;
    const n = p.length;
    const y0 = p[1];
    const y1 = p[n - 2];
    if (Math.abs(y0 - y1) < 0.5 || y0 > y1) out.push(p[0], y0, p[2], r.index);
    if (Math.abs(y0 - y1) < 0.5 || y1 > y0) out.push(p[n - 3], y1, p[n - 1], r.index);
  }
  return Float64Array.from(out);
}

export class OnboardingReducer implements GameReducer {
  readonly key = 'onboarding';
  readonly state: OnboardingState;
  private readonly world: World;
  private readonly runIns: Float64Array;
  private readonly sites: StopSites;
  private readonly segs: Segment[][];
  private readonly slack: number[][];
  /** Ticks rolling on the ground so far (for the carve hint). */
  private groundTicks = 0;
  private carvedL = false;
  private carvedR = false;
  /** Releases the player made, counted toward the sling step. */
  private releases = 0;
  /** Closing tickets: ticks left on the current one. */
  private closing = 0;
  /** Ticks standing on flat ground without holding, and whether the roll hint's situation is on. */
  private standTicks = 0;
  private rollArmed = false;
  /** Last tick each step's situation held. */
  private readonly lastHeld: Record<OnboardingStep, number> = {
    carve: -1e9,
    hop: -1e9,
    grind: -1e9,
    hitch: -1e9,
    sling: -1e9,
    ink: -1e9,
    chain: -1e9,
    roll: -1e9,
  };
  // Cached scan results.
  private hopAhead = false;
  private runIn = -1;
  private readonly catchable = { line: -1, veh: -1, hop: false };
  /** The stop being led to: site index (-1 none), which spot, the ride and when it gets there. */
  private leadSite = -1;
  private leadSpot = 0;
  private leadLine = -1;
  private leadVeh = -1;
  private readonly arrive = { veh: -1 };
  /** Ticks until the ride reaches the stop, as the last leadWorks found it. */
  private leadEta = 0;
  /** The skater and the tick this step (for the pointer between scans). */
  private readonly lastPlayer = { x: 0, z: 0 };
  private lastTick = 0;
  /** A release with another line close: the chain hint holds until the chain ends. */
  private chainWindow = false;
  // The current hitch, for the ink hint's stop: arc positions like the progress reducer keeps.
  private hitched = false;
  private hLine = -1;
  private hVeh = -1;
  private prevS = 0;
  private startU = 0;
  private curU = 0;
  private runStart = 0;
  private runDir = 1;

  constructor(world: World) {
    this.world = world;
    this.runIns = handrailRunIns(world);
    this.sites = stopSites(world);
    this.segs = world.lines.map(lineSegments);
    this.slack = this.segs.map((ss) => ss.map(segmentSlack));
    this.state = {
      done: freshDone(),
      shown: '',
      complete: false,
      enabled: true,
      slingRetry: false,
      inkCatch: false,
      stopName: '',
      target: { kind: 'none', line: -1, veh: -1, rail: -1, x: 0, y: 0, z: 0, hop: false },
    };
  }

  /** May errands offer themselves? Yes with hints off, once the hitch is learnt, or when the lesson is over. */
  errandsOpen(): boolean {
    const st = this.state;
    return !st.enabled || st.complete || st.done.hitch;
  }

  setHints(on: boolean): void {
    this.state.enabled = on;
    if (!on) this.hide();
  }

  /** Mark everything learnt; nothing will show again. */
  skip(game: Game): void {
    const st = this.state;
    for (const s of ONBOARDING_STEPS) st.done[s] = true;
    this.hide();
    this.closing = 0;
    if (!st.complete) {
      st.complete = true;
      game.queueEvent({ type: 'onboardingComplete' });
    }
  }

  /** Start the lesson over (keeps the hints setting). */
  reset(): void {
    this.importState(undefined);
  }

  exportState(): OnboardingData {
    const done: OnboardingStep[] = [];
    for (const s of ONBOARDING_STEPS) if (this.state.done[s]) done.push(s);
    return { v: 1, done, complete: this.state.complete, releases: this.releases };
  }

  importState(data: unknown): void {
    const st = this.state;
    st.done = freshDone();
    st.complete = false;
    st.slingRetry = false;
    st.inkCatch = false;
    st.stopName = '';
    this.hide();
    this.groundTicks = 0;
    this.carvedL = false;
    this.carvedR = false;
    this.releases = 0;
    this.closing = 0;
    this.standTicks = 0;
    this.rollArmed = false;
    this.leadSite = -1;
    this.chainWindow = false;
    this.hitched = false;
    for (const s of ONBOARDING_STEPS) this.lastHeld[s] = -1e9;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.done)) {
      for (const s of d.done) if (typeof s === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(s)) st.done[s as OnboardingStep] = true;
    }
    const r = d.releases;
    if (typeof r === 'number' && Number.isInteger(r) && r >= 0 && r < 1e6) this.releases = r;
    st.slingRetry = !st.done.sling && this.releases > 0;
    // Complete only if the lesson really is: a junk flag cannot skip it.
    st.complete = d.complete === true && lessonDoneCount(st) === LESSON_STEPS.length;
  }

  step(game: Game): void {
    const st = this.state;
    const sim = game.sim;
    const p = sim.player;
    const tick = sim.tick;

    // 1. What the skater did this tick: steps count whether or not their hint was showing.
    if (p.mode === Mode.GROUND && p.speed > ROLLING_SPEED) this.groundTicks++;
    if (p.mode === Mode.GROUND) {
      if (p.steer > CARVE_STEER) this.carvedR = true;
      else if (p.steer < -CARVE_STEER) this.carvedL = true;
      if (this.carvedL && this.carvedR) this.finish(game, 'carve');
    }
    for (const e of sim.events) {
      switch (e.type) {
        case 'hop':
          this.finish(game, 'hop');
          break;
        case 'grindStart':
          this.finish(game, 'grind');
          break;
        case 'hitch':
          this.finish(game, 'hitch');
          if (e.chain >= 2) this.finish(game, 'chain');
          this.chainWindow = false;
          this.leadSite = -1;
          break;
        case 'release':
          this.onRelease(game, e.line, e.vehicle, e.speed);
          break;
        default:
          break;
      }
    }
    for (const e of game.events) if (e.type === 'segmentInked') this.finish(game, 'ink');
    if (p.chainAlive !== 1 || p.mode === Mode.HITCH) this.chainWindow = false;
    this.trackHitch(game);
    this.trackStand(game);

    // 2. The closing tickets, then complete. Their clock stands still while hints are suppressed.
    const suppressed = !st.enabled || game.chalk.mode !== 'idle' || game.errands.active !== null;
    if (!st.complete && lessonDoneCount(st) === LESSON_STEPS.length) {
      if (this.closing <= 0) this.closing = MAP_TICKS + LIFT_TICKS;
      if (suppressed) {
        this.hide();
        return;
      }
      this.closing--;
      if (this.closing <= 0) {
        st.complete = true;
        this.hide();
        game.events.push({ type: 'onboardingComplete' });
        return;
      }
      this.show(game, this.closing > LIFT_TICKS ? 'map' : 'lift');
      return;
    }
    if (suppressed || (st.complete && this.extrasDone())) {
      this.hide();
      return;
    }

    // 3. Which situations hold. Scans refresh every SCAN_EVERY ticks for the hints still to come.
    const d = st.done;
    const scan = tick % SCAN_EVERY === 0;
    const lesson = !st.complete;
    const ground = p.mode === Mode.GROUND;
    const rolling = ground && p.speed > ROLLING_SPEED;
    const free = ground || p.mode === Mode.AIR || p.mode === Mode.GRIND;
    if (lesson && !d.carve && rolling && this.groundTicks >= CARVE_SHOW_TICKS) this.lastHeld.carve = tick;
    if (d.carve && !d.hop) {
      if (scan) this.hopAhead = rolling && p.speed > 1 && this.scanAhead(p.x, p.y, p.z, p.heading, p.surface);
      if (this.hopAhead && rolling) this.lastHeld.hop = tick;
    }
    if (d.hop && !d.grind) {
      if (scan) this.runIn = ground || p.mode === Mode.AIR ? this.scanRunIn(p.x, p.y, p.z, p.vx, p.vz) : -1;
      if (this.runIn >= 0 && (ground || p.mode === Mode.AIR)) this.lastHeld.grind = tick;
    }
    // A ride to catch: for the hitch, and after the sling for the ink.
    const wantRide = lesson && free && ((d.carve && !d.hitch) || (d.hitch && !d.ink));
    if (wantRide) {
      if (scan) this.scanRides(game);
      this.followRide(game);
    } else {
      this.leadSite = -1;
      this.catchable.line = -1;
    }
    const ride = wantRide && this.rideKind() !== 'none';
    if (lesson && d.carve && !d.hitch && ride) this.lastHeld.hitch = tick;
    // On the first ride: stay on to the next stop first (the map fills), then drag and let go.
    if (lesson && d.hitch && !d.ink && (p.mode === Mode.HITCH || ride)) this.lastHeld.ink = tick;
    if (lesson && d.hitch && d.ink && !d.sling && p.mode === Mode.HITCH && p.hitchTime >= SLING_SHOW_TICKS * DT - 1e-9) this.lastHeld.sling = tick;
    if (d.sling && !d.chain && this.chainWindow) this.lastHeld.chain = tick;
    if (!d.roll && this.rollArmed) this.lastHeld.roll = tick;

    // 4. Pick: the highest-priority situation holding now; the hint already up stays while its
    // situation held within the linger unless something more urgent comes up.
    let want: HintId | '' = '';
    for (const s of PRIORITY) {
      if (!d[s] && this.lastHeld[s] === tick) {
        want = s;
        break;
      }
    }
    const cur = st.shown;
    if (cur !== '' && cur !== 'map' && cur !== 'lift' && !d[cur] && tick - this.lastHeld[cur] <= HINT_LINGER_TICKS) {
      if (want === '' || PRIORITY.indexOf(want as OnboardingStep) >= PRIORITY.indexOf(cur)) want = cur;
    }
    this.show(game, want);
    st.inkCatch = st.shown === 'ink' && p.mode !== Mode.HITCH;
    this.aim(st.shown, p.mode === Mode.HITCH);
    if (st.shown === 'ink') this.updateStopName(game);
  }

  // ------------------------------------------------------------------------------------------

  private extrasDone(): boolean {
    const d = this.state.done;
    return d.hop && d.grind && d.chain && d.roll;
  }

  private finish(game: Game, s: OnboardingStep): void {
    const st = this.state;
    if (st.done[s]) return;
    st.done[s] = true;
    if (s === 'sling') st.slingRetry = false;
    game.events.push({ type: 'hintDone', step: s });
    if (st.shown === s) this.hide();
  }

  private onRelease(game: Game, line: number, veh: number, speed: number): void {
    const st = this.state;
    const sim = game.sim;
    // Only the player's own release: a lifted finger or a flick, not the ride letting go of them.
    const byPlayer = !game.applied.hold || game.applied.hop;
    if (st.done.hitch && !st.done.sling && byPlayer) {
      const L = sim.world.lines[line];
      vehicleAt(L, veh, sim.tick, VS);
      const rideSpeed = len2(VS.vx, VS.vz);
      this.releases++;
      if (speed >= WHIP_RATIO * rideSpeed - 1e-9 || this.releases >= 2) this.finish(game, 'sling');
      else st.slingRetry = true;
    }
    // A chance at a chain: another line's ride close by as the skater flies off.
    if (st.done.sling && !st.done.chain) this.chainWindow = this.otherLineNear(game, line);
  }

  /** Standing on flat ground without holding: after ROLL_STAND_TICKS the roll hint's situation is on until they pump past ROLL_DONE_SPEED. */
  private trackStand(game: Game): void {
    const p = game.sim.player;
    const holding = game.applied.hold;
    if (this.rollArmed) {
      if (p.mode !== Mode.GROUND || holding) {
        this.rollArmed = false;
        this.standTicks = 0;
      } else if (p.speed > ROLL_DONE_SPEED) {
        this.rollArmed = false;
        this.standTicks = 0;
        this.finish(game, 'roll');
      }
      return;
    }
    if (this.state.done.roll || p.mode !== Mode.GROUND || holding || p.speed >= STAND_SPEED || this.atSpot(p.x, p.z)) {
      this.standTicks = 0;
      return;
    }
    sampleGround(this.world, p.x, p.y, p.z, FEEL.STEP_UP, GS);
    if (GS.gx * GS.gx + GS.gz * GS.gz > ROLL_FLAT * ROLL_FLAT) {
      this.standTicks = 0;
      return;
    }
    if (++this.standTicks >= ROLL_STAND_TICKS) this.rollArmed = true;
  }

  /** Waiting at the spot the pointer leads to (a skater waiting there is not stalled). */
  private atSpot(x: number, z: number): boolean {
    if (this.leadSite < 0) return false;
    const k = this.leadSite * 2 + this.leadSpot;
    const dx = this.sites.sx[k] - x;
    const dz = this.sites.sz[k] - z;
    return dx * dx + dz * dz < SPOT_NEAR * SPOT_NEAR;
  }

  /** Refresh the lead to a stop and the catchable ride near the skater (every SCAN_EVERY ticks). */
  private scanRides(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    const chain = p.chainAlive === 1 ? p.chain : 0;
    const allowHop = this.state.done.hitch;
    // Keep the stop being led to while it still works, with the looser keep limits.
    if (this.leadSite >= 0 && !this.leadWorks(this.leadSite, sim.tick, p.x, p.y, p.z, chain, LEAD_KEEP_NEAR, LEAD_KEEP_TICKS)) this.leadSite = -1;
    if (this.leadSite < 0) {
      let best = Infinity;
      const sp = len2(p.vx, p.vz);
      const S = this.sites;
      for (let i = 0; i < S.n; i++) {
        const dx = S.x[i] - p.x;
        const dz = S.z[i] - p.z;
        if (dx > LEAD_NEAR || dx < -LEAD_NEAR || dz > LEAD_NEAR || dz < -LEAD_NEAR) continue;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > LEAD_NEAR) continue;
        // On the skater's way: ahead of them when they are rolling, unless it is close.
        if (sp > LEAD_MOVING && dist > LEAD_CLOSE && (dx * p.vx + dz * p.vz) / (dist * sp) < LEAD_COS) continue;
        const spot = this.nearSpot(i, p.x, p.z);
        if (spot < 0) continue;
        if (!this.leadWorks(i, sim.tick, p.x, p.y, p.z, chain, LEAD_NEAR, LEAD_TICKS)) continue;
        const k = i * 2 + spot;
        const ds = Math.sqrt((S.sx[k] - p.x) * (S.sx[k] - p.x) + (S.sz[k] - p.z) * (S.sz[k] - p.z));
        const score = ds + this.leadEta / 60;
        if (score >= best) continue;
        best = score;
        this.leadSite = i;
        this.leadSpot = spot;
        this.leadLine = S.line[i];
        this.leadVeh = this.arrive.veh;
      }
    } else {
      this.leadVeh = this.arrive.veh;
    }
    if (this.leadSite < 0) findCatchable(this.world, sim.tick, p.x, p.y, p.z, chain, this.catchable, allowHop);
    else this.catchable.line = -1;
  }

  /** Whether site i can be led to from (x, y, z) now: near enough, no higher, a ride due in time. Sets leadEta and arrive.veh. */
  private leadWorks(i: number, tick: number, x: number, y: number, z: number, chain: number, near: number, ticks: number): boolean {
    const S = this.sites;
    const L = this.world.lines[S.line[i]];
    if (chain + 1 < L.minChainN) return false;
    if (S.y[i] > y + LEAD_ABOVE) return false;
    const dx = S.x[i] - x;
    const dz = S.z[i] - z;
    if (dx * dx + dz * dz > near * near) return false;
    const eta = rideToStop(L, S.s[i], tick, ticks, this.arrive);
    if (eta < 0) return false;
    this.leadEta = eta;
    return true;
  }

  /** The site's spot nearest to (x, z), or -1 if it has none. */
  private nearSpot(i: number, x: number, z: number): number {
    const S = this.sites;
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j;
      if (S.ok[k] === 0) continue;
      const d = (S.sx[k] - x) * (S.sx[k] - x) + (S.sz[k] - z) * (S.sz[k] - z);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  /** Every tick: drop rides gone out of service. */
  private followRide(game: Game): void {
    const tick = game.sim.tick;
    if (this.catchable.line >= 0) {
      vehicleAt(this.world.lines[this.catchable.line], this.catchable.veh, tick, VS);
      if (!VS.active) this.catchable.line = -1;
    }
  }

  /** What the ride pointer would be over now: the lead's ride when within HITCH_NEAR, else its spot, else a catchable ride. */
  private rideKind(): HintTargetKind {
    if (this.leadSite >= 0) {
      if (this.leadVeh >= 0) {
        const L = this.world.lines[this.leadLine];
        const p = this.lastPlayer;
        vehicleAt(L, this.leadVeh, this.lastTick, VS);
        if (VS.active) {
          grabPoint(L, VS, GP);
          const dx = GP.x - p.x;
          const dz = GP.z - p.z;
          if (dx * dx + dz * dz < HITCH_NEAR * HITCH_NEAR) return 'vehicle';
        }
      }
      return 'spot';
    }
    return this.catchable.line >= 0 ? 'vehicle' : 'none';
  }

  private otherLineNear(game: Game, line: number): boolean {
    const sim = game.sim;
    const p = sim.player;
    const w = sim.world;
    const r2 = CHAIN_NEAR * CHAIN_NEAR;
    const chainNow = p.chain;
    for (let li = 0; li < w.lines.length; li++) {
      if (li === line) continue;
      const L = w.lines[li];
      if (chainNow + 1 < L.minChainN) continue;
      const m = CHAIN_NEAR + L.anchorBack + 2;
      if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
      for (let vi = 0; vi < L.vehicles; vi++) {
        vehicleAt(L, vi, sim.tick, VS);
        if (!VS.active) continue;
        grabPoint(L, VS, GP);
        const dx = GP.x - p.x;
        const dz = GP.z - p.z;
        if (dx * dx + dz * dz < r2) return true;
      }
    }
    return false;
  }

  private show(game: Game, id: HintId | ''): void {
    const st = this.state;
    if (st.shown === id) return;
    st.shown = id;
    if (id !== '') game.events.push({ type: 'hintShow', step: id });
  }

  private hide(): void {
    this.state.shown = '';
    this.state.inkCatch = false;
    this.state.target.kind = 'none';
  }

  /** Point the world pointer at what the hint is about. */
  private aim(id: HintId | '', hitched: boolean): void {
    const t = this.state.target;
    t.hop = false;
    if (id === 'grind' && this.runIn >= 0) {
      const k = this.runIn * 4;
      t.kind = 'rail';
      t.x = this.runIns[k];
      t.y = this.runIns[k + 1];
      t.z = this.runIns[k + 2];
      t.rail = this.runIns[k + 3];
      t.line = -1;
      t.veh = -1;
      return;
    }
    if (id === 'hitch' || (id === 'ink' && !hitched)) {
      const kind = this.rideKind();
      t.rail = -1;
      if (kind === 'spot') {
        const k = this.leadSite * 2 + this.leadSpot;
        t.kind = 'spot';
        t.line = this.leadLine;
        t.veh = this.leadVeh;
        t.x = this.sites.sx[k];
        t.y = this.sites.sy[k];
        t.z = this.sites.sz[k];
        return;
      }
      if (kind === 'vehicle') {
        const line = this.leadSite >= 0 ? this.leadLine : this.catchable.line;
        const veh = this.leadSite >= 0 ? this.leadVeh : this.catchable.veh;
        const L = this.world.lines[line];
        vehicleAt(L, veh, this.lastTick, VS);
        grabPoint(L, VS, GP);
        t.kind = 'vehicle';
        t.line = line;
        t.veh = veh;
        t.x = GP.x;
        t.y = GP.y;
        t.z = GP.z;
        t.hop = this.leadSite < 0 && this.catchable.hop;
        return;
      }
    }
    t.kind = 'none';
  }

  /** A ledge, a stair top, a step up or a rail within HOP_AHEAD ahead. */
  private scanAhead(x: number, y: number, z: number, heading: number, surface: number): boolean {
    const w = this.world;
    const hx = dsin(heading);
    const hz = dcos(heading);
    let prev = topHeight(w, x, z);
    if (prev > y + 0.3) prev = y;
    const STEP = 1.5;
    const n = Math.floor(HOP_AHEAD / STEP + 1e-9);
    for (let i = 1; i <= n; i++) {
      const d = i * STEP;
      const sx = x + hx * d;
      const sz = z + hz * d;
      if (sx < w.minX || sx > w.maxX || sz < w.minZ || sz > w.maxZ) return false;
      const h = topHeight(w, sx, sz);
      const dh = h - prev;
      if (dh < -0.7 || (dh > 0.3 && dh < 1.5)) return true;
      if (surface !== Surface.STAIRS && terrainSurface(w, sx, sz) === Surface.STAIRS && h < y - 0.2) return true;
      if (i % 3 === 0) {
        nearestRail(w, sx, y, sz, 2.5, 2.5, 2.5, -1, RH);
        if (RH.hit) return true;
      }
      prev = h;
    }
    return false;
  }

  /** The nearest handrail run-in within GRIND_NEAR that the skater is heading toward, or -1. */
  private scanRunIn(x: number, y: number, z: number, vx: number, vz: number): number {
    const r = this.runIns;
    const sp = len2(vx, vz);
    let best = GRIND_NEAR;
    let found = -1;
    for (let k = 0; k < r.length; k += 4) {
      const dx = r[k] - x;
      if (dx > GRIND_NEAR || dx < -GRIND_NEAR) continue;
      const dz = r[k + 2] - z;
      if (dz > GRIND_NEAR || dz < -GRIND_NEAR) continue;
      const dy = r[k + 1] - y;
      if (dy > 3 || dy < -4) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= best) continue;
      // Heading for it (or already beside it).
      if (d > 3 && sp > 0.5 && dx * vx + dz * vz < 0) continue;
      best = d;
      found = k / 4;
    }
    return found;
  }

  /** Follow the current hitch's arc position, as the progress reducer does, for the ink hint. */
  private trackHitch(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    const st = this.state;
    this.lastPlayer.x = p.x;
    this.lastPlayer.z = p.z;
    this.lastTick = sim.tick;
    if (p.mode !== Mode.HITCH || st.done.ink || !st.done.hitch) {
      this.hitched = false;
      return;
    }
    const L = sim.world.lines[p.hLine];
    vehicleAt(L, p.hVeh, sim.tick, VS);
    if (!this.hitched || this.hLine !== p.hLine || this.hVeh !== p.hVeh) {
      this.hitched = true;
      this.hLine = p.hLine;
      this.hVeh = p.hVeh;
      this.prevS = VS.s;
      this.startU = VS.s;
      this.curU = VS.s;
      this.runStart = VS.s;
      this.runDir = VS.dir;
      return;
    }
    if (L.loop) {
      const len = L.length;
      let dS = VS.s - this.prevS;
      if (dS < -len * 0.5) dS += len;
      else if (dS > len * 0.5) dS -= len;
      this.curU += dS;
    } else if (VS.dir !== this.runDir) {
      this.runDir = VS.dir;
      this.runStart = this.prevS;
    }
    this.prevS = VS.s;
  }

  private updateStopName(game: Game): void {
    const st = this.state;
    if (!this.hitched) {
      st.stopName = '';
      return;
    }
    const L = game.sim.world.lines[this.hLine];
    const k = L.loop ? this.loopInkStop(L) : this.shuttleInkStop(L);
    st.stopName = k >= 0 ? L.allStops[k].name : '';
  }

  /** Stop index where a loop hitch inks its next segment. */
  private loopInkStop(L: CompiledLine): number {
    const segs = this.segs[L.index];
    const slack = this.slack[L.index];
    const len = L.length;
    let bestEnd = Infinity;
    let stop = -1;
    const m0 = Math.floor(this.startU / len) - 1;
    const m1 = Math.floor(this.curU / len) + 2;
    for (let m = m0; m <= m1; m++) {
      for (let i = 0; i < segs.length; i++) {
        const end = segs[i].s1 - slack[i] + m * len;
        if (end <= this.curU || end >= bestEnd) continue;
        if (this.startU > segs[i].s0 + slack[i] + m * len) continue;
        bestEnd = end;
        stop = segs[i].to;
      }
    }
    return stop;
  }

  /** Stop index where a shuttle hitch inks its next segment in the current direction. */
  private shuttleInkStop(L: CompiledLine): number {
    const segs = this.segs[L.index];
    const slack = this.slack[L.index];
    const s = this.prevS;
    if (this.runDir > 0) {
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].s1 - slack[i] > s && this.runStart <= segs[i].s0 + slack[i]) return segs[i].to;
      }
      // Nothing left this way: the first segment back once it turns at the end.
      return segs.length > 0 ? segs[segs.length - 1].from : -1;
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].s0 + slack[i] < s && this.runStart >= segs[i].s1 - slack[i]) return segs[i].from;
    }
    return segs.length > 0 ? segs[0].to : -1;
  }
}
