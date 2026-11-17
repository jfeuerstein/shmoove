/**
 * Which world the app boots into. `?slice` is the M1 feel slice; `?world=NAME` picks a named
 * world from the registry (fixtures for looking at things, and the city, which is the default).
 */
import { buildCity } from '../sim/city';
import { buildLineup } from '../sim/lineup';
import { buildSlice } from '../sim/slice';
import type { World } from '../sim/world';
import type { SkitchParams } from './params';

/** Named worlds. Add an entry per fixture; keys are the `?world=` values. */
const WORLDS: Record<string, (seed: number) => World> = {
  city: (seed) => buildCity(seed).world,
  slice: buildSlice,
  lineup: buildLineup,
};

const DEFAULT_WORLD = 'city';

export function buildWorld(params: SkitchParams): World {
  const name = params.slice ? 'slice' : (params.world ?? DEFAULT_WORLD);
  const build = WORLDS[name] ?? WORLDS[DEFAULT_WORLD];
  return build(params.seed);
}
