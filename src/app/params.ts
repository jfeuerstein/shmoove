/** URL parameters that change how the app boots. Parsed once at startup. */
export interface SkitchParams {
  /** manual stepping for the e2e harness: no rAF loop, time advances only via the test hook */
  e2e: boolean;
  /** feel / debug panel */
  debug: boolean;
  /** M1 feel slice */
  slice: boolean;
  /** named scripted route (e.g. 'perf'), or null */
  route: string | null;
  /** world / RNG seed */
  seed: number;
  /** start time of day as a fraction in [0, 1), or null for the default */
  t: number | null;
  /** start with audio muted */
  mute: boolean;
}

const DEFAULT_SEED = 1;

function flag(q: URLSearchParams, name: string): boolean {
  if (!q.has(name)) return false;
  const v = (q.get(name) ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function parseSeed(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_SEED;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_SEED;
  return n;
}

function parseDayFrac(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const f = n - Math.floor(n);
  return f;
}

/** Pure: parse a location.search string (with or without the leading '?'). */
export function parseParams(search: string): SkitchParams {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const route = q.get('route');
  return {
    e2e: flag(q, 'e2e'),
    debug: flag(q, 'debug'),
    slice: flag(q, 'slice'),
    route: route === null || route === '' ? null : route,
    seed: parseSeed(q.get('seed')),
    t: parseDayFrac(q.get('t')),
    mute: flag(q, 'mute'),
  };
}

let cached: SkitchParams | null = null;

/** The params of the current page, parsed on first use. */
export function getParams(): SkitchParams {
  if (cached === null) {
    cached = parseParams(typeof location === 'undefined' ? '' : location.search);
  }
  return cached;
}
