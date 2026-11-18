import { describe, expect, it } from 'vitest';
import { DAY_TICKS, FEEL } from '../../src/sim/constants';
import { grabPoint, makeVehicleState, vehicleAt } from '../../src/sim/lines';
import { LINEUP, LINEUP_RIDES, buildLineup, laneZ } from '../../src/sim/lineup';
import { PI } from '../../src/sim/math';
import type { Sim } from '../../src/sim/sim';
import { Mode } from '../../src/sim/types';
import { newSim, seekWhen, teleport } from './helpers';

const world = buildLineup(1);
const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };
/** Where each run starts: the vehicle's origin passes this x heading east, at cruise. */
const START_X = -30;

describe('the line-up world', () => {
  it('has one compiled line per roster row, each in its own lane', () => {
    expect(world.lines.map((l) => l.id)).toEqual(LINEUP_RIDES.map((r) => r.id));
    for (const [k, l] of world.lines.entries()) {
      expect(l.length).toBeGreaterThan(150);
      expect(l.pathPts[2]).toBe(laneZ(k));
      expect(l.overhead).toBe(LINEUP_RIDES[k].overhead);
      if (l.overhead) {
        expect(l.pathPts[1]).toBeGreaterThanOrEqual(7);
        expect(l.pathPts[1]).toBeLessThanOrEqual(12);
      }
    }
  });

  it('keeps every vehicle in service all day', () => {
    for (const l of world.lines) {
      for (let t = 0; t < DAY_TICKS; t += 997) {
        for (let i = 0; i < l.vehicles; i++) {
          vehicleAt(l, i, t, vs);
          expect(vs.active).toBe(true);
        }
      }
    }
  });

  it('sends the vehicles past the spawn one after another, nearest lane first', () => {
    for (const [k, l] of world.lines.entries()) {
      const t = LINEUP.firstCross + k * LINEUP.crossGap;
      vehicleAt(l, 0, t, vs);
      expect(Math.abs(vs.x)).toBeLessThan(1);
      expect(vs.vx).toBeGreaterThan(0);
    }
  });
});

/** Is line k's grab point the nearest of any active ride's to the skater's hand, as the hitch measures it? */
function nearestIs(sim: Sim, k: number): boolean {
  const p = sim.player;
  let best = Infinity;
  let line = -1;
  for (const L of world.lines) {
    for (let i = 0; i < L.vehicles; i++) {
      vehicleAt(L, i, sim.tick, vs);
      if (!vs.active) continue;
      grabPoint(L, vs, gp);
      // The hitch's own measure: plan distance over reach, height over vertical reach.
      const dy = gp.y - (p.y + FEEL.HAND_HEIGHT);
      const d = ((gp.x - p.x) ** 2 + (gp.z - p.z) ** 2) / FEEL.HITCH_REACH ** 2 + (dy * dy) / FEEL.HITCH_REACH_Y ** 2;
      // A bumper not yet come past cannot be grabbed (HITCH_AHEAD).
      if (!L.overhead && (p.x - gp.x) * vs.hx + (p.z - gp.z) * vs.hz > FEEL.HITCH_AHEAD) continue;
      if (d < best) {
        best = d;
        line = L.index;
      }
    }
  }
  return line === k || sim.player.mode === Mode.HITCH;
}

/**
 * Put a skater where a player would wait for this line: rolling beside a ground ride's lane just
 * ahead of it, or standing under an overhead ride's strap. Returns the sim, clock set.
 */
function waitFor(k: number): Sim {
  const sim = newSim(world, 0.5);
  const L = world.lines[k];
  seekWhen(sim, k, 0, (v) => v.vx > L.cruise * 0.95 && Math.abs(v.x - START_X) < 0.3);
  const z = laneZ(k);
  if (L.overhead) teleport(sim, START_X + 8, z, PI / 2, 0);
  else teleport(sim, START_X + 3, z + L.bodyHalfWid + 1.0, PI / 2, Math.min(5, L.cruise * 0.5));
  return sim;
}

describe('every line-up ride can be hitched', () => {
  for (const [k, spec] of LINEUP_RIDES.entries()) {
    it(`${spec.id} ${spec.name} (${spec.kind})`, () => {
      const sim = waitFor(k);
      const L = world.lines[k];
      // A strap above standing reach is caught with a hop timed to meet it.
      const needHop = L.overhead && L.anchorY - L.hang + L.pathPts[1] - FEEL.HAND_HEIGHT > FEEL.HITCH_REACH_Y * 0.85;
      let hopped = false;
      let hitchedAt = -1;
      for (let i = 0; i < 20 * 60 && hitchedAt < 0; i++) {
        let hop = false;
        if (needHop && !hopped) {
          vehicleAt(L, 0, sim.tick, vs);
          grabPoint(L, vs, gp);
          if (sim.player.x - gp.x < vs.vx * 0.4 + 0.6) {
            hop = true;
            hopped = true;
            // The king kite only takes a fourth link: arrive with a live three-link chain.
            if (L.minChainN > 1) {
              sim.player.chain = L.minChainN - 1;
              sim.player.chainAlive = 1;
              sim.player.chainGround = 0;
            }
          }
        }
        // Hand out only while this ride's strap is the nearest: the strap is thrown 14 m (DECISIONS
        // 119), and a hand out early catches the ride in the next lane.
        sim.step({ steer: 0, hold: nearestIs(sim, k), hop });
        for (const e of sim.events) if (e.type === 'hitch' && e.line === k) hitchedAt = i;
      }
      expect(hitchedAt, 'hitched within 20 s').toBeGreaterThanOrEqual(0);
      if (needHop) expect(hopped).toBe(true);
      for (let i = 0; i < 180; i++) sim.step({ steer: 0, hold: true, hop: false });
      expect(sim.player.mode).toBe(Mode.HITCH);
      expect(sim.player.hLine).toBe(k);
      // Towed along at the ride's pace.
      vehicleAt(L, 0, sim.tick, vs);
      expect(Math.abs(sim.player.vx - vs.vx)).toBeLessThan(Math.max(3, L.cruise));
    });
  }
});
