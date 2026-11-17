/**
 * The errands of Santa Rampa. Zone and line ids are the city's contract (`src/sim/city`); positions
 * and timetables are never written here, so the content survives the city moving a few metres.
 * `tests/sim/content.test.ts` checks every id, the district spread and that each errand can be
 * done inside its limit (a lower bound from geometry and timetables under 70% of the limit).
 */
import { District } from '../../world';
import type { ErrandDef } from '../errands';

const MIN = 60 * 60;

export const ERRANDS: readonly ErrandDef[] = [
  // ------------------------------------------------------------------ Docks
  {
    id: 'fish_run',
    title: 'Fish before it turns',
    giver: 'fish_market',
    district: District.DOCKS,
    brief: 'Ride the fish truck up to the Mercado gate, quick.',
    limitTicks: 4 * MIN,
    hours: [0.22, 0.46],
    steps: [
      { kind: 'hitch', line: 'D3' },
      { kind: 'rideTo', line: 'D3', zone: 'stop_D3_2' },
    ],
  },
  {
    id: 'ferry_luggage',
    title: 'Luggage off the ferry',
    giver: 'ferry_pier',
    district: District.DOCKS,
    brief: 'A suitcase rides the crane hook to the crane yard.',
    limitTicks: 3 * MIN,
    steps: [
      { kind: 'hitch', line: 'D1' },
      { kind: 'rideTo', line: 'D1', zone: 'crane_yard', noBail: true },
    ],
  },
  {
    id: 'saffron',
    title: 'Saffron for the stalls',
    giver: 'stop_M1_0',
    district: District.DOCKS,
    brief: 'Catch a moped up the ramp to the Rellano 410 stalls.',
    limitTicks: 2.5 * MIN,
    hours: [0.3, 0.78],
    steps: [{ kind: 'rideTo', line: 'M1', zone: 'stop_M1_2' }],
  },
  // ------------------------------------------------------------------ Mercado Steps
  {
    id: 'funicular_valve',
    title: 'A valve for the funicular',
    giver: 'spawn',
    district: District.MERCADO,
    brief: 'The top station needs a spare valve. Take the funicular.',
    limitTicks: 2.5 * MIN,
    steps: [
      { kind: 'reach', zone: 'funicular_base' },
      { kind: 'rideTo', line: 'T1', zone: 'funicular_top' },
    ],
  },
  {
    id: 'wedding_rings',
    title: 'Rings for La Boda',
    giver: 'spice_row',
    district: District.MERCADO,
    brief: 'The best man forgot the rings. Plaza, now. No falls.',
    limitTicks: 2 * MIN,
    hours: [0.5, 0.68],
    steps: [{ kind: 'deliver', zone: 'plaza_boda', noBail: true }],
  },
  {
    id: 'soup',
    title: "Don't spill the soup",
    giver: 'clock_tower',
    district: District.MERCADO,
    brief: 'Hot soup for the tram crew at the docks. Gently.',
    limitTicks: 2 * MIN,
    steps: [{ kind: 'deliver', zone: 'stop_T2_0', maxSpeed: 5, noBail: true }],
  },
  {
    id: 'brass_polish',
    title: 'Brass polish',
    giver: 'spawn_mercado',
    district: District.MERCADO,
    brief: 'Polish 30 m of handrail on the way down to the gate.',
    limitTicks: 3 * MIN,
    steps: [
      { kind: 'grind', metres: 30 },
      { kind: 'reach', zone: 'stop_D3_2' },
    ],
  },
  // ------------------------------------------------------------------ Terraces
  {
    id: 'night_keys',
    title: "The night driver's keys",
    giver: 'stop_T4_2',
    district: District.TERRACES,
    brief: 'She left her keys at the bar. Garage, before her shift.',
    limitTicks: 2.5 * MIN,
    hours: [0.8, 0.2],
    steps: [{ kind: 'deliver', zone: 'stop_T4_0' }],
  },
  {
    id: 'school_shirts',
    title: 'Clean shirts for school',
    giver: 'laundry_terrace',
    district: District.TERRACES,
    brief: 'Dry shirts off the line, down to the school roof.',
    limitTicks: 2 * MIN,
    steps: [{ kind: 'deliver', zone: 'school_roof', noBail: true }],
  },
  {
    id: 'tram9_post',
    title: 'Post for Terraza Alta',
    giver: 'stop_T3_0',
    district: District.TERRACES,
    brief: 'Ride tram 9 round the zigzag to Terraza Alta.',
    limitTicks: 3.5 * MIN,
    hours: [0.3, 0.76],
    steps: [{ kind: 'rideTo', line: 'T3', zone: 'stop_T3_2' }],
  },
  // ------------------------------------------------------------------ Antenna Hill
  {
    id: 'kite_spool',
    title: 'A kite spool for the ridge',
    giver: 'funicular_top',
    district: District.ANTENNA,
    brief: 'Cable car up, swap cars at the station, on to the ridge.',
    limitTicks: 2.5 * MIN,
    hours: [0.3, 0.77],
    steps: [
      { kind: 'rideTo', line: 'A1', zone: 'hill_station' },
      { kind: 'chain', links: 2, at: 'hill_station' },
      { kind: 'rideTo', line: 'A2', zone: 'summit' },
    ],
  },
  {
    id: 'radio_valves',
    title: 'Valves for the radio shack',
    giver: 'summit',
    district: District.ANTENNA,
    brief: 'Glass valves, downhill to the radio shack. No falls.',
    limitTicks: 2 * MIN,
    steps: [{ kind: 'deliver', zone: 'radio_shack', noBail: true }],
  },
  {
    id: 'kite_relay',
    title: 'Kite relay',
    giver: 'kite_field',
    district: District.ANTENNA,
    brief: 'Kite to kite and back down to the station.',
    limitTicks: 3 * MIN,
    hours: [0.36, 0.66],
    steps: [
      { kind: 'chain', links: 2, at: 'kite_field' },
      { kind: 'deliver', zone: 'hill_station' },
    ],
  },
];
