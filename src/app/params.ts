/**
 * URL parameters. Pure: give it `location.search`, get the settings the boot uses.
 *
 * - `debug`  flag: the feel panel.
 * - `hook`   flag: install `window.__shmoove` for the e2e and perf runners.
 * - `perf`   flag: the run is being measured.
 * - `flat`   flag: flat ground instead of the bowl (a fixture for tests that need level ground).
 * - `solo`   flag: the mover alone on the bowl, no horde (the feel slice).
 * - `seed`   integer, default 1: the map seed.
 * - `scheme` `tuck` | `lift` | `swipe`, default `tuck`: the control scheme.
 * - `horde`  integer >= 0, default 0: the crowd fixture's enemies (see `fixtures.ts`).
 * - `sparks` integer >= 0, default 0: the crowd fixture's sparks.
 * - `arsenal` flag: every weapon at level 3 and one of each map thing and zone ahead of the spawn
 *   (see `fixtures.ts`), with cards answered at once.
 */
import { SCHEMES, type Scheme } from '../input/source';

export interface Params {
  debug: boolean;
  hook: boolean;
  perf: boolean;
  flat: boolean;
  solo: boolean;
  seed: number;
  scheme: Scheme;
  horde: number;
  sparks: number;
  arsenal: boolean;
}

export const DEFAULT_SEED = 1;
export const DEFAULT_SCHEME: Scheme = 'tuck';

/** A flag is on when present, unless it is explicitly `0`, `false`, `no` or `off`. */
function flag(q: URLSearchParams, name: string): boolean {
  const v = q.get(name);
  if (v === null) return false;
  const s = v.trim().toLowerCase();
  return s !== '0' && s !== 'false' && s !== 'no' && s !== 'off';
}

function seed(q: URLSearchParams): number {
  const v = q.get('seed');
  if (v === null) return DEFAULT_SEED;
  const s = v.trim();
  if (!/^[+-]?\d+$/.test(s)) return DEFAULT_SEED;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : DEFAULT_SEED;
}

function scheme(q: URLSearchParams): Scheme {
  const v = q.get('scheme');
  if (v === null) return DEFAULT_SCHEME;
  const s = v.trim().toLowerCase();
  for (const k of SCHEMES) if (k === s) return k;
  return DEFAULT_SCHEME;
}

/** A non-negative integer, or 0. */
function count(q: URLSearchParams, name: string): number {
  const v = q.get(name);
  if (v === null) return 0;
  const s = v.trim();
  if (!/^\+?\d+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : 0;
}

export function parseParams(search: string): Params {
  const q = new URLSearchParams(search);
  return { debug: flag(q, 'debug'), hook: flag(q, 'hook'), perf: flag(q, 'perf'), flat: flag(q, 'flat'), solo: flag(q, 'solo'), seed: seed(q), scheme: scheme(q), horde: count(q, 'horde'), sparks: count(q, 'sparks'), arsenal: flag(q, 'arsenal') };
}
