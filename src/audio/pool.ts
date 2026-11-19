/**
 * The voice cap. Pure bookkeeping: which of `MAX_VOICES` slots each new voice takes, and which
 * sounding voice is cut to make room. A slot is free once its voice has ended. When none is free,
 * the oldest voice of the same kind is cut; if there is none of that kind, the oldest of all.
 */

export const MAX_VOICES = 24;

export class VoicePool {
  readonly kind: Int16Array;
  readonly start: Float64Array;
  readonly end: Float64Array;
  /** Whether the last `claim` had to cut a sounding voice. */
  evicted = false;

  constructor(readonly size = MAX_VOICES) {
    this.kind = new Int16Array(size).fill(-1);
    this.start = new Float64Array(size);
    this.end = new Float64Array(size);
  }

  /** How many voices are still sounding at `now`. */
  busy(now: number): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) if (this.kind[i] >= 0 && this.end[i] > now) n++;
    return n;
  }

  /** A slot for a voice of `kind` sounding from `start` to `end`, at clock time `now`. */
  claim(kind: number, start: number, end: number, now: number): number {
    let slot = -1;
    let sameOldest = -1;
    let anyOldest = -1;
    for (let i = 0; i < this.size; i++) {
      if (this.kind[i] < 0 || this.end[i] <= now) {
        slot = i;
        break;
      }
      if (anyOldest < 0 || this.start[i] < this.start[anyOldest]) anyOldest = i;
      if (this.kind[i] === kind && (sameOldest < 0 || this.start[i] < this.start[sameOldest])) sameOldest = i;
    }
    this.evicted = slot < 0;
    if (slot < 0) slot = sameOldest >= 0 ? sameOldest : anyOldest;
    this.kind[slot] = kind;
    this.start[slot] = start;
    this.end[slot] = end;
    return slot;
  }

  reset(): void {
    this.kind.fill(-1);
  }
}
