/**
 * The perf route driven through the whole game for 20 000 ticks on the city, hashed tick by tick.
 * Used by the performance pass to show that cheaper vehicle lookups change nothing: the hash is
 * printed (compare it before and after a change) and two runs must agree.
 */
import { describe, expect, it } from 'vitest';
import { getRoute } from '../../src/app/routes';
import { buildCity } from '../../src/sim/city/index';
import { Game } from '../../src/sim/game/game';
import type { InputFrame } from '../../src/sim/types';
import type { World } from '../../src/sim/world';

const TICKS = 20_000;

function runHash(world: World): { hash: string; hitches: number; bumps: number } {
  const game = new Game(world, { seed: 1 });
  const sim = game.sim;
  const route = getRoute('perf');
  if (route === null) throw new Error('no perf route');
  const input: InputFrame = { steer: 0, hold: false, hop: false };
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    f64[0] = v;
    h = Math.imul(h ^ u32[0], 0x01000193) >>> 0;
    h = Math.imul(h ^ u32[1], 0x01000193) >>> 0;
  };
  let hitches = 0;
  let bumps = 0;
  for (let t = 0; t < TICKS; t++) {
    route(sim, t, input);
    game.step(input);
    const p = sim.player;
    mix(p.x);
    mix(p.y);
    mix(p.z);
    mix(p.vx);
    mix(p.vy);
    mix(p.vz);
    mix(p.heading);
    mix(p.mode);
    mix(p.chain);
    for (const e of sim.events) {
      mix(e.type.length * 31 + e.type.charCodeAt(0));
      if (e.type === 'hitch') hitches++;
      if (e.type === 'bounce' || e.type === 'bail') bumps++;
    }
    mix(game.events.length);
  }
  return { hash: h.toString(16).padStart(8, '0'), hitches, bumps };
}

describe('perf route sim hash', () => {
  it('20 000 ticks of the perf route on the city hash the same twice, with rides caught', () => {
    const world = buildCity(1).world;
    const a = runHash(world);
    const b = runHash(buildCity(1).world);
    console.log(`perf route sim hash ${a.hash} (hitches ${a.hitches}, bounces/bails ${a.bumps})`);
    expect(b.hash).toBe(a.hash);
    expect(a.hitches).toBeGreaterThan(5);
  }, 120_000);
});
