import { Color, type BufferGeometry, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  auraColors,
  bollardGeometry,
  bruiserGeometry,
  clingerGeometry,
  crowdFlash,
  cutterGeometry,
  ELITE_SCALE,
  FLASH_CROWD,
  FLASH_FLOOR,
  gnatGeometry,
  HordeView,
  lobberGeometry,
  geometryFor,
  mortarGeometry,
  PART_ACT,
  PART_CROWN,
  PART_INTACT,
  PART_SCAR,
  SHADOW_OPACITY,
  SHADOW_SCALE,
  shufflerGeometry,
  sludgeGeometry,
  standstillGeometry,
} from '../../src/render/hordeView';
import { PALETTE, tone } from '../../src/render/look';
import { DT } from '../../src/sim/constants';
import { HORDE } from '../../src/sim/horde';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_SHIELD,
  KIND_BOLLARD,
  KIND_BRUISER,
  KIND_CLINGER,
  KIND_COUNT,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KIND_STANDSTILL,
  KINDS,
  makeWorld,
  MARK_ELITE,
  removeEnemy,
  SPAWN_TICKS,
  spawnEnemy,
  STATE_LATCHED,
  type World,
} from '../../src/sim/world';

/** Column-major instance matrix `n` of a mesh. */
function matrix(mesh: InstancedMesh, n: number): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(n * 16, n * 16 + 16));
}

function len(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Where the model's +z (its face) points, normalised. */
function facing(m: number[]): [number, number, number] {
  const l = len(m[8], m[9], m[10]);
  return [m[8] / l, m[9] / l, m[10] / l];
}

function add(w: World, kind: number, x: number, y: number, z: number, vx = 0, vz = 0, age = SPAWN_TICKS): number {
  const i = spawnEnemy(w, kind, x, y, z);
  w.horde.vx[i] = vx;
  w.horde.vz[i] = vz;
  w.horde.age[i] = age;
  return i;
}

/** The box round the body alone: the crown (shown only on an elite) left out. */
function bodyBox(g: BufferGeometry): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const p = g.getAttribute('position');
  const rig = g.getAttribute('aRig');
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let v = 0; v < p.count; v++) {
    if (rig.getW(v) === PART_CROWN) continue;
    min.x = Math.min(min.x, p.getX(v));
    min.y = Math.min(min.y, p.getY(v));
    min.z = Math.min(min.z, p.getZ(v));
    max.x = Math.max(max.x, p.getX(v));
    max.y = Math.max(max.y, p.getY(v));
    max.z = Math.max(max.z, p.getZ(v));
  }
  return { min, max };
}

function boxOf(g: BufferGeometry): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (!box) throw new Error('no bounding box');
  return box;
}

