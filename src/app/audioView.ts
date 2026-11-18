/** Builds the per-frame AudioView from sim state (the nearest-ride search is throttled), and the sounds of finds. */
import type { AudioView, FindSound } from '../audio/index';
import type { GameEvent } from '../sim/game/game';
import { makeVehicleState, vehicleAt } from '../sim/lines';
import type { Sim } from '../sim/sim';
import { districtAt } from '../sim/world';

const NEAR_RANGE = 40;
const NEAR_EVERY = 6;
const _v = makeVehicleState();

export function createAudioView(): (sim: Sim, paused: boolean) => AudioView {
  const view: AudioView = {
    mode: 0,
    speed: 0,
    surface: 0,
    chain: 0,
    chainAlive: false,
    hitchedLine: -1,
    district: 0,
    dayFrac: 0,
    nearRideDist: Infinity,
    nearRideKind: null,
    paused: false,
  };
  let frame = 0;
  return (sim, paused) => {
    const p = sim.player;
    view.mode = p.mode;
    view.speed = p.speed;
    view.surface = p.surface;
    view.chain = p.chain;
    view.chainAlive = p.chainAlive === 1;
    view.hitchedLine = p.mode === 4 ? p.hLine : -1;
    view.district = districtAt(sim.world, p.z);
    view.dayFrac = sim.dayFrac;
    view.paused = paused;
    if (frame++ % NEAR_EVERY === 0) {
      let best = Infinity;
      let kind: string | null = null;
      const lines = sim.world.lines;
      for (let li = 0; li < lines.length; li++) {
        const L = lines[li];
        if (p.x < L.minX - NEAR_RANGE || p.x > L.maxX + NEAR_RANGE || p.z < L.minZ - NEAR_RANGE || p.z > L.maxZ + NEAR_RANGE) continue;
        for (let vi = 0; vi < L.vehicles; vi++) {
          vehicleAt(L, vi, sim.tick, _v);
          if (!_v.active) continue;
          const d = Math.hypot(_v.x - p.x, _v.y - p.y, _v.z - p.z);
          if (d < best) {
            best = d;
            kind = L.kind;
          }
        }
      }
      view.nearRideDist = best;
      view.nearRideKind = kind;
    }
    return view;
  };
}

/** A tile taken within this many ticks of the last one climbs a step (3 s). */
export const TRAIL_TICKS = 180;

/**
 * The sounds of finds, from game events: each tile a chime that climbs while they come within
 * TRAIL_TICKS of each other (a trail), a stamp for a spot, a fanfare for an unlock. `tick` is the sim
 * clock after the events, so the trail follows play time, not frames.
 */
export function createFindsSound(play: (kind: FindSound, step: number) => void): (events: readonly GameEvent[], tick: number) => void {
  let lastTile = -Infinity;
  let step = 0;
  return (events, tick) => {
    for (const e of events) {
      if (e.type === 'tile') {
        step = tick - lastTile <= TRAIL_TICKS ? step + 1 : 0;
        lastTile = tick;
        play('tile', step);
      } else if (e.type === 'spot') play('spot', 0);
      else if (e.type === 'unlock') play('unlock', 0);
    }
  };
}
