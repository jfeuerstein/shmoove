// perf runner, two checks against tests/perf/budgets.json (DESIGN section 10). Writes artifacts/perf.json.
//
// 1. Frame work: the real rAF loop on /?route=perf (a continuous descent from the summit that
//    carves, hops, hitches and slings) in headless Chromium at 4x CPU throttle. Reports work per
//    frame, per sim step, and for frames that carried exactly one sim step (headless Chromium
//    rasterises in software and runs at about 10 fps, so most frames carry catch-up steps), plus a
//    breakdown of every frame by part. Work excludes the route script itself (it stands in for the
//    player's thumb; its cost is the `route` part).
// 2. Viewpoint tour: /?route=tour in manual mode visits fixed viewpoints in every district, day and
//    night, and checks the most draw calls and triangles seen anywhere against the budgets.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIST, ROOT, newPhoneContext, waitForReady, withAppAndBrowser } from '../e2e/lib/browser.mjs';

const CPU_THROTTLE = 4;
const WARMUP_MS = 2_000;
const MEASURE_MS = 10_000;
/** Frames the tour holds each viewpoint: must match TOUR_HOLD in src/app/routes.ts. */
const TOUR_HOLD = 240;
/** Safety stop for the tour loop. */
const TOUR_MAX_POINTS = 32;
const TOUR_TIMES = [
  { name: 'day', t: 0.45 },
  { name: 'night', t: 0.9 },
];

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

/** mean, p50, p95, max of a list of numbers. */
function summarise(values) {
  const s = values.slice().sort((a, b) => a - b);
  const mean = s.length ? s.reduce((a, v) => a + v, 0) / s.length : 0;
  return { n: s.length, mean, p50: percentile(s, 50), p95: percentile(s, 95), max: s.length ? s[s.length - 1] : 0 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const extraParams = () => (process.env.SKITCH_PERF_PARAMS ? '&' + process.env.SKITCH_PERF_PARAMS : '');

function watchProblems(page, problems) {
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
}

async function measure({ url, browser }, problems) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    // SKITCH_PERF_PARAMS adds URL parameters, e.g. world=slice, to measure another world.
    await page.goto(url + '/?route=perf&mute' + extraParams());
    await waitForReady(page);
    if (await page.evaluate(() => window.__skitch.manual)) throw new Error('app is in manual mode without ?e2e');
    await sleep(WARMUP_MS);
    await page.evaluate(() => window.__skitch.resetStats());
    await sleep(MEASURE_MS);
    return await page.evaluate(() => window.__skitch.stats());
  } finally {
    await context.close();
  }
}

