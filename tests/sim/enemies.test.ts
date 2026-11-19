/** What a player would notice about the four newer enemies and the elites. */
import { describe, expect, it } from 'vitest';
import { W_WAKE } from '../../src/sim/arsenal';
import { setWeaponLevel } from '../../src/sim/build';
import { PLAYER_RADIUS } from '../../src/sim/balance';
import { DT, FEEL } from '../../src/sim/constants';
import { DIRECTOR, makeElite } from '../../src/sim/director';
import { HAZARDS } from '../../src/sim/hazards';
import { HORDE } from '../../src/sim/horde';
import type { Sim } from '../../src/sim/sim';
import { EV_CLEAN_HOP, EV_LAND, type InputFrame } from '../../src/sim/types';
import {
  addZone,
  damageEnemy,
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_SHIELD,
  FX_PLAYER_HIT,
  hashWorld,
  KIND_BOLLARD,
  KIND_CLINGER,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KINDS,
  MARK_PACK,
  MARK_SHIELDED,
  MAX_LATCHED,
  STATE_LATCHED,
  ZONE_LOB,
  ZONE_TAR,
} from '../../src/sim/world';
import { HOP, launch, run, slopeTerrain, steer, TUCK } from './fixtures';
import { arena, FX_POP, place, root, stepCounting } from './world-fixtures';

const STRAIGHT = steer(0, 1);

function dist(sim: Sim, i: number): number {
  const h = sim.world.horde;
  const m = sim.state.mover;
  return Math.hypot(h.x[i] - m.x, h.z[i] - m.z);
}

/** Up to running speed on a straight line, without the Wake (its trail would burn what follows). */
function running(): Sim {
  const sim = arena();
  setWeaponLevel(sim.world, W_WAKE, 0);
  run(sim, STRAIGHT, 120);
  return sim;
}

/** A point `ahead` m along the mover's heading and `side` m to its right. */
function offset(sim: Sim, ahead: number, side: number): [number, number] {
  const m = sim.state.mover;
  const fx = Math.sin(m.heading);
  const fz = Math.cos(m.heading);
  return [m.x + fx * ahead + fz * side, m.z + fz * ahead - fx * side];
}

function zonesOf(sim: Sim, kind: number): number[] {
  const zn = sim.world.zones;
  const out: number[] = [];
  for (let i = 0; i < zn.count; i++) if (zn.kind[i] === kind) out.push(i);
  return out;
}

function latchedCount(sim: Sim): number {
  const h = sim.world.horde;
  let n = 0;
  for (let i = 0; i < h.count; i++) if (h.state[i] === STATE_LATCHED) n++;
  return n;
}

