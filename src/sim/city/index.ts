/**
 * Santa Rampa: the deterministic generator for the whole city (simulation side).
 *
 * Layout is hand-authored (layout.ts); the seeded RNG only dresses it (building heights, awning
 * placement, crate scatter, styles). Same seed, same world.
 */
import { PI } from '../math';
import { District, addZone, createWorld, finalizeWorld, terrainHeight, type World } from '../world';
import { CITY, GRID, LEVELS } from './layout';
import { GHOST_CUT, addChainZones, addPylons, addRouteStructures, addStopZones, buildRoutes } from './routes';
import { dressCity, needleTop } from './dress';
import { buildGround, spinePolyline } from './terrain';
import { addZones } from './zones';

export { CITY } from './layout';

export interface RouteDef {
  /** Line id from DESIGN section 5: 'D1','D2','D3','M1','M2','M3','T1','T2','T3','T4','A1','A2','A3','S1','S2','S3'. */
  id: string;
  /** true = closed circuit (last point equals first); false = shuttle track ridden out and back. */
  loop: boolean;
  overhead: boolean;
  /** xyz triplets, already smoothed (point spacing <= 4 m). Ground routes are draped on the terrain (y = ground). Overhead routes carry the absolute height of the carriage/kite/hook. */
  path: number[];
  /** Named stops by arc position along `path` (use nearestArc). At least 2 per route, the first at s = 0. */
  stops: { name: string; s: number }[];
}

export interface City {
  /** Finalized; world.lines is [] (the rides task fills it). */
  world: World;
  routes: Record<string, RouteDef>;
  /** xyz polyline along streets from the summit down to the docks that is downhill (or level) all the way: the line a skater with no rides follows. */
  spine: number[];
}

export function buildCity(seed = 1): City {
  const w = createWorld({ seed, minX: CITY.minX, minZ: CITY.minZ, cell: CITY.cell, nx: GRID.nx, nz: GRID.nz });
  const B = CITY.bands;
  w.bands = [
    { district: District.DOCKS, zMin: -Infinity, zMax: B.mercado },
    { district: District.MERCADO, zMin: B.mercado, zMax: B.terraces },
    { district: District.TERRACES, zMin: B.terraces, zMax: B.antenna },
    { district: District.ANTENNA, zMin: B.antenna, zMax: Infinity },
  ];

  const ground = buildGround(w);
  ground.carver.buildWalls();
  dressCity(w, ground, seed);

  const spine = spinePolyline(ground);
  for (let i = 0; i < spine.length; i += 3) spine[i + 1] = terrainHeight(w, spine[i], spine[i + 2]);

  addRouteStructures(w);
  w.spawn = { x: 0, z: 566, heading: PI };
  finalizeWorld(w);
  addZones(w, needleTop());

  const routes = buildRoutes(w, ground);
  addPylons(w);
  finalizeWorld(w);
  addStopZones(w, routes);
  addChainZones(w, routes);
  const L = LEVELS.find((l) => l.z === GHOST_CUT.level);
  if (L) {
    const gx = (GHOST_CUT.x0 + GHOST_CUT.x1) / 2;
    addZone(w, { id: 'ghost_tunnel', name: 'Túnel Fantasma', kind: 'secret', x: gx, y: terrainHeight(w, gx, L.z), z: L.z, r: 8 });
  }
  return { world: w, routes, spine };
}
