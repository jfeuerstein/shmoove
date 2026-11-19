/** What a player would notice about the three bosses: when they come, how each one moves, and what each one's fall gives. */
import { describe, expect, it } from 'vitest';
import { W_SLAM } from '../../src/sim/arsenal';
import { BOSS_TIMES } from '../../src/sim/balance';
import { BOSS, BOSS_KINDS, BRUISER_CHARGE, BRUISER_REST, BRUISER_TELL, BRUISER_WALK, findBoss, stepBosses } from '../../src/sim/bosses';
import { setWeaponLevel } from '../../src/sim/build';
import { DT, TICK_HZ } from '../../src/sim/constants';
import { hurtPlayer } from '../../src/sim/contact';
import { DIRECTOR, stepDirector } from '../../src/sim/director';
import { stepHazards } from '../../src/sim/hazards';
import { stepHorde } from '../../src/sim/horde';
import { OFFER_TOTEM } from '../../src/sim/offer';
import { makeSimState, Sim } from '../../src/sim/sim';
import { flatTerrain, railOver, terrainFromHeight, type Rail } from '../../src/sim/terrain';
import { type InputFrame } from '../../src/sim/types';
import {
  addZone,
  damageEnemy,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_HEAL,
  FX_PLAYER_HIT,
  KIND_BRUISER,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_STANDSTILL,
  KINDS,
  MARK_ELITE,
  PHASE_PLAY,
  PHASE_WON,
  rebuildGrid,
  reapHorde,
  shoveEnemy,
  SPAWN_TICKS,
  spawnEnemy,
  ZONE_LOB,
  ZONE_RING,
  type World,
} from '../../src/sim/world';
import { arena, place } from './world-fixtures';
import { launch, steer, TUCK } from './fixtures';

const HOP: InputFrame = { steerX: 0, steerY: 0, carve: false, hop: true };
const sec = (s: number): number => Math.round(s * TICK_HZ);

/** Set the run clock to `seconds`, as the test hook does. */
function setClock(sim: Sim, seconds: number): void {
  sim.world.run.ticks = sec(seconds);
}

/** Step once, returning how many effects of `type` the step made. */
function stepCount(sim: Sim, input: InputFrame, type: number): number {
  sim.step(input);
  const f = sim.world.fx;
  let n = 0;
  for (let i = 0; i < f.count; i++) if (f.type[i] === type) n++;
  return n;
}

/** Step `ticks` times, counting effects of `type`. */
function runCount(sim: Sim, input: InputFrame, ticks: number, type: number, each?: () => void): number {
  let n = 0;
  for (let t = 0; t < ticks; t++) {
    if (each) each();
    n += stepCount(sim, input, type);
  }
  return n;
}

/** The boss, or fail. */
function boss(w: World): number {
  const i = findBoss(w);
  if (i < 0) throw new Error('no boss on the field');
  return i;
}

/** Put a risen boss of `kind` at (x, z) with its phase timer at `timer`. */
function placeBoss(sim: Sim, kind: number, x: number, z: number, timer = 0): number {
  const i = place(sim, kind, x, z);
  sim.world.horde.timer[i] = timer;
  return i;
}

/** Hold the mover where it is, still, on the ground (a thumb that never moves it). */
function hold(sim: Sim, x: number, z: number): void {
  const m = sim.state.mover;
  m.x = x;
  m.z = z;
  m.y = sim.terrain.heightAt(x, z);
  m.vx = 0;
  m.vy = 0;
  m.vz = 0;
  m.speed = 0;
}

/** Keep the player alive and able to be hurt again at once, so every hit can be seen. */
function fresh(w: World): void {
  w.player.hp = w.player.maxHp;
  w.player.invuln = 0;
}

