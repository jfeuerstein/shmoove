/**
 * The perfcity route (what `npm run perf` times) played through the whole game in Node, tick for
 * tick as the browser plays it: the timed windows must show what the harness asserts in the
 * browser, with room to spare, so the gate cannot pass on a run that stood still.
 */
import { describe, expect, it } from 'vitest';
import { LEG_TICKS, LEG_WARM, PERF_LEGS, getRoute, routeWindows } from '../../src/app/routes';
import { chunkGrid, chunkOf } from '../../src/render/cityView';
import { buildCity } from '../../src/sim/city/index';
import { Game } from '../../src/sim/game/game';
import type { InputFrame } from '../../src/sim/types';
import { District, districtAt } from '../../src/sim/world';

interface WindowFacts {
  name: string;
  travel: number;
  districts: Set<District>;
  hitches: number;
  slings: number;
  crossings: number;
  speed: number;
}

function play(): WindowFacts[] {
  const world = buildCity(1).world;
  const game = new Game(world, { seed: 1 });
  const sim = game.sim;
  const route = getRoute('perfcity');
  if (route === null) throw new Error('no perfcity route');
  const grid = chunkGrid(world);
  const windows = routeWindows('perfcity');
  const facts: WindowFacts[] = windows.map((w) => ({ name: w.name, travel: 0, districts: new Set(), hitches: 0, slings: 0, crossings: 0, speed: 0 }));
  const input: InputFrame = { steer: 0, hold: false, hop: false };
  let px = 0;
  let pz = 0;
  let pc = -1;
  const end = windows[windows.length - 1].to;
  for (let t = 0; t < end; t++) {
    route(sim, t, input);
    game.step(input);
    const p = sim.player;
    const k = windows.findIndex((w) => t >= w.from && t < w.to);
    const c = chunkOf(grid, p.x, p.z);
    if (k >= 0) {
      const f = facts[k];
      if (t > windows[k].from) {
        f.travel += Math.hypot(p.x - px, p.z - pz);
        if (c !== pc) f.crossings++;
      }
      f.districts.add(districtAt(world, p.z));
      for (const e of sim.events) {
        if (e.type === 'hitch') f.hitches++;
        else if (e.type === 'release') f.slings++;
      }
    }
    px = p.x;
    pz = p.z;
    pc = c;
  }
  for (let k = 0; k < facts.length; k++) facts[k].speed = facts[k].travel / ((windows[k].to - windows[k].from) / 60);
  return facts;
}

describe('perfcity route', () => {
  const facts = play();

  it('names one timed window per leg, after each leg warm-up', () => {
    const w = routeWindows('perfcity');
    expect(w.map((x) => x.name)).toEqual(PERF_LEGS.map((l) => l.name));
    for (let k = 0; k < w.length; k++) {
      expect(w[k].from).toBe(k * LEG_TICKS + LEG_WARM);
      expect(w[k].to).toBe((k + 1) * LEG_TICKS);
    }
    expect(routeWindows('perf')).toEqual([]);
  });

  it('travels well over 40 m in every window, and the windows see all four districts', () => {
    for (const f of facts) expect(f.travel, f.name).toBeGreaterThan(48);
    const seen = new Set(facts.flatMap((f) => [...f.districts]));
    expect([...seen].sort()).toEqual([District.DOCKS, District.MERCADO, District.TERRACES, District.ANTENNA]);
  });

  it('catches rides in the timed ticks, and at least two windows hitch and sling', () => {
    const hitches = facts.reduce((a, f) => a + f.hitches, 0);
    expect(hitches).toBeGreaterThanOrEqual(3);
    expect(facts.filter((f) => f.hitches > 0 && f.slings > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('has a window that crosses chunk rows at speed', () => {
    const streaming = facts.find((f) => f.name === 'streaming');
    expect(streaming).toBeDefined();
    if (streaming) {
      expect(streaming.crossings).toBeGreaterThanOrEqual(2);
      expect(streaming.speed).toBeGreaterThan(10);
    }
  });
});
