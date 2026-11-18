/** Pure toast bookkeeping: newest first, capped, each expiring after its lifetime. */

export const TOAST_MAX = 3;
export const TOAST_LIFE = 3.5;

export type ToastKind =
  | 'inked'
  | 'complete'
  | 'discovered'
  | 'denied'
  | 'map'
  | 'chalk-saved'
  | 'chalk-discarded'
  | 'chalk-won'
  | 'chalk-lost'
  | 'errand-done'
  | 'errand-fail'
  | 'conductor'
  | 'conductor-punch'
  | 'secret'
  | 'tile'
  | 'spot'
  | 'postcard'
  | 'unlock'
  | 'best';

export interface Toast<T> {
  id: number;
  kind: ToastKind;
  data: T;
  age: number;
}

export class ToastQueue<T> {
  /** Visible toasts, newest first. */
  readonly items: Toast<T>[] = [];
  private nextId = 1;

  constructor(
    readonly max = TOAST_MAX,
    readonly life = TOAST_LIFE,
  ) {}

  /** Add a toast; returns those pushed out by the cap (oldest first out). */
  push(kind: ToastKind, data: T): { added: Toast<T>; dropped: Toast<T>[] } {
    const added: Toast<T> = { id: this.nextId++, kind, data, age: 0 };
    this.items.unshift(added);
    const dropped = this.items.length > this.max ? this.items.splice(this.max) : [];
    return { added, dropped };
  }

  /** Age every toast by dt seconds; returns the ones that expired. */
  update(dt: number): Toast<T>[] {
    let expired: Toast<T>[] | null = null;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i];
      t.age += dt;
      if (t.age >= this.life) {
        (expired ??= []).push(t);
        this.items.splice(i, 1);
      }
    }
    return expired ?? NONE;
  }

  get newest(): Toast<T> | null {
    return this.items.length > 0 ? this.items[0] : null;
  }
}

const NONE: never[] = [];
