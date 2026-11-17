/**
 * Every feel constant in the game. Nothing feel-related is hard-coded elsewhere.
 * `FEEL` is mutable so the debug panel can tune it live; tests call `resetFeel()`.
 * Tuple: [default, min, max, group, what it controls].
 */
type Def = readonly [value: number, min: number, max: number, group: string, note: string];

export const FEEL_DEFS = {
  // --- Ground
  GRAVITY: [20, 5, 40, 'Ground', 'Gravity, m/s^2. Drives downhill acceleration and air arcs'],
  ROLL_RESIST: [0.3, 0, 2, 'Ground', 'Constant rolling deceleration, m/s^2'],
  AIR_DRAG: [0.006, 0, 0.02, 'Ground', 'Quadratic drag; sets terminal speed on a slope'],
  MAX_SPEED: [34, 10, 60, 'Ground', 'Hard speed limit, m/s'],
  TURN_RATE_MAX: [2.4, 0.5, 6, 'Ground', 'Carve turn rate at low speed, rad/s'],
  LAT_ACCEL_MAX: [10, 4, 40, 'Ground', 'Grip: max lateral acceleration; widens turns at speed'],
  STEER_SMOOTH: [16, 2, 60, 'Ground', 'How fast steer input reaches the board, 1/s'],
  CARVE_SCRUB: [0.06, 0, 0.5, 'Ground', 'Speed lost per second at full carve (fraction)'],
  FALLLINE_GAIN: [1.1, 0, 4, 'Ground', 'How strongly a slow board swings toward downhill'],
  FALLLINE_SPEED: [5, 0.5, 15, 'Ground', 'Above this speed the fall-line drift is gone, m/s'],
  PUMP_GAIN: [0.55, 0, 3, 'Ground', 'Tic-tac: speed gained per unit of steer change'],
  PUMP_SPEED_CAP: [2.6, 0, 8, 'Ground', 'Tic-tac stops adding speed above this, m/s'],
  STAIR_DRAG: [0.85, 0, 4, 'Ground', 'Linear drag on stairs, 1/s (terminal speed = slope accel / this)'],
  ROUGH_DRAG: [0.3, 0, 2, 'Ground', 'Linear drag on dirt and grass, 1/s'],
  STEP_UP: [0.4, 0.05, 1, 'Ground', 'Tallest ledge the board rolls up onto, m'],
  GROUND_STICK: [0.05, 0, 0.5, 'Ground', 'Gap under the wheels before a crest launches you, m'],
  PLAYER_RADIUS: [0.35, 0.1, 1, 'Ground', 'Collision radius, m'],
  PLAYER_HEIGHT: [1.7, 0.5, 2.5, 'Ground', 'Collision height, m'],
  WALL_SCRUB: [0.5, 0, 1, 'Ground', 'Speed lost sliding along a wall (fraction at head-on)'],
  WALL_BOUNCE: [0.35, 0, 1, 'Ground', 'Speed kept bouncing off a wall head-on'],
  WALL_HEAD_ON: [0.8, 0.3, 1, 'Ground', 'How square a wall hit must be (cos) to bounce back rather than slide'],
  WALL_SLIDE_SPEED: [3, 0, 12, 'Ground', 'Below this speed a square hit turns you along the wall instead of bouncing, m/s'],
  WALL_BAIL_SPEED: [12, 3, 40, 'Ground', 'Speed into a wall that bails you, m/s'],

  // --- Air
  AIR_STEER: [1.3, 0, 5, 'Air', 'Turn rate of horizontal velocity in the air, rad/s'],
  HOP_V: [7.6, 2, 16, 'Air', 'Hop launch speed, m/s'],
  HOP_SPEED_BONUS: [0.07, 0, 0.4, 'Air', 'Extra hop speed per m/s of roll speed'],
  HOP_BONUS_MAX: [2, 0, 8, 'Air', 'Cap on the speed-based hop bonus, m/s'],
  HOP_COOLDOWN: [0.25, 0, 1, 'Air', 'Minimum time between hops, s'],
  HOP_BUFFER: [0.14, 0, 0.5, 'Air', 'A swipe this long before landing still hops, s'],
  COYOTE_TIME: [0.12, 0, 0.5, 'Air', 'Can still hop this long after rolling off an edge, s'],
  BAIL_IMPACT: [19, 5, 60, 'Air', 'Landing speed into the surface that bails you, m/s'],
  AWNING_BOUNCE: [11, 2, 25, 'Air', 'Minimum bounce speed off an awning, m/s'],
  AWNING_KEEP: [0.75, 0, 1.2, 'Air', 'Fraction of fall speed returned by an awning'],

  // --- Grind
  RAIL_SNAP: [0.9, 0.2, 3, 'Grind', 'Horizontal magnet radius onto a rail, m'],
  RAIL_SNAP_UP: [0.7, 0.1, 2, 'Grind', 'Can be this far above the rail and still snap, m'],
  RAIL_SNAP_DOWN: [0.4, 0, 1.5, 'Grind', 'Can be this far below the rail and still snap, m'],
  RAIL_ENTRY_VY: [2.5, -5, 10, 'Grind', 'Must be rising slower than this to snap, m/s'],
  GRIND_ALIGN: [0.25, 0, 0.95, 'Grind', 'Minimum alignment (cos) between velocity and rail'],
  GRIND_MIN_SPEED: [4, 0, 12, 'Grind', 'Speed floor on entering a rail, m/s'],
  GRIND_ENTRY_BOOST: [1, 0, 6, 'Grind', 'Speed added on entering a rail, m/s'],
  GRIND_FRICTION: [0.5, 0, 5, 'Grind', 'Rail deceleration, m/s^2'],
  GRIND_EXIT_POP: [2.6, 0, 8, 'Grind', 'Upward speed leaving the end of a rail, m/s'],
  GRIND_HOP_SIDE: [2.8, 0, 8, 'Grind', 'Sideways speed from steer when hopping off a rail, m/s'],
  GRIND_STALL_SPEED: [0.6, 0, 3, 'Grind', 'Below this speed on a flat rail you step off, m/s'],
  GRIND_COOLDOWN: [0.3, 0, 1, 'Grind', 'Time before the same rail can be re-snapped, s'],

  // --- Wall
  WALL_ALIGN: [0.5, 0, 0.95, 'Wall', 'Minimum alignment (cos) with the wall to wallride'],
  WALL_MIN_SPEED: [5, 0, 15, 'Wall', 'Minimum speed to wallride, m/s'],
  WALL_TIME: [1.0, 0.2, 3, 'Wall', 'Longest wallride, s'],
  WALL_GRAVITY: [5, 0, 20, 'Wall', 'Gravity while wallriding, m/s^2'],
  WALL_KEEP: [0.97, 0.5, 1.1, 'Wall', 'Speed kept on wallride entry'],
  WALL_ENTRY_UP: [3, 0, 10, 'Wall', 'Minimum upward speed on wallride entry, m/s'],
  WALL_JUMP_OUT: [5.5, 0, 12, 'Wall', 'Wall-jump speed away from the wall, m/s'],
  WALL_JUMP_UP: [7, 0, 14, 'Wall', 'Wall-jump upward speed, m/s'],
  WALL_EXIT_PUSH: [1.2, 0, 6, 'Wall', 'Push away from the wall when a wallride runs out, m/s'],
  WALL_COOLDOWN: [0.35, 0, 1.5, 'Wall', 'Time before another wallride, s'],

  // --- Hitch
  HITCH_REACH: [4.5, 1, 10, 'Hitch', 'Hand-to-strap distance that latches, m'],
  HITCH_REACH_Y: [2.6, 0.5, 8, 'Hitch', 'Vertical reach to a strap, m'],
  HITCH_AHEAD: [0.8, -2, 6, 'Hitch', 'How far ahead of a bumper you can be and still grab it, m'],
  HAND_HEIGHT: [1.0, 0.3, 2, 'Hitch', 'Height of the grabbing hand above the board, m'],
  RELATCH_COOLDOWN: [0.7, 0, 3, 'Hitch', 'Time before the same vehicle can be re-caught, s'],
  HITCH_COOLDOWN: [0.12, 0, 1, 'Hitch', 'Time after a release before anything can be caught, s'],
  HITCH_MIN_TIME: [0.18, 0, 1, 'Hitch', 'Shortest hitch before a release registers, s (never shorter than YANK_TIME)'],
  YANK_TIME: [0.28, 0, 1, 'Hitch', 'Time the strap takes to pull you into line, s'],
  REEL_RATE: [3.5, 0.5, 15, 'Hitch', 'How fast the strap shortens to its length, m/s'],
  SWING_FREQ: [2.8, 0.5, 8, 'Hitch', 'Pendulum rate at reference ride speed, rad/s'],
  SWING_REF_SPEED: [8, 2, 20, 'Hitch', 'Ride speed at which SWING_FREQ applies, m/s'],
  SWING_DAMP: [0.9, 0, 3, 'Hitch', 'Swing damping, 1/s'],
  SWING_SETTLE_TIME: [0.7, 0, 3, 'Hitch', 'Time after latching during which the swing is extra damped, s'],
  SWING_SETTLE_DAMP: [5, 0, 20, 'Hitch', 'Extra swing damping right after latching, 1/s'],
  SWING_MIN_AMP: [0.75, 0, 1.4, 'Hitch', 'Swing the game keeps alive for you, rad'],
  SWING_PUMP: [4, 0, 12, 'Hitch', 'Strength of the self-sustaining swing, rad/s^2'],
  SWING_STEER: [9, 0, 25, 'Hitch', 'Lean torque from steer while hitched, rad/s^2'],
  SWING_OMEGA_MAX: [3.2, 1, 8, 'Hitch', 'Fastest swing rate; caps the whip, rad/s'],
  SWING_LATCH_MAX: [2.5, 0.5, 8, 'Hitch', 'Most swing rate a catch can start with, rad/s'],
  SWING_REST_RATE: [5, 0.5, 20, 'Hitch', 'How fast "straight behind" follows a ride that turns, rad/s'],
  SWING_STOP: [60, 5, 200, 'Hitch', 'Stiffness of the soft stop at SWING_MAX, 1/s^2'],
  SWING_MAX: [1.3, 0.3, 1.55, 'Hitch', 'Widest swing angle, rad'],
  HITCH_Y_RATE: [11, 1, 40, 'Hitch', 'How fast height follows the strap, 1/s'],

  // --- Slingshot and chain
  SLING_GAIN: [1.14, 0.8, 2, 'Sling', 'Exit speed = release speed x this'],
  SLING_MIN: [6.5, 0, 15, 'Sling', 'Floor for the base exit speed, m/s'],
  LINK_BONUS: [2.2, 0, 8, 'Sling', 'Exit speed added per chain link, m/s'],
  SLING_CAP: [29, 10, 60, 'Sling', 'Cap on exit speed, m/s'],
  SLING_POP: [4.6, 0, 12, 'Sling', 'Upward pop on release, m/s'],
  SLING_VY_CARRY: [6, 0, 15, 'Sling', 'Most upward speed from the tow that carries into a release, m/s'],
  SLING_HOP_POP: [5.5, 0, 12, 'Sling', 'Extra upward pop when releasing with a swipe up, m/s'],
  CHAIN_GROUND_GRACE: [0.6, 0, 3, 'Sling', 'Ground time a chain survives after release, s (0 = strict)'],

  // --- Bail
  RIDE_BAIL_SPEED: [13, 3, 40, 'Bail', 'Closing speed with a vehicle body that bails you, m/s'],
  RIDE_ROOF_BOUNCE: [8.5, 0, 20, 'Bail', 'Bounce speed off a vehicle roof, m/s'],
  SAFE_MARGIN: [6, 0, 20, 'Bail', 'A respawn point must be this far from water, m'],
  BAIL_TIME: [1.3, 0.3, 4, 'Bail', 'Length of the tumble, s'],
  BAIL_FRICTION: [10, 1, 40, 'Bail', 'Slide deceleration while bailed, m/s^2'],

  // --- Touch
  HOLD_ARM_TIME: [0.11, 0, 0.5, 'Touch', 'Still-finger time before a touch arms the hitch, s'],
  DRAG_DEADZONE_PX: [14, 2, 60, 'Touch', 'Movement that turns a touch into a pure carve, px'],
  STEER_RANGE_PX: [86, 20, 300, 'Touch', 'Drag distance for full steer, px'],
  SWIPE_UP_PX: [64, 20, 300, 'Touch', 'Upward travel that counts as a swipe, px'],
  SWIPE_UP_TIME: [0.2, 0.05, 0.6, 'Touch', 'Window in which that travel must happen, s'],

  // --- Camera
  CAM_DIST: [6.4, 2, 20, 'Camera', 'Distance behind the skater, m'],
  CAM_HEIGHT: [4.2, 0.5, 12, 'Camera', 'Height above the skater, m'],
  CAM_LOOK_AHEAD: [10, 0, 20, 'Camera', 'Look target distance ahead of the skater, m'],
  CAM_LOOK_UP: [0.2, -2, 5, 'Camera', 'Look target height above the board, m'],
  CAM_LOOK_FAR: [32, 5, 80, 'Camera', 'How far ahead the camera reads the ground to decide its tilt, m'],
  CAM_LOOK_SLOPE: [0.6, 0, 1.5, 'Camera', 'How much of the rise or fall ahead goes into the look target'],
  CAM_LOOK_TILT_MAX: [5, 0, 12, 'Camera', 'Most the look target moves up or down for the ground ahead, m'],
  CAM_FOV: [76, 40, 100, 'Camera', 'Vertical field of view at rest, degrees'],
  CAM_FOV_SPEED: [12, 0, 40, 'Camera', 'Extra field of view at top speed, degrees'],
  CAM_SPEED_DIST: [3, 0, 12, 'Camera', 'Extra distance at top speed, m'],
  CAM_YAW_RATE: [3.2, 0.5, 15, 'Camera', 'How fast the camera swings behind your direction, 1/s'],
  CAM_POS_RATE: [9, 1, 40, 'Camera', 'How tightly the camera follows position, 1/s'],
  CAM_HITCH_DIST: [3.5, 0, 12, 'Camera', 'Extra distance while hitched, m'],
  CAM_HITCH_HEIGHT: [1.6, 0, 8, 'Camera', 'Extra height while hitched, m'],
  CAM_AIR_HEIGHT: [1.2, 0, 8, 'Camera', 'Extra height while airborne, m'],
  CAM_UPHILL_HEIGHT: [2.5, 0, 10, 'Camera', 'Extra height when heading uphill, m'],
  CAM_MIN_CLEAR: [1.2, 0.2, 5, 'Camera', 'Minimum camera height above ground and roofs, m'],
  CAM_TOP_SPEED: [28, 10, 50, 'Camera', 'Speed at which the speed effects are at full, m/s'],
  CAM_SHAKE: [0.12, 0, 1, 'Camera', 'Shake scale on stairs, landings and bails'],
} as const satisfies Record<string, Def>;

export type FeelKey = keyof typeof FEEL_DEFS;
export type Feel = Record<FeelKey, number>;

function defaults(): Feel {
  const out = {} as Feel;
  for (const k of Object.keys(FEEL_DEFS) as FeelKey[]) out[k] = FEEL_DEFS[k][0];
  return out;
}

export const FEEL: Feel = defaults();

export function resetFeel(): void {
  Object.assign(FEEL, defaults());
}

/** Sim clock. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** One day is 12 minutes. */
export const DAY_TICKS = 12 * 60 * TICK_HZ;
/** A new game starts in the morning. */
export const START_DAY_FRAC = 0.3;
