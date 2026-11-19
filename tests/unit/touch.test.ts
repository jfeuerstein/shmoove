import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMES, type Scheme } from '../../src/input/source';
import { TouchInput } from '../../src/input/touch';
import { FEEL, resetFeel } from '../../src/sim/constants';
import { makeInputFrame, type InputFrame } from '../../src/sim/types';

/** The few members of an element and a pointer event that `TouchInput` touches. */
class FakeEl {
  private readonly handlers = new Map<string, (e: unknown) => void>();
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.handlers.set(type, fn);
  }
  removeEventListener(type: string): void {
    this.handlers.delete(type);
  }
  setPointerCapture(): void {}
  fire(type: string, id: number, x = 0, y = 0): void {
    const fn = this.handlers.get(type);
    if (fn) fn({ pointerId: id, clientX: x, clientY: y, preventDefault() {} });
  }
}

function sample(input: TouchInput): InputFrame {
  const f = makeInputFrame();
  input.sample(f);
  return f;
}

beforeEach(() => {
  resetFeel();
  const target = { addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal('window', target);
  vi.stubGlobal('document', { ...target, hidden: false });
  vi.stubGlobal('performance', { now: () => 0 });
});
afterEach(() => vi.unstubAllGlobals());

function make(scheme: Scheme): { el: FakeEl; input: TouchInput } {
  const el = new FakeEl();
  return { el, input: new TouchInput(el as unknown as HTMLElement, scheme) };
}

describe.each(SCHEMES)('%s: a lost pointer capture', (scheme: Scheme) => {
  it('ends a touch whose pointerup never came, so the stick does not stay deflected', () => {
    const { el, input } = make(scheme);
    el.fire('pointerdown', 1, 200, 500);
    el.fire('pointermove', 1, 200 + FEEL.stickRadiusPx, 500);
    expect(sample(input).steerX).toBeCloseTo(1, 6);
    el.fire('lostpointercapture', 1);
    const f = sample(input);
    expect(f.steerX).toBe(0);
    expect(f.carve).toBe(false);
    expect(input.gestures.stick.active).toBe(false);
  });

  it('is not counted twice when the pointerup arrived as well', () => {
    const { el, input } = make(scheme);
    el.fire('pointerdown', 1, 200, 500);
    el.fire('pointerup', 1);
    el.fire('lostpointercapture', 1);
    const hops = [sample(input).hop, sample(input).hop].filter(Boolean).length;
    // A quick tap hops once in tuck and lift, never in swipe.
    expect(hops).toBe(scheme === 'swipe' ? 0 : 1);
  });

  it('does not end a different touch that began after the first', () => {
    const { el, input } = make(scheme);
    el.fire('pointerdown', 1, 200, 500);
    el.fire('pointerup', 1);
    el.fire('pointerdown', 2, 100, 400);
    el.fire('lostpointercapture', 1);
    expect(input.gestures.stick.active).toBe(true);
  });
});
