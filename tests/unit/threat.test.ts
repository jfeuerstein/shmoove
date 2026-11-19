import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
  aheadOf,
  BOSS_MARGIN,
  bossMarkerPulses,
  bossMarkerShown,
  isThreat,
  MARKER_MARGIN,
  placeMarker,
  project,
  rightOf,
  RING_CUE_SECONDS,
  ringCueStrength,
  THREAT_FULL,
  THREAT_RANGE,
  threatCount,
  ThreatView,
  type MarkerPlace,
  type Projected,
} from '../../src/ui/threat';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { BOSS, BRUISER_CHARGE, BRUISER_REST, BRUISER_TELL, BRUISER_WALK } from '../../src/sim/bosses';
import {
  addZone,
  KIND_BRUISER,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_STANDSTILL,
  makeWorld,
  SPAWN_TICKS,
  spawnEnemy,
  ZONE_RING,
} from '../../src/sim/world';

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

describe('the boss marker', () => {
  it('shows exactly when a boss is alive and out of frame', () => {
    expect(bossMarkerShown(KIND_BRUISER, false)).toBe(true);
    expect(bossMarkerShown(KIND_BRUISER, true)).toBe(false);
    expect(bossMarkerShown(-1, false)).toBe(false);
  });

  it('pulses while the Bruiser tells or charges, and not otherwise', () => {
    expect(bossMarkerPulses(KIND_BRUISER, BRUISER_TELL)).toBe(true);
    expect(bossMarkerPulses(KIND_BRUISER, BRUISER_CHARGE)).toBe(true);
    expect(bossMarkerPulses(KIND_BRUISER, BRUISER_WALK)).toBe(false);
    expect(bossMarkerPulses(KIND_BRUISER, BRUISER_REST)).toBe(false);
    expect(bossMarkerPulses(KIND_MORTAR, BRUISER_TELL)).toBe(false);
    expect(bossMarkerPulses(KIND_STANDSTILL, BRUISER_CHARGE)).toBe(false);
  });

  function build(): { view: ThreatView; sim: Sim; camera: PerspectiveCamera; boss: FakeEl; ring: FakeEl } {
    const root = new FakeEl();
    const view = new ThreatView(root as unknown as HTMLElement);
    const el = root.children[0];
    const boss = el.children.find((c) => c.className.startsWith('threat-boss'));
    const ring = el.children.find((c) => c.className === 'threat-ring');
    if (!boss || !ring) throw new Error('no boss marker or ring cue');
    const sim = new Sim(flatTerrain(170), { seed: 1, horde: true, autoPick: true });
    sim.world.spawning = false;
    sim.state.mover.x = 0;
    sim.state.mover.z = 0;
    sim.state.viewYaw = 0;
    const camera = new PerspectiveCamera(74, W / H, 0.1, 400);
    camera.position.set(0, 5.5, -7);
    camera.lookAt(0, 1, 4);
    return { view, sim, camera, boss, ring };
  }

  /** A boss of `kind` at (x, z), as the bosses' step reports it. */
  function putBoss(sim: Sim, kind: number, x: number, z: number): number {
    const i = spawnEnemy(sim.world, kind, x, 0, z);
    sim.world.horde.age[i] = SPAWN_TICKS;
    const b = sim.world.boss;
    b.kind = kind;
    b.x = x;
    b.z = z;
    return i;
  }

  /** Where the element was moved to, from its transform. */
  function at(e: FakeEl): { x: number; y: number; angle: number } {
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) rotate\((-?[\d.]+)rad\)/.exec(e.transform);
    if (!m) throw new Error(`no transform: ${e.transform}`);
    return { x: Number(m[1]), y: Number(m[2]), angle: Number(m[3]) };
  }

  it('is hidden with no boss, and with a boss in plain view', () => {
    const { view, sim, camera, boss } = build();
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(boss.hidden).toBe(true);
    putBoss(sim, KIND_BRUISER, 0, 20);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.bossShown).toBe(false);
    expect(boss.hidden).toBe(true);
  });

  it('points down from the bottom edge at a boss behind the rider, in that boss colour', () => {
    const { view, sim, camera, boss } = build();
    putBoss(sim, KIND_BRUISER, 2, -30);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.bossShown).toBe(true);
    expect(boss.hidden).toBe(false);
    const p = at(boss);
    expect(p.y).toBeCloseTo(H - BOSS_MARGIN, 0);
    expect(Math.abs(p.angle)).toBeGreaterThan(Math.PI * 0.85);
    expect(boss.vars.get('--boss-rgb')).toBe('255, 106, 61');
    // Not one of the bollards' markers.
    expect(view.shown).toBe(0);
  });

  it('points left at a boss off the left of the frame, and goes when it comes into view', () => {
    const { view, sim, camera, boss } = build();
    // Heading +z, +x is to the left.
    const i = putBoss(sim, KIND_STANDSTILL, 40, 4);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.bossShown).toBe(true);
    const p = at(boss);
    expect(p.x).toBeCloseTo(BOSS_MARGIN, 0);
    expect(p.angle).toBeCloseTo(-Math.PI / 2, 0);
    expect(boss.vars.get('--boss-rgb')).toBe('244, 240, 255');
    sim.world.horde.x[i] = 0;
    sim.world.horde.z[i] = 30;
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.bossShown).toBe(false);
    expect(boss.hidden).toBe(true);
  });

  it('pulses on the screen during the tell and the charge only', () => {
    const { view, sim, camera, boss } = build();
    const i = putBoss(sim, KIND_BRUISER, 0, -30);
    const h = sim.world.horde;
    for (const [state, pulse] of [
      [BRUISER_WALK, false],
      [BRUISER_TELL, true],
      [BRUISER_CHARGE, true],
      [BRUISER_REST, false],
    ] as const) {
      h.state[i] = state;
      view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
      expect(view.bossPulse, `state ${state}`).toBe(pulse);
      expect(boss.className.includes('threat-boss-pulse'), `state ${state}`).toBe(pulse);
    }
  });

  it('is gone when the boss falls', () => {
    const { view, sim, camera, boss } = build();
    putBoss(sim, KIND_MORTAR, 0, -30);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(boss.hidden).toBe(false);
    sim.world.horde.count = 0;
    sim.world.boss.kind = -1;
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(boss.hidden).toBe(true);
  });
});

