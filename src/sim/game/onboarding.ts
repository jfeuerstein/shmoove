/**
 * Onboarding: a first launch that teaches the game by play, one hint at a time, in the order the
 * hill presents things. Nothing blocks: a hint shows while its situation holds (and a moment after,
 * so it does not flicker) and comes back the next time the situation does.
 *
 * | step  | shows when                                                         | done when                        |
 * | carve | rolling on the ground for 1 s                                      | steer past ±0.4 both ways        |
 * | hop   | rolling at a ledge, stair top or rail within 12 m ahead (after carve) | a hop                         |
 * | grind | within 8 m of a handrail's run-in, rolling or airborne (after hop)  | a grind starts                   |
 * | hitch | a catchable ride within 30 m and coming, or standing within 20 m (after carve) | a hitch            |
 * | sling | hitched for 1.5 s (after hitch)                                    | a whip release (or a 2nd release)|
 * | ink   | hitched (after sling)                                              | a segment inked                  |
 * | chain | released with another line's ride within 25 m (after sling)        | a hitch as the 2nd link or more  |
 *
 * A step counts whenever its condition happens, even before its hint has shown: someone who already
 * knows how to hop has nothing to learn there. Once the six lesson steps are done, two closing
 * tickets follow ('map': where the map is; 'lift': no pushing, everything that moves is a lift) and
 * the lesson is complete. The chain is taught later and is not part of completion, so it is the one
 * hint that can still show after it.
 *
 * Nothing shows with the hints setting off, during a chalk recording or race, or during an errand.
 * Until the hitch step is done (and while the lesson runs with hints on) errands do not offer
 * themselves: a new player's first sight should not be an offer asking them to hold still before
 * they know what holding does (`Game.errandsOpen`).
 *
 * World scans (rides near the skater, ledges ahead, handrail run-ins) run every SCAN_EVERY ticks,
 * only for the hints that could show, with bounding-box rejects and no allocation.
 */
import { DT, FEEL } from '../constants';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine } from '../lines';
import { dcos, dsin, len2 } from '../math';
import { Mode } from '../types';
import { Surface, makeRailHit, nearestRail, terrainSurface, topHeight, type World } from '../world';
import type { Game, GameReducer } from './game';
import { lineSegments, segmentSlack, type Segment } from './progress';

/** The six things the lesson teaches, in order. */
export const LESSON_STEPS = ['carve', 'hop', 'grind', 'hitch', 'sling', 'ink'] as const;
export type LessonStep = (typeof LESSON_STEPS)[number];
/** Every step with a hint: the lesson plus the chain, taught later. */
export type OnboardingStep = LessonStep | 'chain';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [...LESSON_STEPS, 'chain'];
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
/** A moving ride this close and coming prompts the hitch hint, metres. */
export const HITCH_NEAR = 30;
/** A ride standing at a stop this close prompts it, metres. */
export const HITCH_STOP_NEAR = 20;
/** A moving ride must pass this close sideways to count as coming at the skater, metres. */
export const HITCH_LATERAL = 10;
/** A ride's ground may be this far above or below the skater and still be pointed at, metres. */
export const LEVEL_DY = 4;
/** A ride must stay in service this long to be pointed at (2 s). */
export const CATCH_AHEAD_TICKS = 120;
/** Hitched this long, the sling hint shows (1.5 s). */
export const SLING_SHOW_TICKS = 90;
/** A release whose exit speed is at least this times the ride's speed is a whip. */
export const WHIP_RATIO = 1.15;
/** Another line's ride this close at a release introduces the chain, metres. */
export const CHAIN_NEAR = 25;
/** World scans run every this many ticks. */
export const SCAN_EVERY = 10;
/** A hint stays this long after its situation stops holding (0.75 s). */
export const HINT_LINGER_TICKS = 45;
/** The map pointer shows this long once the six steps are done (4 s). */
export const MAP_TICKS = 240;
/** The last ticket shows this long, then the lesson is complete (5 s). */
export const LIFT_TICKS = 300;

