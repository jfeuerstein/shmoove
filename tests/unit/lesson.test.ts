import { describe, expect, it } from 'vitest';
import {
  LESSON,
  LINES,
  LINE_EARLIER,
  LINE_EXPLAIN,
  LINE_LATER,
  LINE_STUCK,
  Lesson,
  SETTLE_TICKS,
  STEP_COUNT,
  lessonWanted,
  makeLessonSample,
  type LessonGate,
  type LessonSample,
} from '../../src/app/lesson';
import { EV_CLEAN_HOP, EV_HOP, EV_LAND } from '../../src/sim/types';

/** A sample with some fields set; the rest read as a mover standing still on level ground. */
function sample(over: Partial<LessonSample> = {}): LessonSample {
  return Object.assign(makeLessonSample(), over);
}

/** Feed `n` ticks of the same sample. */
function feed(l: Lesson, n: number, s: LessonSample): void {
  for (let i = 0; i < n; i++) l.update(s);
}

/** Let a finished step settle and the next line come up. */
function settle(l: Lesson): void {
  feed(l, SETTLE_TICKS, sample());
}

/** Drive a fresh lesson to the start of step `n` (0-based) through the real conditions. */
function lessonAt(n: number): Lesson {
  const l = new Lesson();
  const run = [
    () => {
      // Steer: 2 s of carve over 15 m.
      for (let i = 0; i < LESSON.carveSeconds * 60; i++) l.update(sample({ carve: true, distance: (i + 1) * 0.2 }));
    },
    () => l.update(sample({ tucked: true, gear: 3, speed: 13 })),
    () => l.update(sample({ events: EV_HOP })),
    () => l.update(sample({ events: EV_HOP | EV_CLEAN_HOP })),
    () => l.update(sample({ gear: 3, plowed: true })),
    () => {
      l.update(sample({ pops: 0 }));
      l.update(sample({ pops: 1 }));
    },
  ];
  for (let i = 0; i < n; i++) {
    run[i]();
    settle(l);
  }
  expect(l.step).toBe(n);
  return l;
}

