import { beforeEach, describe, expect, it } from 'vitest';
import { Gestures } from '../../src/input/gestures';
import { SCHEMES, type Scheme } from '../../src/input/source';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { makeInputFrame, type InputFrame } from '../../src/sim/types';

const out: InputFrame = makeInputFrame();

function sample(g: Gestures, t: number): InputFrame {
  const f = makeInputFrame();
  g.sample(f, t);
  return f;
}

beforeEach(() => resetFeel());

describe.each(SCHEMES)('%s: common stick rules', (scheme: Scheme) => {
  it('is idle with no thumb', () => {
    const g = new Gestures(scheme);
    const f = sample(g, 0);
    expect(f).toEqual({ steerX: 0, steerY: 0, carve: false, hop: false });
    expect(g.stick.active).toBe(false);
  });

  it('deflects right as +x and up the screen as +y', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 230, 500, 10);
    let f = sample(g, 20);
    expect(f.steerX).toBeCloseTo(30 / FEEL.stickRadiusPx, 6);
    expect(f.steerY).toBeCloseTo(0, 6);
    g.move(1, 200, 500, 30);
    g.move(1, 200, 470, 1040);
    f = sample(g, 1050);
    expect(f.steerX).toBeCloseTo(0, 6);
    expect(f.steerY).toBeCloseTo(30 / FEEL.stickRadiusPx, 6);
  });

  it('deflects left as -x and down the screen as -y', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 170, 500, 10);
    expect(sample(g, 20).steerX).toBeCloseTo(-30 / FEEL.stickRadiusPx, 6);
    g.move(1, 200, 500, 30);
    g.move(1, 200, 530, 40);
    expect(sample(g, 50).steerY).toBeCloseTo(-30 / FEEL.stickRadiusPx, 6);
  });

  it('reads centred within the dead zone and live just outside it', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 200 + FEEL.stickDeadPx - 1, 500, 10);
    let f = sample(g, 20);
    expect(f.steerX).toBe(0);
    expect(f.steerY).toBe(0);
    g.move(1, 200 + FEEL.stickDeadPx + 1, 500, 30);
    f = sample(g, 40);
    expect(f.steerX).toBeGreaterThan(0);
  });

  it('clamps the deflection to length 1', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 200 + 300, 500 - 300, 1000);
    const f = sample(g, 1010);
    expect(Math.hypot(f.steerX, f.steerY)).toBeCloseTo(1, 6);
    expect(f.steerX).toBeGreaterThan(0);
    expect(f.steerY).toBeGreaterThan(0);
  });

  it('drags the origin behind the thumb so reversing is immediate', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 400, 500, 10);
    expect(sample(g, 20).steerX).toBeCloseTo(1, 6);
    expect(g.stick.ox).toBeCloseTo(400 - FEEL.stickRadiusPx, 6);
    // Reverse by half a radius: the stick reads half left of the dragged origin... i.e. 0.5 down from full.
    g.move(1, 400 - FEEL.stickRadiusPx, 500, 30);
    expect(sample(g, 40).steerX).toBeCloseTo(0, 6);
    g.move(1, 400 - 2 * FEEL.stickRadiusPx, 500, 50);
    expect(sample(g, 60).steerX).toBeCloseTo(-1, 6);
  });

  it('turns a second finger into a hop and never steers with it', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 230, 500, 10);
    g.down(2, 50, 100, 20);
    g.move(2, 10, 10, 30);
    const f = sample(g, 40);
    expect(f.hop).toBe(true);
    expect(f.steerX).toBeCloseTo(30 / FEEL.stickRadiusPx, 6);
    expect(g.stick.x).toBe(230);
    g.up(2, 50);
    expect(g.stick.active).toBe(true);
  });

  it('reports a hop once, then clears it', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.down(2, 50, 100, 5);
    expect(sample(g, 10).hop).toBe(true);
    expect(sample(g, 20).hop).toBe(false);
  });

  it('collapses several hops into one', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.down(2, 50, 100, 5);
    g.down(3, 60, 100, 6);
    g.down(4, 70, 100, 7);
    expect(sample(g, 10).hop).toBe(true);
    expect(sample(g, 20).hop).toBe(false);
  });

  it('cancelAll mid-drag clears carve, steer, stick and any queued hop', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 260, 450, 10);
    g.down(2, 50, 100, 15);
    g.cancelAll();
    const f = sample(g, 400);
    expect(f).toEqual({ steerX: 0, steerY: 0, carve: false, hop: false });
    expect(g.stick.active).toBe(false);
    // A new touch afterwards starts fresh.
    g.down(5, 100, 600, 500);
    expect(g.stick.ox).toBe(100);
  });

  it('picks up a changed FEEL value between events', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 228, 500, 10);
    expect(sample(g, 20).steerX).toBeCloseTo(28 / 56, 6);
    FEEL.stickRadiusPx = 28;
    expect(sample(g, 30).steerX).toBeCloseTo(1, 6);
    FEEL.stickDeadPx = 40;
    expect(sample(g, 40).steerX).toBe(0);
  });

  it('ignores moves and releases from pointers that are not the thumb', () => {
    const g = new Gestures(scheme);
    g.move(9, 10, 10, 0);
    g.up(9, 5);
    expect(sample(g, 10)).toEqual({ steerX: 0, steerY: 0, carve: false, hop: false });
  });
});

