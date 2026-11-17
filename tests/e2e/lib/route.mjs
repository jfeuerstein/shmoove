// Route schema: a route is a named, data-only script of touch steps, waits, shots and expectations.
// Pure: no browser, no fs. Unit-tested in tests/unit/harness.test.ts.

export const VIEW_W = 390;
export const VIEW_H = 844;
/** `wait` advances in slices of at most this many ticks so intermediate frames render. */
export const MAX_SLICE_TICKS = 6;
/** swipeUp: 3 moves of this many px each (180 px total, the contract asks for >= 160). */
export const SWIPE_STEP_PX = 60;
export const SWIPE_MOVES = 3;

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coordErrors(step, where, required) {
  const errs = [];
  for (const [k, max] of [
    ['x', VIEW_W],
    ['y', VIEW_H],
  ]) {
    const v = step[k];
    if (v === undefined) {
      if (required) errs.push(`${where}: '${k}' is required`);
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
      errs.push(`${where}: '${k}' must be a number in [0, ${max}]`);
    }
  }
  return errs;
}

function stepErrors(step, i) {
  const where = `steps[${i}]`;
  if (!isObj(step)) return [`${where}: must be an object`];
  switch (step.do) {
    case 'down':
    case 'move':
      return coordErrors(step, `${where} (${step.do})`, true);
    case 'up':
      return [];
    case 'swipeUp': {
      const errs = coordErrors(step, `${where} (swipeUp)`, false);
      if (step.hold !== undefined && typeof step.hold !== 'boolean') {
        errs.push(`${where} (swipeUp): 'hold' must be a boolean`);
      }
      return errs;
    }
    case 'wait':
      return Number.isInteger(step.ticks) && step.ticks > 0
        ? []
        : [`${where} (wait): 'ticks' must be a positive integer`];
    case 'shot':
      return typeof step.name === 'string' && NAME_RE.test(step.name)
        ? []
        : [`${where} (shot): 'name' must match ${NAME_RE}`];
    case 'expect': {
      const errs = [];
      if (typeof step.label !== 'string' || step.label.trim() === '') {
        errs.push(`${where} (expect): 'label' must be a non-empty string`);
      }
      if (typeof step.test !== 'function') errs.push(`${where} (expect): 'test' must be a function`);
      return errs;
    }
    default:
      return [`${where}: unknown step '${String(step.do)}'`];
  }
}

/** Returns a list of problems with `route`; empty means valid. */
export function validateRoute(route) {
  if (!isObj(route)) return ['route must be an object'];
  const errs = [];
  if (typeof route.name !== 'string' || !NAME_RE.test(route.name)) {
    errs.push(`'name' must match ${NAME_RE}`);
  }
  if (route.params !== undefined && typeof route.params !== 'string') {
    errs.push(`'params' must be a string`);
  }
  if (!Array.isArray(route.steps) || route.steps.length === 0) {
    errs.push(`'steps' must be a non-empty array`);
  } else {
    route.steps.forEach((s, i) => errs.push(...stepErrors(s, i)));
  }
  return errs;
}

/** Query string for a route: always `e2e&mute`, plus the route's own params. */
export function routeQuery(route) {
  const extra = (route.params ?? '').replace(/^[?&]+/, '');
  return extra ? `?e2e&mute&${extra}` : '?e2e&mute';
}

/** Split a wait of `ticks` into slices of at most MAX_SLICE_TICKS. */
export function waitSlices(ticks) {
  const out = [];
  for (let left = ticks; left > 0; left -= MAX_SLICE_TICKS) out.push(Math.min(left, MAX_SLICE_TICKS));
  return out;
}
