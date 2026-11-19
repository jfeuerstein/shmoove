/**
 * A whole run, start to finish, on the real bowl: the three bosses come at 3:00, 6:00 and 9:00, each
 * falls, and the Standstill's fall wins it. Played by a simple bot with a strong fixed build and its
 * health topped up, so what is checked is the run's shape (and that it replays exactly), not how
 * hard it is: the balance bots that follow judge that.
 */
import { describe, expect, it } from 'vitest';
import { P_HASTE, P_HEART, P_MIGHT, P_WIDE_LOAD, W_SEEKERS, W_SKIPPER, W_SLAM, W_STATIC } from '../../src/sim/arsenal';
import { BOSS_TIMES } from '../../src/sim/balance';
import { makeBowl } from '../../src/sim/bowl';
import { setPassiveLevel, setWeaponLevel } from '../../src/sim/build';
import { datan2, TAU } from '../../src/sim/math';
import type { Sim } from '../../src/sim/sim';
import { KINDS } from '../../src/sim/world';
import { playRun, type HordeRun } from './bot/playRun';
import { stickToward, yawTo, type Bot } from './bot/steer';

/** The bot rides this far from a boss's edge, round it, m: in reach of the weapons, out of its way. */
const CIRCLE = 6;
/** Enemies nearer than this are what the bot keeps away from, m. */
const NEAR = 14;
/** Beyond this share of the bowl's radius the bot turns back toward the middle. */
const HOME = 0.6;

/**
 * Keeps away from the nearest enemies: rides away from the middle of what is within `NEAR`, back
 * toward the middle of the bowl when far out. While a boss is up it circles it instead, so the
 * weapons, which fire on their own, can reach it.
 */
function makeKeepAway(): Bot {
  return (sim, out) => {
    const w = sim.world;
    const m = sim.state.mover;
    out.hop = false;
    const b = w.boss;
    if (b.kind >= 0) {
      const r = KINDS[b.kind].radius + CIRCLE;
      // A point a little way round the circle from where the mover is now.
      const a = datan2(m.x - b.x, m.z - b.z) + 0.6;
      stickToward(sim, yawTo(m, b.x + Math.sin(a) * r, b.z + Math.cos(a) * r), 1, out);
      return;
    }
    const h = w.horde;
    let ax = 0;
    let az = 0;
    let n = 0;
    for (let i = 0; i < h.count; i++) {
      const dx = h.x[i] - m.x;
      const dz = h.z[i] - m.z;
      if (dx * dx + dz * dz > NEAR * NEAR) continue;
      ax += dx;
      az += dz;
      n++;
    }
    const R = sim.terrain.radius * HOME;
    const out2 = m.x * m.x + m.z * m.z > R * R;
    if (out2) {
      stickToward(sim, yawTo(m, 0, 0), 1, out);
    } else if (n > 0) {
      stickToward(sim, datan2(-ax, -az), 1, out);
    } else {
      // Nothing close: carve a slow circle round the middle.
      const a = datan2(m.x, m.z) + TAU / 8;
      stickToward(sim, yawTo(m, Math.sin(a) * R * 0.5, Math.cos(a) * R * 0.5), 1, out);
    }
  };
}

/** The strong fixed build, put on before the first tick; health topped up before every tick. */
function strong(sim: Sim): void {
  const w = sim.world;
  if (w.run.ticks === 0 && sim.state.tick === 0) {
    setWeaponLevel(w, W_SEEKERS, 5);
    setWeaponLevel(w, W_STATIC, 5);
    setWeaponLevel(w, W_SLAM, 5);
    setWeaponLevel(w, W_SKIPPER, 5);
    setPassiveLevel(w, P_MIGHT, 5);
    setPassiveLevel(w, P_HASTE, 5);
    setPassiveLevel(w, P_WIDE_LOAD, 5);
    setPassiveLevel(w, P_HEART, 5);
  }
  w.player.hp = w.player.maxHp;
}

describe('a whole run', () => {
  const bowl = makeBowl(1);
  const t0 = performance.now();
  const first: HordeRun = playRun(bowl, 1, makeKeepAway(), { hook: strong, picker: () => 0 });
  const second: HordeRun = playRun(bowl, 1, makeKeepAway(), { hook: strong, picker: () => 0 });
  const took = (performance.now() - t0) / 1000;

  it('brings the three bosses at 3:00, 6:00 and 9:00, and each one falls', () => {
    expect(first.bossIn.length).toBe(3);
    for (let k = 0; k < 3; k++) {
      // On the tick its time comes (the clock reads one tick on once the step is done).
      expect(first.bossIn[k]).toBeCloseTo(BOSS_TIMES[k] + 1 / 60, 6);
      expect(first.bossDown[k]).toBeGreaterThan(first.bossIn[k]);
      if (k < 2) expect(first.bossDown[k]).toBeLessThan(BOSS_TIMES[k + 1]);
    }
    expect(first.bossesFelled).toBe(3);
  });

  it('ends won when the Standstill falls, not on the clock', () => {
    expect(first.end).toBe('won');
    expect(first.seconds).toBeCloseTo(first.bossDown[2], 6);
  });

  it('replays exactly: the same world every second of the run', () => {
    expect(second.hashes.length).toBe(first.hashes.length);
    for (let t = 59; t < first.hashes.length; t += 60) expect(second.hashes[t], `tick ${t}`).toBe(first.hashes[t]);
    expect(second.hashes[second.hashes.length - 1]).toBe(first.hashes[first.hashes.length - 1]);
  });

  it('takes under 20 s for both runs', () => {
    console.log(`[run] two whole runs: ${took.toFixed(1)} s; won at ${first.seconds.toFixed(1)} s; bosses in ${first.bossIn.map((x) => x.toFixed(1)).join(', ')}, down ${first.bossDown.map((x) => x.toFixed(1)).join(', ')}; kills ${first.kills}, level ${first.level}, peak horde ${first.peakHorde}`);
    expect(took).toBeLessThan(20);
  });
});
