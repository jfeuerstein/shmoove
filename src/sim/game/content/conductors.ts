/**
 * The conductors: one challenge per regular line, started by hitching that line within 30 m of
 * the stop the conductor stands at (an index into the line's stops). How each number was chosen
 * is noted beside it; `tests/sim/content.test.ts` re-measures the sling numbers on the city.
 */
import type { ConductorDef } from '../conductors';

export const CONDUCTORS: readonly ConductorDef[] = [
  // The crane's hook hangs over the quay: a release from the top of a pumped swing, with a swipe
  // up, flies 1.23 s at best (a lazy release 0.73 s); 0.75 of the best.
  { line: 'D1', stop: 1, task: { kind: 'slingAir', seconds: 0.9 } },
  // Forklifts are easy to catch: hold on for three of the loop's ten stops.
  { line: 'D2', stop: 0, task: { kind: 'stayOn', segments: 3 } },
  // Fish trucks run 8 m/s up the boulevard. Best measured sling off a full whip 20.4 m (lazy 3.9 m);
  // 0.75 of the best.
  { line: 'D3', stop: 1, task: { kind: 'slingDistance', metres: 15 } },
  // Mopeds run 11 m/s on the ramps. Best measured sling 20.5 m (lazy 3.9 m); 0.75 of it.
  { line: 'M1', stop: 0, task: { kind: 'slingDistance', metres: 15 } },
  // Handcarts are easy to catch and slow: stay on for two stops.
  { line: 'M2', stop: 0, task: { kind: 'stayOn', segments: 2 } },
  // The parade circles the plaza at walking pace: stay on round two of its three stops.
  { line: 'M3', stop: 0, task: { kind: 'stayOn', segments: 2 } },
  // The funicular meets the ghost tram at its base, tram 5 and the lower cable car at its top.
  { line: 'T1', stop: 0, task: { kind: 'chainFrom', links: 2 } },
  // Tram 5 runs 13 m/s and leaves Terrazas downhill. Best measured sling 32.5 m (lazy 1.1 m); 0.75 of it.
  { line: 'T2', stop: 2, task: { kind: 'slingDistance', metres: 24 } },
  // Let go at Terraza Alta and roll down the spine to Terraza Baja. The steering bot in the content
  // test takes 37.7 s from letting go; 1.3x.
  { line: 'T3', stop: 1, task: { kind: 'stopToStop', from: 2, to: 0, seconds: 49 } },
  // Let go at Terraza 727 and roll down the spine to the garage at the docks. The steering bot takes
  // 74.7 s; 1.3x.
  { line: 'T4', stop: 1, task: { kind: 'stopToStop', from: 2, to: 0, seconds: 97 } },
  // Drop off the lower cable car onto the hill-station platform.
  { line: 'A1', stop: 0, task: { kind: 'landOn', zone: 'hill_station' } },
  // The summit car leaves the hill station over open slope. Best measured flight 1.30 s (lazy 0.73 s);
  // 0.75 of it.
  { line: 'A2', stop: 0, task: { kind: 'slingAir', seconds: 0.95 } },
  // Five kites circle the hill: kite to kite to kite.
  { line: 'A3', stop: 0, task: { kind: 'chainFrom', links: 3 } },
];
