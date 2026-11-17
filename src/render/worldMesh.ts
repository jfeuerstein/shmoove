/**
 * Meshers for the static world: heightfield cells, solids, rails and zones into MeshBuilders, at
 * two levels of detail. The dressing per kind lives in ./dress; both the streaming city view and
 * the whole-world static view (the feel slice) draw through these, so they look the same.
 *
 * The terrain uses the same per-cell diagonal as the sim (see src/sim/world.ts), so the drawn
 * ground is exactly the collision ground.
 */
import type { Rail, Solid, World, Zone } from '../sim/world';
import type { MeshBuilder } from './geom';
import { Lod } from './dress/kit';
import { meshRailFar, meshRailNear } from './dress/rails';
import { meshSolidFar, meshSolidNear } from './dress/solids';
import { meshGround, meshGroundDecor, meshGroundPaint, meshStairTreads } from './dress/terrain';
import { meshZone } from './dress/zones';

export { Lod } from './dress/kit';
export { surfaceColor } from './dress/terrain';

/** Heightfield cells [ix0, ix1) x [iz0, iz1): exact ground, plus painted decoration when near. */
export function meshTerrain(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number, lod: Lod = Lod.NEAR): void {
  meshGround(b, w, ix0, iz0, ix1, iz1, lod !== Lod.NEAR);
  if (lod === Lod.NEAR) meshGroundDecor(b, w, ix0, iz0, ix1, iz1);
}

/**
 * The three parts of `meshTerrain`, for builds done a row at a time: all the ground, then (near
 * only) all the paint, then all the stair treads, in that order, give exactly `meshTerrain`'s
 * geometry, and so does calling each on one row after another.
 */
export function meshTerrainGround(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number, lod: Lod): void {
  meshGround(b, w, ix0, iz0, ix1, iz1, lod !== Lod.NEAR);
}

export function meshTerrainPaint(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number, lod: Lod): void {
  if (lod === Lod.NEAR) meshGroundPaint(b, w, ix0, iz0, ix1, iz1);
}

export function meshTerrainTreads(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number, lod: Lod): void {
  if (lod === Lod.NEAR) meshStairTreads(b, w, ix0, iz0, ix1, iz1);
}

/** A solid: its plain box when far, dressed by kind when near. */
export function meshSolid(b: MeshBuilder, w: World, o: Solid, lod: Lod = Lod.NEAR): void {
  if (lod === Lod.NEAR) meshSolidNear(b, w, o);
  else meshSolidFar(b, w, o);
}

/** A rail: the beam on the sim polyline, plus posts, flanges and the rest when near. */
export function meshRail(b: MeshBuilder, w: World, r: Rail, lod: Lod = Lod.NEAR): void {
  if (lod === Lod.NEAR) meshRailNear(b, w, r);
  else meshRailFar(b, w, r);
}

/** Zone furniture (bus stops). Nothing when far. */
export function meshZoneProps(b: MeshBuilder, w: World, z: Zone, lod: Lod = Lod.NEAR): void {
  if (lod === Lod.NEAR) meshZone(b, w, z);
}
