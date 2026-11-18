import { FEEL, GEAR_COUNT } from './constants';
import { EV_GEAR_DOWN, EV_GEAR_UP, type SimState } from './types';

/** Lowest speed of a gear, m/s. Gear 1 has no floor. */
export function gearFloor(gear: number): number {
  switch (gear) {
    case 2:
      return FEEL.gear2;
    case 3:
      return FEEL.gear3;
    case 4:
      return FEEL.gear4;
    case 5:
      return FEEL.gear5;
    default:
      return 0;
  }
}

/** The gear a steady speed belongs to, ignoring hysteresis. */
export function gearForSpeed(speed: number): number {
  let g = 1;
  while (g < GEAR_COUNT && speed >= gearFloor(g + 1)) g++;
  return g;
}

/**
 * Gears go up the moment the speed is there and come down only after the speed has been clearly
 * below the floor for a while, so a hop or a hard turn at the edge of a gear does not flicker it.
 */
export function stepGear(s: SimState): void {
  const m = s.mover;
  if (m.gear < GEAR_COUNT && m.speed >= gearFloor(m.gear + 1)) {
    while (m.gear < GEAR_COUNT && m.speed >= gearFloor(m.gear + 1)) m.gear++;
    m.gearHold = 0;
    s.events |= EV_GEAR_UP;
    return;
  }
  if (m.gear > 1 && m.speed < gearFloor(m.gear) - FEEL.gearHyst) {
    m.gearHold++;
    if (m.gearHold > FEEL.gearDropTicks) {
      m.gear--;
      m.gearHold = 0;
      s.events |= EV_GEAR_DOWN;
    }
  } else {
    m.gearHold = 0;
  }
}
