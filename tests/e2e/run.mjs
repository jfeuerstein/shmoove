// e2e runner: plays data-only routes from tests/e2e/routes/ against the built app in headless
// Chromium at 390x844 with real CDP touch input. Time advances only via window.__skitch.advance(),
// so every run is deterministic.
//   npm run e2e            all routes
//   npm run e2e -- boot    one route
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, newPhoneContext, waitForReady, withAppAndBrowser } from './lib/browser.mjs';
import { decodePng, nonFlatFraction } from './lib/png.mjs';
import {
  SWIPE_MOVES,
  SWIPE_STEP_PX,
  VIEW_H,
  VIEW_W,
  routeQuery,
  validateRoute,
  waitSlices,
} from './lib/route.mjs';

const SHOT_TIMEOUT_MS = 180_000;

const ROUTES_DIR = join(ROOT, 'tests', 'e2e', 'routes');
const SCREENS_DIR = join(ROOT, 'artifacts', 'screens');
/** A canvas whose pixels differ from its first pixel in less than this fraction counts as blank. */
const MIN_NON_FLAT = 0.0005;

async function loadRoutes(only) {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const routes = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(ROUTES_DIR, f)).href);
    const route = mod.default ?? mod.route;
    const errs = validateRoute(route);
    if (errs.length) throw new Error(`invalid route in ${f}:\n  ${errs.join('\n  ')}`);
    routes.push(route);
  }
  if (only.length === 0) return routes;
  const picked = routes.filter((r) => only.includes(r.name));
  const missing = only.filter((n) => !routes.some((r) => r.name === n));
  if (missing.length) throw new Error(`unknown route(s): ${missing.join(', ')}`);
  return picked;
}

const clampX = (x) => Math.min(VIEW_W - 1, Math.max(0, x));
const clampY = (y) => Math.min(VIEW_H - 1, Math.max(0, y));

async function playRoute(browser, url, route) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  // Any console error or warning fails the route: a clean run prints nothing to either.
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || t === 'assert') problems.push(`console ${t}: ${m.text()}`);
  });
  const cdp = await context.newCDPSession(page);
  const history = [];
  let finger = null; // current touch point in CSS px, or null
  let checkedCanvas = false;

  const flushInput = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  const touch = async (type, pt) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pt ? [{ x: pt.x, y: pt.y, id: 0, radiusX: 4, radiusY: 4, force: 1 }] : [],
    });
    await flushInput();
  };
  const sample = async () => {
    const s = await page.evaluate(() => window.__skitch.state());
    history.push(s);
    return s;
  };
  const advance = async (ticks) => {
    await page.evaluate((n) => window.__skitch.advance(n), ticks);
    return sample();
  };
  const down = async (x, y) => {
    if (finger) await touch('touchEnd', null);
    finger = { x: clampX(x), y: clampY(y) };
    await touch('touchStart', finger);
  };
  const move = async (x, y) => {
    if (!finger) throw new Error('move without a finger down');
    finger = { x: clampX(x), y: clampY(y) };
    await touch('touchMove', finger);
  };
  const up = async () => {
    if (!finger) return;
    finger = null;
    await touch('touchEnd', null);
  };
  const shot = async (name) => {
    const file = join(SCREENS_DIR, `${route.name}-${name}.png`);
    // Software rendering on a busy machine can take a while to produce a frame.
    const png = await page.screenshot({ path: file, timeout: SHOT_TIMEOUT_MS });
    await assertCanvasNotBlank(page, png, `${route.name}-${name}`);
    checkedCanvas = true;
  };

  try {
    await page.goto(url + '/' + routeQuery(route));
    await waitForReady(page);
    const manual = await page.evaluate(() => window.__skitch.manual);
    if (!manual) throw new Error('app did not enter manual stepping mode with ?e2e');
    await sample();
    for (const [i, step] of route.steps.entries()) {
      if (problems.length) break;
      switch (step.do) {
        case 'down':
          await down(step.x, step.y);
          break;
        case 'move':
          await move(step.x, step.y);
          break;
        case 'up':
          await up();
          break;
        case 'swipeUp': {
          // Fast upward flick: touch start seen on its own tick, then 3 moves over 3 ticks.
          if (!finger) {
            await down(step.x ?? VIEW_W / 2, step.y ?? VIEW_H * 0.7);
            await advance(1);
          }
          for (let k = 0; k < SWIPE_MOVES; k++) {
            await move(finger.x, finger.y - SWIPE_STEP_PX);
            await advance(1);
          }
          if (!step.hold) await up();
          break;
        }
        case 'wait':
          for (const n of waitSlices(step.ticks)) await advance(n);
          break;
        case 'shot':
          await shot(step.name);
          break;
        case 'expect': {
          const state = await page.evaluate(() => window.__skitch.state());
          let ok = false;
          try {
            ok = step.test(state, history) === true;
          } catch (e) {
            problems.push(`expect '${step.label}' threw: ${e instanceof Error ? e.message : String(e)}`);
            break;
          }
          if (!ok) problems.push(`expect failed at steps[${i}]: ${step.label} (state ${JSON.stringify(state)})`);
          break;
        }
      }
    }
    if (!checkedCanvas && problems.length === 0) {
      await assertCanvasNotBlank(page, await page.screenshot({ timeout: SHOT_TIMEOUT_MS }), `${route.name} (end)`);
    }
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  } finally {
    await context.close();
  }
  return { name: route.name, ticks: history.length ? history[history.length - 1].tick : 0, problems };
}

/** Throws if the #game canvas region of the screenshot is a single flat colour. */
async function assertCanvasNotBlank(page, png, label) {
  const box = await page.locator('#game').boundingBox();
  if (!box) throw new Error(`${label}: #game canvas not found`);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const img = decodePng(png);
  const frac = nonFlatFraction(img, {
    x: box.x * dpr,
    y: box.y * dpr,
    width: box.width * dpr,
    height: box.height * dpr,
  });
  if (frac < MIN_NON_FLAT) {
    throw new Error(`${label}: game canvas is blank (one flat colour, ${(frac * 100).toFixed(3)}% differs)`);
  }
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const routes = await loadRoutes(only);
  if (routes.length === 0) throw new Error(`no routes in ${ROUTES_DIR}`);
  mkdirSync(SCREENS_DIR, { recursive: true });

  const results = await withAppAndBrowser(async ({ url, browser }) => {
    const out = [];
    for (const route of routes) {
      const t0 = Date.now();
      const r = await playRoute(browser, url, route);
      out.push({ ...r, ms: Date.now() - t0 });
    }
    return out;
  });

  const w = Math.max(5, ...results.map((r) => r.name.length));
  console.log(`\n${'route'.padEnd(w)}  result  ticks     ms`);
  for (const r of results) {
    const res = r.problems.length ? 'FAIL' : 'PASS';
    console.log(`${r.name.padEnd(w)}  ${res.padEnd(6)}  ${String(r.ticks).padStart(5)}  ${String(r.ms).padStart(5)}`);
    for (const p of r.problems) console.log(`${' '.repeat(w)}    - ${p}`);
  }
  writeFileSync(
    join(ROOT, 'artifacts', 'e2e.json'),
    JSON.stringify(results.map(({ name, ticks, ms, problems }) => ({ name, ticks, ms, problems })), null, 2),
  );
  const failed = results.filter((r) => r.problems.length).length;
  console.log(failed ? `\ne2e: ${failed}/${results.length} route(s) FAILED` : `\ne2e: all ${results.length} route(s) passed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
