/**
 * The finds fixture (`?world=finds`): the feel slice with things to find in it, for looking at the
 * tiles, the tickets and the album on a small world. A trail of three tiles straight down the
 * street from the lookout, a spot below them that a rolling start clears at speed, more tiles on
 * detours and in hiding, a second district below the stairs, two landmarks and a timed route from
 * the lookout to the bottom of the hill.
 */
import { terrainHeight, District, addPickup, addZone, type World } from './world';
import { SLICE, buildSlice } from './slice';

/** Where the fixture's first tiles hang: on the line straight down from the lookout. */
export const FINDS_TRAIL_Z = [326, 318, 310] as const;

export function buildFindsWorld(seed = 1): World {
  const w = buildSlice(seed);
  const S = SLICE;
  const ground = (x: number, z: number): number => terrainHeight(w, x, z);
  w.bands = [
    { district: District.MERCADO, zMin: -Infinity, zMax: 200 },
    { district: District.TERRACES, zMin: 200, zMax: Infinity },
  ];
  const tile = (x: number, z: number, up: number, tier: number): void => {
    addPickup(w, 'tile', x, ground(x, z) + up, z, tier);
  };
  // Tier 0: the trail down from the lookout, and on down the street.
  for (const z of FINDS_TRAIL_Z) tile(w.spawn.x, z, 1.1, 0);
  tile(1.5, 250, 0.9, 0);
  tile(-1, 160, 0.9, 0);
  tile(2, 100, 0.9, 0);
  // Tier 1: detours. Over the stairs' handrail, on the kiosk roof, above the awning.
  tile(S.railX, 230, 1.9, 1);
  tile(14, 84, 3.4, 1);
  tile(13, 170, 3.6, 1);
  // Tier 2: hidden. Up on the terrace behind the stairs, against the west row, in the funicular cut.
  tile(26, 282, 0.9, 2);
  tile(-34, 60, 0.9, 2);
  tile(-17, 120, 0.9, 2);
  const spot = (id: string, name: string, x: number, z: number, r: number): void => {
    addZone(w, { id, name, kind: 'spot', x, y: ground(x, z), z, r });
  };
  spot('salto_cuesta', 'Salto de la Cuesta', 1.5, 296, 4);
  spot('tobogan', 'El Tobogán', S.railX, 214, 3.5);
  spot('kiosco', 'Vuelo del Kiosco', 14, 80, 4);
  addZone(w, { id: 'fuente', name: 'La Fuente', kind: 'landmark', x: 0, y: ground(0, 50), z: 50, r: 8 });
  addZone(w, { id: 'cuesta_a', name: 'La Cuesta', kind: 'routeStart', x: w.spawn.x, y: ground(w.spawn.x, w.spawn.z), z: w.spawn.z, r: 5 });
  addZone(w, { id: 'cuesta_b', name: 'La Cuesta', kind: 'routeEnd', x: 0, y: ground(0, 70), z: 70, r: 9 });
  return w;
}