describe('enemy geometry', () => {
  it('stays inside the triangle budgets (110 an enemy, 30 a gnat, crown included) and stands as tall as the brief says', () => {
    const cases = [
      { g: shufflerGeometry(), max: 110, height: 1.7 },
      { g: gnatGeometry(), max: 30, height: null },
      { g: bollardGeometry(), max: 110, height: 2.4 },
      { g: cutterGeometry(), max: 110, height: KINDS[KIND_CUTTER].height },
      { g: lobberGeometry(), max: 110, height: KINDS[KIND_LOBBER].height },
      { g: sludgeGeometry(), max: 110, height: KINDS[KIND_SLUDGE].height },
      { g: clingerGeometry(), max: 110, height: null },
    ];
    for (const c of cases) {
      const tris = c.g.getAttribute('position').count / 3;
      expect(tris).toBeLessThanOrEqual(c.max);
      const box = bodyBox(c.g);
      if (c.height !== null) {
        expect(box.min.y).toBeCloseTo(0, 5);
        expect(box.max.y).toBeCloseTo(c.height, 5);
      }
    }
  });

  it('has every face pointing outward from the part it belongs to', () => {
    const shapes = {
      shufflerGeometry,
      gnatGeometry,
      bollardGeometry,
      cutterGeometry,
      lobberGeometry,
      sludgeGeometry,
      clingerGeometry,
      bruiserGeometry,
      mortarGeometry,
      standstillGeometry,
    };
    for (const [name, make] of Object.entries(shapes)) {
      const p = make().getAttribute('position');
      const tris = p.count / 3;
      // Parts are the sets of triangles joined by shared corners: union them.
      const parent = Array.from({ length: tris }, (_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const owner = new Map<string, number>();
      for (let v = 0; v < p.count; v++) {
        const key = `${p.getX(v).toFixed(5)},${p.getY(v).toFixed(5)},${p.getZ(v).toFixed(5)}`;
        const t = Math.floor(v / 3);
        const o = owner.get(key);
        if (o === undefined) owner.set(key, t);
        else parent[find(t)] = find(o);
      }
      const sum = new Map<number, { x: number; y: number; z: number; n: number }>();
      for (let v = 0; v < p.count; v++) {
        const r = find(Math.floor(v / 3));
        const c = sum.get(r) ?? { x: 0, y: 0, z: 0, n: 0 };
        c.x += p.getX(v);
        c.y += p.getY(v);
        c.z += p.getZ(v);
        c.n++;
        sum.set(r, c);
      }
      for (let t = 0; t < tris; t++) {
        const c = sum.get(find(t));
        if (!c) throw new Error('no part');
        const v = t * 3;
        const ax = p.getX(v), ay = p.getY(v), az = p.getZ(v);
        const ux = p.getX(v + 1) - ax, uy = p.getY(v + 1) - ay, uz = p.getZ(v + 1) - az;
        const vx = p.getX(v + 2) - ax, vy = p.getY(v + 2) - ay, vz = p.getZ(v + 2) - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const mx = (ax + p.getX(v + 1) + p.getX(v + 2)) / 3 - c.x / c.n;
        const my = (ay + p.getY(v + 1) + p.getY(v + 2)) / 3 - c.y / c.n;
        const mz = (az + p.getZ(v + 1) + p.getZ(v + 2)) / 3 - c.z / c.n;
        expect(nx * mx + ny * my + nz * mz, `${name}, triangle ${t}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('HordeView', () => {
  it('draws each living enemy in its kind mesh at its place, facing and rise', () => {
    const w = makeWorld(3);
    add(w, KIND_SHUFFLER, 3, 0.5, 4, 3, 4);
    add(w, KIND_GNAT, -5, 1, 2, 0, 0, SPAWN_TICKS / 2);
    add(w, KIND_BOLLARD, 10, 2, -10, 0, -1.2);
    add(w, KIND_SHUFFLER, 0, 0, -6, -2, 0);
    const view = new HordeView();
    // The mover is due +z of the gnat, which stands still and so turns to face it.
    view.update(w, 1, 0, -5, 12);

    const [shuf, gnat, boll] = view.meshes;
    expect(shuf.count).toBe(2);
    expect(gnat.count).toBe(1);
    expect(boll.count).toBe(1);
    expect(view.shadows.count).toBe(4);
    expect(shuf.visible && gnat.visible && boll.visible && view.shadows.visible).toBe(true);

    const a = matrix(shuf, 0);
    expect([a[12], a[13], a[14]]).toEqual([3, 0.5, 4]);
    const fa = facing(a);
    expect(fa[0]).toBeCloseTo(0.6, 5);
    expect(fa[1]).toBeCloseTo(0, 5);
    expect(fa[2]).toBeCloseTo(0.8, 5);
    expect(len(a[4], a[5], a[6])).toBeCloseTo(1, 5);

    const b = matrix(shuf, 1);
    expect(b[12]).toBeCloseTo(0, 5);
    expect(b[14]).toBeCloseTo(-6, 5);
    expect(facing(b)[0]).toBeCloseTo(-1, 5);

    const g = matrix(gnat, 0);
    expect(len(g[0], g[1], g[2])).toBeCloseTo(0.5, 5);
    expect(len(g[4], g[5], g[6])).toBeCloseTo(0.5, 5);
    expect(len(g[8], g[9], g[10])).toBeCloseTo(0.5, 5);
    expect(facing(g)[2]).toBeCloseTo(1, 5);

    const c = matrix(boll, 0);
    expect(facing(c)[2]).toBeCloseTo(-1, 5);
    expect([c[12], c[13], c[14]]).toEqual([10, 2, -10]);
  });

  it('draws the world as it was between ticks: back along the velocity by (1 - alpha) of a tick', () => {
    const w = makeWorld(3);
    add(w, KIND_SHUFFLER, 3, 0, 4, 6, -3);
    const view = new HordeView();
    view.update(w, 0.25, 0, 0, 0);
    const m = matrix(view.meshes[KIND_SHUFFLER], 0);
    expect(m[12]).toBeCloseTo(3 - 6 * 0.75 * DT, 5);
    expect(m[14]).toBeCloseTo(4 + 3 * 0.75 * DT, 5);
    const s = matrix(view.shadows, 0);
    expect(s[12]).toBeCloseTo(m[12], 5);
    expect(s[14]).toBeCloseTo(m[14], 5);
  });

  it('starts an enemy at nothing and grows it out of the ground while it rises', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_BOLLARD, 0, 0, 0, 0, 0, 0);
    const view = new HordeView();
    const scales: number[] = [];
    for (const age of [0, 9, 18, SPAWN_TICKS, SPAWN_TICKS + 100]) {
      w.horde.age[i] = age;
      view.update(w, 1, 0, 5, 5);
      const m = matrix(view.meshes[KIND_BOLLARD], 0);
      scales.push(len(m[4], m[5], m[6]));
    }
    expect(scales[0]).toBe(0);
    expect(scales[1]).toBeCloseTo(0.25, 5);
    expect(scales[2]).toBeCloseTo(0.5, 5);
    expect(scales[3]).toBeCloseTo(1, 5);
    expect(scales[4]).toBeCloseTo(1, 5);
  });

  it('draws every kind in its own mesh, the new four included, at its place and facing', () => {
    const w = makeWorld(3);
    for (let k = 0; k < KIND_COUNT; k++) add(w, k, k * 3, 0.25, -2, 0, 1);
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.length).toBe(KINDS.length);
    for (const k of [KIND_CUTTER, KIND_LOBBER, KIND_SLUDGE, KIND_CLINGER]) {
      const mesh = view.meshes[k];
      expect(mesh.count).toBe(1);
      expect(mesh.visible).toBe(true);
      const m = matrix(mesh, 0);
      expect([m[12], m[13], m[14]]).toEqual([k * 3, 0.25, -2]);
      expect(facing(m)[2]).toBeCloseTo(1, 5);
      expect(len(m[4], m[5], m[6])).toBeCloseTo(1, 5);
    }
  });

  it('gives the new four silhouettes nobody would confuse', () => {
    const cutter = bodyBox(cutterGeometry());
    const lobber = bodyBox(lobberGeometry());
    const sludge = bodyBox(sludgeGeometry());
    const clinger = bodyBox(clingerGeometry());
    // The cutter is lean and points forward: its blade reaches well past its narrow body.
    expect(cutter.max.z).toBeGreaterThan(0.8);
    expect(cutter.max.x - cutter.min.x).toBeLessThan(0.5);
    // The lobber is squat and wide, with the ball held up above its body.
    expect(lobber.max.x - lobber.min.x).toBeGreaterThan(1.1);
    expect(lobber.max.y).toBeCloseTo(KINDS[KIND_LOBBER].height, 5);
    // The sludge is wide and low.
    expect((sludge.max.x - sludge.min.x) / (sludge.max.y - sludge.min.y)).toBeGreaterThan(1.6);
    // The clinger is small and spiky: knee high, standing on a point, as wide as it is tall.
    expect(clinger.min.y).toBeCloseTo(0, 5);
    expect(clinger.max.y).toBeCloseTo(KINDS[KIND_CLINGER].height, 1);
    expect(clinger.max.x - clinger.min.x).toBeCloseTo(clinger.max.y - clinger.min.y, 1);
    const tris = clingerGeometry().getAttribute('position').count / 3;
    expect(tris).toBeLessThanOrEqual(110);
  });

  it('draws an elite larger, with its aura as a ring on the ground at the aura\'s reach in its colour', () => {
    const w = makeWorld(3);
    add(w, KIND_SHUFFLER, 0, 0, 0);
    const e = add(w, KIND_SHUFFLER, 20, 1, 5);
    w.horde.elite[e] = ELITE_SHIELD;
    const view = new HordeView();
    view.update(w, 1, 0, 0, -30);
    const plain = matrix(view.meshes[KIND_SHUFFLER], 0);
    const big = matrix(view.meshes[KIND_SHUFFLER], 1);
    expect(len(plain[4], plain[5], plain[6])).toBeCloseTo(1, 5);
    expect(len(big[4], big[5], big[6])).toBeCloseTo(ELITE_SCALE, 5);
    expect(len(big[8], big[9], big[10])).toBeCloseTo(ELITE_SCALE, 5);
    const shadow = matrix(view.shadows, 1);
    expect(shadow[0]).toBeCloseTo(KINDS[KIND_SHUFFLER].radius * SHADOW_SCALE * ELITE_SCALE, 5);

    const rings = view.auras;
    expect(rings.count).toBe(1);
    expect(rings.mesh.visible).toBe(true);
    // Every outer vertex of the ring sits at the aura's reach from the elite.
    const verts = (rings.segments + 1) * 2;
    const want = new Color(auraColors()[ELITE_SHIELD]);
    for (let v = 1; v < verts; v += 2) {
      const d = Math.hypot(rings.positions[v * 3] - 20, rings.positions[v * 3 + 2] - 5);
      expect(d).toBeCloseTo(HORDE.auraReach, 4);
      expect(rings.colors[v * 3]).toBeCloseTo(want.r, 5);
      expect(rings.colors[v * 3 + 1]).toBeCloseTo(want.g, 5);
      expect(rings.colors[v * 3 + 2]).toBeCloseTo(want.b, 5);
    }
    // The three auras are three different colours, none of them the elite's own white.
    const auras = [ELITE_HASTE, ELITE_SHIELD, ELITE_JAM].map((a) => auraColors()[a]);
    expect(new Set(auras).size).toBe(3);
    // No elites, no rings.
    w.horde.elite[e] = 0;
    view.update(w, 1, 0, 0, -30);
    expect(view.auras.count).toBe(0);
    expect(view.auras.mesh.visible).toBe(false);
    const back = matrix(view.meshes[KIND_SHUFFLER], 1);
    expect(len(back[4], back[5], back[6])).toBeCloseTo(1, 5);
    // Marked an elite with no aura of its own: still big, still no ring.
    w.horde.mark[e] |= MARK_ELITE;
    view.update(w, 1, 0, 0, -30);
    const marked = matrix(view.meshes[KIND_SHUFFLER], 1);
    expect(len(marked[4], marked[5], marked[6])).toBeCloseTo(ELITE_SCALE, 5);
    expect(view.auras.count).toBe(0);
  });

  it('draws a latched clinger on the mover\'s back, following it, not where it stands', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_CLINGER, 50, 0, 50);
    w.horde.state[i] = STATE_LATCHED;
    const view = new HordeView();
    const at = (mx: number, my: number, mz: number, heading: number): number[] => {
      view.update(w, 1, 0, mx, mz, my, heading);
      return matrix(view.meshes[KIND_CLINGER], 0);
    };
    const a = at(10, 2, 5, 0);
    expect(Math.hypot(a[12] - 10, a[14] - 5)).toBeLessThan(0.7);
    // Behind (the mover faces +z), and up off the ground against its body.
    expect(a[14]).toBeLessThan(5);
    expect(a[13]).toBeGreaterThan(2);
    expect(a[13]).toBeLessThan(2 + 1.7);
    // It moves with the mover and turns with it.
    const b = at(-4, 7, 30, Math.PI / 2);
    expect(Math.hypot(b[12] + 4, b[14] - 30)).toBeLessThan(0.7);
    expect(b[12]).toBeLessThan(-4);
    expect(b[13]).toBeGreaterThan(7);
    // It casts no shadow of its own.
    expect(matrix(view.shadows, 0)[0]).toBe(0);
    // Let go, it is drawn where it is.
    w.horde.state[i] = 0;
    const c = at(-4, 7, 30, 0);
    expect([c[12], c[13], c[14]]).toEqual([50, 0, 50]);
  });

  it('follows the horde as it shrinks and grows: count is always the living enemies of each kind', () => {
    const w = makeWorld(3);
    for (let n = 0; n < 30; n++) add(w, n % 3, n, 0, -n);
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.map((m) => m.count)).toEqual([10, 10, 10, 0, 0, 0, 0, 0, 0, 0]);
    // Take out every gnat; the last enemies move into the gaps.
    for (let i = w.horde.count - 1; i >= 0; i--) if (w.horde.kind[i] === KIND_GNAT) removeEnemy(w, i);
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.map((m) => m.count)).toEqual([10, 0, 10, 0, 0, 0, 0, 0, 0, 0]);
    expect(view.meshes[KIND_GNAT].visible).toBe(false);
    expect(view.shadows.count).toBe(20);
    w.horde.count = 0;
    view.update(w, 1, 0, 0, 0);
    expect(view.meshes.every((m) => m.count === 0 && !m.visible)).toBe(true);
    expect(view.shadows.visible).toBe(false);
  });

  it('passes phase, speed and the hit flash to the shader per instance', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_SHUFFLER, 0, 0, 0, KINDS[KIND_SHUFFLER].speed / 2, 0);
    w.horde.flash[i] = 6;
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    const anim = view.meshes[KIND_SHUFFLER].geometry.getAttribute('aAnim');
    expect(anim.getX(0)).toBeCloseTo(w.horde.phase[i], 6);
    expect(anim.getY(0)).toBeCloseTo(0.5, 5); // half the shuffler's top speed
    expect(anim.getZ(0)).toBe(1);
    w.horde.flash[i] = 0;
    view.update(w, 1, 0, 0, 0);
    expect(anim.getZ(0)).toBe(0);
  });

  it('flashes one enemy hit fully, but a crowd hit at once only in part, never all white', () => {
    const w = makeWorld(3);
    for (let k = 0; k < 40; k++) add(w, KIND_SHUFFLER, (k % 8) * 2, 0, Math.floor(k / 8) * 2);
    const view = new HordeView();
    const anim = view.meshes[KIND_SHUFFLER].geometry.getAttribute('aAnim');
    // One hit: full.
    w.horde.flash[0] = 6;
    view.update(w, 1, 0, 0, -30);
    expect(anim.getZ(0)).toBe(1);
    // A few at once: still full.
    for (let k = 0; k < FLASH_CROWD; k++) w.horde.flash[k] = 6;
    view.update(w, 1, 0, 0, -30);
    expect(anim.getZ(FLASH_CROWD - 1)).toBe(1);
    // The whole crowd at once (an area hit): each only partly, so the crowd keeps its colours.
    for (let k = 0; k < 40; k++) w.horde.flash[k] = 6;
    view.update(w, 1, 0, 0, -30);
    let total = 0;
    for (let k = 0; k < 40; k++) {
      expect(anim.getZ(k)).toBeLessThan(0.5);
      expect(anim.getZ(k)).toBeGreaterThanOrEqual(FLASH_FLOOR);
      total += anim.getZ(k);
    }
    expect(total).toBeLessThan(40 * 0.5);
    expect(crowdFlash(w.horde.flash, 0)).toBe(1);
  });

  it('casts a dark shadow under every enemy in every look, never a light one', () => {
    const view = new HordeView();
    const mat = view.shadows.material as unknown as { color: Color; opacity: number; transparent: boolean };
    expect(mat.color.r + mat.color.g + mat.color.b).toBe(0);
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBe(SHADOW_OPACITY);
    expect(SHADOW_OPACITY).toBeGreaterThanOrEqual(0.5);
  });

  it('never lets the meshes be culled by a stale bounding sphere', () => {
    const view = new HordeView();
    for (const m of [...view.meshes, view.shadows]) expect(m.frustumCulled).toBe(false);
  });
});

describe('the bosses', () => {
  const shapes = [
    { kind: KIND_BRUISER, g: bruiserGeometry() },
    { kind: KIND_MORTAR, g: mortarGeometry() },
    { kind: KIND_STANDSTILL, g: standstillGeometry() },
  ];

  it('stay inside 500 triangles each, stand as tall as their kind, and fill their body', () => {
    for (const { kind, g } of shapes) {
      expect(g.getAttribute('position').count / 3, KINDS[kind].name).toBeLessThanOrEqual(500);
      const box = boxOf(g);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeCloseTo(KINDS[kind].height, 5);
      // As wide as the body that touches you, give or take.
      const across = box.max.x - box.min.x;
      expect(across, KINDS[kind].name).toBeGreaterThan(KINDS[kind].radius * 1.6);
      expect(across, KINDS[kind].name).toBeLessThan(KINDS[kind].radius * 2.1);
    }
  });

  it('are far bigger than anything in the horde, and each its own shape', () => {
    const biggest = Math.max(...[shufflerGeometry(), bollardGeometry(), lobberGeometry(), sludgeGeometry()].map((g) => {
      const b = boxOf(g);
      return (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);
    }));
    for (const { g } of shapes) {
      const b = boxOf(g);
      expect((b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z)).toBeGreaterThan(biggest * 2);
    }
    const bruiser = boxOf(bruiserGeometry());
    const mortar = boxOf(mortarGeometry());
    const standstill = boxOf(standstillGeometry());
    // The Bruiser is broad and low, with its head and horns forward of its body.
    expect((bruiser.max.x - bruiser.min.x) / bruiser.max.y).toBeGreaterThan(1.4);
    expect(bruiser.max.z).toBeGreaterThan(-bruiser.min.z + 1);
    // The Mortar is squat and round: its tube stands up from the middle and does not lean.
    expect(mortar.max.z).toBeCloseTo(-mortar.min.z, 1);
    expect(mortar.max.y / (mortar.max.x - mortar.min.x)).toBeLessThan(1);
    // The Standstill is a tall monolith: taller than it is wide, and more than twice the Bruiser's height.
    expect(standstill.max.y / (standstill.max.x - standstill.min.x)).toBeGreaterThan(1.15);
    expect(standstill.max.y).toBeGreaterThan(2 * bruiser.max.y);
  });

  it('draws each in its own mesh in its own colour from the palette', () => {
    const w = makeWorld(3);
    for (const { kind } of shapes) add(w, kind, kind * 10, 0, 5, 0, 1);
    const view = new HordeView();
    view.update(w, 1, 0, 0, 0);
    for (const [n, { kind }] of shapes.entries()) {
      const mesh = view.meshes[kind];
      expect(mesh.count).toBe(1);
      expect(mesh.visible).toBe(true);
      const m = matrix(mesh, 0);
      expect([m[12], m[13], m[14]]).toEqual([kind * 10, 0, 5]);
      const mat = mesh.material as unknown as { color: Color };
      expect(mat.color.getHex()).toBe(new Color(PALETTE.bosses[n]).getHex());
    }
  });

  it('faces the way the Bruiser leans during its tell, not the mover', () => {
    const w = makeWorld(3);
    // Standing almost still, leaning along +x; the mover is off along +z.
    const i = add(w, KIND_BRUISER, 0, 0, 0, 0.15, 0);
    w.horde.state[i] = 2;
    const view = new HordeView();
    view.update(w, 1, 0, 0, 30);
    const f = facing(matrix(view.meshes[KIND_BRUISER], 0));
    expect(f[0]).toBeCloseTo(1, 5);
    expect(f[2]).toBeCloseTo(0, 5);
  });
});

describe('the creatures', () => {
  /** Linear RGB of a hex colour, as the geometry bakes it. */
  const linear = (hex: number): [number, number, number] => {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  };
  const close = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-4;

  it('are built from tones of their own palette colour, with something light or dark on the front for a face', () => {
    for (let k = 0; k < KINDS.length; k++) {
      const g = geometryFor(k);
      const tint = g.getAttribute('aTint');
      const rig = g.getAttribute('aRig');
      const p = g.getAttribute('position');
      const base = k < KIND_COUNT ? PALETTE.enemies[k] : PALETTE.bosses[k - KIND_BRUISER];
      // Every tone of the colour, from black through it to white, at fine steps: each vertex is one.
      const tones: [number, number, number][] = [];
      for (let t = -100; t <= 100; t++) tones.push(linear(tone(base, t / 100)));
      const white: [number, number, number][] = [];
      for (let t = -100; t <= 100; t++) white.push(linear(tone(PALETTE.elite, t / 100)));
      const seen = new Set<string>();
      let face = 0;
      const box = boxOf(g);
      const b = linear(base);
      const baseLum = (b[0] + b[1] + b[2]) / 3;
      for (let v = 0; v < tint.count; v++) {
        const c = [tint.getX(v), tint.getY(v), tint.getZ(v)];
        const list = rig.getW(v) === PART_CROWN ? white : tones;
        expect(list.some((t) => close(t, c)), `${KINDS[k].name}: vertex ${v} is a tone of its colour`).toBe(true);
        seen.add(c.map((x) => x.toFixed(3)).join(','));
        // Eyes or a visor: far lighter or darker than the body, in the front of it.
        const lum = (c[0] + c[1] + c[2]) / 3;
        if (p.getZ(v) > box.max.z * 0.25 && Math.abs(lum - baseLum) > 0.25) face++;
      }
      expect(seen.size, `${KINDS[k].name} has two or three tones and more`).toBeGreaterThanOrEqual(3);
      expect(face, `${KINDS[k].name} has a face`).toBeGreaterThan(0);
    }
  });

  it('crowns an elite in its aura\'s colour, and nobody else', () => {
    const w = makeWorld(3);
    const plain = add(w, KIND_CUTTER, 0, 0, 0);
    const haste = add(w, KIND_CUTTER, 5, 0, 0);
    const marked = add(w, KIND_CUTTER, 10, 0, 0);
    w.horde.elite[haste] = ELITE_HASTE;
    w.horde.mark[marked] |= MARK_ELITE;
    const view = new HordeView();
    view.update(w, 1, 0, 0, -20);
    const pose = view.meshes[KIND_CUTTER].geometry.getAttribute('aPose');
    expect([plain, haste, marked].map((i) => pose.getX(i))).toEqual([-1, ELITE_HASTE, 0]);
    // Every ordinary kind has a crown to show.
    for (let k = 0; k < KIND_COUNT; k++) {
      const rig = geometryFor(k).getAttribute('aRig');
      let n = 0;
      for (let v = 0; v < rig.count; v++) if (rig.getW(v) === PART_CROWN) n++;
      expect(n, KINDS[k].name).toBeGreaterThan(0);
    }
  });

  it('winds the lobber\'s arm back just before a lob and swings it through just after', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_LOBBER, 0, 0, 0);
    const view = new HordeView();
    const pose = view.meshes[KIND_LOBBER].geometry.getAttribute('aPose');
    const at = (timer: number): [number, number] => {
      w.horde.timer[i] = timer;
      view.update(w, 1, 0, 0, 20);
      return [pose.getY(0), pose.getZ(0)];
    };
    expect(at(0)).toEqual([0, 0]);
    expect(at(100)).toEqual([0, 0]);
    const late = at(205);
    expect(late[0]).toBeGreaterThan(0.8);
    expect(late[1]).toBe(0);
    const after = at(3);
    expect(after[0]).toBe(0);
    expect(after[1]).toBeGreaterThan(0.7);
    // Its arm is the action part: it is what swings.
    const rig = lobberGeometry().getAttribute('aRig');
    let arm = 0;
    for (let v = 0; v < rig.count; v++) if (rig.getW(v) === PART_ACT) arm++;
    expect(arm).toBeGreaterThan(0);
  });

  it('drops the Bruiser\'s head in its tell and stretches it in its charge', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_BRUISER, 0, 0, 0, 0.15, 0);
    const view = new HordeView();
    const pose = view.meshes[KIND_BRUISER].geometry.getAttribute('aPose');
    w.horde.state[i] = 0;
    view.update(w, 1, 0, 0, 30);
    expect([pose.getY(0), pose.getZ(0)]).toEqual([0, 0]);
    w.horde.state[i] = 2;
    w.horde.timer[i] = 20;
    view.update(w, 1, 0, 0, 30);
    expect(pose.getY(0)).toBe(1);
    expect(pose.getZ(0)).toBe(0);
    w.horde.state[i] = 3;
    w.horde.timer[i] = 30;
    view.update(w, 1, 0, 0, 30);
    expect(pose.getY(0)).toBe(0);
    expect(pose.getZ(0)).toBe(1);
  });

  it('kicks the Mortar\'s tube down after a volley, not before its first', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_MORTAR, 0, 0, 0);
    const view = new HordeView();
    const pose = view.meshes[KIND_MORTAR].geometry.getAttribute('aPose');
    const at = (timer: number, age: number): number => {
      w.horde.timer[i] = timer;
      w.horde.age[i] = age;
      view.update(w, 1, 0, 0, 30);
      return pose.getY(0);
    };
    expect(at(5, SPAWN_TICKS + 5)).toBe(0);
    expect(at(240, 300)).toBe(1);
    expect(at(250, 310)).toBeGreaterThan(0.5);
    expect(at(300, 360)).toBe(0);
  });

  it('opens the Standstill\'s plates as a ring goes out and turns its eye toward the rider', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_STANDSTILL, 0, 0, 0, 0, 1);
    w.horde.age[i] = 1000;
    const view = new HordeView();
    const pose = view.meshes[KIND_STANDSTILL].geometry.getAttribute('aPose');
    const plates = (timer: number): number => {
      w.horde.timer[i] = timer;
      view.update(w, 1, 0, 0, 30);
      return pose.getY(0);
    };
    expect(plates(100)).toBe(0);
    expect(plates(205)).toBeGreaterThan(0.2);
    expect(plates(210 + 8)).toBeCloseTo(1, 5);
    expect(plates(210 + 60)).toBe(0);
    // Facing +z, the rider off to its +x and then its -x: the eye turns that way, never past its limit.
    w.horde.timer[i] = 100;
    view.update(w, 1, 0, 10, 10);
    expect(pose.getZ(0)).toBeGreaterThan(0.5);
    view.update(w, 1, 0, -10, 10);
    expect(pose.getZ(0)).toBeLessThan(-0.5);
    view.update(w, 1, 0, 0, -30);
    expect(Math.abs(pose.getZ(0))).toBeLessThanOrEqual(0.76);
  });

  it('shows a boss damaged under a third of its health: a piece lost, scars shown', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_BRUISER, 0, 0, 0, 0, 1);
    const view = new HordeView();
    const pose = view.meshes[KIND_BRUISER].geometry.getAttribute('aPose');
    w.horde.hp[i] = KINDS[KIND_BRUISER].hp * 0.5;
    view.update(w, 1, 0, 0, 30);
    expect(pose.getW(0)).toBe(0);
    w.horde.hp[i] = KINDS[KIND_BRUISER].hp * 0.3;
    view.update(w, 1, 0, 0, 30);
    expect(pose.getW(0)).toBe(1);
    for (const k of [KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL]) {
      const rig = geometryFor(k).getAttribute('aRig');
      let intact = 0;
      let scar = 0;
      for (let v = 0; v < rig.count; v++) {
        if (rig.getW(v) === PART_INTACT) intact++;
        if (rig.getW(v) === PART_SCAR) scar++;
      }
      expect(intact, KINDS[k].name).toBeGreaterThan(0);
      expect(scar, KINDS[k].name).toBeGreaterThan(0);
    }
    // An ordinary enemy is never "damaged", however hurt.
    const s = add(w, KIND_SHUFFLER, 5, 0, 0);
    w.horde.hp[s] = 0.1;
    view.update(w, 1, 0, 0, 30);
    expect(view.meshes[KIND_SHUFFLER].geometry.getAttribute('aPose').getW(0)).toBe(0);
  });

  it('marks a clinger holding on, so it kicks', () => {
    const w = makeWorld(3);
    const i = add(w, KIND_CLINGER, 50, 0, 50);
    const view = new HordeView();
    const pose = view.meshes[KIND_CLINGER].geometry.getAttribute('aPose');
    view.update(w, 1, 0, 0, 0);
    expect(pose.getZ(0)).toBe(0);
    w.horde.state[i] = STATE_LATCHED;
    view.update(w, 1, 0, 0, 0);
    expect(pose.getZ(0)).toBe(1);
  });

  it('gives each kind its own shader program, so each moves its own way', () => {
    const view = new HordeView();
    const keys = new Set(view.meshes.map((m) => (m.material as unknown as { customProgramCacheKey: () => string }).customProgramCacheKey()));
    expect(keys.size).toBe(KINDS.length);
  });
});
