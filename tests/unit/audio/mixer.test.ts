import { describe, expect, it } from 'vitest';
import { BAIL_FADE, Mixer, PAUSE_FADE, wheelLevelFor } from '../../../src/audio/mixer';
import { barSeconds, beatSeconds, scaleNote, TRACKS } from '../../../src/audio/tracks/index';
import { Mode, type SimEvent } from '../../../src/sim/types';
import { Surface } from '../../../src/sim/world';
import { fakeLines, flyingView, hitchedView, view } from './helpers';

const DT = 1 / 60;

// Lines: 0 Terraces bass, 1 Terraces harmony, 2 Terraces lead, 3 Docks perc, 4 Terraces perc.
const LINES = fakeLines([
  [2, 1],
  [2, 2],
  [2, 3],
  [0, 0],
  [2, 0],
]);

function hitch(line: number, chain: number, newLink = true): SimEvent {
  return { type: 'hitch', line, vehicle: 0, chain, newLink };
}
function release(line: number, chain: number, speed = 12): SimEvent {
  return { type: 'release', line, vehicle: 0, speed, chain, hop: false };
}

/** Hitch link 1 on line 0, release, catch link 2 on line 1, release, catch link 3 on line 2. */
function buildChain(m: Mixer, links: number): void {
  const order = [0, 1, 2];
  for (let i = 0; i < links; i++) {
    const line = order[i];
    m.update(hitchedView(line, i + 1), [hitch(line, i + 1)], LINES, DT);
    m.update(hitchedView(line, i + 1), [], LINES, DT);
    if (i < links - 1) {
      m.update(flyingView(i + 1), [release(line, i + 1)], LINES, DT);
      m.update(flyingView(i + 1), [], LINES, DT);
    }
  }
}

