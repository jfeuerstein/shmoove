/**
 * Animation on twos, clocked by the UI's frame dt rather than CSS wall-clock time: an element
 * gets class `a` for one step (1/12 s), class `b` for the next, then neither. Clocking it from
 * the frame keeps the UI in lockstep with the game, so screenshots taken in the stepped e2e
 * harness show the same thing a player sees at that moment.
 */
export const TWOS_STEP = 1 / 12;

interface Item {
  el: HTMLElement;
  a: string;
  b: string;
  t: number;
  phase: number;
  fresh: boolean;
  done: (() => void) | null;
}

export class Twos {
  private readonly items: Item[] = [];
  private readonly pool: Item[] = [];

  /** Start (or restart) a two-step animation on `el`. `done` runs when it ends. */
  play(el: HTMLElement, a: string, b: string, done: (() => void) | null = null): void {
    for (const it of this.items) {
      if (it.el !== el) continue;
      this.clear(it);
      this.init(it, el, a, b, done);
      return;
    }
    const it = this.pool.pop() ?? { el, a, b, t: 0, phase: 0, fresh: true, done: null };
    this.init(it, el, a, b, done);
    this.items.push(it);
  }

  /** Stop any animation on `el` without running its `done`. */
  cancel(el: HTMLElement): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.el !== el) continue;
      this.clear(it);
      this.items.splice(i, 1);
      it.done = null;
      this.pool.push(it);
      return;
    }
  }

  get active(): number {
    return this.items.length;
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      // An animation started this frame shows its first step for a whole frame.
      if (it.fresh) {
        it.fresh = false;
        continue;
      }
      it.t += dt;
      const phase = it.t < TWOS_STEP ? 0 : it.t < 2 * TWOS_STEP ? 1 : 2;
      if (phase === it.phase) continue;
      it.phase = phase;
      if (phase === 1) {
        if (it.a) it.el.classList.remove(it.a);
        if (it.b) it.el.classList.add(it.b);
        continue;
      }
      this.clear(it);
      this.items.splice(i, 1);
      const done = it.done;
      it.done = null;
      this.pool.push(it);
      if (done) done();
    }
  }

  private init(it: Item, el: HTMLElement, a: string, b: string, done: (() => void) | null): void {
    it.el = el;
    it.a = a;
    it.b = b;
    it.t = 0;
    it.phase = 0;
    it.fresh = true;
    it.done = done;
    if (a) el.classList.add(a);
  }

  private clear(it: Item): void {
    if (it.a) it.el.classList.remove(it.a);
    if (it.b) it.el.classList.remove(it.b);
  }
}
