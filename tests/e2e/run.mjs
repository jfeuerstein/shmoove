// e2e runner: serves dist/ with `vite preview`, opens headless Chromium as a phone (390x844 CSS px,
// touch, device scale factor 2) and plays every route in tests/e2e/routes/. A route fails on any
// console error or warning, any page error, or a failed check; each one saves
// artifacts/screens/<route>.png. Exits non-zero if any route failed.
//
//   npm run e2e              every route
//   npm run e2e -- drive     one route
//
// dist/ is built with `vite build` when it is missing (the gate builds it before this runs).
// The rest of the harness (server, browser, phone context) is exported for the perf runner.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST = join(ROOT, 'dist');
export const VIEWPORT = { width: 390, height: 844 };
/** Headless Chromium has no GPU: WebGL runs on SwiftShader, which has to be allowed explicitly. */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const ROUTES_DIR = join(ROOT, 'tests', 'e2e', 'routes');
const SCREENS_DIR = join(ROOT, 'artifacts', 'screens');
/** Software rendering on a busy machine can take a while to produce a frame. */
const SHOT_TIMEOUT_MS = 120_000;
const ROUTE_TIMEOUT_MS = 180_000;

/** Build dist/ with vite if it is not there. */
export function ensureBuild() {
  if (existsSync(join(DIST, 'index.html'))) return;
  console.log('[harness] dist/ missing, running vite build ...');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('vite build failed');
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

async function waitForHttp(url, child, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`vite preview exited with code ${child.exitCode}`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`vite preview did not answer at ${url} within ${timeoutMs} ms`);
}

/** Start `vite preview` on dist/ on a free port. Returns { url, close }. */
export async function startPreview() {
  const port = await freePort();
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(url + '/', child, 20_000);
  } catch (e) {
    child.kill();
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n${log}`);
  }
  return {
    url,
    close: () =>
      new Promise((res) => {
        if (child.exitCode !== null) return res(undefined);
        child.once('exit', () => res(undefined));
        child.kill();
      }),
  };
}

export function launchBrowser() {
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS });
}

/** A phone held upright: 390x844 CSS px, device scale factor 2, touch. */
export function newPhoneContext(browser, deviceScaleFactor = 2) {
  return browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, deviceScaleFactor, hasTouch: true, isMobile: true });
}

/**
 * The one console message that is the harness's, not the app's: headless Chromium composites in
 * software, so it reads every displayed WebGL canvas back from SwiftShader and its GPU process logs
 * this performance note for the first few frames. A page that only clears a WebGL canvas once
 * prints it too. Matched exactly, so any other driver message still fails the run.
 */
const HARNESS_NOISE = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels( \(this message will no longer repeat\))?$/;

/** Collect every console error and warning and every page error into `problems`. */
export function watchProblems(page, problems) {
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    const t = m.type();
    if (t !== 'error' && t !== 'warning' && t !== 'assert') return;
    const text = m.text();
    if (t === 'warning' && HARNESS_NOISE.test(text)) return;
    problems.push(`console ${t}: ${text}`);
  });
}

export async function waitForHook(page, timeoutMs = 30_000) {
  await page.waitForFunction(() => window.__shmoove?.ready === true, undefined, { timeout: timeoutMs });
}

/** Serve dist/ and launch Chromium around `fn`; cleans up both. */
export async function withAppAndBrowser(fn) {
  ensureBuild();
  const server = await startPreview();
  let browser;
  try {
    browser = await launchBrowser();
    return await fn({ url: server.url, browser });
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

async function loadRoutes(only) {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort();
  const routes = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(ROUTES_DIR, f)).href);
    const r = mod.default;
    if (!r || typeof r.name !== 'string' || typeof r.run !== 'function') {
      throw new Error(`${f}: a route exports default { name, query, run(t) }`);
    }
    routes.push(r);
  }
  if (only.length === 0) return routes;
  const missing = only.filter((n) => !routes.some((r) => r.name === n));
  if (missing.length) throw new Error(`unknown route(s): ${missing.join(', ')}`);
  return routes.filter((r) => only.includes(r.name));
}

/**
 * What a route gets: the page, the hook (each method of window.__shmoove as an async call),
 * `check(ok, label, detail)` which records a failure without stopping, and `shot()`.
 */
function routeApi(page, route, problems) {
  const call = (method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
  let shotTaken = false;
  return {
    page,
    hook: {
      state: () => call('state'),
      hold: (frame) => call('hold', frame),
      hop: () => call('hop'),
      pause: (on) => call('pause', on),
      step: (n) => call('step', n),
      stats: () => call('stats'),
    },
    check(ok, label, detail) {
      if (ok !== true) problems.push(`check failed: ${label}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`);
      return ok === true;
    },
    async shot() {
      const file = join(SCREENS_DIR, `${route.name}.png`);
      // Let the compositor show the last frame drawn.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
      await page.screenshot({ path: file, timeout: SHOT_TIMEOUT_MS });
      shotTaken = true;
      return file;
    },
    get shotTaken() {
      return shotTaken;
    },
  };
}

async function playRoute(browser, url, route) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  const problems = [];
  watchProblems(page, problems);
  const t0 = Date.now();
  try {
    await page.goto(`${url}/${route.query ?? '?hook'}`);
    await waitForHook(page);
    const api = routeApi(page, route, problems);
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`route took longer than ${ROUTE_TIMEOUT_MS / 1000} s`)), ROUTE_TIMEOUT_MS);
    });
    try {
      await Promise.race([route.run(api), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (!api.shotTaken) problems.push('route saved no screenshot');
  } catch (e) {
    problems.push(`route threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    await context.close();
  }
  return { name: route.name, problems, ms: Date.now() - t0 };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const routes = await loadRoutes(only);
  mkdirSync(SCREENS_DIR, { recursive: true });
  const results = await withAppAndBrowser(async ({ url, browser }) => {
    const out = [];
    for (const route of routes) {
      process.stdout.write(`[e2e] ${route.name} ... `);
      const r = await playRoute(browser, url, route);
      console.log(r.problems.length ? 'FAIL' : 'ok', `(${(r.ms / 1000).toFixed(1)} s)`);
      for (const p of r.problems) console.log(`    ${p}`);
      out.push(r);
    }
    return out;
  });
  const failed = results.filter((r) => r.problems.length > 0);
  console.log(`\n[e2e] ${results.length - failed.length}/${results.length} routes passed; screenshots in artifacts/screens/`);
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
