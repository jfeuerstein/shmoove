import { describe, expect, it } from 'vitest';
import { pentatonic } from '../../src/audio/music';
import {
  DIE_BURST,
  DIE_RATE,
  END_CADENCE,
  END_FALL,
  END_NONE,
  HIT_BURST,
  HIT_RATE,
  makeSfxFrame,
  SCALE_TOP,
  SfxMapper,
  SND_ARC,
  SND_BLAST,
  SND_BOOST,
  SND_BOSS_DOWN,
  SND_BOSS_IN,
  SND_CARD,
  SND_DEAD,
  SND_DIE,
  SND_GRIND_OFF,
  SND_GRIND_ON,
  SND_HEAL,
  SND_HIT,
  SND_HOP,
  SND_HURT,
  SND_LAND,
  SND_LEVEL,
  SND_OLLIE,
  SND_POP,
  SND_SHOT,
  SND_SLAM,
  SND_SPARK,
  SND_STONE,
  SND_THING,
  SND_TOKEN,
  SND_WON,
  WEAPON_GAIN,
  type MoverSound,
  type SfxFrame,
} from '../../src/audio/sfx';
import { EV_BOOST, EV_CLEAN_HOP, EV_GRIND_END, EV_GRIND_START, EV_HOP, EV_LAND } from '../../src/sim/types';
import {
  FX_ARC,
  FX_BLAST,
  FX_BOSS_DOWN,
  FX_BOSS_IN,
  FX_CARD,
  FX_ENEMY_DIE,
  FX_ENEMY_HIT,
  FX_HEAL,
  FX_LEVEL_UP,
  FX_PLAYER_HIT,
  FX_POP,
  FX_SHOT,
  FX_SLAM,
  FX_SPARK,
  FX_STONE,
  FX_THING,
  FX_TOKEN,
  PHASE_CHOOSE,
  PHASE_DEAD,
  PHASE_PLAY,
  PHASE_WON,
  type Fx,
} from '../../src/sim/world';

function makeFx(): Fx {
  return { count: 0, type: new Uint8Array(256), x: new Float32Array(256), y: new Float32Array(256), z: new Float32Array(256), a: new Float32Array(256) };
}

function fxOf(...list: [number, number][]): Fx {
  const f = makeFx();
  for (const [type, a] of list) {
    f.type[f.count] = type;
    f.a[f.count] = a;
    f.count++;
  }
  return f;
}

const NONE = makeFx();

function mover(over: Partial<MoverSound> = {}): MoverSound {
  return { speed: 10, grounded: true, rail: -1, chain: 0, impact: 0, ...over };
}

function kinds(f: SfxFrame): number[] {
  return Array.from(f.kind.subarray(0, f.count));
}

function one(f: SfxFrame, kind: number): { gain: number; pitch: number } | null {
  for (let i = 0; i < f.count; i++) if (f.kind[i] === kind) return { gain: f.gain[i], pitch: f.pitch[i] };
  return null;
}

