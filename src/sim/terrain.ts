import type { Vec3 } from './types';

/** A round patch on the ground that adds speed when ridden over. */
export interface BoostPad {
  x: number;
  z: number;
  radius: number;
}

/**
 * The ground. A heightfield: one height for every (x, z).
 *
 * `heightAt` must be continuous with a continuous slope (no creases): the mover rides the surface
 * and reads the normal every tick, so a crease is felt as a bump and can throw it into the air.
 */
export interface Terrain {
  /** The mover is kept inside this distance from the origin. */
  readonly radius: number;
  readonly spawnX: number;
  readonly spawnZ: number;
  /** Heading at spawn; forward(yaw) = (sin yaw, 0, cos yaw). */
  readonly spawnYaw: number;
  readonly pads: readonly BoostPad[];
  heightAt(x: number, z: number): number;
  /** Unit normal, y up. Writes into and returns `out`. */
  normalAt(x: number, z: number, out: Vec3): Vec3;
}

/** Unit normal of any height function by central differences over `eps` metres. */
export function normalFromHeights(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  eps: number,
  out: Vec3,
): Vec3 {
  const dx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
  const dz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
  const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  out.x = -dx * inv;
  out.y = inv;
  out.z = -dz * inv;
  return out;
}

/** A terrain from a height function. Used by the bowl generator and by test fixtures. */
export function terrainFromHeight(
  heightAt: (x: number, z: number) => number,
  radius: number,
  pads: readonly BoostPad[] = [],
  spawnX = 0,
  spawnZ = 0,
  spawnYaw = 0,
): Terrain {
  return {
    radius,
    spawnX,
    spawnZ,
    spawnYaw,
    pads,
    heightAt,
    normalAt: (x, z, out) => normalFromHeights(heightAt, x, z, 0.25, out),
  };
}

export function flatTerrain(radius = 2000): Terrain {
  return terrainFromHeight(() => 0, radius);
}