describe('cutter', () => {
  /**
   * Ride a straight line (or turn hard toward the cutter for `turnTicks` once it is within
   * `turnAt` m, then straight again) and say on which tick the cutter first touched, or -1.
   * Also returns the mover's path, for comparing with a chaser.
   */
  function chase(turnAt: number, turnTicks: number, ticks: number): { touched: number; path: number[]; start: [number, number] } {
    const sim = running();
    const start = offset(sim, 25, 20);
    const i = place(sim, KIND_CUTTER, start[0], start[1]);
    const touch = KINDS[KIND_CUTTER].radius + PLAYER_RADIUS;
    const path: number[] = [];
    let turning = -1;
    for (let t = 0; t < ticks; t++) {
      // Nothing hurts the mover here (and so nothing throws the cutter back): this is about arriving.
      sim.world.player.invuln = 100;
      if (turning < 0 && turnAt > 0 && dist(sim, i) < turnAt) turning = t;
      const turn = turning >= 0 && t - turning < turnTicks;
      sim.step(turn ? steer(1, 0) : STRAIGHT);
      path.push(sim.state.mover.x, sim.state.mover.z);
      if (dist(sim, i) < touch) return { touched: t, path, start };
    }
    return { touched: -1, path, start };
  }

  /** A same-speed chaser that runs at where the mover is: on which tick does it touch, or -1. */
  function chaser(path: number[], start: [number, number]): number {
    const { speed, accel } = KINDS[KIND_CUTTER];
    const touch = KINDS[KIND_CUTTER].radius + PLAYER_RADIUS;
    let [x, z] = start;
    let vx = 0;
    let vz = 0;
    for (let t = 0; t < path.length / 2; t++) {
      const mx = path[t * 2];
      const mz = path[t * 2 + 1];
      const dx = mx - x;
      const dz = mz - z;
      const d = Math.hypot(dx, dz);
      const wx = (dx / d) * speed - vx;
      const wz = (dz / d) * speed - vz;
      const wl = Math.hypot(wx, wz);
      const k = Math.min(1, (accel * DT) / wl);
      vx += wx * k;
      vz += wz * k;
      x += vx * DT;
      z += vz * DT;
      if (Math.hypot(mx - x, mz - z) < touch) return t;
    }
    return -1;
  }

  it('cuts off a straight line, well before a same-speed chaser running at the mover would', () => {
    const straight = chase(0, 0, 900);
    expect(straight.touched).toBeGreaterThan(0);
    const chased = chaserOver(straight.start, 900);
    expect(chased === -1 || chased > straight.touched * 1.5).toBe(true);
  });

  /** The chaser against the full straight path (the cutter's run stops at its touch). */
  function chaserOver(start: [number, number], ticks: number): number {
    const sim = running();
    const path: number[] = [];
    for (let t = 0; t < ticks; t++) {
      sim.step(STRAIGHT);
      path.push(sim.state.mover.x, sim.state.mover.z);
    }
    return chaser(path, start);
  }

  it('is beaten by a turn: a hard turn toward it as it closes and it does not get there for seconds', () => {
    const straight = chase(0, 0, 900);
    // Eight seconds: by then the straight line was cut off several times over.
    const turned = chase(10, 45, 480);
    expect(straight.touched).toBeGreaterThan(0);
    expect(straight.touched).toBeLessThan(240);
    expect(turned.touched).toBe(-1);
  });

  it('is fast and medium: plowed from gear 4, 20 health, 6 damage, 3 XP', () => {
    const k = KINDS[KIND_CUTTER];
    expect(k.speed).toBe(10.5);
    expect(k.hp).toBe(20);
    expect(k.damage).toBe(6);
    expect(k.xp).toBe(3);
    // Below gear 4 it hurts.
    const sim = arena();
    place(sim, KIND_CUTTER, 0, 0.6);
    root(sim.world);
    sim.world.horde.stun[0] = 0;
    sim.step(TUCK);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp - k.damage);
  });
});

