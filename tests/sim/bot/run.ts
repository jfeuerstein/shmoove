/**
 * Plays a Game with a Skater, tick by tick, and keeps the book a player-observer would: the game
 * events, bails, the skater's largest move in a tick, the longest stretch with nothing new, and the
 * time each line was finished.
 */
import { DAY_TICKS, FEEL } from '../../../src/sim/constants';
import { Game, type GameEvent } from '../../../src/sim/game/game';
import { NEW_GAME_DAY_FRAC } from '../../../src/app/newGame';
import { Mode, type InputFrame } from '../../../src/sim/types';
import { districtAt, type World } from '../../../src/sim/world';
import type { Skater } from './skater';

/** A new game, made as the app makes one on first launch: the city, its spawn, the new-game clock, hints on. */
export function newGame(world: World, seed = 1): Game {
  return new Game(world, { seed, startDayFrac: NEW_GAME_DAY_FRAC, hints: true });
}

export interface Book {
  /** Every game event with the tick it came out on. */
  events: { tick: number; e: GameEvent }[];
  bails: number;
  recoveries: number;
  /** Largest plan move in one tick outside a bail recovery, metres. */
  maxStep: number;
  maxStepAt: string;
  /** Moves bigger than a skater can make, outside a bail recovery. */
  jumps: string[];
  /** Longest run of ticks with no new segment inked and no change of district. */
  longestStall: number;
  stallEndAt: number;
  /** Line id -> tick it was completed. */
  lineDone: Record<string, number>;
  /** Ticks stepped. */
  ticks: number;
  startTick: number;
}

export function newBook(game: Game): Book {
  return {
    events: [],
    bails: 0,
    recoveries: 0,
    maxStep: 0,
    maxStepAt: '',
    jumps: [],
    longestStall: 0,
    stallEndAt: 0,
    lineDone: {},
    ticks: 0,
    startTick: game.sim.tick,
  };
}

/**
 * The most a skater can move in one tick, metres: the fastest they can go (a sling at the cap, the
 * board's top speed, or a ride plus a full whip) for a tick, plus the rail magnet, which pulls the
 * board onto a handrail up to RAIL_SNAP sideways in the tick a grind starts.
 */
export function maxSkaterStep(w: World): number {
  const fastest = Math.max(...w.lines.map((l) => l.cruise));
  return (Math.max(FEEL.SLING_CAP, FEEL.MAX_SPEED, fastest + FEEL.SWING_OMEGA_MAX * 4) + 1) / 60 + FEEL.RAIL_SNAP;
}

export interface Runner {
  game: Game;
  bot: Skater;
  book: Book;
  /** Step until `until` holds, the bot is done, or `max` ticks pass. Returns ticks stepped. */
  run(max: number, until?: () => boolean): number;
}

export function makeRunner(game: Game, bot: Skater, book: Book = newBook(game)): Runner {
  const input: InputFrame = { steer: 0, hold: false, hop: false };
  const stepMax = maxSkaterStep(game.sim.world);
  let px = game.sim.player.x;
  let pz = game.sim.player.z;
  let stall = 0;
  let district = districtAt(game.sim.world, pz);
  let bailing = false;
  const r: Runner = {
    game,
    bot,
    book,
    run(max, until) {
      const g = r.game;
      const w = g.sim.world;
      let n = 0;
      // A different game (a save loaded): start the move check from where it put the skater.
      if (g !== game) {
        game = g;
        px = g.sim.player.x;
        pz = g.sim.player.z;
        district = districtAt(w, pz);
      }
      while (n < max && !r.bot.done && !(until && until())) {
        r.bot.input(input);
        g.step(input);
        n++;
        book.ticks++;
        const p = g.sim.player;
        let inked = false;
        let recovered = false;
        for (const e of g.sim.events) {
          if (e.type === 'bail') {
            book.bails++;
            bailing = true;
          }
          if (e.type === 'recover') {
            book.recoveries++;
            recovered = true;
          }
        }
        for (const e of g.events) {
          book.events.push({ tick: g.sim.tick, e });
          if (e.type === 'segmentInked') inked = true;
          if (e.type === 'lineComplete') book.lineDone[w.lines[e.line].id] = g.sim.tick;
        }
        const d = districtAt(w, p.z);
        if (inked || d !== district) stall = 0;
        else stall++;
        district = d;
        if (stall > book.longestStall) {
          book.longestStall = stall;
          book.stallEndAt = g.sim.tick;
        }
        const step = Math.hypot(p.x - px, p.z - pz);
        if (bailing || recovered) {
          // A bail recovery (out of the water) puts the skater back at their last safe spot.
          bailing = p.mode === Mode.BAIL;
        } else {
          if (step > book.maxStep) {
            book.maxStep = step;
            book.maxStepAt = `tick ${g.sim.tick} mode ${p.mode} at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
          }
          if (step > stepMax) book.jumps.push(`${step.toFixed(2)} m at tick ${g.sim.tick} mode ${p.mode}`);
        }
        px = p.x;
        pz = p.z;
      }
      return n;
    },
  };
  return r;
}

export function dayOf(tick: number): number {
  return Math.floor(tick / DAY_TICKS);
}
