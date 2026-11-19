// PWA check, run by the gate after the routes, against a static server of the real build in dist/
// (cached like GitHub Pages: max-age=600 on everything but sw.js).
//   1. The manifest is linked and served with the manifest MIME type; every icon it names (and the
//      apple-touch-icon) is a PNG of the declared size.
//   2. The service worker registers, activates and controls the page.
//   3. Offline (server stopped and the browser context offline), a reload still boots the game to
//      `__shmoove.ready`.
//   4. Update, end to end: a second dist with a changed index.html and a renamed entry script (and
//      its regenerated sw.js) is served on the same origin. The page sees the new version waiting
//      and shows the update bar; tapping it loads the new version, the old cache is deleted.
//   5. With the HTTP cache cleared, a reload still boots the new build (the new precache must not
//      hold a stale index.html; see `cache: 'reload'` in scripts/make-sw.mjs).
// No console error or warning, and no page error, anywhere in the run.
//   npm run e2e:pwa
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { writeServiceWorker } from '../../scripts/make-sw.mjs';
import { DIST, ensureBuild, launchBrowser, newPhoneContext, waitForHook, watchProblems } from './run.mjs';

const QUERY = '/?hook&nolesson';
const MARKER = '<!-- pwa check: second build -->';
const BAR = '[data-pwa="update"]';

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

