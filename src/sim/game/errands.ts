/**
 * Errands: short timed jobs offered by characters standing in named zones of the city.
 *
 * An errand is data (`ErrandDef`, the city's list is in `content/errands.ts`): a giver zone, a time
 * limit and an ordered list of steps, each a small pure check over the skater and the sim's events.
 * There are no buttons in play, so an errand is taken by the one extra verb the game has: hold
 * still. Inside the giver's zone, on the board, slower than OFFER_MAX_SPEED, not hitched and with
 * the touch armed while no ride is in reach, the offer fills over OFFER_FILL_TICKS and starts.
 * Releasing the touch empties it; rolling out of the zone withdraws it. One errand at a time.
 *
 * Steps are checked in order, one completion per tick at most. The errand is done when the last
 * step completes inside the limit; it fails when the limit runs out or a step's modifier fires
 * (`noBail`: a bail; `noGround`: more ground time than allowed since the step began).
 *
 * Saves keep finished errands and best times; an errand in progress is not resumed.
 */
import { DT, FEEL } from '../constants';
import { grabPoint, inWindows, makeVehicleState } from '../lines';
import { vehicleAt } from '../lines';
import { len2 } from '../math';
import { Mode, type PlayerState, type SimCtx } from '../types';
import type { District, World, Zone } from '../world';
import type { CommandResult } from './chalk';
import type { Game, GameReducer } from './game';

// ---------------------------------------------------------------------------------------------
// Data

/** Modifiers any step may carry. */
export interface StepMods {
  /** A bail while this step is current fails the errand. */
  noBail?: boolean;
  /** At most this many seconds on the ground (rolling) between the step starting and completing. */
  noGround?: number;
}

export type StepDef = StepMods &
  (
    | { kind: 'reach'; zone: string }
    | { kind: 'hitch'; line: string }
    | { kind: 'rideTo'; line: string; zone: string }
    | { kind: 'deliver'; zone: string; maxSpeed?: number }
    /** `at`: where the beacon points (a meeting spot); not part of the check. */
    | { kind: 'chain'; links: number; at?: string }
    | { kind: 'grind'; metres: number; at?: string }
    | { kind: 'air'; seconds: number; at?: string }
  );

export type StepKind = StepDef['kind'];

export interface ErrandDef {
  id: string;
  /** A few words, shown on tickets. */
  title: string;
  /** Zone id where the giver stands and the offer is made. */
  giver: string;
  district: District;
  /** One line, under 60 characters. */
  brief: string;
  /** 2 to 4 minutes. */
  limitTicks: number;
  steps: StepDef[];
  /** Day fractions [from, to) when the giver offers it (to < from wraps past midnight). Omitted: all day. */
  hours?: readonly [number, number];
}

export type ErrandFailReason = 'time' | 'bail' | 'ground' | 'abandon';

/** Zone membership: plan distance under the zone's radius and height within this. */
export const ZONE_DY = 4;
/** `rideTo` allows more height: a rider hangs metres under a cable car or a crane hook. */
export const RIDE_ZONE_DY = 12;
/** A `rideTo` still counts this long after letting go of the line. */
export const RIDE_GRACE_TICKS = 3 * 60;
/** Longest believable move along a rail in one tick, metres (60 m/s). */
const MAX_GRIND_STEP = 1;
/** Offers fill only below this speed, m/s. */
export const OFFER_MAX_SPEED = 4;
/** Hold time that takes an offer: 0.6 s. */
export const OFFER_FILL_TICKS = 36;

export function inZone(z: Zone, x: number, y: number, zz: number, dy = ZONE_DY): boolean {
  const dx = x - z.x;
  const dz = zz - z.z;
  return dx * dx + dz * dz < z.r * z.r && Math.abs(y - z.y) < dy;
}

/** Is the day fraction inside an errand's hours (all day when it has none)? */
export function errandOpen(def: Pick<ErrandDef, 'hours'>, dayFrac: number): boolean {
  if (!def.hours) return true;
  return inWindows([def.hours], dayFrac);
}

const VS = makeVehicleState();
const GP = { x: 0, y: 0, z: 0 };

