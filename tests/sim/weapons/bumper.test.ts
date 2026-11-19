/**
 * The Bumper: a pulse on its own clock that hurts what is in reach and throws the light ones
 * back, whatever the rider is doing; and what a hit on the rider throws back is hurt too.
 */
import { describe, expect, it } from 'vitest';
import { W_BUMPER } from '../../../src/sim/arsenal';
import { setWeaponLevel } from '../../../src/sim/build';
import { BUMPER } from '../../../src/sim/stats';
import { bumperReach } from '../../../src/sim/weapons/bumper';
import { FX_BUMP, KIND_BOLLARD, KIND_SHUFFLER, KINDS } from '../../../src/sim/world';
import { arena, place, stepCounting } from '../world-fixtures';

const STILL = { steerX: 0, steerY: 0, carve: false, hop: false };

/** Ticks until the first pulse at `level`, and the world just after it. */
function firstPulse(level: number, at: number, kind = KIND_SHUFFLER): { ticks: number; hp: number; pushed: number; sim: ReturnType<typeof arena> } {
  const sim = arena();
  setWeaponLevel(sim.world, W_BUMPER, level);
  const m = sim.state.mover;
  const i = place(sim, kind, m.x + at, m.z);
  const h = sim.world.horde;
  const counts = new Map<number, number>();
  // Held where it is, harmless, until the pulse: this is about the pulse, not about contact.
  for (let t = 1; t <= 600; t++) {
    h.x[i] = m.x + at;
    h.z[i] = m.z;
    h.vx[i] = 0;
    h.vz[i] = 0;
    h.stun[i] = 2;
    counts.clear();
    stepCounting(sim, STILL, 1, counts);
    if ((counts.get(FX_BUMP) ?? 0) > 0) return { ticks: t, hp: h.hp[i], pushed: Math.hypot(h.vx[i], h.vz[i]), sim };
  }
  throw new Error('no pulse in ten seconds');
}

describe('the Bumper', () => {
  it('pulses on its own clock while the rider stands still, sooner at a higher level', () => {
    const a = firstPulse(1, 2);
    const b = firstPulse(5, 2);
    expect(a.ticks).toBe(Math.round(BUMPER.pulseWait[0] * 60));
    expect(b.ticks).toBe(Math.round(BUMPER.pulseWait[4] * 60));
    expect(b.ticks).toBeLessThan(a.ticks);
  });

  it('hurts what is in reach by its table damage and throws a light enemy back', () => {
    const r = firstPulse(1, 2);
    expect(r.hp).toBe(KINDS[KIND_SHUFFLER].hp - BUMPER.pulseDamage[0]);
    expect(r.pushed).toBeGreaterThan(BUMPER.pulseThrow * 0.5);
  });

  it('leaves alone what is out of reach', () => {
    const r = firstPulse(1, bumperReach(1, 1) + KINDS[KIND_SHUFFLER].radius + 1.5);
    expect(r.hp).toBe(KINDS[KIND_SHUFFLER].hp);
    expect(r.pushed).toBe(0);
  });

  it('hurts a bollard but does not throw it', () => {
    const r = firstPulse(3, 2.4, KIND_BOLLARD);
    expect(r.hp).toBe(KINDS[KIND_BOLLARD].hp - BUMPER.pulseDamage[2]);
    expect(r.pushed).toBe(0);
  });

  it('is credited with what it deals', () => {
    const r = firstPulse(2, 2);
    expect(r.sim.world.tally.dealt[W_BUMPER]).toBe(BUMPER.pulseDamage[1]);
  });

  it('reaches further with the level and with the area stat', () => {
    expect(bumperReach(0, 1)).toBe(0);
    expect(bumperReach(5, 1)).toBeGreaterThan(bumperReach(1, 1));
    expect(bumperReach(2, 1.5)).toBeCloseTo(bumperReach(2, 1) * 1.5, 9);
  });
});
