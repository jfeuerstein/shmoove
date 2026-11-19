import { Color, Vector3, type Mesh, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { BOARD_TRIANGLES, DECK_HALF_LENGTH, FIGURE_TRIANGLES, MoverView } from '../../src/render/moverView';
import { FEEL } from '../../src/sim/constants';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import type { SimState } from '../../src/sim/types';

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

/** Every vertex of a mesh in world space. */
function world(mesh: Mesh): Vector3[] {
  const pos = mesh.geometry.getAttribute('position');
  const out: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
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
  for (let i = 0; i < pos.count; i++) {
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
  it('is a board of about 0.9 m by 0.25 m and a figure, about 70 triangles in all, the figure in the mover colour', () => {
    const view = posed({});
    const figure = view.figure.geometry.getAttribute('position').count / 3;
    const board = view.board.geometry.getAttribute('position').count / 3;
    expect(figure).toBe(FIGURE_TRIANGLES);
    expect(board).toBe(BOARD_TRIANGLES);
    expect(figure + board).toBeLessThanOrEqual(72);
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