describe('the ring cue', () => {
  const v = BOSS.standstill.ringSpeed;

  it('shows for an unseen front the rider is still outside of, under 1.2 s away, growing as it nears', () => {
    // Behind: the centre is behind the rider (ahead < 0), out of frame or not.
    const far = ringCueStrength(20, 20 - v * 1.1, -20, false);
    const near = ringCueStrength(20, 20 - v * 0.2, -20, false);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(1);
    expect(ringCueStrength(20, 20 - v * 0.5, -20, true)).toBeGreaterThan(0);
    // Ahead but out of frame.
    expect(ringCueStrength(20, 20 - v * 0.5, 15, false)).toBeGreaterThan(0);
  });

  it('does not show for a front in view ahead, one too far off, or one that has passed', () => {
    expect(ringCueStrength(20, 20 - v * 0.5, 15, true)).toBe(0);
    expect(ringCueStrength(20, 20 - v * (RING_CUE_SECONDS + 0.05), -20, false)).toBe(0);
    expect(ringCueStrength(20, 20, -20, false)).toBe(0);
    expect(ringCueStrength(20, 21, -20, false)).toBe(0);
  });

  function build(): { view: ThreatView; sim: Sim; camera: PerspectiveCamera; ring: FakeEl } {
    const root = new FakeEl();
    const view = new ThreatView(root as unknown as HTMLElement);
    const ring = root.children[0].children.find((c) => c.className === 'threat-ring');
    if (!ring) throw new Error('no ring cue');
    const sim = new Sim(flatTerrain(170), { seed: 1, horde: true, autoPick: true });
    sim.world.spawning = false;
    sim.state.mover.x = 0;
    sim.state.mover.z = 0;
    sim.state.viewYaw = 0;
    const camera = new PerspectiveCamera(74, W / H, 0.1, 400);
    camera.position.set(0, 5.5, -7);
    camera.lookAt(0, 1, 4);
    return { view, sim, camera, ring };
  }

  it('sits on the bottom edge for a ring from behind, and goes the moment the front has passed', () => {
    const { view, sim, camera, ring } = build();
    // Centre 20 m behind, front 4 m from the rider: under half a second away.
    const k = addZone(sim.world, ZONE_RING, 0, 0, -20, 16, 200, 15);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.ringCue).toBeGreaterThan(0);
    expect(ring.hidden).toBe(false);
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(ring.transform);
    expect(Number(m?.[2])).toBeCloseTo(H - MARKER_MARGIN, 0);
    const first = view.ringCue;
    sim.world.zones.r[k] = 18.5;
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.ringCue).toBeGreaterThan(first);
    sim.world.zones.r[k] = 20.2;
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.ringCue).toBe(0);
    expect(ring.hidden).toBe(true);
  });

  it('cues one ring at a time, the nearest front', () => {
    const { view, sim, camera, ring } = build();
    addZone(sim.world, ZONE_RING, 0, 0, -20, 12, 200, 15); // 8 m off: under a second
    addZone(sim.world, ZONE_RING, 30, 0, 0, 27, 200, 15); // 3 m off, from the left
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(ring.transform);
    expect(Number(m?.[1])).toBeCloseTo(MARKER_MARGIN, 0);
    expect(ring.vars.get('--cue')).toBeDefined();
  });

  it('shows nothing for a front coming at the rider in plain view', () => {
    const { view, sim, camera, ring } = build();
    addZone(sim.world, ZONE_RING, 0, 0, 30, 26, 200, 15);
    view.update(sim.world, sim.state, camera, 1 / 60, 0, W, H);
    expect(view.ringCue).toBe(0);
    expect(ring.hidden).toBe(true);
  });
});
