/**
 * The itinerary: from a new game at the lookout to a complete line map, then the secret lines.
 */
import { Mode } from '../../../src/sim/types';
import type { Task } from './skater';
import { summitRun } from './secrets';
import { act, go, ride } from './tasks';

export function mapPlan(): Task[] {
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
    // Day 1, from the top: the funicular down, the stairs to the plaza, the wedding parade, then the
    // mopeds down to the docks and the night bus. Letting go at Base slings the skater onto the
    // handrail of the flight below the lookout (DECISIONS 114: every release is a slingshot) and off
    // its foot too fast to stop on the landing, so the way down is the west flight below it and
    // along the plaza's landing to the church.
    ride('T1 down', { line: 'T1', at: 'Cima', to: 'Base' }),
    go('down the west flight', [
      [-28, 490],
      [-28, 464],
      [0, 462],
      [18, 462],
    ], { slow: 9 }),
    ride('M3 lap', { line: 'M3', at: 'Iglesia' }),
    go('to Rellano 410', [
      [22, 462],
      [4, 452],
      [4, 424],
      [8, 417],
    ]),
    ride('M1 down', { line: 'M1', at: 'Rellano 410', to: 'Bulevar' }),
    ride('T4 lap', { line: 'T4', at: 'Garaje' }),
    // Day 2: the mopeds up from the docks to Rellano 410, then a handcart's full lap from there.
    ride('M1 up', { line: 'M1', at: 'Bulevar', to: 'Rellano 410', anywhere: true }),
    ride('M2 lap', { line: 'M2', at: 'Rellano 410', side: -2.6 }),
    // Night 2: down the spine to the docks and along the quay to the crane, which starts its run
    // from the west end just after midnight.
    go('down to the docks', [
      [4, 405],
      [4, 300],
      [2, 250],
      [-30, 40],
      [-128, 16],
    ]),
    ride('D1 both ways', { line: 'D1', at: 'Grúa Oeste', to: 'Grúa Centro', segs: [0, 1] }),
    // Day 3: the fish trucks' first lap from the fish market, then the forklifts' last full lap.
    ride('D3 lap', { line: 'D3', at: 'Lonja' }),
    ride('D2 lap', { line: 'D2', at: 'Almacenes Sur' }),
    // Day 4: tram 5 up to the terraces, and tram 9's switchback loop. Tram 5's first run of the day
    // leaves Muelle three minutes after the forklift lap ends: roll across to the foot of the
    // Mercado steps, just behind the stop, while it comes.
    go('to the foot of the steps', [
      [-40, 200],
      [-3, 283],
    ]),
    ride('T2 up', { line: 'T2', at: 'Muelle', to: 'Terrazas' }),
    // Stay on past the lap (the map completes on it) to the end of its last run, at Terraza Baja.
    ride('T3 lap', { line: 'T3', at: 'Zigzag Oeste', to: 'Terraza Baja', segs: [0, 1, 2, 3] }),
  ];
}

/** After the map: the ghost tram at midnight, the summit chain onto the king kite, the guy wire down, the blimp. */
export function secretPlan(): Task[] {
  return [
    // Night 4: down the spine to the lookout's landing and along it into the ghost tram's covered
    // cut, where it waits for a few seconds just after midnight.
    go('down to the ghost cut', [
      [5, 616],
      [5, 598],
      [6, 580],
      [9, 567],
      [40, 566],
      [70, 563],
    ]),
    ride('S1 lap', { line: 'S1', at: 'Túnel', side: -2.6 }),
    // Day 5: back along the landing to the funicular and up to the Antenna gate.
    go('to the funicular', [
      [40, 566],
      [9, 567],
      [-20, 566],
    ]),
    ride('T1 to the gate', { line: 'T1', at: 'Base', to: 'Cima', segs: [] }),
    // The summit chain onto the king kite, held on its way out, over the needle and all the way
    // back round its circuit (that inks the line) until it sets the skater down on the needle.
    summitRun('summit chain'),
    // Roll off the needle's south edge onto its guy wire and grind down to the summit lawn.
    act('onto the guy wire', 120, (b, out) => {
      if (b.p.mode === Mode.GROUND) b.steerTo(out, 0.8, 1250, 0);
    }),
    // Down the lawn and the hill station's run-in steps onto its platform, for the blimp, which
    // waits there with its ladder low at the start of its one lap of the day.
    go('down to the hill station', [
      [16, 1120],
      [19, 1064],
      [19, 1046],
    ]),
    ride('S2 lap', { line: 'S2', at: 'Estación del Cerro' }),
  ];
}

export function fullGamePlan(): Task[] {
  return [...mapPlan(), ...secretPlan()];
}
