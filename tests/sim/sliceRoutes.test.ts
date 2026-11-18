/**
 * The feel slice's open-loop e2e routes, replayed in the deterministic sim through the real gesture
 * recogniser exactly as the e2e runner plays them (a `wait` steps the game with the recogniser's
 * frame each tick; a finger moves between ticks), so a route that drifts fails here first.
 *
 *   SKITCH_FIND_SLICE=1 npx vitest run tests/sim/sliceRoutes.test.ts --silent=false
 *
 * re-finds the touches by search and prints them, to paste into tests/e2e/routes/slice-grind.mjs
 * and slice-map.mjs when the controller or the slice changes.
 */
import { describe, expect, it } from 'vitest';
import { Gestures } from '../../src/input/gestures';
import { resetFeel } from '../../src/sim/constants';
import { Game } from '../../src/sim/game/game';
import { pathAt } from '../../src/sim/lines';
import { Mode } from '../../src/sim/types';
import { slice } from './helpers';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** The slice routes' clock (`t=0.330556`). */
const START = 0.330556;
/** The e2e runner's swipe: three moves of 60 px, one a tick. */
const SWIPE = 60;

type Step = ['w', number] | ['d', number, number] | ['m', number, number] | ['u'] | ['f', number, number];

interface Played {
  game: Game;
  /** Event types seen in the sim, from the start. */
  events: string[];
}

function play(steps: readonly Step[]): Played {
  resetFeel();
  const game = new Game(slice(), { seed: 1, startDayFrac: START });
  const g = new Gestures();
  const events: string[] = [];
  const tick = (): void => {
    game.step(g.sample());
    for (const e of game.sim.events) events.push(e.type);
  };
  for (const s of steps) {
    switch (s[0]) {
      case 'w':
        for (let i = 0; i < s[1]; i++) tick();
        break;
      case 'd':
        g.down(s[1], s[2]);
        break;
      case 'm':
        g.move(s[1], s[2]);
        break;
      case 'u':
        g.up();
        break;
      case 'f':
        // swipeUp: down, a tick, three moves up a tick apart, lift.
        g.down(s[1], s[2]);
        tick();
        for (let k = 1; k <= 3; k++) {
          g.move(s[1], s[2] - k * SWIPE);
          tick();
        }
        g.up();
        break;
    }
  }
  return { game, events };
}

// slice-grind: carve right for `right` ticks at +dx, counter-steer for `back` ticks, roll straight
// `roll` ticks onto the terrace, then swipe up onto the handrail.
const GRIND = { dx: 30, right: 10, back: 0, roll: 480 };

function grindSteps(c: typeof GRIND): Step[] {
  return [['w', 150], ['d', 195, 620], ['m', 195 + c.dx, 620], ['w', c.right], ['m', 195 - c.dx, 620], ['w', c.back], ['u'], ['w', c.roll]];
}

function onTerrace(r: Played): boolean {
  const p = r.game.sim.player;
  return p.mode === Mode.GROUND && p.x > 18 && p.x < 22 && p.z < 262;
}

function grinds(c: typeof GRIND): boolean {
  if (!onTerrace(play(grindSteps(c)))) return false;
  const a = play([...grindSteps(c), ['f', 195, 650], ['w', 60]]);
  if (!(a.events.includes('grindStart') && a.game.sim.player.mode === Mode.GRIND)) return false;
  const b = play([...grindSteps(c), ['f', 195, 650], ['w', 60], ['w', 240]]);
  return b.events.includes('grindEnd') && !b.events.includes('bail') && b.game.sim.player.z < 200;
}

// slice-map: catch the tram at the lookout, ride it `ride` ticks, let go, wait `pause` ticks and
// pull down for 150 ticks beside Muelle.
const MAP = { ride: 2682, pause: 20 };

function mapSteps(c: typeof MAP): Step[] {
  return [['w', 30], ['d', 195, 620], ['w', c.ride], ['u'], ['w', c.pause], ['d', 195, 560], ['m', 195, 660], ['w', 150]];
}

function stopsAtMuelle(c: typeof MAP): boolean {
  const r = play(mapSteps(c));
  const p = r.game.sim.player;
  const o = { x: 0, y: 0, z: 0, hx: 0, hz: 0 };
  pathAt(r.game.sim.world.lines[0], 0, o);
  return p.mode === Mode.GROUND && p.speed < 0.3 && Math.hypot(p.x - o.x, p.z - o.z) < 10 && r.game.progress.lines[0].inked.some((b) => b);
}

describe('the slice routes replay in the sim', () => {
  it('slice-grind: carves onto the terrace, hops onto the handrail and grinds it to the end', () => {
    expect(grinds(GRIND)).toBe(true);
  });

  it('slice-map: rides the tram through a segment, lets go and pulls down to a stop by Muelle', () => {
    expect(stopsAtMuelle(MAP)).toBe(true);
  });
});

describe.skipIf(!ENV.SKITCH_FIND_SLICE)('find the slice routes', () => {
  it('prints the touches', () => {
    let grind: typeof GRIND | null = null;
    for (const dx of [30, 40, 51.6, 60, 75]) {
      for (let right = 10; right <= 60 && !grind; right += 4) {
        for (let back = 0; back <= 60 && !grind; back += 4) {
          for (let roll = 100; roll <= 600 && !grind; roll += 10) {
            const c = { dx, right, back, roll };
            if (onTerrace(play(grindSteps(c))) && grinds(c)) grind = c;
          }
        }
      }
      if (grind) break;
    }
    let map: typeof MAP | null = null;
    for (let ride = 2400; ride <= 3300 && !map; ride += 10) {
      for (const pause of [5, 20, 40]) if (!map && stopsAtMuelle({ ride, pause })) map = { ride, pause };
    }
    console.info(`GRIND = ${JSON.stringify(grind)}\nMAP = ${JSON.stringify(map)}`);
    expect(grind).not.toBeNull();
    expect(map).not.toBeNull();
  }, 900_000);
});