describe('lobber', () => {
  it('holds its distance: in from far, out from near, then stays between 14 and 22 m', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const far = place(sim, KIND_LOBBER, 0, 40);
    const near = place(sim, KIND_LOBBER, 4, 0);
    const h = sim.world.horde;
    run(sim, TUCK, 60 * 8);
    for (const i of [far, near]) {
      expect(dist(sim, i)).toBeGreaterThanOrEqual(HORDE.lobberNear - 0.5);
      expect(dist(sim, i)).toBeLessThanOrEqual(HORDE.lobberFar + 0.5);
    }
    // And then holds still there.
    const x = [h.x[far], h.x[near]];
    const z = [h.z[far], h.z[near]];
    run(sim, TUCK, 120);
    expect(Math.hypot(h.x[far] - x[0], h.z[far] - z[0])).toBeLessThan(0.5);
    expect(Math.hypot(h.x[near] - x[1], h.z[near] - z[1])).toBeLessThan(0.5);
  });

  /**
   * A lobber off to the side of a running mover. Runs until it lobs, then `react` gets each tick of
   * the shot's flight. Returns the ring, where the mover would have been, and whether it was hit.
   */
  function lobbed(react: (sim: Sim, t: number) => InputFrame): { ringX: number; ringZ: number; wouldX: number; wouldZ: number; hit: boolean; landX: number; landZ: number; ticksToLob: number } {
    const sim = running();
    const [lx, lz] = offset(sim, 30, 16);
    place(sim, KIND_LOBBER, lx, lz);
    let ticksToLob = 0;
    while (zonesOf(sim, ZONE_LOB).length === 0 && ticksToLob < 600) {
      sim.step(STRAIGHT);
      ticksToLob++;
    }
    const z = zonesOf(sim, ZONE_LOB)[0];
    const zn = sim.world.zones;
    const m = sim.state.mover;
    const ringX = zn.x[z];
    const ringZ = zn.z[z];
    const wouldX = m.x + m.vx * HAZARDS.lobLead;
    const wouldZ = m.z + m.vz * HAZARDS.lobLead;
    expect(zn.r[z] * 2).toBeCloseTo(2.4, 5);
    const counts = new Map<number, number>();
    let hit = false;
    let landX = 0;
    let landZ = 0;
    for (let t = 0; t < HAZARDS.lobTicks; t++) {
      const input = react(sim, t);
      counts.clear();
      stepCounting(sim, input, 1, counts);
      if ((counts.get(FX_PLAYER_HIT) ?? 0) > 0) hit = true;
      if (t === HAZARDS.lobTicks - 1) {
        landX = m.x;
        landZ = m.z;
      }
    }
    // The ring is gone once it has landed.
    expect(zonesOf(sim, ZONE_LOB).length).toBe(0);
    return { ringX, ringZ, wouldX, wouldZ, hit, landX, landZ, ticksToLob };
  }

  it('lobs every 3.5 s, onto where the mover would be, and hurts a mover that kept its line', () => {
    const r = lobbed(() => STRAIGHT);
    expect(r.ticksToLob).toBe(Math.round(HAZARDS.lobEvery / DT));
    expect(r.ringX).toBeCloseTo(r.wouldX, 3);
    expect(r.ringZ).toBeCloseTo(r.wouldZ, 3);
    // It landed where the mover then was.
    expect(Math.hypot(r.landX - r.ringX, r.landZ - r.ringZ)).toBeLessThan(HAZARDS.lobRadius);
    expect(r.hit).toBe(true);
  });

  it('takes 12 health from a mover inside its ring as it lands', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    addZone(sim.world, ZONE_LOB, 0.5, 0, 0.5, HAZARDS.lobRadius, 3, HAZARDS.lobDamage);
    const hp = sim.world.player.hp;
    run(sim, TUCK, 2);
    expect(sim.world.player.hp).toBe(hp);
    run(sim, TUCK, 1);
    expect(sim.world.player.hp).toBe(hp - 12);
  });

  it('misses a mover that changed its line', () => {
    // A hard turn as soon as the ring shows.
    const r = lobbed(() => steer(1, 0));
    expect(Math.hypot(r.landX - r.ringX, r.landZ - r.ringZ)).toBeGreaterThan(HAZARDS.lobRadius);
    expect(r.hit).toBe(false);
  });

  it('misses a mover more than 1.5 m up as it lands, and hits one lower', () => {
    const at = (height: number): boolean => {
      const r = lobbed((sim, t) => {
        if (t === HAZARDS.lobTicks - 6) {
          // Off a crest: in the air, `height` m up and still rising a little.
          const m = sim.state.mover;
          m.grounded = false;
          m.airTicks = 1;
          m.y = height;
          m.vy = 3;
        }
        return STRAIGHT;
      });
      return r.hit;
    };
    expect(at(2.2)).toBe(false);
    expect(at(0.6)).toBe(true);
  });
});

