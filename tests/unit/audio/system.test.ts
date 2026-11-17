import { describe, expect, it } from 'vitest';
import { createAudio } from '../../../src/audio/index';
import { Mode } from '../../../src/sim/types';
import { fakeLines, flyingView, hitchedView, view } from './helpers';

describe('createAudio without Web Audio (Node)', () => {
  it('is inert but safe, and debug() still follows the mixer', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const lines = fakeLines([
      [1, 0],
      [1, 3],
      [3, 2],
    ]);
    const a = createAudio();
    expect(() => a.unlock()).not.toThrow();
    expect(() => a.unlock()).not.toThrow();
    expect(() => a.setMuted(true)).not.toThrow();
    expect(() => a.setVolumes(0.5, 0.7)).not.toThrow();
    for (const name of ['tick', 'punch', 'ink', 'fanfare', 'deny'] as const) expect(() => a.ui(name)).not.toThrow();

    expect(a.debug().running).toBe(false);
    expect(a.debug().track).toBeNull();

    a.update(hitchedView(0, 1), [{ type: 'hitch', line: 0, vehicle: 0, chain: 1, newLink: true }], lines, 1 / 60);
    let d = a.debug();
    expect(d.running).toBe(false);
    expect(d.track).toBe(1);
    expect(d.stemTargets).toEqual([1, 0, 0, 0]);

    a.update(flyingView(1), [{ type: 'release', line: 0, vehicle: 0, speed: 10, chain: 1, hop: false }], lines, 1 / 60);
    a.update(hitchedView(1, 2), [{ type: 'hitch', line: 1, vehicle: 0, chain: 2, newLink: true }], lines, 1 / 60);
    expect(a.debug().stemTargets).toEqual([1, 0, 0, 1]);
    a.update(flyingView(2), [{ type: 'release', line: 1, vehicle: 0, speed: 10, chain: 2, hop: false }], lines, 1 / 60);
    a.update(hitchedView(2, 3), [{ type: 'hitch', line: 2, vehicle: 0, chain: 3, newLink: true }], lines, 1 / 60);
    d = a.debug();
    expect(d.track).toBe(3);
    expect(d.fullBand).toBe(true);
    expect(d.stemTargets).toEqual([1, 1, 1, 1]);

    a.update(view({ mode: Mode.BAIL, speed: 9 }), [{ type: 'bail', reason: 'impact' }], lines, 1 / 60);
    d = a.debug();
    expect(d.stemTargets).toEqual([0, 0, 0, 0]);
    expect(d.wheelLevel).toBeGreaterThan(0);
    expect(d.voices).toBe(0);

    expect(() => a.dispose()).not.toThrow();
    expect(() => a.update(view(), [], lines, 1 / 60)).not.toThrow();
    expect(() => a.unlock()).not.toThrow();
    expect(a.debug().running).toBe(false);
  });
});
