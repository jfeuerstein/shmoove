import { describe, expect, it } from 'vitest';
import { TOAST_LIFE, TOAST_MAX, ToastQueue } from '../../../src/ui/toastQueue';

describe('toast queue', () => {
  it('caps at three, newest first, dropping the oldest', () => {
    const q = new ToastQueue<number>();
    expect(TOAST_MAX).toBe(3);
    const dropped: number[] = [];
    for (let i = 1; i <= 5; i++) dropped.push(...q.push('inked', i).dropped.map((t) => t.data));
    expect(q.items.map((t) => t.data)).toEqual([5, 4, 3]);
    expect(dropped).toEqual([1, 2]);
    expect(q.newest?.data).toBe(5);
  });

  it('expires each toast after its lifetime', () => {
    const q = new ToastQueue<string>();
    expect(TOAST_LIFE).toBeCloseTo(3.5, 9);
    q.push('inked', 'a');
    q.update(1);
    q.push('complete', 'b');
    expect(q.update(TOAST_LIFE - 1 - 0.01)).toEqual([]);
    const gone = q.update(0.02);
    expect(gone.map((t) => t.data)).toEqual(['a']);
    expect(q.items.map((t) => t.kind)).toEqual(['complete']);
    q.update(1);
    expect(q.items.length).toBe(0);
    expect(q.newest).toBeNull();
  });
});
