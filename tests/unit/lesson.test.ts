import { describe, expect, it } from 'vitest';
import {
  LESSON,
  LINES,
  LINE_DIP,
  Lesson,
  SETTLE_TICKS,
  STEP_COUNT,
  lessonWanted,
  makeLessonSample,
  type LessonGate,
  type LessonSample,
} from '../../src/app/lesson';
import { EV_HOP } from '../../src/sim/types';

/** A sample with some fields set; the rest read as a rider standing still, nothing killed. */
function sample(over: Partial<LessonSample> = {}): LessonSample {
  return Object.assign(makeLessonSample(), over);
}

/** Feed `n` ticks of the same sample. */
function feed(l: Lesson, n: number, s: LessonSample): void {
  for (let i = 0; i < n; i++) l.update(s);
}

/** Let a finished step settle and the next line come up. */
function settle(l: Lesson, s: LessonSample = sample()): void {
  feed(l, SETTLE_TICKS, s);
}

/** Drive a fresh lesson to the start of step `n` (0-based) through the real conditions. */
function lessonAt(n: number): Lesson {
  const l = new Lesson();
  const run = [
    () => {
      for (let i = 0; i < LESSON.steerSeconds * 60; i++) l.update(sample({ carve: true, distance: (i + 1) * 0.2 }));
    },
    () => l.update(sample({ events: EV_HOP })),
    () => l.update(sample({ speed: 17 })),
    () => {
      l.update(sample({ kills: 0 }));
      l.update(sample({ kills: LESSON.kills }));
    },
    () => l.update(sample({ offerOpen: true })),
    () => l.update(sample({ offerOpen: false })),
  ];
  for (let i = 0; i < n; i++) {
    run[i]();
    settle(l, sample({ kills: LESSON.kills, offerOpen: i === 4 }));
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
      'Tap to ollie.',
      'Hills make you fast. Find one.',
      'Your weapons fire themselves. Stay out of reach.',
      'Pick up the sparks. They are your levels.',
      'Take a card.',
      "That is the game. Don't get touched.",
    ]);
    expect(LINE_DIP).toBe('Head for the dip in the middle.');
  });

  it('goes through its steps in a fixed order, one at a time, whatever the sim says', () => {
    const l = new Lesson();
    const seen: number[] = [];
    let kills = 0;
    for (let i = 0; i < 2000; i++) {
      kills += 1;
      // Everything true at once, except that the offer is open only on every other tick.
      l.update(sample({ carve: true, distance: i * 0.5, speed: 20, events: EV_HOP, kills, offerOpen: i % 2 === 0 }));
      if (seen[seen.length - 1] !== l.step) seen.push(l.step);
      if (l.ended) break;
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(l.ended).toBe(true);
    expect(l.skipped).toBe(false);
  });

  describe('step 1, steer', () => {
    it('needs both 2 s of steering in total and 15 m', () => {
      const l = new Lesson();
      l.update(sample({ carve: true, distance: 0 }));
      feed(l, 118, sample({ carve: true, distance: 100 }));
      expect(l.done).toBe(0);
      const m = new Lesson();
      feed(m, 600, sample({ carve: true, distance: 0 }));
      expect(m.done).toBe(0);
      l.update(sample({ carve: true, distance: 100 }));
      expect(l.done).toBe(1);
    });

    it('counts the steering in total, not in a row', () => {
      const l = new Lesson();
      l.update(sample({ distance: 0 }));
      for (let i = 0; i < 30; i++) {
        feed(l, 4, sample({ carve: true, distance: 50 }));
        feed(l, 4, sample({ carve: false, distance: 50 }));
      }
      expect(l.done).toBe(1);
    });
  });

  describe('step 2, ollie', () => {
    it('is done on a hop and not before', () => {
      const l = lessonAt(1);
      feed(l, 600, sample({ speed: 30, kills: 9 }));
      expect(l.done).toBe(1);
      l.update(sample({ events: EV_HOP }));
      expect(l.done).toBe(2);
    });
  });

  describe('step 3, hills', () => {
    it('is done above the fast speed and not at it', () => {
      const l = lessonAt(2);
      feed(l, 60, sample({ speed: LESSON.fastSpeed }));
      expect(l.done).toBe(2);
      l.update(sample({ speed: LESSON.fastSpeed + 0.1 }));
      expect(l.done).toBe(3);
    });

    it('points at the dip after 12 s without going fast, and still finishes if the rider then does', () => {
      const l = lessonAt(2);
      feed(l, LESSON.dipSeconds * 60 - 2, sample({ speed: 8 }));
      expect(l.line).toBe(LINES[2]);
      feed(l, 2, sample({ speed: 8 }));
      expect(l.line).toBe(LINE_DIP);
      l.update(sample({ speed: 20 }));
      expect(l.done).toBe(3);
    });
  });

  describe('step 4, weapons', () => {
    it('is done when three have died, counted from the step', () => {
      const l = lessonAt(3);
      l.update(sample({ kills: 40 }));
      l.update(sample({ kills: 42 }));
      expect(l.done).toBe(3);
      l.update(sample({ kills: 43 }));
      expect(l.done).toBe(4);
    });
  });

  describe('step 5, sparks', () => {
    it('is done when an offer opens', () => {
      const l = lessonAt(4);
      feed(l, 60, sample());
      expect(l.done).toBe(4);
      l.update(sample({ offerOpen: true }));
      expect(l.done).toBe(5);
    });

    it('asks for the XP top-up once, after 10 s, and not before', () => {
      const l = lessonAt(4);
      feed(l, LESSON.sparkSeconds * 60 - 1, sample());
      expect(l.takeTopUp()).toBe(false);
      l.update(sample());
      expect(l.takeTopUp()).toBe(true);
      expect(l.takeTopUp()).toBe(false);
      feed(l, 600, sample());
      expect(l.takeTopUp()).toBe(false);
    });

    it('asks for nothing if the offer came by itself', () => {
      const l = lessonAt(4);
      feed(l, 200, sample());
      l.update(sample({ offerOpen: true }));
      feed(l, 1000, sample({ offerOpen: true }));
      expect(l.takeTopUp()).toBe(false);
    });
  });

  describe('step 6, take a card', () => {
    it('waits while the card is on the table and is done when it is taken', () => {
      const l = lessonAt(5);
      expect(l.line).toBe('Take a card.');
      feed(l, 600, sample({ offerOpen: true }));
      expect(l.done).toBe(5);
      l.update(sample({ offerOpen: false }));
      expect(l.done).toBe(6);
    });
  });

  describe('step 7, the end', () => {
    it('ends after 2 s, not before', () => {
      const l = lessonAt(6);
      expect(l.line).toBe(LINES[6]);
      feed(l, LESSON.endSeconds * 60 - 1, sample());
      expect(l.ended).toBe(false);
      l.update(sample());
      expect(l.ended).toBe(true);
      expect(l.skipped).toBe(false);
    });
  });

  describe('skip', () => {
    it('ends it from any step', () => {
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
      feed(l, 600, sample({ carve: true, speed: 30, events: EV_HOP, kills: 9, offerOpen: true }));
      expect(l.step).toBe(step);
      expect(l.done).toBe(1);
    });
  });

  it('holds a finished step on screen for a moment before the next line', () => {
    const l = lessonAt(1);
    l.update(sample({ events: EV_HOP }));
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
    const known = new Set<string>([...LINES, LINE_DIP]);
    const l = new Lesson();
    const s = sample({ carve: true });
    for (let i = 0; i < 6000; i++) {
      s.distance = i * 0.1;
      s.events = i % 7 === 0 ? EV_HOP : 0;
      s.speed = i % 300 < 150 ? 5 : 20;
      s.kills = i >> 5;
      s.offerOpen = i % 900 > 600;
      l.update(s);
      l.takeTopUp();
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
