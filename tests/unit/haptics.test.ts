import { describe, expect, it } from 'vitest';
import {
  CHAIN_PULSE_CAP,
  GRIND_TICK_MS,
  HapticMapper,
  createHaptics,
  hitchPattern,
  landPattern,
  patternFor,
} from '../../src/app/haptics';
import type { GameEvent } from '../../src/sim/game/game';
import type { SimEvent } from '../../src/sim/types';

const sim = (...e: SimEvent[]): SimEvent[] => e;
const game = (...e: GameEvent[]): GameEvent[] => e;
const HITCH1: SimEvent = { type: 'hitch', line: 0, vehicle: 0, chain: 1, newLink: true };
const RELEASE: SimEvent = { type: 'release', line: 0, vehicle: 0, speed: 12, chain: 1, hop: false };
const BAIL: SimEvent = { type: 'bail', reason: 'impact' };
const HOP: SimEvent = { type: 'hop' };
const DENIED: SimEvent = { type: 'denied', line: 1, need: 2 };

describe('event to pattern mapping', () => {
  it('gives each felt event its pattern', () => {
    const cases: Array<[SimEvent | GameEvent, number[]]> = [
      [HITCH1, [18]],
      [RELEASE, [10, 30, 22]],
      [HOP, [6]],
      [{ type: 'grindStart', rail: 0 }, [12]],
      [{ type: 'wallHit', speed: 6 }, [25]],
      [BAIL, [60, 40, 60]],
      [{ type: 'bounce', speed: 4 }, [15]],
      [DENIED, [8, 60, 8]],
      [{ type: 'segmentInked', line: 0, segment: 0 }, [12, 40, 12]],
    ];
    for (const [e, pattern] of cases) expect(patternFor(e)?.pattern, e.type).toEqual(pattern);
  });

  it('rolls longer for a completed line, longer still for the whole map', () => {
    const line = patternFor({ type: 'lineComplete', line: 0 });
    const map = patternFor({ type: 'mapComplete' });
    const sum = (p: readonly number[] | undefined): number => (p ?? []).reduce((a, b) => a + b, 0);
    expect(line?.pattern.length).toBeGreaterThan(3);
    expect(sum(map?.pattern)).toBeGreaterThan(sum(line?.pattern));
    expect(sum(line?.pattern)).toBeGreaterThan(sum(patternFor({ type: 'segmentInked', line: 0, segment: 0 })?.pattern));
  });

  it('scales the landing thud with impact, from 8 ms to 30 ms', () => {
    expect(landPattern(0).pattern).toEqual([8]);
    expect(landPattern(1000).pattern).toEqual([30]);
    const mid = landPattern(9).pattern[0];
    expect(mid).toBeGreaterThan(8);
    expect(mid).toBeLessThan(30);
    expect(landPattern(Number.NaN).pattern).toEqual([8]);
    expect(patternFor({ type: 'land', impact: 18, surface: 0 })?.pattern).toEqual([30]);
  });

  it('adds one short pulse per chain link beyond the first, up to the cap', () => {
    expect(hitchPattern(1).pattern).toEqual([18]);
    expect(hitchPattern(2).pattern).toEqual([18, 40, 10]);
    expect(hitchPattern(3).pattern).toEqual([18, 40, 10, 40, 10]);
    const capped = hitchPattern(CHAIN_PULSE_CAP + 1).pattern;
    expect(capped.length).toBe(1 + 2 * CHAIN_PULSE_CAP);
    expect(hitchPattern(50).pattern).toEqual(capped);
    expect(patternFor({ ...HITCH1, chain: 3 })?.pattern).toEqual([18, 40, 10, 40, 10]);
  });

  it('ignores events that are not felt', () => {
    expect(patternFor({ type: 'recover' })).toBeNull();
    expect(patternFor({ type: 'kickturn' })).toBeNull();
    expect(patternFor({ type: 'chalkRecordStart' })).toBeNull();
  });
});

