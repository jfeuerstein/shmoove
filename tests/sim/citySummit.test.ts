import { beforeAll, describe, expect, it } from 'vitest';
import { buildCity, type City } from '../../src/sim/city';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import type { CompiledLine } from '../../src/sim/lines';
import { placePlayer } from '../../src/sim/player';
import { Sim } from '../../src/sim/sim';
import type { SimEvent } from '../../src/sim/types';
import { findZone } from '../../src/sim/world';

let city: City;
beforeAll(() => {
  resetFeel();
  city = buildCity(1);
});

/** A key holds from its tick until the next key: [tick, steer, hold (0/1), hop on this tick (0/1)]. */
type Key = [number, number, number, number];

interface Script {
  /** Day tick the run starts at, standing at (x, z). */
  start: number;
  x: number;
  z: number;
  keys: Key[];
}

/**
 * The summit route, found by searching release ticks, hop-releases and whips link by link
 * (SKITCH_FIND_SUMMIT=1 npx vitest run tests/sim/findRoutes.test.ts --silent=false prints it). It
 * starts under the lower cable car's base strap at the Antenna gate as a car waits there:
 * ride it to the hill station, let go with a hop as a summit cable car waits beside it, ride
 * that up until a kite comes past, crack the whip and hop onto the kite's strap, ride the kite up
 * until the king kite swoops past, whip and hop onto it, and hold on: the king kite perches on
 * the needle, flies its circuit back the other way with the rider (inking the line) and drops them
 * onto the platform when it perches there again.
 */
const SUMMIT: Script = {
  start: 27540,
  x: -15.557336845398943,
  z: 947.2993933173871,
  keys: [
    [0, 0, 1, 1],
    [1380, -1, 1, 0],
    [1420, 0, 0, 0],
    [1425, 0, 1, 0],
    [1685, -1, 1, 0],
    [1725, 0, 0, 0],
    [1730, 0, 1, 0],
    [3214, 0, 1, 0],
    [3254, 0, 0, 1],
    [3259, 0, 1, 0],
  ],
};
/** Ticks the run lasts: past the drop onto the needle at the end of the king kite's way back. */
const SUMMIT_TICKS = 6600;
/** All four lines of the route repeat every this many ticks, and with them the window. */
const WINDOW_PERIOD = 5400;

function line(id: string): CompiledLine {
  const l = city.world.lines.find((x) => x.id === id);
  if (!l) throw new Error(`no line ${id}`);
  return l;
}

interface Replay {
  events: [number, SimEvent][];
  /** Tick of the first landing inside the needle zone, or -1. */
  needleLand: number;
}

function replay(s: Script, ticks = SUMMIT_TICKS, shift = 0, dropLinkAt = -1): Replay {
  const w = city.world;
  const sim = new Sim(w, { seed: 1, startDayFrac: 0 });
  sim.tick = s.start + shift;
  placePlayer(w, sim.player, s.x, s.z, 0);
  const needle = findZone(w, 'needle');
  if (!needle) throw new Error('no needle');
  const events: [number, SimEvent][] = [];
  let needleLand = -1;
  let k = 0;
  for (let i = 0; i < ticks; i++) {
    while (k + 1 < s.keys.length && s.keys[k + 1][0] <= i) k++;
    const key = s.keys[k];
    if (i === dropLinkAt && sim.player.chain > 1) {
      // As if the skater had got here with one link fewer.
      sim.player.chain -= 1;
    }
    sim.step({ steer: key[1], hold: key[2] === 1, hop: key[0] === i && key[3] === 1 });
    for (const e of sim.events) {
      events.push([i, e]);
      const p = sim.player;
      if (e.type === 'land' && needleLand < 0 && Math.hypot(p.x - needle.x, p.z - needle.z) < needle.r && Math.abs(p.y - needle.y) < 0.5) needleLand = i;
    }
  }
  return { events, needleLand };
}

/** The script with the release key at `index` (and its re-arm) moved by `by` ticks. */
function nudged(s: Script, index: number, by: number): Script {
  const keys = s.keys.map((k) => k.slice() as Key);
  for (let j = index - 1; j <= index + 1; j++) keys[j][0] += by;
  return { ...s, keys };
}

function hitches(r: Replay): Extract<SimEvent, { type: 'hitch' }>[] {
  return r.events.map(([, e]) => e).filter((e): e is Extract<SimEvent, { type: 'hitch' }> => e.type === 'hitch');
}

