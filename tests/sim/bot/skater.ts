/**
 * A closed-loop scripted skater. It plays a Game the way a player does: every tick it looks at its
 * own state, the world, the timetable and the game's events, and answers with one InputFrame (a
 * steer, a held touch, a swipe up). It never writes to the sim or the game.
 *
 * A plan is a list of tasks run in order. Each task is a small controller: roll along waypoints,
 * wait for a named line at a stop (circling, since landings fall away) and catch it, ride it
 * until a stop and let go. A task that cannot go on (the ride it was on is gone, a catch was missed
 * past retrying) fails the run with a note saying where and when, rather than trying something else:
 * the plan is a test of the game, and a failure is a finding.
 */
import { FEEL } from '../../../src/sim/constants';
import type { Game } from '../../../src/sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt } from '../../../src/sim/lines';
import { angleDiff, clamp, datan2, dcos, dsin } from '../../../src/sim/math';
import { Mode, type InputFrame, type PlayerState } from '../../../src/sim/types';
import { topHeight, type World } from '../../../src/sim/world';
import { frac } from './geo';

export type Status = 'run' | 'done' | 'fail';

export interface Task {
  readonly label: string;
  /** Called once when the task becomes current (and again after a save is loaded mid-task). */
  begin?(b: Skater): void;
  /** Write this tick's input; say whether the task goes on, is done, or has failed. */
  step(b: Skater, out: InputFrame): Status;
  /** True while the task is only waiting for a ride (a calm moment to save the game). */
  idle?(): boolean;
}

const V = makeVehicleState();
const G = { x: 0, y: 0, z: 0 };

export class Skater {
  game: Game;
  readonly tasks: Task[];
  ti = 0;
  /** Ticks the current task has run. */
  taskTicks = 0;
  readonly log: string[] = [];
  /** Why the run stopped, if a task failed. */
  failure = '';
  /** Free-running tick counter (bot time, for tic-tac rhythm): survives a save and load. */
  clock = 0;

  constructor(game: Game, tasks: Task[]) {
    this.game = game;
    this.tasks = tasks;
  }

  get w(): World {
    return this.game.sim.world;
  }
  get p(): PlayerState {
    return this.game.sim.player;
  }
  get tick(): number {
    return this.game.sim.tick;
  }
  get done(): boolean {
    return this.ti >= this.tasks.length || this.failure !== '';
  }
  /** Waiting at a stop for a ride, on the board. */
  get waiting(): boolean {
    const t = this.task;
    return t !== null && t.idle !== undefined && t.idle() && this.p.mode === Mode.GROUND;
  }
  get task(): Task | null {
    return this.ti < this.tasks.length ? this.tasks[this.ti] : null;
  }

  /** Continue with another Game (a save loaded into a fresh one): the current task begins again. */
  rebind(game: Game): void {
    this.game = game;
    this.taskTicks = 0;
  }

  note(s: string): void {
    const p = this.p;
    this.log.push(`${frac(this.tick).toFixed(4)} [${this.task?.label ?? '-'}] ${s} @ ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
  }

  fail(why: string): Status {
    const p = this.p;
    this.failure = `${this.task?.label ?? '-'}: ${why} (tick ${this.tick}, day ${frac(this.tick).toFixed(4)}, at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} mode ${p.mode})`;
    return 'fail';
  }

  /** This tick's input. */
  input(out: InputFrame): void {
    out.steer = 0;
    out.hold = false;
    out.hop = false;
    this.clock++;
    while (!this.done) {
      const t = this.tasks[this.ti];
      if (this.taskTicks === 0 && t.begin) t.begin(this);
      const st = t.step(this, out);
      this.taskTicks++;
      if (st === 'run') return;
      if (st === 'fail') return;
      this.note('done');
      this.ti++;
      this.taskTicks = 0;
      out.steer = 0;
      out.hold = false;
      out.hop = false;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Controls shared by tasks.

  /** Steer for (x, z); tic-tac when crawling and still some way off. */
  steerTo(out: InputFrame, x: number, z: number, crawl = 2.4): number {
    const p = this.p;
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const want = datan2(dx, dz);
    out.steer = clamp(-2 * angleDiff(want, p.heading), -1, 1);
    if (p.mode === Mode.GROUND && p.speed < crawl && dist > 2) out.steer = clamp(out.steer + (Math.floor(this.clock / 12) % 2 === 0 ? 0.9 : -0.9), -1, 1);
    // A kerb or a platform edge in the way, too tall to roll up: hop it.
    if (p.mode === Mode.GROUND && p.speed > 0.8 && dist > 0.5) {
      // Far enough ahead that the hop has risen over the edge by the time the board gets there.
      const ahead = Math.min(clamp(p.speed * 0.2, 1.4, 4), dist);
      const fx = dx / dist;
      const fz = dz / dist;
      const facing = fx * dsin(p.heading) + fz * dcos(p.heading);
      const up = topHeight(this.w, p.x + fx * ahead, p.z + fz * ahead) - p.y;
      if (facing > 0.8 && up > FEEL.STEP_UP && up < 1.3) out.hop = true;
    }
    return dist;
  }

  /** Lean against the swing so a tow runs quietly behind the ride. */
  quiet(out: InputFrame): void {
    const p = this.p;
    if (p.mode !== Mode.HITCH) return;
    const L = this.w.lines[p.hLine];
    vehicleAt(L, p.hVeh, this.tick, V);
    if (V.vx * V.vx + V.vz * V.vz > 16) out.steer = clamp(-(1.5 * angleDiff(p.psi, p.psiRest) + 0.5 * p.omega), -1, 1);
  }

  /**
   * The nearest active grab point of any line (what a held touch would latch first), as
   * { line, veh, d } with d the plan distance; line -1 when nothing is within `range`.
   */
  nearestGrab(range: number, out: { line: number; veh: number; d: number; dy: number }): void {
    const p = this.p;
    const w = this.w;
    out.line = -1;
    out.veh = -1;
    out.d = range;
    out.dy = 0;
    for (const L of w.lines) {
      const m = range + L.anchorBack + 1;
      if (p.x < L.minX - m || p.x > L.maxX + m || p.z < L.minZ - m || p.z > L.maxZ + m) continue;
      for (let k = 0; k < L.vehicles; k++) {
        vehicleAt(L, k, this.tick, V);
        if (!V.active) continue;
        grabPoint(L, V, G);
        const dx = G.x - p.x;
        const dz = G.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < out.d) {
          out.d = d;
          out.line = L.index;
          out.veh = k;
          out.dy = G.y - (p.y + FEEL.HAND_HEIGHT);
        }
      }
    }
  }
}
