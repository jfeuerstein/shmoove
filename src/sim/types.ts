/** Shared sim types. The contract between the sim, the input layer, the renderer and the bots. */

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
  /** Ticks until a boost pad can fire again. */
  padCooldown: number;
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
  mover: MoverState;
}