describe('HapticMapper', () => {
  it('plays at most one pattern a frame: the most important event wins', () => {
    const m = new HapticMapper();
    const p = m.frame(sim(HOP, BAIL, RELEASE), game({ type: 'segmentInked', line: 0, segment: 0 }), 0);
    expect(p?.name).toBe('bail');
  });

  it('does not queue: a less or equally important pattern is dropped while one plays', () => {
    const m = new HapticMapper();
    expect(m.frame(sim(RELEASE), game(), 0)?.name).toBe('release'); // 62 ms long
    expect(m.frame(sim(HOP), game(), 16)).toBeNull();
    expect(m.frame(sim(RELEASE), game(), 32)).toBeNull();
    // Once it has finished, anything plays again.
    expect(m.frame(sim(HOP), game(), 70)?.name).toBe('hop');
  });

  it('lets a more important pattern cut in', () => {
    const m = new HapticMapper();
    expect(m.frame(sim(HOP), game(), 0)?.name).toBe('hop');
    expect(m.frame(sim(BAIL), game(), 2)?.name).toBe('bail');
    expect(m.frame(sim(HITCH1), game(), 20)).toBeNull();
  });

  it('does not repeat the denied buzz on every tick the sim repeats the event', () => {
    const m = new HapticMapper();
    let played = 0;
    for (let t = 0; t < 1000; t += 16) if (m.frame(sim(DENIED), game(), t)) played++;
    expect(played).toBeLessThanOrEqual(2);
    expect(played).toBeGreaterThanOrEqual(1);
  });

  it('ticks lightly every 150 ms while grinding, and stops when the grind ends', () => {
    const m = new HapticMapper();
    expect(m.frame(sim({ type: 'grindStart', rail: 3 }), game(), 0)?.name).toBe('grind');
    const ticks: number[] = [];
    for (let t = 16; t <= 1000; t += 16) if (m.frame(sim(), game(), t)?.name === 'grindTick') ticks.push(t);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(GRIND_TICK_MS);
    m.frame(sim({ type: 'grindEnd', rail: 3 }), game(), 1016);
    for (let t = 1032; t < 2000; t += 16) expect(m.frame(sim(), game(), t)).toBeNull();
  });

  it('plays nothing when disabled', () => {
    const m = new HapticMapper();
    expect(m.frame(sim(BAIL), game({ type: 'mapComplete' }), 0, false)).toBeNull();
    expect(m.frame(sim({ type: 'grindStart', rail: 0 }), game(), 10, false)).toBeNull();
    for (let t = 20; t < 600; t += 16) expect(m.frame(sim(), game(), t, false)).toBeNull();
    // Turned back on mid-grind, the ticks resume.
    expect(m.frame(sim(), game(), 600, true)?.name).toBe('grindTick');
  });
});

describe('createHaptics wrapper', () => {
  it('calls vibrate with the pattern when enabled and visible', () => {
    const calls: number[][] = [];
    const h = createHaptics({ enabled: () => true, vibrate: (p) => calls.push(p.slice()), visible: () => true });
    h.frame(sim(RELEASE), game(), 0.016);
    expect(calls).toEqual([[10, 30, 22]]);
    expect(h.last).toBe('release');
    expect(h.supported).toBe(true);
  });

  it('stays silent with the setting off, the page hidden, or no vibrate at all', () => {
    const calls: number[][] = [];
    let on = false;
    let visible = true;
    const h = createHaptics({ enabled: () => on, vibrate: (p) => calls.push(p.slice()), visible: () => visible });
    h.frame(sim(BAIL), game(), 0.016);
    on = true;
    visible = false;
    h.frame(sim(BAIL), game(), 0.016);
    expect(calls).toEqual([]);
    const none = createHaptics({ enabled: () => true, vibrate: null, visible: () => true });
    expect(() => none.frame(sim(BAIL), game(), 0.016)).not.toThrow();
    expect(none.supported).toBe(false);
    expect(none.last).toBe('');
  });
});
