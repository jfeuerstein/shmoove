// perf runner: the real rAF loop on /?route=perf in headless Chromium with 4x CPU throttle,
// checked against tests/perf/budgets.json (DESIGN section 10). Writes artifacts/perf.json.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIST, ROOT, newPhoneContext, waitForReady, withAppAndBrowser } from '../e2e/lib/browser.mjs';

const CPU_THROTTLE = 4;
const WARMUP_MS = 2_000;
const MEASURE_MS = 10_000;

const budgets = JSON.parse(readFileSync(join(ROOT, 'tests', 'perf', 'budgets.json'), 'utf8'));

function bundleGzipKb() {
  const dir = join(DIST, 'assets');
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.js')) bytes += gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
  }
  return bytes / 1000;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure({ url, browser }) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    // SKITCH_PERF_PARAMS adds URL parameters, e.g. world=city, to measure another world.
    const extra = process.env.SKITCH_PERF_PARAMS ? '&' + process.env.SKITCH_PERF_PARAMS : '';
    await page.goto(url + '/?route=perf&mute' + extra);
    await waitForReady(page);
    if (await page.evaluate(() => window.__skitch.manual)) throw new Error('app is in manual mode without ?e2e');
    await sleep(WARMUP_MS);
    await page.evaluate(() => window.__skitch.resetStats());
    await sleep(MEASURE_MS);
    const stats = await page.evaluate(() => window.__skitch.stats());
    return { stats, problems };
  } finally {
    await context.close();
  }
}

async function main() {
  const { stats, problems } = await withAppAndBrowser(measure);
  const work = stats.workMs.slice().sort((a, b) => a - b);
  const mean = work.length ? work.reduce((s, v) => s + v, 0) / work.length : 0;
  const metrics = {
    frames: stats.frames,
    workMeanMs: mean,
    workP50Ms: percentile(work, 50),
    workP95Ms: percentile(work, 95),
    workMaxMs: work.length ? work[work.length - 1] : 0,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    bundleGzipKb: bundleGzipKb(),
  };
  const checks = Object.entries(budgets).map(([key, limit]) => ({
    key,
    value: metrics[key],
    limit,
    pass: typeof metrics[key] === 'number' && metrics[key] <= limit,
  }));
  if (stats.frames < 60) problems.push(`only ${stats.frames} frames in ${MEASURE_MS} ms: the rAF loop is not running`);

  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  console.log(`\nperf (${CPU_THROTTLE}x CPU throttle, ${MEASURE_MS / 1000} s after ${WARMUP_MS / 1000} s warm-up)`);
  console.log(`  frames ${metrics.frames}`);
  console.log(
    `  work ms  mean ${fmt(metrics.workMeanMs)}  p50 ${fmt(metrics.workP50Ms)}  p95 ${fmt(metrics.workP95Ms)}  max ${fmt(metrics.workMaxMs)}`,
  );
  console.log(`\n  ${'budget'.padEnd(14)}${'value'.padStart(12)}${'limit'.padStart(12)}  result`);
  for (const c of checks) {
    console.log(`  ${c.key.padEnd(14)}${fmt(c.value).padStart(12)}${fmt(c.limit).padStart(12)}  ${c.pass ? 'PASS' : 'FAIL'}`);
  }
  for (const p of problems) console.log(`  - ${p}`);

  const ok = problems.length === 0 && checks.every((c) => c.pass);
  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  writeFileSync(
    join(ROOT, 'artifacts', 'perf.json'),
    JSON.stringify({ cpuThrottle: CPU_THROTTLE, measureMs: MEASURE_MS, metrics, checks, problems, pass: ok }, null, 2),
  );
  console.log(ok ? '\nperf: all budgets met' : '\nperf: FAILED');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