describe('tuck', () => {
  it('a quick tap hops and never carves', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    expect(sample(g, 16).carve).toBe(false);
    g.up(1, 100);
    const f = sample(g, 116);
    expect(f.hop).toBe(true);
    expect(f.carve).toBe(false);
  });

  it('a tap that wanders within the slop is still a tap', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    g.move(1, 200 + FEEL.tapSlopPx - 1, 500, 50);
    expect(sample(g, 60).carve).toBe(false);
    g.up(1, 100);
    expect(sample(g, 110).hop).toBe(true);
  });

  it('a long press without movement becomes a carve with a centred stick, and release does not hop', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    expect(sample(g, FEEL.tapMaxMs - 10).carve).toBe(false);
    const f = sample(g, FEEL.tapMaxMs + 20);
    expect(f.carve).toBe(true);
    expect(f.steerX).toBe(0);
    expect(f.steerY).toBe(0);
    g.up(1, 400);
    const r = sample(g, 410);
    expect(r.hop).toBe(false);
    expect(r.carve).toBe(false);
  });

  it('release after the tap time with no sample in between is not a hop', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    g.up(1, FEEL.tapMaxMs + 50);
    expect(sample(g, 300).hop).toBe(false);
  });

  it('moving past the slop decides a carve at once; release does not hop', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    g.move(1, 200 + FEEL.tapSlopPx + 2, 500, 30);
    expect(sample(g, 40).carve).toBe(true);
    g.up(1, 60);
    const f = sample(g, 70);
    expect(f.hop).toBe(false);
    expect(f.carve).toBe(false);
    expect(f.steerX).toBe(0);
  });

  it('stays a carve after dragging back to where it started', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 20);
    g.move(1, 200, 500, 40);
    const f = sample(g, 50);
    expect(f.carve).toBe(true);
    expect(f.steerX).toBe(0);
  });

  it('reads the tap time from FEEL at use', () => {
    const g = new Gestures('tuck');
    FEEL.tapMaxMs = 60;
    g.down(1, 200, 500, 0);
    g.up(1, 100);
    expect(sample(g, 110).hop).toBe(false);
  });
});

