import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { compileLine, makeVehicleState, vehicleAt, type LineDef, type VehicleState } from '../../src/sim/lines';
import { tryHitch } from '../../src/sim/hitch';
import { placePlayer } from '../../src/sim/player';
import { Sim, clonePlayer } from '../../src/sim/sim';
import { buildSlice } from '../../src/sim/slice';
import type { InputFrame, SimCtx, SimEvent } from '../../src/sim/types';
import { District, Surface, createWorld, fillSurfaces, finalizeWorld, type World } from '../../src/sim/world';

export type Script = (sim: Sim, i: number) => Partial<InputFrame>;

let sliceWorld: World | null = null;

/** The feel-slice world (built once; it is immutable after finalize). */
export function slice(): World {
  if (!sliceWorld) sliceWorld = buildSlice(1);
  return sliceWorld;
}

export function newSim(world: World = slice(), startDayFrac = 0.3): Sim {
  resetFeel();
  return new Sim(world, { seed: 1, startDayFrac });
}

/** Step `ticks` times with input from `script`; returns every event that fired. */
export function run(sim: Sim, ticks: number, script: Script = () => ({})): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const inp = script(sim, i);
    sim.step({ steer: inp.steer ?? 0, hold: inp.hold ?? false, hop: inp.hop ?? false, brake: inp.brake ?? false });
    for (const e of sim.events) events.push(e);
  }
  return events;
}

/** Step until `pred` is true or `maxTicks` pass. Returns ticks taken, or -1 on timeout. */
export function runUntil(sim: Sim, maxTicks: number, pred: (sim: Sim) => boolean, script: Script = () => ({})): number {
  for (let i = 0; i < maxTicks; i++) {
    const inp = script(sim, i);
    sim.step({ steer: inp.steer ?? 0, hold: inp.hold ?? false, hop: inp.hop ?? false, brake: inp.brake ?? false });
    if (pred(sim)) return i + 1;
  }
  return -1;
}

/** Put the skater on the ground at (x, z) facing `heading`, rolling at `speed`. */
export function teleport(sim: Sim, x: number, z: number, heading: number, speed = 0): void {
  placePlayer(sim.world, sim.player, x, z, heading);
  sim.player.speed = speed;
}

export const hSpeed = (sim: Sim): number => Math.sqrt(sim.player.vx * sim.player.vx + sim.player.vz * sim.player.vz);

const _vs = makeVehicleState();

/**
 * Set the clock so that vehicle `veh` of line `li` is about to pass z = `z` travelling in z-direction
 * `dir` (+1 uphill, -1 downhill), `leadTicks` before it gets there.
 */
export function seekVehicle(sim: Sim, li: number, veh: number, z: number, dir: number, leadTicks = 0): void {
  const L = sim.world.lines[li];
  const day = Math.floor(sim.tick / DAY_TICKS) * DAY_TICKS;
  for (let t = 0; t < DAY_TICKS; t++) {
    vehicleAt(L, veh, day + t, _vs);
    if (_vs.active && Math.abs(_vs.z - z) < 0.2 && _vs.vz * dir > 1) {
      sim.tick = day + t - leadTicks;
      return;
    }
  }
  throw new Error(`vehicle ${veh} of line ${L.id} never passes z=${z} going ${dir}`);
}

/** A flat 200 x 200 m plaza at y = 0 with the given lines, spawn in the middle facing +z. */
export function flatWorld(defs: LineDef[]): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = defs.map((d, i) => compileLine(d, i));
  w.spawn = { x: 0, z: 0, heading: 0 };
  finalizeWorld(w);
  return w;
}

/** A line definition with sensible defaults for tests. */
export function testLine(over: Partial<LineDef> = {}): LineDef {
  return {
    id: 'X1',
    name: 'Test',
    kind: 'tram',
    district: District.DOCKS,
    stem: 0,
    // A 60 m square circuit round the origin, anticlockwise seen from above (+z first).
    path: [30, 0, -30, 30, 0, 30, -30, 0, 30, -30, 0, -30, 30, 0, -30],
    loop: true,
    stops: [],
    cruise: 8,
    accel: 3,
    dwell: 1,
    vehicles: 1,
    windows: [[0, 1]],
    overhead: false,
    anchorBack: 4,
    anchorY: 1,
    hang: 0,
    rope: 3,
    bodyHalfLen: 3.8,
    bodyHalfWid: 1.2,
    bodyHeight: 3,
    livery: { base: 0, stripe: 0, accent: 0, pattern: 0 },
    ...over,
  };
}

/** Set the clock to the first tick at which `pred` holds for the vehicle. */
export function seekWhen(sim: Sim, li: number, veh: number, pred: (v: VehicleState) => boolean): void {
  const L = sim.world.lines[li];
  for (let t = 0; t < DAY_TICKS; t++) {
    vehicleAt(L, veh, t, _vs);
    if (pred(_vs)) {
      sim.tick = t;
      return;
    }
  }
  throw new Error(`vehicle ${veh} of line ${L.id} never satisfies the condition`);
}

/**
 * The line a held touch would catch this tick (the hitch's own choice, on a copy of the skater),
 * or -1. Bots hold only when it is the ride they want: the strap is thrown 14 m (DECISIONS 119),
 * so a hand out near a lane catches whatever passes first, as a player's would.
 */
export function wouldCatch(ctx: SimCtx): number {
  return wouldCatchVehicle(ctx)?.line ?? -1;
}

/** As `wouldCatch`, with the vehicle; null when nothing would be caught. */
export function wouldCatchVehicle(ctx: SimCtx): { line: number; veh: number } | null {
  const probe: SimCtx = { world: ctx.world, tick: ctx.tick, player: clonePlayer(ctx.player), events: [] };
  return tryHitch(probe) ? { line: probe.player.hLine, veh: probe.player.hVeh } : null;
}
