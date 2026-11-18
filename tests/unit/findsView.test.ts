import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TILE_RANGE, createFindsView } from '../../src/render/findsView';
import { STREET_PALETTE, createSkaterView } from '../../src/render/skater';
import { resetFeel } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { placePlayer } from '../../src/sim/player';
import { Mode } from '../../src/sim/types';
import { addPickup, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';

function world(): World {
  const w = createWorld({ seed: 1, minX: -200, minZ: -200, cell: 4, nx: 100, nz: 100 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.spawn = { x: 0, z: 0, heading: 0 };
  finalizeWorld(w);
  addPickup(w, 'tile', 0, 1, 10, 0);
  addPickup(w, 'tile', 5, 1, 20, 1);
  addPickup(w, 'tile', -5, 1, 30, 2);
  // Beyond the range of a camera at the origin.
  addPickup(w, 'tile', 0, 1, TILE_RANGE + 20, 0);
  for (let i = 0; i < 5; i++) addPickup(w, 'tile', -150 + i * 3, 1, -150, 0);
  return w;
}

function setup(): { game: Game; scene: THREE.Scene; cam: THREE.PerspectiveCamera; meshes: () => THREE.Mesh[] } {
  resetFeel();
  const game = new Game(world(), { seed: 1, startDayFrac: 0.3, errands: [], conductors: [] });
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  return { game, scene, cam, meshes: () => scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh) };
}

const step = (game: Game, n: number): void => {
  for (let i = 0; i < n; i++) game.step({ steer: 0, hold: false, hop: false });
};

describe('finds view', () => {
  it('draws the tiles in range in one mesh, none beyond 120 m, and drops a taken one', () => {
    const { game, scene, cam, meshes } = setup();
    const view = createFindsView(scene);
    expect(meshes()).toHaveLength(2);
    view.update(game, [], cam, 1 / 60);
    expect(view.drawn).toBe(3);
    const tiles = scene.getObjectByName('tiles') as THREE.Mesh;
    const bursts = scene.getObjectByName('tileBursts') as THREE.Mesh;
    expect(tiles.visible).toBe(true);
    expect(bursts.visible).toBe(false);
    const tris = (tiles.geometry.drawRange.count as number) / 3;
    expect(tris).toBeGreaterThan(30);
    // Glows at night: the faces carry glow, so the night ink lights them.
    const glow = tiles.geometry.getAttribute('glow');
    let lit = 0;
    for (let i = 0; i < glow.count; i++) if (glow.getX(i) > 0) lit++;
    expect(lit).toBeGreaterThan(0);
    // Take the first: it goes, and a burst flies for a moment.
    const p = game.sim.player;
    placePlayer(game.sim.world, p, 0, 9.5, 0);
    p.mode = Mode.AIR;
    p.vy = 0;
    p.vz = 1;
    step(game, 1);
    expect(game.events.some((e) => e.type === 'tile')).toBe(true);
    view.update(game, game.events, cam, 1 / 60);
    expect(view.drawn).toBe(2);
    expect(view.bursts).toBe(1);
    expect(bursts.visible).toBe(true);
    for (let i = 0; i < 60; i++) view.update(game, [], cam, 1 / 60);
    expect(view.bursts).toBe(0);
    expect(bursts.visible).toBe(false);
    // The far group comes in when the camera goes to it.
    cam.position.set(-140, 5, -140);
    step(game, 5);
    view.update(game, [], cam, 1 / 60);
    expect(view.drawn).toBe(5);
    cam.position.set(0, 5, 2000);
    step(game, 5);
    view.update(game, [], cam, 1 / 60);
    expect(view.drawn).toBe(0);
    expect(tiles.visible).toBe(false);
    view.dispose();
  });

  it('turns on twos: the tiles change only when the animation frame does', () => {
    const { game, scene, cam } = setup();
    const view = createFindsView(scene);
    const tiles = scene.getObjectByName('tiles') as THREE.Mesh;
    const pos = tiles.geometry.getAttribute('position') as THREE.BufferAttribute;
    view.update(game, [], cam, 1 / 60);
    const v0 = pos.version;
    step(game, 1);
    view.update(game, [], cam, 1 / 60);
    step(game, 5);
    view.update(game, [], cam, 1 / 60);
    // At most one rewrite for the frame that changed (and none for the tick inside the frame).
    expect(pos.version - v0).toBeLessThanOrEqual(2);
    expect(pos.version - v0).toBeGreaterThanOrEqual(1);
  });

  it('dresses the skater in the worn deck and kit', () => {
    const { game, scene, cam } = setup();
    const skater = createSkaterView();
    const seen: number[] = [];
    const orig = skater.setPalette;
    skater.setPalette = (p) => {
      seen.push(p.deckBase, p.shirt);
      orig(p);
    };
    const view = createFindsView(scene, skater);
    view.update(game, [], cam, 1 / 60);
    expect(seen).toEqual([STREET_PALETTE.deckBase, STREET_PALETTE.shirt]);
    view.update(game, [], cam, 1 / 60);
    expect(seen).toHaveLength(2);
    // Tiles taken: the first deck unlocks at one (thresholds scale to a world of nine); wear it.
    for (const t of game.sim.world.pickups.slice(0, 3)) {
      const p = game.sim.player;
      placePlayer(game.sim.world, p, t.x, t.z - 0.5, 0);
      p.mode = Mode.AIR;
      p.vy = 0;
      step(game, 1);
    }
    expect(game.findsWear('deck.mangoCheck').ok).toBe(true);
    view.update(game, [], cam, 1 / 60);
    expect(seen.slice(2)).toEqual([0x1b1a2e, STREET_PALETTE.shirt]);
  });
});
