import { Color, type InstancedBufferAttribute, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { STONE_THICK, STONE_WIDTH, STREAK_LENGTH, ShotsView } from '../../src/render/shotsView';
import { LANCE_HEIGHT, STREAKS, WeaponsView } from '../../src/render/weaponsView';
import { W_LANCE, W_ORBIT, W_SLIPSTREAM } from '../../src/sim/arsenal';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import type { SimState, Vec3 } from '../../src/sim/types';
import { lanceLength } from '../../src/sim/weapons/lance';
import { orbitDisc } from '../../src/sim/weapons/orbit';
import { slipstreamLength } from '../../src/sim/weapons/slipstream';
import { makeWorld, SHOT_DART, SHOT_STONE, WEAPON_MEM, type World } from '../../src/sim/world';

function matrix(mesh: InstancedMesh, n: number): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(n * 16, n * 16 + 16));
}

function state(x: number, y: number, z: number, heading: number, gear = 1, tucked = false): SimState {
  const s = makeSimState(flatTerrain(100));
  const m = s.mover;
  m.x = x;
  m.y = y;
  m.z = z;
  m.heading = heading;
  m.gear = gear;
  m.tucked = tucked;
  return s;
}

function arm(w: World, id: number, level: number): void {
  w.player.loadout.weaponLevel[id] = level;
}

describe('WeaponsView', () => {
  it('draws the Orbit discs exactly where orbitDisc puts them', () => {
    const w = makeWorld(1);
    arm(w, W_ORBIT, 5);
    w.mem[W_ORBIT * WEAPON_MEM] = 1.1;
    const s = state(3, 2, -4, 0.3);
    const view = new WeaponsView();
    view.update(w, s, s, 1, 0);
    expect(view.discs.count).toBe(4);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 4; k++) {
      expect(orbitDisc(w, s, k, p)).toBe(true);
      const m = matrix(view.discs, k);
      expect(m[12]).toBeCloseTo(p.x, 5);
      expect(m[13]).toBeCloseTo(p.y, 5);
      expect(m[14]).toBeCloseTo(p.z, 5);
    }
    // Between ticks they move with the mover as drawn.
    const prev = state(1, 2, -4, 0.3);
    view.update(w, prev, s, 0.5, 0);
    orbitDisc(w, s, 0, p);
    expect(matrix(view.discs, 0)[12]).toBeCloseTo(p.x - 1, 5);
    // Not carried: none.
    arm(w, W_ORBIT, 0);
    view.update(w, s, s, 1, 0);
    expect(view.discs.count).toBe(0);
    expect(view.discs.visible).toBe(false);
  });

  it('draws the Lance as a beam straight ahead as long as lanceLength, whenever it is carried', () => {
    const w = makeWorld(1);
    const view = new WeaponsView();
    const on = state(0, 1, 0, Math.PI / 2, 1, false);
    view.update(w, on, on, 1, 0);
    expect(view.lanceBeams).toBe(0);
    expect(view.beams.visible).toBe(false);
    arm(w, W_LANCE, 3);
    // Slow and untucked, or fast and tucked: the same beam.
    const fast = state(0, 1, 0, Math.PI / 2, 4, true);
    view.update(w, fast, fast, 1, 0);
    expect(view.lanceBeams).toBe(2);
    const len = lanceLength(w, on);
    expect(len).toBeGreaterThan(5);
    view.update(w, on, on, 1, 0);
    expect(view.lanceBeams).toBe(2);
    for (let k = 0; k < 2; k++) {
      const m = matrix(view.beams, k);
      // Along +x (heading a quarter turn), centred half its length ahead, at chest height.
      expect(m[8]).toBeCloseTo(len, 4);
      expect(m[10]).toBeCloseTo(0, 4);
      expect(m[12]).toBeCloseTo(len / 2, 4);
      expect(m[14]).toBeCloseTo(0, 4);
      expect(m[13]).toBeCloseTo(1 + LANCE_HEIGHT, 5);
    }
    const c = view.beams.instanceColor;
    if (!c) throw new Error('no colours');
    const want = new Color(PALETTE.lance);
    expect(c.getX(1)).toBeCloseTo(want.r, 5);
    expect(c.getZ(1)).toBeCloseTo(want.b, 5);
  });

  it('draws faint streaks in the Slipstream cone behind the mover whenever it is carried', () => {
    const w = makeWorld(1);
    const view = new WeaponsView();
    const fast = state(0, 0, 0, 0, 1);
    view.update(w, fast, fast, 1, 0);
    expect(view.streakBeams).toBe(0);
    expect(view.beams.visible).toBe(false);
    arm(w, W_SLIPSTREAM, 2);
    const len = slipstreamLength(w, fast, 2);
    expect(len).toBeGreaterThan(5);
    view.update(w, fast, fast, 1, 0.37);
    expect(view.streakBeams).toBe(STREAKS);
    const fade = view.beams.geometry.getAttribute('aFade') as InstancedBufferAttribute;
    for (let k = 0; k < STREAKS; k++) {
      const m = matrix(view.beams, k);
      // Behind (the mover faces +z) and inside the draft.
      expect(m[14]).toBeLessThan(0);
      expect(Math.hypot(m[12], m[14])).toBeLessThan(len);
      expect(Math.abs(Math.atan2(m[12], -m[14]))).toBeLessThan((25 * Math.PI) / 180);
      expect(fade.getX(k)).toBeLessThanOrEqual(0.3 + 1e-6);
    }
  });
});