/** A static server for `outDir` on a fixed port (same origin across builds). */
async function serve(outDir, port) {
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

/** Width and height from a PNG's IHDR, or null if it is not a PNG. */
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  ensureBuild();
  const port = await freePort();
  const swA = readFileSync(join(DIST, 'sw.js'), 'utf8');
  const cacheA = /const CACHE = "([^"]+)"/.exec(swA)?.[1] ?? '';
  check('dist/sw.js names its cache', cacheA.startsWith('shmoove-'), cacheA);

  // Second build: the real dist with a changed index.html, its entry script renamed (as any code
  // change renames it) and its regenerated worker.
  const distB = mkdtempSync(join(tmpdir(), 'shmoove-dist-b-'));
  cpSync(DIST, distB, { recursive: true });
  const indexA = readFileSync(join(distB, 'index.html'), 'utf8');
  const entryA = /src="\.\/(assets\/[^"]+\.js)"/.exec(indexA)?.[1] ?? '';
  check('the build has an entry script', entryA.length > 0 && existsSync(join(distB, entryA)), entryA);
  const entryB = entryA.replace(/\.js$/, '-b.js');
  renameSync(join(distB, entryA), join(distB, entryB));
  writeFileSync(join(distB, 'index.html'), indexA.replace(entryA, entryB).replace('</html>', `${MARKER}\n</html>`));
  const cacheB = writeServiceWorker(distB).name;
  check('a changed file gives a new cache name', cacheB !== cacheA && cacheB.startsWith('shmoove-'), `${cacheA} -> ${cacheB}`);

  let server = await serve(DIST, port);
  const browser = await launchBrowser();
  const problems = [];
  try {
    const context = await newPhoneContext(browser);
    const page = await context.newPage();
    watchProblems(page, problems);

    await page.goto(server.url + QUERY);
    await waitForHook(page);

    // 1. Manifest and icons.
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href ?? '');
    check('the manifest is linked', href.endsWith('manifest.webmanifest'), href);
    const mres = await page.request.get(href);
    const mtype = mres.headers()['content-type'] ?? '';
    check('the manifest is served as a manifest', mres.ok() && mtype.startsWith('application/manifest+json'), `${mres.status()} ${mtype}`);
    const manifest = JSON.parse(await mres.text());
    check('the manifest names the game and the way it runs', manifest.name === 'SHMOOVE' && manifest.display === 'standalone' && manifest.orientation === 'portrait');
    check('the manifest colours are the palette dark', manifest.theme_color === '#1b1630' && manifest.background_color === '#1b1630');
    check('start_url and scope are relative', manifest.start_url === './' && manifest.scope === './');
    const icons = [...manifest.icons];
    const touch = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.href ?? '');
    icons.push({ src: touch, sizes: '180x180' });
    check('the maskable icon is declared', icons.some((i) => i.purpose === 'maskable'));
    for (const icon of icons) {
      const url = new URL(icon.src, href).href;
      const r = await page.request.get(url);
      const ctype = r.headers()['content-type'] ?? '';
      check(`icon ${icon.src} is served as PNG`, r.ok() && ctype.startsWith('image/png'), `${r.status()} ${ctype}`);
      const size = pngSize(Buffer.from(await r.body()));
      const [w, h] = icon.sizes.split('x').map(Number);
      check(`icon ${icon.src} is ${icon.sizes}`, size !== null && size.width === w && size.height === h, JSON.stringify(size));
    }

    // 2. The worker registers, activates and controls the page.
    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated'),
      undefined,
      { timeout: 60_000, polling: 200 },
    );
    check('the service worker reaches activated', true);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000, polling: 200 });
    check('the service worker controls the page', true);
    const keysA = await page.evaluate(() => caches.keys());
    check('the precache is the build cache', keysA.length === 1 && keysA[0] === cacheA, keysA.join(','));
    check('no update bar on the first install', (await page.locator(BAR).count()) === 0);
    // Another app's cache on the same origin, with no prefix of ours: activation must delete it too.
    await page.evaluate(() => caches.open('someone-elses-cache').then((c) => c.put('/x', new Response('x'))));
    check('the foreign cache is seeded', (await page.evaluate(() => caches.keys())).includes('someone-elses-cache'));

    // 3. Offline: no server at all, and the context offline.
    await server.close();
    await context.setOffline(true);
    await page.reload();
    await waitForHook(page, 60_000);
    check('offline, a reload boots the game to ready', true);

    // 4. Update: the second build on the same origin.
    server = await serve(distB, port);
    await context.setOffline(false);
    await page.reload();
    await waitForHook(page, 60_000);
    // The reload asks the browser to check sw.js; nudge it in case it raced.
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => undefined));
    const bar = page.locator(BAR);
    await bar.waitFor({ state: 'visible', timeout: 60_000 });
    check('the update bar appears when a new version waits', true);
    const text = (await bar.textContent()) ?? '';
    check('the update bar says what it does', text === 'New version: tap to update', text);
    const box = await bar.boundingBox();
    check('the update bar sits at the bottom edge', box !== null && Math.abs(box.y + box.height - 844) < 1 && box.width === 390, JSON.stringify(box));
    const keysWaiting = await page.evaluate(() => caches.keys());
    check('both build caches exist while the new version waits', keysWaiting.includes(cacheA) && keysWaiting.includes(cacheB), keysWaiting.join(','));
    await Promise.all([page.waitForEvent('load', { timeout: 60_000 }), bar.tap()]);
    await waitForHook(page, 60_000);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000, polling: 200 });
    await page.waitForFunction((b) => caches.keys().then((k) => k.length === 1 && k[0] === b), cacheB, { timeout: 30_000, polling: 200 });
    check('tapping the bar loads the new version and deletes the old cache', true);
    const keysAfter = await page.evaluate(() => caches.keys());
    check('and every foreign cache, whatever its name', keysAfter.length === 1 && !keysAfter.includes('someone-elses-cache'), keysAfter.join(','));
    const served = await page.evaluate(() => fetch('./index.html').then((r) => r.text()));
    check('the new cache serves the changed file', served.includes(MARKER));
    check('no update bar after the update', (await page.locator(BAR).count()) === 0);

    // 5. Nothing left in the HTTP cache to paper over a stale precache: reload once more.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await page.reload();
    await waitForHook(page, 60_000);
    const booted = await page.evaluate((marker) => ({
      entry: document.querySelector('script[type="module"]')?.getAttribute('src') ?? '',
      marked: document.documentElement.outerHTML.includes(marker),
    }), MARKER);
    check('with the HTTP cache cleared, a reload boots the new build', booted.marked && booted.entry.endsWith(entryB), `${booted.entry}, marker ${booted.marked ? 'present' : 'missing'}`);

    check('no console errors or warnings, no page errors', problems.length === 0, problems.join('; '));
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
    console.log('\npwa: all checks passed');
  })
  .catch((e) => {
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
    console.error(`\npwa: FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
