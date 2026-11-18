/**
 * Search for scripted chains: release ticks that throw a skater from one ride onto the next.
 *
 * A script is a list of keys, each holding from its tick until the next: [tick, steer, hold (0/1),
 * hop on this tick (0/1)], ticks counted from the start. A link is a whip and a release: steer `s`
 * for `L` ticks while holding, let go at tick R (with a hop or not), and hold again five ticks
 * later to catch the next ride. `findLink` tries every R in a range for a few whips and returns the
 * one in the middle of the widest run of R that catches the wanted ride as the wanted link, so the
 * release has slack either side for a thumb. The rides are a pure function of the clock and the
 * skater state is a plain object, so the trajectory before each release is computed once and every
 * candidate starts from its snapshot.
 *
 * Used to re-find the summit route (tests/sim/findRoutes.test.ts); run it again whenever the
 * controller, the city or the timetable changes.
 */
import { placePlayer } from '../../../src/sim/player';
import { Sim, clonePlayer } from '../../../src/sim/sim';
import type { PlayerState } from '../../../src/sim/types';
import type { World } from '../../../src/sim/world';

export type Key = [number, number, number, number];

export interface ChainStart {
  world: World;
  /** Absolute tick the script starts at. */
  start: number;
  x: number;
  z: number;
}

export interface Replayed {
  /** `${lineId}:${chain}` for each hitch, with the script tick it happened on. */
  hitches: { link: string; at: number }[];
  chainEnds: number[];
}

function keyAt(keys: readonly Key[], i: number): Key {
  let k = 0;
  while (k + 1 < keys.length && keys[k + 1][0] <= i) k++;
  return keys[k];
}

/** Play a script for `ticks` ticks; with `snaps`, keep the skater before every tick. */
export function replayChain(c: ChainStart, keys: readonly Key[], ticks: number, snaps?: PlayerState[], from?: { i: number; p: PlayerState }): Replayed {
  const sim = new Sim(c.world, { seed: 1, startDayFrac: 0 });
  let i0 = 0;
  if (from) {
    sim.tick = c.start + from.i;
    sim.player = clonePlayer(from.p);
    i0 = from.i;
  } else {
    sim.tick = c.start;
    placePlayer(c.world, sim.player, c.x, c.z, 0);
  }
  const out: Replayed = { hitches: [], chainEnds: [] };
  for (let i = i0; i < ticks; i++) {
    if (snaps) snaps[i] = clonePlayer(sim.player);
    const key = keyAt(keys, i);
    sim.step({ steer: key[1], hold: key[2] === 1, hop: key[0] === i && key[3] === 1 });
    for (const e of sim.events) {
      if (e.type === 'hitch') out.hitches.push({ link: `${c.world.lines[e.line].id}:${e.chain}`, at: i });
      if (e.type === 'chainEnd') out.chainEnds.push(i);
    }
  }
  return out;
}

export interface LinkFound {
  keys: Key[];
  /** The run of release ticks that works, inclusive. */
  from: number;
  to: number;
}

/**
 * Every run of release ticks in [r0, r1] that throws the skater onto `line` as link `chain`, after
 * the keys of `base` (which must end holding a ride), widest first. Whips of WHIP_TICKS with steer
 * -1, 0 or 1, with or without a hop; each run's keys release in its middle.
 */
export function findLinks(c: ChainStart, base: readonly Key[], line: string, chain: number, r0: number, r1: number, horizon = 240): LinkFound[] {
  const WHIP_TICKS = 40;
  const snaps: PlayerState[] = [];
  replayChain(c, base, r1 + 1, snaps);
  const want = `${line}:${chain}`;
  const keysFor = (R: number, s: number, hop: number): Key[] => [...base.filter((k) => k[0] < R - WHIP_TICKS), [R - WHIP_TICKS, s, 1, 0], [R, 0, 0, hop], [R + 5, 0, 1, 0]];
  const runs: LinkFound[] = [];
  for (const s of [0, -1, 1]) {
    for (const hop of [1, 0]) {
      let runFrom = -1;
      for (let R = r0; R <= r1 + 1; R++) {
        let good = false;
        if (R <= r1) {
          const w0 = R - WHIP_TICKS;
          const r = replayChain(c, keysFor(R, s, hop), R + horizon, undefined, { i: w0, p: snaps[w0] });
          const h = r.hitches.find((x) => x.link === want && x.at > R);
          good = h !== undefined && !r.chainEnds.some((t) => t > R && t < h.at) && !r.hitches.some((x) => x.at > R && x.at < h.at);
        }
        if (good && runFrom < 0) runFrom = R;
        if (!good && runFrom >= 0) {
          runs.push({ keys: keysFor(Math.round((runFrom + R - 1) / 2), s, hop), from: runFrom, to: R - 1 });
          runFrom = -1;
        }
      }
    }
  }
  return runs.sort((a, b) => b.to - b.from - (a.to - a.from));
}

/** When the script `keys` catches `line` as link `chain`, or -1. */
export function caughtAt(c: ChainStart, keys: readonly Key[], line: string, chain: number, ticks: number): number {
  const h = replayChain(c, keys, ticks).hitches.find((x) => x.link === `${line}:${chain}`);
  return h ? h.at : -1;
}

/**
 * Find a whole chain of links after `base`: for each link try the `beam` widest runs and keep the
 * combination whose narrowest run is widest (a thumb has the most slack at its hardest release).
 * Returns the keys and each link's run, or null.
 */
export function findChain(c: ChainStart, base: readonly Key[], links: readonly (readonly [string, number])[], span = 2400, beam = 3): { keys: Key[]; runs: LinkFound[] } | null {
  const last = base[base.length - 1][0];
  const from = (keys: readonly Key[], k: number): number => (k === 0 ? Math.max(last, replayChain(c, keys, 400).hitches[0]?.at ?? last) : caughtAt(c, keys, links[k - 1][0], links[k - 1][1], keys[keys.length - 1][0] + 240));
  let best: { keys: Key[]; runs: LinkFound[]; score: number } | null = null;
  const go = (keys: readonly Key[], k: number, runs: LinkFound[]): void => {
    if (k === links.length) {
      const score = Math.min(...runs.map((r) => r.to - r.from));
      if (!best || score > best.score) best = { keys: [...keys], runs: [...runs], score };
      return;
    }
    const at = from(keys, k);
    if (at < 0) return;
    const found = findLinks(c, keys, links[k][0], links[k][1], at + 60, at + span);
    for (const f of found.slice(0, k === links.length - 1 ? 1 : beam)) {
      if (best && f.to - f.from <= best.score) break;
      go(f.keys, k + 1, [...runs, f]);
    }
  };
  go(base, 0, []);
  const b = best as { keys: Key[]; runs: LinkFound[]; score: number } | null;
  return b ? { keys: b.keys, runs: b.runs } : null;
}
