import { Color, type InstancedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { BOLT_FROM, BOLT_JAG, BOLT_LIFE, BOLT_POINTS, BOLT_REROLL, BOLT_TO, BOSS_BURST, BOSS_IN_LIFE, BOSS_IN_REACH, FxView, GRIND_BURST, GRIND_STREAM } from '../../src/render/fxView';
import { W_BUMPER } from '../../src/sim/arsenal';
import { FEEL } from '../../src/sim/constants';
import { PALETTE } from '../../src/render/look';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { EV_GRIND_END, EV_GRIND_START, EV_HOP } from '../../src/sim/types';
import {
  emitFx,
  FX_ARC,
  FX_BLAST,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_ENEMY_DIE,
  FX_ENEMY_HIT,
  FX_HEAL,
  FX_LEVEL_UP,
  FX_PLAYER_HIT,
  FX_POP,
  FX_SLAM,
  FX_SPARK,
  FX_THING,
  FX_TOKEN,
  KIND_BRUISER,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_STANDSTILL,
  makeWorld,
  PHASE_CHOOSE,
  PHASE_PLAY,
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
    expect(fx.shards.geometry.getAttribute('aGlow').getX(0)).toBe(0);
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
    const glow = fx.shards.geometry.getAttribute('aGlow');
    for (let i = 0; i < fx.liveShards; i++) {
      expect(col.getX(i)).toBeCloseTo(want.r, 5);
      expect(col.getY(i)).toBeCloseTo(want.g, 5);
      expect(col.getZ(i)).toBeCloseTo(want.b, 5);
      // Hot: they glow, where the shards of a broken crate or a dead enemy do not.
      expect(glow.getX(i)).toBeGreaterThanOrEqual(0.5);
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

describe('FxView bosses', () => {
  /** The colour of live shard i. */
  function shardRgb(fx: FxView, i: number): [number, number, number] {
    const c = fx.shards.instanceColor;
    if (!c) throw new Error('no colours');
    return [c.getX(i), c.getY(i), c.getZ(i)];
  }
  const linear = (hex: number): [number, number, number] => {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  };

  it('bursts a dead boss in its own colour, not the shuffler\'s', () => {
    for (const [kind, k] of [
      [KIND_BRUISER, 0],
      [KIND_MORTAR, 1],
      [KIND_STANDSTILL, 2],
    ] as const) {
      const w = makeWorld(1);
      emitFx(w, FX_ENEMY_DIE, 0, 0, 0, kind);
      const fx = new FxView(flatTerrain(100));
      fx.ingest(w);
      fx.update(0.01);
      const got = shardRgb(fx, 0);
      const want = linear(PALETTE.bosses[k]);
      for (let j = 0; j < 3; j++) expect(got[j], `kind ${kind}`).toBeCloseTo(want[j], 5);
    }
    const w = makeWorld(1);
    emitFx(w, FX_ENEMY_DIE, 0, 0, 0, KIND_SHUFFLER);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    fx.update(0.01);
    expect(shardRgb(fx, 0)[1]).toBeCloseTo(linear(PALETTE.enemies[KIND_SHUFFLER])[1], 5);
  });

  it('marks an arrival with shockwaves and a column in the boss colour, for about a second', () => {
    const w = makeWorld(1);
    emitFx(w, FX_BOSS_IN, 4, 0, -6, KIND_STANDSTILL);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveGlows).toBeGreaterThanOrEqual(3);
    expect(fx.liveShards).toBeGreaterThan(10);
    fx.update(0.01);
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    const want = linear(PALETTE.bosses[2]);
    expect(c.getX(0)).toBeCloseTo(want[0], 5);
    const m = fx.glows.instanceMatrix.array;
    expect([m[12], m[14]]).toEqual([4, -6]);
    // The widest wave reaches out to the reach.
    let r = 0;
    for (let t = 0; t < BOSS_IN_LIFE; t += 0.05) {
      fx.update(0.05);
      for (let g = 0; g < fx.glows.count; g++) r = Math.max(r, fx.glows.instanceMatrix.array[g * 16]);
    }
    expect(r).toBeGreaterThan(BOSS_IN_REACH * 0.85);
    expect(fx.liveGlows).toBe(0);
  });

  it('bursts a fallen boss several times over an ordinary death', () => {
    const death = makeWorld(1);
    emitFx(death, FX_ENEMY_DIE, 0, 0, 0, KIND_BRUISER);
    const a = new FxView(flatTerrain(100));
    a.ingest(death);
    const w = makeWorld(1);
    emitFx(w, FX_BOSS_DOWN, 0, 0, 0, KIND_BRUISER);
    const b = new FxView(flatTerrain(100));
    b.ingest(w);
    expect(b.liveShards).toBeGreaterThanOrEqual(a.liveShards * (BOSS_BURST - 1));
    expect(b.liveGlows).toBeGreaterThan(0);
    b.update(0.01);
    const got = shardRgb(b, 0);
    const want = linear(PALETTE.bosses[0]);
    for (let j = 0; j < 3; j++) expect(got[j]).toBeCloseTo(want[j], 5);
  });
});

describe('FxView: hits, deaths and the weapons that show on the ground', () => {
  it('throws a hit\'s chips out of the far side of the enemy, away from the rider', () => {
    const w = makeWorld(1);
    emitFx(w, FX_ENEMY_HIT, 10, 0, 0, 8);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 0, 0, 0);
    expect(fx.liveShards).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < 3; k++) fx.update(0.03);
    const m = fx.shards.instanceMatrix.array;
    for (let i = 0; i < fx.liveShards; i++) expect(m[i * 16 + 12]).toBeGreaterThan(10);
    // White-hot: they glow.
    expect(fx.shards.geometry.getAttribute('aGlow').getX(0)).toBeGreaterThan(0.4);
  });

  it('leaves a splat of the enemy\'s colour where it died, and chunks that land and lie, gone within a second', () => {
    const w = makeWorld(1);
    emitFx(w, FX_ENEMY_DIE, 3, 0, 4, KIND_SHUFFLER);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveGlows).toBe(1);
    expect(fx.liveBigGlows).toBe(0);
    fx.update(0.01);
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getX(0)).toBeCloseTo(new Color(PALETTE.enemies[KIND_SHUFFLER]).r, 5);
    const g = fx.glows.instanceMatrix.array;
    expect([g[12], g[14]]).toEqual([3, 4]);
    expect(g[13]).toBeLessThan(0.2);
    // Some chunks in a darker tone of the colour.
    const s = fx.shards.instanceColor;
    if (!s) throw new Error('no colours');
    const tones = new Set<number>();
    for (let i = 0; i < fx.liveShards; i++) tones.add(Math.round(s.getX(i) * 1000));
    expect(tones.size).toBe(2);
    // After well over half a second they are lying on the ground.
    for (let k = 0; k < 8; k++) fx.update(0.09);
    expect(fx.liveShards).toBeGreaterThan(0);
    const m = fx.shards.instanceMatrix.array;
    let lying = 0;
    for (let i = 0; i < fx.liveShards; i++) if (m[i * 16 + 13] < 0.2) lying++;
    expect(lying).toBe(fx.liveShards);
    for (let k = 0; k < 3; k++) fx.update(0.1);
    expect(fx.liveShards).toBe(0);
    expect(fx.liveGlows).toBe(0);
  });

  it('cracks the ground behind the slam\'s edge as it travels out, then lets the cracks fade', () => {
    const w = makeWorld(1);
    emitFx(w, FX_SLAM, 0, 0, 0, 6);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveCracks).toBe(1);
    fx.update(0.001);
    const early = fx.bolts.count;
    fx.update(0.2);
    const later = fx.bolts.count;
    expect(later).toBeGreaterThan(early);
    // On the ground, inside the wave's reach.
    const m = fx.bolts.instanceMatrix.array;
    for (let i = 0; i < later; i++) {
      expect(m[i * 16 + 13]).toBeLessThan(0.15);
      expect(Math.hypot(m[i * 16 + 12], m[i * 16 + 14])).toBeLessThan(6);
    }
    const col = fx.bolts.instanceColor;
    if (!col) throw new Error('no colours');
    expect(col.getY(0)).toBeCloseTo(new Color(PALETTE.slam).g, 5);
    for (let k = 0; k < 8; k++) fx.update(0.1);
    expect(fx.liveCracks).toBe(0);
    expect(fx.bolts.visible).toBe(false);
  });

  it('re-jags a bolt while it lasts, keeping it through the struck enemies, and flashes on each', () => {
    const w = makeWorld(1);
    emitFx(w, FX_ARC, 4, 0, 3, 0);
    emitFx(w, FX_ARC, 8, 0, 6, 1);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 0, 0, 0);
    // A flash on each enemy struck, at the height the bolt strikes it.
    expect(fx.liveGlows).toBe(2);
    const before = point(fx, 0, 1);
    fx.update(BOLT_REROLL + 0.001);
    const after = point(fx, 0, 1);
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(1e-4);
    expect(point(fx, 0, BOLT_JAG)[0]).toBeCloseTo(4, 5);
    expect(point(fx, 0, 2 * BOLT_JAG)[2]).toBeCloseTo(6, 5);
    expect(fx.glows.instanceMatrix.array[13]).toBeCloseTo(BOLT_TO + 0.2, 5);
  });

  it('rings the rider on a level-up, the rings climbing and following it as it rides on', () => {
    const w = makeWorld(1);
    emitFx(w, FX_LEVEL_UP, 0, 0, 0, 2);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 0, 0, 0);
    expect(fx.liveBigGlows).toBeGreaterThanOrEqual(3);
    expect(fx.liveShards).toBeGreaterThan(5);
    fx.update(0.05);
    const y0 = fx.glows.instanceMatrix.array[13];
    // The next tick: the rider is 5 m on, nothing new happened.
    const quiet = makeWorld(1);
    fx.ingest(quiet, 5, 0, 0);
    fx.update(0.2);
    const m = fx.glows.instanceMatrix.array;
    expect(m[12]).toBeCloseTo(5, 5);
    expect(m[13]).toBeGreaterThan(y0);
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getZ(0)).toBeCloseTo(new Color(PALETTE.spark).b, 5);
  });

  it('holds a level-up\'s burst while its cards are open, and lets it go as the ride resumes', () => {
    const w = makeWorld(1);
    emitFx(w, FX_LEVEL_UP, 0, 0, 0, 2);
    w.offer.open = true;
    w.run.phase = PHASE_CHOOSE;
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w, 1, 0, 2);
    expect(fx.liveGlows).toBe(0);
    // Ticks under the cards: still nothing.
    w.fx.count = 0;
    fx.ingest(w, 1, 0, 2);
    expect(fx.liveGlows).toBe(0);
    // The card is taken: the burst, round the rider where it is now.
    w.offer.open = false;
    w.run.phase = PHASE_PLAY;
    fx.ingest(w, 3, 0, 4);
    expect(fx.liveBigGlows).toBeGreaterThanOrEqual(3);
    fx.update(0.01);
    expect(fx.glows.instanceMatrix.array[12]).toBeCloseTo(3, 5);
    // Once only.
    const n = fx.liveBigGlows;
    fx.ingest(w, 3, 0, 4);
    expect(fx.liveBigGlows).toBe(n);
  });

  it('throws the Bumper\'s ring out to the shove radius at hip height when a hit lands, only if it is carried', () => {
    const plain = makeWorld(1);
    emitFx(plain, FX_PLAYER_HIT, 0, 0, 0, 10);
    const a = new FxView(flatTerrain(100));
    a.ingest(plain);
    expect(a.liveGlows).toBe(0);
    expect(a.hitTint).toBeGreaterThan(0);
    const w = makeWorld(1);
    w.player.loadout.weaponLevel[W_BUMPER] = 1;
    emitFx(w, FX_PLAYER_HIT, 0, 1, 0, 10);
    const b = new FxView(flatTerrain(100));
    b.ingest(w);
    expect(b.liveBigGlows).toBe(2);
    let r = 0;
    for (let t = 0; t < 0.4; t += 0.04) {
      b.update(0.04);
      if (b.glows.count > 0 && b.glows.instanceMatrix.array[13] > 1.5) r = Math.max(r, b.glows.instanceMatrix.array[0]);
    }
    expect(r).toBeGreaterThan(FEEL.hitShoveRadius * 0.9);
    expect(r).toBeLessThanOrEqual(FEEL.hitShoveRadius + 1e-6);
  });

  it('pops a spark where it was taken', () => {
    const w = makeWorld(1);
    emitFx(w, FX_SPARK, 1, 0, 2, 3);
    const fx = new FxView(flatTerrain(100));
    fx.ingest(w);
    expect(fx.liveGlows).toBe(1);
    expect(fx.liveBigGlows).toBe(0);
    fx.update(0.01);
    const c = fx.glows.instanceColor;
    if (!c) throw new Error('no colours');
    expect(c.getZ(0)).toBeCloseTo(new Color(PALETTE.spark).b, 5);
  });
});
