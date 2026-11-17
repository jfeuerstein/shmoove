/**
 * The conductors: one challenge per regular line, started by hitching that line within 30 m of
 * the stop the conductor stands at (an index into the line's stops). How each number was chosen
 * is noted beside it; `tests/sim/content.test.ts` re-measures the sling numbers on the city.
 */
import type { ConductorDef } from '../conductors';

export const CONDUCTORS: readonly ConductorDef[] = [
  // The crane's hook is 11 m over the quay: a release from the top of a swing hangs in the air.
  // Best measured flight off a full swing 2.2 s; 0.75 of it.
  { line: 'D1', stop: 1, task: { kind: 'slingAir', seconds: 1.6 } },
  // Forklifts are slow and the loop is short: hold on for three of its four stops.
  { line: 'D2', stop: 0, task: { kind: 'stayOn', segments: 3 } },
  // Fish trucks run 8 m/s up the boulevard. Best measured sling 18 m; 0.75 of it.
  { line: 'D3', stop: 1, task: { kind: 'slingDistance', metres: 13 } },
  // Mopeds run 11 m/s on the ramps. Best measured sling 22 m; 0.75 of it.
  { line: 'M1', stop: 0, task: { kind: 'slingDistance', metres: 16 } },
  // Handcarts are easy to catch and slow: stay on for two stops.
  { line: 'M2', stop: 0, task: { kind: 'stayOn', segments: 2 } },
  // The parade circles the plaza at walking pace: stay on round two of its three stops.
  { line: 'M3', stop: 0, task: { kind: 'stayOn', segments: 2 } },
  // The funicular meets the ghost tram at its base, tram 5 and the lower cable car at its top.
  { line: 'T1', stop: 0, task: { kind: 'chainFrom', links: 2 } },
  // Tram 5 runs 9 m/s. Best measured sling 20 m; 0.75 of it.
  { line: 'T2', stop: 2, task: { kind: 'slingDistance', metres: 15 } },
  // Let go at Terraza Alta and roll down the spine to Terraza Baja. A steering bot takes 36 s; 1.3x.
  { line: 'T3', stop: 1, task: { kind: 'stopToStop', from: 2, to: 0, seconds: 47 } },
  // Let go at Terraza 727 and roll down to the garage at the docks. A steering bot takes 76 s; 1.3x.
  { line: 'T4', stop: 1, task: { kind: 'stopToStop', from: 2, to: 0, seconds: 99 } },
  // Drop off the lower cable car onto the hill-station platform.
  { line: 'A1', stop: 0, task: { kind: 'landOn', zone: 'hill_station' } },
  // The summit car is high over the slope. Best measured flight 2.4 s; 0.75 of it.
  { line: 'A2', stop: 0, task: { kind: 'slingAir', seconds: 1.8 } },
  // Five kites circle the hill: kite to kite to kite.
  { line: 'A3', stop: 0, task: { kind: 'chainFrom', links: 3 } },
];
