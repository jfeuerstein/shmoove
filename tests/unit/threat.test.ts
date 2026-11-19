import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  aheadOf,
  isThreat,
  MARKER_MARGIN,
  placeMarker,
  project,
  rightOf,
  THREAT_FULL,
  THREAT_RANGE,
  threatCount,
  ThreatView,
  type MarkerPlace,
  type Projected,
} from '../../src/ui/threat';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { KIND_SHUFFLER, makeWorld, SPAWN_TICKS, spawnEnemy } from '../../src/sim/world';

const W = 390;
const H = 844;

/** A chase camera behind a mover at the origin heading +z (view yaw 0), as in the game. */
function chaseViewProj(): number[] {
  const cam = new PerspectiveCamera(74, W / H, 0.1, 400);
  cam.position.set(0, 5.5, -7);
  cam.lookAt(0, 1, 4);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse).toArray();
}

function place(): MarkerPlace {
  return { x: 0, y: 0, angle: 0, edge: 'top' };
}

describe('view frame', () => {
  it('measures ahead and right along the view yaw (left of +z is +x)', () => {
    expect(aheadOf(0, 5, 0)).toBeCloseTo(5);
    expect(rightOf(0, 5, 0)).toBeCloseTo(0);
    expect(rightOf(-3, 0, 0)).toBeCloseTo(3);
    expect(rightOf(3, 0, 0)).toBeCloseTo(-3);
    // Heading +x: ahead is +x; turning left from +x leads to -z, so right is +z.
    expect(aheadOf(4, 0, Math.PI / 2)).toBeCloseTo(4);
    expect(rightOf(0, 2, Math.PI / 2)).toBeCloseTo(2);
  });

  it('projects into the frame only what the camera sees', () => {
    const vp = chaseViewProj();
    const p: Projected = { x: 0, y: 0, w: 0 };
    expect(project(vp, 0, 1, 6, p)).toBe(true);
    expect(project(vp, 0, 1, -20, p)).toBe(false);
    expect(p.w).toBeLessThan(0);
    expect(project(vp, 12, 1, 3, p)).toBe(false);
  });

  it('puts what rightOf calls right on the right of the screen', () => {
    const vp = chaseViewProj();
    const p: Projected = { x: 0, y: 0, w: 0 };
    project(vp, 2, 1, 8, p);
    expect(rightOf(2, 8, 0)).toBeLessThan(0);
    expect(p.x).toBeLessThan(0);
    project(vp, -2, 1, 8, p);
    expect(rightOf(-2, 8, 0)).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(0);
  });
});

describe('isThreat', () => {
  it('counts what is behind, even in frame', () => {
    expect(isThreat(0, -5, 0, true)).toBe(true);
    expect(isThreat(2, -1, 0, false)).toBe(true);
  });

  it('does not count what is ahead and in frame', () => {
    expect(isThreat(0, 6, 0, true)).toBe(false);
    expect(isThreat(-3, 9, 0, true)).toBe(false);
  });

  it('counts what is ahead but out of frame', () => {
    expect(isThreat(10, 3, 0, false)).toBe(true);
  });

  it('does not count anything out of range', () => {
    expect(isThreat(0, -(THREAT_RANGE + 0.5), 0, true)).toBe(false);
    expect(isThreat(THREAT_RANGE, 1, 0, false)).toBe(false);
  });

  it('turns with the view', () => {
    // Facing +x: something at -x is behind.
    expect(isThreat(-5, 0, Math.PI / 2, true)).toBe(true);
    expect(isThreat(5, 0, Math.PI / 2, true)).toBe(false);
  });
});

describe('threatCount', () => {
  it('counts risen enemies in range that are behind or out of frame', () => {
    const w = makeWorld(1);
    const vp = chaseViewProj();
    const put = (x: number, z: number, age = SPAWN_TICKS): void => {
      const i = spawnEnemy(w, KIND_SHUFFLER, x, 0, z);
      w.horde.age[i] = age;
    };
    put(0, -4); // behind (between the mover and the camera): counts
    put(12, 3); // ahead, off the side of the narrow frame: counts
    put(0, 8); // ahead, in frame: no
    put(-1, 4); // ahead, in frame: no
    put(0, -20); // behind but out of range: no
    put(1, -3, 0); // behind but still rising: no
    const dead = spawnEnemy(w, KIND_SHUFFLER, -1, 0, -2);
    w.horde.age[dead] = SPAWN_TICKS;
    w.horde.hp[dead] = 0; // dead this tick: no
    expect(threatCount(w, 0, 0, 0, vp)).toBe(2);
  });
});

