/**
 * Stepped N-S profiles: a street that is level across every crossing (spans) and climbs in
 * flights between them. Stair streets, the spine and the funicular bed are all built this way.
 */
import { Surface } from '../world';

export interface Span {
  z0: number;
  z1: number;
  h: (x: number, z: number) => number;
  surf: number;
}

export interface Flight {
  /** Bottom and top z of the flight (the skater descends from zHi to zLo). */
  zLo: number;
  zHi: number;
  /** Heights at the profile's axis. */
  yLo: number;
  yHi: number;
}

interface Piece {
  z0: number;
  z1: number;
  /** Span index, or -1 for a flight / mid landing between spans a and a+1. */
  span: number;
  a: number;
  f0: number;
  f1: number;
  surf: number;
}

export interface StepperOpts {
  /** x where flight counts and grades are chosen. */
  axis: number;
  /** Surface of flights and of the landings between them. */
  flightSurf: number;
  midSurf: number;
  /** Mid landing length. 0 = always a single flight. */
  midLen: number;
  minGrade: number;
  maxGrade: number;
}

export class Stepper {
  readonly spans: Span[];
  readonly pieces: Piece[] = [];
  readonly flights: Flight[] = [];
  readonly z0: number;
  readonly z1: number;

  constructor(spans: Span[], o: StepperOpts) {
    this.spans = spans;
    this.z0 = spans[0].z0;
    this.z1 = spans[spans.length - 1].z1;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      this.pieces.push({ z0: s.z0, z1: s.z1, span: i, a: i, f0: 0, f1: 0, surf: s.surf });
      if (i === spans.length - 1) break;
      const n = spans[i + 1];
      const zA = s.z1;
      const zB = n.z0;
      if (zB <= zA + 1e-6) continue;
      const yA = s.h(o.axis, zA);
      const yB = n.h(o.axis, zB);
      let best = 1;
      let bestErr = Infinity;
      const ideal = (o.minGrade + o.maxGrade) / 2;
      const maxN = o.midLen > 0 ? 3 : 1;
      for (let k = 1; k <= maxN; k++) {
        const run = zB - zA - o.midLen * (k - 1);
        if (run <= 2) break;
        const g = (yB - yA) / run;
        const out = g < o.minGrade ? o.minGrade - g : g > o.maxGrade ? g - o.maxGrade : 0;
        const err = out * 100 + Math.abs(g - ideal);
        if (err < bestErr) {
          bestErr = err;
          best = k;
        }
      }
      const run = (zB - zA - o.midLen * (best - 1)) / best;
      let z = zA;
      for (let k = 0; k < best; k++) {
        const fa = k / best;
        const fb = (k + 1) / best;
        this.pieces.push({ z0: z, z1: z + run, span: -1, a: i, f0: fa, f1: fb, surf: o.flightSurf });
        this.flights.push({ zLo: z, zHi: z + run, yLo: yA + (yB - yA) * fa, yHi: yA + (yB - yA) * fb });
        z += run;
        if (k < best - 1) {
          this.pieces.push({ z0: z, z1: z + o.midLen, span: -1, a: i, f0: fb, f1: fb, surf: o.midSurf });
          z += o.midLen;
        }
      }
    }
  }

  private piece(z: number): Piece {
    const P = this.pieces;
    let lo = 0;
    let hi = P.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (P[mid].z0 <= z) lo = mid;
      else hi = mid - 1;
    }
    return P[lo];
  }

  h(x: number, z: number): number {
    const p = this.piece(z);
    if (p.span >= 0) return this.spans[p.span].h(x, z);
    const A = this.spans[p.a];
    const B = this.spans[p.a + 1];
    const yA = A.h(x, A.z1);
    const yB = B.h(x, B.z0);
    const t = p.z1 > p.z0 ? (z - p.z0) / (p.z1 - p.z0) : 0;
    const f = p.f0 + (p.f1 - p.f0) * (t < 0 ? 0 : t > 1 ? 1 : t);
    return yA + (yB - yA) * f;
  }

  surf(z: number): number {
    return this.piece(z).surf;
  }

  isFlight(z: number): boolean {
    const p = this.piece(z);
    return p.span < 0 && p.f1 > p.f0;
  }
}

export const STAIR_OPTS: Omit<StepperOpts, 'axis'> = {
  flightSurf: Surface.STAIRS,
  midSurf: Surface.PLAZA,
  midLen: 8,
  minGrade: 0.25,
  maxGrade: 0.45,
};