describe('mixer: stems follow hitch, chain and bail', () => {
  it('starts silent with no track', () => {
    const m = new Mixer();
    const s = m.update(view(), [], LINES, DT);
    expect(s.track).toBeNull();
    expect(s.stemTargets).toEqual([0, 0, 0, 0]);
  });

  it('a first hitch selects the line district track and only its stem', () => {
    const m = new Mixer();
    const s = m.update(hitchedView(0, 1), [hitch(0, 1)], LINES, DT);
    expect(s.track).toBe(2);
    expect(s.stemTargets).toEqual([0, 1, 0, 0]);
    expect(s.fullBand).toBe(false);
  });

  it('a second link on the same district adds its stem; a third brings in the full band', () => {
    const m = new Mixer();
    buildChain(m, 2);
    expect(m.state.track).toBe(2);
    expect(m.state.stemTargets).toEqual([0, 1, 1, 0]);
    expect(m.state.fullBand).toBe(false);
    buildChain(new Mixer(), 1);
    const m3 = new Mixer();
    buildChain(m3, 3);
    expect(m3.state.fullBand).toBe(true);
    expect(m3.state.stemTargets).toEqual([1, 1, 1, 1]);
  });

  it('released and flying with the chain alive keeps the stems', () => {
    const m = new Mixer();
    buildChain(m, 2);
    m.update(flyingView(2), [release(1, 2)], LINES, DT);
    for (let i = 0; i < 90; i++) m.update(flyingView(2), [], LINES, DT);
    expect(m.state.stemTargets).toEqual([0, 1, 1, 0]);
    expect(m.state.track).toBe(2);
  });

  it('a chain ended by landing fades every stem out over two bars', () => {
    const m = new Mixer();
    buildChain(m, 3);
    m.update(flyingView(3), [release(2, 3)], LINES, DT);
    const s = m.update(view(), [{ type: 'land', impact: 3, surface: Surface.STREET }, { type: 'chainEnd', chain: 3, reason: 'land' }], LINES, DT);
    expect(s.stemTargets).toEqual([0, 0, 0, 0]);
    expect(s.fullBand).toBe(false);
    const twoBars = 2 * barSeconds(TRACKS[2].bpm);
    for (const f of s.stemFades) expect(f).toBeCloseTo(twoBars, 6);
  });

  it('a release followed by the chain lapsing (no chainEnd seen) also fades out over two bars', () => {
    const m = new Mixer();
    buildChain(m, 1);
    m.update(flyingView(1), [release(0, 1)], LINES, DT);
    const s = m.update(view({ chain: 0, chainAlive: false }), [], LINES, DT);
    expect(s.stemTargets).toEqual([0, 0, 0, 0]);
    expect(s.stemFades[1]).toBeCloseTo(2 * barSeconds(TRACKS[2].bpm), 6);
  });

  it('bail cuts the music within 60 ms and it stays off until the next hitch', () => {
    const m = new Mixer();
    buildChain(m, 3);
    const s = m.update(view({ mode: Mode.BAIL }), [{ type: 'chainEnd', chain: 3, reason: 'bail' }, { type: 'bail', reason: 'wall' }], LINES, DT);
    expect(s.stemTargets).toEqual([0, 0, 0, 0]);
    for (const f of s.stemFades) expect(f).toBeLessThanOrEqual(0.06);
    expect(BAIL_FADE).toBeLessThanOrEqual(0.06);
    expect(s.musicOn).toBe(false);
    expect(s.cues.some((c) => c.type === 'bail')).toBe(true);
    // Recover, roll around, hop, land: still silent.
    const quiet: SimEvent[][] = [[{ type: 'recover' }], [{ type: 'hop' }], [{ type: 'land', impact: 2, surface: Surface.PLAZA }], []];
    for (const evs of quiet) {
      m.update(view(), evs, LINES, DT);
      expect(m.state.stemTargets).toEqual([0, 0, 0, 0]);
    }
    // The next hitch brings music back with exactly that line's stem.
    m.update(hitchedView(1, 1), [hitch(1, 1)], LINES, DT);
    expect(m.state.stemTargets).toEqual([0, 0, 1, 0]);
    expect(m.state.musicOn).toBe(true);
  });

  it('a hitch on another district switches track, cross-fades over one beat and resets stems', () => {
    const m = new Mixer();
    buildChain(m, 2);
    const gen = m.state.trackGen;
    m.update(flyingView(2), [release(1, 2)], LINES, DT);
    const s = m.update(hitchedView(3, 3), [hitch(3, 3)], LINES, DT);
    expect(s.track).toBe(0);
    expect(s.trackGen).toBe(gen + 1);
    expect(s.trackFade).toBeCloseTo(beatSeconds(TRACKS[0].bpm), 6);
    // Third link: full band of the new track.
    expect(s.stemTargets).toEqual([1, 1, 1, 1]);

    const m2 = new Mixer();
    buildChain(m2, 1);
    m2.update(flyingView(1), [release(0, 1)], LINES, DT);
    const s2 = m2.update(hitchedView(3, 2), [hitch(3, 2)], LINES, DT);
    expect(s2.track).toBe(0);
    expect(s2.stemTargets).toEqual([1, 0, 0, 0]);
  });

  it('only the most recent hitch track plays, and a fresh first link starts with exactly one stem', () => {
    const m = new Mixer();
    buildChain(m, 2);
    m.update(view(), [{ type: 'chainEnd', chain: 2, reason: 'land' }], LINES, DT);
    const s = m.update(hitchedView(4, 1), [hitch(4, 1)], LINES, DT);
    expect(s.track).toBe(2);
    expect(s.stemTargets).toEqual([1, 0, 0, 0]);
  });

  it('re-latching the same vehicle (no new link) keeps the stem set', () => {
    const m = new Mixer();
    buildChain(m, 2);
    m.update(flyingView(2), [release(1, 2)], LINES, DT);
    const s = m.update(hitchedView(1, 2), [hitch(1, 2, false)], LINES, DT);
    expect(s.stemTargets).toEqual([0, 1, 1, 0]);
  });

  it('pausing ducks everything over 150 ms and holds the transport, without forgetting the stems', () => {
    const m = new Mixer();
    buildChain(m, 2);
    const s = m.update(hitchedView(1, 2, { paused: true }), [], LINES, DT);
    expect(s.master).toBe(0);
    expect(s.masterFade).toBeCloseTo(PAUSE_FADE, 6);
    expect(PAUSE_FADE).toBeCloseTo(0.15, 6);
    expect(s.hold).toBe(true);
    const r = m.update(hitchedView(1, 2), [], LINES, DT);
    expect(r.master).toBe(1);
    expect(r.hold).toBe(false);
    expect(r.stemTargets).toEqual([0, 1, 1, 0]);
  });
});

