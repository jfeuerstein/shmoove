/** Pure text formatting for the boards. */
import { TICK_HZ } from '../sim/constants';

/** Minutes of game time shown by the clock: the day is a 24-hour clock ticking in 5-minute steps. */
export function clockMinutes(dayFrac: number): number {
  const f = dayFrac - Math.floor(dayFrac);
  // A hair of tolerance so 0.3 (07:12 exactly) is not floored to 07:10 by rounding error.
  return (Math.floor((f * 1440) / 5 + 1e-6) * 5) % 1440;
}

/** HH:MM for a minute of the day. */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** Whole seconds a countdown of `ticks` shows (rounded up, so it reads 0:00 only on arrival). */
export function countdownSeconds(ticks: number): number {
  if (!Number.isFinite(ticks)) return -1;
  return Math.max(0, Math.ceil(ticks / TICK_HZ - 1e-9));
}

/** m:ss, or --:-- for no arrival. */
export function countdownText(seconds: number): string {
  if (seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function kmh(speed: number): number {
  return Math.round(Math.abs(speed) * 3.6);
}

/** 0xRRGGBB -> #rrggbb. */
export function hexColor(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

/** Ink or paper, whichever reads better on a background colour. */
export function textOn(c: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1B1A2E' : '#F3EBDD';
}

/** Upper-case for boards. Keeps accents (TRANVÍA). */
export function boardText(s: string): string {
  return s.toLocaleUpperCase('es');
}
