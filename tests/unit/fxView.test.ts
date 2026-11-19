import { Color, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { BOLT_FROM, BOLT_JAG, BOLT_LIFE, BOLT_POINTS, BOLT_TO, FxView, GRIND_BURST, GRIND_STREAM } from '../../src/render/fxView';
import { PALETTE } from '../../src/render/look';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { EV_GRIND_END, EV_GRIND_START, EV_HOP } from '../../src/sim/types';
import {
  emitFx,
  FX_ARC,
  FX_BLAST,
  FX_ENEMY_HIT,
  FX_HEAL,
  FX_POP,
  FX_SLAM,
  FX_THING,
  FX_TOKEN,
  makeWorld,
  THING_CRATE,
} from '../../src/sim/world';

/** Point k of bolt b. */
function point(fx: FxView, b: number, k: number): [number, number, number] {
  const o = (b * BOLT_POINTS + k) * 3;
  return [fx.boltPoints[o], fx.boltPoints[o + 1], fx.boltPoints[o + 2]];
}

/** Distance from p to the segment a-b. */
function offLine(p: number[], a: number[], b: number[]): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
}

describe('FxView bolts', () => {
  it('draws a run of FX_ARC as one jagged bolt from the mover through the struck enemies in order', () => {
    const w = makeWorld(1);
    const struck = [
      [4, 0, 3],
      [8, 0.5, 6],
      [9, 0.2, 11],
    ];
    emitFx(w, FX_ENEMY_HIT, 1, 1, 1, 5);
    struck.forEach(([x, y, z], k) => emitFx(w, FX_ARC, x, y, z, k));
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 1, 2, -1);
    expect(fx.liveBolts).toBe(1);
    expect(fx.boltCount[0]).toBe(1 + struck.length * BOLT_JAG);
    // It starts at the mover's chest and passes through each enemy in order.
    expect(point(fx, 0, 0)).toEqual([1, 2 + BOLT_FROM, -1]);
    const anchors = [[1, 2 + BOLT_FROM, -1]];
    struck.forEach(([x, y, z], k) => {
      const p = point(fx, 0, (k + 1) * BOLT_JAG);
      expect(p[0]).toBeCloseTo(x, 5);
      expect(p[1]).toBeCloseTo(y + BOLT_TO, 5);
      expect(p[2]).toBeCloseTo(z, 5);
      anchors.push(p);
    });
    // The points between are jagged: off the straight line, but not far off it.
    let wander = 0;
    for (let k = 0; k < struck.length; k++) {
      for (let j = 1; j < BOLT_JAG; j++) {
        const d = offLine(point(fx, 0, k * BOLT_JAG + j), anchors[k], anchors[k + 1]);
        expect(d).toBeLessThan(1);
        wander += d;
      }
    }
    expect(wander).toBeGreaterThan(0.05);
    // Drawn as one segment between each pair of points, gone in BOLT_LIFE.
    fx.update(0.01);
    expect(fx.bolts.count).toBe(struck.length * BOLT_JAG);
    expect(fx.bolts.visible).toBe(true);
    // A frame step is capped at 0.1 s: two frames of BOLT_LIFE.
    fx.update(BOLT_LIFE);
    fx.update(BOLT_LIFE);
    expect(fx.liveBolts).toBe(0);
    expect(fx.bolts.visible).toBe(false);
  });

  it('starts a new bolt for each run in a tick', () => {
    const w = makeWorld(1);
    emitFx(w, FX_ARC, 2, 0, 2, 0);
    emitFx(w, FX_ARC, 4, 0, 2, 1);
    emitFx(w, FX_ARC, -3, 0, 0, 0);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 0, 0, 0);
    expect(fx.liveBolts).toBe(2);
    expect(fx.boltCount[0]).toBe(1 + 2 * BOLT_JAG);
    expect(fx.boltCount[1]).toBe(1 + BOLT_JAG);
    expect(point(fx, 1, 0)).toEqual([0, BOLT_FROM, 0]);
    expect(point(fx, 1, BOLT_JAG)[0]).toBeCloseTo(-3, 5);
  });
});

