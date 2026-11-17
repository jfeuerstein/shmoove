/**
 * Which world the app boots into. `?slice` is the M1 feel slice; `?world=NAME` picks a named
 * world from the registry (fixtures for looking at things, and the city).
 */
import { buildCity } from '../sim/city/index';
import { buildLineup } from '../sim/lineup';
import { buildProptown } from '../sim/proptown';
import { buildSlice } from '../sim/slice';
import type { World } from '../sim/world';
import type { SkitchParams } from './params';

/** Named worlds. Add an entry per fixture; keys are the `?world=` values. */
const WORLDS: Record<string, (seed: number) => World> = {
  slice: buildSlice,
  lineup: buildLineup,
  proptown: buildProptown,
  city: (seed) => buildCity(seed).world,
};

const DEFAULT_WORLD = 'slice';

/** Small worlds are meshed whole; anything larger streams in chunks around the camera. */
const STREAMED = new Set(['city', 'proptown']);

export function worldName(params: SkitchParams): string {
  const name = params.slice ? 'slice' : (params.world ?? DEFAULT_WORLD);
  return name in WORLDS ? name : DEFAULT_WORLD;
}

export function buildWorld(params: SkitchParams): World {
  return WORLDS[worldName(params)](params.seed);
}

export function isStreamed(params: SkitchParams): boolean {
  return STREAMED.has(worldName(params));
}