describe('placeMarker', () => {
  const ox = W / 2;
  const oy = H * 0.6;

  it('pins something to the left on the left edge, pointing left', () => {
    const m = place();
    placeMarker(-10, 0, ox, oy, W, H, MARKER_MARGIN, m);
    expect(m.edge).toBe('left');
    expect(m.x).toBeCloseTo(MARKER_MARGIN);
    expect(m.y).toBeCloseTo(oy);
    expect(m.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('pins something to the right on the right edge, pointing right', () => {
    const m = place();
    placeMarker(10, 2, ox, oy, W, H, MARKER_MARGIN, m);
    expect(m.edge).toBe('right');
    expect(m.x).toBeCloseTo(W - MARKER_MARGIN);
    expect(m.y).toBeLessThan(oy);
    expect(m.angle).toBeGreaterThan(0);
    expect(m.angle).toBeLessThan(Math.PI / 2);
  });

  it('pins something behind on the bottom edge, pointing down', () => {
    const m = place();
    placeMarker(1, -20, ox, oy, W, H, MARKER_MARGIN, m);
    expect(m.edge).toBe('bottom');
    expect(m.y).toBeCloseTo(H - MARKER_MARGIN);
    expect(m.x).toBeGreaterThan(ox);
    expect(Math.abs(m.angle)).toBeGreaterThan(Math.PI * 0.9);
  });

  it('pins something far ahead on the top edge', () => {
    const m = place();
    placeMarker(0, 30, ox, oy, W, H, MARKER_MARGIN, m);
    expect(m.edge).toBe('top');
    expect(m.y).toBeCloseTo(MARKER_MARGIN);
    expect(m.angle).toBeCloseTo(0);
  });

  it('agrees with the view frame: a bollard due +x of a mover heading +z is on the left', () => {
    const m = place();
    placeMarker(rightOf(30, 0, 0), aheadOf(30, 0, 0), ox, oy, W, H, MARKER_MARGIN, m);
    expect(m.edge).toBe('left');
  });

  it('always lands on the inset screen rectangle', () => {
    const m = place();
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      placeMarker(Math.cos(t), Math.sin(t), ox, oy, W, H, MARKER_MARGIN, m);
      expect(m.x).toBeGreaterThanOrEqual(MARKER_MARGIN - 1e-6);
      expect(m.x).toBeLessThanOrEqual(W - MARKER_MARGIN + 1e-6);
      expect(m.y).toBeGreaterThanOrEqual(MARKER_MARGIN - 1e-6);
      expect(m.y).toBeLessThanOrEqual(H - MARKER_MARGIN + 1e-6);
      const onEdge =
        Math.abs(m.x - MARKER_MARGIN) < 1e-6 ||
        Math.abs(m.x - (W - MARKER_MARGIN)) < 1e-6 ||
        Math.abs(m.y - MARKER_MARGIN) < 1e-6 ||
        Math.abs(m.y - (H - MARKER_MARGIN)) < 1e-6;
      expect(onEdge).toBe(true);
    }
  });
});

/** Just enough of an element for the view to build and write to. */
class FakeEl {
  className = '';
  hidden = false;
  opacity = '';
  transform = '';
  readonly children: FakeEl[] = [];
  readonly vars = new Map<string, string>();
  readonly ownerDocument = { createElement: (): FakeEl => new FakeEl() };
  get style(): FakeEl {
    return this;
  }
  setProperty(k: string, v: string): void {
    this.vars.set(k, v);
  }
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

describe('ThreatView glow', () => {
  function build(): { view: ThreatView; sim: Sim; camera: PerspectiveCamera; glow: FakeEl } {
    const root = new FakeEl();
    const view = new ThreatView(root as unknown as HTMLElement);
    const glow = root.children[0].children[0];
    const sim = new Sim(flatTerrain(170), { seed: 1, horde: true, autoPick: true });
    sim.world.spawning = false;
    const camera = new PerspectiveCamera(74, W / H, 0.1, 400);
    camera.position.set(0, 5.5, -7);
    camera.lookAt(0, 1, 4);
    return { view, sim, camera, glow };
  }

  /** The mover at the origin heading +z, with THREAT_FULL enemies right behind it. */
  function crowdBehind(sim: Sim): void {
    sim.state.mover.x = 0;
    sim.state.mover.z = 0;
    sim.state.viewYaw = 0;
    for (let i = 0; i < THREAT_FULL; i++) {
      const j = spawnEnemy(sim.world, KIND_SHUFFLER, i - 2.5, 0, -6);
      sim.world.horde.age[j] = SPAWN_TICKS;
    }
  }

  it('follows a step change in the count about 63% of the way in a third of a second', () => {
    const { view, sim, camera } = build();
    crowdBehind(sim);
    const frames = 20; // a third of a second at 60 fps
    for (let f = 0; f < frames; f++) view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.strength).toBeGreaterThan(0.58);
    expect(view.strength).toBeLessThan(0.68);
    // It keeps climbing toward full.
    for (let f = 0; f < 600; f++) view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.strength).toBeGreaterThan(0.99);
  });

  it('reset zeroes the glow, in the number and on the screen', () => {
    const { view, sim, camera, glow } = build();
    crowdBehind(sim);
    for (let f = 0; f < 120; f++) view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.strength).toBeGreaterThan(0.5);
    expect(Number(glow.opacity)).toBeGreaterThan(0.5);
    view.reset();
    expect(view.strength).toBe(0);
    expect(glow.opacity).toBe('0');
    // The next run's empty bowl starts from nothing, not from the old strength.
    sim.reset();
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.strength).toBe(0);
    expect(glow.opacity).toBe('0');
  });
});
