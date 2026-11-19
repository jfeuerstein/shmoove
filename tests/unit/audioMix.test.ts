import { describe, expect, it } from 'vitest';
import { fadeLevel, StemMixer, stemTarget, stemTargets } from '../../src/audio/mix';
import { HALF_BAR, STEM_BASS, STEM_COUNT, STEM_DRUMS, STEM_GUITAR, STEM_HORNS, STEM_KEYS } from '../../src/audio/music';

describe('stems by gear', () => {
  it('adds one stem a gear: drums, bass, keys, guitar, horns', () => {
    const order = [STEM_DRUMS, STEM_BASS, STEM_KEYS, STEM_GUITAR, STEM_HORNS];
    for (let gear = 1; gear <= 5; gear++) {
      const out = new Float32Array(STEM_COUNT);
      stemTargets(gear, out);
      for (let k = 0; k < order.length; k++) expect(out[order[k]], `gear ${gear} stem ${order[k]}`).toBe(k < gear ? 1 : 0);
    }
    // Gear 1 is the drums alone; out-of-range gears clamp.
    expect(stemTarget(0, STEM_DRUMS)).toBe(1);
    expect(stemTarget(0, STEM_BASS)).toBe(0);
    expect(stemTarget(9, STEM_HORNS)).toBe(1);
  });

  it('fades linearly over the given time', () => {
    expect(fadeLevel(0, 1, 10, 2, 9)).toBe(0);
    expect(fadeLevel(0, 1, 10, 2, 11)).toBeCloseTo(0.5, 9);
    expect(fadeLevel(0, 1, 10, 2, 12)).toBe(1);
    expect(fadeLevel(1, 0, 10, 2, 13)).toBe(0);
    expect(fadeLevel(0.3, 1, 0, 0, 0.0001)).toBe(1);
  });

  it('fades a stem in and out over half a bar, never jumping', () => {
    const mix = new StemMixer();
    expect(mix.fade).toBeCloseTo(HALF_BAR, 9);
    const changed = mix.setGear(3, 0);
    expect(changed).toBe((1 << STEM_DRUMS) | (1 << STEM_BASS) | (1 << STEM_KEYS));
    expect(mix.level(STEM_KEYS, 0)).toBe(0);
    expect(mix.level(STEM_KEYS, HALF_BAR / 2)).toBeCloseTo(0.5, 6);
    expect(mix.level(STEM_KEYS, HALF_BAR)).toBe(1);
    expect(mix.level(STEM_GUITAR, HALF_BAR)).toBe(0);

    // Down a gear halfway through a fade in: it turns round from where it is, not from full.
    mix.setGear(1, 0);
    mix.setGear(2, 10);
    const mid = 10 + HALF_BAR / 2;
    expect(mix.level(STEM_BASS, mid)).toBeCloseTo(0.5, 6);
    const back = mix.setGear(1, mid);
    expect(back).toBe(1 << STEM_BASS);
    expect(mix.level(STEM_BASS, mid)).toBeCloseTo(0.5, 6);
    // Every fade takes half a bar, from wherever it starts.
    expect(mix.level(STEM_BASS, mid + HALF_BAR / 2)).toBeCloseTo(0.25, 6);
    expect(mix.level(STEM_BASS, mid + HALF_BAR)).toBe(0);

    // Sampled finely through any sequence of gear changes, no step between samples is bigger
    // than a linear half-bar fade allows.
    const m2 = new StemMixer();
    const dt = 0.01;
    const prev = new Float32Array(STEM_COUNT);
    const gears = [1, 5, 2, 4, 1, 3, 5, 1];
    for (let t = 0, k = 0; t < 12; t += dt, k++) {
      if (k % 70 === 0) m2.setGear(gears[(k / 70) % gears.length], t);
      for (let s = 0; s < STEM_COUNT; s++) {
        const v = m2.level(s, t);
        expect(Math.abs(v - prev[s])).toBeLessThanOrEqual(dt / HALF_BAR + 1e-6);
        prev[s] = v;
      }
    }
  });

  it('a stem is worth scheduling while it sounds or is fading in', () => {
    const mix = new StemMixer();
    mix.setGear(2, 0);
    expect(mix.audible(STEM_BASS, 0)).toBe(true);
    expect(mix.audible(STEM_KEYS, 0)).toBe(false);
    mix.setGear(1, 5);
    expect(mix.audible(STEM_BASS, 5 + HALF_BAR / 2)).toBe(true);
    expect(mix.audible(STEM_BASS, 5 + HALF_BAR + 0.01)).toBe(false);
  });
});
