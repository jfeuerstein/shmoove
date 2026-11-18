/**
 * What every bot shares: the bot type, and the one helper that turns a wanted world yaw into a stick.
 *
 * The stick is read against `sim.state.viewYaw`: the mover is asked for `viewYaw - atan2(steerX,
 * steerY)` (see `wantedYaw` in the mover and the yaw convention in `types.ts`), so the stick that
 * asks for world yaw `yaw` points at `viewYaw - yaw` from straight up.
 */
import { angleDiff, datan2, dcos, dsin, len2 } from '../../../src/sim/math';
import type { Sim } from '../../../src/sim/sim';
import type { InputFrame, MoverState } from '../../../src/sim/types';

/** Called once per tick before `sim.step(out)`. Writes the whole frame. */
export type Bot = (sim: Sim, out: InputFrame) => void;

/** Thumb down, stick pushed `mag` (0..1) toward world yaw `yaw`. Leaves `hop` alone. */
export function stickToward(sim: Sim, yaw: number, mag: number, out: InputFrame): void {
  const a = angleDiff(sim.state.viewYaw, yaw);
  out.steerX = dsin(a) * mag;
  out.steerY = dcos(a) * mag;
  out.carve = true;
}

/** Thumb off the screen: tucked, no stick. Leaves `hop` alone. */
export function letGo(out: InputFrame): void {
  out.steerX = 0;
  out.steerY = 0;
  out.carve = false;
}

/** World yaw from the mover to (x, z). */
export function yawTo(m: MoverState, x: number, z: number): number {
  return datan2(x - m.x, z - m.z);
}

/** World yaw of the mover's horizontal velocity, or its heading when it is nearly still. */
export function travelYaw(m: MoverState): number {
  return len2(m.vx, m.vz) > 0.5 ? datan2(m.vx, m.vz) : m.heading;
}
