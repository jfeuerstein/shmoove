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

describe('chase camera obstruction', () => {
  beforeEach(() => resetFeel());

  it('does not sit behind a pillar standing between it and the skater', () => {
    // A 0.6 m pillar on the line of sight, wherever along it the pillar stands (further back than
    // the closest the camera ever comes).
    for (const back of [2.3, 2.9, 3.4, 3.7, 4.1, 4.5, 5.3, 5.9]) {
      const w = world(() => 0);
      addSolid(w, { cx: 0, cz: -back, hx: 0.3, hz: 0.3, rot: 0, yBase: 0, yTop: 9 });
      finalizeWorld(w);
      const t = target(w, 0, 0, 0, 3);
      const cam = new ChaseCamera();
      cam.setAspect(390 / 844);
      cam.snap(t);
      for (let i = 0; i < 240; i++) cam.update(t, w, 1 / 60);
      // The camera has come in front of the pillar: nothing solid between it and the skater.
      const behind = -cam.camera.position.z;
      expect(behind, `pillar ${back} m behind`).toBeLessThan(back - 0.3);
    }
  });
});

describe('chase camera under cover', () => {
  beforeEach(() => resetFeel());

  it('ducks under an awning with the skater instead of climbing onto it', () => {
    const w = world(() => 0);
    // A long awning 2.5 m up, over the skater and well behind them.
    addSolid(w, { cx: 0, cz: -4, hx: 6, hz: 8, rot: 0, yBase: 2.5, yTop: 2.7, surface: Surface.AWNING, oneWay: true });
    finalizeWorld(w);
    const t = target(w, 0, 0, 0, 4);
    const cam = new ChaseCamera();
    cam.setAspect(390 / 844);
    cam.snap(t);
    for (let i = 0; i < 240; i++) cam.update(t, w, 1 / 60);
    expect(cam.camera.position.y).toBeLessThan(2.5);
    cam.camera.updateMatrixWorld(true);
    const feet = new THREE.Vector3(t.x, t.y, t.z).project(cam.camera).y;
    expect(feet).toBeGreaterThan(LOWEST);
    expect(feet).toBeLessThan(0.3);
  });

  it('stays at its full distance on open ground and on a long flight of stairs', () => {
    const flat = world(() => 0);
    finalizeWorld(flat);
    const stairs = world((_x, z) => -z * 0.45);
    finalizeWorld(stairs);
    for (const w of [flat, stairs]) {
      const t = target(w, 0, 0, 0, 6);
      const cam = new ChaseCamera();
      cam.setAspect(390 / 844);
      cam.snap(t);
      for (let i = 0; i < 240; i++) cam.update(t, w, 1 / 60);
      // Further back than the closest it pulls in by a wide margin: nothing was in the way.
      expect(Math.hypot(cam.camera.position.x - t.x, cam.camera.position.z - t.z)).toBeGreaterThan(5);
    }
  });
});