/**
 * Is any active ride's grab point within a hand's reach (a little more than the hitch reach)? Then
 * an armed touch is for the ride, not for an errand.
 */
export function rideInReach(ctx: SimCtx): boolean {
  const p = ctx.player;
  const w = ctx.world;
  const R = FEEL.HITCH_REACH + 1;
  const Ry = FEEL.HITCH_REACH_Y + 1;
  const handY = p.y + FEEL.HAND_HEIGHT;
  for (const L of w.lines) {
    const m = R + L.anchorBack + 1;
    if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
    for (let vi = 0; vi < L.vehicles; vi++) {
      vehicleAt(L, vi, ctx.tick, VS);
      if (!VS.active) continue;
      grabPoint(L, VS, GP);
      const dx = p.x - GP.x;
      const dy = handY - GP.y;
      const dz = p.z - GP.z;
      if ((dx * dx + dz * dz) / (R * R) + (dy * dy) / (Ry * Ry) < 1) return true;
    }
  }
  return false;
}

/** Horizontal speed of the skater, m/s. */
export function planSpeed(p: PlayerState): number {
  return len2(p.vx, p.vz);
}

// ---------------------------------------------------------------------------------------------
// State

export interface ActiveErrand {
  id: string;
  /** Index of the current step. */
  step: number;
  ticksLeft: number;
  /** Ticks since the errand started. */
  ticks: number;
  /** Progress of the current step toward `goal` (metres, links, seconds), 0 when it has none. */
  progress: number;
  goal: number;
}

/** What the UI and renderer read. Written by the errands reducer only. */
export interface ErrandState {
  /** The errand on offer here, or null. */
  offered: string | null;
  /** 0..1 */
  offerFill: number;
  active: ActiveErrand | null;
  done: Record<string, { bestTicks: number }>;
  failedLast: { id: string; reason: ErrandFailReason } | null;
  /** Errands with every zone and line present in this world, in content order. */
  readonly list: readonly ErrandDef[];
}

export interface ErrandData {
  v: 1;
  done: Record<string, number>;
}

/** A step with its zone and line looked up. */
interface ResolvedStep {
  def: StepDef;
  zone: Zone | null;
  line: number;
}

interface Resolved {
  def: ErrandDef;
  giver: Zone;
  steps: ResolvedStep[];
}

function zoneOf(w: World, id: string): Zone | null {
  for (const z of w.zones) if (z.id === id) return z;
  return null;
}

function lineOf(w: World, id: string): number {
  for (let i = 0; i < w.lines.length; i++) if (w.lines[i].id === id) return i;
  return -1;
}

/** Look up an errand's zones and lines; null if any is missing from this world. */
function resolve(w: World, def: ErrandDef): Resolved | null {
  const giver = zoneOf(w, def.giver);
  if (!giver || def.steps.length === 0) return null;
  const steps: ResolvedStep[] = [];
  for (const s of def.steps) {
    let zone: Zone | null = null;
    let line = -1;
    if (s.kind === 'reach' || s.kind === 'deliver' || s.kind === 'rideTo') {
      zone = zoneOf(w, s.zone);
      if (!zone) return null;
    }
    if (s.kind === 'chain' || s.kind === 'grind' || s.kind === 'air') {
      if (s.at !== undefined) {
        zone = zoneOf(w, s.at);
        if (!zone) return null;
      }
    }
    if (s.kind === 'hitch' || s.kind === 'rideTo') {
      line = lineOf(w, s.line);
      if (line < 0) return null;
    }
    steps.push({ def: s, zone, line });
  }
  return { def, giver, steps };
}

