// perf runner: serves dist/ like the e2e runner, opens the game as a phone in headless Chromium with
// the CPU throttled 4x, holds the stick forward through the test hook for the real rAF loop until 130 frames
// and 300 ticks have passed (45 s cap), then reads the hook's stats (averages over the last 120 frames) and the gzip size of the
// JS in dist/. Compares with tests/perf/budgets.json, writes artifacts/perf.json, and exits non-zero
// over budget or if the run did not really go anywhere.
//
// Two measurements, each in a fresh page: the empty bowl (`?hook&perf`; keys frameMs, stepMs,
// drawCalls, triangles) and the crowd fixture of 400 enemies and 600 sparks
// (`?hook&perf&horde=400&sparks=600`; the same keys prefixed with `horde`).
//
// "Frame work" is the JS time of a frame: the sim steps it carried, the views, and render submission.
// Headless Chromium rasterises in software, so frames are slow to appear; that is not counted.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIST, ROOT, newPhoneContext, waitForHook, watchProblems, withAppAndBrowser } from '../e2e/run.mjs';

const CPU_THROTTLE = 4;
/** The run lasts until both minimums are met, but never longer than this. */
const CAP_MS = 45_000;
/** The run counts only if the sim advanced at least this many ticks and the mover this far, m. */
const MIN_TICKS = 300;
const MIN_TRAVEL_M = 20;
/** And enough frames were drawn to fill the stats window. */
const MIN_FRAMES = 130;

const budgets = JSON.parse(readFileSync(join(ROOT, 'tests', 'perf', 'budgets.json'), 'utf8'));

function jsGzipKb() {
  const dir = join(DIST, 'assets');
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.js')) bytes += gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
  }
  return bytes / 1000;
}

/** The measurements: a label, the query, and the prefix of its keys in budgets.json. */
const RUNS = [
  { label: 'bowl', query: '?hook&perf', prefix: '' },
  { label: 'horde', query: '?hook&perf&horde=400&sparks=600', prefix: 'horde' },
];

function key(prefix, name) {
  return prefix ? prefix + name[0].toUpperCase() + name.slice(1) : name;
}

async function measure({ url, browser }, query, problems) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    await page.goto(`${url}/${query}`);
    await waitForHook(page, 60_000);
    const start = await page.evaluate(() => {
      const h = window.__shmoove;
      h.hold({ steerX: 0, steerY: 1, carve: true });
      return h.state();
    });
    // Count the frames drawn during the run, in the page, without touching the game loop.
    await page.evaluate(() => {
      const w = window;
      w.__perfFrames = 0;
      const count = () => {
        w.__perfFrames++;
        requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    });
    // Run until enough frames and ticks have happened, not for a fixed time: software rendering
    // draws a load-dependent number of frames per second.
    const t0 = Date.now();
    const read = () =>
      page.evaluate(() => {
        const h = window.__shmoove;
        return { stats: h.stats(), end: h.state(), frames: window.__perfFrames };
      });
    let r = await read();
    while ((r.frames < MIN_FRAMES || r.end.tick - start.tick < MIN_TICKS) && Date.now() - t0 < CAP_MS) {
      await page.waitForTimeout(250);
      r = await read();
    }
    return { ...r, start, elapsedMs: Date.now() - t0 };
  } finally {
    await context.close();
  }
}

async function main() {
  const problems = [];
  const measured = { jsGzipKb: jsGzipKb() };
  const runs = {};
  await withAppAndBrowser(async (env) => {
    for (const r of RUNS) {
      const runProblems = [];
      const { stats, start, end, frames, elapsedMs } = await measure(env, r.query, runProblems);
      const travel = Math.hypot(end.x - start.x, end.z - start.z);
      const ticks = end.tick - start.tick;
      measured[key(r.prefix, 'frameMs')] = stats.frameMs;
      measured[key(r.prefix, 'stepMs')] = stats.stepMs;
      measured[key(r.prefix, 'drawCalls')] = stats.drawCalls;
      measured[key(r.prefix, 'triangles')] = stats.triangles;
      const secs = (elapsedMs / 1000).toFixed(1);
      if (ticks < MIN_TICKS) runProblems.push(`the sim advanced only ${ticks} ticks in ${secs} s (cap hit, ${CAP_MS / 1000} s)`);
      if (travel < MIN_TRAVEL_M) runProblems.push(`the mover travelled only ${travel.toFixed(1)} m`);
      if (frames < MIN_FRAMES) runProblems.push(`only ${frames} frames were drawn in ${secs} s (cap hit, ${CAP_MS / 1000} s)`);
      for (const p of runProblems) problems.push(`${r.label}: ${p}`);
      runs[r.label] = { query: r.query, runMs: elapsedMs, frames, ticks, travelM: travel };
      console.log(`[perf] ${r.label}: ${secs} s at ${CPU_THROTTLE}x CPU throttle: ${frames} frames, ${ticks} ticks, ${travel.toFixed(1)} m`);
    }
  });

  const rows = [];
  for (const [key, budget] of Object.entries(budgets)) {
    const value = measured[key];
    if (typeof value !== 'number') {
      problems.push(`budget '${key}' has no measurement`);
      continue;
    }
    const ok = value <= budget;
    rows.push({ key, value, budget, ok });
    if (!ok) problems.push(`${key} ${value.toFixed(2)} is over its budget of ${budget}`);
  }

  for (const r of rows) {
    console.log(`  ${r.key.padEnd(15)} ${r.value.toFixed(r.value < 10 ? 3 : 1).padStart(10)}  budget ${String(r.budget).padStart(7)}  ${r.ok ? 'ok' : 'OVER'}`);
  }

  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  const report = {
    when: new Date().toISOString(),
    cpuThrottle: CPU_THROTTLE,
    runs,
    measured,
    budgets,
    problems,
    pass: problems.length === 0,
  };
  writeFileSync(join(ROOT, 'artifacts', 'perf.json'), JSON.stringify(report, null, 2) + '\n');
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(problems.length ? '[perf] FAIL' : '[perf] ok', '(artifacts/perf.json)');
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