describe('sludge', () => {
  it('leaves tar every 4 m it travels, 2.2 m across', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const i = place(sim, KIND_SLUDGE, 0, 60);
    const h = sim.world.horde;
    let travelled = 0;
    for (let t = 0; t < 60 * 8; t++) {
      const x = h.x[i];
      const z = h.z[i];
      sim.step(TUCK);
      travelled += Math.hypot(h.x[i] - x, h.z[i] - z);
    }
    const tars = zonesOf(sim, ZONE_TAR);
    expect(tars.length).toBe(Math.floor(travelled / HAZARDS.tarEvery));
    const zn = sim.world.zones;
    for (const z of tars) expect(zn.r[z] * 2).toBeCloseTo(2.2, 5);
    // On a straight walk, one patch every 4 m.
    for (let k = 1; k < tars.length; k++) {
      const a = tars[k - 1];
      const b = tars[k];
      expect(Math.hypot(zn.x[b] - zn.x[a], zn.z[b] - zn.z[a])).toBeCloseTo(HAZARDS.tarEvery, 1);
    }
    expect(KINDS[KIND_SLUDGE].speed).toBe(3);
    expect(KINDS[KIND_SLUDGE].hp).toBe(100);
  });

  it('never has more than 24 patches down at once', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    for (let k = 0; k < 5; k++) place(sim, KIND_SLUDGE, -40 + k * 20, 70);
    let most = 0;
    for (let t = 0; t < 60 * 15; t++) {
      sim.step(TUCK);
      most = Math.max(most, zonesOf(sim, ZONE_TAR).length);
    }
    expect(most).toBe(HAZARDS.tarMax);
  });

  /** Speed lost per second per m/s by a tucked mover, measured over one tick. */
  function dragAt(sim: Sim): number {
    const before = sim.state.mover.speed;
    sim.step(TUCK);
    const after = sim.state.mover.speed;
    return ((before - after) / DT - FEEL.rollFriction) / before;
  }

  it('slows a tucked mover by 1.2 /s of drag, and wears off after 10 s', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    // A strip of tar along the line the mover will coast.
    for (let k = 0; k < 20; k++) addZone(sim.world, ZONE_TAR, 0, 0, k * 2, HAZARDS.tarRadius, HAZARDS.tarTicks, HAZARDS.tarDrag);
    const clean = arena();
    setWeaponLevel(clean.world, W_WAKE, 0);
    launch(sim, 12);
    launch(clean, 12);
    run(sim, TUCK, 10);
    run(clean, TUCK, 10);
    expect(sim.world.player.cling).toBeCloseTo(1.2, 6);
    expect(clean.world.player.cling).toBe(0);
    const extra = dragAt(sim) - dragAt(clean);
    expect(extra).toBeCloseTo(1.2, 1);
    expect(sim.state.mover.speed).toBeLessThan(clean.state.mover.speed - 1);

    // Standing in it: the drag holds until the tar is gone, 10 s after it was laid.
    const stand = arena();
    setWeaponLevel(stand.world, W_WAKE, 0);
    addZone(stand.world, ZONE_TAR, 0, 0, 0, HAZARDS.tarRadius, HAZARDS.tarTicks, HAZARDS.tarDrag);
    run(stand, TUCK, HAZARDS.tarTicks - 1);
    expect(stand.world.player.cling).toBeCloseTo(1.2, 6);
    run(stand, TUCK, 1);
    expect(zonesOf(stand, ZONE_TAR).length).toBe(0);
    expect(stand.world.player.cling).toBe(0);
    expect(HAZARDS.tarTicks * DT).toBe(10);
  });

  it('does nothing to a mover in the air over it', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    addZone(sim.world, ZONE_TAR, 0, 0, 0, HAZARDS.tarRadius, HAZARDS.tarTicks, HAZARDS.tarDrag);
    sim.step(HOP);
    for (let t = 0; t < 20; t++) {
      sim.step(TUCK);
      if (!sim.state.mover.grounded) expect(sim.world.player.cling).toBe(0);
    }
  });
});