/** The goal figure of a step (for progress), or 0. */
export function stepGoal(s: StepDef): number {
  switch (s.kind) {
    case 'chain':
      return s.links;
    case 'grind':
      return s.metres;
    case 'air':
      return s.seconds;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Reducer

export class ErrandsReducer implements GameReducer {
  readonly key = 'errands';
  readonly state: ErrandState;
  private readonly resolved: Resolved[];
  private readonly byId = new Map<string, Resolved>();
  private cur: Resolved | null = null;
  /** The touch must lift before another offer can fill (after a start or an end). */
  private needLift = false;
  // Per-step counters.
  private ground = 0;
  private grindM = 0;
  private airRun = 0;
  private airBest = 0;
  private relLine = -1;
  private relTick = -1e9;
  private px = 0;
  private py = 0;
  private pz = 0;
  private wasGrind = false;

  constructor(world: World, defs: readonly ErrandDef[]) {
    this.resolved = [];
    for (const d of defs) {
      if (this.byId.has(d.id)) continue;
      const r = resolve(world, d);
      if (!r) continue;
      this.resolved.push(r);
      this.byId.set(d.id, r);
    }
    this.state = {
      offered: null,
      offerFill: 0,
      active: null,
      done: {},
      failedLast: null,
      list: this.resolved.map((r) => r.def),
    };
  }

  /** The zone a step targets (or its `at` hint), for the beacon; null for plain hitch steps. */
  stepZone(id: string, step: number): Zone | null {
    const r = this.byId.get(id);
    if (!r || step < 0 || step >= r.steps.length) return null;
    return r.steps[step].zone;
  }

  /** The giver zone of an errand. */
  giverZone(id: string): Zone | null {
    return this.byId.get(id)?.giver ?? null;
  }

  abandon(game: Game): CommandResult {
    const a = this.state.active;
    if (!a) return { ok: false, reason: 'No errand' };
    this.end(game, a.id, 'abandon', true);
    return { ok: true };
  }

  exportState(): ErrandData {
    const done: Record<string, number> = {};
    for (const k of Object.keys(this.state.done)) done[k] = this.state.done[k].bestTicks;
    return { v: 1, done };
  }

  importState(data: unknown): void {
    const st = this.state;
    st.done = {};
    st.active = null;
    st.offered = null;
    st.offerFill = 0;
    st.failedLast = null;
    this.cur = null;
    if (typeof data !== 'object' || data === null) return;
    const done = (data as { done?: unknown }).done;
    if (typeof done !== 'object' || done === null || Array.isArray(done)) return;
    for (const k of Object.keys(done)) {
      const v = (done as Record<string, unknown>)[k];
      if (!this.byId.has(k)) continue;
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0 || v > 1e7) continue;
      st.done[k] = { bestTicks: v };
    }
  }

  step(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    if (this.state.active && this.cur) this.stepActive(game, this.cur, this.state.active);
    else this.stepOffer(game);
    if (!game.applied.hold) this.needLift = false;
    this.px = p.x;
    this.py = p.y;
    this.pz = p.z;
    this.wasGrind = p.mode === Mode.GRIND;
  }

  // ------------------------------------------------------------------------------------------

  private stepOffer(game: Game): void {
    const st = this.state;
    const sim = game.sim;
    const p = sim.player;
    let here: Resolved | null = null;
    if (p.mode !== Mode.HITCH && p.mode !== Mode.BAIL) {
      const f = sim.dayFrac;
      for (const r of this.resolved) {
        if (!errandOpen(r.def, f)) continue;
        if (inZone(r.giver, p.x, p.y, p.z)) {
          here = r;
          break;
        }
      }
    }
    const id = here ? here.def.id : null;
    if (id !== st.offered) {
      st.offered = id;
      st.offerFill = 0;
      if (id !== null) game.events.push({ type: 'errandOffer', id });
    }
    if (!here) return;
    const holding = game.applied.hold && !this.needLift;
    if (holding && p.mode !== Mode.AIR && planSpeed(p) < OFFER_MAX_SPEED && !rideInReach(sim)) {
      st.offerFill = Math.min(1, st.offerFill + 1 / OFFER_FILL_TICKS);
      if (st.offerFill >= 1 - 1e-9) this.start(game, here);
    } else st.offerFill = 0;
  }

  private start(game: Game, r: Resolved): void {
    const st = this.state;
    st.offered = null;
    st.offerFill = 0;
    st.failedLast = null;
    this.cur = r;
    st.active = { id: r.def.id, step: 0, ticksLeft: r.def.limitTicks, ticks: 0, progress: 0, goal: stepGoal(r.steps[0].def) };
    this.resetCounters();
    this.needLift = true;
    game.events.push({ type: 'errandStart', id: r.def.id });
  }

  private resetCounters(): void {
    this.ground = 0;
    this.grindM = 0;
    this.airRun = 0;
    this.airBest = 0;
  }

  private stepActive(game: Game, r: Resolved, a: ActiveErrand): void {
    const sim = game.sim;
    const p = sim.player;
    a.ticks++;
    a.ticksLeft--;
    const s = r.steps[a.step];
    const d = s.def;
    let bailed = false;
    for (const e of sim.events) {
      if (e.type === 'bail') bailed = true;
      else if (e.type === 'release') {
        this.relLine = e.line;
        this.relTick = sim.tick;
      }
    }
    // Counters since the step began.
    if (p.mode === Mode.GROUND) this.ground += DT;
    if (p.mode === Mode.GRIND && this.wasGrind) {
      const dx = p.x - this.px;
      const dy = p.y - this.py;
      const dz = p.z - this.pz;
      // A step along a rail is well under a metre; anything longer is a teleport, not grinding.
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < MAX_GRIND_STEP) this.grindM += d;
    }
    if (p.mode === Mode.AIR) {
      this.airRun += DT;
      if (this.airRun > this.airBest) this.airBest = this.airRun;
    } else this.airRun = 0;

    if (bailed && d.noBail === true) {
      this.end(game, a.id, 'bail', false);
      return;
    }
    a.progress = this.progressOf(d, p);
    if (this.complete(s, sim, p)) {
      game.events.push({ type: 'errandStep', id: a.id, step: a.step });
      a.step++;
      this.resetCounters();
      if (a.step >= r.steps.length) {
        this.finish(game, r, a);
        return;
      }
      a.goal = stepGoal(r.steps[a.step].def);
      a.progress = 0;
      return;
    }
    if (d.noGround !== undefined && this.ground > d.noGround) {
      this.end(game, a.id, 'ground', false);
      return;
    }
    if (a.ticksLeft <= 0) this.end(game, a.id, 'time', false);
  }

  private progressOf(d: StepDef, p: PlayerState): number {
    switch (d.kind) {
      case 'chain':
        return p.mode === Mode.HITCH || p.chainAlive === 1 ? p.chain : 0;
      case 'grind':
        return this.grindM;
      case 'air':
        return this.airBest;
      default:
        return 0;
    }
  }

  private complete(s: ResolvedStep, sim: SimCtx, p: PlayerState): boolean {
    const d = s.def;
    const z = s.zone;
    switch (d.kind) {
      case 'reach':
        return z !== null && inZone(z, p.x, p.y, p.z);
      case 'hitch':
        return p.mode === Mode.HITCH && p.hLine === s.line;
      case 'rideTo': {
        if (!z || !inZone(z, p.x, p.y, p.z, RIDE_ZONE_DY)) return false;
        if (p.mode === Mode.HITCH) return p.hLine === s.line;
        return this.relLine === s.line && sim.tick - this.relTick <= RIDE_GRACE_TICKS;
      }
      case 'deliver':
        if (!z || p.mode !== Mode.GROUND || !inZone(z, p.x, p.y, p.z)) return false;
        return d.maxSpeed === undefined || planSpeed(p) < d.maxSpeed;
      case 'chain':
        return (p.mode === Mode.HITCH || p.chainAlive === 1) && p.chain >= d.links;
      case 'grind':
        return this.grindM >= d.metres;
      case 'air':
        return this.airBest >= d.seconds;
    }
  }

  private finish(game: Game, r: Resolved, a: ActiveErrand): void {
    const st = this.state;
    const prev = st.done[a.id];
    const best = !prev || a.ticks < prev.bestTicks;
    if (best) st.done[a.id] = { bestTicks: a.ticks };
    game.events.push({ type: 'errandDone', id: r.def.id, ticks: a.ticks, best });
    st.active = null;
    this.cur = null;
    this.needLift = true;
  }

  private end(game: Game, id: string, reason: ErrandFailReason, queued: boolean): void {
    const st = this.state;
    st.active = null;
    this.cur = null;
    st.failedLast = { id, reason };
    this.needLift = true;
    const e = { type: 'errandFail' as const, id, reason };
    if (queued) game.queueEvent(e);
    else game.events.push(e);
  }
}
