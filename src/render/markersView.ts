/**
 * World markers for errands and conductors: box figures in the skater's style, animated on twos
 * by swapping between two pre-merged geometries, and a beacon over the active errand's target.
 *
 * - Errand givers stand at the edge of their zone holding up a mango ticket and wave; grey-blue and
 *   still when their errand is done or not on offer at this hour.
 * - Conductors stand beside their stop in a cap and coat of the line's livery base colour with a
 *   stripe, holding a ticket punch; once punched they tip the cap on the second frame.
 * - The beacon is a tall thin post with a flag (seen over roofs) and a pink ring at its foot round
 *   the target zone; for a ride step it stands at the nearest stop of that line.
 *
 * Draw calls: three meshes in all (givers, conductors, beacon). Figure geometry is merged only when
 * the set of markers within MARKER_RANGE of the skater changes, or a giver or conductor changes
 * state; the beacon only when its target changes. Nothing is rebuilt per frame.
 */
import * as THREE from 'three';
import { errandOpen, type ErrandDef, type StepDef } from '../sim/game/errands';
import type { Game } from '../sim/game/game';
import { pathAt, type CompiledLine } from '../sim/lines';
import { Mode } from '../sim/types';
import { collideSolids, makeWallHit, topHeight, type World, type Zone } from '../sim/world';
import { MeshBuilder } from './geom';
import { INK, inkMaterial } from './look';

export interface MarkersView {
  update(game: Game, alpha: number, dt: number): void;
  dispose(): void;
}

/** Markers further than this from the skater are not drawn, metres. */
export const MARKER_RANGE = 150;
/** Sim ticks per animation frame: 12 Hz, like the skater. */
const TWOS = 5;
/** Frames between checks of which markers are in range. */
const RANGE_EVERY = 12;
const BEACON_H = 22;
const RING_SEGMENTS = 36;
const RING_HALF_W = 0.18;
const SKIN = 0xc98a5e;
const GREY = 0x7d86a8;
const GREY_DARK = 0x5a6283;
const GREY_SKIN = 0x9aa0b8;

interface Arm {
  /** Hand position relative to the shoulder, in body space (x left, y up, z forward). */
  x: number;
  y: number;
  z: number;
}

interface FigureOpts {
  coat: number;
  legs: number;
  skin: number;
  /** Cap colour, or -1 for none (hair instead). */
  cap: number;
  /** A second colour across the coat. */
  stripe: number;
  armL: Arm;
  armR: Arm;
  /** Cap lifted off the head, held in the right hand. */
  capOff?: boolean;
  /** What the left hand holds. */
  prop: 'ticket' | 'punch' | 'none';
  propColor: number;
}

/** A standing box figure facing +z, feet at the origin. */
function figure(o: FigureOpts): MeshBuilder {
  const b = new MeshBuilder();
  // Legs and shoes.
  for (const side of [1, -1]) {
    b.box(side * 0.11, 0.42, 0, 0.075, 0.42, 0.08, 1, 0, o.legs, {});
    b.box(side * 0.11, 0.04, 0.05, 0.085, 0.04, 0.13, 1, 0, INK.ink, {});
  }
  // Coat, with a stripe across it.
  b.box(0, 1.17, 0, 0.21, 0.33, 0.13, 1, 0, o.coat, {});
  b.box(0, 1.08, 0.001, 0.215, 0.05, 0.135, 1, 0, o.stripe, {});
  // Head.
  b.box(0, 1.65, 0, 0.12, 0.13, 0.12, 1, 0, o.skin, {});
  if (o.cap >= 0) {
    if (o.capOff) {
      b.box(0, 1.79, 0, 0.125, 0.02, 0.125, 1, 0, INK.ink, {});
    } else {
      b.box(0, 1.8, 0, 0.13, 0.04, 0.13, 1, 0, o.cap, {});
      b.box(0, 1.78, 0.17, 0.11, 0.015, 0.07, 1, 0, INK.ink, {});
    }
  } else b.box(0, 1.79, -0.01, 0.125, 0.03, 0.125, 1, 0, INK.ink, {});
  // Arms from the shoulders to the hands.
  const arm = (sx: number, a: Arm): [number, number, number] => {
    const shx = sx * 0.25;
    const shy = 1.44;
    const hx = shx + a.x * sx;
    const hy = shy + a.y;
    const hz = a.z;
    b.beam(shx, shy, 0, hx, hy, hz, 0.055, o.coat);
    b.box(hx, hy, hz, 0.06, 0.06, 0.06, 1, 0, o.skin, { bottom: true });
    return [hx, hy, hz];
  };
  const [lx, ly, lz] = arm(1, o.armL);
  const [rx, ry, rz] = arm(-1, o.armR);
  if (o.prop === 'ticket') {
    // A ticket held up: a mango card with a punch hole, big enough to read from a distance.
    b.box(lx, ly + 0.3, lz, 0.2, 0.26, 0.02, 1, 0, o.propColor, { bottom: true });
    b.box(lx, ly + 0.42, lz + 0.022, 0.05, 0.05, 0.004, 1, 0, INK.ink, {});
  } else if (o.prop === 'punch') {
    b.box(lx, ly + 0.05, lz + 0.08, 0.035, 0.11, 0.06, 1, 0, o.propColor, { bottom: true });
  }
  if (o.capOff) b.box(rx, ry + 0.06, rz, 0.13, 0.04, 0.13, 1, 0, o.cap, { bottom: true });
  return b;
}