describe('clinger', () => {
  /** A standing mover with `n` clingers come and holding on. */
  function held(n: number, terrain = arena().terrain, from = 6): Sim {
    const sim = arena(terrain);
    setWeaponLevel(sim.world, W_WAKE, 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      place(sim, KIND_CLINGER, Math.sin(a) * from, Math.cos(a) * from);
    }
    run(sim, TUCK, from > 1 ? 90 : 2);
    return sim;
  }

  it('latches on instead of hurting, rides along, and drags 0.25 /s', () => {
    const sim = held(1);
    expect(latchedCount(sim)).toBe(1);
    expect(sim.world.player.latched).toBe(1);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp);
    expect(sim.world.player.cling).toBeCloseTo(HAZARDS.clingDrag, 6);
    // It goes where the mover goes.
    run(sim, STRAIGHT, 120);
    expect(dist(sim, 0)).toBeLessThan(1);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp);
  });

  it('stacks to four and no more; four drag a tucked mover 4 times the clinger drag', () => {
    const sim = held(6);
    expect(latchedCount(sim)).toBe(MAX_LATCHED);
    expect(sim.world.player.latched).toBe(4);
    expect(sim.world.player.cling).toBeCloseTo(4 * HAZARDS.clingDrag, 6);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp);
    // The drag, measured: a tucked coast with four on against one with none.
    const clean = arena();
    setWeaponLevel(clean.world, W_WAKE, 0);
    launch(sim, 10);
    launch(clean, 10);
    sim.world.player.invuln = 1000;
    run(sim, TUCK, 2);
    run(clean, TUCK, 2);
    const drag = (s: Sim): number => {
      const before = s.state.mover.speed;
      s.step(TUCK);
      return ((before - s.state.mover.speed) / DT - FEEL.rollFriction) / before;
    };
    expect(drag(sim) - drag(clean)).toBeCloseTo(4 * HAZARDS.clingDrag, 1);
  });

  it('is shaken off one per clean hop', () => {
    // A steep slope: a hop lands softly there (along the slope), so only the clean hops shake.
    const sim = held(4, slopeTerrain(1.5), 0.6);
    // Coasting down, it is still riding; clingers do not care how fast once on.
    expect(sim.world.player.latched).toBe(4);
    const h = sim.world.horde;
    const seen: number[] = [];
    let landedHard = false;
    for (let t = 0; t < 240 && sim.world.player.latched > 1; t++) {
      sim.step(HOP);
      const ev = sim.state.events;
      if ((ev & EV_LAND) !== 0 && sim.state.mover.impact >= HAZARDS.shakeImpact) landedHard = true;
      if ((ev & EV_CLEAN_HOP) !== 0) seen.push(sim.world.player.latched);
    }
    expect(landedHard).toBe(false);
    expect(seen.slice(0, 3)).toEqual([3, 2, 1]);
    // What let go was thrown clear and stunned, not hurt: nothing the board does deals damage.
    let thrown = 0;
    for (let i = 0; i < h.count; i++) {
      if (h.state[i] === STATE_LATCHED) continue;
      thrown++;
      expect(h.hp[i]).toBe(KINDS[KIND_CLINGER].hp);
    }
    expect(thrown).toBe(3);
  });

  it('is shaken off all at once by a hard landing: thrown clear and stunned 60 ticks, unhurt', () => {
    const sim = held(4);
    sim.step(HOP);
    let landed = false;
    for (let t = 0; t < 60 && !landed; t++) {
      sim.step(TUCK);
      landed = (sim.state.events & EV_LAND) !== 0;
      if (!landed) expect(sim.world.player.latched).toBe(4);
    }
    expect(sim.state.mover.impact).toBeGreaterThanOrEqual(HAZARDS.shakeImpact);
    expect(sim.world.player.latched).toBe(0);
    expect(sim.world.player.cling).toBe(0);
    const h = sim.world.horde;
    for (let i = 0; i < h.count; i++) {
      expect(h.state[i]).toBe(0);
      expect(h.stun[i]).toBe(HAZARDS.shakeStun);
      expect(h.hp[i]).toBe(KINDS[KIND_CLINGER].hp);
    }
    run(sim, TUCK, 30);
    for (let i = 0; i < h.count; i++) expect(dist(sim, i)).toBeGreaterThan(2);
  });

  it('is shaken off all at once by a loop popping', () => {
    const sim = arena();
    // Two tough ones in the mover's path, so the pop itself does not kill them.
    place(sim, KIND_CLINGER, 0, 3);
    place(sim, KIND_CLINGER, 0.4, 5);
    const h = sim.world.horde;
    h.hp[0] = 1000;
    h.hp[1] = 1000;
    run(sim, steer(0, 1), 60);
    expect(sim.world.player.latched).toBe(2);
    const counts = new Map<number, number>();
    let t = 0;
    while ((counts.get(FX_POP) ?? 0) === 0 && t < 900) {
      stepCounting(sim, steer(-0.6, 0.8), 1, counts);
      t++;
      if ((counts.get(FX_POP) ?? 0) === 0) expect(sim.world.player.latched).toBe(2);
    }
    expect(counts.get(FX_POP)).toBe(1);
    // The pop is seen by the clingers on the tick after.
    sim.step(steer(-0.6, 0.8));
    expect(sim.world.player.latched).toBe(0);
    for (let i = 0; i < h.count; i++) {
      expect(h.state[i]).toBe(0);
      expect(h.stun[i]).toBeGreaterThanOrEqual(HAZARDS.shakeStun - 1);
    }
  });

  it('is small, fast and light: 8 health, plowed in gear 3', () => {
    const k = KINDS[KIND_CLINGER];
    expect(k.speed).toBe(9);
    expect(k.hp).toBe(8);
    expect(k.latches).toBe(true);
  });
});

