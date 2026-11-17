import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../src/sim/types';
import { ChainDisplay } from '../../../src/ui/chain';

const DT = 1 / 60;
const NONE: readonly SimEvent[] = [];
const hitch = (chain: number): SimEvent => ({ type: 'hitch', line: 0, vehicle: 0, chain, newLink: true });
const end = (chain: number, reason: 'land' | 'bail' = 'land'): SimEvent => ({ type: 'chainEnd', chain, reason });

/** Runs idle frames and reports whether any of them showed a lost chain. */
function anyLost(d: ChainDisplay, frames: number): boolean {
  let seen = false;
  for (let i = 0; i < frames; i++) if (d.update(NONE, 0, DT).lost) seen = true;
  return seen;
}

describe('chain meter', () => {
  it('shows the live chain while riding', () => {
    const d = new ChainDisplay();
    expect(d.update([hitch(1)], 1, DT)).toEqual({ n: 1, lost: false });
    expect(d.update([hitch(2)], 2, DT)).toEqual({ n: 2, lost: false });
  });

  it('does not flash "lost" when a single ride ends', () => {
    const d = new ChainDisplay();
    d.update([hitch(1)], 1, DT);
    expect(d.update([end(1)], 0, DT)).toEqual({ n: 0, lost: false });
    expect(anyLost(d, 120)).toBe(false);
  });

  it('does not flash "lost" when a single ride ends in a bail', () => {
    const d = new ChainDisplay();
    d.update([hitch(1)], 1, DT);
    expect(d.update([end(1, 'bail')], 0, DT).lost).toBe(false);
    expect(anyLost(d, 120)).toBe(false);
  });

  it('shows the count of a real chain that was lost for a moment, then clears', () => {
    const d = new ChainDisplay();
    d.update([hitch(3)], 3, DT);
    expect(d.update([end(3)], 0, DT)).toEqual({ n: 3, lost: true });
    for (let i = 0; i < 30; i++) d.update(NONE, 0, DT);
    expect(d.update(NONE, 0, DT)).toEqual({ n: 3, lost: true });
    for (let i = 0; i < 90; i++) d.update(NONE, 0, DT);
    expect(d.update(NONE, 0, DT)).toEqual({ n: 0, lost: false });
  });

  it('a new hitch clears the lost display at once', () => {
    const d = new ChainDisplay();
    d.update([end(4)], 0, DT);
    expect(d.update([hitch(1)], 1, DT)).toEqual({ n: 1, lost: false });
  });

  it('a single ride ending clears an older lost display rather than reviving it', () => {
    const d = new ChainDisplay();
    d.update([end(4)], 0, DT);
    expect(d.update([end(1)], 0, DT).lost).toBe(false);
  });
});
