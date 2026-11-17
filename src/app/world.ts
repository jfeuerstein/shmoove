/**
 * Which world the app boots into. The city is the default; `?slice` is the M1 feel slice and
 * `?world=NAME` picks a named world from the registry (fixtures for looking at things).
 */
import { buildCity } from '../sim/city/index';
import { buildLineup } from '../sim/lineup';
import { buildProptown } from '../sim/proptown';
import { buildSlice } from '../sim/slice';
import type { World } from '../sim/world';
import type { SkitchParams } from './params';

/** Named worlds. Add an entry per fixture; keys are the `?world=` values. */
const WORLDS: Record<string, (seed: number) => World> = {
  city: (seed) => buildCity(seed).world,
  slice: buildSlice,
  lineup: buildLineup,
  proptown: buildProptown,
};

const DEFAULT_WORLD = 'city';

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
