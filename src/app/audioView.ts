/** Builds the per-frame AudioView from sim state. The nearest-ride search is throttled. */
import type { AudioView } from '../audio/index';
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
