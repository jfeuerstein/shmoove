// PWA check, run by the gate after the routes: against `vite preview` of the real build, with the
// service worker enabled by `?sw`.
//   1. The manifest is linked and served with the manifest MIME type; every icon it names (and the
//      apple-touch-icon) is a PNG of the declared size.
//   2. The service worker registers, reaches `activated` and controls the page.
//   3. Offline (preview server stopped and the browser context offline), a reload still boots the
//      game to `__skitch.ready` and renders a non-blank canvas.
//   4. Update, end to end: a second dist with one changed file (and its regenerated sw.js) is served
//      on the same origin. The page sees the new version waiting, shows the "new version" ticket,
//      RELOAD activates it, the page reloads under the new worker, only the new cache is left and
//      it serves the changed file.
//   npm run e2e:pwa
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeServiceWorker } from '../../scripts/make-sw.mjs';
import { DIST, ROOT, ensureBuild, launchBrowser, newPhoneContext, waitForReady } from './lib/browser.mjs';
import { decodePng, nonFlatFraction } from './lib/png.mjs';

const SHOT_TIMEOUT_MS = 180_000;
const QUERY = '/?e2e&mute&sw';
const MARKER = '<!-- skitch pwa check: second build -->';

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

/** `vite preview` of `outDir` on a fixed port (same origin across builds). */
async function preview(outDir, port) {
  const viteBin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', outDir],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const end = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview exited (${child.exitCode})\n${log}`);
    try {
      if ((await fetch(url + '/')).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > end) {
      child.kill();
      throw new Error(`vite preview did not start\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 100));
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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}

async function canvasNotBlank(page, label) {
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__skitch.advance(6));
  const png = await page.screenshot({ timeout: SHOT_TIMEOUT_MS });
  const box = await page.locator('#game').boundingBox();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const frac = box ? nonFlatFraction(decodePng(png), { x: box.x * dpr, y: box.y * dpr, width: box.width * dpr, height: box.height * dpr }) : 0;
  check(label, frac > 0.0005, `${(frac * 100).toFixed(3)}% of the canvas differs from flat`);
}

async function main() {
  ensureBuild();
  const port = await freePort();
  const swA = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const cacheA = /const CACHE = "([^"]+)"/.exec(swA)?.[1] ?? '';
  check('dist/sw.js names its cache', cacheA.startsWith('skitch-'), cacheA);

  // Second build: the real dist with one changed file and its regenerated worker.
  const distB = mkdtempSync(join(tmpdir(), 'skitch-dist-b-'));
  cpSync(DIST, distB, { recursive: true });
  const indexB = readFileSync(join(distB, 'index.html'), 'utf8').replace('</html>', `${MARKER}\n</html>`);
  writeFileSync(join(distB, 'index.html'), indexB);
  const cacheB = writeServiceWorker(distB).name;
  check('a changed file gives a new cache name', cacheB !== cacheA && cacheB.startsWith('skitch-'), `${cacheA} -> ${cacheB}`);

  let server = await preview(DIST, port);
  const browser = await launchBrowser();
  const problems = [];
  try {
    const context = await newPhoneContext(browser);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    const failed = [];
    page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
    page.on('console', (m) => {
      if (m.type() === 'error') failed.push(`console: ${m.text()}`);
    });

    await page.goto(server.url + QUERY);
    await waitForReady(page);

    // 1. Manifest and icons.
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href ?? '');
    check('the manifest is linked', href.endsWith('manifest.webmanifest'), href);
    const mres = await page.request.get(href);
    const mtype = mres.headers()['content-type'] ?? '';
    check('the manifest is served', mres.ok(), String(mres.status()));
    check('the manifest has the manifest MIME type', mtype.startsWith('application/manifest+json'), mtype);
    const manifest = JSON.parse(await mres.text());
    const icons = [...manifest.icons];
    const touch = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.href ?? '');
    icons.push({ src: touch, sizes: '180x180', type: 'image/png' });
    for (const icon of icons) {
      const url = new URL(icon.src, href).href;
      const r = await page.request.get(url);
      const ctype = r.headers()['content-type'] ?? '';
      check(`icon ${icon.src} is served as PNG`, r.ok() && ctype.startsWith('image/png'), `${r.status()} ${ctype}`);
      const img = decodePng(Buffer.from(await r.body()));
      const [w, h] = icon.sizes.split('x').map(Number);
      check(`icon ${icon.src} is ${icon.sizes}`, img.width === w && img.height === h, `${img.width}x${img.height}`);
    }

    // 2. The worker registers, activates and controls the page.
    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated'),
      undefined,
      { timeout: 60_000, polling: 200 },
    );
    check('the service worker reaches activated', true);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000, polling: 200 });
    const keysA = await page.evaluate(() => caches.keys());
    check('the precache is the build cache', keysA.length === 1 && keysA[0] === cacheA, keysA.join(','));

    // 3. Offline: no server at all, and the context offline.
    await server.close();
    await context.setOffline(true);
    await page.reload();
    try {
      await waitForReady(page, 60_000);
    } catch (e) {
      const body = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 400)).catch(() => '?');
      throw new Error(`offline reload did not boot: ${e instanceof Error ? e.message : e}\n${failed.join('\n')}\n${problems.join('\n')}\n${body}`);
    }
    check('offline, a reload boots the game to ready', true);
    await canvasNotBlank(page, 'offline, the game renders a non-blank canvas');

    // 4. Update: the second build on the same origin.
    server = await preview(distB, port);
    await context.setOffline(false);
    await page.reload();
    await waitForReady(page, 60_000);
    // The reload asks the browser to check sw.js; nudge it as well in case it raced.
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => undefined));
    await page.waitForFunction(
      () => {
        window.__skitch.advance(1);
        return window.__skitch.state().ui?.updateOffered === true;
      },
      undefined,
      { timeout: 60_000, polling: 250 },
    );
    check('the new version waits and the "new version" ticket is offered', true);
    const keysWaiting = await page.evaluate(() => caches.keys());
    check('both caches exist while the new version waits', keysWaiting.includes(cacheA) && keysWaiting.includes(cacheB), keysWaiting.join(','));
    const reload = page.locator('[data-sk="updateReload"]');
    await reload.waitFor({ state: 'visible', timeout: 10_000 });
    await Promise.all([page.waitForEvent('load', { timeout: 60_000 }), reload.tap()]);
    await waitForReady(page, 60_000);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000, polling: 200 });
    await page.waitForFunction((b) => caches.keys().then((k) => k.length === 1 && k[0] === b), cacheB, { timeout: 30_000, polling: 200 });
    check('RELOAD activates the new version and the old cache is deleted', true);
    const served = await page.evaluate(() => fetch('./index.html').then((r) => r.text()));
    check('the new cache serves the changed file', served.includes(MARKER));
    const offered = await page.evaluate(() => window.__skitch.state().ui?.updateOffered);
    check('no ticket after the update', offered === false, String(offered));
    if (problems.length) check('no page errors', false, problems.join('; '));
    await context.close();
  } finally {
    await browser.close();
    await server.close();
    rmSync(distB, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    for (const r of results) console.log(`  PASS  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    console.log('\npwa: all checks passed (update checked end to end with a second dist on the same origin)');
  })
  .catch((e) => {
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    console.error(`\npwa: FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
