/**
 * The look-ahead scheduler: walks the loop bar by bar against a clock and hands each note to a sink
 * a little before it is due. Pure: the clock is a number passed in, the sink an object.
 *
 * Rules: every note is offered once, in time order, never after its time. If the clock jumps past
 * notes (a stalled tab), those are dropped, not played late, and whole bars that went by are
 * skipped so the loop stays on its grid.
 */
import { BAR, makeNoteBuf, stepTime, writeBar, type Groove, type NoteBuf } from './music';

/** How far ahead of the clock notes are queued, s. */
export const LOOKAHEAD = 0.12;
/** The first bar starts this long after `start`, s, so its first note is never late. */
export const START_DELAY = 0.06;

export interface NoteSink {
  /** Note `i` of `buf` is due at `when` (audio clock, s). */
  note(buf: NoteBuf, i: number, when: number): void;
}

export class MusicScheduler {
  readonly buf: NoteBuf = makeNoteBuf();
  /** Semitones added to every pitched note from the next bar written on. */
  transpose = 0;
  /** Notes handed to the sink, and notes skipped because their time had passed. */
  queued = 0;
  dropped = 0;
  private groove: Groove;
  private running = false;
  private bar = 0;
  private barStart = 0;
  private idx = 0;
  /** The last bar to play, or -1 to play on. */
  private lastBar = -1;

  constructor(groove: Groove) {
    this.groove = groove;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** When the bar being played began, s. */
  get currentBarStart(): number {
    return this.barStart;
  }

  get currentBar(): number {
    return this.bar;
  }

  /** Start the loop from bar 0 at `now + START_DELAY`. */
  start(now: number): void {
    this.running = true;
    this.lastBar = -1;
    this.bar = 0;
    this.barStart = now + START_DELAY;
    this.idx = 0;
    writeBar(this.groove, this.bar, this.transpose, this.buf);
  }

  stop(): void {
    this.running = false;
  }

  /** Play out the current bar and stop. Returns when the next bar would have begun, s. */
  stopAtBarEnd(): number {
    if (this.running) this.lastBar = this.bar;
    return this.barStart + BAR;
  }

  /** Queue every note due before `now + LOOKAHEAD`. Returns how many were queued. */
  pump(now: number, sink: NoteSink): number {
    if (!this.running) return 0;
    const horizon = now + LOOKAHEAD;
    let n = 0;
    for (;;) {
      if (this.idx >= this.buf.count) {
        if (this.lastBar >= 0 && this.bar >= this.lastBar) {
          this.running = false;
          break;
        }
        this.bar++;
        this.barStart += BAR;
        // Whole bars that went by while nobody pumped are skipped, keeping the grid.
        while (this.barStart + BAR <= now && (this.lastBar < 0 || this.bar < this.lastBar)) {
          this.bar++;
          this.barStart += BAR;
        }
        this.idx = 0;
        writeBar(this.groove, this.bar, this.transpose, this.buf);
        continue;
      }
      const t = this.barStart + stepTime(this.buf.step[this.idx]);
      if (t >= horizon) break;
      if (t >= now) {
        sink.note(this.buf, this.idx, t);
        this.queued++;
        n++;
      } else this.dropped++;
      this.idx++;
    }
    return n;
  }
}