describe('when the bosses come', () => {
  for (let k = 0; k < BOSS_TIMES.length; k++) {
    const kind = BOSS_KINDS[k];
    it(`${KINDS[kind].name} comes at ${BOSS_TIMES[k]} s, once, 45 m ahead of the mover, on the ground`, () => {
      const sim = arena();
      const w = sim.world;
      setClock(sim, BOSS_TIMES[k] - 1);
      // A second before: nothing.
      expect(runCount(sim, TUCK, sec(1), FX_BOSS_IN)).toBe(0);
      expect(w.boss.kind).toBe(-1);
      expect(findBoss(w)).toBe(-1);
      // On the tick its time comes.
      expect(stepCount(sim, TUCK, FX_BOSS_IN)).toBe(1);
      expect(w.run.ticks).toBe(sec(BOSS_TIMES[k]) + 1);
      const i = boss(w);
      expect(w.horde.kind[i]).toBe(kind);
      expect(w.boss.kind).toBe(kind);
      const m = sim.state.mover;
      // Standing still, ahead is where the view looks (+z at the spawn).
      expect(w.horde.x[i] - m.x).toBeCloseTo(0, 4);
      expect(w.horde.z[i] - m.z).toBeCloseTo(BOSS.ahead, 4);
      expect(w.horde.y[i]).toBe(sim.terrain.heightAt(w.horde.x[i], w.horde.z[i]));
      // Once: still the one boss after a while, and no other comes.
      expect(runCount(sim, TUCK, sec(10), FX_BOSS_IN, () => fresh(w))).toBe(0);
      let bosses = 0;
      for (let j = 0; j < w.horde.count; j++) if (KINDS[w.horde.kind[j]].boss === true) bosses++;
      expect(bosses).toBe(1);
      // Brought down, it does not come back.
      damageEnemy(w, boss(w), 1e6);
      expect(runCount(sim, TUCK, sec(20), FX_BOSS_IN, () => fresh(w))).toBe(0);
    });
  }

  it('comes ahead along the way the mover is going', () => {
    const sim = arena();
    const w = sim.world;
    const m = sim.state.mover;
    m.heading = Math.PI / 2;
    setClock(sim, BOSS_TIMES[0] - 0.5);
    let seen = 0;
    for (let t = 0; t < sec(1) && seen === 0; t++) {
      launch(sim, 10);
      seen = stepCount(sim, TUCK, FX_BOSS_IN);
    }
    expect(seen).toBe(1);
    const i = boss(w);
    expect(w.horde.x[i] - m.x).toBeCloseTo(BOSS.ahead, 1);
    expect(Math.abs(w.horde.z[i] - m.z)).toBeLessThan(0.5);
  });

  it('comes up where the view looks when the mover is all but still', () => {
    const sim = arena();
    const w = sim.world;
    setClock(sim, BOSS_TIMES[0]);
    sim.state.viewYaw = -Math.PI / 2;
    sim.state.mover.heading = 0.4;
    sim.step(TUCK);
    const i = boss(w);
    const m = sim.state.mover;
    expect(w.horde.x[i] - m.x).toBeCloseTo(-BOSS.ahead, 1);
    expect(Math.abs(w.horde.z[i] - m.z)).toBeLessThan(0.5);
  });

  it('comes inside the map when ahead is off it', () => {
    const terrain = flatTerrain(100);
    const sim = new Sim(terrain, { seed: 3, horde: true, autoPick: true });
    sim.world.spawning = false;
    // Near the edge, facing out.
    hold(sim, 0, 70);
    setClock(sim, BOSS_TIMES[0]);
    sim.step(TUCK);
    const i = boss(sim.world);
    const r = Math.hypot(sim.world.horde.x[i], sim.world.horde.z[i]);
    expect(r).toBeLessThanOrEqual(DIRECTOR.region * terrain.radius - KINDS[KIND_BRUISER].radius + 1e-6);
    const d = Math.hypot(sim.world.horde.x[i] - sim.state.mover.x, sim.world.horde.z[i] - sim.state.mover.z);
    expect(d).toBeCloseTo(BOSS.ahead, 1);
  });

  it('a boss still up holds back the next one until it falls', () => {
    const sim = arena();
    const w = sim.world;
    setClock(sim, BOSS_TIMES[0]);
    sim.step(TUCK);
    expect(w.boss.kind).toBe(KIND_BRUISER);
    setClock(sim, BOSS_TIMES[1]);
    expect(runCount(sim, TUCK, sec(5), FX_BOSS_IN, () => fresh(w))).toBe(0);
    expect(w.boss.kind).toBe(KIND_BRUISER);
    damageEnemy(w, boss(w), 1e6);
    // The Mortar was due: it comes on the tick the Bruiser falls.
    sim.step(TUCK);
    const types: number[] = [];
    for (let k = 0; k < w.fx.count; k++) types.push(w.fx.type[k]);
    expect(types).toContain(FX_BOSS_DOWN);
    expect(types).toContain(FX_BOSS_IN);
    expect(w.boss.kind).toBe(KIND_MORTAR);
  });

  it('w.boss tells the truth every tick, and kind is -1 when there is none', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    setClock(sim, BOSS_TIMES[0] - 0.5);
    let seenUp = 0;
    for (let t = 0; t < sec(30); t++) {
      fresh(w);
      const i0 = findBoss(w);
      if (i0 >= 0 && t % 7 === 0) damageEnemy(w, i0, 1);
      sim.step(TUCK);
      const i = findBoss(w);
      if (i < 0) {
        expect(w.boss.kind).toBe(-1);
        continue;
      }
      seenUp++;
      expect(w.boss.kind).toBe(h.kind[i]);
      expect(w.boss.hp).toBe(h.hp[i]);
      expect(w.boss.maxHp).toBe(KINDS[h.kind[i]].hp);
      expect(w.boss.x).toBe(h.x[i]);
      expect(w.boss.z).toBe(h.z[i]);
      if (t === sec(20)) damageEnemy(w, i, 1e6);
    }
    expect(seenUp).toBeGreaterThan(sec(19));
    expect(w.boss.kind).toBe(-1);
    expect(w.boss.felled).toBe(1);
  });

  it('a clock set past a boss skips it; the next one still comes at its time', () => {
    const sim = arena();
    setClock(sim, BOSS_TIMES[1] - 2);
    expect(runCount(sim, TUCK, sec(2) + 1, FX_BOSS_IN)).toBe(1);
    expect(sim.world.boss.kind).toBe(KIND_MORTAR);
  });
});