describe('FxView glows and marks', () => {
  it('rings the ground for a slam out to its radius and flashes and rings for a blast', () => {
    const w = makeWorld(1);
    emitFx(w, FX_SLAM, 3, 0, 4, 6);
    emitFx(w, FX_BLAST, -5, 0, 1, 3);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveGlows).toBe(4);
    fx.update(0.001);
    expect(fx.glows.count).toBe(4);
    const disc = fx.glows.geometry.getAttribute('aDisc') as InstancedBufferAttribute;
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    const slam = new Color(PALETTE.slam);
    // The slam's ring: a band near the rim, in the slam's colour, at its place.
    const m = fx.glows.instanceMatrix.array;
    expect(disc.getX(0)).toBeGreaterThan(0.5);
    expect(c.getX(0)).toBeCloseTo(slam.r, 5);
    expect([m[12], m[14]]).toEqual([3, 4]);
    // The ring grows out to the radius before it fades.
    let r = 0;
    for (let t = 0; t < 0.4; t += 0.05) {
      fx.update(0.05);
      if (fx.liveGlows > 0) r = Math.max(r, fx.glows.instanceMatrix.array[0]);
    }
    expect(r).toBeGreaterThan(6 * 0.9);
    expect(r).toBeLessThanOrEqual(6 + 1e-6);
    for (let k = 0; k < 10; k++) fx.update(0.1);
    expect(fx.liveGlows).toBe(0);
  });

  it('still rings a pop out to the loop', () => {
    const w = makeWorld(1);
    emitFx(w, FX_POP, 0, 0, 0, 9);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveGlows).toBe(2);
    fx.update(0.001);
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getY(0)).toBeCloseTo(new Color(PALETTE.pop).g, 5);
  });

  it('raises a small mark from the mover for a heal and a token, and bursts a used thing', () => {
    const w = makeWorld(1);
    emitFx(w, FX_HEAL, 0, 1, 0, 25);
    emitFx(w, FX_TOKEN, 0, 1, 0, 1);
    emitFx(w, FX_THING, 6, 0, 6, THING_CRATE);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveMarks).toBe(2);
    expect(fx.liveShards).toBeGreaterThan(0);
    fx.update(0.05);
    const y0 = fx.marks.instanceMatrix.array[13];
    fx.update(0.2);
    const y1 = fx.marks.instanceMatrix.array[13];
    expect(y0).toBeGreaterThan(1);
    expect(y1).toBeGreaterThan(y0);
    const c = fx.marks.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getY(0)).toBeCloseTo(new Color(PALETTE.hp).g, 5);
    expect(c.getX(1)).toBeCloseTo(new Color(PALETTE.things[1]).r, 5);
    const s = fx.shards.instanceColor;
    if (!s) throw new Error('no colours');
    expect(s.getX(0)).toBeCloseTo(new Color(PALETTE.things[THING_CRATE]).r, 5);
    for (let k = 0; k < 10; k++) fx.update(0.1);
    expect(fx.liveMarks).toBe(0);
    fx.reset();
    expect(fx.liveShards + fx.liveGlows + fx.liveBolts + fx.liveMarks).toBe(0);
  });
});

describe('FxView grind sparks', () => {
  it('streams small grind-coloured sparks back off the board while it is on a rail, and bursts at both ends', () => {
    const terrain = flatTerrain(100);
    const w = makeWorld(1);
    const s = makeSimState(terrain);
    const m = s.mover;
    m.x = 3;
    m.y = 1.2;
    m.z = 0;
    m.vx = 0;
    m.vz = 14;
    const fx = new FxView(terrain);

    /** One sim step's worth: the tick moves on, then the view takes it. */
    const tick = (events: number): void => {
      s.tick++;
      s.events = events;
      fx.ingest(w, m.x, m.y, m.z, s);
    };

    // Riding past, or hopping, throws nothing.
    tick(EV_HOP);
    expect(fx.liveShards).toBe(0);

    // On: a burst, and the stream starts.
    m.rail = 0;
    tick(EV_GRIND_START);
    const burst = fx.liveShards;
    expect(burst).toBeGreaterThanOrEqual(GRIND_BURST);
    for (let t = 0; t < 10; t++) tick(0);
    expect(fx.liveShards).toBe(burst + 10 * GRIND_STREAM);
    // While the sim holds still (cards on the table) the board throws nothing.
    s.events = 0;
    for (let t = 0; t < 5; t++) fx.ingest(w, m.x, m.y, m.z, s);
    expect(fx.liveShards).toBe(burst + 10 * GRIND_STREAM);

    // They are the grind's colour, and they fly back from the way the board goes, and up.
    fx.update(1 / 60);
    const col = fx.shards.instanceColor;
    if (!col) throw new Error('no colours');
    const want = new Color(PALETTE.grindSpark);
    for (let i = 0; i < fx.liveShards; i++) {
      expect(col.getX(i)).toBeCloseTo(want.r, 5);
      expect(col.getY(i)).toBeCloseTo(want.g, 5);
      expect(col.getZ(i)).toBeCloseTo(want.b, 5);
    }
    const before = fx.liveShards;
    tick(0);
    fx.update(1 / 60);
    const mat = fx.shards.instanceMatrix.array;
    let back = 0;
    for (let i = before; i < fx.liveShards; i++) {
      expect(mat[i * 16 + 13]).toBeGreaterThan(m.y);
      if (mat[i * 16 + 14] < m.z) back++;
    }
    expect(back).toBe(GRIND_STREAM);

    // Off: one more burst, then nothing new.
    m.rail = -1;
    const n = fx.liveShards;
    tick(EV_GRIND_END);
    expect(fx.liveShards).toBeGreaterThanOrEqual(n + GRIND_BURST);
    const after = fx.liveShards;
    tick(0);
    expect(fx.liveShards).toBe(after);
    // And they die away.
    for (let k = 0; k < 10; k++) fx.update(0.1);
    expect(fx.liveShards).toBe(0);
  });
});