describe('the lesson', () => {
  it('starts on its first line, nothing done', () => {
    const l = new Lesson();
    expect(l.step).toBe(0);
    expect(l.line).toBe('Drag to steer.');
    expect(l.done).toBe(0);
    expect(l.ended).toBe(false);
    expect(LINES).toHaveLength(STEP_COUNT);
  });

  it('uses the words it was given', () => {
    expect(LINES).toEqual([
      'Drag to steer.',
      'Now let go on a downhill. Letting go is how you get fast.',
      'Tap to hop.',
      'Tap again the moment you land.',
      'The big number is your gear. Under 3, everything hurts.',
      'Your trail burns. Circle back onto it to pop everything inside.',
      'That is the game. Stay fast.',
    ]);
    expect(LINE_STUCK).toBe('Steer to a slope first, then let go.');
    expect(LINE_EXPLAIN).toBe('That is why. Find a downhill, let go, and go through them in 3.');
  });

  it('goes through its steps in a fixed order', () => {
    const l = new Lesson();
    const seen: number[] = [];
    const script: LessonSample[] = [];
    // Everything at once from the start: the order must still hold, one step at a time.
    for (let i = 0; i < 600; i++) {
      script.push(sample({ carve: true, tap: true, distance: i * 0.5, tucked: true, gear: 4, speed: 20, events: EV_HOP | EV_CLEAN_HOP, plowed: true, pops: 1 + i }));
    }
    for (const s of script) {
      l.update(s);
      if (seen[seen.length - 1] !== l.step) seen.push(l.step);
      if (l.ended) break;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(l.ended).toBe(true);
    expect(l.skipped).toBe(false);
  });

  describe('step 1, steer', () => {
    it('needs both 2 s of carving and 15 m', () => {
      const l = new Lesson();
      l.update(sample({ carve: true, distance: 0 }));
      // Plenty of distance, not enough carving.
      feed(l, 118, sample({ carve: true, distance: 100 }));
      expect(l.done).toBe(0);
      // Plenty of carving, no distance.
      const m = new Lesson();
      feed(m, 600, sample({ carve: true, distance: 0 }));
      expect(m.done).toBe(0);
      // Carving counts in total, not in a row.
      const t = new Lesson();
      t.update(sample({ distance: 0 }));
      for (let i = 0; i < 120; i++) t.update(sample({ carve: i % 2 === 0, distance: i * 0.2 }));
      expect(t.done).toBe(0);
      for (let i = 0; i < 60; i++) t.update(sample({ carve: true, distance: 30 }));
      expect(t.done).toBe(1);
      l.update(sample({ carve: true, distance: 100 }));
      expect(l.done).toBe(1);
    });

    it('measures the distance from where the step began', () => {
      const l = new Lesson();
      l.update(sample({ distance: 500 }));
      feed(l, 130, sample({ carve: true, distance: 505 }));
      expect(l.done).toBe(0);
      l.update(sample({ carve: true, distance: 515 }));
      expect(l.done).toBe(1);
    });
  });

  describe('step 2, let go', () => {
    it('is done by a tuck in gear 3 or higher, not before', () => {
      const l = lessonAt(1);
      l.update(sample({ tucked: false, gear: 4, speed: 20 }));
      l.update(sample({ tucked: true, gear: 2, speed: 10 }));
      expect(l.done).toBe(1);
      l.update(sample({ tucked: true, gear: 3, speed: 12.5 }));
      expect(l.done).toBe(2);
    });

    it('says to find a slope after 3 s tucked and slow on level ground, and goes back when the thumb is down', () => {
      const l = lessonAt(1);
      const stuck = sample({ tucked: true, grounded: true, speed: 2, normalY: 1 });
      feed(l, LESSON.stuckSeconds * 60 - 1, stuck);
      expect(l.line).toBe(LINES[1]);
      l.update(stuck);
      expect(l.line).toBe(LINE_STUCK);
      l.update(sample({ tucked: false, carve: true, speed: 5 }));
      expect(l.line).toBe(LINES[1]);
    });

    it('does not say it on a slope, nor for a mover that is going fast', () => {
      const l = lessonAt(1);
      feed(l, 600, sample({ tucked: true, grounded: true, speed: 3, normalY: 0.9 }));
      expect(l.line).toBe(LINES[1]);
      feed(l, 600, sample({ tucked: true, grounded: true, speed: 9, normalY: 1 }));
      expect(l.line).toBe(LINES[1]);
    });

    it('restarts the 3 s when the mover moves off for a moment', () => {
      const l = lessonAt(1);
      const stuck = sample({ tucked: true, speed: 2 });
      feed(l, 150, stuck);
      l.update(sample({ tucked: true, speed: 8 }));
      feed(l, 150, stuck);
      expect(l.line).toBe(LINES[1]);
    });
  });

  describe('step 3, hop', () => {
    it('is done on a hop and not on a tap that did not hop', () => {
      const l = lessonAt(2);
      feed(l, 10, sample({ tap: true, grounded: false }));
      expect(l.done).toBe(2);
      l.update(sample({ events: EV_HOP }));
      expect(l.done).toBe(3);
    });
  });

  describe('step 4, clean hop', () => {
    it('is done on a clean hop, not on a late one or a landing', () => {
      const l = lessonAt(3);
      l.update(sample({ events: EV_HOP }));
      l.update(sample({ events: EV_LAND }));
      expect(l.done).toBe(3);
      l.update(sample({ events: EV_LAND | EV_HOP | EV_CLEAN_HOP }));
      expect(l.done).toBe(4);
    });

    it('adds "A little earlier." after three late hops', () => {
      const l = lessonAt(3);
      for (let i = 0; i < LESSON.missesForHint - 1; i++) l.update(sample({ events: EV_HOP }));
      expect(l.line).toBe(LINES[3]);
      l.update(sample({ events: EV_HOP }));
      expect(l.line).toBe(LINE_EARLIER);
    });

    it('adds "A little later." after three taps made too early to count', () => {
      const l = lessonAt(3);
      for (let i = 0; i < LESSON.missesForHint; i++) {
        l.update(sample({ tap: true, grounded: false }));
        l.update(sample({ grounded: true, events: EV_LAND }));
      }
      expect(l.line).toBe(LINE_LATER);
    });

    it('follows the last miss, and a landing with no tap is not a miss', () => {
      const l = lessonAt(3);
      for (let i = 0; i < 5; i++) l.update(sample({ events: EV_LAND }));
      expect(l.line).toBe(LINES[3]);
      for (let i = 0; i < LESSON.missesForHint; i++) l.update(sample({ events: EV_HOP }));
      expect(l.line).toBe(LINE_EARLIER);
      l.update(sample({ tap: true, grounded: false }));
      l.update(sample({ events: EV_LAND }));
      expect(l.line).toBe(LINE_LATER);
    });
  });

  describe('step 5, gear', () => {
    it('is done by plowing one in gear 3 or higher', () => {
      const l = lessonAt(4);
      l.update(sample({ gear: 2, plowed: true }));
      expect(l.done).toBe(4);
      l.update(sample({ gear: 3, plowed: false }));
      expect(l.done).toBe(4);
      l.update(sample({ gear: 3, plowed: true }));
      expect(l.done).toBe(5);
    });

    it('explains after two hits, then moves on once it has been read', () => {
      const l = lessonAt(4);
      l.update(sample({ hurt: true }));
      expect(l.line).toBe(LINES[4]);
      l.update(sample({ hurt: true }));
      expect(l.line).toBe(LINE_EXPLAIN);
      expect(l.done).toBe(4);
      feed(l, LESSON.explainTicks - 1, sample());
      expect(l.step).toBe(4);
      l.update(sample());
      expect(l.done).toBe(5);
      settle(l);
      expect(l.step).toBe(5);
    });

    it('lets a plow in gear 3 end the explanation early', () => {
      const l = lessonAt(4);
      l.update(sample({ hurt: true }));
      l.update(sample({ hurt: true }));
      expect(l.line).toBe(LINE_EXPLAIN);
      l.update(sample({ gear: 3, plowed: true }));
      expect(l.done).toBe(5);
    });
  });

  describe('step 6, loop', () => {
    it('is done by a pop, counted from where the step began', () => {
      const l = lessonAt(5);
      l.update(sample({ pops: 4 }));
      l.update(sample({ pops: 4 }));
      expect(l.done).toBe(5);
      l.update(sample({ pops: 5 }));
      expect(l.done).toBe(6);
    });

    it('gives up after 25 s', () => {
      const l = lessonAt(5);
      feed(l, LESSON.popSeconds * 60 - 1, sample());
      expect(l.done).toBe(5);
      l.update(sample());
      expect(l.done).toBe(6);
    });
  });

  describe('step 7, the end', () => {
    it('shows its line for 2 s and then ends the lesson, not skipped', () => {
      const l = lessonAt(6);
      expect(l.line).toBe('That is the game. Stay fast.');
      feed(l, LESSON.endSeconds * 60 - 1, sample());
      expect(l.ended).toBe(false);
      l.update(sample());
      expect(l.ended).toBe(true);
      expect(l.skipped).toBe(false);
    });
  });

  describe('skip', () => {
    it('ends the lesson from every step', () => {
      for (let n = 0; n < STEP_COUNT; n++) {
        const l = lessonAt(n);
        l.skip();
        expect(l.ended, `step ${n}`).toBe(true);
        expect(l.skipped).toBe(true);
      }
    });

    it('ends it in the middle of a settle too, and nothing moves it afterwards', () => {
      const l = new Lesson();
      l.update(sample({ carve: true, distance: 0 }));
      feed(l, 130, sample({ carve: true, distance: 50 }));
      expect(l.done).toBe(1);
      l.skip();
      const step = l.step;
      feed(l, 600, sample({ carve: true, tucked: true, gear: 5, events: EV_HOP | EV_CLEAN_HOP, plowed: true, pops: 9 }));
      expect(l.step).toBe(step);
      expect(l.done).toBe(1);
    });
  });

  it('holds a finished step on screen for a moment before the next line', () => {
    const l = lessonAt(1);
    l.update(sample({ tucked: true, gear: 3 }));
    expect(l.done).toBe(2);
    expect(l.step).toBe(1);
    expect(l.line).toBe(LINES[1]);
    feed(l, SETTLE_TICKS - 1, sample());
    expect(l.step).toBe(1);
    l.update(sample());
    expect(l.step).toBe(2);
    expect(l.line).toBe(LINES[2]);
  });

  it('allocates nothing per tick', () => {
    // The same line strings and the same objects, tick after tick: nothing here builds a string,
    // an array or a closure. Check the visible half of that: the line is always one of the constants.
    const known = new Set<string>([...LINES, LINE_STUCK, LINE_EARLIER, LINE_LATER, LINE_EXPLAIN]);
    const l = new Lesson();
    const s = sample({ carve: true, tap: true, distance: 0, tucked: true, speed: 3 });
    for (let i = 0; i < 4000; i++) {
      s.distance = i * 0.1;
      s.events = i % 7 === 0 ? EV_HOP : i % 11 === 0 ? EV_LAND : 0;
      s.gear = 1 + (i % 5);
      s.plowed = i % 13 === 0;
      s.hurt = i % 17 === 0;
      s.pops = i >> 9;
      l.update(s);
      expect(known.has(l.line)).toBe(true);
      if (l.ended) break;
    }
  });
});

describe('lessonWanted', () => {
  const base: LessonGate = { force: false, skip: false, done: false, flat: false, solo: false, horde: false, arsenal: false, perf: false };

  it('shows to a player who has not done it', () => {
    expect(lessonWanted(base)).toBe(true);
  });

  it('does not show once done, unless forced', () => {
    expect(lessonWanted({ ...base, done: true })).toBe(false);
    expect(lessonWanted({ ...base, done: true, force: true })).toBe(true);
  });

  it('never shows with nolesson', () => {
    expect(lessonWanted({ ...base, skip: true })).toBe(false);
    expect(lessonWanted({ ...base, skip: true, force: true })).toBe(false);
  });

  it('never shows in fixtures and modes with no place for it', () => {
    for (const k of ['flat', 'solo', 'horde', 'arsenal', 'perf'] as const) {
      expect(lessonWanted({ ...base, [k]: true }), k).toBe(false);
      expect(lessonWanted({ ...base, [k]: true, force: true }), k).toBe(false);
    }
  });
});
