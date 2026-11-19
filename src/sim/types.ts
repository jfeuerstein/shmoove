/** Shared sim types. The contract between the sim, the input layer, the renderer and the bots. */
import type { MoverMods } from './stats';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One tick of player intent. Everything the sim knows about the thumb.
 *
 * Yaw convention used everywhere: forward(yaw) = (sin yaw, 0, cos yaw); the stick is read against
 * `SimState.viewYaw`, so `steerY = 1` means "up the screen".
 */
export interface InputFrame {
  /** Stick x: +1 is fully right on screen. */
  steerX: number;
  /** Stick y: +1 is fully up the screen (forward). */
  steerY: number;
  /** True while the thumb is carving. False means tucked: no steering, lowest drag. */
  carve: boolean;
  /** A hop was asked for on this tick. True for one tick only; the sim buffers it. */
  hop: boolean;
  /** Which card to take while an offer is open: 0, 1 or 2. Left out or -1 means no choice yet. */
  pick?: number;
}

export function makeInputFrame(): InputFrame {
  return { steerX: 0, steerY: 0, carve: false, hop: false };
}

/** Things that happened during the last step, as bit flags in `SimState.events`. */
export const EV_HOP = 1;
export const EV_CLEAN_HOP = 2;
export const EV_LAND = 4;
export const EV_GEAR_UP = 8;
export const EV_GEAR_DOWN = 16;
export const EV_BOOST = 32;
export const EV_CHAIN_LOST = 64;
export const EV_GRIND_START = 128;
export const EV_GRIND_END = 256;

export interface MoverState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Yaw the mover faces. */
  heading: number;
  /** What the gears read: full speed on the ground, horizontal speed in the air. m/s. */
  speed: number;
  grounded: boolean;
  /** Coasting low with the thumb up. */
  tucked: boolean;
  /** In a powerslide (stick pulled back at speed). */
  sliding: boolean;
  /** The stick is pulled back and the turn-around direction is fixed until it comes forward again. */
  latched: boolean;
  /** The yaw a pulled-back stick is turning toward. */
  latchYaw: number;
  /** Ticks since leaving the ground; 0 while grounded. */
  airTicks: number;
  /** Ticks since touching down. */
  groundTicks: number;
  /** Ticks a buffered hop request stays alive. */
  hopBuffer: number;
  /** Clean hops in a row. */
  chain: number;
  /** True from a real landing until the clean-hop window closes. */
  landPending: boolean;
  /** Horizontal speed carried into the last landing. */
  landSpeed: number;
  /** Speed into the ground at the last landing, m/s. For the camera kick and the landing scrub. */
  impact: number;
  /** How long the flight that ended at the last landing lasted, ticks. */
  lastAir: number;
  /** Ticks until a boost pad can fire again. */
  padCooldown: number;
  /** The rail being ground (an index into `terrain.rails`), or -1. While on one the mover is not grounded. */
  rail: number;
  /** How far along that rail, 0 at its first end to 1 at its second. */
  railT: number;
  /** Which way along it: +1 toward the second end, -1 toward the first. */
  railDir: number;
  /** Ticks until the mover can catch a rail again after leaving one. */
  railCooldown: number;
  /** 1..5. */
  gear: number;
  /** Ticks spent below the current gear's floor. */
  gearHold: number;
  /** Ground normal under the mover (the last one, while airborne). */
  nx: number;
  ny: number;
  nz: number;
}

export interface SimState {
  tick: number;
  /** The yaw the stick is read against and the camera sits behind. Follows velocity with a lag. */
  viewYaw: number;
  /** EV_* flags for the step that produced this state. */
  events: number;
  /** Metres travelled along the ground and through the air. */
  distance: number;
  /** What the build does to movement. All ones and zeros until the build says otherwise. */
  mods: MoverMods;
  mover: MoverState;
}
