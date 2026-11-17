// Shared harness plumbing for the e2e and perf runners: build, preview server, Chromium launch.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const DIST = join(ROOT, 'dist');

/** Phone viewport the game is designed for (CSS px). */
export const VIEWPORT = { width: 390, height: 844 };

/**
 * Flags that give headless Chromium a working WebGL context without a GPU: ANGLE on SwiftShader
 * (software Vulkan/GL), explicitly allowed since Chrome no longer falls back to it silently.
 */
export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium';

/** Run `npm run build` if dist/ is missing (or always, with force). */
export function ensureBuild(force = false) {
  if (!force && existsSync(join(DIST, 'index.html'))) return;
  console.log('[harness] building dist/ ...');
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('npm run build failed');
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

/** Start `vite preview` on a free port. Returns { url, close }. */
export async function startPreview() {
  const port = await freePort();
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
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

/** Launch headless Chromium with WebGL. Falls back to the preinstalled binary if needed. */
export async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  } catch (first) {
    const executablePath = process.env.SKITCH_CHROMIUM || FALLBACK_CHROMIUM;
    if (!existsSync(executablePath)) throw first;
    console.warn(`[harness] default Chromium launch failed, retrying with ${executablePath}`);
    return chromium.launch({ headless: true, args: CHROMIUM_ARGS, executablePath });
  }
}

/** A phone-like portrait browser context: 390x844 CSS px, DPR 2, touch. */
export function newPhoneContext(browser) {
  return browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
}

/** Wait until the app has installed its test hook and declared itself ready. */
export async function waitForReady(page, timeoutMs = 20_000) {
  await page.waitForFunction(() => window.__skitch?.ready === true, undefined, { timeout: timeoutMs });
}

/** Run `fn` with a built app served by vite preview and a launched browser; cleans up both. */
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
