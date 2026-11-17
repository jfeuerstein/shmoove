/**
 * The chase camera keeps the skater on screen. Behaviour a player sees: wherever the camera is
 * squeezed or lifted, the skater's feet stay inside the frame and above the thumb zone.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChaseCamera, type CamTarget } from '../../src/render/camera';
import { resetFeel } from '../../src/sim/constants';
import { Mode } from '../../src/sim/types';
import { Surface, addSolid, createWorld, fillHeights, fillSurfaces, finalizeWorld, terrainHeight, type World } from '../../src/sim/world';

function world(height: (x: number, z: number) => number): World {
  const w = createWorld({ seed: 1, minX: -120, minZ: -120, cell: 3, nx: 80, nz: 80 });
  fillHeights(w, height);
  fillSurfaces(w, () => Surface.PLAZA);
  return w;
}

function target(w: World, x: number, z: number, heading: number, speed: number, mode: number = Mode.GROUND): CamTarget {
  return {
    x,
    y: terrainHeight(w, x, z),
    z,
    vx: Math.sin(heading) * speed,
    vz: Math.cos(heading) * speed,
    heading,
    mode,
    speed,
    surface: Surface.PLAZA,
    rideYaw: null,
  };
}

/** Screen height of the skater's feet after the camera settles: -1 bottom edge, 0 centre, 1 top. */
function feetOnScreen(w: World, t: CamTarget, seconds = 4): number {
  const cam = new ChaseCamera();
  cam.setAspect(390 / 844);
  cam.snap(t);
  for (let i = 0; i < seconds * 60; i++) cam.update(t, w, 1 / 60);
  cam.camera.updateMatrixWorld(true);
  return new THREE.Vector3(t.x, t.y, t.z).project(cam.camera).y;
}

/** The bottom tenth of the screen is under the player's thumb and the hold cue. */
const LOWEST = -0.72;

describe('chase camera framing', () => {
  beforeEach(() => resetFeel());

  it('frames the skater in the lower half on open flat ground', () => {
    const w = world(() => 0);
    finalizeWorld(w);
    const y = feetOnScreen(w, target(w, 0, 0, 0, 8));
    expect(y).toBeLessThan(-0.2);
    expect(y).toBeGreaterThan(LOWEST);
  });

  it('keeps the skater in frame with a wall right behind them', () => {
    const w = world(() => 0);
    addSolid(w, { cx: 0, cz: -3, hx: 20, hz: 1, rot: 0, yBase: 0, yTop: 12 });
    finalizeWorld(w);
    expect(feetOnScreen(w, target(w, 0, 0, 0, 2))).toBeGreaterThan(LOWEST);
  });

  it('keeps the skater in frame coming off a steep flight onto a landing', () => {
    // A 1:2 flight behind (rising to the north... of the skater's back), flat ahead.
    const w = world((_x, z) => (z < 0 ? -z * 0.5 : 0));
    finalizeWorld(w);
    expect(feetOnScreen(w, target(w, 0, 1, 0, 6))).toBeGreaterThan(LOWEST);
  });

  it('keeps the skater in frame facing up a steep hill, moving or towed', () => {
    const w = world((_x, z) => Math.max(0, z) * 0.35);
    finalizeWorld(w);
    expect(feetOnScreen(w, target(w, 0, 20, 0, 5))).toBeGreaterThan(LOWEST);
    const towed = target(w, 0, 20, 0, 9, Mode.HITCH);
    towed.rideYaw = 0;
    expect(feetOnScreen(w, towed)).toBeGreaterThan(LOWEST);
  });

  it('keeps the skater in frame going down a steep flight', () => {
    const w = world((_x, z) => -z * 0.5);
    finalizeWorld(w);
    expect(feetOnScreen(w, target(w, 0, 0, 0, 7))).toBeGreaterThan(LOWEST);
  });
});
