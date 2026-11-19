import { Color, Vector3, type Mesh, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE, tone } from '../../src/render/look';
import { BOARD_TRIANGLES, DECK_HALF_LENGTH, FIGURE_TRIANGLES, MoverView } from '../../src/render/moverView';
import { P_WIDE_LOAD, PASSIVE_COUNT } from '../../src/sim/arsenal';
import { FEEL } from '../../src/sim/constants';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import type { SimState } from '../../src/sim/types';
import { makeWorld, PHASE_DEAD, type World } from '../../src/sim/world';

const terrain = flatTerrain(200);

interface Pose {
  heading?: number;
  speed?: number;
  grounded?: boolean;
  tucked?: boolean;
  y?: number;
  rail?: number;
}

function state(p: Pose): SimState {
  const s = makeSimState(terrain);
  const m = s.mover;
  m.x = 4;
  m.y = p.y ?? 0;
  m.z = -3;
  m.heading = p.heading ?? 0;
  m.speed = p.speed ?? 12;
  m.grounded = p.grounded ?? true;
  m.tucked = p.tucked ?? false;
  m.rail = p.rail ?? -1;
  m.nx = 0;
  m.ny = 1;
  m.nz = 0;
  return s;
}

function posed(p: Pose): MoverView {
  const view = new MoverView();
  const s = state(p);
  view.update(s, s, 1, terrain);
  view.object.updateMatrixWorld(true);
  return view;
}

/** Every vertex of a mesh that is drawn, in world space. */
function world(mesh: Mesh): Vector3[] {
  const pos = mesh.geometry.getAttribute('position');
  const out: Vector3[] = [];
  const n = Math.min(pos.count, mesh.geometry.drawRange.count);
  for (let i = 0; i < n; i++) out.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
  return out;
}

