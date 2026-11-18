/**
 * Re-finds the ground lines' dwells and phases (src/sim/city/lines.ts) by search. Skipped unless
 * asked for:
 *
 *   SKITCH_FIND_TIMETABLE=1 npx vitest run tests/sim/findTimetable.test.ts --silent=false
 *
 * prints, per ground line, the dwell and phase to write into CITY_LINES. What it holds to (the
 * same as tests/sim/cityLines.test.ts checks):
 * - No two vehicles' bodies overlap while both are in service, the same line's included: a car home
 *   from its lap must not stand on the one leaving. The lap's padding to its period stands at the
 *   terminus, so a line's dwell is raised (the padding spread over its stops) until the car coming
 *   home arrives after the one leaving has gone.
 * - Every meeting in MEETINGS happens at least every `everyTicks` while both lines run, and where
 *   the second ride is the faster one it comes past the first from behind (the two-link chain
 *   tests look for that moment).
 * - Headways stay what they are (a dwell never pushes a lap into a longer period), and the hours.
 * Only the second line of each meeting (and the lines it overlaps) is re-phased; A1-A3 and S1-S3
 * are never touched.
 */
import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/sim/city';
import { CITY_LINES, MEETINGS, cityLineDef, type CityLineSpec } from '../../src/sim/city/lines';
import { DAY_TICKS, resetFeel } from '../../src/sim/constants';
import { compileLine, grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../../src/sim/lines';
import { findZone } from '../../src/sim/world';

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Lines whose dwell and phase the search may change (the lead's limits for M7a). */
const TUNABLE = new Set(['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'T1', 'T2', 'T3', 'T4']);

/** Do two vehicle bodies (oriented boxes in plan) overlap? */
export function bodiesOverlap(a: CompiledLine, A: VehicleState, b: CompiledLine, B: VehicleState): boolean {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const axes = [A.hx, A.hz, -A.hz, A.hx, B.hx, B.hz, -B.hz, B.hx];
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i];
    const uz = axes[i + 1];
    const ra = a.bodyHalfLen * Math.abs(A.hx * ux + A.hz * uz) + a.bodyHalfWid * Math.abs(-A.hz * ux + A.hx * uz);
    const rb = b.bodyHalfLen * Math.abs(B.hx * ux + B.hz * uz) + b.bodyHalfWid * Math.abs(-B.hz * ux + B.hx * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}

/** Overlaps between the vehicles of `a` and `b` (the same line's pairs when a === b), sampled every 10 ticks. */
export function overlaps(a: CompiledLine, b: CompiledLine, limit = 1): number {
  const A = Array.from({ length: a.vehicles }, () => makeVehicleState());
  const B = a === b ? A : Array.from({ length: b.vehicles }, () => makeVehicleState());
  let n = 0;
  for (let t = 0; t < DAY_TICKS && n < limit; t += 10) {
    A.forEach((v, i) => vehicleAt(a, i, t, v));
    if (a !== b) B.forEach((v, i) => vehicleAt(b, i, t, v));
    for (let i = 0; i < A.length; i++) {
      if (!A[i].active) continue;
      for (let j = a === b ? i + 1 : 0; j < B.length; j++) {
        if (!B[j].active || Math.abs(A[i].y - B[j].y) > 4) continue;
        if (bodiesOverlap(a, A[i], b, B[j])) n++;
      }
    }
  }
  return n;
}

/** The longest stretch (ticks) both lines run without meeting at the zone, or Infinity if they never meet. */
export function worstGap(w: ReturnType<typeof buildCity>['world'], a: CompiledLine, b: CompiledLine, zoneId: string): number {
  const z = findZone(w, zoneId);
  if (!z) throw new Error(zoneId);
  const n = DAY_TICKS / 10;
  const A = Array.from({ length: a.vehicles }, () => makeVehicleState());
  const B = Array.from({ length: b.vehicles }, () => makeVehicleState());
  const ga = { x: 0, y: 0, z: 0 };
  const gb = { x: 0, y: 0, z: 0 };
  const service = new Uint8Array(n);
  const met = new Uint8Array(n);
  let any = false;
  for (let k = 0; k < n; k++) {
    const t = k * 10;
    A.forEach((v, i) => vehicleAt(a, i, t, v));
    B.forEach((v, i) => vehicleAt(b, i, t, v));
    if (!A.some((v) => v.active) || !B.some((v) => v.active)) continue;
    service[k] = 1;
    for (const va of A) {
      if (met[k] || !va.active || Math.hypot(va.x - z.x, va.z - z.z) > z.r + 12) continue;
      for (const vb of B) {
        if (!vb.active || Math.hypot(vb.x - z.x, vb.z - z.z) > z.r + 12 || Math.hypot(va.x - vb.x, va.z - vb.z) > 12) continue;
        grabPoint(a, va, ga);
        grabPoint(b, vb, gb);
        if (Math.abs(ga.y - gb.y) <= 4) {
          met[k] = 1;
          any = true;
          break;
        }
      }
    }
  }
  if (!any) return Infinity;
  let worst = 0;
  let run = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      if (met[k]) run = 0;
      else if (service[k]) {
        run++;
        if (pass === 1) worst = Math.max(worst, run * 10);
      } else run = 0;
    }
  }
  return worst;
}

/** Does a vehicle of b draw level with one of a at the zone, the same way and faster? */
export function overtakes(w: ReturnType<typeof buildCity>['world'], a: CompiledLine, b: CompiledLine, zoneId: string): boolean {
  const z = findZone(w, zoneId);
  if (!z) throw new Error(zoneId);
  const A = makeVehicleState();
  const B = makeVehicleState();
  for (let t = 0; t < DAY_TICKS; t += 2) {
    for (let i = 0; i < a.vehicles; i++) {
      vehicleAt(a, i, t, A);
      if (!A.active || Math.hypot(A.x - z.x, A.z - z.z) > z.r + 12) continue;
      for (let j = 0; j < b.vehicles; j++) {
        vehicleAt(b, j, t, B);
        if (!B.active || Math.hypot(A.x - B.x, A.z - B.z) > 12) continue;
        const along = (B.x - A.x) * A.hx + (B.z - A.z) * A.hz;
        const vrel = (B.vx - A.vx) * A.hx + (B.vz - A.vz) * A.hz;
        if (A.hx * B.hx + A.hz * B.hz > 0.8 && Math.abs(along) < 1 && vrel > 1) return true;
      }
    }
  }
  return false;
}

/** Where `a` and `b` first overlap (for the report). */
function where(a: CompiledLine, b: CompiledLine): string {
  const A = makeVehicleState();
  const B = makeVehicleState();
  const seen = new Set<string>();
  for (let t = 0; t < DAY_TICKS; t += 10) {
    for (let i = 0; i < a.vehicles; i++) {
      vehicleAt(a, i, t, A);
      if (!A.active) continue;
      for (let j = a === b ? i + 1 : 0; j < b.vehicles; j++) {
        vehicleAt(b, j, t, B);
        if (B.active && Math.abs(A.y - B.y) <= 4 && bodiesOverlap(a, A, b, B)) seen.add(`${Math.round(A.x / 10) * 10},${Math.round(A.z / 10) * 10}`);
      }
    }
  }
  return [...seen].slice(0, 8).join(' ');
}

describe.skipIf(!ENV.SKITCH_FIND_TIMETABLE)('find the ground timetable', () => {
  it('prints dwells and phases', () => {
    resetFeel();
    const city = buildCity(1);
    const w = city.world;
    const specs: CityLineSpec[] = CITY_LINES.map((s) => ({ ...s }));
    const compile = (k: number): CompiledLine => compileLine(cityLineDef(w, specs[k], city.routes[specs[k].id]), k);
    const lines: CompiledLine[] = specs.map((_, k) => compile(k));
    const idx = (id: string): number => specs.findIndex((s) => s.id === id);
    const ground = (): number[] => lines.map((l, k) => (l.overhead ? -1 : k)).filter((k) => k >= 0);
    const notes: string[] = [];

    if (ENV.SKITCH_FIND_TIMETABLE === 'report') {
      const g = ground();
      for (const i of g) for (const j of g) if (j >= i) {
        const n = overlaps(lines[i], lines[j], 100000);
        if (n > 0) console.info(`PAIR ${specs[i].id}/${specs[j].id} ${n} overlapping samples (${where(lines[i], lines[j])})`);
      }
      return;
    }
    // 1. Each ground line on its own: raise the dwell until no car stands on another.
    for (const k of ground()) {
      if (!TUNABLE.has(specs[k].id)) continue;
      const period = lines[k].period;
      while (overlaps(lines[k], lines[k]) > 0) {
        specs[k] = { ...specs[k], dwell: specs[k].dwell + 1 };
        const next = compile(k);
        if (next.period !== period) throw new Error(`${specs[k].id}: dwell ${specs[k].dwell} pushes the lap past its period`);
        lines[k] = next;
      }
    }

    // 2. Lines that share a street with another line drive in their own lane: try lanes further
    //    right for a line that overlaps another, keeping the one with the fewest overlaps.
    /** Overlap samples between line k and every other ground line, counting up to `limit`. */
    const crossCount = (k: number, limit = 100000): number => {
      let n = 0;
      for (const j of ground()) if (j !== k && n < limit) n += overlaps(lines[k], lines[j], limit - n);
      return n;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (const k of ground()) {
        if (!TUNABLE.has(specs[k].id) || specs[k].lane === 0 || crossCount(k, 1) === 0) continue;
        let best = { lane: specs[k].lane, n: crossCount(k) };
        for (const lane of [1.6, 2.4, 3.2, 4.0, 4.8, 5.6]) {
          specs[k] = { ...specs[k], lane };
          lines[k] = compile(k);
          if (overlaps(lines[k], lines[k]) > 0) continue;
          const n = crossCount(k, best.n);
          if (n < best.n) best = { lane, n };
        }
        specs[k] = { ...specs[k], lane: best.lane };
        lines[k] = compile(k);
      }
    }

    // 3. Meetings, then any line still overlapping another at a crossing: re-phase it.
    const crossHits = (k: number): number => crossCount(k);
    const meetingOk = (m: (typeof MEETINGS)[number]): boolean => {
      const a = lines[idx(m.a)];
      const b = lines[idx(m.b)];
      return worstGap(w, a, b, m.zone) <= m.everyTicks && (b.cruise <= a.cruise || overtakes(w, a, b, m.zone));
    };
    const meetingsOf = (id: string): boolean => MEETINGS.every((x) => (x.a !== id && x.b !== id) || meetingOk(x));
    const rephase = (k: number): boolean => {
      const period = lines[k].period;
      const base = specs[k].phase;
      let best = { phase: base, n: meetingsOf(specs[k].id) ? crossHits(k) : Infinity };
      for (let dp = 30; dp < period && best.n > 0; dp += 30) {
        specs[k] = { ...specs[k], phase: (base + dp) % period };
        lines[k] = compile(k);
        const n = crossCount(k, best.n);
        if (n >= best.n || !meetingsOf(specs[k].id)) continue;
        if (n < best.n) best = { phase: specs[k].phase, n };
      }
      specs[k] = { ...specs[k], phase: best.phase };
      lines[k] = compile(k);
      return best.n === 0;
    };
    for (const m of MEETINGS) {
      const kb = idx(m.b);
      if (!TUNABLE.has(m.b) || (meetingOk(m) && crossHits(kb) === 0)) continue;
      if (!rephase(kb)) notes.push(`${m.b} for ${m.zone}: ${meetingOk(m) ? 'meets, but still overlaps' : 'no meeting'} (${crossHits(kb)} overlapping samples)`);
    }
    for (const k of ground()) {
      if (!TUNABLE.has(specs[k].id) || crossHits(k) === 0) continue;
      if (!rephase(k)) notes.push(`${specs[k].id}: ${crossHits(k)} overlapping samples left`);
    }

    const out = ground()
      .filter((k) => TUNABLE.has(specs[k].id))
      .map((k) => `${specs[k].id}: lane ${specs[k].lane} (was ${CITY_LINES[k].lane}), dwell ${specs[k].dwell} (was ${CITY_LINES[k].dwell}), phase ${specs[k].phase} (was ${CITY_LINES[k].phase}), headway ${(lines[k].period / lines[k].vehicles / 60).toFixed(1)} s`);
    console.info(`ground timetable\n${out.join('\n')}${notes.length ? `\nnot found:\n${notes.join('\n')}` : ''}`);
    expect(notes).toEqual([]);
  }, 1_800_000);
});
