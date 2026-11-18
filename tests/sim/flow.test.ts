/**
 * Flow: tricks strung into a line make the board faster and carry its speed. What a player sees,
 * on the feel slice (its staircase has a handrail; the terrace above it is a place to jump from).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { SLICE } from '../../src/sim/slice';
import { Mode, type SimEvent } from '../../src/sim/types';
import { hSpeed, newSim, run, teleport } from './helpers';

const PI = 3.141592653589793;
const DOWNHILL = PI;

/** Roll at the handrail, hop onto it, and collect the events until `ticks` have passed. */
function grindRun(ticks: number, flowOff = false): { events: SimEvent[]; exit: number; sim: ReturnType<typeof newSim> } {
  const sim = newSim();
  // (newSim puts the feel back to its defaults, so switch flow off after it.)
  if (flowOff) {
    FEEL.FLOW_KICK = 0;
    FEEL.FLOW_KICK_STEP = 0;
    FEEL.FLOW_HOLD = 0;
  }
  teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
  let hopped = false;
  const events = run(sim, ticks, (s) => {
    const hop = !hopped && s.player.z <= 254;
    if (hop) hopped = true;
    return { hop };
  });
  return { events, exit: hSpeed(sim), sim };
}

describe('flow', () => {
  beforeEach(() => resetFeel());

  it('landing on a rail starts a line and kicks the board faster', () => {
    const on = grindRun(120);
    const first = on.events.find((e) => e.type === 'flow');
    expect(first).toEqual({ type: 'flow', count: 1, trick: 'grind' });
    resetFeel();
    const off = grindRun(120, true);
    expect(off.events.some((e) => e.type === 'grindStart')).toBe(true);
    // Same run, same rail: with flow the skater is ahead by about the kick.
    expect(on.sim.player.mode).toBe(Mode.GRIND);
    resetFeel();
    expect(Math.abs(on.sim.player.railV)).toBeGreaterThan(Math.abs(off.sim.player.railV) + FEEL.FLOW_KICK * 0.8);
  });

  it('a second trick inside the window makes it a line of two; the line ends when the window runs out', () => {
    const sim = newSim();
    teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
    let hopped = false;
    let grindAt = -1;
    let hoppedOff = false;
    // Onto the rail, then a hop off it part-way down: a jump that stays up long enough to count.
    const events = run(sim, 60 * 14, (s, i) => {
      if (grindAt < 0 && s.player.mode === Mode.GRIND) grindAt = i;
      const on = !hopped && s.player.z <= 254;
      if (on) hopped = true;
      const off = !hoppedOff && grindAt >= 0 && i >= grindAt + 45 && s.player.mode === Mode.GRIND;
      if (off) hoppedOff = true;
      // Lean away as they jump so they come down beside the rail, not back on it.
      const leaving = grindAt >= 0 && i >= grindAt + 40 && i < grindAt + 110;
      return { hop: on || off, steer: leaving ? -1 : 0 };
    });
    const flows = events.filter((e) => e.type === 'flow');
    expect(flows.slice(0, 2)).toEqual([
      { type: 'flow', count: 1, trick: 'grind' },
      { type: 'flow', count: 2, trick: 'air' },
    ]);

    const end = events.find((e) => e.type === 'flowEnd');
    expect(end).toBeDefined();
    if (end && end.type === 'flowEnd') {
      expect(end.count).toBeGreaterThanOrEqual(2);
      expect(end.bailed).toBe(false);
    }
    // Nothing is left over once it has ended.
    expect(sim.player.flow).toBe(0);
  });

  it('hopping on and off the same rail does not farm a line', () => {
    const sim = newSim();
    teleport(sim, SLICE.railX, 262, DOWNHILL, 7);
    let hopped = false;
    // Onto the rail, then hop straight up every half second: each hop lands back on it.
    const events = run(sim, 300, (s, i) => {
      const on = !hopped && s.player.z <= 254;
      if (on) hopped = true;
      return { hop: on || (s.player.mode === Mode.GRIND && i % 30 === 0) };
    });
    expect(events.filter((e) => e.type === 'grindStart').length).toBeGreaterThan(2);
    expect(events.filter((e) => e.type === 'flow' && e.trick === 'grind').length).toBe(1);
  });

  it('a bail ends the line at once', () => {
    const sim = newSim();
    // Into the slice's wall at speed, three tricks into a line.
    teleport(sim, 5, 80, PI / 2, FEEL.WALL_BAIL_SPEED + 4);
    sim.player.flow = 3;
    sim.player.flowTime = 3;
    const ev = run(sim, 60);
    expect(ev.some((e) => e.type === 'bail')).toBe(true);
    const end = ev.find((e) => e.type === 'flowEnd');
    expect(end).toEqual({ type: 'flowEnd', count: 3, bailed: true });
    expect(sim.player.flow).toBe(0);
  });

  it('a line in progress carries speed further on the flat than no line', () => {
    const coast = (flow: number): number => {
      const sim = newSim();
      teleport(sim, -1.5, 120, DOWNHILL, 14);
      sim.player.flow = flow;
      sim.player.flowTime = 99;
      run(sim, 90);
      return hSpeed(sim);
    };
    expect(coast(6)).toBeGreaterThan(coast(0) + 0.3);
  });

  it('is deterministic', () => {
    const a = grindRun(600);
    resetFeel();
    const b = grindRun(600);
    expect(a.sim.hash()).toBe(b.sim.hash());
  });
});
