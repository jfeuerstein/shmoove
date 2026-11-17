// PWA check, run by the gate after the routes: against `vite preview` of the real build, with the
// service worker enabled by `?sw`.
//   1. The manifest is linked and served with the manifest MIME type; every icon it names (and the
//      apple-touch-icon) is a PNG of the declared size.
//   2. The service worker registers, reaches `activated` and controls the page.
//   3. Offline (preview server stopped and the browser context offline), a reload still boots the
//      game to `__skitch.ready` and renders a non-blank canvas.
//   4. Update, end to end: a second dist with a changed index.html and a renamed entry script (and
//      its regenerated sw.js) is served on the same origin. The page sees the new version waiting,
//      shows the "new version" ticket, RELOAD activates it, the page reloads under the new worker,
//      only the new cache is left and it serves the changed file.
//   5. Stale index regression: like GitHub Pages, the server sends `Cache-Control: max-age=600` on
//      index.html (and every other file but sw.js), so the browser's HTTP cache holds a fresh copy
//      of the first build's index.html while the new worker precaches. After RELOAD the HTTP cache
//      is cleared (CDP) and the page reloaded once more: it must still boot to ready on the new
//      build. Without `cache: 'reload'` on the precache requests (scripts/make-sw.mjs) the new cache
//      would hold the old index.html, which names an entry script the new build no longer has.
//   npm run e2e:pwa
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { writeServiceWorker } from '../../scripts/make-sw.mjs';
import { DIST, ensureBuild, launchBrowser, newPhoneContext, waitForReady } from './lib/browser.mjs';
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * A static server for `outDir` on a fixed port (same origin across builds), cached like GitHub
 * Pages: `max-age=600` on everything except sw.js (which browsers fetch past the HTTP cache anyway).
 * Host config files (`_headers`) are not served, as on a real host.
 */
async function preview(outDir, port) {
  const root = normalize(outDir + sep);
  const server = createHttpServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const rel = path.endsWith('/') ? path + 'index.html' : path;
    const file = normalize(join(root, rel));
    if (!file.startsWith(root) || rel === '/_headers' || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': rel === '/sw.js' ? 'no-cache' : 'max-age=600',
    });
    res.end(readFileSync(file));
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', () => res(undefined));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((res) => {
        if (!server.listening) return res(undefined);
        for (const socket of sockets) socket.destroy();
        server.close(() => res(undefined));
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

  // Second build: the real dist with a changed index.html, its entry script renamed (as any code
  // change renames it) and its regenerated worker.
  const distB = mkdtempSync(join(tmpdir(), 'skitch-dist-b-'));
  cpSync(DIST, distB, { recursive: true });
  const indexA = readFileSync(join(distB, 'index.html'), 'utf8');
  const entryA = /src="\.\/(assets\/[^"]+\.js)"/.exec(indexA)?.[1] ?? '';
  check('the build has an entry script', entryA.length > 0 && existsSync(join(distB, entryA)), entryA);
  const entryB = entryA.replace(/\.js$/, '-b.js');
  renameSync(join(distB, entryA), join(distB, entryB));
  const indexB = indexA.replace(entryA, entryB).replace('</html>', `${MARKER}\n</html>`);
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

    // 5. Nothing left in the HTTP cache to paper over a stale precache: reload once more.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await page.reload();
    try {
      await waitForReady(page, 60_000);
    } catch (e) {
      throw new Error(`with the HTTP cache cleared the reload did not boot: ${e instanceof Error ? e.message : e}\n${failed.slice(-5).join('\n')}`);
    }
    const booted = await page.evaluate((marker) => ({
      entry: document.querySelector('script[type="module"]')?.getAttribute('src') ?? '',
      marked: document.documentElement.outerHTML.includes(marker),
    }), MARKER);
    check(
      'with the HTTP cache cleared, a reload boots the new build to ready',
      booted.marked && booted.entry.endsWith(entryB),
      `${booted.entry}, marker ${booted.marked ? 'present' : 'missing'}`,
    );
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
