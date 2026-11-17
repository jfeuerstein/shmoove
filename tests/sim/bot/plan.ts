/**
 * The itinerary: from a new game at the lookout to a complete line map, then the secret lines.
 */
import type { World } from '../../../src/sim/world';
import { Mode } from '../../../src/sim/types';
import type { Task } from './skater';
import { act, ride } from './tasks';

export function fullGamePlan(_w: World): Task[] {
  return [
    // The lesson's first two steps, on the lookout: carve both ways, then a hop.
    act('carve', 60, (_b, out, i) => {
      out.steer = i < 30 ? 0.9 : -0.9;
    }),
    act('hop', 50, (b, out, i) => {
      out.hop = i === 0 && b.p.mode === Mode.GROUND;
    }),
    ride('T1 up', { line: 'T1', at: 'Base', to: 'Cima' }),
    ride('A1 up', { line: 'A1', at: 'Puerta', to: 'Estación del Cerro' }),
    ride('A3 lap', { line: 'A3', at: 'Campo Sur' }),
    ride('A2 lap', { line: 'A2', at: 'Estación del Cerro' }),
    ride('A1 down', { line: 'A1', at: 'Estación del Cerro', to: 'Puerta' }),
    ride('T2 lap', { line: 'T2', at: 'Puerta de la Antena', side: -2.6 }),
  ];
}
