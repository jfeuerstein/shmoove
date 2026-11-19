import { describe, expect, it } from 'vitest';
import {
  collectOverrides,
  DEFAULT_MUSIC_VOLUME,
  overridesText,
  parseStored,
  Settings,
  STORAGE_KEY,
  type FeelValues,
  type StorageLike,
} from '../../src/app/settings';
import { FEEL_DEFS, FEEL_KEYS } from '../../src/sim/constants';

function defaults(): FeelValues {
  const f = {} as FeelValues;
  for (const k of FEEL_KEYS) f[k] = FEEL_DEFS[k].v;
  return f;
}

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
};

describe('settings', () => {
  it('round trips the scheme and changed values through storage', () => {
    const store = memoryStorage();
    const feel = defaults();
    const a = new Settings(store, '', 'tuck', feel);
    feel.runSpeed = 7.5;
    feel.grip = 20;
    a.saveFeel();
    a.chooseScheme('swipe');

    const feel2 = defaults();
    const b = new Settings(store, '', 'tuck', feel2);
    b.applySaved();
    expect(b.scheme).toBe('swipe');
    expect(feel2.runSpeed).toBe(7.5);
    expect(feel2.grip).toBe(20);
    expect(feel2.gravity).toBe(FEEL_DEFS.gravity.v);
  });

  it('clamps stored values to each constant range', () => {
    const raw = JSON.stringify({ v: 1, feel: { runSpeed: 9999, grip: -5, gravity: 30 } });
    const s = parseStored(raw);
    expect(s.feel.runSpeed).toBe(FEEL_DEFS.runSpeed.max);
    expect(s.feel.grip).toBe(FEEL_DEFS.grip.min);
    expect(s.feel.gravity).toBe(30);
  });

  it('ignores unknown keys, non-numbers and inherited names', () => {
    const raw = '{"v":1,"scheme":"bogus","feel":{"nope":3,"runSpeed":"fast","grip":null,"toString":5,"gravity":30}}';
    const s = parseStored(raw);
    expect(s.scheme).toBeNull();
    expect(Object.keys(s.feel)).toEqual(['gravity']);
  });

  it('survives corrupt, wrong-shape and wrong-version storage', () => {
    for (const raw of ['{oops', '', 'null', '42', '[]', '{"v":2,"feel":{"runSpeed":8}}', '{"feel":{"runSpeed":8}}']) {
      const s = parseStored(raw);
      expect(s.scheme).toBeNull();
      expect(s.feel).toEqual({});
    }
    const feel = defaults();
    const st = new Settings(memoryStorage('{oops'), '', 'lift', feel);
    st.applySaved();
    expect(st.scheme).toBe('lift');
    expect(feel).toEqual(defaults());
  });

  it('works with storage that throws or is missing', () => {
    for (const store of [throwing, null]) {
      const feel = defaults();
      const st = new Settings(store, '', 'tuck', feel);
      st.applySaved();
      feel.runSpeed = 8;
      expect(() => st.saveFeel()).not.toThrow();
      expect(() => st.chooseScheme('lift')).not.toThrow();
      expect(st.scheme).toBe('lift');
      expect(feel.runSpeed).toBe(8);
    }
  });

  it('lets ?scheme= win over the saved scheme, and the fallback lose to it', () => {
    const store = memoryStorage(JSON.stringify({ v: 1, scheme: 'lift', feel: {} }));
    expect(new Settings(store, '', 'tuck', defaults()).scheme).toBe('lift');
    expect(new Settings(store, '?debug&scheme=swipe', 'tuck', defaults()).scheme).toBe('swipe');
    expect(new Settings(store, '?scheme=bogus', 'tuck', defaults()).scheme).toBe('lift');
    expect(new Settings(memoryStorage(), '', 'tuck', defaults()).scheme).toBe('tuck');
  });

  it('keeps the saved scheme when the URL overrides it for one visit', () => {
    const store = memoryStorage(JSON.stringify({ v: 1, scheme: 'lift', feel: {} }));
    const feel = defaults();
    const st = new Settings(store, '?scheme=swipe', 'tuck', feel);
    feel.grip = 20;
    st.saveFeel();
    expect(new Settings(store, '', 'tuck', defaults()).scheme).toBe('lift');
  });

  it('stores only values that differ from the defaults', () => {
    const store = memoryStorage();
    const feel = defaults();
    const st = new Settings(store, '', 'tuck', feel);
    feel.runSpeed = 7;
    st.saveFeel();
    const saved = JSON.parse(store.data.get(STORAGE_KEY) ?? '{}') as { feel: Record<string, number> };
    expect(saved.feel).toEqual({ runSpeed: 7 });
    feel.runSpeed = FEEL_DEFS.runSpeed.v;
    st.saveFeel();
    const cleared = JSON.parse(store.data.get(STORAGE_KEY) ?? '{}') as { feel: Record<string, number> };
    expect(cleared.feel).toEqual({});
    expect(collectOverrides(defaults())).toEqual({});
  });

  it('writes the overrides as key = value lines', () => {
    const feel = defaults();
    expect(overridesText(feel)).toBe('(no changes from the defaults)');
    feel.runSpeed = 7.5;
    feel.grip = 20;
    expect(overridesText(feel, 'lift')).toBe('scheme = lift\nrunSpeed = 7.5\ngrip = 20');
  });

  it('keeps auto-pick off unless it was switched on, and remembers it', () => {
    const store = memoryStorage();
    const feel = defaults();
    const a = new Settings(store, '', 'tuck', feel);
    expect(a.autoPick).toBe(false);
    a.chooseAutoPick(true);
    expect(new Settings(store, '', 'tuck', defaults()).autoPick).toBe(true);
    // A feel save does not lose it.
    feel.grip = 20;
    a.saveFeel();
    expect(new Settings(store, '', 'tuck', defaults()).autoPick).toBe(true);
    a.chooseAutoPick(false);
    expect(new Settings(store, '', 'tuck', defaults()).autoPick).toBe(false);
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, autoPick: 'yes' })).autoPick).toBe(false);
  });

  it('remembers that the lesson is done, and lets it be cleared', () => {
    const store = memoryStorage();
    const feel = defaults();
    const a = new Settings(store, '', 'tuck', feel);
    expect(a.lessonDone).toBe(false);
    a.chooseLessonDone(true);
    expect(new Settings(store, '', 'tuck', defaults()).lessonDone).toBe(true);
    // Other saves do not lose it.
    feel.grip = 20;
    a.saveFeel();
    a.chooseAutoPick(true);
    expect(new Settings(store, '', 'tuck', defaults()).lessonDone).toBe(true);
    a.chooseLessonDone(false);
    expect(new Settings(store, '', 'tuck', defaults()).lessonDone).toBe(false);
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, lessonDone: 'yes' })).lessonDone).toBe(false);
  });

  it('has haptics on by default, remembers a change, and keeps it through other saves', () => {
    const store = memoryStorage();
    const a = new Settings(store, '', 'tuck', defaults());
    expect(a.haptics).toBe(true);
    a.chooseHaptics(false);
    a.chooseAutoPick(true);
    expect(new Settings(store, '', 'tuck', defaults()).haptics).toBe(false);
    a.chooseHaptics(true);
    expect(new Settings(store, '', 'tuck', defaults()).haptics).toBe(true);
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, haptics: 'no' })).haptics).toBe(true);
  });

  it('has reduced motion off unless the browser asks, then the saved choice wins', () => {
    const store = memoryStorage();
    expect(new Settings(store, '', 'tuck', defaults()).reducedMotion).toBe(false);
    const b = new Settings(store, '', 'tuck', defaults(), true);
    expect(b.reducedMotion).toBe(true);
    b.chooseReducedMotion(false);
    expect(new Settings(store, '', 'tuck', defaults(), true).reducedMotion).toBe(false);
    b.chooseReducedMotion(true);
    expect(new Settings(store, '', 'tuck', defaults(), false).reducedMotion).toBe(true);
  });

  it('keeps the sound on at the default volume unless changed, and remembers the switch and the volume', () => {
    const store = memoryStorage();
    const feel = defaults();
    const a = new Settings(store, '', 'tuck', feel);
    expect(a.mute).toBe(false);
    expect(a.musicVolume).toBe(DEFAULT_MUSIC_VOLUME);
    a.chooseSound(true, 0.4);
    const b = new Settings(store, '', 'tuck', defaults());
    expect(b.mute).toBe(true);
    expect(b.musicVolume).toBeCloseTo(0.4, 9);
    // Other saves do not lose it.
    feel.grip = 20;
    a.saveFeel();
    a.chooseAutoPick(true);
    a.chooseLessonDone(true);
    expect(new Settings(store, '', 'tuck', defaults()).mute).toBe(true);
    a.chooseSound(false, 0.4);
    expect(new Settings(store, '', 'tuck', defaults()).mute).toBe(false);
    expect(new Settings(store, '', 'tuck', defaults()).musicVolume).toBeCloseTo(0.4, 9);
  });

  it('reads bad sound settings as the defaults, and clamps the volume', () => {
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, sound: { mute: 'yes', music: 'loud' } })).sound).toEqual({ mute: false, music: DEFAULT_MUSIC_VOLUME });
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, sound: { mute: true, music: 3 } })).sound).toEqual({ mute: true, music: 1 });
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, sound: { music: -1 } })).sound).toEqual({ mute: false, music: 0 });
    expect(parseStored(JSON.stringify({ v: 1, feel: {}, sound: null })).sound).toEqual({ mute: false, music: DEFAULT_MUSIC_VOLUME });
    const s = new Settings(memoryStorage(), '', 'tuck', defaults());
    s.chooseSound(false, Number.NaN);
    expect(s.musicVolume).toBe(DEFAULT_MUSIC_VOLUME);
  });

  it('runs without storage: the lesson is simply not remembered', () => {
    const s = new Settings(null, '', 'tuck', defaults());
    s.chooseLessonDone(true);
    expect(s.lessonDone).toBe(true);
  });
});
