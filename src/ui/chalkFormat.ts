/** Pure text and geometry helpers for the chalk-line screens and HUD. */
import { TICK_HZ } from '../sim/constants';
import { CHALK_NAME_MAX, CHALK_PATH_STRIDE } from '../sim/game/chalk';
import { boardText, clockMinutes, clockText } from './format';

/** m:ss of a tick count (whole seconds, floored): lengths and the REC tag. */
export function chalkClock(ticks: number): string {
  const s = Math.max(0, Math.floor(ticks / TICK_HZ));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** m:ss.t of a tick count (tenths floored): race times. */
export function chalkTime(ticks: number): string {
  const tenths = Math.max(0, Math.floor((ticks * 10) / TICK_HZ + 1e-9));
  const s = Math.floor(tenths / 10);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}.${tenths % 10}`;
}

/**
 * The gap to the ghost in seconds with one decimal and a sign: positive (behind, '+') means the
 * player reached this point later than the ghost did. Zero reads '0.0'. Uses a real minus sign.
 */
export function chalkGap(gapTicks: number): string {
  const tenths = Math.round((Math.abs(gapTicks) * 10) / TICK_HZ);
  if (tenths === 0) return '0.0';
  const txt = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  return (gapTicks > 0 ? '+' : '−') + txt;
}

/** The name prefilled for a new line: the district and the time of day, e.g. "MERCADO STEPS 08:15". */
export function chalkDefaultName(district: string, dayFrac: number): string {
  const time = clockText(clockMinutes(dayFrac));
  const room = CHALK_NAME_MAX - time.length - 1;
  const d = boardText(district.trim());
  const head = d.length > room ? d.slice(0, room).trimEnd() : d;
  return head ? `${head} ${time}` : time;
}

/**
 * Index of the path sample (xyz triples) nearest to (x, z) in plan, searched in a window around
 * `hint` (the previous answer) so a route that crosses itself is followed in order. Returns
 * `hint` clamped when the path is empty.
 */
export function nearestPathIndex(path: Float32Array, x: number, z: number, hint: number, back = 20, ahead = 80): number {
  const n = Math.floor(path.length / 3);
  if (n === 0) return 0;
  const h = Math.min(n - 1, Math.max(0, hint));
  const lo = Math.max(0, h - back);
  const hi = Math.min(n - 1, h + ahead);
  let best = h;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const dx = path[i * 3] - x;
    const dz = path[i * 3 + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Ghost time at path sample `index`, ticks. */
export function ghostTicksAt(index: number, ghostTicks: number): number {
  return Math.min(ghostTicks, index * CHALK_PATH_STRIDE);
}