describe('lift', () => {
  it('carves only while outside the dead zone', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    expect(sample(g, 10).carve).toBe(false);
    g.move(1, 200, 500 - FEEL.stickDeadPx - 2, 20);
    expect(sample(g, 30).carve).toBe(true);
    g.move(1, 200, 500 - 2, 40);
    expect(sample(g, 50).carve).toBe(false);
  });

  it('a tap hops on release', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    g.up(1, 80);
    const f = sample(g, 90);
    expect(f.hop).toBe(true);
    expect(f.carve).toBe(false);
  });

  it('a long press without movement does not carve, and hops on release', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    expect(sample(g, 2000).carve).toBe(false);
    g.up(1, 2100);
    expect(sample(g, 2110).hop).toBe(true);
  });

  it('release after a drag hops and stops carving', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 100);
    expect(sample(g, 110).carve).toBe(true);
    g.up(1, 600);
    const f = sample(g, 610);
    expect(f.hop).toBe(true);
    expect(f.carve).toBe(false);
    expect(f.steerX).toBe(0);
  });
});

describe('swipe', () => {
  it('a tap does nothing', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 500, 0);
    g.up(1, 80);
    const f = sample(g, 90);
    expect(f.hop).toBe(false);
    expect(f.carve).toBe(false);
  });

  it('a long press carves with a centred stick and release does not hop', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 500, 0);
    const f = sample(g, FEEL.tapMaxMs + 20);
    expect(f.carve).toBe(true);
    expect(f.steerY).toBe(0);
    g.up(1, 500);
    expect(sample(g, 510).hop).toBe(false);
  });

  it('a drag carves and releasing it does not hop', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 200);
    expect(sample(g, 210).carve).toBe(true);
    g.up(1, 300);
    const f = sample(g, 310);
    expect(f.hop).toBe(false);
    expect(f.carve).toBe(false);
  });

  it('a flick up while carving hops once and leaves the deflection unchanged', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 600, 0);
    g.move(1, 230, 570, 100); // slow: 0.42 px/ms
    const before = sample(g, 105);
    expect(before.hop).toBe(false);
    expect(before.carve).toBe(true);
    g.move(1, 230, 540, 110); // 30 px in 10 ms
    g.move(1, 230, 500, 120); // keeps flicking
    const after = sample(g, 125);
    expect(after.hop).toBe(true);
    expect(after.steerX).toBeCloseTo(before.steerX, 6);
    expect(after.steerY).toBeCloseTo(before.steerY, 6);
    expect(sample(g, 140).hop).toBe(false);
  });

  it('a slow upward drag never hops, however far', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 800, 0);
    let hops = 0;
    for (let i = 1; i <= 40; i++) {
      g.move(1, 200, 800 - i * 10, i * 20); // 0.5 px/ms
      if (sample(g, i * 20 + 1).hop) hops++;
    }
    expect(hops).toBe(0);
  });

  it('a short fast twitch under swipeMinPx does not hop', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 600, 0);
    g.move(1, 200, 600 - (FEEL.swipeMinPx - 4), 10);
    expect(sample(g, 20).hop).toBe(false);
  });

  it('two flicks in a row hop twice, once each', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 800, 0);
    let hops = 0;
    const take = (t: number): InputFrame => {
      const f = sample(g, t);
      if (f.hop) hops++;
      return f;
    };
    g.move(1, 200, 770, 10);
    g.move(1, 200, 740, 20);
    take(25);
    expect(hops).toBe(1);
    take(30);
    // Hold still until the flick has faded and the detector re-arms, then flick again.
    g.move(1, 200, 740, 200);
    take(205);
    const before = take(206);
    g.move(1, 200, 710, 210);
    g.move(1, 200, 680, 220);
    const after = take(225);
    expect(hops).toBe(2);
    expect(after.steerX).toBeCloseTo(before.steerX, 6);
    expect(after.steerY).toBeCloseTo(before.steerY, 6);
  });

  it('one continuous flick is one hop', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 800, 0);
    let hops = 0;
    for (let i = 1; i <= 12; i++) {
      g.move(1, 200, 800 - i * 20, i * 10); // 2 px/ms throughout
      if (sample(g, i * 10 + 1).hop) hops++;
    }
    expect(hops).toBe(1);
  });

  it('reads the flick threshold from FEEL at use', () => {
    const g = new Gestures('swipe');
    g.down(1, 200, 800, 0);
    g.move(1, 200, 760, 40); // 1 px/ms: below the default 1.2
    expect(sample(g, 41).hop).toBe(false);
    g.up(1, 50);
    FEEL.swipeSpeed = 0.5;
    g.down(1, 200, 800, 100);
    g.move(1, 200, 760, 140);
    expect(sample(g, 141).hop).toBe(true);
  });
});

