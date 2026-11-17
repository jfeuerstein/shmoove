import type { AudioView } from '../../../src/audio/index';
import type { CompiledLine } from '../../../src/sim/lines';
import { Mode } from '../../../src/sim/types';
import { Surface } from '../../../src/sim/world';

/** Lines as the mixer sees them: only district and stem matter to it. */
export function fakeLines(specs: Array<[district: number, stem: number]>): CompiledLine[] {
  return specs.map(([district, stem], index) => ({ index, district, stem, kind: 'tram' }) as unknown as CompiledLine);
}

export function view(over: Partial<AudioView> = {}): AudioView {
  return {
    mode: Mode.GROUND,
    speed: 6,
    surface: Surface.STREET,
    chain: 0,
    chainAlive: false,
    hitchedLine: -1,
    district: 0,
    dayFrac: 0.4,
    nearRideDist: Infinity,
    nearRideKind: null,
    paused: false,
    ...over,
  };
}

/** The view while hitched to `line` as link `chain`. */
export function hitchedView(line: number, chain: number, over: Partial<AudioView> = {}): AudioView {
  return view({ mode: Mode.HITCH, hitchedLine: line, chain, ...over });
}

/** The view while flying after a release with the chain alive. */
export function flyingView(chain: number, over: Partial<AudioView> = {}): AudioView {
  return view({ mode: Mode.AIR, surface: -1, chain, chainAlive: true, ...over });
}
