/**
 * Named places. Ids are a contract for later tasks (errands, the line map, secrets, respawns).
 * Every zone's y is the ground (or roof / platform top) under it, read from the finished world.
 */
import { addZone, topHeight, type World } from '../world';
import { SPAWN_Z } from './layout';

interface ZoneSpec {
  id: string;
  name: string;
  kind: string;
  x: number;
  z: number;
  r: number;
}

export const SPAWNS: readonly ZoneSpec[] = [
  { id: 'spawn', name: 'Mirador del Mercado', kind: 'spawn', x: 0, z: SPAWN_Z, r: 5 },
  { id: 'spawn_docks', name: 'Muelle', kind: 'spawn', x: -40, z: 150, r: 6 },
  { id: 'spawn_mercado', name: 'Escalones', kind: 'spawn', x: -14, z: 410, r: 5 },
  { id: 'spawn_terraces', name: 'Terrazas', kind: 'spawn', x: -70, z: 727, r: 5 },
  { id: 'spawn_antenna', name: 'Antenas', kind: 'spawn', x: 0, z: 1000, r: 6 },
];

/** Landmarks: on the ground, or on the roof / deck named. */
export const LANDMARKS: readonly ZoneSpec[] = [
  { id: 'fish_market', name: 'Mercado de Pescado', kind: 'landmark', x: -110, z: 34, r: 8 },
  { id: 'crane_yard', name: 'Patio de la Grúa', kind: 'landmark', x: 80, z: 18, r: 8 },
  { id: 'container_yard', name: 'Contenedores', kind: 'landmark', x: 60, z: 172, r: 8 },
  { id: 'ferry_pier', name: 'Muelle del Ferry', kind: 'landmark', x: -16, z: -18, r: 6 },
  { id: 'mercado_gate', name: 'Puerta del Mercado', kind: 'landmark', x: -110, z: 306, r: 7 },
  { id: 'plaza_boda', name: 'Plaza de la Boda', kind: 'landmark', x: 40, z: 462, r: 10 },
  { id: 'clock_tower', name: 'Torre del Reloj', kind: 'landmark', x: 40, z: 482, r: 5 },
  { id: 'spice_row', name: 'Calle de las Especias', kind: 'landmark', x: -82, z: 514, r: 8 },
  { id: 'funicular_base', name: 'Funicular (Base)', kind: 'landmark', x: -28, z: 566, r: 6 },
  { id: 'funicular_top', name: 'Funicular (Cima)', kind: 'landmark', x: -28, z: 943, r: 6 },
  { id: 'tram_depot', name: 'Cocheras del Tranvía', kind: 'landmark', x: -128, z: 238, r: 8 },
  { id: 'laundry_terrace', name: 'Terraza de la Ropa', kind: 'landmark', x: 60, z: 781, r: 8 },
  { id: 'bus_garage', name: 'Garaje Nocturno', kind: 'landmark', x: 150, z: 232, r: 8 },
  { id: 'school_roof', name: 'Tejado de la Escuela', kind: 'landmark', x: 56, z: 745, r: 6 },
  { id: 'hill_station', name: 'Estación del Cerro', kind: 'landmark', x: 30, z: 1040, r: 6 },
  { id: 'radio_shack', name: 'Caseta de Radio', kind: 'landmark', x: -60, z: 1149, r: 5 },
  { id: 'kite_field', name: 'Campo de Cometas', kind: 'landmark', x: 70, z: 1100, r: 10 },
  { id: 'summit', name: 'La Cumbre', kind: 'landmark', x: 12, z: 1262, r: 6 },
];

/**
 * Where errand givers stand when the place they are named for is a stop (or right beside one):
 * holding a still finger at a stop stands you there to wait for a ride, so a giver's spot must
 * not take in a stop's waiting area (the stop's zone and 4 m round it), or waiting for a ride
 * takes the errand. Each is clear of every stop on the same level by at least 2.5 m more than
 * that, off the vehicles' lanes, on flat open ground, and keeps the name of the place.
 */
export const GIVERS: readonly ZoneSpec[] = [
  { id: 'giver_lonja', name: 'Mercado de Pescado', kind: 'giver', x: -90.6, z: 23.6, r: 8 },
  { id: 'giver_bulevar', name: 'Bulevar', kind: 'giver', x: 75.5, z: 270.7, r: 6 },
  { id: 'giver_torre', name: 'Torre del Reloj', kind: 'giver', x: 23.4, z: 470.9, r: 5 },
  { id: 'giver_terraza_baja', name: 'Terraza Baja', kind: 'giver', x: 40.3, z: 627.4, r: 6 },
  { id: 'giver_terraza_727', name: 'Terraza 727', kind: 'giver', x: 39.1, z: 730.9, r: 6 },
  { id: 'giver_funicular', name: 'Funicular (Cima)', kind: 'giver', x: -24, z: 965, r: 5 },
  { id: 'giver_cumbre', name: 'La Cumbre', kind: 'giver', x: 19.5, z: 1276.1, r: 6 },
];

/** Add the spawns, landmarks, errand givers' spots and the needle. Call after the world is finalized. */
export function addZones(w: World, needleTop: number): void {
  for (const s of SPAWNS) addZone(w, { ...s, y: topHeight(w, s.x, s.z) });
  for (const s of LANDMARKS) addZone(w, { ...s, y: topHeight(w, s.x, s.z) });
  for (const s of GIVERS) addZone(w, { ...s, y: topHeight(w, s.x, s.z) });
  addZone(w, { id: 'needle', name: 'La Aguja', kind: 'secret', x: 0, y: needleTop, z: 1262, r: 4 });
}

/** Add a zone at (x, z) with y read from the world. */
export function place(w: World, id: string, name: string, kind: string, x: number, z: number, r: number): void {
  addZone(w, { id, name, kind, x, y: topHeight(w, x, z), z, r });
}