describe('setScheme mid-touch', () => {
  it('does not leave a stuck carve when going from a decided tuck carve to lift with the thumb centred', () => {
    const g = new Gestures('tuck');
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 30);
    g.move(1, 200, 500, 60);
    expect(sample(g, 70).carve).toBe(true);
    g.setScheme('lift');
    expect(sample(g, 80).carve).toBe(false);
    g.up(1, 90);
    expect(sample(g, 100).carve).toBe(false);
  });

  it('does not leave a stuck carve when the thumb lifts after a switch to swipe', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 30);
    expect(sample(g, 40).carve).toBe(true);
    g.setScheme('swipe');
    g.up(1, 50);
    const f = sample(g, 60);
    expect(f.carve).toBe(false);
    expect(f.hop).toBe(false);
  });

  it('a held touch moved to tuck still decides normally and releases cleanly', () => {
    const g = new Gestures('lift');
    g.down(1, 200, 500, 0);
    g.setScheme('tuck');
    g.up(1, 50);
    const f = sample(g, 60);
    expect(f.carve).toBe(false);
    expect(f.hop).toBe(true);
  });
});

describe('a long drag', () => {
  it('keeps the same stick object and produces finite output throughout', () => {
    // This cannot observe allocation (nothing here can); it checks the reused stick view survives
    // thousands of events and the output stays finite.
    for (const scheme of SCHEMES) {
      const g = new Gestures(scheme);
      const stick = g.stick;
      g.down(1, 200, 800, 0);
      for (let i = 1; i <= 5000; i++) {
        g.move(1, 200 + (i % 50), 800 - (i % 7), i * 2);
        g.sample(out, i * 2 + 1);
      }
      expect(g.stick).toBe(stick);
      expect(Number.isFinite(out.steerX)).toBe(true);
      expect(Number.isFinite(out.steerY)).toBe(true);
    }
  });
});

describe.each(SCHEMES)('%s: touches that end in odd ways', (scheme: Scheme) => {
  const IDLE = { steerX: 0, steerY: 0, carve: false, hop: false };

  it('the thumb lifting while a second finger is down gives an idle frame, and that finger is then ignored', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 10);
    g.down(2, 50, 100, 20);
    g.up(1, 30);
    const f = sample(g, 40);
    // Only the second finger's own down was a hop; the thumb's lift must not add steering or carve.
    expect(f.steerX).toBe(0);
    expect(f.steerY).toBe(0);
    expect(f.carve).toBe(false);
    expect(g.stick.active).toBe(false);
    // Drain any hop (the second finger's down, and a lift or tap release in some schemes).
    sample(g, 50);
    g.move(2, 300, 300, 60);
    g.up(2, 70);
    expect(sample(g, 80)).toEqual(IDLE);
    expect(g.stick.active).toBe(false);
  });

  it('cancelAll while a touch is undecided, then a late up, does not hop', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.cancelAll();
    g.up(1, 50);
    expect(sample(g, 60)).toEqual(IDLE);
  });

  it('a pointer id reused after its touch ended starts a fresh touch', () => {
    const g = new Gestures(scheme);
    g.down(1, 200, 500, 0);
    g.move(1, 260, 500, 10);
    g.up(1, 20);
    sample(g, 30);
    g.down(1, 100, 300, 1000);
    expect(g.stick.active).toBe(true);
    expect(g.stick.ox).toBe(100);
    expect(g.stick.oy).toBe(300);
    const f = sample(g, 1010);
    expect(f.hop).toBe(false);
    expect(f.steerX).toBe(0);
    g.move(1, 100 + FEEL.stickRadiusPx / 2, 300, 1020);
    expect(sample(g, 1030).steerX).toBeCloseTo(0.5, 6);
  });
});
