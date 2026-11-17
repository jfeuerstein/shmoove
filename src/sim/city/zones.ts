/**
 * Named places. Ids are a contract for later tasks (errands, the line map, secrets, respawns).
 * Every zone's y is the ground (or roof / platform top) under it, read from the finished world.
 */
import { addZone, topHeight, type World } from '../world';

interface ZoneSpec {
  id: string;
  name: string;
  kind: string;
  x: number;
  z: number;
  r: number;
}

export const SPAWNS: readonly ZoneSpec[] = [
  { id: 'spawn', name: 'Mirador del Mercado', kind: 'spawn', x: 0, z: 566, r: 5 },
  { id: 'spawn_docks', name: 'Muelle', kind: 'spawn', x: -40, z: 150, r: 6 },
  { id: 'spawn_mercado', name: 'Escalones', kind: 'spawn', x: -14, z: 410, r: 5 },
  { id: 'spawn_terraces', name: 'Terrazas', kind: 'spawn', x: -70, z: 727, r: 5 },
  { id: 'spawn_antenna', name: 'Antenas', kind: 'spawn', x: 0, z: 1000, r: 6 },
];

/** Add the zones whose places exist once the ground is built. */
export function addZones(w: World): void {
  for (const s of SPAWNS) addZone(w, { ...s, y: topHeight(w, s.x, s.z) });
}

/** Add a zone at (x, z) with y read from the world. */
export function place(w: World, id: string, name: string, kind: string, x: number, z: number, r: number): void {
  addZone(w, { id, name, kind, x, y: topHeight(w, x, z), z, r });
}