/** Display priority, highest first: a fleeting chance beats one that comes back. */
const PRIORITY: readonly OnboardingStep[] = ['sling', 'ink', 'hitch', 'grind', 'hop', 'chain', 'carve'];

export type HintTargetKind = 'none' | 'rail' | 'vehicle';

/** What the world pointer is over. Rails: the run-in point. Vehicles: line and vehicle (the renderer finds the grab point). */
export interface HintTarget {
  kind: HintTargetKind;
  line: number;
  veh: number;
  rail: number;
  x: number;
  y: number;
  z: number;
}

export interface OnboardingState {
  done: Record<OnboardingStep, boolean>;
  /** The hint showing now, or ''. */
  shown: HintId | '';
  /** The six steps and the closing tickets are done. */
  complete: boolean;
  /** The hints setting. Off: nothing shows and errands are open. Not saved (settings are). */
  enabled: boolean;
  /** The sling hint asks for a real whip: the last release was a plain one. */
  slingRetry: boolean;
  /** The ink hint: the stop where the current hitch will ink its first segment ('' if unknown). */
  stopName: string;
  /** What the world pointer is over while `shown` is 'grind' or 'hitch'. */
  readonly target: HintTarget;
}

export interface OnboardingData {
  v: 1;
  done: OnboardingStep[];
  complete: boolean;
  releases: number;
}

function freshDone(): Record<OnboardingStep, boolean> {
  return { carve: false, hop: false, grind: false, hitch: false, sling: false, ink: false, chain: false };
}

/** Count of done lesson steps (the chain is not one). */
export function lessonDoneCount(st: Pick<OnboardingState, 'done'>): number {
  let n = 0;
  for (const s of LESSON_STEPS) if (st.done[s]) n++;
  return n;
}

const VS = makeVehicleState();
const VS2 = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };
const RH = makeRailHit();

/**
 * The best ride to point at for a skater at (x, y, z) with `chain` links alive, at `tick`: a ride
 * tryHitch would accept (in service now and for CATCH_AHEAD_TICKS more, not gated above the next
 * link, its grab point within vertical reach of the ground under it, or a hop's reach for a strap,
 * that ground within LEVEL_DY of the skater's height) that is standing within
 * HITCH_STOP_NEAR or moving within HITCH_NEAR toward the skater and passing within HITCH_LATERAL.
 * Writes the line and vehicle into `out` (line -1 when none). Pure.
 */
