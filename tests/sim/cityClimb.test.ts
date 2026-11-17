import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { DAY_TICKS, FEEL, resetFeel } from '../../src/sim/constants';
import { Game, type GameEvent } from '../../src/sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Mode } from '../../src/sim/types';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

const vs = makeVehicleState();
const gp = { x: 0, y: 0, z: 0 };

function line(id: string): CompiledLine {
  const l = city.world.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

/** First day tick at which vehicle 0 of `l` starts a lap in service. */
function lapStartTick(l: CompiledLine): number {
  for (let t = 0; t < DAY_TICKS; t++) {
    vehicleAt(l, 0, t, vs);
    if (vs.lapTick === 0 && vs.active) return t;
  }
  throw new Error(`${l.id} never starts a lap`);
}

const REGULAR = ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4', 'A1', 'A2', 'A3'];

describe('inking the line map', () => {
  it('riding one full lap of each of the 13 regular lines completes it, and all 13 complete the map', () => {
    const game = new Game(city.world, { seed: 1, startDayFrac: 0 });
    const sim = game.sim;
    const events: GameEvent[] = [];
    for (const id of REGULAR) {
      const l = line(id);
      const t0 = lapStartTick(l);
      // Arrive at the terminus while vehicle 0 waits there to leave.
      sim.tick = t0 + 30;
      vehicleAt(l, 0, sim.tick, vs);
      grabPoint(l, vs, gp);
      const heading = Math.atan2(vs.hx, vs.hz);
      if (l.overhead) {
        // Stand under the strap.
        placePlayer(city.world, sim.player, gp.x, gp.z, heading);
      } else {
        // Stand just behind the bumper.
        placePlayer(city.world, sim.player, gp.x - vs.hx * 0.6, gp.z - vs.hz * 0.6, heading);
      }
      // A strap above standing reach is caught with a hop.
      const needHop = gp.y - (sim.player.y + FEEL.HAND_HEIGHT) > FEEL.HITCH_REACH_Y * 0.8;
      let hitched = -1;
      let lostAt = -1;
      const ticks = l.runTicks + 60;
      for (let i = 0; i < ticks; i++) {
        game.step({ steer: 0, hold: true, hop: needHop && hitched < 0 && i % 40 === 0 });
        for (const e of game.events) events.push(e);
        if (hitched < 0 && sim.player.mode === Mode.HITCH) hitched = i;
        if (hitched >= 0 && lostAt < 0 && sim.player.mode !== Mode.HITCH) lostAt = i;
      }
      expect(hitched, `${id} hitched`).toBeGreaterThanOrEqual(0);
      expect(hitched, `${id} hitched at the terminus`).toBeLessThan(l.dwell * 60);
      expect(sim.player.hLine, id).toBe(l.index);
      expect(sim.player.hVeh, `${id} vehicle`).toBe(0);
      expect(lostAt, `${id} stayed on all lap`).toBe(-1);
      const lp = game.progress.lines[l.index];
      expect(lp.inked.every((b) => b), `${id} inked ${lp.inked.map((b) => (b ? 1 : 0)).join('')}`).toBe(true);
      expect(lp.complete, id).toBe(true);
      expect(events.some((e) => e.type === 'lineComplete' && e.line === l.index)).toBe(true);
      // Let go before the next ride.
      game.step({ steer: 0, hold: false, hop: false });
      expect(game.progress.mapComplete).toBe(id === REGULAR[REGULAR.length - 1]);
    }
    expect(events.filter((e) => e.type === 'mapComplete').length).toBe(1);
  });
});
