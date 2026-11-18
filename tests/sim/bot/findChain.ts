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
 * Find the release onto `line` as link `chain`, at a release tick in [r0, r1], after the keys of
 * `base` (which must end holding a ride). Whips of WHIP_TICKS with steer -1, 0 or 1, with or
 * without a hop. Returns null when nothing in the range works.
 */
export function findLink(c: ChainStart, base: readonly Key[], line: string, chain: number, r0: number, r1: number, horizon = 240): LinkFound | null {
  const WHIP_TICKS = 40;
  const snaps: PlayerState[] = [];
  replayChain(c, base, r1 + 1, snaps);
  const want = `${line}:${chain}`;
  let best: LinkFound | null = null;
  for (const s of [0, -1, 1]) {
    for (const hop of [1, 0]) {
      let runFrom = -1;
      for (let R = r0; R <= r1 + 1; R++) {
        let good = false;
        if (R <= r1) {
          const keys: Key[] = [...base.filter((k) => k[0] < R - WHIP_TICKS), [R - WHIP_TICKS, s, 1, 0], [R, 0, 0, hop], [R + 5, 0, 1, 0]];
          const w0 = R - WHIP_TICKS;
          const r = replayChain(c, keys, R + horizon, undefined, { i: w0, p: snaps[w0] });
          const h = r.hitches.find((x) => x.link === want && x.at > R);
          good = h !== undefined && !r.chainEnds.some((t) => t > R && t < h.at) && !r.hitches.some((x) => x.at > R && h !== undefined && x.at < h.at);
        }
        if (good && runFrom < 0) runFrom = R;
        if (!good && runFrom >= 0) {
          const to = R - 1;
          if (!best || to - runFrom > best.to - best.from) {
            const mid = Math.round((runFrom + to) / 2);
            best = { keys: [...base.filter((k) => k[0] < mid - WHIP_TICKS), [mid - WHIP_TICKS, s, 1, 0], [mid, 0, 0, hop], [mid + 5, 0, 1, 0]], from: runFrom, to };
          }
          runFrom = -1;
        }
      }
    }
  }
  return best;
}