describe('the Bruiser', () => {
  const B = BOSS.bruiser;

  it('walks at you, stops and faces where it will go (the tell), charges, rests, and walks again', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    const i = placeBoss(sim, KIND_BRUISER, 0, 40);
    const phases: number[] = [];
    const speeds: number[] = [];
    for (let t = 0; t < sec(4 + 0.8 + 2.5 + 1 + 1); t++) {
      hold(sim, 0, 0);
      fresh(w);
      sim.step(TUCK);
      phases.push(h.state[i]);
      speeds.push(Math.hypot(h.vx[i], h.vz[i]));
    }
    // Walking for 4 s, at 3 m/s, straight at the mover.
    const walk = phases.indexOf(BRUISER_TELL);
    expect(walk).toBe(sec(B.every) - 1);
    for (let t = 0; t < walk; t++) {
      expect(phases[t]).toBe(BRUISER_WALK);
      expect(speeds[t]).toBeCloseTo(B.walk, 5);
    }
    // The tell: 0.8 s standing all but still, leaning toward the mover.
    const charge = phases.indexOf(BRUISER_CHARGE);
    expect(charge - walk).toBe(sec(B.tell));
    for (let t = walk; t < charge; t++) expect(speeds[t]).toBeLessThanOrEqual(B.lean + 1e-6);
    // The charge: 16 m/s, then the rest at 0, then walking again.
    const rest = phases.indexOf(BRUISER_REST);
    for (let t = charge; t < rest; t++) expect(speeds[t]).toBeCloseTo(B.charge, 4);
    expect(rest - charge).toBeLessThanOrEqual(sec(B.chargeFor));
    const again = phases.indexOf(BRUISER_WALK, rest);
    expect(again - rest).toBe(sec(B.rest));
    for (let t = rest; t < again; t++) expect(speeds[t]).toBe(0);
  });

  it('charges in a straight line, at most 40 m and 2.5 s, without steering after the mover', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    const i = placeBoss(sim, KIND_BRUISER, 0, 60, sec(B.every) - 1);
    hold(sim, 0, 0);
    sim.step(TUCK);
    expect(h.state[i]).toBe(BRUISER_TELL);
    // The mover moves off to the side as soon as the tell begins: the aim does not follow.
    const aimX = h.vx[i];
    const aimZ = h.vz[i];
    let start: [number, number] | null = null;
    let ticks = 0;
    for (let t = 0; t < sec(5); t++) {
      hold(sim, 30 + t * 0.2, 10);
      fresh(w);
      sim.step(TUCK);
      if (h.state[i] === BRUISER_CHARGE) {
        if (start === null) start = [h.x[i], h.z[i]];
        ticks++;
        const v = Math.hypot(h.vx[i], h.vz[i]);
        // Same direction as the tell's lean, every tick.
        expect((h.vx[i] * aimX + h.vz[i] * aimZ) / (v * Math.hypot(aimX, aimZ))).toBeCloseTo(1, 6);
      }
      if (h.state[i] === BRUISER_REST) break;
    }
    expect(start).not.toBeNull();
    if (start === null) return;
    const went = Math.hypot(h.x[i] - start[0], h.z[i] - start[1]);
    expect(went).toBeLessThanOrEqual(B.chargeFar + B.charge * DT);
    expect(went).toBeGreaterThan(B.chargeFar - 2 * B.charge * DT);
    expect(ticks).toBeLessThanOrEqual(sec(B.chargeFor));
  });

  /** A mover riding along +z at 10 m/s past a Bruiser whose tell begins now. Returns the hits taken. */
  function ridePast(turn: boolean): number {
    const sim = arena();
    const w = sim.world;
    placeBoss(sim, KIND_BRUISER, 30, 20, sec(B.every) - 1);
    let hits = 0;
    launch(sim, 10);
    for (let t = 0; t < sec(4); t++) {
      w.player.hp = w.player.maxHp;
      if (turn) {
        // Hard left, away from it, for as long as it tells; then straight on.
        sim.step(t < sec(B.tell) ? steer(-1, 0) : TUCK);
      } else {
        // Keeps its line and its speed.
        launch(sim, 10);
        sim.step(TUCK);
      }
      const f = w.fx;
      for (let k = 0; k < f.count; k++) if (f.type[k] === FX_PLAYER_HIT) hits++;
    }
    return hits;
  }

  it('hits a mover that keeps its line', () => {
    expect(ridePast(false)).toBeGreaterThanOrEqual(1);
  });

  it('misses a mover that turns during the tell', () => {
    expect(ridePast(true)).toBe(0);
  });
});

