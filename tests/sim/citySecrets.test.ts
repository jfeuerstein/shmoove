/**
 * The secret lines can be finished fairly, and their rides end with the rider standing: the blimp
 * caught from the hill station platform, the summit chain's king kite, the guy wire down from the
 * needle, and the hill station platform as somewhere to stop on the way down from the summit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { HILL_STATION_PLATFORM } from '../../src/sim/city/terrain';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine } from '../../src/sim/lines';
import { angleDiff, clamp, datan2 } from '../../src/sim/math';
import { placePlayer } from '../../src/sim/player';
import { Mode, type SimEvent } from '../../src/sim/types';
import { findZone, topHeight, type Zone } from '../../src/sim/world';
import { SUMMIT } from './bot/secrets';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

function line(id: string): CompiledLine {
  const l = city.world.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

function zone(id: string): Zone {
  const z = findZone(city.world, id);
  if (!z) throw new Error(`no zone ${id}`);
  return z;
}

const steerFor = (g: Game, x: number, z: number): number => {
  const p = g.sim.player;
  return clamp(-2 * angleDiff(datan2(x - p.x, z - p.z), p.heading), -1, 1);
};

const PF = HILL_STATION_PLATFORM;
function onDeck(g: Game): boolean {
  const p = g.sim.player;
  const deck = topHeight(city.world, (PF.x0 + PF.x1) / 2, (PF.z0 + PF.z1) / 2);
  return p.mode === Mode.GROUND && p.x > PF.x0 && p.x < PF.x1 && p.z > PF.z0 && p.z < PF.z1 && Math.abs(p.y - deck) < 0.05;
}

describe('the blimp', () => {
  it('is caught from the hill station platform by a hop, inks every segment in one ride, and sets the rider down standing on the deck', () => {
    resetFeel();
    const w = city.world;
    const L = line('S2');
    const game = new Game(w, { seed: 1, startDayFrac: 0.7595 });
    const p = game.sim.player;
    // Waiting on the deck under where the ladder hangs as the blimp starts its lap.
    const st = zone('stop_S2_0');
    placePlayer(w, p, st.x + 1, st.z + 1, 0);
    const V = makeVehicleState();
    const G = { x: 0, y: 0, z: 0 };
    const sim: SimEvent[] = [];
    let hitches = 0;
    let wasHitched = false;
    let settled = -1;
    for (let i = 0; i < 4 * 3600; i++) {
      let hop = false;
      let hold = false;
      let steer = 0;
      if (p.mode === Mode.HITCH) hold = true;
      else if (!wasHitched) {
        vehicleAt(L, 0, game.sim.tick, V);
        if (V.active) {
          grabPoint(L, V, G);
          const d = Math.hypot(G.x - p.x, G.z - p.z);
          // Standing, the ladder is out of reach: hop for it.
          if (p.mode === Mode.GROUND) expect(G.y - (p.y + FEEL.HAND_HEIGHT)).toBeGreaterThan(FEEL.HITCH_REACH_Y);
          hold = true;
          hop = p.mode === Mode.GROUND && d < 1.6;
          if (d > 0.8 && p.mode === Mode.GROUND) steer = steerFor(game, G.x, G.z);
        }
      } else hold = p.speed < FEEL.FOOT_SPEED;
      game.step({ steer, hold, hop });
      for (const e of game.sim.events) {
        sim.push(e);
        if (e.type === 'hitch') hitches++;
      }
      if (p.mode === Mode.HITCH) wasHitched = true;
      if (wasHitched && p.mode !== Mode.HITCH && onDeck(game) && p.speed < 0.05) {
        settled = i;
        break;
      }
    }
    expect(hitches).toBe(1);
    expect(sim.some((e) => e.type === 'hop')).toBe(true);
    expect(game.progress.lines[L.index].inked.every((b) => b)).toBe(true);
    expect(game.progress.lines[L.index].inked.length).toBeGreaterThanOrEqual(3);
    expect(sim.filter((e) => e.type === 'bail')).toEqual([]);
    expect(settled, 'standing still on the deck after the ride').toBeGreaterThan(0);
  });
});

describe("the summit chain's king kite", () => {
  for (const start of SUMMIT.starts) {
    it(`caught as the fourth link (window at ${start}), inks every S3 segment in that one ride and sets the rider down on the needle`, () => {
      resetFeel();
      const w = city.world;
      const S3 = line('S3');
      const game = new Game(w, { seed: 1, startDayFrac: 0 });
      game.sim.tick = start;
      placePlayer(w, game.sim.player, SUMMIT.x, SUMMIT.z, 0);
      const p = game.sim.player;
      const needle = zone('needle');
      const events: SimEvent[] = [];
      let k = 0;
      let s3Caught = -1;
      let landed = -1;
      for (let i = 0; i < 8000 && landed < 0; i++) {
        while (k + 1 < SUMMIT.keys.length && SUMMIT.keys[k + 1][0] <= i) k++;
        const key = SUMMIT.keys[k];
        game.step({ steer: key[1], hold: key[2] === 1, hop: key[0] === i && key[3] === 1 });
        for (const e of game.sim.events) {
          events.push(e);
          if (e.type === 'hitch' && e.line === S3.index) s3Caught = i;
          if (e.type === 'land' && s3Caught >= 0 && Math.hypot(p.x - needle.x, p.z - needle.z) < needle.r && Math.abs(p.y - needle.y) < 0.5) landed = i;
        }
      }
      const h = events.filter((e): e is Extract<SimEvent, { type: 'hitch' }> => e.type === 'hitch');
      expect(h.map((e) => [w.lines[e.line].id, e.chain])).toEqual([
        ['A1', 1],
        ['A2', 2],
        ['A3', 3],
        ['S3', 4],
      ]);
      expect(landed, 'set down on the needle').toBeGreaterThan(s3Caught);
      // One ride: the king kite is never let go of between the catch and the needle.
      expect(events.filter((e) => e.type === 'release' && e.line === S3.index).length).toBe(1);
      const lp = game.progress.lines[S3.index];
      expect(lp.inked.length).toBeGreaterThanOrEqual(2);
      expect(lp.inked.every((b) => b)).toBe(true);
      expect(events.some((e) => e.type === 'bail')).toBe(false);
    });
  }
});

describe("the needle's guy wire", () => {
  for (const how of ['roll off', 'hop off']) {
    it(`from the needle's top, a skater who ${how === 'roll off' ? 'rolls' : 'hops'} off the edge toward it grinds down to the summit lawn without a bail`, () => {
      resetFeel();
      const w = city.world;
      const needle = zone('needle');
      const game = new Game(w, { seed: 1, startDayFrac: 0.3 });
      const p = game.sim.player;
      // Standing on the needle's platform, facing its south edge, rolling slowly toward it.
      placePlayer(w, p, needle.x + 0.8, needle.z + 1.5, Math.PI);
      p.vz = -2.5;
      p.speed = 2.5;
      const events: SimEvent[] = [];
      let hopped = false;
      let rest = -1;
      for (let i = 0; i < 40 * 60 && rest < 0; i++) {
        const hop = how === 'hop off' && !hopped && p.mode === Mode.GROUND && p.z < needle.z - 1.4;
        if (hop) hopped = true;
        game.step({ steer: 0, hold: false, hop });
        for (const e of game.sim.events) events.push(e);
        if (p.mode === Mode.GROUND && p.y < needle.y - 30) rest = i;
      }
      expect(hopped).toBe(how === 'hop off');
      const ground = topHeight(w, p.x, p.z);
      expect(events.some((e) => e.type === 'grindStart'), events.map((e) => e.type).join(' ')).toBe(true);
      expect(events.filter((e) => e.type === 'bail')).toEqual([]);
      expect(rest, 'rolling on the lawn below').toBeGreaterThan(0);
      expect(Math.abs(p.y - ground)).toBeLessThan(0.05);
      expect(p.z).toBeLessThan(needle.z - 60);
    });
  }
});

describe('the hill station platform', () => {
  const lawn: [string, number, number, number, [number, number][]][] = [
    ['from the lawn at 6 m/s', 18, 1085, 6, [[19, 1036]]],
    ['from the lawn at 10 m/s', 18, 1085, 10, [[19, 1036]]],
    ['from the lawn at 14 m/s', 24, 1085, 14, [[24, 1036]]],
    ['down the spine stairs', 0, 1120, 0, [[0, 1066], [16, 1050], [19, 1036]]],
  ];
  for (const [name, x0, z0, v0, wps] of lawn) {
    it(`a skater coming down from the summit ${name} ends up standing on it`, () => {
      resetFeel();
      const w = city.world;
      const game = new Game(w, { seed: 1, startDayFrac: 0.3 });
      const p = game.sim.player;
      placePlayer(w, p, x0, z0, Math.PI);
      p.vz = -v0;
      p.speed = v0;
      let k = 0;
      let still = -1;
      let peak = 0;
      const events: SimEvent[] = [];
      for (let i = 0; i < 60 * 60 && still < 0; i++) {
        while (k < wps.length - 1 && Math.hypot(wps[k][0] - p.x, wps[k][1] - p.z) < 4) k++;
        const deck = onDeck(game);
        // Steer for the deck; once on it and slow enough, hold a still finger: a planted foot.
        const brake = deck && p.speed < FEEL.FOOT_SPEED;
        game.step({ steer: brake ? 0 : steerFor(game, wps[k][0], wps[k][1]), hold: brake, hop: false });
        for (const e of game.sim.events) events.push(e);
        if (p.z < PF.z1 + 15) peak = Math.max(peak, p.speed);
        if (onDeck(game) && p.speed < 0.05) still = i;
      }
      expect(events.filter((e) => e.type === 'bail' || e.type === 'wallHit')).toEqual([]);
      expect(still, 'standing still on the deck').toBeGreaterThan(0);
      if (v0 > 0) expect(peak, 'arrived near the speed it came at').toBeGreaterThan(Math.min(v0, 7));
    });
  }
});
