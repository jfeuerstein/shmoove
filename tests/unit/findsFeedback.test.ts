import { describe, expect, it } from 'vitest';
import { TRAIL_TICKS, createFindsSound } from '../../src/app/audioView';
import { HapticMapper, patternFor } from '../../src/app/haptics';
import type { GameEvent } from '../../src/sim/game/game';

const tile = (count: number): GameEvent => ({ type: 'tile', index: count - 1, tier: 0, district: 0, count, total: 60 });

describe('finds sound', () => {
  it('a trail of tiles climbs a step each; a gap of more than 3 s starts again', () => {
    const heard: string[] = [];
    const sound = createFindsSound((k, s) => heard.push(`${k}${s}`));
    sound([tile(1)], 100);
    sound([tile(2)], 160);
    sound([tile(3), { type: 'unlock', id: 'deck.x', slot: 'deck', name: 'X' }], 160 + TRAIL_TICKS);
    sound([tile(4)], 160 + TRAIL_TICKS * 2 + 1);
    sound([{ type: 'spot', id: 's', name: 'S' }, { type: 'postcard', id: 'p', name: 'P' }], 2000);
    expect(heard).toEqual(['tile0', 'tile1', 'tile2', 'unlock0', 'tile0', 'spot0']);
  });
});

describe('finds haptics', () => {
  it('a tile is a light tap, below a hitch; a spot and an unlock are felt more', () => {
    const t = patternFor(tile(1));
    const s = patternFor({ type: 'spot', id: 's', name: 'S' });
    const u = patternFor({ type: 'unlock', id: 'd', slot: 'deck', name: 'D' });
    const h = patternFor({ type: 'hitch', line: 0, vehicle: 0, chain: 1, newLink: true });
    expect(t?.pattern).toEqual([7]);
    expect(t && h && t.priority < h.priority).toBe(true);
    expect(s && t && s.priority > t.priority).toBe(true);
    expect(u && t && u.priority > t.priority).toBe(true);
    // A tile and its unlock in one frame: the unlock is what is felt.
    const m = new HapticMapper();
    expect(m.frame([], [tile(5), { type: 'unlock', id: 'd', slot: 'deck', name: 'D' }], 0)?.name).toBe('unlock');
  });
});
