/**
 * The chase camera keeps the skater on screen. Behaviour a player sees: wherever the camera is
 * squeezed or lifted, the skater's feet stay inside the frame and above the thumb zone.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChaseCamera, type CamTarget } from '../../src/render/camera';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { Mode } from '../../src/sim/types';
import { Surface, addSolid, createWorld, fillHeights, fillSurfaces, finalizeWorld, pointBlocked, terrainHeight, type World } from '../../src/sim/world';

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

describe('chase camera keeps the whole skater in view', () => {
  beforeEach(() => resetFeel());

  /** True when nothing solid lies between the camera and the skater's board or chest. */
  function seen(w: World, cam: ChaseCamera, t: CamTarget): boolean {
    const c = cam.camera.position;
    for (const up of [0.25, 1]) {
      for (let i = 1; i < 40; i++) {
        const k = i / 40;
        const x = t.x + (c.x - t.x) * k;
        const y = t.y + up + (c.y - (t.y + up)) * k;
        const z = t.z + (c.z - t.z) * k;
        if (k * Math.hypot(c.x - t.x, c.z - t.z) < 0.9 && up < 0.5) continue;
        if (pointBlocked(w, x, y, z, 0)) return false;
      }
    }
    return true;
  }

  it('an awning behind and below the camera does not come between it and the skater', () => {
    // The skater has just rolled out from beside a stall whose awning is 2.6 m up, 1 to 5 m behind them.
    const w = world(() => 0);
    addSolid(w, { cx: 0, cz: -3, hx: 3, hz: 2, rot: 0, yBase: 2.4, yTop: 2.6, surface: Surface.AWNING, oneWay: true });
    finalizeWorld(w);
    const t = target(w, 0, 0, 0, 5);
    const cam = new ChaseCamera();
    cam.setAspect(390 / 844);
    cam.snap(t);
    for (let i = 0; i < 240; i++) cam.update(t, w, 1 / 60);
    expect(seen(w, cam, t)).toBe(true);
  });

  it('a skater who drops off a ledge is not left hidden behind it', () => {
    // High ground behind (z < 0) ending in a 3 m wall; the skater is at its foot, having just dropped.
    const w = world((_x, z) => (z < -0.5 ? 3 : 0));
    finalizeWorld(w);
    const cam = new ChaseCamera();
    cam.setAspect(390 / 844);
    // Up on the ledge, rolling toward the edge...
    const up = target(w, 0, -6, 0, 6);
    cam.snap(up);
    for (let i = 0; i < 60; i++) cam.update(up, w, 1 / 60);
    // ...then on the ground below it, a moment later.
    const down = target(w, 0, 2.5, 0, 6);
    for (let i = 0; i < 30; i++) cam.update(down, w, 1 / 60);
    expect(seen(w, cam, down)).toBe(true);
  });
});

describe('chase camera under low cover', () => {
  beforeEach(() => resetFeel());

  it('ducks to the shoulder when even its closest usual position is above the awning', () => {
    // A wide awning only 1.9 m above the skater: lower than the camera ever sits at its usual height.
    const w = world(() => 0);
    addSolid(w, { cx: 0, cz: -3, hx: 8, hz: 9, rot: 0, yBase: 1.8, yTop: 1.9, surface: Surface.AWNING, oneWay: true });
    finalizeWorld(w);
    const t = target(w, 0, 0, 0, 5);
    const cam = new ChaseCamera();
    cam.setAspect(390 / 844);
    cam.snap(t);
    for (let i = 0; i < 120; i++) cam.update(t, w, 1 / 60);
    expect(cam.camera.position.y).toBeLessThan(1.8);
    cam.camera.updateMatrixWorld(true);
    const chest = new THREE.Vector3(t.x, t.y + 1, t.z).project(cam.camera);
    expect(Math.abs(chest.y)).toBeLessThan(0.8);
    // Out from under it, the camera goes back up to its usual place.
    const out = target(w, 0, 30, 0, 5);
    for (let i = 0; i < 300; i++) cam.update(out, w, 1 / 60);
    expect(cam.camera.position.y).toBeGreaterThan(FEEL.CAM_HEIGHT * 0.9);
  });

  it('does not look down through an awning at a skater below and beyond it', () => {
    // Stairs falling away ahead; an awning at the skater's old height covers the top of the flight.
    const w = world((_x, z) => (z > 0 ? -z * 0.5 : 0));
    addSolid(w, { cx: 0, cz: 2, hx: 4, hz: 5, rot: 0, yBase: 2.3, yTop: 2.5, surface: Surface.AWNING, oneWay: true });
    finalizeWorld(w);
    const cam = new ChaseCamera();
    cam.setAspect(390 / 844);
    const t = target(w, 0, -8, 0, 6);
    cam.snap(t);
    // Roll under the awning and on down the stairs.
    for (let i = 0; i < 180; i++) {
      t.z += 0.1;
      t.y = terrainHeight(w, t.x, t.z);
      cam.update(t, w, 1 / 60);
      const c = cam.camera.position;
      // Never above the awning while the skater is under or below it and the awning lies between.
      let blocked = false;
      for (let j = 1; j < 40; j++) {
        const k = j / 40;
        if (pointBlocked(w, t.x + (c.x - t.x) * k, t.y + 1 + (c.y - t.y - 1) * k, t.z + (c.z - t.z) * k, 0)) blocked = true;
      }
      expect(blocked, `z ${t.z.toFixed(1)}`).toBe(false);
    }
  });
});