export function findCatchable(
  w: World,
  tick: number,
  x: number,
  y: number,
  z: number,
  chain: number,
  out: { line: number; veh: number },
): void {
  out.line = -1;
  out.veh = -1;
  const reachY = FEEL.HITCH_REACH_Y;
  // A standing hop's height, with a margin: what a skater on the ground can add to their reach.
  const hopUp = (0.6 * FEEL.HOP_V * FEEL.HOP_V) / (2 * FEEL.GRAVITY);
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
      if (dy < -reachY || dy > (L.overhead ? reachY + hopUp : reachY)) continue;
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
    }
  }
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
  private readonly segs: Segment[][];
  private readonly slack: number[][];
  /** Ticks rolling on the ground so far (for the carve hint). */
  private groundTicks = 0;
  private carvedL = false;
  private carvedR = false;
  /** Releases counted toward the sling step. */
  private releases = 0;
  /** Closing tickets: ticks left on the current one. */
  private closing = 0;
  /** Last tick each step's situation held. */
  private readonly lastHeld: Record<OnboardingStep, number> = {
    carve: -1e9,
    hop: -1e9,
    grind: -1e9,
    hitch: -1e9,
    sling: -1e9,
    ink: -1e9,
    chain: -1e9,
  };
  // Cached scan results.
  private hopAhead = false;
  private runIn = -1;
  private readonly catchable = { line: -1, veh: -1 };
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
    this.segs = world.lines.map(lineSegments);
    this.slack = this.segs.map((ss) => ss.map(segmentSlack));
    this.state = {
      done: freshDone(),
      shown: '',
      complete: false,
      enabled: true,
      slingRetry: false,
      stopName: '',
      target: { kind: 'none', line: -1, veh: -1, rail: -1, x: 0, y: 0, z: 0 },
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
    st.stopName = '';
    this.hide();
    this.groundTicks = 0;
    this.carvedL = false;
    this.carvedR = false;
    this.releases = 0;
    this.closing = 0;
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
    if (suppressed || (st.complete && st.done.chain)) {
      this.hide();
      return;
    }

    // 3. Which situations hold. Scans refresh every SCAN_EVERY ticks for the hints still to come.
    const d = st.done;
    const scan = tick % SCAN_EVERY === 0;
    const lesson = !st.complete;
    const ground = p.mode === Mode.GROUND;
    const rolling = ground && p.speed > ROLLING_SPEED;
    if (lesson && !d.carve && rolling && this.groundTicks >= CARVE_SHOW_TICKS) this.lastHeld.carve = tick;
    if (lesson && d.carve && !d.hop) {
      if (scan) this.hopAhead = rolling && p.speed > 1 && this.scanAhead(p.x, p.y, p.z, p.heading, p.surface);
      if (this.hopAhead && rolling) this.lastHeld.hop = tick;
    }
    if (lesson && d.hop && !d.grind) {
      if (scan) this.runIn = ground || p.mode === Mode.AIR ? this.scanRunIn(p.x, p.y, p.z, p.vx, p.vz) : -1;
      if (this.runIn >= 0 && (ground || p.mode === Mode.AIR)) this.lastHeld.grind = tick;
    }
    if (lesson && d.carve && !d.hitch) {
      const free = p.mode === Mode.GROUND || p.mode === Mode.AIR || p.mode === Mode.GRIND;
      if (scan) {
        if (free) findCatchable(this.world, tick, p.x, p.y, p.z, p.chainAlive === 1 ? p.chain : 0, this.catchable);
        else this.catchable.line = -1;
      }
      if (free && this.catchable.line >= 0) this.lastHeld.hitch = tick;
    }
    if (lesson && d.hitch && !d.sling && p.mode === Mode.HITCH && p.hitchTime >= SLING_SHOW_TICKS * DT - 1e-9) this.lastHeld.sling = tick;
    if (lesson && d.sling && !d.ink && p.mode === Mode.HITCH) this.lastHeld.ink = tick;
    if (d.sling && !d.chain && this.chainWindow) this.lastHeld.chain = tick;

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
    this.aim(st.shown);
    if (st.shown === 'ink') this.updateStopName(game);
  }

  // ------------------------------------------------------------------------------------------

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
    if (st.done.hitch && !st.done.sling) {
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
    if (id !== 'grind' && id !== 'hitch') st.target.kind = 'none';
  }

  private hide(): void {
    this.state.shown = '';
    this.state.target.kind = 'none';
  }

  /** Point the world pointer at what the hint is about. */
  private aim(id: HintId | ''): void {
    const t = this.state.target;
    if (id === 'grind' && this.runIn >= 0) {
      const k = this.runIn * 4;
      t.kind = 'rail';
      t.x = this.runIns[k];
      t.y = this.runIns[k + 1];
      t.z = this.runIns[k + 2];
      t.rail = this.runIns[k + 3];
      t.line = -1;
      t.veh = -1;
    } else if (id === 'hitch' && this.catchable.line >= 0) {
      t.kind = 'vehicle';
      t.line = this.catchable.line;
      t.veh = this.catchable.veh;
      t.rail = -1;
    } else t.kind = 'none';
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
    if (p.mode !== Mode.HITCH || st.done.ink || !st.done.sling) {
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
