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
  group: 'input' | 'run' | 'carve' | 'tuck' | 'hop' | 'air' | 'ground' | 'gears' | 'view' | 'camera' | 'combat' | 'wake' | 'rail';
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
  carveScrub: { v: 0.06, min: 0, max: 0.4, step: 0.01, group: 'carve', note: 'Share of speed lost per radian turned above run speed' },
  carveSlopeGain: { v: 1, min: 0, max: 1, step: 0.05, group: 'carve', note: 'Share of a downhill\'s pull you keep above run speed with the thumb down. 1 = carving is as fast as tucking' },
  carveDrag: { v: 0.12, min: 0, max: 2, step: 0.05, group: 'carve', note: 'How fast speed above run speed bleeds off while carving, 1/s' },
  slideAngle: { v: 1.9, min: 1.6, max: 3, step: 0.05, group: 'carve', note: 'Stick angle from straight up beyond which the turn is a powerslide, rad' },
  slideTurn: { v: 2.2, min: 1, max: 4, step: 0.1, group: 'carve', note: 'How much tighter a powerslide turns' },
  slideBrake: { v: 14, min: 0, max: 40, step: 1, group: 'carve', note: 'Braking in a powerslide, m/s2' },
  // tuck
  tuckDrag: { v: 0.03, min: 0, max: 0.3, step: 0.005, group: 'tuck', note: 'Drag while tucked, 1/s. Lower holds speed longer on the flat' },
  rollFriction: { v: 0.4, min: 0, max: 4, step: 0.1, group: 'tuck', note: 'Constant slowing while tucked, m/s2. Also the gentlest slope that still rolls' },
  // hop
  hopSpeed: { v: 7, min: 3, max: 14, step: 0.25, group: 'hop', note: 'Upward speed of a hop, m/s' },
  hopBufferTicks: { v: 9, min: 0, max: 20, step: 1, group: 'hop', note: 'How early a tap before landing still counts, ticks' },
  cleanWindowTicks: { v: 7, min: 1, max: 20, step: 1, group: 'hop', note: 'How long after landing a hop is clean, ticks' },
  cleanHopBonus: { v: 1.4, min: 0, max: 4, step: 0.1, group: 'hop', note: 'Speed a clean hop adds at low speed, m/s' },
  cleanHopFade: { v: 28, min: 12, max: 40, step: 1, group: 'hop', note: 'Speed at which a clean hop adds nothing, m/s' },
  landScrub: { v: 0.08, min: 0, max: 0.4, step: 0.01, group: 'hop', note: 'Share of speed lost to a hard landing that is not hopped out of' },
  landScrubImpact: { v: 8, min: 2, max: 20, step: 0.5, group: 'hop', note: 'Speed into the ground at which the landing scrub is full, m/s. Softer landings lose less' },
  minAirTicks: { v: 4, min: 1, max: 12, step: 1, group: 'hop', note: 'Shortest time off the ground that counts as a landing, ticks' },
  // air
  gravity: { v: 25, min: 10, max: 50, step: 1, group: 'air', note: 'Gravity, m/s2. Also how hard slopes pull' },
  airTurn: { v: 1.2, min: 0, max: 4, step: 0.1, group: 'air', note: 'Air-steer, rad/s' },
  airDrag: { v: 0.01, min: 0, max: 0.2, step: 0.005, group: 'air', note: 'Drag in the air, 1/s' },
  // ground
  stickAccel: { v: 18, min: 0, max: 60, step: 1, group: 'ground', note: 'How hard the mover clings over crests before it flies, m/s2' },
  boostPadSpeed: { v: 7, min: 0, max: 20, step: 0.5, group: 'ground', note: 'Speed a boost pad adds, m/s' },
  boostCap: { v: 32, min: 20, max: 50, step: 1, group: 'ground', note: 'Speed above which a boost pad adds nothing, m/s' },
  maxSpeed: { v: 42, min: 25, max: 80, step: 1, group: 'ground', note: 'Hard speed limit, m/s' },
  // rail (grinding)
  railSnap: { v: 1.1, min: 0.3, max: 3, step: 0.1, group: 'rail', note: 'How near a rail, sideways, an airborne rider catches it, m' },
  railReachUp: { v: 0.5, min: 0, max: 2, step: 0.1, group: 'rail', note: 'How far below a rail the rider can be and still catch it, m' },
  railReachDown: { v: 1.2, min: 0.2, max: 3, step: 0.1, group: 'rail', note: 'How far above a rail the rider can be and still catch it, m' },
  railAlong: { v: 0.45, min: 0, max: 0.95, step: 0.05, group: 'rail', note: 'How much of your speed must point along the rail to catch it (0 any angle, 1 dead straight)' },
  railMinSpeed: { v: 4, min: 0, max: 12, step: 0.5, group: 'rail', note: 'Slowest you can catch or stay on a rail, m/s' },
  grindPush: { v: 1.5, min: 0, max: 8, step: 0.1, group: 'rail', note: 'Speed a grind adds each second, m/s2' },
  grindDrag: { v: 0.02, min: 0, max: 0.5, step: 0.01, group: 'rail', note: 'Drag on a rail, 1/s' },
  railExitPop: { v: 2, min: 0, max: 8, step: 0.25, group: 'rail', note: 'Upward speed leaving the end of a rail, m/s' },
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
  camDist: { v: 7, min: 3, max: 20, step: 0.25, group: 'camera', note: 'Distance behind the mover in gear 1, m' },
  camHeight: { v: 5.5, min: 1, max: 15, step: 0.2, group: 'camera', note: 'Height above the mover in gear 1, m' },
  camDistPerGear: { v: 1.0, min: 0, max: 4, step: 0.1, group: 'camera', note: 'Pull-back per gear, m' },
  camHeightPerGear: { v: 0.75, min: 0, max: 3, step: 0.1, group: 'camera', note: 'Rise per gear, m' },
  camLookAhead: { v: 4, min: 0, max: 30, step: 0.5, group: 'camera', note: 'How far ahead of the mover the camera aims, m' },
  camLookAheadPerGear: { v: 1.2, min: 0, max: 6, step: 0.1, group: 'camera', note: 'Extra aim-ahead per gear, m. More shows more of the line and puts the mover lower on screen' },
  camFov: { v: 74, min: 40, max: 110, step: 1, group: 'camera', note: 'Vertical field of view in gear 1, degrees' },
  camFovPerGear: { v: 3, min: 0, max: 10, step: 0.5, group: 'camera', note: 'Field of view added per gear, degrees' },
  camPosRate: { v: 9, min: 1, max: 30, step: 0.5, group: 'camera', note: 'How tightly the camera tracks the mover, 1/s' },
  camZoomRate: { v: 2.2, min: 0.3, max: 10, step: 0.1, group: 'camera', note: 'How fast pull-back and field of view follow the gear, 1/s' },
  camLandKick: { v: 0.05, min: 0, max: 0.3, step: 0.01, group: 'camera', note: 'Camera dip per m/s of landing impact, m' },
  camGroundClear: { v: 1.2, min: 0.2, max: 5, step: 0.1, group: 'camera', note: 'Closest the camera gets to the ground, m' },
  // combat (how being hit feels; damage and health numbers live in balance.ts)
  invulnTicks: { v: 48, min: 0, max: 120, step: 2, group: 'combat', note: 'How long nothing can hurt you after a hit, ticks' },
  hitShoveRadius: { v: 7, min: 0, max: 12, step: 0.5, group: 'combat', note: 'How far around you a hit throws the horde back, m' },
  hitShoveSpeed: { v: 12, min: 0, max: 25, step: 0.5, group: 'combat', note: 'How hard a hit throws the horde back, m/s' },
  hitStunTicks: { v: 44, min: 0, max: 120, step: 2, group: 'combat', note: 'How long a thrown enemy stays harmless, ticks' },
  // wake (the trail behind you and the loop that pops)
  wakeLength: { v: 40, min: 10, max: 80, step: 1, group: 'wake', note: 'Length of the trail in gear 1, m' },
  wakeLengthPerGear: { v: 0, min: 0, max: 20, step: 0.5, group: 'wake', note: 'Trail added per gear, m' },
  wakeLifeTicks: { v: 420, min: 60, max: 1200, step: 10, group: 'wake', note: 'How long a piece of trail lasts, ticks' },
  wakeWidth: { v: 1.1, min: 0.3, max: 4, step: 0.1, group: 'wake', note: 'How far either side of the trail burns, m' },
  wakeCloseDist: { v: 2.6, min: 0.5, max: 8, step: 0.1, group: 'wake', note: 'How near your own trail you must pass to close a loop, m' },
  wakePopEdge: { v: 2.2, min: 0, max: 6, step: 0.1, group: 'wake', note: 'How far outside the loop the pop still reaches, m. The horde chasing you round the ring is on the ring, not inside it' },
  wakeLoopMinArea: { v: 18, min: 0, max: 80, step: 1, group: 'wake', note: 'Smallest area a loop must enclose to pop, m2. Stops a strip beside your own trail counting as a loop' },
  wakeLoopMin: { v: 16, min: 6, max: 40, step: 1, group: 'wake', note: 'Shortest loop that pops, m of trail' },
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
