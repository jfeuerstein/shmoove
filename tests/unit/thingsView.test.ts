import mainSource from '../../src/app/main.ts?raw';
import { Color, InstancedMesh, type InstancedBufferAttribute, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import {
  ARC_DOTS,
  ARC_MIDDLE,
  ARC_STEP,
  ARC_TAKEOFF,
  BOX_TRIANGLES,
  CALL_TIME,
  DOTS_PER_LEG,
  DROP_TIME,
  EYES_HIGH,
  EYES_LOW,
  FLASH_TIME,
  GATE_HALF,
  GLOW_EYES,
  GLOW_LIT,
  GLOW_UNLIT,
  HOOP_RADIUS,
  POP_TIME,
  RAISE_TIME,
  SHRINE_DASHES,
  SHRINE_RING,
  THROW_TIME,
  GLOW_GATE,
  GLOW_GATE_NEXT,
  GLOW_GOLD,
  HOOP_GONE,
  HOOP_READY,
  PILLAR_HIGH,
  POST_HIGH,
  BEACON_FAR,
  BEACON_NEAR,
  beaconShare,
  ThingsView,
  TOTEM_DASHES,
  TOTEM_HIGH,
  TOTEM_RING,
} from '../../src/render/thingsView';
import { flatTerrain } from '../../src/sim/terrain';
import { shrineSector, THINGS } from '../../src/sim/things';
import {
  makeWorld,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from '../../src/sim/world';

function put(w: World, kind: number, x: number, z: number, yaw = 0, group = 0, y = 0): number {
  const t = w.things;
  const i = t.count++;
  t.kind[i] = kind;
  t.x[i] = x;
  t.y[i] = y;
  t.z[i] = z;
  t.yaw[i] = yaw;
  t.state[i] = 0;
  t.progress[i] = 0;
  t.timer[i] = 0;
  t.group[i] = group;
  return i;
}

/** What one box of the solids looks like: where, how big, its colour and glow. */
function solid(view: ThingsView, n: number): { x: number; y: number; z: number; w: number; h: number; top: number; lo: number; hi: number; rgb: number[]; glow: number } {
  const m = view.solids.instanceMatrix.array;
  const o = n * 16;
  const h = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
  const c = view.solids.instanceColor;
  if (!c) throw new Error('no colours');
  const g = view.solids.geometry.getAttribute('aGlow') as InstancedBufferAttribute;
  return {
    x: m[o + 12],
    y: m[o + 13],
    z: m[o + 14],
    w: Math.hypot(m[o], m[o + 1], m[o + 2]),
    h,
    top: m[o + 13] + h / 2,
    // The lowest and highest point of the box, however it is turned.
    lo: m[o + 13] - (Math.abs(m[o + 1]) + Math.abs(m[o + 5]) + Math.abs(m[o + 9])) / 2,
    hi: m[o + 13] + (Math.abs(m[o + 1]) + Math.abs(m[o + 5]) + Math.abs(m[o + 9])) / 2,
    rgb: [c.getX(n), c.getY(n), c.getZ(n)],
    glow: g.getX(n),
  };
}

function boxesOf(view: ThingsView, i: number): ReturnType<typeof solid>[] {
  const out = [];
  for (let k = 0; k < view.solidCount[i]; k++) out.push(solid(view, view.firstSolid[i] + k));
  return out;
}

function trimsOf(view: ThingsView, i: number): ReturnType<typeof solid>[] {
  const out = [];
  for (let k = 0; k < view.trimCount[i]; k++) out.push(solid(view, view.firstTrim[i] + k));
  return out;
}

/** What one mark (a dash or a dot) looks like: its middle, its length and width, its colour and glow. */
function markAt(view: ThingsView, n: number): { x: number; y: number; z: number; len: number; wide: number; rgb: number[]; glow: number } {
  const m = view.marks.instanceMatrix.array;
  const o = n * 16;
  const c = view.marks.instanceColor;
  if (!c) throw new Error('no colours');
  const g = view.marks.geometry.getAttribute('aGlow') as InstancedBufferAttribute;
  return {
    x: m[o + 12],
    y: m[o + 13],
    z: m[o + 14],
    wide: Math.hypot(m[o], m[o + 1], m[o + 2]),
    len: Math.hypot(m[o + 8], m[o + 9], m[o + 10]),
    rgb: [c.getX(n), c.getY(n), c.getZ(n)],
    glow: g.getX(n),
  };
}

function marksOf(view: ThingsView, i: number): ReturnType<typeof markAt>[] {
  const out = [];
  for (let k = 0; k < view.markCount[i]; k++) out.push(markAt(view, view.firstMark[i] + k));
  return out;
}

/** Which of a run of marks are lit. */
function litOf(marks: ReturnType<typeof markAt>[]): boolean[] {
  return marks.map((d) => d.glow >= GLOW_LIT - 1e-6);
}

function linear(color: number): number[] {
  const c = new Color(color);
  return [c.r, c.g, c.b];
}

function brightness(rgb: number[]): number {
  return rgb[0] + rgb[1] + rgb[2];
}

describe('ThingsView', () => {
  it('draws a crate as a box on the ground and a spent one as low debris', () => {
    const w = makeWorld(1);
    const i = put(w, THING_CRATE, 4, 5);
    const view = new ThingsView();
    view.update(w, 0);
    const [box] = boxesOf(view, i);
    expect(view.solidCount[i]).toBe(1);
    expect([box.x, box.z]).toEqual([4, 5]);
    expect(box.y - box.h / 2).toBeCloseTo(0, 5);
    expect(box.h).toBeGreaterThan(1);
    expect(box.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.things[THING_CRATE]).map((v) => v.toFixed(4)));
    w.things.state[i] = THING_DONE;
    view.update(w, 0);
    const [debris] = boxesOf(view, i);
    expect(debris.h).toBeLessThan(0.3);
    expect(debris.glow).toBeCloseTo(0);
    expect(debris.rgb).not.toEqual(box.rgb);
  });

  it('makes the gold crate unmistakably gold: its own colour, a strong glow, bigger, turning', () => {
    const w = makeWorld(1);
    const c = put(w, THING_CRATE, 0, 0);
    const g = put(w, THING_GOLD_CRATE, 5, 0);
    const view = new ThingsView();
    view.update(w, 0);
    const crate = boxesOf(view, c)[0];
    const gold = boxesOf(view, g)[0];
    expect(gold.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.things[THING_GOLD_CRATE]).map((v) => v.toFixed(4)));
    expect(gold.glow).toBeCloseTo(GLOW_GOLD);
    expect(gold.glow).toBeGreaterThan(crate.glow * 3);
    expect(gold.w).toBeGreaterThan(crate.w);
    const m0 = view.solids.instanceMatrix.array[view.firstSolid[g] * 16];
    view.update(w, 0.7);
    const m1 = view.solids.instanceMatrix.array[view.firstSolid[g] * 16];
    expect(m1).not.toBeCloseTo(m0, 3);
    w.things.state[g] = THING_DONE;
    view.update(w, 0);
    expect(boxesOf(view, g)[0].h).toBeLessThan(0.3);
  });

  it('draws a shrine as a pillar with a ring of twelve dashes round it, one in each segment of its ring', () => {
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 10, -10);
    const view = new ThingsView();
    view.update(w, 0);
    const pillar = boxesOf(view, s);
    expect(pillar.length).toBe(2);
    expect(pillar[0].h).toBeCloseTo(PILLAR_HIGH, 5);
    const dashes = marksOf(view, s);
    expect(dashes.length).toBe(SHRINE_DASHES);
    dashes.forEach((d, k) => {
      // On the ground, about 6 m out, in the sim's segment k, and inside the band where it lights.
      const r = Math.hypot(d.x - 10, d.z + 10);
      expect(r).toBeGreaterThan(SHRINE_RING - 0.5);
      expect(r).toBeLessThan(SHRINE_RING + 0.1);
      expect(r).toBeGreaterThan(THINGS.shrineNear);
      expect(r).toBeLessThan(THINGS.shrineFar);
      expect(shrineSector(d.x - 10, d.z + 10)).toBe(k);
      expect(d.y).toBeLessThan(0.2);
      expect(d.len).toBeGreaterThan(1.5);
    });
    // Untouched: every dash dim.
    expect(litOf(dashes)).toEqual(new Array(SHRINE_DASHES).fill(false));
  });

  it('lights the dashes the sim has lit, bright gold, each with a pop, and dims them all at once when they go out', () => {
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 0, 0);
    const view = new ThingsView();
    view.update(w, 0);
    w.things.progress[s] = 0b100000000111;
    view.update(w, 1);
    const lit = litOf(marksOf(view, s));
    expect(lit).toEqual([true, true, true, false, false, false, false, false, false, false, false, true]);
    const now = marksOf(view, s);
    for (const k of [0, 1, 2, 11]) {
      expect(now[k].rgb.map((v) => v.toFixed(4))).not.toEqual(now[5].rgb.map((v) => v.toFixed(4)));
      expect(brightness(now[k].rgb)).toBeGreaterThan(brightness(now[5].rgb));
    }
    // The pop: wide when it lights, settled a moment later.
    const popped = now[0].wide;
    view.update(w, 1 + POP_TIME + 0.1);
    const settled = marksOf(view, s)[0];
    expect(popped).toBeGreaterThan(settled.wide * 1.3);
    // One more lights: only it pops.
    w.things.progress[s] |= 1 << 6;
    view.update(w, 2);
    const next = marksOf(view, s);
    expect(next[6].wide).toBeCloseTo(popped, 5);
    expect(next[0].wide).toBeCloseTo(settled.wide, 5);
    // Out of range in the sim: every dash dim, at once.
    w.things.progress[s] = 0;
    view.update(w, 2.01);
    expect(litOf(marksOf(view, s))).toEqual(new Array(SHRINE_DASHES).fill(false));
    // Lit before the view first saw it: no pop.
    w.things.progress[s] = 0b11;
    const fresh = new ThingsView();
    fresh.update(w, 5);
    expect(marksOf(fresh, s)[0].wide).toBeCloseTo(settled.wide, 5);
  });

  it('runs a pulse round through the unlit dashes, the way the rider is circling (clockwise before)', () => {
    /** Where the pulse is: the unlit dash glowing most. */
    const peak = (view: ThingsView, s: number): number => {
      const d = marksOf(view, s);
      let best = -1;
      for (let k = 0; k < d.length; k++) if (best < 0 || d[k].glow > d[best].glow) best = k;
      return best;
    };
    /** How far round the pulse moved, in segments, from one frame to the next: + the way k grows. */
    const moved = (a: number, b: number): number => {
      let d = b - a;
      if (d > SHRINE_DASHES / 2) d -= SHRINE_DASHES;
      if (d < -SHRINE_DASHES / 2) d += SHRINE_DASHES;
      return d;
    };
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 0, 0);
    const view = new ThingsView();
    // No rider near: clockwise seen from above, the way atan2(x, z), and so k, falls.
    view.update(w, 0);
    const a = peak(view, s);
    view.update(w, 0.25);
    expect(moved(a, peak(view, s))).toBeLessThan(0);
    expect(marksOf(view, s)[peak(view, s)].glow).toBeGreaterThan(GLOW_UNLIT + 0.3);
    // A rider going round the other way: the pulse turns with it.
    for (let f = 0; f < 5; f++) view.update(w, 1 + f / 60, 6 * Math.sin(f * 0.05), 6 * Math.cos(f * 0.05));
    const b = peak(view, s);
    view.update(w, 1.3, 6 * Math.sin(0.3), 6 * Math.cos(0.3));
    expect(moved(b, peak(view, s))).toBeGreaterThan(0);
    // It never lights a lit dash brighter: they are steady.
    w.things.progress[s] = (1 << SHRINE_DASHES) - 1 - (1 << 4);
    for (let f = 0; f < 30; f++) {
      view.update(w, 10 + f / 30, 6 * Math.sin(f * 0.05), 6 * Math.cos(f * 0.05));
      const d = marksOf(view, s);
      for (let k = 0; k < d.length; k++) if (k !== 4) expect(d[k].glow).toBeGreaterThanOrEqual(GLOW_LIT - 1e-6);
    }
  });

  it('flashes the whole ring as the shrine opens, then leaves it grey round the stump', () => {
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 0, 0);
    const view = new ThingsView();
    w.things.progress[s] = (1 << SHRINE_DASHES) - 1 - 1;
    view.update(w, 0);
    w.things.state[s] = THING_DONE;
    const glows: number[] = [];
    for (let f = 0; f < 20; f++) {
      view.update(w, 1 + (f * FLASH_TIME) / 20);
      const d = marksOf(view, s);
      expect(d.length).toBe(SHRINE_DASHES);
      for (const m of d) expect(m.glow).toBeGreaterThanOrEqual(GLOW_LIT - 1e-6);
      glows.push(d[3].glow);
    }
    // Flashing, not steady.
    expect(Math.max(...glows) - Math.min(...glows)).toBeGreaterThan(0.4);
    view.update(w, 1 + FLASH_TIME + 0.5);
    const stump = boxesOf(view, s);
    expect(stump.length).toBe(1);
    expect(stump[0].h).toBeLessThan(PILLAR_HIGH / 2);
    for (const m of marksOf(view, s)) expect(m.glow).toBeCloseTo(0);
  });

  it('draws gates as two posts and a bar, the next of the slalom bright, cleared ones grey, spent ones stumps', () => {
    const w = makeWorld(1);
    const first = put(w, THING_GATE, 0, 0, 0, 1);
    for (let k = 1; k < 5; k++) put(w, THING_GATE, 3 * (k % 2), 18 * k, 0, 1);
    const view = new ThingsView();
    view.update(w, 0);
    // Posts either side of the middle along the gate's line, bar across at the top.
    const g0 = boxesOf(view, first);
    expect(g0.length).toBe(3);
    expect(Math.abs(g0[0].x - g0[1].x)).toBeCloseTo(GATE_HALF * 2, 5);
    expect(g0[0].h).toBeCloseTo(POST_HIGH, 5);
    expect(g0[2].top).toBeCloseTo(POST_HIGH, 5);
    // Waiting: the first gate is next and bright; the rest are dim.
    expect(g0[0].glow).toBeCloseTo(GLOW_GATE_NEXT);
    for (let k = 1; k < 5; k++) {
      const g = boxesOf(view, first + k)[0];
      expect(g.glow).toBeCloseTo(GLOW_GATE);
      expect(brightness(g.rgb)).toBeLessThan(brightness(g0[0].rgb));
    }
    // In progress: two taken, the third next.
    for (let k = 0; k < 5; k++) w.things.state[first + k] = 2;
    view.update(w, 0);
    const looks = [0, 1, 2, 3, 4].map((k) => boxesOf(view, first + k)[0]);
    expect(looks[2].glow).toBeCloseTo(GLOW_GATE_NEXT);
    expect(looks[0].glow).toBeCloseTo(0);
    expect(looks[1].glow).toBeCloseTo(0);
    expect(looks[3].glow).toBeCloseTo(GLOW_GATE);
    expect(looks[0].rgb).not.toEqual(looks[3].rgb);
    // Spent: stumps, no bar.
    for (let k = 0; k < 5; k++) w.things.state[first + k] = THING_DONE;
    view.update(w, 0);
    const spent = boxesOf(view, first);
    expect(spent.length).toBe(2);
    expect(spent[0].h).toBeLessThan(POST_HIGH / 2);
  });

  it('draws a hoop in the air facing its yaw, faint while it waits to come back', () => {
    const w = makeWorld(1);
    const h = put(w, THING_HOOP, 2, 3, Math.PI / 2, 0, 6);
    const view = new ThingsView();
    view.update(w, 0);
    expect(view.hoops.count).toBe(1);
    expect(view.solidCount[h]).toBe(0);
    const k = view.hoopOf[h];
    const m = view.hoops.instanceMatrix.array;
    expect([m[k * 16 + 12], m[k * 16 + 13], m[k * 16 + 14]]).toEqual([2, 6, 3]);
    // Its face (local z) points along the yaw: +x for a quarter turn.
    expect(m[k * 16 + 8]).toBeCloseTo(1, 5);
    expect(m[k * 16 + 10]).toBeCloseTo(0, 5);
    const fade = view.hoops.geometry.getAttribute('aFade') as InstancedBufferAttribute;
    // Waiting, it pulses gently, never far under its strength.
    const strengths: number[] = [];
    for (let f = 0; f < 40; f++) {
      view.update(w, f / 20);
      strengths.push(fade.getX(view.hoopOf[h]));
    }
    expect(Math.max(...strengths)).toBeLessThanOrEqual(HOOP_READY + 1e-6);
    expect(Math.min(...strengths)).toBeGreaterThan(HOOP_READY * 0.8);
    expect(Math.max(...strengths) - Math.min(...strengths)).toBeGreaterThan(0.05);
    w.things.state[h] = 1;
    view.update(w, 0);
    expect(fade.getX(view.hoopOf[h])).toBeCloseTo(HOOP_GONE);
    expect(HOOP_GONE).toBeLessThan(HOOP_READY / 3);
  });

  it('draws a totem as a tall marker and a spent one as a grey stump', () => {
    const w = makeWorld(1);
    const t = put(w, THING_TOTEM, 0, 0);
    const view = new ThingsView();
    view.update(w, 0);
    const marker = boxesOf(view, t);
    expect(marker.length).toBe(2);
    expect(Math.max(...marker.map((b) => b.top))).toBeGreaterThan(TOTEM_HIGH);
    expect(marker[0].rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.things[THING_TOTEM]).map((v) => v.toFixed(4)));
    w.things.state[t] = THING_DONE;
    view.update(w, 0);
    const stump = boxesOf(view, t);
    expect(stump.length).toBe(1);
    expect(stump[0].top).toBeLessThan(1.5);
    expect(stump[0].glow).toBeCloseTo(0);
  });

  it('draws every thing on the map in four draw calls, and nothing when there is none', () => {
    const w = makeWorld(1);
    const view = new ThingsView();
    view.update(w, 0);
    expect(view.solids.visible || view.hoops.visible || view.marks.visible || view.beacons.visible).toBe(false);
    for (let k = 0; k < 30; k++) put(w, k % 6, k * 4, 0, 0, k % 6 === THING_GATE ? 1 + k : 0);
    view.update(w, 0);
    // Boxes, hoops, the marks on the ground and in the air, and the beacons.
    expect(view.object.children.length).toBe(4);
    expect(view.solids.visible && view.hoops.visible && view.marks.visible && view.beacons.visible).toBe(true);
  });

  it('says what each thing wants with the thing itself: no words anywhere, no labels in the app', () => {
    const w = makeWorld(1);
    for (let k = 0; k < 5; k++) put(w, THING_GATE, 0, 18 * k, 0, 1);
    for (let kind = 0; kind < 6; kind++) if (kind !== THING_GATE) put(w, kind, 20 + kind * 8, 0, 0, 0, kind === THING_HOOP ? 6 : 0);
    const view = new ThingsView(flatTerrain());
    view.update(w, 0);
    // Only meshes of shapes: nothing that could carry text (no sprites, no canvas textures).
    for (const c of view.object.children) {
      expect(c).toBeInstanceOf(InstancedMesh);
      const mat = (c as InstancedMesh).material as MeshLambertMaterial;
      expect(mat.map).toBeNull();
    }
    expect(mainSource).not.toMatch(/thingLabels|ThingLabels/);
    expect(Object.keys(import.meta.glob('../../src/ui/thingLabels*'))).toEqual([]);
  });

  it('keeps every thing within 150 triangles, and builds each from parts', () => {
    const w = makeWorld(1);
    for (let k = 0; k < 5; k++) put(w, THING_GATE, 0, 18 * k, 0, 1);
    for (let kind = 0; kind < 6; kind++) if (kind !== THING_GATE) put(w, kind, 20 + kind * 8, 0, 0, 0, kind === THING_HOOP ? 6 : 0);
    const view = new ThingsView();
    const hoopTris = (view.hoops.geometry.index?.count ?? 0) / 3;
    const beaconTris = view.beacons.geometry.getAttribute('position').count / 3;
    const markTris = view.marks.geometry.getAttribute('position').count / 3;
    expect(markTris).toBe(8);
    for (const state of [0, THING_DONE]) {
      for (let i = 0; i < w.things.count; i++) if (w.things.kind[i] !== THING_HOOP) w.things.state[i] = state;
      view.update(w, 0);
      for (let i = 0; i < w.things.count; i++) {
        const tris =
          (view.solidCount[i] + view.trimCount[i]) * BOX_TRIANGLES + (view.hoopOf[i] >= 0 ? hoopTris : 0) + (view.beaconOf[i] >= 0 ? beaconTris : 0);
        expect(tris, `thing ${i} kind ${w.things.kind[i]} state ${state}`).toBeLessThanOrEqual(150);
        // Its marks on the ground and in the air are cheap diamonds, a few dozen at most.
        expect(view.markCount[i] * markTris, `thing ${i} marks`).toBeLessThanOrEqual(ARC_DOTS * markTris);
        if (state === 0) expect(view.solidCount[i] + view.trimCount[i], `thing ${i}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('puts a tall beacon of its colour over every live thing but a plain crate, one per slalom over its next gate, none when spent', () => {
    const w = makeWorld(1);
    const crate = put(w, THING_CRATE, 0, 0);
    const shrine = put(w, THING_SHRINE, 20, 0);
    const totem = put(w, THING_TOTEM, 40, 0);
    const hoop = put(w, THING_HOOP, 60, 0, 0, 0, 6);
    const gold = put(w, THING_GOLD_CRATE, 80, 0);
    const gates = [0, 1, 2, 3, 4].map((k) => put(w, THING_GATE, 100, 18 * k, 0, 1));
    const view = new ThingsView();
    view.update(w, 0);
    const beam = (i: number): { x: number; y: number; z: number; high: number; rgb: number[]; fade: number } => {
      const b = view.beaconOf[i];
      expect(b).toBeGreaterThanOrEqual(0);
      const m = view.beacons.instanceMatrix.array;
      const c = view.beacons.instanceColor;
      if (!c) throw new Error('no colours');
      const f = view.beacons.geometry.getAttribute('aFade') as InstancedBufferAttribute;
      return { x: m[b * 16 + 12], y: m[b * 16 + 13], z: m[b * 16 + 14], high: m[b * 16 + 5], rgb: [c.getX(b), c.getY(b), c.getZ(b)], fade: f.getX(b) };
    };
    // Plain crates are many and found by riding: none.
    expect(view.beaconOf[crate]).toBe(-1);
    for (const i of [shrine, totem, hoop, gold]) {
      const b = beam(i);
      expect([b.x, b.z]).toEqual([w.things.x[i], w.things.z[i]]);
      // Starts above the thing and stands far over any hill.
      expect(b.y).toBeGreaterThan(w.things.y[i]);
      expect(b.high).toBeGreaterThanOrEqual(30);
      expect(b.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.things[w.things.kind[i]]).map((v) => v.toFixed(4)));
    }
    expect(beam(gold).fade).toBeGreaterThan(beam(shrine).fade);
    // Seen through the fog.
    expect((view.beacons.material as MeshLambertMaterial).fog).toBe(false);
    // Faint at its foot (up close only the foot is in view), brightest higher up, gone at the top.
    const g = view.beacons.geometry;
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const shadeAt = (y: number): number[] => {
      const out = [];
      for (let v = 0; v < pos.count; v++) if (Math.abs(pos.getY(v) - y) < 1e-6) out.push(col.getX(v));
      return out;
    };
    const ys = [...new Set(Array.from({ length: pos.count }, (_, v) => pos.getY(v)))].sort((a, b) => a - b);
    expect(Math.max(...shadeAt(ys[0]))).toBeLessThan(0.3);
    expect(Math.max(...shadeAt(ys[ys.length - 1]))).toBeCloseTo(0);
    expect(Math.max(...ys.map((y) => Math.max(...shadeAt(y))))).toBeCloseTo(1);
    // Double-sided but drawn in one pass: one draw call.
    expect((view.beacons.material as MeshLambertMaterial).forceSinglePass).toBe(true);
    // The slalom: one beacon, over the next gate.
    expect(gates.filter((g) => view.beaconOf[g] >= 0)).toEqual([gates[0]]);
    for (const g of gates) w.things.state[g] = 3;
    view.update(w, 0);
    expect(gates.filter((g) => view.beaconOf[g] >= 0)).toEqual([gates[3]]);
    // Spent things, a taken hoop and a finished slalom have none.
    for (const i of [crate, shrine, totem, gold, ...gates]) w.things.state[i] = THING_DONE;
    w.things.state[hoop] = 1;
    view.update(w, 0);
    expect(view.beacons.count).toBe(0);
    expect(view.beacons.visible).toBe(false);
  });

  it('fades a beacon out as the rider comes near, where the thing itself takes over', () => {
    expect(beaconShare(BEACON_FAR + 10)).toBe(1);
    expect(beaconShare(BEACON_FAR)).toBe(1);
    expect(beaconShare((BEACON_FAR + BEACON_NEAR) / 2)).toBeCloseTo(0.5, 5);
    expect(beaconShare(BEACON_NEAR)).toBe(0);
    expect(beaconShare(0)).toBe(0);
    const w = makeWorld(1);
    const shrine = put(w, THING_SHRINE, 0, 0);
    const view = new ThingsView();
    const fade = view.beacons.geometry.getAttribute('aFade') as InstancedBufferAttribute;
    view.update(w, 0, 0, -(BEACON_FAR + 20));
    const far = fade.getX(view.beaconOf[shrine]);
    view.update(w, 0, 0, -(BEACON_FAR + BEACON_NEAR) / 2);
    expect(fade.getX(view.beaconOf[shrine])).toBeCloseTo(far / 2, 5);
    // Near enough to act on it: no beacon at all.
    view.update(w, 0, 0, -(BEACON_NEAR - 1));
    expect(view.beaconOf[shrine]).toBe(-1);
    expect(view.beacons.count).toBe(0);
  });

  it('builds a crate with a lid on top, and throws its planks out when it breaks', () => {
    const w = makeWorld(1);
    const i = put(w, THING_CRATE, 0, 0);
    const view = new ThingsView();
    view.update(w, 0);
    const body = boxesOf(view, i)[0];
    expect(Math.max(...trimsOf(view, i).map((b) => b.top))).toBeGreaterThan(body.top);
    w.things.state[i] = THING_DONE;
    view.update(w, 10);
    // Just broken: the planks are still at the crate, in the air.
    const flying = trimsOf(view, i);
    expect(flying.length).toBe(3);
    for (const p of flying) expect(p.y).toBeGreaterThan(0.4);
    view.update(w, 10 + THROW_TIME / 2);
    const mid = trimsOf(view, i);
    view.update(w, 10 + THROW_TIME + 1);
    const lying = trimsOf(view, i);
    for (let k = 0; k < 3; k++) {
      // Thrown out, and fallen to the ground round the debris.
      expect(Math.hypot(lying[k].x, lying[k].z)).toBeGreaterThan(Math.hypot(mid[k].x, mid[k].z));
      expect(Math.hypot(lying[k].x, lying[k].z)).toBeGreaterThan(0.9);
      expect(lying[k].y).toBeLessThan(0.2);
    }
    // A crate already broken when first seen is not broken again.
    const fresh = new ThingsView();
    fresh.update(w, 50);
    for (const p of trimsOf(fresh, i)) expect(p.y).toBeLessThan(0.2);
  });

  it("drops the shrine's floating gem to the ground when it is done", () => {
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 0, 0);
    const view = new ThingsView();
    view.update(w, 0);
    const gem = boxesOf(view, s)[1];
    expect(gem.y).toBeGreaterThan(PILLAR_HIGH);
    w.things.state[s] = THING_DONE;
    view.update(w, 5);
    const top = (): number => Math.max(...trimsOf(view, s).map((b) => b.y));
    expect(top()).toBeGreaterThan(PILLAR_HIGH);
    view.update(w, 5 + DROP_TIME + 0.1);
    expect(top()).toBeLessThan(1);
  });

  it('shakes a called totem with its eyes lit, then sinks it to leave the stump', () => {
    const w = makeWorld(1);
    const i = put(w, THING_TOTEM, 0, 0);
    const view = new ThingsView();
    view.update(w, 0);
    const eyesOf = (): ReturnType<typeof solid>[] => trimsOf(view, i).filter((b) => b.w < 0.25);
    const idle = eyesOf();
    expect(idle.length).toBe(6);
    // Waiting: a slow red glow (it bites), under the glow of a called one.
    const idleGlows: number[] = [];
    for (let f = 0; f < 40; f++) {
      view.update(w, f / 10);
      for (const e of eyesOf()) {
        expect(e.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.threat).map((v) => v.toFixed(4)));
        expect(e.glow).toBeGreaterThanOrEqual(EYES_LOW - 1e-6);
        expect(e.glow).toBeLessThanOrEqual(EYES_HIGH + 1e-6);
        idleGlows.push(e.glow);
      }
    }
    expect(Math.max(...idleGlows) - Math.min(...idleGlows)).toBeGreaterThan(0.2);
    expect(EYES_HIGH).toBeLessThan(GLOW_EYES);
    // A faint ring of dashes on the ground where it is touched.
    const ring = marksOf(view, i);
    expect(ring.length).toBe(TOTEM_DASHES);
    for (const d of ring) {
      expect(Math.hypot(d.x, d.z)).toBeCloseTo(TOTEM_RING, 0);
      expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(TOTEM_RING + 1e-6);
      expect(d.glow).toBeLessThan(0.3);
      expect(d.y).toBeLessThan(0.2);
    }
    w.things.state[i] = THING_DONE;
    view.update(w, 3);
    const lit = eyesOf();
    expect(lit.length).toBe(6);
    for (const e of lit) {
      expect(e.glow).toBeCloseTo(GLOW_EYES);
      expect(brightness(e.rgb)).toBeGreaterThan(brightness(linear(PALETTE.threat)));
    }
    expect(view.markCount[i]).toBe(0);
    view.update(w, 3.13);
    const moved = eyesOf();
    expect(moved.some((e, k) => Math.abs(e.x - lit[k].x) + Math.abs(e.z - lit[k].z) > 0.01)).toBe(true);
    view.update(w, 3 + CALL_TIME * 0.95);
    expect(Math.max(...trimsOf(view, i).map((b) => b.top))).toBeLessThan(TOTEM_HIGH * 0.5);
    view.update(w, 3 + CALL_TIME + 0.1);
    expect(view.trimCount[i]).toBe(0);
    expect(boxesOf(view, i).length).toBe(1);
  });

  it('draws a dotted line from gate to gate: marching before it is started, and the leg into the next gate its clock', () => {
    const w = makeWorld(1);
    const gates = [0, 1, 2, 3, 4].map((k) => put(w, THING_GATE, 0, 20 * k, 0, 1));
    const view = new ThingsView();
    const legOf = (g: number): ReturnType<typeof markAt>[] => marksOf(view, g);
    view.update(w, 0);
    // Every gate but the last has its leg's dots between it and the next, in order along it.
    for (let k = 0; k < 4; k++) {
      const d = legOf(gates[k]);
      expect(d.length).toBe(DOTS_PER_LEG);
      for (let j = 0; j < d.length; j++) {
        expect(d[j].z).toBeGreaterThan(20 * k);
        expect(d[j].z).toBeLessThan(20 * (k + 1));
        if (j > 0) expect(d[j].z).toBeGreaterThan(d[j - 1].z);
        expect(d[j].y).toBeLessThan(0.2);
      }
    }
    expect(legOf(gates[4]).length).toBe(0);
    // Not started: a wave marches along the whole line, away from the first gate.
    const crest = (): number => {
      const all = gates.slice(0, 4).flatMap((g) => legOf(g));
      let best = 0;
      for (let j = 0; j < 12; j++) if (all[j].glow > all[best].glow) best = j;
      return best;
    };
    const c0 = crest();
    view.update(w, 0.08);
    const c1 = crest();
    expect(c1).toBeGreaterThan(c0);
    expect(c1 - c0).toBeLessThan(4);

    // Started, two taken, the clock full: the legs behind lit, the leg into gate 2 lit, the rest dim.
    for (const g of gates) {
      w.things.state[g] = 2;
      w.things.timer[g] = THINGS.slalomTicks;
    }
    view.update(w, 1);
    expect(litOf(legOf(gates[0]))).toEqual(new Array(DOTS_PER_LEG).fill(true));
    expect(litOf(legOf(gates[1]))).toEqual(new Array(DOTS_PER_LEG).fill(true));
    expect(litOf(legOf(gates[2]))).toEqual(new Array(DOTS_PER_LEG).fill(false));
    expect(litOf(legOf(gates[3]))).toEqual(new Array(DOTS_PER_LEG).fill(false));
    // As the clock runs the leg's dots go out from the rider's end (the gate just taken) toward the next gate.
    const litCount = (): number => litOf(legOf(gates[1])).filter(Boolean).length;
    let before = litCount();
    for (let left = THINGS.slalomTicks; left > 0; left -= 15) {
      for (const g of gates) w.things.timer[g] = left;
      view.update(w, 1);
      const lit = litOf(legOf(gates[1]));
      const n = lit.filter(Boolean).length;
      expect(n).toBeLessThanOrEqual(before);
      expect(n).toBeGreaterThan(0);
      // The lit ones are the ones nearest the next gate.
      expect(lit).toEqual(lit.map((_, j) => j >= DOTS_PER_LEG - n));
      before = n;
    }
    for (const g of gates) w.things.timer[g] = THINGS.slalomTicks / 2;
    view.update(w, 1);
    expect(litCount()).toBe(DOTS_PER_LEG / 2);
    expect(before).toBe(1);
    // The taken gates' banners hang lower than the rest.
    const banner = (g: number): number => boxesOf(view, g)[2].top;
    expect(banner(gates[0])).toBeLessThan(POST_HIGH * 0.6);
    expect(banner(gates[3])).toBeCloseTo(POST_HIGH, 5);

    // The clock ran out: back at the start. The lowered banners rise again and the line marches.
    for (const g of gates) {
      w.things.state[g] = 0;
      w.things.timer[g] = 0;
    }
    view.update(w, 2);
    expect(banner(gates[0])).toBeLessThan(POST_HIGH * 0.6);
    view.update(w, 2 + RAISE_TIME / 2);
    expect(banner(gates[0])).toBeGreaterThan(POST_HIGH * 0.6);
    expect(banner(gates[0])).toBeLessThan(POST_HIGH);
    expect(banner(gates[3])).toBeCloseTo(POST_HIGH, 5);
    view.update(w, 2 + RAISE_TIME + 0.1);
    expect(banner(gates[0])).toBeCloseTo(POST_HIGH, 5);
    const m0 = crest();
    view.update(w, 2 + RAISE_TIME + 0.18);
    expect(crest()).toBeGreaterThan(m0);
  });

  it('holds a hoop up on two poles from the ground, and draws its flight as a dotted arc up the ramp and through its middle', () => {
    const w = makeWorld(1);
    const y = THINGS.hoopGap + HOOP_RADIUS;
    const h = put(w, THING_HOOP, 0, 0, 0, 0, y);
    const view = new ThingsView(flatTerrain());
    view.update(w, 0);
    const parts = trimsOf(view, h);
    const poles = parts.filter((b) => b.hi - b.lo > y);
    expect(poles.length).toBe(2);
    for (const p of poles) {
      expect(p.lo).toBeLessThanOrEqual(0);
      expect(p.hi).toBeGreaterThan(y);
      expect(Math.abs(p.x)).toBeGreaterThan(HOOP_RADIUS);
    }
    const arc = marksOf(view, h);
    expect(arc.length).toBe(ARC_DOTS);
    // Along the way it is flown (yaw 0: +z), evenly, on its line.
    arc.forEach((d, k) => {
      expect(d.x).toBeCloseTo(0, 5);
      expect(d.z).toBeCloseTo((k - ARC_MIDDLE) * ARC_STEP, 5);
    });
    // Up the ramp on the ground, then in the air, and through the ring's very middle.
    for (let k = 0; k <= ARC_MIDDLE - ARC_TAKEOFF; k++) expect(arc[k].y, `dot ${k}`).toBeLessThan(0.2);
    for (let k = ARC_MIDDLE - ARC_TAKEOFF + 1; k <= ARC_MIDDLE; k++) expect(arc[k].y).toBeGreaterThan(arc[k - 1].y);
    expect(arc[ARC_MIDDLE].y).toBeCloseTo(y, 5);
    expect(arc[ARC_MIDDLE + 1].y).toBeLessThan(y);
    // Marching the way it is flown: the brightest dot moves on.
    const crest = (): number => {
      const d = marksOf(view, h);
      let best = 0;
      for (let k = 0; k < 7; k++) if (d[k].glow > d[best].glow) best = k;
      return best;
    };
    view.update(w, 0.3);
    const c0 = crest();
    view.update(w, 0.4);
    expect(crest()).toBeGreaterThan(c0);
    // While it is gone: no arc.
    w.things.state[h] = 1;
    view.update(w, 1);
    expect(view.markCount[h]).toBe(0);
  });
});
