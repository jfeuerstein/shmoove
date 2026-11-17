/**
 * One builder per ride kind. Animated kinds have a few pre-built frames that the view swaps on
 * twos; the funicular has two variants (stepped for going up, stepped for going down).
 */
import type { CompiledLine, RideKind } from '../../sim/lines';
import { MeshBuilder } from '../geom';
import { blimp, cablecar, crane, kite } from './air';
import { PARADE_FRAMES, parade } from './parade';
import { bus, funicular, tram } from './rail';
import { forklift, handcart, moped, truck } from './road';

/** Animation frames on twos per kind (1 = static). */
export const KIND_FRAMES: Record<RideKind, number> = {
  tram: 1,
  ghosttram: 1,
  funicular: 1,
  bus: 1,
  truck: 1,
  forklift: 2,
  moped: 2,
  handcart: 2,
  parade: PARADE_FRAMES,
  crane: 1,
  cablecar: 1,
  kite: 3,
  blimp: 2,
};

/**
 * Geometry variants a line needs: its animation frames, or for the funicular the up and down
 * stepping.
 */
export function variantCount(kind: RideKind): number {
  return kind === 'funicular' ? 2 : KIND_FRAMES[kind];
}

/** Build variant `v` of a vehicle of `line` into `b`. */
export function buildKind(b: MeshBuilder, line: CompiledLine, v: number): void {
  const n = variantCount(line.kind);
  const f = ((Math.floor(v) % n) + n) % n;
  switch (line.kind) {
    case 'tram':
    case 'ghosttram':
      tram(b, line);
      break;
    case 'funicular':
      funicular(b, line, f === 0 ? 1 : -1);
      break;
    case 'bus':
      bus(b, line);
      break;
    case 'truck':
      truck(b, line);
      break;
    case 'forklift':
      forklift(b, line, f);
      break;
    case 'moped':
      moped(b, line, f);
      break;
    case 'handcart':
      handcart(b, line, f);
      break;
    case 'parade':
      parade(b, line, f);
      break;
    case 'crane':
      crane(b, line);
      break;
    case 'cablecar':
      cablecar(b, line);
      break;
    case 'kite':
      kite(b, line, f);
      break;
    case 'blimp':
      blimp(b, line, f);
      break;
  }
}

/** Ground footprint of a vehicle's blob shadow, [width, length] in metres. */
export function shadowSize(line: CompiledLine): [number, number] {
  switch (line.kind) {
    case 'crane':
      return [3.6, 3.2];
    case 'cablecar':
      return [2.6, 3.0];
    case 'kite':
      return line.minChainN > 1 ? [5, 6] : [2.4, 3];
    case 'blimp':
      return [6.5, 15];
    default:
      return [Math.max(1.5, line.bodyHalfWid * 2 + 1.6), Math.max(1.5, line.bodyHalfLen * 2 + 1.6)];
  }
}