describe('every kind', () => {
  it('is slower than the floor of gear 3, hasted or not, and nothing steers faster in a run', () => {
    for (const k of KINDS) {
      expect(k.speed).toBeLessThan(FEEL.gear3);
      expect(Math.min(k.speed * HORDE.haste, Math.max(k.speed, FEEL.gear3 * HORDE.hasteCap))).toBeLessThan(FEEL.gear3);
    }
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const kinds = [KIND_SHUFFLER, KIND_GNAT, KIND_CUTTER, KIND_LOBBER, KIND_SLUDGE, KIND_CLINGER, KIND_BOLLARD];
    for (let k = 0; k < 70; k++) {
      const a = k * 2.4;
      const r = 8 + (k % 30);
      place(sim, kinds[k % kinds.length], Math.sin(a) * r, Math.cos(a) * r);
    }
    makeElite(sim.world, 2, ELITE_HASTE);
    makeElite(sim.world, 0, ELITE_HASTE);
    const h = sim.world.horde;
    let worst = 0;
    for (let t = 0; t < 60 * 20; t++) {
      sim.world.player.invuln = 100;
      sim.step(t < 60 ? STRAIGHT : steer(-0.6, 0.8));
      for (let i = 0; i < h.count; i++) {
        if (h.stun[i] > 0 || h.state[i] === STATE_LATCHED) continue;
        worst = Math.max(worst, Math.hypot(h.vx[i], h.vz[i]));
      }
    }
    expect(worst).toBeGreaterThan(KINDS[KIND_CUTTER].speed);
    expect(worst).toBeLessThan(FEEL.gear3);
  });
});

describe('elites', () => {
  function elite(sim: Sim, kind: number, aura: number, x: number, z: number): number {
    const i = place(sim, kind, x, z);
    makeElite(sim.world, i, aura);
    return i;
  }

  it('have six times the health', () => {
    const sim = arena();
    const i = elite(sim, KIND_SHUFFLER, ELITE_SHIELD, 0, 30);
    expect(sim.world.horde.hp[i]).toBe(KINDS[KIND_SHUFFLER].hp * DIRECTOR.eliteHp);
    expect(DIRECTOR.eliteHp).toBe(6);
  });

  it('haste: others near it steer 25% faster, it and those out of reach do not', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const e = elite(sim, KIND_SHUFFLER, ELITE_HASTE, 0, 40);
    const near = place(sim, KIND_SHUFFLER, 3, 40);
    const far = place(sim, KIND_SHUFFLER, 25, 40);
    const fast = place(sim, KIND_CUTTER, -3, 41);
    // Long enough for the cutter to reach its capped speed from rest at its acceleration.
    run(sim, TUCK, 75);
    const h = sim.world.horde;
    const v = (i: number): number => Math.hypot(h.vx[i], h.vz[i]);
    const s = KINDS[KIND_SHUFFLER].speed;
    expect(v(near)).toBeCloseTo(s * 1.25, 4);
    expect(v(e)).toBeCloseTo(s, 4);
    expect(v(far)).toBeCloseTo(s, 4);
    // A cutter is held under gear 3's floor.
    expect(v(fast)).toBeCloseTo(FEEL.gear3 * HORDE.hasteCap, 3);
    expect(v(fast)).toBeLessThan(FEEL.gear3);
  });

  it('shield: others near it take half damage while near it, it does not; gone when it dies', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const e = elite(sim, KIND_SHUFFLER, ELITE_SHIELD, 0, 40);
    const near = place(sim, KIND_SHUFFLER, 3, 40);
    const far = place(sim, KIND_SHUFFLER, 30, 40);
    root(sim.world);
    sim.step(TUCK);
    const h = sim.world.horde;
    expect(h.mark[near] & MARK_SHIELDED).toBe(MARK_SHIELDED);
    expect(h.mark[e] & MARK_SHIELDED).toBe(0);
    expect(h.mark[far] & MARK_SHIELDED).toBe(0);
    damageEnemy(sim.world, near, 4);
    damageEnemy(sim.world, far, 4);
    damageEnemy(sim.world, e, 4);
    expect(h.hp[near]).toBe(10 - 2);
    expect(h.hp[far]).toBe(10 - 4);
    expect(h.hp[e]).toBe(60 - 4);
    // Out of reach: no longer shielded.
    h.x[near] = 15;
    sim.step(TUCK);
    expect(h.mark[near] & MARK_SHIELDED).toBe(0);
    h.x[near] = 3;
    sim.step(TUCK);
    expect(h.mark[near] & MARK_SHIELDED).toBe(MARK_SHIELDED);
    // The elite dies: the shield goes with it.
    damageEnemy(sim.world, e, 1000);
    sim.step(TUCK);
    sim.step(TUCK);
    const left = sim.world.horde;
    for (let i = 0; i < left.count; i++) expect(left.mark[i] & MARK_SHIELDED).toBe(0);
  });

  it('jam: sparks near it are not pulled by the magnet; pulled ones keep flying; free once it dies', () => {
    const sim = arena();
    setWeaponLevel(sim.world, W_WAKE, 0);
    const e = elite(sim, KIND_SHUFFLER, ELITE_JAM, 0, 12);
    root(sim.world);
    const sp = sim.world.sparks;
    const add = (x: number, z: number, pull: number): void => {
      const i = sp.count++;
      sp.x[i] = x;
      sp.y[i] = 0.5;
      sp.z[i] = z;
      sp.value[i] = 0.1;
      sp.pull[i] = pull;
    };
    // In magnet range: one inside the jam, one outside it, and one already flying inside it.
    add(0, 2.6, 0);
    add(0, -2.6, 0);
    add(0.5, 3, 1);
    run(sim, TUCK, 30);
    expect(sp.count).toBe(1);
    expect(sp.z[0]).toBeCloseTo(2.6, 5);
    expect(sp.pull[0]).toBe(0);
    // Once the elite is gone the spark comes.
    damageEnemy(sim.world, e, 1000);
    run(sim, TUCK, 30);
    // The one it guarded has been taken (what is left is the elite's own spark, where it died).
    for (let i = 0; i < sp.count; i++) expect(Math.hypot(sp.x[i], sp.z[i] - 2.6)).toBeGreaterThan(1);
    expect(HORDE.jamReach).toBe(10);
  });

  it('a pack request brings one marked elite and ten shufflers in a ring 18 to 24 m round it, and is cleared', () => {
    const sim = arena();
    const w = sim.world;
    w.packs = 1;
    w.packX[0] = 30;
    w.packZ[0] = -40;
    sim.step(TUCK);
    expect(w.packs).toBe(0);
    const h = w.horde;
    expect(h.count).toBe(11);
    let elites = 0;
    let ex = 0;
    let ez = 0;
    for (let i = 0; i < h.count; i++) {
      if (h.elite[i] === 0) continue;
      elites++;
      ex = h.x[i];
      ez = h.z[i];
      expect(h.mark[i] & MARK_PACK).toBe(MARK_PACK);
      expect(h.kind[i] === KIND_SHUFFLER || h.kind[i] === KIND_CUTTER).toBe(true);
      expect(h.hp[i]).toBe(KINDS[h.kind[i]].hp * DIRECTOR.eliteHp);
    }
    expect(elites).toBe(1);
    expect(ex).toBeCloseTo(30, 4);
    expect(ez).toBeCloseTo(-40, 4);
    for (let i = 0; i < h.count; i++) {
      if (h.elite[i] !== 0) continue;
      expect(h.kind[i]).toBe(KIND_SHUFFLER);
      expect(h.mark[i] & MARK_PACK).toBe(0);
      const d = Math.hypot(h.x[i] - ex, h.z[i] - ez);
      expect(d).toBeGreaterThanOrEqual(DIRECTOR.packNear);
      expect(d).toBeLessThanOrEqual(DIRECTOR.packFar);
    }
    // Nothing more comes of it.
    sim.step(TUCK);
    expect(h.count).toBe(11);
  });
});

