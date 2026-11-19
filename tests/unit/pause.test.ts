import { describe, expect, it } from 'vitest';
import { bindAutoPause, pauseButtonShown, PauseView } from '../../src/ui/pause';
import { PHASE_CHOOSE, PHASE_DEAD, PHASE_PLAY, PHASE_WON } from '../../src/sim/world';

type Listener = (e: { stopPropagation(): void }) => void;

/** Just enough of an element: children, a class, listeners that can be fired. */
class FakeEl {
  className = '';
  hidden = false;
  textContent = '';
  type = '';
  blurred = 0;
  readonly style: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  readonly listeners = new Map<string, Listener[]>();
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, fn: Listener): void {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  blur(): void {
    this.blurred++;
  }
  /** Fire `type`; true if something stopped it going further. */
  fire(type: string): boolean {
    let stopped = false;
    for (const fn of this.listeners.get(type) ?? []) fn({ stopPropagation: () => (stopped = true) });
    return stopped;
  }
  find(cls: string): FakeEl | undefined {
    if (this.className.split(' ').includes(cls)) return this;
    for (const c of this.children) {
      const f = c.find(cls);
      if (f) return f;
    }
    return undefined;
  }
}

function build(debug = false): { view: PauseView; root: FakeEl; calls: string[]; part: (cls: string) => FakeEl } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const root = new FakeEl();
  const calls: string[] = [];
  const view = new PauseView(
    root as unknown as HTMLElement,
    { onPause: () => calls.push('pause'), onResume: () => calls.push('resume'), onHowTo: () => calls.push('howto') },
    { debug },
    doc,
  );
  const part = (cls: string): FakeEl => {
    const e = root.find(cls);
    if (!e) throw new Error(`no ${cls}`);
    return e;
  };
  return { view, root, calls, part };
}

describe('pauseButtonShown', () => {
  it('offers the button while the run is played or a card is chosen, never in the lesson or after the run', () => {
    expect(pauseButtonShown(PHASE_PLAY, false)).toBe(true);
    expect(pauseButtonShown(PHASE_CHOOSE, false)).toBe(true);
    expect(pauseButtonShown(PHASE_DEAD, false)).toBe(false);
    expect(pauseButtonShown(PHASE_WON, false)).toBe(false);
    expect(pauseButtonShown(PHASE_PLAY, true)).toBe(false);
  });
});

describe('PauseView', () => {
  it('pauses from its button and shows PAUSED with RESUME and HOW TO PLAY', () => {
    const { view, calls, part } = build();
    const overlay = part('pause');
    const button = part('pause-btn');
    expect(view.paused).toBe(false);
    expect(overlay.hidden).toBe(true);
    button.fire('click');
    expect(view.paused).toBe(true);
    expect(calls).toEqual(['pause']);
    expect(overlay.hidden).toBe(false);
    expect(button.hidden).toBe(true);
    expect(button.blurred).toBe(1);
    expect(part('pause-title').textContent).toBe('PAUSED');
    expect(part('pause-resume').textContent).toBe('RESUME');
    expect(part('pause-howto').textContent).toBe('HOW TO PLAY');
    part('pause-howto').fire('click');
    expect(calls).toEqual(['pause', 'howto']);
    expect(view.paused).toBe(true);
    part('pause-resume').fire('click');
    expect(view.paused).toBe(false);
    expect(calls).toEqual(['pause', 'howto', 'resume']);
    expect(overlay.hidden).toBe(true);
    expect(button.hidden).toBe(false);
  });

  it('pauses and resumes once however often it is asked', () => {
    const { view, calls } = build();
    view.resume();
    view.pause();
    view.pause();
    view.resume();
    view.resume();
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('keeps every touch on the button and the overlay from reaching the game', () => {
    const { part } = build();
    for (const cls of ['pause-btn', 'pause']) {
      for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend']) {
        expect(part(cls).fire(type), `${cls} ${type}`).toBe(true);
      }
    }
  });

  it('hides the button in the lesson and after the run, and brings it back after a resume only when it is offered', () => {
    const { view, part } = build();
    const button = part('pause-btn');
    view.update(PHASE_PLAY, true);
    expect(button.hidden).toBe(true);
    view.update(PHASE_PLAY, false);
    expect(button.hidden).toBe(false);
    view.pause();
    view.update(PHASE_DEAD, false);
    expect(button.hidden).toBe(true);
    view.resume();
    expect(button.hidden).toBe(true);
  });

  it('sits beside the feel panel button in debug', () => {
    expect(build(true).part('pause-btn').className).toBe('pause-btn pause-btn-debug');
    expect(build(false).part('pause-btn').className).toBe('pause-btn');
  });
});

describe('bindAutoPause', () => {
  function targets(): { win: FakeEl; doc: FakeEl & { visibilityState: string }; n: { pauses: number }; unbind: () => void } {
    const win = new FakeEl();
    const doc = Object.assign(new FakeEl(), { visibilityState: 'visible' });
    const n = { pauses: 0 };
    const unbind = bindAutoPause(win as unknown as Window, doc as unknown as Document, () => n.pauses++);
    return { win, doc, n, unbind };
  }

  it('pauses when the page is hidden, on pagehide, and on blur, not when it is shown again', () => {
    const { win, doc, n } = targets();
    doc.fire('visibilitychange');
    expect(n.pauses).toBe(0);
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(n.pauses).toBe(1);
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    expect(n.pauses).toBe(1);
    win.fire('pagehide');
    win.fire('blur');
    expect(n.pauses).toBe(3);
  });

  it('can be unbound', () => {
    const { win, n, unbind } = targets();
    unbind();
    win.fire('blur');
    expect(n.pauses).toBe(0);
  });
});