const GIVER_UP: Arm = { x: 0.12, y: 0.62, z: 0.12 };
const GIVER_WAVE: Arm = { x: 0.38, y: 0.5, z: 0.08 };
const DOWN_L: Arm = { x: 0.12, y: -0.5, z: 0.06 };
const DOWN_R: Arm = { x: 0.12, y: -0.5, z: 0.04 };

function giverFigure(frame: number, live: boolean, style: number): MeshBuilder {
  if (!live) {
    return figure({ coat: GREY, legs: GREY_DARK, skin: GREY_SKIN, cap: -1, stripe: GREY_DARK, armL: DOWN_L, armR: DOWN_R, prop: 'ticket', propColor: GREY_DARK });
  }
  const coats = [INK.teal, INK.pink, INK.cobalt];
  const coat = coats[style % coats.length];
  return figure({
    coat,
    legs: INK.ink,
    skin: SKIN,
    cap: -1,
    stripe: INK.white,
    armL: frame === 0 ? GIVER_UP : GIVER_WAVE,
    armR: frame === 0 ? DOWN_R : { x: 0.2, y: -0.42, z: 0.12 },
    prop: 'ticket',
    propColor: INK.mango,
  });
}

function conductorFigure(frame: number, punched: boolean, line: CompiledLine): MeshBuilder {
  const lv = line.livery;
  const punchArm: Arm = { x: 0.08, y: -0.22, z: 0.34 };
  if (punched) {
    return figure({
      coat: lv.base,
      legs: INK.ink,
      skin: SKIN,
      cap: lv.base,
      stripe: lv.stripe,
      armL: DOWN_L,
      armR: frame === 0 ? DOWN_R : { x: 0.05, y: 0.42, z: 0.12 },
      capOff: frame === 1,
      prop: 'none',
      propColor: INK.ink,
    });
  }
  return figure({
    coat: lv.base,
    legs: INK.ink,
    skin: SKIN,
    cap: lv.base,
    stripe: lv.stripe,
    armL: frame === 0 ? punchArm : { x: 0.1, y: -0.16, z: 0.36 },
    armR: DOWN_R,
    prop: 'punch',
    propColor: INK.white,
  });
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _wh = makeWallHit();

interface Marker {
  x: number;
  y: number;
  z: number;
  /** Facing yaw (forward = (sin, cos)). */
  yaw: number;
  inRange: boolean;
}

interface GiverMarker extends Marker {
  /** Errands given here. */
  errands: ErrandDef[];
  style: number;
  live: boolean;
}

interface ConductorMarker extends Marker {
  line: number;
  punched: boolean;
}

/** A spot at the edge of a zone, on a top surface, clear of walls. */
function giverSpot(w: World, z: Zone): [number, number] {
  const d = Math.min(z.r * 0.6, 3.5);
  const tries: [number, number][] = [
    [d, 0],
    [-d, 0],
    [0, -d],
    [0, d],
  ];
  for (const [ox, oz] of tries) {
    const x = z.x + ox;
    const zz = z.z + oz;
    const y = topHeight(w, x, zz);
    collideSolids(w, x, y, zz, 0.4, 1.8, 0.4, _wh);
    if (!_wh.hit && Math.abs(y - z.y) < 1.5) return [x, zz];
  }
  return [z.x, z.z];
}

/** Beside a line's stop, off the road: try either side at a few distances. */
function conductorSpot(w: World, L: CompiledLine, s: number): { x: number; z: number; yaw: number } {
  const p = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
  pathAt(L, s, p);
  const rx = p.hz;
  const rz = -p.hx;
  for (const d of [-6, 7, -8.5, 9.5, -4.5, 5]) {
    const x = p.x + rx * d;
    const z = p.z + rz * d;
    const y = topHeight(w, x, z);
    collideSolids(w, x, y, z, 0.5, 1.8, 0.4, _wh);
    if (!_wh.hit) return { x, z, yaw: Math.atan2(-rx * Math.sign(d), -rz * Math.sign(d)) };
  }
  return { x: p.x, z: p.z, yaw: 0 };
}

function placeFigure(out: MeshBuilder, fig: MeshBuilder, m: Marker): void {
  _m.makeTranslation(m.x, m.y, m.z);
  _r.makeRotationY(m.yaw);
  _m.multiply(_r);
  out.append(fig, _m);
}

/** The beacon: post, flag (frame 0 or 1) and a pink ring of radius r following the ground. */
function buildBeacon(w: World, x: number, z: number, r: number, frame: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const y0 = topHeight(w, x, z);
  b.box(x, y0 + BEACON_H / 2, z, 0.09, BEACON_H / 2, 0.09, 1, 0, INK.pink, { top: INK.white });
  // Bands up the post so it reads as a mast, not a wire.
  for (let k = 1; k < 5; k++) b.box(x, y0 + (k * BEACON_H) / 5, z, 0.12, 0.25, 0.12, 1, 0, INK.white, {});
  const fy = y0 + BEACON_H - 0.9;
  const sway = frame === 0 ? 0.25 : -0.2;
  // A pennant: two triangles, the tip swinging between frames.
  const a = b.vert(x, fy + 0.8, z, INK.mango);
  const c = b.vert(x, fy - 0.8, z, INK.mango);
  const t = b.vert(x + 2.4, fy + sway, z + (frame === 0 ? 0.3 : -0.3), INK.pink);
  b.tri(a, c, t);
  b.tri(a, t, c);
  const r0 = Math.max(1, r - RING_HALF_W);
  const r1 = r + RING_HALF_W;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const a0 = (k / RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((k + 1) / RING_SEGMENTS) * Math.PI * 2;
    const s0 = Math.sin(a0);
    const c0 = Math.cos(a0);
    const s1 = Math.sin(a1);
    const c1 = Math.cos(a1);
    const ya = topHeight(w, x + s0 * r, z + c0 * r) + 0.07;
    const yb = topHeight(w, x + s1 * r, z + c1 * r) + 0.07;
    b.quad(x + s0 * r1, ya, z + c0 * r1, x + s1 * r1, yb, z + c1 * r1, x + s1 * r0, yb, z + c1 * r0, x + s0 * r0, ya, z + c0 * r0, INK.pink);
  }
  return b.build();
}

export function createMarkersView(scene: THREE.Scene, world: World, game: Game): MarkersView {
  const material = inkMaterial({ doubleSided: true });
  const errs = game.errands.list;
  const givers: GiverMarker[] = [];
  for (const d of errs) {
    const z = game.errandsReducer.giverZone(d.id);
    if (!z) continue;
    const existing = givers.find((g) => g.errands.length > 0 && game.errandsReducer.giverZone(g.errands[0].id) === z);
    if (existing) {
      existing.errands.push(d);
      continue;
    }
    const [x, zz] = giverSpot(world, z);
    // Face across the zone toward its centre (or downhill, toward the camera, if at the centre).
    const yaw = x === z.x && zz === z.z ? Math.PI : Math.atan2(z.x - x, z.z - zz);
    givers.push({ x, y: topHeight(world, x, zz), z: zz, yaw, inRange: false, errands: [d], style: givers.length, live: false });
  }
  const conductors: ConductorMarker[] = [];
  for (const c of game.conductors.list) {
    const li = world.lines.findIndex((l) => l.id === c.line);
    if (li < 0) continue;
    const L = world.lines[li];
    const sp = conductorSpot(world, L, L.allStops[c.stop].s);
    conductors.push({ x: sp.x, y: topHeight(world, sp.x, sp.z), z: sp.z, yaw: sp.yaw, inRange: false, line: li, punched: false });
  }

  // Each figure's two frames, built once, at the origin.
  const giverFrames = givers.map((g) => [giverFigure(0, true, g.style), giverFigure(1, true, g.style)]);
  const giverIdle = giverFigure(0, false, 0);
  const condFrames = conductors.map((c) => [0, 1].map((f) => [conductorFigure(f, false, world.lines[c.line]), conductorFigure(f, true, world.lines[c.line])]));

  const empty = new THREE.BufferGeometry();
  const mkMesh = (name: string): THREE.Mesh => {
    const m = new THREE.Mesh(empty, material);
    m.name = name;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  };
  const giverMesh = mkMesh('markers-givers');
  const condMesh = mkMesh('markers-conductors');
  const beaconMesh = mkMesh('markers-beacon');
  let giverGeo: THREE.BufferGeometry[] = [];
  let condGeo: THREE.BufferGeometry[] = [];
  let beaconGeo: THREE.BufferGeometry[] = [];
  let frame = -1;
  let rangeCountdown = 0;
  let dirty = true;
  let beaconKey = '';

  const disposeAll = (gs: THREE.BufferGeometry[]): void => {
    for (const g of gs) g.dispose();
  };

  const rebuild = (): void => {
    disposeAll(giverGeo);
    disposeAll(condGeo);
    giverGeo = [0, 1].map((f) => {
      const b = new MeshBuilder();
      givers.forEach((g, i) => {
        if (g.inRange) placeFigure(b, g.live ? giverFrames[i][f] : giverIdle, g);
      });
      return b.build();
    });
    condGeo = [0, 1].map((f) => {
      const b = new MeshBuilder();
      conductors.forEach((c, i) => {
        if (c.inRange) placeFigure(b, condFrames[i][f][c.punched ? 1 : 0], c);
      });
      return b.build();
    });
    giverMesh.visible = givers.some((g) => g.inRange);
    condMesh.visible = conductors.some((c) => c.inRange);
    frame = -1;
  };

  /** Where the beacon goes for the active errand's current step, or null. */
  const beaconTarget = (): { x: number; z: number; r: number; key: string } | null => {
    const a = game.errands.active;
    if (!a) return null;
    const def = errs.find((d) => d.id === a.id);
    if (!def) return null;
    const step: StepDef = def.steps[a.step];
    const p = game.sim.player;
    if (step.kind === 'hitch' || (step.kind === 'rideTo' && !(p.mode === Mode.HITCH && world.lines[p.hLine].id === step.line))) {
      const L = world.lines.find((l) => l.id === step.line);
      if (!L) return null;
      const P = { x: 0, y: 0, z: 0, hx: 0, hz: 1 };
      let best = Infinity;
      let bk = 0;
      for (let k = 0; k < L.allStops.length; k++) {
        pathAt(L, L.allStops[k].s, P);
        const d = (P.x - p.x) * (P.x - p.x) + (P.z - p.z) * (P.z - p.z);
        if (d < best) {
          best = d;
          bk = k;
        }
      }
      pathAt(L, L.allStops[bk].s, P);
      return { x: P.x, z: P.z, r: 5, key: `${a.id}:${a.step}:stop${L.id}${bk}` };
    }
    const z = game.errandsReducer.stepZone(a.id, a.step);
    if (!z) return null;
    return { x: z.x, z: z.z, r: z.r, key: `${a.id}:${a.step}:${z.id}` };
  };

  return {
    update(g) {
      const p = g.sim.player;
      // State of givers and conductors.
      const f = g.sim.dayFrac;
      for (const gv of givers) {
        let live = false;
        for (const d of gv.errands) if (errandOpen(d, f) && !g.errands.done[d.id]) live = true;
        if (live !== gv.live) {
          gv.live = live;
          dirty = true;
        }
      }
      for (const c of conductors) {
        const punched = g.conductors.punched[world.lines[c.line].id] === true;
        if (punched !== c.punched) {
          c.punched = punched;
          dirty = true;
        }
      }
      if (--rangeCountdown <= 0) {
        rangeCountdown = RANGE_EVERY;
        const R2 = MARKER_RANGE * MARKER_RANGE;
        for (const m of givers as Marker[]) {
          const inR = (m.x - p.x) * (m.x - p.x) + (m.z - p.z) * (m.z - p.z) < R2;
          if (inR !== m.inRange) {
            m.inRange = inR;
            dirty = true;
          }
        }
        for (const m of conductors as Marker[]) {
          const inR = (m.x - p.x) * (m.x - p.x) + (m.z - p.z) * (m.z - p.z) < R2;
          if (inR !== m.inRange) {
            m.inRange = inR;
            dirty = true;
          }
        }
        const bt = beaconTarget();
        const key = bt ? bt.key : '';
        if (key !== beaconKey) {
          beaconKey = key;
          disposeAll(beaconGeo);
          beaconGeo = bt ? [buildBeacon(world, bt.x, bt.z, bt.r, 0), buildBeacon(world, bt.x, bt.z, bt.r, 1)] : [];
          beaconMesh.visible = bt !== null;
          frame = -1;
        }
      }
      if (dirty) {
        dirty = false;
        rebuild();
      }
      // On twos: swap between the two frames.
      const fr = Math.floor(g.sim.tick / TWOS) % 2;
      if (fr !== frame) {
        frame = fr;
        if (giverGeo.length === 2) giverMesh.geometry = giverGeo[fr];
        if (condGeo.length === 2) condMesh.geometry = condGeo[fr];
        if (beaconGeo.length === 2) beaconMesh.geometry = beaconGeo[fr];
      }
    },
    dispose() {
      scene.remove(giverMesh);
      scene.remove(condMesh);
      scene.remove(beaconMesh);
      disposeAll(giverGeo);
      disposeAll(condGeo);
      disposeAll(beaconGeo);
      empty.dispose();
      material.dispose();
    },
  };
}
