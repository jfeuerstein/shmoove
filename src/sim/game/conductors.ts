/**
 * Conductor challenges: one per regular line. Each line's conductor stands at one of its stops;
 * hitching that line within CONDUCTOR_START_RADIUS of that stop starts the line's challenge (unless
 * it is already punched or another challenge is running). The challenge fails silently, and can be
 * retried by hitching there again, as soon as it can no longer be met: the chain ends, the skater
 * lands or bails, lets go somewhere else, or a time limit passes. A punched line never restarts.
 *
 * The city's conductors are in `content/conductors.ts`.
 */
import { DT } from '../constants';
import { makeVehicleState, pathAt, vehicleAt } from '../lines';
import { len2 } from '../math';
import { Mode, type PlayerState } from '../types';
import type { World, Zone } from '../world';
import { ZONE_DY, inZone } from './errands';
import type { Game, GameReducer } from './game';

export type ConductorTask =
  /** A chain of N links in the chain that starts with this hitch. */
  | { kind: 'chainFrom'; links: number }
  /** From letting go of this ride to the first touch down, at least this plan distance. */
  | { kind: 'slingDistance'; metres: number }
  /** From letting go of this ride to the first touch down, at least this long in the air. */
  | { kind: 'slingAir'; seconds: number }
  /** Stay on one vehicle of the line through N stops. */
  | { kind: 'stayOn'; segments: number }
  /** Let go inside stop `from`'s zone, reach stop `to`'s zone under your own momentum in time. */
  | { kind: 'stopToStop'; from: number; to: number; seconds: number }
  /** After letting go of this ride, the next touch down is inside the zone. */
  | { kind: 'landOn'; zone: string };

export type ConductorKind = ConductorTask['kind'];

export interface ConductorDef {
  /** Line id. */
  line: string;
  /** Index into the line's `allStops` where the conductor stands. */
  stop: number;
  task: ConductorTask;
}

/** Hitching within this plan distance of the conductor's stop starts the challenge, metres. */
export const CONDUCTOR_START_RADIUS = 30;

/** The zone id of a line's stop (the city names them `stop_<line>_<n>`). */
export function stopZoneId(line: string, stop: number): string {
  return `stop_${line}_${stop}`;
}

export interface ActiveChallenge {
  /** Line index. */
  line: number;
  kind: ConductorKind;
  /** Progress toward `goal`: links, metres, seconds, stops. */
  progress: number;
  goal: number;
}

/** What the UI and renderer read. Written by the conductors reducer only. */
export interface ConductorState {
  active: ActiveChallenge | null;
  punched: Record<string, true>;
  /** Conductors whose line, stop and zones exist in this world, in content order. */
  readonly list: readonly ConductorDef[];
}

export interface ConductorData {
  v: 1;
  punched: string[];
}

interface Resolved {
  def: ConductorDef;
  line: number;
  /** Where the conductor stands (the stop on the line's path). */
  x: number;
  y: number;
  z: number;
  /** stopToStop: the two stop zones; landOn: the target in `to`. */
  from: Zone | null;
  to: Zone | null;
}

function zoneOf(w: World, id: string): Zone | null {
  for (const z of w.zones) if (z.id === id) return z;
  return null;
}

/** The goal figure of a task. */
export function taskGoal(t: ConductorTask): number {
  switch (t.kind) {
    case 'chainFrom':
      return t.links;
    case 'slingDistance':
      return t.metres;
    case 'slingAir':
      return t.seconds;
    case 'stayOn':
      return t.segments;
    case 'stopToStop':
      return t.seconds;
    case 'landOn':
      return 0;
  }
}

type Phase = 'riding' | 'flying' | 'rolling';

const VS = makeVehicleState();
const PA = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };

