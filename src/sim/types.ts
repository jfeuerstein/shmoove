import type { World } from './world';

/** One tick of player intent, produced by the gesture layer (or a script, or a ghost). */
export interface InputFrame {
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** Touch is armed: hitch when something is in reach, stay hitched while true. */
  hold: boolean;
  /** Swipe-up edge: true for exactly one tick per swipe. */
  hop: boolean;
}

export const NO_INPUT: Readonly<InputFrame> = Object.freeze({ steer: 0, hold: false, hop: false });

export const Mode = {
  GROUND: 0,
  AIR: 1,
  GRIND: 2,
  WALL: 3,
  HITCH: 4,
  BAIL: 5,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];
export const MODE_NAMES = ['GROUND', 'AIR', 'GRIND', 'WALL', 'HITCH', 'BAIL'] as const;

export type BailReason = 'wall' | 'impact' | 'water' | 'vehicle';

/** Things that happened during a step. Consumed by audio, UI, haptics and game systems. */
export type SimEvent =
  | { type: 'hitch'; line: number; vehicle: number; chain: number; newLink: boolean }
  | { type: 'release'; line: number; vehicle: number; speed: number; chain: number; hop: boolean }
  | { type: 'denied'; line: number; need: number }
  | { type: 'chainEnd'; chain: number; reason: 'land' | 'bail' }
  | { type: 'hop' }
  | { type: 'land'; impact: number; surface: number }
  | { type: 'bounce'; speed: number }
  | { type: 'grindStart'; rail: number }
  | { type: 'grindEnd'; rail: number }
  | { type: 'wallStart' }
  | { type: 'wallEnd'; jumped: boolean; topped: boolean }
  | { type: 'wallHit'; speed: number }
  | { type: 'kickturn' }
  | { type: 'bail'; reason: BailReason }
  | { type: 'recover' };

/**
 * The skater. Flat and numeric so it can be copied with Object.assign and hashed field by field.
 * Booleans are stored as 0/1.
 */
export interface PlayerState {
  mode: Mode;
  /** Seconds in the current mode. */
  modeTime: number;

  // Position of the board (wheels) and world velocity.
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;

  /** Yaw of the board. Forward = (sin h, cos h) in (x, z). 0 faces uphill (+z). */
  heading: number;
  /** Speed along the board on the ground (>= 0), 3D speed otherwise. */
  speed: number;
  /** Smoothed steer actually applied, -1..1. */
  steer: number;
  /** Surface under the wheels (Surface enum), or -1 in the air. */
  surface: number;
  /** Index of the solid stood on, or -1. */
  onSolid: number;

  // Timers (seconds, counting down unless noted).
  hopBuffer: number;
  hopCooldown: number;
  coyote: number;
  hitchCooldown: number;
  relatchCooldown: number;
  grindCooldown: number;
  wallCooldown: number;
  /** Recently pressed against a wall on the ground: holds off the fall-line drift. */
  wallHold: number;

  // Grind.
  rail: number;
  railS: number;
  /** Signed speed along the rail's +s direction. */
  railV: number;
  lastRail: number;

  // Wallride.
  wallNx: number;
  wallNz: number;
  wallSolid: number;

  // Hitch.
  hLine: number;
  hVeh: number;
  /** World angle of the skater's offset from the grab point: offset = rope * (sin psi, cos psi). */
  psi: number;
  omega: number;
  rope: number;
  /** World angle of "straight behind the ride" last time the ride was moving. */
  psiRest: number;
  hitchTime: number;
  // Position/velocity at latch, extrapolated and blended out over YANK_TIME.
  yankX: number;
  yankY: number;
  yankZ: number;
  yankVx: number;
  yankVy: number;
  yankVz: number;

  // Chain.
  /** Links in the current chain (0 = none). */
  chain: number;
  /** 1 between a release and the chain ending or the next catch. */
  chainAlive: number;
  /** Ground time used up since the last release, s. */
  chainGround: number;
  lastLine: number;
  lastVeh: number;

  // Bail.
  bailTimer: number;
  bailWater: number;
  safeX: number;
  safeY: number;
  safeZ: number;
  safeHeading: number;
  safeTimer: number;

  prevHold: number;
}

/** What a skater steps against. The Sim is one; a chalk ghost is another in the same world. */
export interface SimCtx {
  readonly world: World;
  /** Absolute tick (includes the start-of-day offset). Rides are a pure function of this. */
  tick: number;
  player: PlayerState;
  events: SimEvent[];
}
