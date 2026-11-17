/** Which world the app boots into: the feel slice (`?slice`) or the city. */
import { buildSlice } from '../sim/slice';
import type { World } from '../sim/world';
import type { SkitchParams } from './params';

export function buildWorld(params: SkitchParams): World {
  return buildSlice(params.seed);
}