export class ConductorsReducer implements GameReducer {
  readonly key = 'conductors';
  readonly state: ConductorState;
  private readonly resolved: Resolved[];
  private readonly byLine: (Resolved | null)[];
  private cur: Resolved | null = null;
  private phase: Phase = 'riding';
  private baseChain = 0;
  private veh = -1;
  private lastStop = -1;
  private t = 0;
  private rx = 0;
  private rz = 0;

  constructor(world: World, defs: readonly ConductorDef[]) {
    this.resolved = [];
    this.byLine = world.lines.map(() => null);
    for (const d of defs) {
      const li = world.lines.findIndex((l) => l.id === d.line);
      if (li < 0 || this.byLine[li]) continue;
      const L = world.lines[li];
      if (d.stop < 0 || d.stop >= L.allStops.length) continue;
      let from: Zone | null = null;
      let to: Zone | null = null;
      if (d.task.kind === 'stopToStop') {
        from = zoneOf(world, stopZoneId(d.line, d.task.from));
        to = zoneOf(world, stopZoneId(d.line, d.task.to));
        if (!from || !to) continue;
      } else if (d.task.kind === 'landOn') {
        to = zoneOf(world, d.task.zone);
        if (!to) continue;
      }
      pathAt(L, L.allStops[d.stop].s, PA);
      const r: Resolved = { def: d, line: li, x: PA.x, y: PA.y, z: PA.z, from, to };
      this.resolved.push(r);
      this.byLine[li] = r;
    }
    this.state = { active: null, punched: {}, list: this.resolved.map((r) => r.def) };
  }

  /** Where a line's conductor stands, or null if it has none here. */
  conductorAt(lineIndex: number): { x: number; y: number; z: number } | null {
    const r = this.byLine[lineIndex];
    return r ? { x: r.x, y: r.y, z: r.z } : null;
  }

  exportState(): ConductorData {
    return { v: 1, punched: Object.keys(this.state.punched) };
  }

  importState(data: unknown): void {
    const st = this.state;
    st.punched = {};
    st.active = null;
    this.cur = null;
    if (typeof data !== 'object' || data === null) return;
    const list = (data as { punched?: unknown }).punched;
    if (!Array.isArray(list)) return;
    for (const id of list) {
      if (typeof id !== 'string') continue;
      if (this.resolved.some((r) => r.def.line === id)) st.punched[id] = true;
    }
  }

  step(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    let hitchLine = -1;
    let hitchChain = 0;
    let released = false;
    let bailed = false;
    for (const e of sim.events) {
      if (e.type === 'hitch') {
        hitchLine = e.line;
        hitchChain = e.chain;
      } else if (e.type === 'release' && this.cur && e.line === this.cur.line) released = true;
      else if (e.type === 'bail') bailed = true;
    }
    if (this.cur && this.state.active) {
      this.stepActive(game, this.cur, this.state.active, p, released, bailed, hitchLine);
    }
    if (!this.state.active && hitchLine >= 0) this.tryStart(game, hitchLine, hitchChain, p);
  }

  // ------------------------------------------------------------------------------------------

  private tryStart(game: Game, li: number, chain: number, p: PlayerState): void {
    const r = this.byLine[li];
    if (!r || this.state.punched[r.def.line]) return;
    if (len2(p.x - r.x, p.z - r.z) > CONDUCTOR_START_RADIUS) return;
    this.cur = r;
    this.phase = 'riding';
    this.baseChain = chain;
    this.veh = p.hVeh;
    this.t = 0;
    this.lastStop = -1;
    const L = game.sim.world.lines[li];
    // Standing at a stop when caught: that stop does not count toward stayOn.
    vehicleAt(L, p.hVeh, game.sim.tick, VS);
    this.lastStop = this.stopAt(game, li, VS.s, VS.vx, VS.vz);
    this.state.active = { line: li, kind: r.def.task.kind, progress: r.def.task.kind === 'chainFrom' ? 1 : 0, goal: taskGoal(r.def.task) };
    game.events.push({ type: 'conductorStart', line: li });
  }