describe('the Mortar', () => {
  const M = BOSS.mortar;

  it('keeps 20 to 30 m from the mover, at 2 m/s', () => {
    for (const start of [8, 50]) {
      const sim = arena();
      const w = sim.world;
      const h = w.horde;
      // Not yet due to fire: this is about where it stands.
      const i = placeBoss(sim, KIND_MORTAR, 0, start, 1);
      for (let t = 0; t < sec(20); t++) {
        hold(sim, 0, 0);
        fresh(w);
        sim.step(TUCK);
        const v = Math.hypot(h.vx[i], h.vz[i]);
        expect(v === 0 || Math.abs(v - M.speed) < 1e-6).toBe(true);
      }
      const d = Math.hypot(h.x[i], h.z[i]);
      expect(d).toBeGreaterThanOrEqual(M.near - 0.1);
      expect(d).toBeLessThanOrEqual(M.far + 0.1);
      // In the band it stands.
      expect(Math.hypot(h.vx[i], h.vz[i])).toBe(0);
    }
  });

  /** A Mortar about to fire at a mover riding +z at 10 m/s. Returns the rings laid and the hits taken. */
  function lineUp(change: boolean): { rings: { x: number; z: number; life: number }[]; mover: { x: number; z: number }; hits: number } {
    // `mover` is where the mover would be when they land, keeping its line.
    const sim = arena();
    const w = sim.world;
    placeBoss(sim, KIND_MORTAR, 25, 10, sec(M.volleyEvery) - 1);
    launch(sim, 10);
    sim.step(TUCK);
    const m = sim.state.mover;
    const rings: { x: number; z: number; life: number }[] = [];
    for (let k = 0; k < w.zones.count; k++) if (w.zones.kind[k] === ZONE_LOB) rings.push({ x: w.zones.x[k], z: w.zones.z[k], life: w.zones.life[k] });
    const mover = { x: m.x + m.vx * M.ringFlight, z: m.z + m.vz * M.ringFlight };
    let hits = 0;
    for (let t = 0; t < sec(M.ringFlight) + 5; t++) {
      fresh(w);
      if (change) sim.step(steer(1, 0.2));
      else {
        launch(sim, 10);
        sim.step(TUCK);
      }
      const f = w.fx;
      for (let k = 0; k < f.count; k++) if (f.type[k] === FX_PLAYER_HIT) hits++;
    }
    return { rings, mover, hits };
  }

  it('lays five rings in a line across where the mover will be when they land, 4 m apart', () => {
    const { rings, mover } = lineUp(false);
    expect(rings.length).toBe(M.rings);
    rings.sort((a, b) => a.x - b.x);
    for (let k = 0; k < rings.length; k++) {
      // Across the way it rides (+z): a line along x, all at the same z.
      expect(rings[k].z).toBeCloseTo(mover.z, 4);
      expect(rings[k].x - mover.x).toBeCloseTo((k - 2) * M.ringGap, 4);
      expect(rings[k].life).toBe(sec(M.ringFlight));
    }
  });

  it('hits a mover that keeps its line, and misses one that changes it', () => {
    expect(lineUp(false).hits).toBe(1);
    expect(lineUp(true).hits).toBe(0);
  });

  it('calls a cloud of gnats every 12 s, close in front of it', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    const i = placeBoss(sim, KIND_MORTAR, 0, 25, 1);
    const clouds: number[] = [];
    let before = 0;
    for (let t = 0; t < sec(25); t++) {
      hold(sim, 0, 0);
      fresh(w);
      sim.step(TUCK);
      let gnats = 0;
      for (let j = 0; j < h.count; j++) {
        if (h.kind[j] !== KIND_GNAT) continue;
        gnats++;
        if (h.age[j] === 0) expect(Math.hypot(h.x[j] - h.x[i], h.z[j] - h.z[i])).toBeLessThan(KINDS[KIND_MORTAR].radius + M.gnatsAhead + M.gnatsRadius + 0.01);
      }
      if (gnats > before) {
        expect(gnats - before).toBe(M.gnats);
        clouds.push(t);
      }
      before = gnats;
    }
    expect(clouds.length).toBe(2);
    expect(clouds[1] - clouds[0]).toBe(sec(M.gnatsEvery));
  });
});