/** One pass of the viewpoint tour at day fraction `t`: per viewpoint, the most draw calls and triangles. */
async function tour({ url, browser }, t, problems) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    await page.goto(url + `/?route=tour&e2e&mute&t=${t}` + extraParams(), { waitUntil: 'commit' });
    await waitForReady(page, 60_000);
    return await page.evaluate(
      ({ hold, maxPoints }) => {
        const h = window.__skitch;
        const points = [];
        let lastKey = '';
        for (let k = 0; k < maxPoints; k++) {
          let drawCalls = 0;
          let triangles = 0;
          let x = 0;
          let z = 0;
          for (let f = 0; f < hold; f++) {
            h.advance(1);
            const s = h.stats();
            drawCalls = Math.max(drawCalls, s.drawCalls);
            triangles = Math.max(triangles, s.triangles);
            if (f === 0) {
              const st = h.state();
              x = Math.round(st.x);
              z = Math.round(st.z);
            }
          }
          const key = `${x},${z}`;
          // After the last viewpoint the tour stays put.
          if (key === lastKey) break;
          lastKey = key;
          points.push({ x, z, drawCalls, triangles });
        }
        return points;
      },
      { hold: TOUR_HOLD, maxPoints: TOUR_MAX_POINTS },
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const load = loadavg();
  const problems = [];
  const { stats, tours } = await withAppAndBrowser(async (env) => {
    const stats = await measure(env, problems);
    const tours = [];
    for (const tt of TOUR_TIMES) tours.push({ ...tt, points: await tour(env, tt.t, problems) });
    return { stats, tours };
  });

  const work = summarise(stats.workMs);
  const parts = stats.parts ?? {};
  const steps = parts.steps ?? [];
  const oneStep = summarise(stats.workMs.filter((_, i) => steps[i] === 1));
  const step = summarise(stats.stepMs ?? []);
  let tourDraw = 0;
  let tourTris = 0;
  for (const tt of tours) {
    for (const p of tt.points) {
      tourDraw = Math.max(tourDraw, p.drawCalls);
      tourTris = Math.max(tourTris, p.triangles);
    }
  }
  const metrics = {
    frames: stats.frames,
    workMeanMs: work.mean,
    workP50Ms: work.p50,
    workP95Ms: work.p95,
    workMaxMs: work.max,
    stepsPerFrame: summarise(steps).mean,
    stepMeanMs: step.mean,
    stepP95Ms: step.p95,
    oneStepFrames: oneStep.n,
    oneStepMeanMs: oneStep.mean,
    oneStepP95Ms: oneStep.p95,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    tourDrawCalls: tourDraw,
    tourTriangles: tourTris,
    bundleGzipKb: bundleGzipKb(),
  };
  // The tour is held to the same draw-call and triangle budgets as the run.
  const limits = { ...budgets, tourDrawCalls: budgets.drawCalls, tourTriangles: budgets.triangles };
  const checks = Object.entries(limits).map(([key, limit]) => ({
    key,
    value: metrics[key],
    limit,
    pass: typeof metrics[key] === 'number' && metrics[key] <= limit,
  }));
  if (stats.frames < 60) problems.push(`only ${stats.frames} frames in ${MEASURE_MS} ms: the rAF loop is not running`);
  if (oneStep.n < 5) problems.push(`only ${oneStep.n} frames carried exactly one sim step: the one-step figures mean little`);
  for (const tt of tours) if (tt.points.length < 2) problems.push(`the ${tt.name} tour visited only ${tt.points.length} viewpoint(s)`);

  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  console.log(`\nperf (${CPU_THROTTLE}x CPU throttle, ${MEASURE_MS / 1000} s after ${WARMUP_MS / 1000} s warm-up)`);
  console.log(`  load average ${load.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`  frames ${metrics.frames}, sim steps per frame ${fmt(metrics.stepsPerFrame)}, one-step frames ${oneStep.n}`);
  console.log(`  work ms        mean ${fmt(work.mean)}  p50 ${fmt(work.p50)}  p95 ${fmt(work.p95)}  max ${fmt(work.max)}`);
  console.log(`  one-step frame mean ${fmt(oneStep.mean)}  p50 ${fmt(oneStep.p50)}  p95 ${fmt(oneStep.p95)}  max ${fmt(oneStep.max)}`);
  console.log(`  game step      mean ${fmt(step.mean)}  p50 ${fmt(step.p50)}  p95 ${fmt(step.p95)}  max ${fmt(step.max)}  (${step.n} steps)`);
  const names = Object.keys(parts);
  if (names.length > 0) {
    console.log(`\n  ${'part (per frame)'.padEnd(18)}${'mean'.padStart(8)}${'p95'.padStart(8)}${'max'.padStart(8)}`);
    for (const name of names) {
      const s = summarise(parts[name]);
      console.log(`  ${name.padEnd(18)}${fmt(s.mean).padStart(8)}${fmt(s.p95).padStart(8)}${fmt(s.max).padStart(8)}`);
    }
  }
  for (const tt of tours) {
    console.log(`\n  tour, ${tt.name} (t=${tt.t}): viewpoint  draw calls  triangles`);
    for (const p of tt.points) console.log(`    ${`${p.x},${p.z}`.padEnd(12)}${String(p.drawCalls).padStart(10)}${String(p.triangles).padStart(11)}`);
  }
  console.log(`\n  ${'budget'.padEnd(14)}${'value'.padStart(12)}${'limit'.padStart(12)}  result`);
  for (const c of checks) {
    console.log(`  ${c.key.padEnd(14)}${fmt(c.value).padStart(12)}${fmt(c.limit).padStart(12)}  ${c.pass ? 'PASS' : 'FAIL'}`);
  }
  for (const p of problems) console.log(`  - ${p}`);

  const ok = problems.length === 0 && checks.every((c) => c.pass);
  const breakdown = Object.fromEntries(names.map((n) => [n, summarise(parts[n])]));
  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  writeFileSync(
    join(ROOT, 'artifacts', 'perf.json'),
    JSON.stringify(
      { cpuThrottle: CPU_THROTTLE, measureMs: MEASURE_MS, loadAverage: load, metrics, breakdown, tours, checks, problems, pass: ok, raw: { workMs: stats.workMs, stepMs: stats.stepMs ?? [], parts } },
      null,
      2,
    ),
  );
  console.log(ok ? '\nperf: all budgets met' : '\nperf: FAILED');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
});