describe('mixer: noise layer and cues', () => {
  it('wheel level rises monotonically with speed on the ground and is 0 in the air', () => {
    const m = new Mixer();
    let prev = -1;
    for (let v = 0; v <= 34; v += 0.5) {
      const lvl = m.update(view({ speed: v }), [], LINES, DT).wheelLevel;
      expect(lvl).toBeGreaterThan(prev);
      expect(lvl).toBeLessThanOrEqual(1);
      prev = lvl;
    }
    expect(m.update(view({ speed: 0 }), [], LINES, DT).wheelLevel).toBe(0);
    for (const v of [0, 5, 20, 34]) {
      expect(m.update(view({ mode: Mode.AIR, surface: -1, speed: v }), [], LINES, DT).wheelLevel).toBe(0);
    }
    expect(wheelLevelFor(10)).toBeGreaterThan(wheelLevelFor(5));
  });

  it('cutoff rises with speed, grass and dirt are duller, stairs clatter at a speed-tied rate', () => {
    const m = new Mixer();
    const slow = m.update(view({ speed: 3 }), [], LINES, DT).wheelCutoff;
    const fast = m.update(view({ speed: 15 }), [], LINES, DT).wheelCutoff;
    expect(fast).toBeGreaterThan(slow);
    const street = m.update(view({ speed: 10 }), [], LINES, DT).wheelCutoff;
    expect(m.update(view({ speed: 10, surface: Surface.GRASS }), [], LINES, DT).wheelCutoff).toBeLessThan(street);
    expect(m.update(view({ speed: 10, surface: Surface.DIRT }), [], LINES, DT).wheelCutoff).toBeLessThan(street);
    const st1 = m.update(view({ speed: 3, surface: Surface.STAIRS }), [], LINES, DT);
    expect(st1.clatterDepth).toBeGreaterThan(0);
    const r1 = st1.clatterRate;
    const r2 = m.update(view({ speed: 6, surface: Surface.STAIRS }), [], LINES, DT).clatterRate;
    expect(r2).toBeGreaterThan(r1);
    expect(m.update(view({ speed: 6 }), [], LINES, DT).clatterDepth).toBe(0);
  });

  it('wind rises with speed in the air and is always a little present on Antenna Hill', () => {
    const m = new Mixer();
    const a = m.update(view({ mode: Mode.AIR, surface: -1, speed: 5 }), [], LINES, DT).windLevel;
    const b = m.update(view({ mode: Mode.AIR, surface: -1, speed: 20 }), [], LINES, DT).windLevel;
    expect(b).toBeGreaterThan(a);
    expect(m.update(view({ speed: 0, district: 3 }), [], LINES, DT).windLevel).toBeGreaterThan(0);
    expect(m.update(view({ speed: 0, district: 1 }), [], LINES, DT).windLevel).toBe(0);
  });

  it('ride motors within 25 m, louder when closer, with a timbre class per vehicle kind', () => {
    const m = new Mixer();
    expect(m.update(view({ nearRideDist: 30, nearRideKind: 'tram' }), [], LINES, DT).motorLevel).toBe(0);
    // The state object is reused frame to frame: copy what we compare.
    const far = { ...m.update(view({ nearRideDist: 20, nearRideKind: 'tram' }), [], LINES, DT) };
    expect(far.motorKind).toBe('rail');
    expect(far.motorLevel).toBeGreaterThan(0);
    const near = { ...m.update(view({ nearRideDist: 5, nearRideKind: 'truck' }), [], LINES, DT) };
    expect(near.motorKind).toBe('engine');
    expect(near.motorLevel).toBeGreaterThan(far.motorLevel);
    expect(m.update(view({ nearRideDist: 5, nearRideKind: 'cablecar' }), [], LINES, DT).motorKind).toBe('hum');
    expect(m.update(view({ nearRideDist: 5, nearRideKind: 'kite' }), [], LINES, DT).motorKind).toBe('hum');
    expect(m.update(view({ nearRideDist: 5, nearRideKind: 'funicular' }), [], LINES, DT).motorKind).toBe('rail');
  });

  it('turns events into one-shot cues', () => {
    const m = new Mixer();
    const types = (evs: SimEvent[], v = view()) => m.update(v, evs, LINES, DT).cues.map((c) => c.type);
    expect(types([{ type: 'hop' }])).toEqual(['hop']);
    expect(types([{ type: 'land', impact: 4, surface: Surface.STREET }])).toEqual(['land']);
    expect(types([{ type: 'land', impact: 4, surface: Surface.AWNING }])).toEqual(['boing']);
    expect(types([{ type: 'bounce', speed: 6 }])).toEqual(['boing']);
    expect(types([{ type: 'wallStart' }, { type: 'wallEnd', jumped: true, topped: false }])).toEqual(['scuff', 'scuff']);
    expect(types([{ type: 'kickturn' }])).toEqual(['scuff']);
    expect(types([{ type: 'denied', line: 0, need: 4 }])).toEqual(['denied']);
    expect(types([])).toEqual([]);
  });

  it('a release plays the nth scale note of the current track for link n', () => {
    const m = new Mixer();
    buildChain(m, 1);
    const c1 = m.update(flyingView(1), [release(0, 1)], LINES, DT).cues.find((c) => c.type === 'release');
    buildChain(m, 2);
    const c2 = m.update(flyingView(2), [release(1, 2)], LINES, DT).cues.find((c) => c.type === 'release');
    expect(c1?.type === 'release' && c1.note).toBe(scaleNote(TRACKS[2], 1));
    expect(c2?.type === 'release' && c2.note).toBe(scaleNote(TRACKS[2], 2));
    // G major: tonic then a whole step up.
    expect(scaleNote(TRACKS[2], 2) - scaleNote(TRACKS[2], 1)).toBe(2);
    expect(scaleNote(TRACKS[2], 8) - scaleNote(TRACKS[2], 1)).toBe(12);
  });

  it('non-finite view numbers never produce non-finite levels (they would kill the Web Audio engine)', () => {
    const m = new Mixer();
    const s = m.update(view({ speed: NaN, dayFrac: NaN, nearRideDist: NaN, nearRideKind: 'tram' }), [], LINES, DT);
    for (const k of ['wheelLevel', 'wheelCutoff', 'clatterRate', 'windLevel', 'windFreq', 'motorLevel', 'grindPitch', 'daylight'] as const) {
      expect(Number.isFinite(s[k])).toBe(true);
    }
  });

  it('grinds sustain between grindStart and grindEnd, pitch following speed', () => {
    const m = new Mixer();
    const g = view({ mode: Mode.GRIND, surface: -1, speed: 8 });
    expect(m.update(g, [{ type: 'grindStart', rail: 0 }], LINES, DT).grinding).toBe(true);
    const p1 = m.update(g, [], LINES, DT).grindPitch;
    const p2 = m.update({ ...g, speed: 16 }, [], LINES, DT).grindPitch;
    expect(m.state.grinding).toBe(true);
    expect(p2).toBeGreaterThan(p1);
    expect(m.update(view({ mode: Mode.AIR, surface: -1 }), [{ type: 'grindEnd', rail: 0 }], LINES, DT).grinding).toBe(false);
  });
});
