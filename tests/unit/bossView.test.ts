import type { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { AURA_BANDS, BossView, LANE_LENGTH, LANE_ROWS, LANE_WIDTH, laneOf, makeLane, TELL_TICKS } from '../../src/render/bossView';
import { BOSS, BRUISER_CHARGE, BRUISER_REST, BRUISER_TELL, BRUISER_WALK } from '../../src/sim/bosses';
import { terrainFromHeight } from '../../src/sim/terrain';
import { KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL, KINDS, makeWorld, spawnEnemy, type World } from '../../src/sim/world';

describe('laneOf', () => {
  it('is as wide as the Bruiser and as long as its longest charge', () => {
    expect(LANE_WIDTH).toBeCloseTo(2 * KINDS[KIND_BRUISER].radius);
    expect(LANE_LENGTH).toBe(BOSS.bruiser.chargeFar);
    expect(TELL_TICKS).toBe(Math.round(BOSS.bruiser.tell * 60));
  });

  it('fills along its length over the tell, reaching the end as the charge starts', () => {
    const l = makeLane();
    laneOf(BRUISER_TELL, 0, 0, 3, 4, 0, 0, 1, 0, l);
    expect(l.on).toBe(true);
    expect(l.length).toBe(LANE_LENGTH);
    expect(l.lit).toBeCloseTo(0);
    laneOf(BRUISER_TELL, TELL_TICKS / 2, 0, 3, 4, 0, 0, 1, 0, l);
    expect(l.lit).toBeCloseTo(LANE_LENGTH / 2);
    let last = -1;
    for (let t = 0; t < TELL_TICKS; t++) {
      laneOf(BRUISER_TELL, t, 0.5, 3, 4, 0, 0, 1, 0, l);
      expect(l.lit).toBeGreaterThan(last);
      last = l.lit;
    }
    // The last tick of the tell, drawn at its end: the whole lane, the moment the charge begins.
    laneOf(BRUISER_TELL, TELL_TICKS - 1, 1, 3, 4, 0, 0, 1, 0, l);
    expect(l.lit).toBeCloseTo(LANE_LENGTH);
    laneOf(BRUISER_CHARGE, 0, 0, 9, 9, 3, 4, 1, 0, l);
    expect(l.lit).toBe(LANE_LENGTH);
  });

  it('starts at the Bruiser in the tell, and where the charge began during the charge', () => {
    const l = makeLane();
    laneOf(BRUISER_TELL, 10, 0, 5, -2, 40, 40, 0.6, 0.8, l);
    expect([l.x, l.z, l.dirX, l.dirZ]).toEqual([5, -2, 0.6, 0.8]);
    laneOf(BRUISER_CHARGE, 30, 0, 20, 14, 5, -2, 0.6, 0.8, l);
    expect([l.x, l.z, l.dirX, l.dirZ]).toEqual([5, -2, 0.6, 0.8]);
    // Held at full the whole charge.
    expect(l.lit).toBe(LANE_LENGTH);
  });

  it('is gone in the walk and the rest', () => {
    const l = makeLane();
    laneOf(BRUISER_TELL, 10, 0, 0, 0, 0, 0, 1, 0, l);
    expect(l.on).toBe(true);
    laneOf(BRUISER_REST, 3, 0, 0, 0, 0, 0, 1, 0, l);
    expect(l.on).toBe(false);
    expect(l.lit).toBe(0);
    laneOf(BRUISER_WALK, 100, 0, 0, 0, 0, 0, 1, 0, l);
    expect(l.on).toBe(false);
  });
});

function bruiser(w: World, state: number, timer: number): number {
  const i = spawnEnemy(w, KIND_BRUISER, 10, 0, 10);
  const h = w.horde;
  h.state[i] = state;
  h.timer[i] = timer;
  h.vx[i] = 0;
  h.vz[i] = 0;
  w.boss.kind = KIND_BRUISER;
  w.boss.aimX = 0;
  w.boss.aimZ = 1;
  w.boss.fromX = 10;
  w.boss.fromZ = 10;
  return i;
}

describe('BossView', () => {
  it('lays the lane on the ground, along the aim, lit to where the tell has got', () => {
    // A slope rising along +z: the lane must climb with it.
    const terrain = terrainFromHeight((_x, z) => z * 0.1, 200);
    const w = makeWorld(1);
    bruiser(w, BRUISER_TELL, TELL_TICKS / 2);
    const view = new BossView(terrain);
    view.update(w, 0);
    expect(view.lane.visible).toBe(true);
    const pos = view.lane.geometry.getAttribute('position') as BufferAttribute;
    const fade = view.lane.geometry.getAttribute('aFade') as BufferAttribute;
    const cols = pos.count / (2 * (LANE_ROWS + 1));
    // The lit strip ends half way along; the faint one runs on to the full length.
    const litEnd = LANE_ROWS * cols + Math.floor(cols / 2);
    const end = (2 * (LANE_ROWS + 1) - 1) * cols + Math.floor(cols / 2);
    expect(pos.getZ(litEnd)).toBeCloseTo(10 + LANE_LENGTH / 2, 3);
    expect(pos.getZ(end)).toBeCloseTo(10 + LANE_LENGTH, 3);
    expect(pos.getX(end)).toBeCloseTo(10, 3);
    for (const v of [0, litEnd, end]) expect(pos.getY(v)).toBeCloseTo(terrain.heightAt(pos.getX(v), pos.getZ(v)) + 0.1, 3);
    // As wide as the Bruiser.
    expect(Math.abs(pos.getX(0) - pos.getX(cols - 1))).toBeCloseTo(LANE_WIDTH, 3);
    // Brighter where lit than ahead of the fill.
    expect(fade.getX(Math.floor(cols / 2))).toBeGreaterThan(fade.getX(end));
    expect(fade.getX(end)).toBeGreaterThan(0);
  });

  it('draws no lane in the walk and the rest, and none for another boss', () => {
    const w = makeWorld(1);
    const i = bruiser(w, BRUISER_WALK, 10);
    const view = new BossView();
    view.update(w, 1);
    expect(view.lane.visible).toBe(false);
    w.horde.state[i] = BRUISER_CHARGE;
    view.update(w, 1);
    expect(view.lane.visible).toBe(true);
    w.horde.state[i] = BRUISER_REST;
    view.update(w, 1);
    expect(view.lane.visible).toBe(false);
    w.horde.kind[i] = KIND_MORTAR;
    w.horde.state[i] = BRUISER_TELL;
    view.update(w, 1);
    expect(view.lane.visible).toBe(false);
    expect(view.aura.count).toBe(0);
  });

  it('puts the slow disc under the Standstill, as far as it reaches, faint inside and clear at the edge', () => {
    const w = makeWorld(1);
    const i = spawnEnemy(w, KIND_STANDSTILL, -5, 0, 7);
    w.boss.kind = KIND_STANDSTILL;
    const view = new BossView();
    view.update(w, 1);
    expect(view.aura.count).toBe(AURA_BANDS + 1);
    expect(view.aura.mesh.visible).toBe(true);
    const seg = view.aura.segments;
    const verts = (seg + 1) * 2;
    // The outer vertex of the edge band lies at the reach, round the Standstill.
    const outer = AURA_BANDS * verts + 1;
    const p = view.aura.positions;
    expect(Math.hypot(p[outer * 3] + 5, p[outer * 3 + 2] - 7)).toBeCloseTo(BOSS.standstill.auraReach, 3);
    const fillFade = view.aura.fades[0];
    const edgeFade = view.aura.fades[AURA_BANDS * verts];
    expect(edgeFade).toBeGreaterThan(fillFade * 4);
    // It follows the Standstill.
    w.horde.x[i] = 20;
    view.update(w, 1);
    expect(Math.hypot(p[outer * 3] - 20, p[outer * 3 + 2] - 7)).toBeCloseTo(BOSS.standstill.auraReach, 3);
    // And goes with it.
    w.horde.count = 0;
    w.boss.kind = -1;
    view.update(w, 1);
    expect(view.aura.count).toBe(0);
    expect(view.aura.mesh.visible).toBe(false);
  });
});