/** Did the run make the four-link chain onto the king kite and land on the needle? */
function succeeds(r: Replay): boolean {
  const h = hitches(r);
  const S3 = line('S3').index;
  const s3At = r.events.findIndex(([, e]) => e.type === 'hitch' && e.line === S3);
  if (s3At < 0) return false;
  const ended = r.events.slice(0, s3At).some(([, e]) => e.type === 'chainEnd');
  return !ended && h.length === 4 && h.map((e) => e.chain).join() === '1,2,3,4' && h[3].line === S3 && r.needleLand > r.events[s3At][0];
}

describe('the summit route', () => {
  it('rides lower cable car, summit cable car, kite and king kite as a four-link chain onto the needle', () => {
    const r = replay(SUMMIT);
    const h = hitches(r);
    expect(h.map((e) => city.world.lines[e.line].id)).toEqual(['A1', 'A2', 'A3', 'S3']);
    expect(h.map((e) => e.chain)).toEqual([1, 2, 3, 4]);
    expect(h.every((e) => e.newLink)).toBe(true);
    const s3At = r.events.findIndex(([, e]) => e.type === 'hitch' && e.line === line('S3').index);
    expect(r.events.slice(0, s3At).some(([, e]) => e.type === 'chainEnd')).toBe(false);
    expect(r.events.some(([, e]) => e.type === 'denied')).toBe(false);
    expect(r.needleLand).toBeGreaterThan(r.events[s3At][0]);
    expect(succeeds(r)).toBe(true);
  });

  it('opens the same window twice a day, 90 s apart, while the kites fly', () => {
    // The route's four lines all repeat every WINDOW_PERIOD ticks: the window before is identical.
    for (const l of ['A1', 'A2', 'A3', 'S3']) expect(WINDOW_PERIOD % line(l).period, l).toBe(0);
    const windows: number[] = [];
    for (let k = -4; k <= 2; k++) if (succeeds(replay(SUMMIT, SUMMIT_TICKS, k * WINDOW_PERIOD))) windows.push(k);
    // The whole route takes about a minute inside kite hours (0.35-0.70 of the day), on kites and
    // a king kite whose laps must start inside them: the windows come back to back, and include
    // the two the bots use. (With the 14 m strap, DECISIONS 119, the one before them works too:
    // measured -2, -1, 0.)
    expect(windows).toEqual(expect.arrayContaining([-1, 0]));
    for (let k = 1; k < windows.length; k++) expect(windows[k]).toBe(windows[k - 1] + 1);
    for (const k of windows) {
      const at = (SUMMIT.start + k * WINDOW_PERIOD) / DAY_TICKS;
      expect(at).toBeGreaterThanOrEqual(0.35);
      expect(at + SUMMIT_TICKS / DAY_TICKS).toBeLessThanOrEqual(0.7 + 0.1);
    }
  });

  it('is forgiving enough for a thumb: each release still works a tenth of a second early or late', () => {
    for (const index of [2, 5, 8]) {
      let ok = 0;
      for (let by = -6; by <= 6; by++) if (succeeds(replay(nudged(SUMMIT, index, by)))) ok++;
      expect(ok, `release ${index}`).toBe(13);
    }
  });

  it('turns away a skater who reaches the king kite with only three links', () => {
    // The same run, but riding the kite as the second link rather than the third (as if the
    // skater had boarded the summit cable car from the hill station platform): the king kite
    // would be only the third link. One link fewer slings 2.2 m/s slower off the kite, so the
    // release onto the king kite is searched again, as the run itself was.
    const full = replay(SUMMIT);
    const kiteCatch = full.events.find(([, e]) => e.type === 'hitch' && e.line === line('A3').index);
    expect(kiteCatch).toBeDefined();
    if (!kiteCatch) return;
    const at = kiteCatch[0] + 1;
    const shifted = (by: number): Script => ({ ...SUMMIT, keys: SUMMIT.keys.map((k, j) => [k[0] + (j >= 7 ? by : 0), k[1], k[2], k[3]] as Key) });
    let r = replay(SUMMIT, SUMMIT_TICKS, 0, at);
    for (let by = -60; by <= 60 && !r.events.some(([, e]) => e.type === 'denied'); by += 2) r = replay(shifted(by), SUMMIT_TICKS, 0, at);
    const h = hitches(r);
    // Turned away at the king kite: the hand that reached for it may catch another ride after (the
    // strap reaches 14 m since DECISIONS 119), never the king kite (checked below).
    expect(h.slice(0, 3).map((e) => city.world.lines[e.line].id)).toEqual(['A1', 'A2', 'A3']);
    const denied = r.events.find(([, e]) => e.type === 'denied');
    expect(denied?.[1]).toMatchObject({ type: 'denied', line: line('S3').index, need: 4 });
    expect(r.events.some(([, e]) => e.type === 'hitch' && e.line === line('S3').index)).toBe(false);
    expect(r.needleLand).toBe(-1);
  });
});
