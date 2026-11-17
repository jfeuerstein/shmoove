/**
 * The secret lines' tasks: the summit route's four-link chain onto the king kite, ridden until it
 * sets the skater down on the needle.
 */
import { DAY_TICKS } from '../../../src/sim/constants';
import { Mode } from '../../../src/sim/types';
import { findZone } from '../../../src/sim/world';
import { lineById } from './geo';
import type { Task } from './skater';

/** A key holds from its tick until the next key: [tick, steer, hold (0/1), hop on this tick (0/1)]. */
type Key = readonly [number, number, number, number];

/**
 * The summit route as tests/sim/citySummit.test.ts found it, keyed to the window it opens: under the
 * lower cable car's strap at the Antenna gate as a car stands there, ride it to the hill station,
 * hop off as a summit car waits beside it, ride that until a kite comes past, whip onto the kite,
 * ride it until the king kite swoops past, whip onto that, and hold on.
 */
export const SUMMIT = {
  /** Where to stand: under the lower cable car's strap at the Antenna gate. */
  x: -15.557336845398943,
  z: 947.2993933173871,
  /** Day ticks the route's window opens at (it repeats every 5400 ticks while the kites fly). */
  starts: [22140, 27540],
  keys: [
    [0, 0, 1, 1],
    [1187, 1, 1, 0],
    [1227, 0, 0, 1],
    [1232, 0, 1, 0],
    [1329, -1, 1, 0],
    [1369, 0, 0, 1],
    [1374, 0, 1, 0],
    [3171, -1, 1, 0],
    [3211, 0, 0, 1],
    [3216, 0, 1, 0],
  ] as readonly Key[],
} as const;

/**
 * Stand under the lower cable car's strap until the route's window opens, play the route's touches
 * against the clock, and hold on to the king kite out, over the needle and back round its circuit
 * until it sets the skater down on the needle with its line inked.
 * A link missed (the chain did not reach the next ride) fails the task with where it broke.
 */
export function summitRun(label: string): Task {
  let t0 = -1;
  let phase: 'wait' | 'run' | 'king' = 'wait';
  const links: string[] = [];
  return {
    label,
    begin(b) {
      if (phase !== 'wait') return;
      const day = Math.floor(b.tick / DAY_TICKS) * DAY_TICKS;
      t0 = -1;
      // The next window at least 10 s away (time to get under the strap).
      for (let d = 0; d < 2 && t0 < 0; d++) {
        for (const s of SUMMIT.starts) {
          const t = day + d * DAY_TICKS + s;
          if (t > b.tick + 600) {
            t0 = t;
            break;
          }
        }
      }
    },
    step(b, out) {
      const p = b.p;
      const w = b.w;
      for (const e of b.game.sim.events) {
        if (e.type === 'hitch') {
          links.push(`${w.lines[e.line].id}:${e.chain}`);
          b.note(`link ${w.lines[e.line].id} chain ${e.chain}`);
        }
      }
      if (phase === 'wait') {
        if (b.tick < t0) {
          b.steerTo(out, SUMMIT.x, SUMMIT.z);
          return 'run';
        }
        phase = 'run';
      }
      const i = b.tick - t0;
      if (phase === 'run') {
        let k = 0;
        while (k + 1 < SUMMIT.keys.length && SUMMIT.keys[k + 1][0] <= i) k++;
        const key = SUMMIT.keys[k];
        out.steer = key[1];
        out.hold = key[2] === 1;
        out.hop = key[0] === i && key[3] === 1;
        // Check each link took: just after each catch the skater must be on the next ride.
        const want: [number, string][] = [
          [60, 'A1'],
          [1300, 'A2'],
          [1450, 'A3'],
          [3260, 'S3'],
        ];
        for (const [at, id] of want) {
          if (i === at && (p.mode !== Mode.HITCH || w.lines[p.hLine].id !== id)) return b.fail(`the summit chain broke before ${id} (links ${links.join(' ')})`);
        }
        if (i >= 3260) phase = 'king';
        return 'run';
      }
      // On the king kite: hold on over the needle and all the way back round its circuit, until it
      // perches on the needle again and goes, setting the skater down there.
      if (p.mode === Mode.HITCH) {
        out.hold = true;
        b.quiet(out);
        return 'run';
      }
      const S3 = lineById(w, 'S3');
      const prog = b.game.progress.lines[S3.index];
      if (!prog.complete) return b.fail(`the king kite's ride did not ink its line (${prog.inked.join(',')})`);
      const needle = findZone(w, 'needle');
      if (!needle || Math.hypot(p.x - needle.x, p.z - needle.z) > needle.r) return b.fail('the king kite did not set the skater down on the needle');
      return 'done';
    },
  };
}