describe('ShotsView', () => {
  it('tells stones from darts: a flat wide pebble in the stone colour against a long streak', () => {
    const w = makeWorld(1);
    const sh = w.shots;
    for (const [i, kind] of [[0, SHOT_DART], [1, SHOT_STONE]] as const) {
      sh.count++;
      sh.x[i] = i * 5;
      sh.y[i] = 1;
      sh.z[i] = 0;
      sh.vx[i] = 0;
      sh.vy[i] = 0;
      sh.vz[i] = 20;
      sh.kind[i] = kind;
    }
    const view = new ShotsView();
    view.update(w, 1, 0);
    expect(view.mesh.count).toBe(2);
    const dart = matrix(view.mesh, 0);
    const stone = matrix(view.mesh, 1);
    // The dart is long along its flight.
    expect(dart[10]).toBeCloseTo(STREAK_LENGTH, 5);
    expect(Math.hypot(dart[0], dart[1], dart[2])).toBeLessThan(0.2);
    // The stone is flat and wide.
    expect(Math.hypot(stone[0], stone[1], stone[2])).toBeCloseTo(STONE_WIDTH, 5);
    expect(Math.hypot(stone[4], stone[5], stone[6])).toBeCloseTo(STONE_THICK, 5);
    expect([stone[12], stone[13], stone[14]]).toEqual([5, 1, 0]);
    const c = view.mesh.instanceColor;
    if (!c) throw new Error('no colours');
    const stoneRgb = new Color(PALETTE.stone);
    const dartRgb = new Color(PALETTE.shot);
    expect(c.getX(1)).toBeCloseTo(stoneRgb.r, 5);
    expect(c.getZ(1)).toBeCloseTo(stoneRgb.b, 5);
    expect(c.getX(0)).toBeCloseTo(dartRgb.r, 5);
    expect(c.getZ(0)).toBeCloseTo(dartRgb.b, 5);
  });

  it('draws a shot back along its velocity by (1 - alpha) of a tick', () => {
    const w = makeWorld(1);
    const sh = w.shots;
    sh.count = 1;
    sh.x[0] = 10;
    sh.y[0] = 1;
    sh.z[0] = 0;
    sh.vx[0] = 30;
    sh.vy[0] = 0;
    sh.vz[0] = 0;
    sh.kind[0] = SHOT_DART;
    const view = new ShotsView();
    view.update(w, 0.5, 0);
    expect(matrix(view.mesh, 0)[12]).toBeCloseTo(10 - 30 * 0.5 / 60, 5);
    sh.count = 0;
    view.update(w, 1, 0);
    expect(view.mesh.visible).toBe(false);
  });
});
