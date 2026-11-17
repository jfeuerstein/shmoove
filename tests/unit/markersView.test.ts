import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMarkersView } from '../../src/render/markersView';
import { resetFeel } from '../../src/sim/constants';
import { OFFER_FILL_TICKS, type ErrandDef } from '../../src/sim/game/errands';
import { Game } from '../../src/sim/game/game';
import { compileLine } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { addZone, createWorld, fillSurfaces, finalizeWorld, Surface, type World } from '../../src/sim/world';
import { testLine } from '../sim/helpers';

function world(): World {
  const w = createWorld({ seed: 1, minX: -100, minZ: -100, cell: 4, nx: 50, nz: 50 });
  fillSurfaces(w, () => Surface.PLAZA);
  w.lines = [compileLine(testLine({ vehicles: 2 }), 0)];
  w.spawn = { x: 0, z: 0, heading: 0 };
  finalizeWorld(w);
  addZone(w, { id: 'giver', name: 'giver', kind: 'landmark', x: 0, y: 0, z: 0, r: 5 });
  addZone(w, { id: 'east', name: 'east', kind: 'landmark', x: 20, y: 0, z: 0, r: 5 });
  addZone(w, { id: 'west', name: 'west', kind: 'landmark', x: -20, y: 0, z: 0, r: 5 });
  return w;
}

const ERR: ErrandDef = {
  id: 'e1',
  title: 'Test',
  giver: 'giver',
  district: 0,
  brief: 'Do it.',
  limitTicks: 2 * 3600,
  steps: [
    { kind: 'reach', zone: 'east' },
    { kind: 'reach', zone: 'west' },
  ],
};

function setup(): { game: Game; scene: THREE.Scene; mesh: (name: string) => THREE.Mesh; frameUpdate: () => void } {
  resetFeel();
  const w = world();
  const game = new Game(w, { seed: 1, startDayFrac: 0.3, errands: [ERR], conductors: [] });
  const scene = new THREE.Scene();
  const view = createMarkersView(scene, w, game);
  const mesh = (name: string): THREE.Mesh => {
    const m = scene.getObjectByName(name);
    if (!(m instanceof THREE.Mesh)) throw new Error(`no mesh ${name}`);
    return m;
  };
  return { game, scene, mesh, frameUpdate: () => view.update(game, 0, 1 / 60) };
}

/** Positions of a geometry, copied (to compare the two animation frames). */
function positions(m: THREE.Mesh): number[] {
  const g = m.geometry as THREE.BufferGeometry;
  const a = g.getAttribute('position');
  return a ? Array.from(a.array as ArrayLike<number>) : [];
}

/** The giver mesh's positions on two consecutive animation frames (twos: 5 ticks apart). */
function twoFrames(game: Game, frameUpdate: () => void, mesh: (name: string) => THREE.Mesh): [number[], number[]] {
  const p = game.sim.player;
  const x = p.x;
  const z = p.z;
  const hold = (): void => {
    for (let i = 0; i < 5; i++) {
      game.step({ steer: 0, hold: false, hop: false });
      placePlayer(game.sim.world, p, x, z, 0);
      frameUpdate();
    }
  };
  hold();
  const a = positions(mesh('markers-givers'));
  hold();
  const b = positions(mesh('markers-givers'));
  return [a, b];
}

describe('markers view', () => {
  it('a giver waves while its errand is on offer, stands still with the ticket lowered while it runs, and waves again after', () => {
    const { game, mesh, frameUpdate } = setup();
    placePlayer(game.sim.world, game.sim.player, 10, 10, 0);
    frameUpdate();
    expect(mesh('markers-givers').visible).toBe(true);
    const [w0, w1] = twoFrames(game, frameUpdate, mesh);
    expect(w0.length).toBeGreaterThan(0);
    expect(w0).not.toEqual(w1);
    const waveTop = Math.max(...w0.filter((_, i) => i % 3 === 1), ...w1.filter((_, i) => i % 3 === 1));

    // Accept the errand.
    placePlayer(game.sim.world, game.sim.player, 0, 0, 0);
    for (let i = 0; i < OFFER_FILL_TICKS + 2; i++) game.step({ steer: 0, hold: true, hop: false });
    expect(game.errands.active?.id).toBe('e1');
    placePlayer(game.sim.world, game.sim.player, 10, 10, 0);
    frameUpdate();
    const [b0, b1] = twoFrames(game, frameUpdate, mesh);
    expect(b0.length).toBeGreaterThan(0);
    expect(b0).toEqual(b1);
    // The ticket is lowered: the figure's highest point is well below the held-up ticket.
    const busyTop = Math.max(...b0.filter((_, i) => i % 3 === 1));
    expect(busyTop).toBeLessThan(waveTop - 0.3);
    // The beacon is up over the first target.
    expect(mesh('markers-beacon').visible).toBe(true);

    // Abandon by running out the clock: the errand ends and the giver waves again.
    for (let i = 0; i < ERR.limitTicks + 10 && game.errands.active; i++) game.step({ steer: 0, hold: false, hop: false });
    expect(game.errands.active).toBeNull();
    placePlayer(game.sim.world, game.sim.player, 10, 10, 0);
    frameUpdate();
    const [a0, a1] = twoFrames(game, frameUpdate, mesh);
    expect(a0).not.toEqual(a1);
  });

  it('the beacon moves when the step changes and goes when the errand ends', () => {
    const { game, mesh, frameUpdate } = setup();
    const p = game.sim.player;
    placePlayer(game.sim.world, p, 0, 0, 0);
    for (let i = 0; i < OFFER_FILL_TICKS + 2; i++) game.step({ steer: 0, hold: true, hop: false });
    expect(game.errands.active?.step).toBe(0);
    for (let i = 0; i < 12; i++) frameUpdate();
    const beacon = mesh('markers-beacon');
    expect(beacon.visible).toBe(true);
    const firstGeo = beacon.geometry;
    const bx0 = positions(beacon)[0];
    expect(bx0).toBeCloseTo(20, 0);
    // Reach east: the beacon goes to west.
    placePlayer(game.sim.world, p, 20, 0, 0);
    game.step({ steer: 0, hold: false, hop: false });
    expect(game.errands.active?.step).toBe(1);
    for (let i = 0; i < 12; i++) frameUpdate();
    expect(beacon.geometry).not.toBe(firstGeo);
    expect(positions(beacon)[0]).toBeCloseTo(-20, 0);
    // Reach west: done, no beacon.
    placePlayer(game.sim.world, p, -20, 0, 0);
    game.step({ steer: 0, hold: false, hop: false });
    expect(game.errands.active).toBeNull();
    for (let i = 0; i < 12; i++) frameUpdate();
    expect(beacon.visible).toBe(false);
  });
});
