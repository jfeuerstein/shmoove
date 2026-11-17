/**
 * Foot down: holding a still finger with no ride near stops the skater, so they can wait at a stop.
 * What a player would see, on the feel slice's street.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { Mode } from '../../src/sim/types';
import { flatWorld, hSpeed, newSim, run, seekVehicle, seekWhen, slice, teleport, testLine } from './helpers';

const PI = 3.141592653589793;
const HOLD = { steer: 0, hold: true, hop: false };
const NONE = { steer: 0, hold: false, hop: false };

function tram(sim: ReturnType<typeof newSim>): number {
  return sim.world.lines.findIndex((l) => l.kind === 'tram');
}

describe('foot down', () => {
  beforeEach(() => resetFeel());

  it('holding still at a rolling pace stops the skater on a hill and keeps them there', () => {
    const sim = newSim(slice());
    // Far from the tram, rolling downhill.
    seekVehicle(sim, tram(sim), 0, 60, 1, 1500);
    teleport(sim, -1.5, 62, PI, 4);
    run(sim, 300, () => HOLD);
    expect(hSpeed(sim)).toBe(0);
    const z0 = sim.player.z;
    run(sim, 300, () => HOLD);
    expect(sim.player.z).toBe(z0);
    expect(sim.player.mode).toBe(Mode.GROUND);
    // Lifting the finger lets the hill take over again.
    run(sim, 180, () => NONE);
    expect(hSpeed(sim)).toBeGreaterThan(1);
    expect(sim.player.z).toBeLessThan(z0 - 1);
  });

  it('does nothing at speed: a hand out, not a brake', () => {
    const a = newSim(slice());
    const b = newSim(slice());
    for (const s of [a, b]) {
      seekVehicle(s, tram(s), 0, 60, 1, 1500);
      teleport(s, -1.5, 80, PI, FEEL.FOOT_SPEED + 3);
    }
    run(a, 40, () => HOLD);
    run(b, 40, () => NONE);
    expect(a.player.z).toBe(b.player.z);
    expect(hSpeed(a)).toBe(hSpeed(b));
  });

  it('holding while carving keeps rolling', () => {
    const sim = newSim(slice());
    seekVehicle(sim, tram(sim), 0, 60, 1, 1500);
    teleport(sim, -1.5, 62, PI, 4);
    run(sim, 120, (_s, i) => ({ steer: i % 60 < 30 ? 0.5 : -0.5, hold: true, hop: false }));
    expect(hSpeed(sim)).toBeGreaterThan(2);
  });

  it('a skater standing beside the lane catches the tram as it passes', () => {
    const sim = newSim(slice());
    seekVehicle(sim, tram(sim), 0, 60, 1, 240);
    teleport(sim, -2.5, 62, 0, 3);
    let stood = false;
    let hitchedFromRest = false;
    for (let i = 0; i < 600 && sim.player.mode !== Mode.HITCH; i++) {
      const before = hSpeed(sim);
      sim.step(HOLD);
      if (before === 0) stood = true;
      if ((sim.player.mode as number) === Mode.HITCH) hitchedFromRest = before === 0;
    }
    expect(stood).toBe(true);
    expect(sim.player.mode).toBe(Mode.HITCH);
    expect(hitchedFromRest).toBe(true);
    // And is towed away at the tram's pace.
    run(sim, 180, () => HOLD);
    expect(hSpeed(sim)).toBeGreaterThan(5);
  });

  it('pressing early while rolling up behind a slow ride still catches it', () => {
    // A cart at walking pace on flat ground, the skater rolling up behind it from further and further back.
    for (const gap of [8, 12, 16, 20, 24]) {
      const sim = newSim(flatWorld([testLine({ kind: 'handcart', cruise: 2.5 })]));
      // Cart on the first straight (x = 30, heading +z), somewhere in the middle of it.
      seekWhen(sim, 0, 0, (v) => v.hz > 0.9 && v.z > -10 && v.z < 0);
      // Beside the lane, `gap` metres behind the cart's grab bar, rolling the same way, finger down from the start.
      teleport(sim, 28, -5 - 4 - gap, 0, 7);
      let caught = false;
      for (let i = 0; i < 600 && !caught; i++) {
        sim.step(HOLD);
        caught = (sim.player.mode as number) === Mode.HITCH;
      }
      expect(caught, `from ${gap} m behind`).toBe(true);
    }
  });

  it('a ride passing behind or beside the skater does not keep them rolling', () => {
    // The same cart, but the skater is rolling away from it across its lane's far side.
    const sim = newSim(flatWorld([testLine({ kind: 'handcart', cruise: 2.5 })]));
    seekWhen(sim, 0, 0, (v) => v.hz > 0.9 && v.z > -10 && v.z < 0);
    teleport(sim, 18, 0, -1.5707963267948966, 4);
    run(sim, 120, () => HOLD);
    expect(hSpeed(sim)).toBe(0);
  });
});
