import { Color, type InstancedBufferAttribute, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { BUMPER_HIP } from '../../src/render/fxView';
import { ARC_MAX, HOP_FREE, STONE_THICK, STONE_WIDTH, STREAK_LENGTH, ShotsView, TRAIL_POINTS } from '../../src/render/shotsView';
import { LANCE_HEIGHT, STREAK_LINES, STREAK_SEGS, STREAKS, WeaponsView } from '../../src/render/weaponsView';
import { W_BUMPER, W_LANCE, W_ORBIT, W_SLIPSTREAM } from '../../src/sim/arsenal';
import { FEEL } from '../../src/sim/constants';
import { makeSimState } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import type { SimState, Vec3 } from '../../src/sim/types';
import { LANCE, lanceLength } from '../../src/sim/weapons/lance';
import { orbitDisc } from '../../src/sim/weapons/orbit';
import { slipstreamLength } from '../../src/sim/weapons/slipstream';
import { KIND_SHUFFLER, makeWorld, SHOT_DART, SHOT_STONE, spawnEnemy, WEAPON_MEM, type World } from '../../src/sim/world';

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

describe('WeaponsView: what each weapon looks like', () => {
  const kitShape = (view: WeaponsView, i: number): number => (view.discs.geometry.getAttribute('aShape') as InstancedBufferAttribute).getX(i);
  const kitGlow = (view: WeaponsView, i: number): number => (view.discs.geometry.getAttribute('aGlow') as InstancedBufferAttribute).getX(i);

  it('spins each Orbit blade on its own axis, tipped outward so its face shows', () => {
    const w = makeWorld(1);
    arm(w, W_ORBIT, 1);
    const s = state(0, 0, 0, 0);
    const view = new WeaponsView();
    view.update(w, s, s, 1, 0);
    const a = matrix(view.discs, 0);
    view.update(w, s, s, 1, 0.05);
    const b = matrix(view.discs, 0);
    // Same place, turned: its across-axes moved, its own axis (local y) did not.
    expect([b[12], b[13], b[14]]).toEqual([a[12], a[13], a[14]]);
    expect(Math.hypot(b[0] - a[0], b[2] - a[2])).toBeGreaterThan(0.1);
    expect(b[4]).toBeCloseTo(a[4], 6);
    expect(b[5]).toBeCloseTo(a[5], 6);
    // The axis leans away from the rider: mostly up, and outward toward where the blade is.
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    orbitDisc(w, s, 0, p);
    expect(a[5]).toBeGreaterThan(0.8);
    expect(a[4] * p.x + a[6] * p.z).toBeGreaterThan(0);
    expect(kitShape(view, 0)).toBe(0);
    // A streak along the orbit behind each blade.
    expect(view.beams.count).toBeGreaterThanOrEqual(1);
  });

  it("puts the Bumper's hoop round the hips, taller at level 5, and flares it the moment a hit lands", () => {
    const w = makeWorld(1);
    const s = state(2, 1, -3, 0);
    const view = new WeaponsView();
    view.update(w, s, s, 1, 0);
    expect(view.hoop).toBe(false);
    expect(view.discs.visible).toBe(false);
    arm(w, W_BUMPER, 1);
    view.update(w, s, s, 1, 0);
    expect(view.hoop).toBe(true);
    expect(view.discs.count).toBe(1);
    expect(kitShape(view, 0)).toBe(1);
    const calm = matrix(view.discs, 0);
    expect([calm[12], calm[14]]).toEqual([2, -3]);
    expect(calm[13]).toBeCloseTo(1 + BUMPER_HIP, 6);
    const calmGlow = kitGlow(view, 0);
    arm(w, W_BUMPER, 5);
    view.update(w, s, s, 1, 0);
    expect(matrix(view.discs, 0)[5]).toBeGreaterThan(calm[5] * 1.4);
    // A hit: the sim's invulnerability starts. The hoop swells and glows, then settles.
    arm(w, W_BUMPER, 1);
    w.player.invuln = FEEL.invulnTicks;
    view.update(w, s, s, 1, 0);
    expect(view.hoopFlare).toBe(1);
    const flared = matrix(view.discs, 0);
    expect(Math.hypot(flared[0], flared[1], flared[2])).toBeGreaterThan(Math.hypot(calm[0], calm[1], calm[2]) * 1.3);
    expect(kitGlow(view, 0)).toBeGreaterThan(calmGlow + 1);
    w.player.invuln = FEEL.invulnTicks - 30;
    view.update(w, s, s, 1, 0);
    expect(view.hoopFlare).toBe(0);
    // With the blades out too, they come first and the hoop after them.
    arm(w, W_ORBIT, 5);
    view.update(w, s, s, 1, 0);
    expect(view.discCount).toBe(4);
    expect(view.discs.count).toBe(5);
    expect(kitShape(view, 4)).toBe(1);
  });

  it("swells the Lance's core on the burn's own beat, thicker at higher levels, the sheath as wide as it reaches", () => {
    const w = makeWorld(1);
    const s = state(0, 0, 0, 0);
    const view = new WeaponsView();
    const core = (time: number): number => {
      view.update(w, s, s, 1, time);
      const m = matrix(view.beams, 1);
      return Math.hypot(m[0], m[1], m[2]);
    };
    arm(w, W_LANCE, 1);
    const beat = LANCE.wait * w.player.stats.haste;
    const atBurn = core(beat * 10 + 0.0001);
    const charging = core(beat * 10.9);
    expect(atBurn).toBeGreaterThan(charging * 1.3);
    // The same point on the beat a level higher: thicker.
    arm(w, W_LANCE, 5);
    expect(core(beat * 10.9)).toBeGreaterThan(charging * 1.4);
    // The sheath spans the beam's reach either side of its line.
    const band = matrix(view.beams, 0);
    expect(Math.hypot(band[0], band[1], band[2])).toBeCloseTo(LANCE.halfWidth * w.player.stats.area * 2, 5);
  });

  it('curls the Slipstream streaks in toward the line behind the board as they come forward', () => {
    const w = makeWorld(1);
    arm(w, W_SLIPSTREAM, 3);
    const s = state(0, 0, 0, 0);
    const view = new WeaponsView();
    view.update(w, s, s, 1, 0.2);
    let curled = 0;
    for (let line = 0; line < STREAK_LINES; line++) {
      const near = matrix(view.beams, line * STREAK_SEGS);
      const far = matrix(view.beams, line * STREAK_SEGS + STREAK_SEGS - 1);
      // Nearer the board (less far back) and nearer the centre line.
      expect(-near[14]).toBeLessThan(-far[14]);
      if (Math.abs(Math.atan2(near[12], -near[14])) < Math.abs(Math.atan2(far[12], -far[14]))) curled++;
    }
    expect(curled).toBe(STREAK_LINES);
  });
});

describe('ShotsView: following shots from tick to tick', () => {
  function dart(w: World, i: number, x: number, z: number, vx: number, vz: number, life = 60): void {
    const sh = w.shots;
    sh.x[i] = x;
    sh.y[i] = 1;
    sh.z[i] = z;
    sh.vx[i] = vx;
    sh.vy[i] = 0;
    sh.vz[i] = vz;
    sh.kind[i] = SHOT_DART;
    sh.life[i] = life;
    sh.aux[i] = 0;
  }

  it('draws a ribbon behind a dart along the way it really came, curve and all', () => {
    const w = makeWorld(1);
    const view = new ShotsView();
    w.shots.count = 1;
    const path: [number, number][] = [];
    for (let t = 0; t < 8; t++) {
      // Curving: its heading turns a little each tick.
      const a = t * 0.15;
      const x = 5 * Math.sin(a);
      const z = 5 * (1 - Math.cos(a)) + t * 0.2;
      path.push([x, z]);
      dart(w, 0, x, z, 30 * Math.cos(a), 30 * Math.sin(a), 60 - t);
      w.run.ticks = t;
      view.update(w, 1, t / 60);
    }
    expect(view.streaks.count).toBe(TRAIL_POINTS - 1);
    // Each ribbon segment ends on a point the dart was at, newest first.
    for (let k = 0; k < TRAIL_POINTS - 1; k++) {
      const m = matrix(view.streaks, k);
      const [px, pz] = path[path.length - 2 - k];
      const ex = m[12] + m[8] / 2;
      const ez = m[14] + m[10] / 2;
      expect(Math.hypot(ex - px, ez - pz)).toBeLessThan(1e-3);
    }
  });

  it('marks a strike with a star where a dart vanished early, and nothing where one ran out', () => {
    const w = makeWorld(1);
    const view = new ShotsView();
    w.shots.count = 2;
    dart(w, 0, 0, 0, 30, 0, 40);
    dart(w, 1, 0, 5, 30, 0, 1);
    w.run.ticks = 1;
    view.update(w, 1, 0);
    // Dart 0 struck something (it had time left); dart 1 ran out.
    w.shots.count = 0;
    w.run.ticks = 2;
    view.update(w, 1, 0.01);
    expect(view.liveImpacts).toBe(1);
    const m = matrix(view.streaks, 0);
    expect(Math.hypot(m[12], m[14])).toBeLessThan(0.5);
    // A frame's step is capped at 0.1 s: two frames see the star out.
    view.update(w, 1, 0.1);
    view.update(w, 1, 0.2);
    expect(view.liveImpacts).toBe(0);
    expect(view.mesh.visible).toBe(false);
  });

  it('keeps following a dart the pool moved to another slot', () => {
    const w = makeWorld(1);
    const view = new ShotsView();
    w.shots.count = 2;
    dart(w, 0, 0, 0, 30, 0, 40);
    dart(w, 1, 0, 9, 0, 30, 40);
    for (let t = 1; t <= 3; t++) {
      w.shots.x[0] += 0.5;
      w.shots.z[1] += 0.5;
      w.run.ticks = t;
      view.update(w, 1, t / 60);
    }
    // Dart 0 strikes; the pool moves dart 1 into slot 0.
    dart(w, 0, w.shots.x[1], w.shots.z[1] + 0.5, 0, 30, 36);
    w.shots.count = 1;
    w.run.ticks = 4;
    view.update(w, 1, 4 / 60);
    expect(view.liveImpacts).toBe(1);
    // Its ribbon still runs back along -z, where it came from, not toward where dart 0 was.
    const m = matrix(view.streaks, 0);
    expect(Math.abs(m[8])).toBeLessThan(1e-3);
    expect(m[10]).toBeLessThan(0);
  });

  it('skips a stone: up in an arc toward the enemy in its way, and a splash where it bounced', () => {
    const w = makeWorld(1);
    const view = new ShotsView();
    const sh = w.shots;
    sh.count = 1;
    sh.kind[0] = SHOT_STONE;
    sh.x[0] = 0;
    sh.y[0] = 0.6;
    sh.z[0] = 0;
    sh.vx[0] = 0;
    sh.vy[0] = 0;
    sh.vz[0] = 22;
    sh.life[0] = 80;
    sh.aux[0] = 3;
    // An enemy a little over 8 m ahead on its line.
    expect(spawnEnemy(w, KIND_SHUFFLER, 0, 0, 8.6)).toBe(0);
    w.run.ticks = 1;
    view.update(w, 1, 0);
    expect(matrix(view.mesh, 0)[13]).toBeCloseTo(0.6, 6);
    const y = (z: number): number => {
      sh.z[0] = z;
      w.run.ticks++;
      view.update(w, 1, w.run.ticks / 60);
      return matrix(view.mesh, 0)[13];
    };
    const quarter = y(2);
    const middle = y(4);
    const late = y(7.5);
    expect(middle).toBeGreaterThan(quarter);
    expect(middle).toBeGreaterThan(late);
    expect(middle - 0.6).toBeGreaterThan(0.5);
    expect(middle - 0.6).toBeLessThanOrEqual(ARC_MAX + 1e-6);
    // It hits and skips on: a skip used, off to the side, and a splash under the bounce.
    expect(view.liveSplashes).toBe(0);
    sh.aux[0] = 2;
    sh.x[0] = 1;
    sh.z[0] = 8.6;
    sh.vx[0] = 22;
    sh.vz[0] = 0;
    w.horde.hp[0] = 0;
    w.run.ticks++;
    view.update(w, 1, w.run.ticks / 60);
    expect(view.liveSplashes).toBe(1);
    // The new arc starts where it bounced.
    expect(matrix(view.mesh, 0)[13]).toBeCloseTo(0.6, 6);
    // With nothing ahead it hops on over open ground, splashing at each hop.
    for (let k = 1; k <= 3; k++) {
      sh.x[0] = 1 + k * (HOP_FREE / 2) + 0.01;
      w.run.ticks++;
      view.update(w, 1, w.run.ticks / 60);
    }
    expect(view.liveSplashes).toBeGreaterThanOrEqual(2);
  });
});
