import { Color, type InstancedBufferAttribute, type MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import {
  BOX_TRIANGLES,
  CALL_TIME,
  DASHES_PER_LEG,
  DROP_TIME,
  GATE_HALF,
  GLOW_EYES,
  HOOP_RADIUS,
  THROW_TIME,
  GLOW_GATE,
  GLOW_GATE_NEXT,
  GLOW_GOLD,
  HOOP_GONE,
  HOOP_READY,
  PILLAR_HIGH,
  POST_HIGH,
  SHRINE_INNER,
  SHRINE_LAPS,
  SHRINE_OUTER,
  ThingsView,
  TOTEM_HIGH,
} from '../../src/render/thingsView';
import { flatTerrain } from '../../src/sim/terrain';
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

  it('draws a shrine as a pillar with a ring at the middle of its band that lights round by laps', () => {
    const w = makeWorld(1);
    const s = put(w, THING_SHRINE, 10, -10);
    const view = new ThingsView();
    const litShare = (): number => {
      const r = view.rings;
      const verts = (r.segments + 1) * 2;
      let lit = 0;
      let max = 0;
      for (let v = 0; v < verts; v++) max = Math.max(max, r.fades[v]);
      for (let v = 0; v < verts; v++) if (r.fades[v] >= max - 1e-6) lit++;
      return lit / verts;
    };
    view.update(w, 0);
    const pillar = boxesOf(view, s);
    expect(pillar.length).toBe(2);
    expect(pillar[0].h).toBeCloseTo(PILLAR_HIGH, 5);
    expect(view.rings.count).toBe(1);
    // The ring sits between the band's edges.
    const mid = (SHRINE_INNER + SHRINE_OUTER) / 2;
    for (let v = 0; v < (view.rings.segments + 1) * 2; v++) {
      const d = Math.hypot(view.rings.positions[v * 3] - 10, view.rings.positions[v * 3 + 2] + 10);
      expect(Math.abs(d - mid)).toBeLessThan(0.5);
    }
    // Waiting: only the start of the ring is lit; in progress: as far round as the laps; done: all.
    const waiting = litShare();
    expect(waiting).toBeLessThan(0.05);
    w.things.progress[s] = SHRINE_LAPS / 2;
    w.things.state[s] = 1;
    view.update(w, 0);
    expect(litShare()).toBeCloseTo(0.5, 1);
    w.things.progress[s] = SHRINE_LAPS;
    view.update(w, 0);
    expect(litShare()).toBe(1);
    // Spent: a stump and a faint ring.
    const before = Math.max(...view.rings.fades.slice(0, (view.rings.segments + 1) * 2));
    w.things.state[s] = THING_DONE;
    view.update(w, 0);
    const stump = boxesOf(view, s);
    expect(stump.length).toBe(1);
    expect(stump[0].h).toBeLessThan(PILLAR_HIGH / 2);
    expect(Math.max(...view.rings.fades.slice(0, (view.rings.segments + 1) * 2))).toBeLessThan(before / 2);
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
    // In progress: two cleared, the third next.
    for (let k = 0; k < 5; k++) w.things.state[first + k] = 2;
    view.update(w, 0);
    const looks = [0, 1, 2, 3, 4].map((k) => boxesOf(view, first + k)[0]);
    expect(looks[2].glow).toBeCloseTo(GLOW_GATE_NEXT);
    expect(looks[0].glow).toBeCloseTo(0);
    expect(looks[1].glow).toBeCloseTo(0);
    expect(looks[3].glow).toBeCloseTo(GLOW_GATE);
    expect(looks[0].rgb).not.toEqual(looks[3].rgb);
    // Waiting again after a miss (a state that names no gate): none bright, none grey.
    for (let k = 0; k < 5; k++) w.things.state[first + k] = 200;
    view.update(w, 0);
    for (let k = 0; k < 5; k++) expect(boxesOf(view, first + k)[0].glow).toBeCloseTo(GLOW_GATE);
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
    expect(fade.getX(k)).toBeCloseTo(HOOP_READY);
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
    expect(view.solids.visible || view.hoops.visible || view.rings.mesh.visible || view.beacons.visible).toBe(false);
    for (let k = 0; k < 30; k++) put(w, k % 6, k * 4, 0, 0, k % 6 === THING_GATE ? 1 + k : 0);
    view.update(w, 0);
    // Boxes, hoops, the shrines' rings and the beacons.
    expect(view.object.children.length).toBe(4);
    expect(view.solids.visible && view.hoops.visible && view.rings.mesh.visible && view.beacons.visible).toBe(true);
  });

  it('keeps every thing within 150 triangles, and builds each from parts', () => {
    const w = makeWorld(1);
    for (let k = 0; k < 5; k++) put(w, THING_GATE, 0, 18 * k, 0, 1);
    for (let kind = 0; kind < 6; kind++) if (kind !== THING_GATE) put(w, kind, 20 + kind * 8, 0, 0, 0, kind === THING_HOOP ? 6 : 0);
    const view = new ThingsView();
    const hoopTris = (view.hoops.geometry.index?.count ?? 0) / 3;
    const beaconTris = view.beacons.geometry.getAttribute('position').count / 3;
    for (const state of [0, THING_DONE]) {
      for (let i = 0; i < w.things.count; i++) if (w.things.kind[i] !== THING_HOOP) w.things.state[i] = state;
      view.update(w, 0);
      for (let i = 0; i < w.things.count; i++) {
        const tris =
          (view.solidCount[i] + view.trimCount[i]) * BOX_TRIANGLES + (view.hoopOf[i] >= 0 ? hoopTris : 0) + (view.beaconOf[i] >= 0 ? beaconTris : 0);
        expect(tris, `thing ${i} kind ${w.things.kind[i]} state ${state}`).toBeLessThanOrEqual(150);
        if (state === 0) expect(view.solidCount[i] + view.trimCount[i], `thing ${i}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('puts a tall beacon of its colour over every live thing, one per slalom over its next gate, none when spent', () => {
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
    for (const i of [crate, shrine, totem, hoop, gold]) {
      const b = beam(i);
      expect([b.x, b.z]).toEqual([w.things.x[i], w.things.z[i]]);
      // Starts above the thing and stands far over any hill.
      expect(b.y).toBeGreaterThan(w.things.y[i]);
      expect(b.high).toBeGreaterThanOrEqual(30);
      expect(b.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.things[w.things.kind[i]]).map((v) => v.toFixed(4)));
    }
    expect(beam(gold).fade).toBeGreaterThan(beam(crate).fade);
    // Seen through the fog.
    expect((view.beacons.material as MeshLambertMaterial).fog).toBe(false);
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
    for (const e of idle) expect(e.glow).toBeCloseTo(0);
    w.things.state[i] = THING_DONE;
    view.update(w, 3);
    const lit = eyesOf();
    expect(lit.length).toBe(6);
    for (const e of lit) {
      expect(e.glow).toBeCloseTo(GLOW_EYES);
      expect(e.rgb.map((v) => v.toFixed(4))).toEqual(linear(PALETTE.threat).map((v) => v.toFixed(4)));
    }
    view.update(w, 3.13);
    const moved = eyesOf();
    expect(moved.some((e, k) => Math.abs(e.x - lit[k].x) + Math.abs(e.z - lit[k].z) > 0.01)).toBe(true);
    view.update(w, 3 + CALL_TIME * 0.95);
    expect(Math.max(...trimsOf(view, i).map((b) => b.top))).toBeLessThan(TOTEM_HIGH * 0.5);
    view.update(w, 3 + CALL_TIME + 0.1);
    expect(view.trimCount[i]).toBe(0);
    expect(boxesOf(view, i).length).toBe(1);
  });

  it("draws a dashed line from gate to gate, lit into the next gate, and lowers a cleared gate's banner", () => {
    const w = makeWorld(1);
    const gates = [0, 1, 2, 3, 4].map((k) => put(w, THING_GATE, 0, 20 * k, 0, 1));
    const view = new ThingsView();
    for (const g of gates) w.things.state[g] = 2;
    view.update(w, 0);
    const dashes = (g: number): ReturnType<typeof solid>[] => trimsOf(view, g).filter((b) => b.hi < 0.2);
    // Every gate but the last has its leg's dashes between it and the next.
    for (let k = 0; k < 4; k++) {
      const d = dashes(gates[k]);
      expect(d.length).toBe(DASHES_PER_LEG);
      for (const b of d) expect(b.z).toBeGreaterThan(20 * k);
      for (const b of d) expect(b.z).toBeLessThan(20 * (k + 1));
    }
    expect(dashes(gates[4]).length).toBe(0);
    // The leg into gate 2 (from gate 1) is the lit one.
    const lit = (g: number): number => Math.max(...dashes(g).map((b) => b.glow));
    expect(lit(gates[1])).toBeGreaterThan(lit(gates[0]) * 2);
    expect(lit(gates[1])).toBeGreaterThan(lit(gates[3]) * 2);
    // The cleared gates' banners hang lower than the rest.
    const banner = (g: number): number => boxesOf(view, g)[2].top;
    expect(banner(gates[0])).toBeLessThan(POST_HIGH * 0.6);
    expect(banner(gates[3])).toBeCloseTo(POST_HIGH, 5);
  });

  it("holds a hoop up on two poles from the ground and marks its kicker's run-in with a chevron", () => {
    const w = makeWorld(1);
    const h = put(w, THING_HOOP, 0, 0, 0, 0, 6);
    const view = new ThingsView(flatTerrain());
    view.update(w, 0);
    const parts = trimsOf(view, h);
    const poles = parts.filter((b) => b.hi - b.lo > 4);
    expect(poles.length).toBe(2);
    for (const p of poles) {
      expect(p.lo).toBeLessThanOrEqual(0);
      expect(p.hi).toBeGreaterThan(6);
      expect(Math.abs(p.x)).toBeGreaterThan(HOOP_RADIUS);
    }
    // The chevron lies on the ground behind the hoop, along the way it is flown (yaw 0: +z).
    const flat = parts.filter((b) => b.hi < 0.3);
    expect(flat.length).toBe(2);
    for (const b of flat) expect(b.z).toBeLessThan(-15);
  });
});
