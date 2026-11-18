/**
 * The brake: pulling the finger down drags a foot. It slows the board from any speed and holds it
 * still, so a skater can stop and wait for a ride. A thumb that just rests on the glass (hold,
 * no pull) never slows anything. What a player would see, on the feel slice's street.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetFeel } from '../../src/sim/constants';
import { Mode } from '../../src/sim/types';
import { hSpeed, newSim, run, seekVehicle, slice, teleport } from './helpers';

const PI = 3.141592653589793;
const BRAKE = { steer: 0, hold: false, hop: false, brake: true };
const WAIT = { steer: 0, hold: true, hop: false, brake: true };
const REST = { steer: 0, hold: true, hop: false };
const NONE = { steer: 0, hold: false, hop: false };

function tram(sim: ReturnType<typeof newSim>): number {
  return sim.world.lines.findIndex((l) => l.kind === 'tram');
}

describe('the brake', () => {
  beforeEach(() => resetFeel());

  it('pulling down stops the skater on a hill and keeps them there; letting go rolls again', () => {
    const sim = newSim(slice());
    seekVehicle(sim, tram(sim), 0, 60, 1, 1500);
    teleport(sim, -1.5, 62, PI, 4);
    run(sim, 300, () => BRAKE);
    expect(hSpeed(sim)).toBe(0);
    const z0 = sim.player.z;
    run(sim, 300, () => BRAKE);
    expect(sim.player.z).toBe(z0);
    expect(sim.player.mode).toBe(Mode.GROUND);
    run(sim, 180, () => NONE);
    expect(hSpeed(sim)).toBeGreaterThan(1);
    expect(sim.player.z).toBeLessThan(z0 - 1);
  });

  it('a thumb resting still on the glass never slows the board, at any speed', () => {
    for (const v of [0, 1, 3, 6, 12]) {
      const a = newSim(slice());
      const b = newSim(slice());
      for (const s of [a, b]) {
        seekVehicle(s, tram(s), 0, 60, 1, 1500);
        teleport(s, -1.5, 62, PI, v);
      }
      // Short enough that nothing comes into reach of the resting thumb (which would hitch it).
      run(a, 90, () => REST);
      run(b, 90, () => NONE);
      expect(a.player.mode, `from ${v} m/s`).toBe(Mode.GROUND);
      expect(a.player.z, `from ${v} m/s`).toBe(b.player.z);
      expect(hSpeed(a), `from ${v} m/s`).toBe(hSpeed(b));
    }
  });

  it('a skater left alone at a standstill on a slope starts rolling, thumb down or not', () => {
    for (const input of [REST, NONE]) {
      const sim = newSim(slice());
      seekVehicle(sim, tram(sim), 0, 60, 1, 1500);
      teleport(sim, -1.5, 80, PI, 0);
      run(sim, 180, () => input);
      expect(hSpeed(sim)).toBeGreaterThan(2);
    }
  });

  it('brakes from speed too', () => {
    const a = newSim(slice());
    const b = newSim(slice());
    for (const s of [a, b]) {
      seekVehicle(s, tram(s), 0, 60, 1, 1500);
      teleport(s, -1.5, 80, PI, 12);
    }
    run(a, 60, () => BRAKE);
    run(b, 60, () => NONE);
    expect(hSpeed(a)).toBeLessThan(hSpeed(b) - 3);
  });

  it('a skater braked to a stand beside the lane, finger still down, catches the tram as it passes', () => {
    const sim = newSim(slice());
    seekVehicle(sim, tram(sim), 0, 60, 1, 240);
    teleport(sim, -2.5, 62, 0, 3);
    let stood = false;
    let hitchedFromRest = false;
    for (let i = 0; i < 600 && sim.player.mode !== Mode.HITCH; i++) {
      const before = hSpeed(sim);
      sim.step(WAIT);
      if (before === 0) stood = true;
      if ((sim.player.mode as number) === Mode.HITCH) hitchedFromRest = before === 0;
    }
    expect(stood).toBe(true);
    expect(sim.player.mode).toBe(Mode.HITCH);
    expect(hitchedFromRest).toBe(true);
    run(sim, 180, () => REST);
    expect(hSpeed(sim)).toBeGreaterThan(5);
  });
});
