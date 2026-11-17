/**
 * Zone furniture. A 'stop' gets a bus-stop pole with a round sign and a little shelter roof, set
 * beside the zone centre on a non-street cell: decoration only, the sim knows nothing of it.
 */
import { Surface, terrainHeight, terrainSurface, topHeight, type World, type Zone } from '../../sim/world';
import type { MeshBuilder } from '../geom';
import { INK } from '../look';
import { disc2 } from './kit';

/** Sign top height above the ground; the shelter roof stays below it. */
export const STOP_SIGN_TOP = 3.05;
export const STOP_SHELTER_TOP = 2.5;

function clearSpot(w: World, x: number, z: number): boolean {
  if (terrainSurface(w, x, z) === Surface.STREET || terrainSurface(w, x, z) === Surface.WATER) return false;
  // Not inside or under a solid, and no street within 1 m.
  if (topHeight(w, x, z) > terrainHeight(w, x, z) + 0.05) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (terrainSurface(w, x + Math.cos(a), z + Math.sin(a)) === Surface.STREET) return false;
  }
  return true;
}

/** Where a stop's pole goes: about 1 m beside the zone centre, away from any street. Null if nowhere fits. */
export function stopSpot(w: World, zn: Zone): { x: number; z: number; ax: number; az: number } | null {
  for (let d = 1; d <= 6; d += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = zn.x + Math.cos(a) * d;
      const z = zn.z + Math.sin(a) * d;
      if (clearSpot(w, x, z)) return { x, z, ax: Math.cos(a), az: Math.sin(a) };
    }
  }
  return null;
}

export function meshZone(b: MeshBuilder, w: World, zn: Zone): void {
  if (zn.kind !== 'stop') return;
  const s = stopSpot(w, zn);
  if (!s) return;
  const g = terrainHeight(w, s.x, s.z);
  // Pole and round sign facing back toward the stop.
  b.beam(s.x, g, s.z, s.x, g + STOP_SIGN_TOP - 0.4, s.z, 0.045, INK.ink);
  disc2(b, s.x, g + STOP_SIGN_TOP - 0.4, s.z, -s.ax, -s.az, 0.4, 10, INK.mango, INK.mango, 0.5);
  disc2(b, s.x, g + STOP_SIGN_TOP - 0.4, s.z, -s.ax, -s.az, 0.16, 8, INK.ink, INK.ink);
  // Shelter: a small roof on two posts, further from the street, lower than the sign.
  const ox = s.x + s.ax * 0.9;
  const oz = s.z + s.az * 0.9;
  if (!clearSpot(w, ox, oz)) return;
  const tx = -s.az;
  const tz = s.ax;
  const gy = terrainHeight(w, ox, oz);
  for (const sgn of [-1, 1]) {
    const px = ox + tx * 0.75 * sgn;
    const pz = oz + tz * 0.75 * sgn;
    b.beam(px, terrainHeight(w, px, pz), pz, px, gy + STOP_SHELTER_TOP - 0.08, pz, 0.035, INK.cobalt);
  }
  b.box(ox, gy + STOP_SHELTER_TOP - 0.05, oz, 0.9, 0.05, 0.55, tx, tz, INK.cobalt, { top: INK.mango, bottom: true });
  b.box(ox, gy + 0.45, oz, 0.7, 0.04, 0.18, tx, tz, INK.mango, { bottom: true });
}
