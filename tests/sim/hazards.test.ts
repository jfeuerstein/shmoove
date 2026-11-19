/** What lies on the ground and what holds on: the drag it adds up to, and what it leaves alone. */
import { describe, expect, it } from 'vitest';
import { W_WAKE } from '../../src/sim/arsenal';
import { setWeaponLevel } from '../../src/sim/build';
import { dropTar, HAZARDS, lob, stepHazards } from '../../src/sim/hazards';
import type { Sim } from '../../src/sim/sim';
import { addZone, FX_PLAYER_HIT, KIND_CLINGER, STATE_LATCHED, ZONE_LOB, ZONE_MINE, ZONE_RING, ZONE_TAR } from '../../src/sim/world';
import { run, TUCK } from './fixtures';
import { arena, place } from './world-fixtures';

function quiet(): Sim {
  const sim = arena();
  setWeaponLevel(sim.world, W_WAKE, 0);
  return sim;
}

describe('the drag on the mover', () => {
  it('is 0 with nothing on it or under it', () => {
    const sim = quiet();
    run(sim, TUCK, 10);
    expect(sim.world.player.cling).toBe(0);
    expect(sim.world.player.latched).toBe(0);
  });

  it('is the sum of tar and clingers, and tar counts once however many patches overlap', () => {
    const sim = quiet();
    for (let k = 0; k < 3; k++) addZone(sim.world, ZONE_TAR, k * 0.3, 0, 0, HAZARDS.tarRadius, HAZARDS.tarTicks, HAZARDS.tarDrag);
    place(sim, KIND_CLINGER, 0, 0.6);
    place(sim, KIND_CLINGER, 0.6, 0);
    run(sim, TUCK, 3);
    expect(sim.world.player.latched).toBe(2);
    expect(sim.world.player.cling).toBeCloseTo(HAZARDS.tarDrag + 2 * HAZARDS.clingDrag, 6);
  });

  it('lets go of a clinger that dies while holding on', () => {
    const sim = quiet();
    const i = place(sim, KIND_CLINGER, 0, 0.6);
    run(sim, TUCK, 3);
    const h = sim.world.horde;
    expect(h.state[i]).toBe(STATE_LATCHED);
    h.hp[i] = 0;
    sim.step(TUCK);
    expect(h.count).toBe(0);
    expect(sim.world.player.latched).toBe(0);
    expect(sim.world.player.cling).toBe(0);
  });
});

describe('zones', () => {
  it('a lob landing does not hurt a mover that cannot be hurt yet', () => {
    const sim = quiet();
    addZone(sim.world, ZONE_LOB, 0, 0, 0, HAZARDS.lobRadius, 2, HAZARDS.lobDamage);
    sim.world.player.invuln = 10;
    run(sim, TUCK, 3);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp);
    expect(sim.world.zones.count).toBe(0);
  });

  it('a lob landing outside the mover does nothing', () => {
    const sim = quiet();
    addZone(sim.world, ZONE_LOB, HAZARDS.lobRadius + 0.2, 0, 0, HAZARDS.lobRadius, 2, HAZARDS.lobDamage);
    run(sim, TUCK, 3);
    expect(sim.world.player.hp).toBe(sim.world.player.maxHp);
  });

  it("a lob lands after the flight it was given: a lobber's by default, longer when asked (the Mortar's)", () => {
    for (const [ticks, given] of [[HAZARDS.lobTicks, undefined], [72, 72]] as const) {
      const sim = quiet();
      lob(sim.world, sim.terrain, 0, 0, given);
      expect(sim.world.zones.life[0]).toBe(ticks);
      let hitAt = -1;
      for (let t = 1; t <= ticks + 2 && hitAt < 0; t++) {
        sim.step(TUCK);
        for (let k = 0; k < sim.world.fx.count; k++) if (sim.world.fx.type[k] === FX_PLAYER_HIT) hitAt = t;
      }
      expect(hitAt).toBe(ticks);
    }
  });

  it("leaves the Standstill's rings to the bosses", () => {
    const sim = quiet();
    addZone(sim.world, ZONE_RING, 30, 0, 0, 0, 100, 15);
    stepHazards(sim.world, sim.state, sim.terrain);
    expect(sim.world.zones.life[0]).toBe(100);
    expect(sim.world.zones.r[0]).toBe(0);
  });

  it('leaves other kinds of zone alone', () => {
    const sim = quiet();
    addZone(sim.world, ZONE_MINE, 0, 0, 0, 2, 5, 30);
    run(sim, TUCK, 20);
    const zn = sim.world.zones;
    expect(zn.count).toBe(1);
    expect(zn.life[0]).toBe(5);
    expect(sim.world.player.cling).toBe(0);
  });

  it('a new patch of tar at the limit takes the place of the oldest', () => {
    const sim = quiet();
    const w = sim.world;
    for (let k = 0; k < HAZARDS.tarMax; k++) {
      dropTar(w, 100 + k, 0, 0);
      run(sim, TUCK, 1);
    }
    const zn = w.zones;
    expect(zn.count).toBe(HAZARDS.tarMax);
    dropTar(w, 500, 0, 0);
    expect(zn.count).toBe(HAZARDS.tarMax);
    const xs = Array.from(zn.x.subarray(0, zn.count));
    expect(xs).not.toContain(100);
    expect(xs).toContain(101);
    expect(xs).toContain(500);
  });
});
