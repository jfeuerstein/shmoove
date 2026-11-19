import { describe, expect, it } from 'vitest';
import { makeWorld, PHASE_DEAD, PHASE_PLAY, PHASE_WON, type World } from '../../src/sim/world';
import { END_PAUSE_SEC, EndScreen, endCard } from '../../src/ui/endScreen';

interface Ev {
  stopped: boolean;
  stopPropagation(): void;
}

class FakeEl {
  className = '';
  textContent = '';
  readonly children: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(e: Ev) => void>>();
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, fn: (e: Ev) => void): void {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  fire(type: string): Ev {
    const ev: Ev = {
      stopped: false,
      stopPropagation() {
        this.stopped = true;
      },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
}

function build(): { screen: EndScreen; el: FakeEl; w: World; taps: () => number; howTos: () => number } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const root = new FakeEl();
  let taps = 0;
  let howTos = 0;
  const w = makeWorld(1);
  const holder: { screen: EndScreen | null } = { screen: null };
  const screen = new EndScreen(
    root as unknown as HTMLElement,
    () => {
      taps++;
      w.run.phase = PHASE_PLAY;
      w.run.ticks = 0;
      holder.screen?.reset();
    },
    doc,
    () => howTos++,
  );
  holder.screen = screen;
  return { screen, el: root.children[0], w, taps: () => taps, howTos: () => howTos };
}

const shown = (el: FakeEl): boolean => el.className.includes('end-show');
const byText = (el: FakeEl, label: string): FakeEl => {
  const b = el.children.find((c) => c.textContent === label);
  if (!b) throw new Error(`no ${label} button`);
  return b;
};
const texts = (el: FakeEl): string => el.children.map((c) => c.textContent).join(' | ');

describe('endCard', () => {
  it('is nothing while playing, whatever the time', () => {
    const w = makeWorld(1);
    expect(endCard(w, 0)).toBeNull();
    expect(endCard(w, 99)).toBeNull();
  });

  it('waits out the pause, then names the run', () => {
    const w = makeWorld(1);
    w.run.phase = PHASE_DEAD;
    w.run.ticks = 75 * 60 + 30;
    w.player.kills = 41;
    w.player.level = 4;
    w.player.pops = 3;
    w.player.bestPop = 12;
    expect(endCard(w, END_PAUSE_SEC - 0.01)).toBeNull();
    w.boss.felled = 1;
    expect(endCard(w, END_PAUSE_SEC)).toEqual({ title: 'STOPPED', time: '1:15', kills: 41, level: 4, pops: 3, bestPop: 12, bosses: 1 });
    // Won only when the final boss falls, whenever that is: the clock does not end a run.
    w.run.phase = PHASE_WON;
    w.run.ticks = 9 * 3600 + 47 * 60;
    w.boss.felled = 3;
    expect(endCard(w, 1)?.title).toBe('CLEARED');
    expect(endCard(w, 1)?.time).toBe('9:47');
    expect(endCard(w, 1)?.bosses).toBe(3);
  });
});

describe('EndScreen', () => {
  it('stays hidden while playing and during the pause', () => {
    const { screen, el, w } = build();
    screen.update(w, 5);
    expect(shown(el)).toBe(false);
    w.run.phase = PHASE_DEAD;
    screen.update(w, END_PAUSE_SEC / 2);
    expect(shown(el)).toBe(false);
  });

  it('shows the card with the numbers for a death', () => {
    const { screen, el, w } = build();
    w.run.phase = PHASE_DEAD;
    w.run.ticks = 61 * 60;
    w.player.kills = 17;
    w.player.level = 3;
    w.player.pops = 2;
    w.player.bestPop = 9;
    w.boss.felled = 0;
    screen.update(w, 0.4);
    screen.update(w, 0.3);
    expect(shown(el)).toBe(true);
    const t = texts(el);
    expect(t).toContain('STOPPED');
    expect(t).toContain('Time  1:01');
    expect(t).toContain('Kills  17');
    expect(t).toContain('Level  3');
    expect(t).toContain('Bosses  0 / 3');
    expect(t).toContain('Loops  2  (best 9)');
    expect(t).toContain('AGAIN');
  });

  it('shows the card with the numbers for a win', () => {
    const { screen, el, w } = build();
    w.run.phase = PHASE_WON;
    w.run.ticks = 10 * 3600 + 5 * 60;
    w.player.kills = 300;
    w.boss.felled = 3;
    screen.update(w, 1);
    expect(shown(el)).toBe(true);
    expect(texts(el)).toContain('CLEARED');
    expect(texts(el)).toContain('Time  10:05');
    expect(texts(el)).toContain('Kills  300');
    expect(texts(el)).toContain('Bosses  3 / 3');
  });

  it('goes again on a tap, hides, and keeps touches off the game', () => {
    const { screen, el, w, taps } = build();
    w.run.phase = PHASE_DEAD;
    screen.update(w, 1);
    expect(shown(el)).toBe(true);
    expect(el.fire('pointerdown').stopped).toBe(true);
    expect(el.fire('touchstart').stopped).toBe(true);
    const button = byText(el, 'AGAIN');
    button.fire('click');
    expect(taps()).toBe(1);
    expect(shown(el)).toBe(false);
    // The next frame, with the run playing again, stays hidden.
    screen.update(w, 1);
    expect(shown(el)).toBe(false);
  });

  it('waits out the pause again after a restart and a second death', () => {
    const { screen, el, w } = build();
    w.run.phase = PHASE_DEAD;
    screen.update(w, 1);
    screen.reset();
    w.run.phase = PHASE_PLAY;
    screen.update(w, 0.016);
    w.run.phase = PHASE_DEAD;
    screen.update(w, 0.1);
    expect(shown(el)).toBe(false);
    screen.update(w, 0.6);
    expect(shown(el)).toBe(true);
  });

  it('has HOW TO PLAY under AGAIN, which opens the sheet only while the card is up', () => {
    const { screen, el, w, taps, howTos } = build();
    const labels = el.children.map((c) => c.textContent);
    expect(labels.indexOf('HOW TO PLAY')).toBe(labels.indexOf('AGAIN') + 1);
    byText(el, 'HOW TO PLAY').fire('click');
    expect(howTos()).toBe(0);
    w.run.phase = PHASE_DEAD;
    screen.update(w, 1);
    byText(el, 'HOW TO PLAY').fire('click');
    expect(howTos()).toBe(1);
    expect(taps()).toBe(0);
    expect(shown(el)).toBe(true);
  });
});
