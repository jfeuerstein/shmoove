/** The seven M3 weapons together: the same ride twice is the same world, and they are cheap. */
import { describe, expect, it } from 'vitest';
import {
  W_CRUMBS,
  W_LANCE,
  W_ORBIT,
  W_SKIPPER,
  W_SLAM,
  W_SLIPSTREAM,
  W_STATIC,
  W_WAKE,
  WEAPON_COUNT,
} from '../../../src/sim/arsenal';
import { setWeaponLevel } from '../../../src/sim/build';
import type { Sim } from '../../../src/sim/sim';
import { WEAPONS } from '../../../src/sim/weapons';
import {
  FX_ARC,
  FX_BLAST,
  FX_SLAM,
  FX_STONE,
  hashWorld,
  KIND_BOLLARD,
  KIND_GNAT,
  KIND_SHUFFLER,
} from '../../../src/sim/world';
import { arena, place, root } from '../world-fixtures';
import { rideInput, tick } from './rig';

const SEVEN = [W_SLAM, W_ORBIT, W_STATIC, W_SKIPPER, W_SLIPSTREAM, W_CRUMBS, W_LANCE];

/**
 * Carry all seven at `level`. The loadout has four slots, so the levels are written straight into
 * it: the weapons step by level, whatever the slots say. Test-only; the game never carries seven.
 */
function carrySeven(sim: Sim, level: number): void {
  setWeaponLevel(sim.world, W_WAKE, 0);
  for (const id of SEVEN) sim.world.player.loadout.weaponLevel[id] = level;
}

describe('determinism', () => {
  /** 40 s of the scripted ride with all seven at level 3 among walking enemies; the hash after every tick. */
  function scripted(): { hashes: number[]; seen: Map<number, number>; kills: number } {
    const sim = arena();
    carrySeven(sim, 3);
    // Tough enough to live through the ride: the test is about the weapons, not about dying.
    sim.world.player.maxHp = 1e5;
    sim.world.player.hp = 1e5;
    for (let i = 0; i < 160; i++) {
      const a = i * 2.399;
      const r = 6 + Math.sqrt(i) * 4;
      const kind = i % 9 === 0 ? KIND_BOLLARD : i % 4 === 0 ? KIND_GNAT : KIND_SHUFFLER;
      place(sim, kind, Math.sin(a) * r + 20, Math.cos(a) * r + 30);
    }
    const hashes: number[] = [];
    const seen = new Map<number, number>();
    for (let t = 0; t < 60 * 40; t++) {
      const m = sim.state.mover;
      // Keep the ride lively without help from the controls: a steady 14 m/s.
      const hs = Math.hypot(m.vx, m.vz);
      if (hs > 1e-3) {
        m.vx = (m.vx / hs) * 14;
        m.vz = (m.vz / hs) * 14;
      }
      sim.step(rideInput(t));
      const f = sim.world.fx;
      for (let i = 0; i < f.count; i++) seen.set(f.type[i], (seen.get(f.type[i]) ?? 0) + 1);
      hashes.push(hashWorld(sim.world));
    }
    return { hashes, seen, kills: sim.world.player.kills };
  }

  it('a 40 s ride with all seven at level 3 gives the same world every tick, twice', () => {
    const a = scripted();
    const b = scripted();
    expect(a.kills).toBeGreaterThan(20);
    // Every weapon that shows itself did so.
    for (const type of [FX_SLAM, FX_ARC, FX_STONE, FX_BLAST]) expect(a.seen.get(type) ?? 0).toBeGreaterThan(0);
    let first = -1;
    for (let t = 0; t < a.hashes.length && first < 0; t++) if (a.hashes[t] !== b.hashes[t]) first = t;
    expect(first).toBe(-1);
  });
});

describe('cost', () => {
  /**
   * A ride inside a crowd of 400 that never die and keep their places around the mover, so every
   * weapon always has work. Each of the seven's steps is timed where the sim calls it; returns the
   * seven's ms per tick over `ticks`, and the share each took.
   */
  function weaponMs(ticks: number): { perTick: number; each: number[] } {
    const spent = new Float64Array(WEAPON_COUNT);
    const saved = SEVEN.map((id) => WEAPONS[id]);
    for (const id of SEVEN) {
      const inner = WEAPONS[id]?.step;
      if (!inner) throw new Error(`weapon ${id} is not registered`);
      WEAPONS[id] = {
        id,
        step: (w, s, terrain, level) => {
          const t0 = performance.now();
          inner(w, s, terrain, level);
          spent[id] += performance.now() - t0;
        },
      };
    }
    try {
      const sim = arena();
      carrySeven(sim, 5);
      sim.world.player.xpNext = Infinity;
      const ox = new Float64Array(400);
      const oz = new Float64Array(400);
      for (let i = 0; i < 400; i++) {
        const a = i * 2.399;
        const r = 2 + Math.sqrt(i) * 1.6;
        ox[i] = Math.sin(a) * r;
        oz[i] = Math.cos(a) * r;
        place(sim, i % 9 === 0 ? KIND_BOLLARD : KIND_SHUFFLER, ox[i], oz[i]);
      }
      const h = sim.world.horde;
      const m = sim.state.mover;
      const step = (t: number): void => {
        for (let i = 0; i < h.count; i++) {
          h.hp[i] = 1e9;
          h.x[i] = m.x + ox[i];
          h.z[i] = m.z + oz[i];
        }
        root(sim.world);
        tick(sim, rideInput(t), { speed: 16, gear: 5 });
      };
      // Warm up, then measure.
      for (let t = 0; t < 300; t++) step(t);
      spent.fill(0);
      for (let t = 300; t < 300 + ticks; t++) step(t);
      expect(h.count).toBe(400);
      let total = 0;
      for (const id of SEVEN) total += spent[id];
      return { perTick: total / ticks, each: SEVEN.map((id) => spent[id] / ticks) };
    } finally {
      SEVEN.forEach((id, k) => {
        WEAPONS[id] = saved[k];
      });
    }
  }

  it('all seven at level 5 among 400 enemies cost well under 2 ms a tick', () => {
    const { perTick, each } = weaponMs(1200);
    const names = ['slam', 'orbit', 'static', 'skipper', 'slipstream', 'crumbs', 'lance'];
    console.log(
      `seven weapons at level 5 among 400 enemies: ${perTick.toFixed(4)} ms/tick (` +
        names.map((n, k) => `${n} ${each[k].toFixed(4)}`).join(', ') +
        ')',
    );
    expect(perTick).toBeGreaterThan(0);
    expect(perTick).toBeLessThan(2);
  });
});
