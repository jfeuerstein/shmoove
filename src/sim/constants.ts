/**
 * Every feel constant in the game. Nothing feel-related is hard-coded anywhere else.
 *
 * `FEEL` is mutable on purpose: the debug panel edits it live. Each entry carries the range the
 * panel offers and a note saying what a thumb would notice.
 */

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export interface FeelDef {
  v: number;
  min: number;
  max: number;
  step: number;
  group: 'input' | 'run' | 'carve' | 'tuck' | 'hop' | 'air' | 'ground' | 'gears' | 'view' | 'camera';
  note: string;
}

const DEFS = {
  // input (read by src/input, never by the sim)
  stickRadiusPx: { v: 56, min: 20, max: 140, step: 2, group: 'input', note: 'Thumb travel for full stick, CSS px' },
  stickDeadPx: { v: 8, min: 0, max: 30, step: 1, group: 'input', note: 'Thumb travel that still reads as centred, CSS px' },
  tapMaxMs: { v: 180, min: 60, max: 400, step: 10, group: 'input', note: 'Longest touch that is still a tap, ms' },
  tapSlopPx: { v: 12, min: 2, max: 40, step: 1, group: 'input', note: 'Furthest a tap may wander, CSS px' },
  swipeSpeed: { v: 1.2, min: 0.3, max: 4, step: 0.1, group: 'input', note: 'Upward thumb speed that is a flick, CSS px per ms (swipe scheme)' },
  swipeMinPx: { v: 28, min: 8, max: 80, step: 2, group: 'input', note: 'Shortest flick, CSS px (swipe scheme)' },
  // run
  runSpeed: { v: 10, min: 4, max: 16, step: 0.5, group: 'run', note: 'Top speed from the stick alone on the flat, m/s' },
  runAccel: { v: 22, min: 5, max: 60, step: 1, group: 'run', note: 'How hard the stick pushes below run speed, m/s2' },
  idleBrake: { v: 5, min: 0, max: 20, step: 0.5, group: 'run', note: 'Thumb down, stick centred: gentle brake, m/s2' },
  // carve
  turnMax: { v: 5.5, min: 2, max: 12, step: 0.1, group: 'carve', note: 'Fastest turn at low speed, rad/s' },
  grip: { v: 34, min: 10, max: 80, step: 1, group: 'carve', note: 'Sideways acceleration available for turning, m/s2. Sets the turning circle at speed' },
  carveScrub: { v: 0.1, min: 0, max: 0.4, step: 0.01, group: 'carve', note: 'Share of speed lost per radian turned above run speed' },
  carveDrag: { v: 0.35, min: 0, max: 2, step: 0.05, group: 'carve', note: 'How fast speed above run speed bleeds off while carving, 1/s' },
  slideAngle: { v: 1.9, min: 1.6, max: 3, step: 0.05, group: 'carve', note: 'Stick angle from straight up beyond which the turn is a powerslide, rad' },
  slideTurn: { v: 2.2, min: 1, max: 4, step: 0.1, group: 'carve', note: 'How much tighter a powerslide turns' },
  slideBrake: { v: 14, min: 0, max: 40, step: 1, group: 'carve', note: 'Braking in a powerslide, m/s2' },
  // tuck
  tuckDrag: { v: 0.035, min: 0, max: 0.3, step: 0.005, group: 'tuck', note: 'Drag while tucked, 1/s. Lower holds speed longer on the flat' },
  rollFriction: { v: 0.6, min: 0, max: 4, step: 0.1, group: 'tuck', note: 'Constant slowing while tucked, m/s2. Also the gentlest slope that still rolls' },
  // hop
  hopSpeed: { v: 7, min: 3, max: 14, step: 0.25, group: 'hop', note: 'Upward speed of a hop, m/s' },
  hopBufferTicks: { v: 9, min: 0, max: 20, step: 1, group: 'hop', note: 'How early a tap before landing still counts, ticks' },
  cleanWindowTicks: { v: 7, min: 1, max: 20, step: 1, group: 'hop', note: 'How long after landing a hop is clean, ticks' },
  cleanHopBonus: { v: 1.2, min: 0, max: 4, step: 0.1, group: 'hop', note: 'Speed a clean hop adds at low speed, m/s' },
  cleanHopFade: { v: 24, min: 12, max: 40, step: 1, group: 'hop', note: 'Speed at which a clean hop adds nothing, m/s' },
  landScrub: { v: 0.08, min: 0, max: 0.4, step: 0.01, group: 'hop', note: 'Share of speed lost to a hard landing that is not hopped out of' },
  landScrubImpact: { v: 8, min: 2, max: 20, step: 0.5, group: 'hop', note: 'Speed into the ground at which the landing scrub is full, m/s. Softer landings lose less' },
  minAirTicks: { v: 4, min: 1, max: 12, step: 1, group: 'hop', note: 'Shortest time off the ground that counts as a landing, ticks' },
  // air
  gravity: { v: 25, min: 10, max: 50, step: 1, group: 'air', note: 'Gravity, m/s2. Also how hard slopes pull' },
  airTurn: { v: 1.2, min: 0, max: 4, step: 0.1, group: 'air', note: 'Air-steer, rad/s' },
  airDrag: { v: 0.01, min: 0, max: 0.2, step: 0.005, group: 'air', note: 'Drag in the air, 1/s' },
  // ground
  stickAccel: { v: 18, min: 0, max: 60, step: 1, group: 'ground', note: 'How hard the mover clings over crests before it flies, m/s2' },
  boostPadSpeed: { v: 8, min: 0, max: 20, step: 0.5, group: 'ground', note: 'Speed a boost pad adds, m/s' },
  boostCap: { v: 32, min: 20, max: 50, step: 1, group: 'ground', note: 'Speed above which a boost pad adds nothing, m/s' },
  maxSpeed: { v: 42, min: 25, max: 80, step: 1, group: 'ground', note: 'Hard speed limit, m/s' },
  // gears
  gear2: { v: 7, min: 2, max: 15, step: 0.5, group: 'gears', note: 'Speed where gear 2 starts, m/s' },
  gear3: { v: 12, min: 8, max: 20, step: 0.5, group: 'gears', note: 'Speed where gear 3 starts, m/s' },
  gear4: { v: 18, min: 12, max: 30, step: 0.5, group: 'gears', note: 'Speed where gear 4 starts, m/s' },
  gear5: { v: 25, min: 18, max: 40, step: 0.5, group: 'gears', note: 'Speed where gear 5 starts, m/s' },
  gearHyst: { v: 1, min: 0, max: 4, step: 0.1, group: 'gears', note: 'How far below a gear you can dip before it is at risk, m/s' },
  gearDropTicks: { v: 12, min: 0, max: 60, step: 1, group: 'gears', note: 'How long you can stay below a gear before losing it, ticks' },
  // view (the frame the stick is read in; the camera sits behind it)
  viewFollow: { v: 3.2, min: 0.5, max: 10, step: 0.1, group: 'view', note: 'How fast the view swings behind your direction of travel, 1/s' },
  viewMinSpeed: { v: 2, min: 0, max: 8, step: 0.25, group: 'view', note: 'Below this speed the view stops swinging, m/s' },
  // camera
  camDist: { v: 8.5, min: 3, max: 20, step: 0.25, group: 'camera', note: 'Distance behind the mover in gear 1, m' },
  camHeight: { v: 5.4, min: 1, max: 15, step: 0.2, group: 'camera', note: 'Height above the mover in gear 1, m' },
  camDistPerGear: { v: 1.1, min: 0, max: 4, step: 0.1, group: 'camera', note: 'Pull-back per gear, m' },
  camHeightPerGear: { v: 0.7, min: 0, max: 3, step: 0.1, group: 'camera', note: 'Rise per gear, m' },
  camLookAhead: { v: 10, min: 0, max: 30, step: 0.5, group: 'camera', note: 'How far ahead of the mover the camera aims, m' },
  camFov: { v: 76, min: 40, max: 110, step: 1, group: 'camera', note: 'Vertical field of view in gear 1, degrees' },
  camFovPerGear: { v: 3.5, min: 0, max: 10, step: 0.5, group: 'camera', note: 'Field of view added per gear, degrees' },
  camPosRate: { v: 9, min: 1, max: 30, step: 0.5, group: 'camera', note: 'How tightly the camera tracks the mover, 1/s' },
  camZoomRate: { v: 2.2, min: 0.3, max: 10, step: 0.1, group: 'camera', note: 'How fast pull-back and field of view follow the gear, 1/s' },
  camLandKick: { v: 0.05, min: 0, max: 0.3, step: 0.01, group: 'camera', note: 'Camera dip per m/s of landing impact, m' },
  camGroundClear: { v: 1.2, min: 0.2, max: 5, step: 0.1, group: 'camera', note: 'Closest the camera gets to the ground, m' },
} as const satisfies Record<string, FeelDef>;

export type FeelKey = keyof typeof DEFS;

export const FEEL_DEFS: Readonly<Record<FeelKey, FeelDef>> = DEFS;
export const FEEL_KEYS = Object.keys(DEFS) as FeelKey[];

export const FEEL = {} as Record<FeelKey, number>;
for (const k of FEEL_KEYS) FEEL[k] = DEFS[k].v;

/** Put every constant back to its shipped value. */
export function resetFeel(): void {
  for (const k of FEEL_KEYS) FEEL[k] = DEFS[k].v;
}

export const GEAR_COUNT = 5;
export const GEAR_NAMES = ['Shuffle', 'Roll', 'Cruise', 'Rip', 'SHMOOVE'] as const;