describe('the Standstill', () => {
  const S = BOSS.standstill;

  it('slows a grounded mover near it, and not one in the air or far off', () => {
    const near = arena();
    placeBoss(near, KIND_STANDSTILL, 0, 8, 1);
    const far = arena();
    placeBoss(far, KIND_STANDSTILL, 0, 60, 1);
    for (const sim of [near, far]) {
      launch(sim, 10);
      sim.state.mover.heading = Math.PI / 2;
      launch(sim, 10);
    }
    for (let t = 0; t < sec(1); t++) {
      for (const sim of [near, far]) {
        fresh(sim.world);
        sim.step(TUCK);
      }
      expect(near.world.player.cling).toBeCloseTo(S.auraDrag, 6);
      expect(far.world.player.cling).toBe(0);
    }
    // A second of coasting near it costs clearly more speed than far from it.
    expect(near.state.mover.speed).toBeLessThan(far.state.mover.speed - 0.4);

    // In the air, inside the aura, nothing.
    const air = arena();
    placeBoss(air, KIND_STANDSTILL, 6, 0, 1);
    air.step(HOP);
    let airborne = 0;
    for (let t = 0; t < 20; t++) {
      fresh(air.world);
      air.step(TUCK);
      if (!air.state.mover.grounded) {
        airborne++;
        expect(air.world.player.cling).toBe(0);
      }
    }
    expect(airborne).toBeGreaterThan(10);
  });

  it('sends a ring out every 3.5 s that hurts a mover on the ground as the front crosses it', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    const i = placeBoss(sim, KIND_STANDSTILL, 0, 20, 1);
    const ringsAt: number[] = [];
    const hitsAt: number[] = [];
    let before = 0;
    for (let t = 0; t < sec(10); t++) {
      hold(sim, 0, 0);
      fresh(w);
      // It stands where it is for this test: only the rings matter.
      h.x[i] = 0;
      h.z[i] = 20;
      const hit = stepCount(sim, TUCK, FX_PLAYER_HIT);
      let rings = 0;
      for (let k = 0; k < w.zones.count; k++) if (w.zones.kind[k] === ZONE_RING) rings++;
      if (rings > before) ringsAt.push(t);
      before = rings;
      if (hit > 0) {
        hitsAt.push(t);
        expect(w.fx.a[0]).toBeGreaterThan(0);
      }
    }
    expect(ringsAt.length).toBe(2);
    expect(ringsAt[1] - ringsAt[0]).toBe(sec(S.ringEvery));
    // One hit per ring, on the tick its front reaches 20 m (the mover is 20 m off, standing).
    expect(hitsAt.length).toBe(2);
    for (let k = 0; k < 2; k++) {
      const reach = Math.ceil(20 / (S.ringSpeed * DT)) - 1;
      expect(hitsAt[k] - ringsAt[k]).toBe(reach);
    }
  });

  it('an ollie timed over the front clears it', () => {
    const sim = arena();
    const w = sim.world;
    // A ring from 20 m off: the front reaches the mover in about 2.2 s.
    addZone(w, ZONE_RING, 0, 0, 20, 0, 300, S.ringDamage);
    const cross = 20 / S.ringSpeed;
    let hits = 0;
    let airAtCross = false;
    for (let t = 0; t < sec(3.5); t++) {
      fresh(w);
      const hop = t === sec(cross - 0.2);
      hits += stepCount(sim, hop ? HOP : TUCK, FX_PLAYER_HIT);
      if (Math.abs(t - sec(cross)) <= 1 && !sim.state.mover.grounded) airAtCross = true;
    }
    expect(airAtCross).toBe(true);
    expect(hits).toBe(0);
  });

  it('a mover grinding a rail is passed under', () => {
    const lift = 1.2;
    const flat = (): number => 0;
    const rails: Rail[] = [railOver(flat, 0, 10, 0, 60, lift)];
    const terrain = terrainFromHeight(flat, 2000, [], 0, 0, 0, rails);
    const sim = new Sim(terrain, { seed: 5, horde: true, autoPick: true });
    sim.world.spawning = false;
    sim.state.mover.x = 0.5;
    // Ride at 12 m/s and hop to come down on the rail.
    for (let t = 0; t < 2000 && sim.state.mover.z < 16 - 6; t++) {
      launch(sim, 12);
      sim.step(TUCK);
    }
    launch(sim, 12);
    sim.step(HOP);
    for (let t = 0; t < 60 && sim.state.mover.rail < 0; t++) sim.step(TUCK);
    expect(sim.state.mover.rail).toBe(0);
    const m = sim.state.mover;
    // A ring 30 m ahead: the rider closes at 12 m/s and the front at 9, so they meet on the rail.
    addZone(sim.world, ZONE_RING, m.x, 0, m.z + 30, 0, 600, S.ringDamage);
    let hits = 0;
    let crossedOnRail = false;
    for (let t = 0; t < sec(2); t++) {
      fresh(sim.world);
      const k = 0;
      const before = Math.hypot(m.x - sim.world.zones.x[k], m.z - sim.world.zones.z[k]) - sim.world.zones.r[k];
      hits += stepCount(sim, TUCK, FX_PLAYER_HIT);
      if (sim.world.zones.count === 0) break;
      const after = Math.hypot(m.x - sim.world.zones.x[k], m.z - sim.world.zones.z[k]) - sim.world.zones.r[k];
      if (before > 0 && after <= 0 && m.rail >= 0) crossedOnRail = true;
    }
    expect(crossedOnRail).toBe(true);
    expect(hits).toBe(0);
  });

  it('calls an elite every 15 s', () => {
    const sim = arena();
    const w = sim.world;
    const h = w.horde;
    placeBoss(sim, KIND_STANDSTILL, 0, 40, 1);
    const at: number[] = [];
    for (let t = 0; t < sec(31); t++) {
      hold(sim, 0, 0);
      fresh(w);
      sim.step(TUCK);
      for (let j = 0; j < h.count; j++) {
        if (h.age[j] !== 0) continue;
        expect([KIND_SHUFFLER, KIND_CUTTER]).toContain(h.kind[j]);
        expect(h.mark[j] & MARK_ELITE).not.toBe(0);
        expect(h.elite[j]).toBeGreaterThan(0);
        at.push(t);
      }
    }
    expect(at.length).toBe(2);
    expect(at[1] - at[0]).toBe(sec(S.eliteEvery));
  });
});