describe('the effects mapping', () => {
  it('a hop pops; an ollie in a chain climbs the scale one step per ollie', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, EV_HOP, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_HOP]);
    let last = -Infinity;
    for (let chain = 1; chain <= 6; chain++) {
      m.map(NONE, EV_HOP | EV_CLEAN_HOP, mover({ chain }), PHASE_PLAY, f);
      expect(kinds(f)).toEqual([SND_OLLIE]);
      const p = f.pitch[0];
      expect(p).toBe(pentatonic(chain));
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    // A long chain stops climbing at the top of the scale.
    m.map(NONE, EV_HOP | EV_CLEAN_HOP, mover({ chain: 99 }), PHASE_PLAY, f);
    expect(f.pitch[0]).toBe(pentatonic(SCALE_TOP));
  });

  it('a landing thuds, louder and lower the harder it lands', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, EV_LAND, mover({ impact: 1 }), PHASE_PLAY, f);
    const soft = one(f, SND_LAND);
    m.map(NONE, EV_LAND, mover({ impact: 8 }), PHASE_PLAY, f);
    const hard = one(f, SND_LAND);
    expect(soft && hard).toBeTruthy();
    if (soft && hard) {
      expect(hard.gain).toBeGreaterThan(soft.gain);
      expect(hard.pitch).toBeLessThan(soft.pitch);
      expect(hard.gain).toBeLessThanOrEqual(1);
    }
  });

  it('a grind hisses for exactly as long as it lasts, with a clank in and a scrape out', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, EV_GRIND_START, mover({ rail: 2, grounded: false }), PHASE_PLAY, f);
    expect(kinds(f)).toContain(SND_GRIND_ON);
    expect(f.grind).toBe(true);
    for (let i = 0; i < 30; i++) {
      m.map(NONE, 0, mover({ rail: 2, grounded: false }), PHASE_PLAY, f);
      expect(f.grind).toBe(true);
      expect(f.count).toBe(0);
    }
    m.map(NONE, EV_GRIND_END, mover({ rail: -1, grounded: false }), PHASE_PLAY, f);
    expect(kinds(f)).toContain(SND_GRIND_OFF);
    expect(f.grind).toBe(false);
  });

  it('a boost pad whooshes', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, EV_BOOST, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_BOOST]);
  });

  it('the board hums while it rolls, higher the faster, and not in the air or on a rail', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, 0, mover({ speed: 6 }), PHASE_PLAY, f);
    const slow = { hum: f.hum, hz: f.humFreq };
    m.map(NONE, 0, mover({ speed: 20 }), PHASE_PLAY, f);
    expect(f.hum).toBeGreaterThan(slow.hum);
    expect(f.humFreq).toBeGreaterThan(slow.hz);
    m.map(NONE, 0, mover({ speed: 0 }), PHASE_PLAY, f);
    expect(f.hum).toBe(0);
    m.map(NONE, 0, mover({ speed: 20, grounded: false }), PHASE_PLAY, f);
    expect(f.hum).toBe(0);
    m.map(NONE, 0, mover({ speed: 20, grounded: false, rail: 0 }), PHASE_PLAY, f);
    expect(f.hum).toBe(0);
    m.map(NONE, 0, mover({ speed: 20 }), PHASE_CHOOSE, f);
    expect(f.hum).toBe(0);
  });

  it('a hit on the player is a hard hit and drops the music for a beat', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(fxOf([FX_PLAYER_HIT, 12]), 0, mover(), PHASE_PLAY, f);
    const h = one(f, SND_HURT);
    expect(h).not.toBeNull();
    expect(h && h.gain).toBeGreaterThanOrEqual(0.7);
    expect(f.dropout).toBe(true);
    m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.dropout).toBe(false);
  });

  it('enemy hits tick and deaths crunch, each on its own rate limit', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(fxOf([FX_ENEMY_HIT, 5]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_HIT]);
    m.map(fxOf([FX_ENEMY_DIE, 0]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_DIE]);

    // 120 hits and 120 deaths a second for three seconds: a texture, not a wall.
    const busy = fxOf([FX_ENEMY_HIT, 5], [FX_ENEMY_HIT, 5], [FX_ENEMY_DIE, 0], [FX_ENEMY_DIE, 1]);
    const m2 = new SfxMapper();
    let hits = 0;
    let dies = 0;
    const perSecond: number[] = [];
    for (let t = 0; t < 180; t++) {
      m2.map(busy, 0, mover(), PHASE_PLAY, f);
      let h = 0;
      for (const k of kinds(f)) {
        if (k === SND_HIT) h++;
        if (k === SND_DIE) dies++;
      }
      hits += h;
      if (t % 60 === 59) perSecond.push(hits);
    }
    expect(hits).toBeLessThanOrEqual(HIT_RATE * 3 + HIT_BURST);
    expect(hits).toBeGreaterThanOrEqual(HIT_RATE * 3 - 2);
    expect(dies).toBeLessThanOrEqual(DIE_RATE * 3 + DIE_BURST);
    expect(dies).toBeGreaterThanOrEqual(DIE_RATE * 3 - 2);
    expect(HIT_RATE).toBeLessThan(30);
    // Never more than one tick a tick once the burst is spent.
    m2.map(busy, 0, mover(), PHASE_PLAY, f);
    expect(kinds(f).filter((k) => k === SND_HIT).length).toBeLessThanOrEqual(1);
    // And after a quiet second the next one sounds at once.
    for (let t = 0; t < 60; t++) m2.map(NONE, 0, mover(), PHASE_PLAY, f);
    m2.map(fxOf([FX_ENEMY_HIT, 5]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_HIT]);
  });

  it('repeated ticks wobble in pitch; bigger enemies crunch lower', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) {
      for (let t = 0; t < 10; t++) m.map(NONE, 0, mover(), PHASE_PLAY, f);
      m.map(fxOf([FX_ENEMY_HIT, 5]), 0, mover(), PHASE_PLAY, f);
      seen.add(f.pitch[0]);
    }
    expect(seen.size).toBeGreaterThan(3);
    const a = new SfxMapper();
    a.map(fxOf([FX_ENEMY_DIE, 0]), 0, mover(), PHASE_PLAY, f);
    const small = f.pitch[0];
    const b = new SfxMapper();
    b.map(fxOf([FX_ENEMY_DIE, 5]), 0, mover(), PHASE_PLAY, f);
    expect(f.pitch[0]).toBeLessThan(small);
  });

  it('the spark chime rises with each spark taken within a second, and starts low again after', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    let last = -Infinity;
    for (let n = 0; n < 6; n++) {
      m.map(fxOf([FX_SPARK, 1]), 0, mover(), PHASE_PLAY, f);
      expect(kinds(f)).toEqual([SND_SPARK]);
      expect(f.pitch[0]).toBe(pentatonic(n));
      expect(f.pitch[0]).toBeGreaterThan(last);
      last = f.pitch[0];
      for (let t = 0; t < 10; t++) m.map(NONE, 0, mover(), PHASE_PLAY, f);
    }
    for (let t = 0; t < 70; t++) m.map(NONE, 0, mover(), PHASE_PLAY, f);
    m.map(fxOf([FX_SPARK, 1]), 0, mover(), PHASE_PLAY, f);
    expect(f.pitch[0]).toBe(pentatonic(0));
    // A magnet full of sparks in one tick is one chime, pitched for all of them, then a pause.
    const m2 = new SfxMapper();
    m2.map(fxOf([FX_SPARK, 1], [FX_SPARK, 1], [FX_SPARK, 1], [FX_SPARK, 1]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_SPARK]);
    expect(f.pitch[0]).toBe(pentatonic(3));
    m2.map(fxOf([FX_SPARK, 1]), 0, mover(), PHASE_PLAY, f);
    expect(f.count).toBe(0);
  });

  it('a level up plays the rising figure; a card the confirm', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(fxOf([FX_LEVEL_UP, 2]), 0, mover(), PHASE_CHOOSE, f);
    expect(kinds(f)).toEqual([SND_LEVEL]);
    m.map(fxOf([FX_CARD, 0]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_CARD]);
  });

  it('each weapon has its own quiet voice, rate-limited', () => {
    const pairs: [number, number][] = [
      [FX_SHOT, SND_SHOT],
      [FX_STONE, SND_STONE],
      [FX_ARC, SND_ARC],
      [FX_SLAM, SND_SLAM],
      [FX_BLAST, SND_BLAST],
      [FX_POP, SND_POP],
    ];
    const voices = new Set<number>();
    for (const [fx, snd] of pairs) {
      const m = new SfxMapper();
      const f = makeSfxFrame();
      m.map(fxOf([fx, 0]), 0, mover(), PHASE_PLAY, f);
      expect(kinds(f), `fx ${fx}`).toEqual([snd]);
      expect(f.gain[0]).toBeCloseTo(WEAPON_GAIN[snd], 6);
      expect(f.gain[0]).toBeLessThanOrEqual(0.35);
      voices.add(snd);
      // Fired every tick for a second: far fewer voices than shots.
      let n = 0;
      for (let t = 0; t < 60; t++) {
        m.map(fxOf([fx, 0], [fx, 0]), 0, mover(), PHASE_PLAY, f);
        n += f.count;
      }
      expect(n, `fx ${fx}`).toBeLessThanOrEqual(16);
      expect(n).toBeGreaterThan(3);
    }
    expect(voices.size).toBe(6);
    // A chain lightning is one zap, not one per link.
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(fxOf([FX_ARC, 0], [FX_ARC, 1], [FX_ARC, 2]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_ARC]);
  });

  it('map things: a pickup, a coin, a soft swell', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(fxOf([FX_THING, 0], [FX_TOKEN, 3], [FX_HEAL, 20]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_THING, SND_TOKEN, SND_HEAL]);
  });

  it('a boss arriving stings and drops the key until it falls, which stings too', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.boss).toBe(false);
    m.map(fxOf([FX_BOSS_IN, 7]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_BOSS_IN]);
    expect(f.boss).toBe(true);
    for (let t = 0; t < 100; t++) m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.boss).toBe(true);
    m.map(fxOf([FX_BOSS_DOWN, 7]), 0, mover(), PHASE_PLAY, f);
    expect(kinds(f)).toEqual([SND_BOSS_DOWN]);
    expect(f.boss).toBe(false);
  });

  it('a card offer ducks the music while it is open', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, 0, mover(), PHASE_CHOOSE, f);
    expect(f.duck).toBe(true);
    m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.duck).toBe(false);
  });

  it('the run ends once: on a fall when dead, on a cadence when cleared; a new run starts it again', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.end).toBe(END_NONE);
    m.map(NONE, 0, mover(), PHASE_DEAD, f);
    expect(f.end).toBe(END_FALL);
    expect(kinds(f)).toEqual([SND_DEAD]);
    m.map(NONE, 0, mover(), PHASE_DEAD, f);
    expect(f.end).toBe(END_NONE);
    expect(f.count).toBe(0);
    expect(f.hum).toBe(0);
    m.map(NONE, 0, mover(), PHASE_PLAY, f);
    expect(f.restart).toBe(true);
    m.map(fxOf([FX_BOSS_IN, 7]), 0, mover(), PHASE_PLAY, f);
    m.map(NONE, 0, mover(), PHASE_WON, f);
    expect(f.end).toBe(END_CADENCE);
    expect(kinds(f)).toEqual([SND_WON]);
    expect(f.boss).toBe(false);
  });

  it('allocates nothing per tick: the frame is reused', () => {
    const m = new SfxMapper();
    const f = makeSfxFrame();
    const kindArr = f.kind;
    m.map(fxOf([FX_ENEMY_HIT, 1], [FX_SPARK, 1]), EV_HOP | EV_LAND, mover(), PHASE_PLAY, f);
    expect(f.kind).toBe(kindArr);
    // More sounds than the frame holds are dropped, never written past the end.
    const flood = makeFx();
    for (let i = 0; i < 200; i++) {
      flood.type[i] = FX_THING;
      flood.count++;
    }
    m.map(flood, 0, mover(), PHASE_PLAY, f);
    expect(f.count).toBe(f.kind.length);
  });
});