  /** Index of the stop a vehicle at arc s stands at, or -1 when it is moving. */
  private stopAt(game: Game, li: number, s: number, vx: number, vz: number): number {
    if (len2(vx, vz) > 0.05) return -1;
    const st = game.sim.world.lines[li].allStops;
    for (let k = 0; k < st.length; k++) if (Math.abs(st[k].s - s) < 0.05) return k;
    return -1;
  }

  private stepActive(game: Game, r: Resolved, a: ActiveChallenge, p: PlayerState, released: boolean, bailed: boolean, hitchLine: number): void {
    const task = r.def.task;
    if (bailed || p.mode === Mode.BAIL) {
      this.fail(game, a);
      return;
    }
    const hitchedHere = p.mode === Mode.HITCH && p.hLine === r.line;
    switch (task.kind) {
      case 'chainFrom': {
        const alive = p.mode === Mode.HITCH || p.chainAlive === 1;
        if (!alive || p.chain < this.baseChain) {
          this.fail(game, a);
          return;
        }
        a.progress = p.chain - this.baseChain + 1;
        if (a.progress >= task.links) this.punch(game, r, a);
        return;
      }
      case 'stayOn': {
        if (!hitchedHere || p.hVeh !== this.veh) {
          this.fail(game, a);
          return;
        }
        const L = game.sim.world.lines[r.line];
        vehicleAt(L, this.veh, game.sim.tick, VS);
        const k = this.stopAt(game, r.line, VS.s, VS.vx, VS.vz);
        if (k >= 0 && k !== this.lastStop) {
          this.lastStop = k;
          a.progress++;
        }
        if (a.progress >= task.segments) this.punch(game, r, a);
        return;
      }
      default:
        break;
    }
    // The release-based tasks.
    if (this.phase === 'riding') {
      if (hitchedHere) return;
      if (!released) {
        // Let go without a sling (strap dropped) or caught something else.
        this.fail(game, a);
        return;
      }
      this.rx = p.x;
      this.rz = p.z;
      this.t = 0;
      if (task.kind === 'stopToStop') {
        if (!r.from || !inZone(r.from, p.x, p.y, p.z, ZONE_DY + 2)) {
          this.fail(game, a);
          return;
        }
        this.phase = 'rolling';
      } else this.phase = 'flying';
      a.progress = 0;
      return;
    }
    this.t += DT;
    if (p.mode === Mode.HITCH || hitchLine >= 0) {
      // Caught another ride: this was not under your own momentum, or not a flight to the ground.
      this.fail(game, a);
      return;
    }
    if (this.phase === 'rolling' && task.kind === 'stopToStop') {
      a.progress = this.t;
      if (r.to && inZone(r.to, p.x, p.y, p.z)) this.punch(game, r, a);
      else if (this.t > task.seconds) this.fail(game, a);
      return;
    }
    // Flying: until the first touch down.
    const dist = len2(p.x - this.rx, p.z - this.rz);
    if (task.kind === 'slingDistance') a.progress = dist;
    else if (task.kind === 'slingAir') a.progress = this.t;
    if (p.mode === Mode.AIR) return;
    let ok = false;
    if (task.kind === 'slingDistance') ok = dist >= task.metres;
    else if (task.kind === 'slingAir') ok = this.t - DT >= task.seconds;
    else if (task.kind === 'landOn') ok = r.to !== null && inZone(r.to, p.x, p.y, p.z);
    if (ok) this.punch(game, r, a);
    else this.fail(game, a);
  }

  private punch(game: Game, r: Resolved, a: ActiveChallenge): void {
    this.state.punched[r.def.line] = true;
    this.state.active = null;
    this.cur = null;
    game.events.push({ type: 'conductorPunch', line: a.line });
  }

  private fail(game: Game, a: ActiveChallenge): void {
    this.state.active = null;
    this.cur = null;
    game.events.push({ type: 'conductorFail', line: a.line });
  }
}