describe('every boss', () => {
  it('is never thrown: not by a hit on the player, not by the Slam, not by a shove', () => {
    for (const kind of BOSS_KINDS) {
      const sim = arena();
      const w = sim.world;
      const h = w.horde;
      setWeaponLevel(w, W_SLAM, 5);
      const i = placeBoss(sim, kind, 0, KINDS[kind].radius + 1.5, 1);
      for (let t = 0; t < sec(5); t++) {
        hold(sim, 0, 0);
        w.player.hp = w.player.maxHp;
        if (t % 30 === 0) hurtPlayer(w, sim.state, 5);
        if (t % 45 === 0) shoveEnemy(w, i, 0, 1, 30, 60);
        sim.step(TUCK);
        expect(h.stun[i]).toBe(0);
        // It never moves faster than it moves by itself.
        expect(Math.hypot(h.vx[i], h.vz[i])).toBeLessThanOrEqual(BOSS.bruiser.charge + 1e-6);
      }
      expect(findBoss(w)).toBe(i);
    }
  });

  it('is never taken away, however far it is left behind', () => {
    const terrain = flatTerrain(2000);
    const sim = new Sim(terrain, { seed: 2, horde: true, autoPick: true });
    const w = sim.world;
    setClock(sim, 100);
    placeBoss(sim, KIND_MORTAR, 0, -200, 1);
    for (let t = 0; t < sec(5); t++) {
      launch(sim, 20);
      fresh(w);
      sim.step(TUCK);
    }
    expect(findBoss(w)).toBeGreaterThanOrEqual(0);
    expect(w.boss.kind).toBe(KIND_MORTAR);
  });

  it('cannot be hopped over: in the air above its head, touching still hurts', () => {
    for (const kind of BOSS_KINDS) {
      const sim = arena();
      placeBoss(sim, kind, 0, 6, 1);
      launch(sim, 12);
      sim.step(HOP);
      let hitInAir = false;
      for (let t = 0; t < sec(1); t++) {
        const m = sim.state.mover;
        // Hold it high in the air over the boss: higher than anything else could be cleared from.
        if (!m.grounded) m.y = Math.max(m.y, KINDS[kind].height + 1);
        if (stepCount(sim, TUCK, FX_PLAYER_HIT) > 0 && !sim.state.mover.grounded) hitInAir = true;
      }
      expect(hitInAir, KINDS[kind].name).toBe(true);
    }
  });

  it('gives back a share of maximum health (BOSS.heal), its sparks and a rare card when it falls', () => {
    for (const kind of [KIND_BRUISER, KIND_MORTAR]) {
      const sim = arena();
      const w = sim.world;
      const sources: number[] = [];
      sim.picker = (wd) => {
        sources.push(wd.offer.source);
        return 0;
      };
      const i = placeBoss(sim, kind, 0, 40, 1);
      sim.step(TUCK);
      w.player.hp = 30;
      const x = w.horde.x[i];
      const z = w.horde.z[i];
      const value = (): number => {
        let v = 0;
        for (let k = 0; k < w.sparks.count; k++) if (Math.hypot(w.sparks.x[k] - x, w.sparks.z[k] - z) < 3) v += w.sparks.value[k];
        return v;
      };
      const before = value();
      damageEnemy(w, i, 1e6);
      sim.step(TUCK);
      const f = w.fx;
      const types: number[] = [];
      for (let k = 0; k < f.count; k++) types.push(f.type[k]);
      expect(types).toContain(FX_BOSS_DOWN);
      expect(types).toContain(FX_HEAL);
      expect(w.player.hp).toBeCloseTo(30 + BOSS.heal * w.player.maxHp, 4);
      expect(value() - before).toBeCloseTo(30, 4);
      expect(sources).toContain(OFFER_TOTEM);
      expect(w.boss.felled).toBe(1);
      expect(w.run.phase).toBe(PHASE_PLAY);
    }
  });

  it('the heal never goes past full health', () => {
    const sim = arena();
    const w = sim.world;
    const i = placeBoss(sim, KIND_BRUISER, 0, 40, 1);
    w.player.hp = w.player.maxHp - 10;
    damageEnemy(w, i, 1e6);
    sim.step(TUCK);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it("the Standstill's fall wins the run", () => {
    const sim = arena();
    const w = sim.world;
    const i = placeBoss(sim, KIND_STANDSTILL, 0, 40, 1);
    w.player.hp = 50;
    damageEnemy(w, i, 1e6);
    sim.step(TUCK);
    expect(w.run.phase).toBe(PHASE_WON);
    expect(w.boss.felled).toBe(1);
    expect(w.player.hp).toBeCloseTo(50 + BOSS.heal * w.player.maxHp, 4);
    // The rare card is owed but the run is over: it waits, unopened.
    expect(w.offerQueued).toBe(1);
    expect(w.offer.open).toBe(false);
    // And the world holds still.
    const z = sim.state.mover.z;
    sim.step(TUCK);
    expect(sim.state.mover.z).toBe(z);
  });
});

describe('cost', () => {
  it('horde, director, hazards and bosses together with 400 enemies and a boss stay well under the budget', () => {
    const terrain = flatTerrain(400);
    const sim = new Sim(terrain, { seed: 4, horde: true });
    const w = sim.world;
    const s = makeSimState(terrain);
    w.run.ticks = sec(BOSS_TIMES[2]);
    const one = (): void => {
      // A lap round the middle at 8 m/s.
      const t = w.run.ticks * DT;
      const om = 8 / 60;
      s.mover.x = Math.cos(om * t) * 60;
      s.mover.z = Math.sin(om * t) * 60;
      s.mover.vx = -Math.sin(om * t) * 8;
      s.mover.vz = Math.cos(om * t) * 8;
      s.mover.grounded = true;
      w.fx.count = 0;
      w.deaths.count = 0;
      stepDirector(w, s, terrain);
      stepHorde(w, s, terrain);
      rebuildGrid(w);
      stepHazards(w, s, terrain);
      reapHorde(w);
      stepBosses(w, s, terrain);
      w.run.ticks++;
    };
    one();
    expect(w.boss.kind).toBe(KIND_STANDSTILL);
    const kinds = [KIND_SHUFFLER, KIND_SHUFFLER, KIND_GNAT, KIND_CUTTER];
    for (let k = 0; w.horde.count < 400; k++) {
      const a = k * 2.399963;
      const r = 12 + (k % 55);
      const x = s.mover.x + Math.sin(a) * r;
      const z = s.mover.z + Math.cos(a) * r;
      const i = spawnEnemy(w, kinds[k % kinds.length], x, 0, z);
      w.horde.age[i] = SPAWN_TICKS;
    }
    for (let t = 0; t < 300; t++) one();
    expect(w.horde.count).toBeGreaterThanOrEqual(380);
    expect(w.boss.kind).toBe(KIND_STANDSTILL);
    const ticks = 1200;
    const t0 = performance.now();
    for (let t = 0; t < ticks; t++) one();
    const avg = (performance.now() - t0) / ticks;
    console.log(`[horde+director+hazards+bosses] ${w.horde.count} enemies and the Standstill: ${avg.toFixed(3)} ms/tick`);
    expect(avg).toBeLessThan(4);
  });
});
