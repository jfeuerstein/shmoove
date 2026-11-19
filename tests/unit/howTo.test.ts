import { describe, expect, it } from 'vitest';
import { HOW_TO_LINES, HowTo } from '../../src/ui/howTo';

interface Ev {
  stopped: boolean;
  stopPropagation(): void;
}

class FakeEl {
  className = '';
  textContent = '';
  hidden = false;
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
  /** All text under this element, in order. */
  text(): string {
    return this.textContent + this.children.map((c) => c.text()).join('');
  }
}

function build(): { sheet: HowTo; el: FakeEl; replays: () => number } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const root = new FakeEl();
  let replays = 0;
  const sheet = new HowTo(root as unknown as HTMLElement, () => replays++, doc);
  return { sheet, el: root.children[0], replays: () => replays };
}

const button = (el: FakeEl, label: string): FakeEl => {
  const b = el.children.find((c) => c.textContent === label);
  if (!b) throw new Error(`no ${label} button`);
  return b;
};

describe('HowTo', () => {
  it('has eight lines with the rules in them', () => {
    expect(HOW_TO_LINES).toHaveLength(8);
    const all = HOW_TO_LINES.map((l) => `${l.lead ?? ''} ${l.text}`).join(' ');
    for (const word of ['steer', 'coast', 'ollie', 'Hills', 'fire themselves', 'hurts', 'Sparks', 'card', 'crates', 'shrines', 'gates', 'hoops']) expect(all).toContain(word);
    expect(all).not.toMatch(/gear|trail|loop/i);
  });

  it('is closed at first, shows its eight lines when opened, and closes on its button', () => {
    const { sheet, el } = build();
    expect(el.hidden).toBe(true);
    expect(sheet.isOpen).toBe(false);
    sheet.open();
    expect(el.hidden).toBe(false);
    expect(sheet.isOpen).toBe(true);
    const lines = el.children.filter((c) => c.className === 'howto-line');
    expect(lines).toHaveLength(8);
    expect(lines[0].text()).toBe('Drag: steer. Let go: coast. Tap: ollie.');
    expect(lines[6].text()).toBe('Ollie onto a white rail to grind it. Ollie again to get off.');
    expect(lines[7].text()).toBe('Ride into crates. Circle shrines. Thread the gates. Fly through hoops.');
    button(el, 'CLOSE').fire('click');
    expect(el.hidden).toBe(true);
    expect(sheet.isOpen).toBe(false);
  });

  it('replays the lesson from its button, closing first', () => {
    const { sheet, el, replays } = build();
    sheet.open();
    button(el, 'REPLAY THE LESSON').fire('click');
    expect(replays()).toBe(1);
    expect(sheet.isOpen).toBe(false);
  });

  it('keeps touches off the game', () => {
    const { el } = build();
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      expect(el.fire(t).stopped, t).toBe(true);
    }
  });
});