/** The middle of the board's front half (its nose end) and of its back half, in world space. */
function ends(view: MoverView): { nose: Vector3; tail: Vector3 } {
  const pos = view.board.geometry.getAttribute('position');
  const nose = new Vector3();
  const tail = new Vector3();
  let nn = 0;
  let nt = 0;
  // Each corner once, however many triangles share it.
  const seen = new Set<string>();
  const n = Math.min(pos.count, view.board.geometry.drawRange.count);
  for (let i = 0; i < n; i++) {
    const key = `${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(view.board.matrixWorld);
    if (pos.getZ(i) > 0) {
      nose.add(v);
      nn++;
    } else {
      tail.add(v);
      nt++;
    }
  }
  return { nose: nose.divideScalar(nn), tail: tail.divideScalar(nt) };
}

function top(view: MoverView): number {
  return Math.max(...world(view.figure).map((v) => v.y));
}

describe('MoverView: a rider on a board', () => {
  it('is a board of about 0.9 m by 0.25 m and a figure, at most 700 triangles in all, the figure in the mover colour', () => {
    const view = posed({});
    const figure = view.figure.geometry.getAttribute('position').count / 3;
    const board = view.board.geometry.getAttribute('position').count / 3;
    expect(figure).toBe(FIGURE_TRIANGLES);
    expect(board).toBe(BOARD_TRIANGLES);
    expect(figure + board).toBeLessThanOrEqual(700);
    // Facing +z: the board runs along z.
    const b = world(view.board);
    const len = Math.max(...b.map((v) => v.z)) - Math.min(...b.map((v) => v.z));
    const wide = Math.max(...b.map((v) => v.x)) - Math.min(...b.map((v) => v.x));
    expect(len).toBeCloseTo(DECK_HALF_LENGTH * 2, 2);
    expect(wide).toBeGreaterThan(0.2);
    expect(wide).toBeLessThan(0.3);
    // The figure stands on it, side-on: wider along the board than across, and about a rider tall.
    const f = world(view.figure);
    expect(Math.min(...f.map((v) => v.y))).toBeGreaterThan(Math.max(...b.map((v) => v.y)) - 0.1);
    expect(top(view)).toBeGreaterThan(1.3);
    expect(top(view)).toBeLessThan(2);
    const mat = view.figure.material as MeshLambertMaterial;
    expect(mat.color.getHex()).toBe(new Color(PALETTE.mover).getHex());
    expect(mat.emissiveIntensity).toBeGreaterThan((view.board.material as MeshLambertMaterial).emissiveIntensity);
    // The blob shadow is still on the ground under it.
    expect(view.shadow.position.x).toBeCloseTo(4, 5);
    expect(view.shadow.position.z).toBeCloseTo(-3, 5);
  });

  it('crouches low coasting, stands tall pushing, and rides between', () => {
    const coast = top(posed({ tucked: true, speed: 14 }));
    const push = top(posed({ tucked: false, speed: FEEL.runSpeed * 0.5 }));
    const ride = top(posed({ tucked: false, speed: FEEL.runSpeed * 1.4 }));
    expect(coast).toBeLessThan(push - 0.25);
    expect(ride).toBeLessThan(push);
    expect(ride).toBeGreaterThan(coast);
  });

  it('in the air brings the board\'s nose up and tucks the figure', () => {
    const ground = posed({ speed: FEEL.runSpeed * 1.4 });
    const air = posed({ grounded: false, y: 2, speed: FEEL.runSpeed * 1.4 });
    const g = ends(ground);
    const a = ends(air);
    expect(Math.abs(g.nose.y - g.tail.y)).toBeLessThan(1e-4);
    expect(a.nose.y - a.tail.y).toBeGreaterThan(0.1);
    expect(top(air) - 2).toBeLessThan(top(ground));
  });

  it('points the board along the heading', () => {
    for (const heading of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const { nose, tail } = ends(posed({ heading }));
      const d = nose.clone().sub(tail);
      d.y = 0;
      d.normalize();
      expect(d.x).toBeCloseTo(Math.sin(heading), 4);
      expect(d.z).toBeCloseTo(Math.cos(heading), 4);
    }
  });

  it('leans into a turn', () => {
    const view = new MoverView();
    const a = state({ heading: 0, speed: 14 });
    const b = state({ heading: 0.05, speed: 14 });
    view.update(a, b, 1, terrain);
    view.object.updateMatrixWorld(true);
    // Turning left (toward +x): the head goes over toward +x of the line of travel.
    const f = world(view.figure);
    const head = f.reduce((m, v) => (v.y > m.y ? v : m));
    const along = new Vector3(Math.sin(0.05), 0, Math.cos(0.05));
    const left = new Vector3(along.z, 0, -along.x);
    const straight = posed({ heading: 0.05, speed: 14 });
    const head0 = world(straight.figure).reduce((m, v) => (v.y > m.y ? v : m));
    expect(head.clone().sub(head0).dot(left)).toBeGreaterThan(0.1);
  });

  it('eases from one pose to the next', () => {
    const view = new MoverView();
    const coast = state({ tucked: true });
    const push = state({ tucked: false, speed: 2 });
    view.update(coast, coast, 1, terrain);
    expect(view.crouch).toBe(1);
    view.update(push, push, 1, terrain, 1 / 60);
    expect(view.crouch).toBeGreaterThan(0.2);
    expect(view.crouch).toBeLessThan(1);
    for (let i = 0; i < 60; i++) view.update(push, push, 1, terrain, 1 / 60);
    expect(view.crouch).toBeLessThan(0.01);
  });

  it('on a rail boardslides: the board across the rail with its deck on the bar, crouched, arms spread wide', () => {
    for (const heading of [0, 0.9, -2.2]) {
      const ride = posed({ heading, speed: FEEL.runSpeed * 1.4 });
      const air = posed({ heading, grounded: false, y: 1.2, speed: FEEL.runSpeed * 1.4 });
      const grind = posed({ heading, grounded: false, y: 1.2, rail: 0, speed: FEEL.runSpeed * 1.4 });
      expect(grind.grinding).toBe(true);
      expect(ride.grinding).toBe(false);
      // The board's length lies across the way it is going, level.
      const { nose, tail } = ends(grind);
      const d = nose.clone().sub(tail);
      expect(Math.abs(d.y)).toBeLessThan(1e-4);
      d.y = 0;
      d.normalize();
      expect(Math.abs(d.x * Math.sin(heading) + d.z * Math.cos(heading))).toBeLessThan(1e-4);
      // Riding and in the air it points along the heading.
      for (const v of [ride, air]) {
        const e = ends(v);
        const f = e.nose.clone().sub(e.tail);
        f.y = 0;
        f.normalize();
        expect(f.x * Math.sin(heading) + f.z * Math.cos(heading)).toBeGreaterThan(0.99);
      }
      // The deck rests on the bar: its underside at the rider's height, not on wheels above it.
      const deckLow = Math.min(...world(grind.board).filter((v) => v.y > 1.2 - 0.02).map((v) => v.y));
      expect(deckLow).toBeCloseTo(1.2, 2);
      // Crouched lower than riding, and the arms spread wider than in either other pose.
      expect(top(grind) - 1.2).toBeLessThan(top(ride) - 0.1);
      const span = (v: MoverView): number => {
        const pts = world(v.figure);
        // Measured along the board, wherever it points.
        const e = ends(v);
        const along = e.nose.clone().sub(e.tail).setY(0).normalize();
        return Math.max(...pts.map((p) => p.dot(along))) - Math.min(...pts.map((p) => p.dot(along)));
      };
      expect(span(grind)).toBeGreaterThan(span(ride) + 0.3);
      expect(span(grind)).toBeGreaterThan(span(air) + 0.3);
      expect(grind.spread).toBe(1);
      expect(ride.spread).toBe(0);
    }
  });
});

describe('MoverView: a character', () => {
  /** Total area of the triangles a mesh draws, m². */
  function area(mesh: Mesh): number {
    const p = mesh.geometry.getAttribute('position');
    const n = Math.min(p.count, mesh.geometry.drawRange.count);
    let sum = 0;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i < n; i += 3) {
      a.set(p.getX(i), p.getY(i), p.getZ(i));
      b.set(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)).sub(a);
      c.set(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)).sub(a);
      sum += b.cross(c).length() / 2;
    }
    return sum;
  }

  function withWorld(p: Pose, w: World, frames = 1, dt = 1 / 60): MoverView {
    const view = new MoverView();
    const s = state(p);
    for (let i = 0; i < frames; i++) view.update(s, s, 1, terrain, dt, w);
    view.object.updateMatrixWorld(true);
    return view;
  }

  it('bakes tones of the palette into its vertices: a light face, a dark visor, the accent helmet', () => {
    const view = posed({});
    const col = view.figure.geometry.getAttribute('color');
    const n = view.figure.geometry.drawRange.count;
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(`${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`);
    const has = (hex: number): boolean => {
      const c = new Color(hex);
      return seen.has(`${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`);
    };
    expect(has(PALETTE.mover)).toBe(true);
    expect(has(PALETTE.accent)).toBe(true);
    expect(has(tone(PALETTE.accent, -0.82))).toBe(true);
    expect(has(tone(PALETTE.mover, 0.58))).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    // Tucked, the hoodie turns the tuck colour.
    const tuck = posed({ tucked: true });
    const tc = tuck.figure.geometry.getAttribute('color');
    const want = new Color(PALETTE.moverTuck);
    let found = false;
    for (let i = 0; i < tuck.figure.geometry.drawRange.count; i++) if (Math.abs(tc.getX(i) - want.r) + Math.abs(tc.getY(i) - want.g) + Math.abs(tc.getZ(i) - want.b) < 1e-4) found = true;
    expect(found).toBe(true);
  });

  it('pushes: on the flat below run speed the back foot leaves the board, plants on the ground and swings back', () => {
    const view = new MoverView();
    const s = state({ speed: FEEL.runSpeed * 0.4 });
    let lowest = Infinity;
    let behind = Infinity;
    for (let i = 0; i < 90; i++) {
      view.update(s, s, 1, terrain, 1 / 60);
      view.object.updateMatrixWorld(true);
      // The board's frame: x the side it faces, z the nose (heading 0, so the world's).
      const f = world(view.figure);
      // The lowest point of the figure (a shoe sole), and how far back along the board it reaches.
      for (const v of f) {
        if (v.y < lowest) lowest = v.y;
        if (v.y < 0.1 && v.z - -3 < behind) behind = v.z - -3;
      }
    }
    expect(view.push).toBeGreaterThan(0.9);
    // Down on the ground (below the deck's top), and back past the tail.
    expect(lowest).toBeLessThan(0.05);
    expect(behind).toBeLessThan(-DECK_HALF_LENGTH);
    // Riding at speed, both feet stay on the deck.
    const ride = withWorld({ speed: FEEL.runSpeed * 1.4 }, makeWorld(1), 60);
    expect(Math.min(...world(ride.figure).map((v) => v.y))).toBeGreaterThan(0.12);
  });

  it('turns its wheels with speed and leaves them when still', () => {
    const view = new MoverView();
    const fast = state({ speed: 12 });
    view.update(fast, fast, 1, terrain, 1 / 60);
    const before = view.wheelTurn;
    const pos0 = Array.from(view.board.geometry.getAttribute('position').array);
    view.update(fast, fast, 1, terrain, 1 / 60);
    expect(view.wheelTurn).not.toBeCloseTo(before, 3);
    const pos1 = Array.from(view.board.geometry.getAttribute('position').array);
    expect(pos1.some((v, i) => Math.abs(v - pos0[i]) > 1e-4)).toBe(true);
    const still = state({ speed: 0 });
    view.update(still, still, 1, terrain, 1 / 60);
    const t = view.wheelTurn;
    view.update(still, still, 1, terrain, 1 / 60);
    expect(view.wheelTurn).toBe(t);
  });

  it('pops the nose highest at the start of an ollie and absorbs a hard landing in a crouch', () => {
    const pop = posed({ grounded: false, y: 0.3, speed: 12 });
    const s = state({ grounded: false, y: 1.5, speed: 12 });
    s.mover.airTicks = 30;
    const late = new MoverView();
    late.update(s, s, 1, terrain);
    expect(pop.pitch).toBeGreaterThan(late.pitch + 0.1);
    expect(late.pitch).toBeGreaterThan(0.1);
    const land = state({ speed: FEEL.runSpeed * 1.4 });
    land.mover.groundTicks = 2;
    land.mover.impact = 9;
    const absorbing = new MoverView();
    absorbing.update(land, land, 1, terrain);
    absorbing.object.updateMatrixWorld(true);
    const ride = posed({ speed: FEEL.runSpeed * 1.4 });
    expect(top(absorbing)).toBeLessThan(top(ride) - 0.1);
  });

  it('flinches when hit and blinks while nothing can hurt it', () => {
    const w = makeWorld(1);
    const calm = withWorld({}, w);
    w.player.invuln = FEEL.invulnTicks;
    const hit = withWorld({}, w);
    expect(hit.flinch).toBe(1);
    expect(calm.flinch).toBe(0);
    // Thrown back: the head goes toward -x (away from the side it faces).
    const head = (v: MoverView): Vector3 => world(v.figure).reduce((m, p) => (p.y > m.y ? p : m));
    expect(head(hit).x).toBeLessThan(head(calm).x - 0.05);
    const blinks = new Set<boolean>();
    for (let t = FEEL.invulnTicks; t > 0; t--) {
      w.player.invuln = t;
      blinks.add(withWorld({}, w).blink);
    }
    expect(blinks.size).toBe(2);
    w.player.invuln = 0;
    expect(withWorld({}, w).blink).toBe(false);
  });

  it('wipes out when the run ends dead: lying on the ground, the board shot out ahead, wheels up', () => {
    const w = makeWorld(1);
    w.run.phase = PHASE_DEAD;
    const view = withWorld({ speed: 4 }, w, 60);
    expect(view.wipe).toBe(1);
    expect(top(view)).toBeLessThan(0.75);
    const b = world(view.board);
    // Ahead of where the rider was (heading 0: +z), and upside down: the deck under the wheels.
    const mid = b.reduce((s, v) => s + v.z, 0) / b.length;
    expect(mid).toBeGreaterThan(-3 + 0.8);
    expect(view.board.rotation.z).toBeCloseTo(Math.PI, 5);
    // Not dead, it stands.
    w.run.phase = 0;
    expect(withWorld({ speed: 4 }, w, 60).wipe).toBe(0);
  });

  it('trails its scarf behind it at speed and lets it hang when slow', () => {
    const tail = (v: MoverView): Vector3 => world(v.figure).reduce((m, p) => (p.z < m.z ? p : m));
    const slow = withWorld({ speed: 0.5, tucked: true }, makeWorld(1), 60);
    const fast = withWorld({ speed: 16, tucked: true }, makeWorld(1), 60);
    // Heading +z: the tail streams out toward -z and up off the back.
    expect(tail(fast).z).toBeLessThan(tail(slow).z - 0.2);
    expect(tail(fast).y).toBeGreaterThan(tail(slow).y);
  });

  it('shows every passive carried as a part of its own, bigger at level 5 than at level 1', () => {
    const none = withWorld({}, makeWorld(1));
    const base = area(none.figure) + area(none.board);
    const baseTris = none.triangles;
    const all = makeWorld(1);
    for (let id = 0; id < PASSIVE_COUNT; id++) {
      const w1 = makeWorld(1);
      w1.player.loadout.passiveLevel[id] = 1;
      const w5 = makeWorld(1);
      w5.player.loadout.passiveLevel[id] = 5;
      const one = withWorld({}, w1);
      const five = withWorld({}, w5);
      const a1 = area(one.figure) + area(one.board);
      const a5 = area(five.figure) + area(five.board);
      expect(a1, `passive ${id} at level 1 adds something`).toBeGreaterThan(base + 1e-3);
      expect(a5, `passive ${id} at level 5 is bigger than at 1`).toBeGreaterThan(a1 + 1e-4);
      all.player.loadout.passiveLevel[id] = 5;
    }
    // All eleven at once fit in the budget, with every part drawn.
    const full = withWorld({}, all);
    expect(full.triangles).toBeGreaterThan(baseTris);
    expect(full.triangles).toBeLessThanOrEqual(700);
    // Wide Load makes the board wider.
    const wide = makeWorld(1);
    wide.player.loadout.passiveLevel[P_WIDE_LOAD] = 5;
    const span = (v: MoverView): number => {
      const b = world(v.board);
      return Math.max(...b.map((p) => p.x)) - Math.min(...b.map((p) => p.x));
    };
    expect(span(withWorld({}, wide))).toBeGreaterThan(span(none) + 0.1);
  });

  it('reads the world without writing it', () => {
    const w = makeWorld(1);
    for (let id = 0; id < PASSIVE_COUNT; id++) w.player.loadout.passiveLevel[id] = 3;
    w.player.invuln = 20;
    const before = JSON.stringify({ p: w.player, r: w.run });
    const view = new MoverView();
    const s = state({ speed: 9 });
    for (let i = 0; i < 30; i++) view.update(s, s, 1, terrain, 1 / 60, w);
    expect(JSON.stringify({ p: w.player, r: w.run })).toBe(before);
  });
});