describe('determinism', () => {
  it('two identical 60 s runs with every kind, elites and a pack are identical every tick', () => {
    const make = (): Sim => {
      const sim = arena();
      const kinds = [KIND_SHUFFLER, KIND_GNAT, KIND_CUTTER, KIND_LOBBER, KIND_SLUDGE, KIND_CLINGER, KIND_BOLLARD];
      for (let k = 0; k < 140; k++) {
        const a = k * 2.399963;
        const r = 6 + (k % 45);
        place(sim, kinds[k % kinds.length], Math.sin(a) * r, Math.cos(a) * r);
      }
      makeElite(sim.world, 0, ELITE_HASTE);
      makeElite(sim.world, 2, ELITE_SHIELD);
      makeElite(sim.world, 7, ELITE_JAM);
      return sim;
    };
    const a = make();
    const b = make();
    for (let t = 0; t < 60 * 60; t++) {
      if (t === 600) {
        for (const s of [a, b]) {
          s.world.packs = 1;
          s.world.packX[0] = s.state.mover.x + 30;
          s.world.packZ[0] = s.state.mover.z;
        }
      }
      const input = t % 300 < 150 ? steer(-0.6, 0.8) : t % 97 === 0 ? HOP : STRAIGHT;
      a.step(input);
      b.step(input);
      expect(hashWorld(b.world)).toBe(hashWorld(a.world));
      expect(b.world.player.cling).toBe(a.world.player.cling);
    }
  });
});
