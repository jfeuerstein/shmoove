// perf runner, two checks against tests/perf/budgets.json (DESIGN section 10). Writes artifacts/perf.json.
//
// 1. Frame work: the real rAF loop on /?route=perfcity in headless Chromium at 4x CPU throttle. The
//    route (src/app/routes.ts) rides five legs of the city the way a player would (carving,
//    hopping, hitching, slinging): mercado, terraces, antenna, a fast run down the terraces spine
//    that crosses chunk rows, and the docks. Each leg's timed window is its route ticks after a
//    warm-up (teleport, camera cut, chunks filling); the frames of all windows are pooled for the
//    gated figures, and each window is reported on its own, by part, so a regression can be
//    placed. The run fails unless it really went somewhere: every window travels at least
//    MIN_TRAVEL_M, the windows see all four districts, rides are caught and slung, one window
//    crosses chunk rows at speed while the world streams, and there are enough timed frames.
//    Work excludes the route script itself (it stands in for the player's thumb; its cost is the
//    `route` part). Headless Chromium rasterises in software at about ten frames a second, so most
//    frames carry catch-up steps; the one-step figures cover the frames that carried exactly one.
// 2. Viewpoint tour: /?route=tour in manual mode visits fixed viewpoints in every district, day and
//    night, and checks the most draw calls and triangles seen anywhere against the budgets.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DIST, ROOT, VIEWPORT, newPhoneContext, waitForReady, withAppAndBrowser } from '../e2e/lib/browser.mjs';

const CPU_THROTTLE = 4;
/** Route played for the frame-work check, and the wall-clock limit for playing all its windows. */
const ROUTE = 'perfcity';
const RUN_LIMIT_MS = 200_000;
/** What the timed run must show to count (see the header). */
const MIN_TRAVEL_M = 40;
const MIN_HITCHES = 2;
const MIN_SLUNG_WINDOWS = 2;
const MIN_FRAMES = 300;
/** The streaming window: chunk boundaries crossed, mean speed (m/s), chunk meshes finished. */
const STREAM_CROSSINGS = 2;
const STREAM_SPEED = 8;
const STREAM_BUILDS = 1;
/** A jump longer than this between two frames is a teleport, not travel, m. */
const TELEPORT_M = 30;
/** Sim steps per second (src/sim/constants.ts DT). */
const TICK_HZ = 60;
/** District names by the sim's District values (src/sim/world.ts). */
const DISTRICTS = ['docks', 'mercado', 'terraces', 'antenna'];
/**
 * The tour holds each viewpoint TOUR_HOLD ticks (src/app/routes.ts): drawn as TOUR_FRAMES frames of
 * TOUR_TICKS ticks each, enough frames for the 2 ms-a-frame chunk streaming to fill the view. Every
 * frame is rasterised in software, so drawing all 240 ticks as frames queued minutes of work in the
 * GPU process and the next page could not load.
 */
const TOUR_HOLD = 240;
const TOUR_TICKS = 4;
const TOUR_FRAMES = TOUR_HOLD / TOUR_TICKS;
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

/** Play the route's windows in the normal rAF loop; returns the app's stats for the whole run. */
async function measure({ url, browser }, problems) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    // SKITCH_PERF_PARAMS adds URL parameters, e.g. world=slice, to measure another world.
    await page.goto(url + `/?route=${ROUTE}&mute` + extraParams());
    await waitForReady(page);
    if (await page.evaluate(() => window.__skitch.manual)) throw new Error('app is in manual mode without ?e2e');
    // Route ticks played = sim tick - offset (both advance once per step).
    const start = await page.evaluate(() => {
      const h = window.__skitch;
      const s = h.stats();
      const ticks = s.track?.tick ?? [];
      return { windows: s.windows ?? [], offset: h.state().tick - (ticks.length ? ticks[ticks.length - 1] : 0) };
    });
    if (start.windows.length === 0) throw new Error(`route ${ROUTE} names no timed windows`);
    const end = start.windows[start.windows.length - 1].to;
    const t0 = Date.now();
    for (;;) {
      await sleep(1000);
      const played = (await page.evaluate(() => window.__skitch.state().tick)) - start.offset;
      if (played > end) break;
      if (Date.now() - t0 > RUN_LIMIT_MS) {
        problems.push(`the route played only ${played} of ${end} ticks in ${RUN_LIMIT_MS / 1000} s`);
        break;
      }
    }
    return { ...(await page.evaluate(() => window.__skitch.stats())), runMs: Date.now() - t0 };
  } finally {
    await context.close();
  }
}

/** One pass of the viewpoint tour at day fraction `t`: per viewpoint, the most draw calls and triangles. */
async function tour({ url, browser }, t, problems) {
  // Draw-call and triangle counts do not depend on resolution: device pixel ratio 1 keeps the
  // software rasteriser's work down.
  const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  watchProblems(page, problems);
  try {
    await page.goto(url + `/?route=tour&e2e&mute&t=${t}` + extraParams());
    await waitForReady(page);
    const points = [];
    let lastKey = '';
    for (let k = 0; k < TOUR_MAX_POINTS; k++) {
      const p = await page.evaluate(
        ({ frames, ticks }) => {
          const h = window.__skitch;
          let drawCalls = 0;
          let triangles = 0;
          let x = 0;
          let z = 0;
          for (let f = 0; f < frames; f++) {
            h.advance(ticks);
            const s = h.stats();
            drawCalls = Math.max(drawCalls, s.drawCalls);
            triangles = Math.max(triangles, s.triangles);
            if (f === 0) {
              const st = h.state();
              x = Math.round(st.x);
              z = Math.round(st.z);
            }
          }
          return { x, z, drawCalls, triangles };
        },
        { frames: TOUR_FRAMES, ticks: TOUR_TICKS },
      );
      // Let the GPU process catch up before the next viewpoint.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      const key = `${p.x},${p.z}`;
      // After the last viewpoint the tour stays put.
      if (key === lastKey) break;
      lastKey = key;
      points.push(p);
    }
    return points;
  } finally {
    await context.close();
  }
}

/**
 * Cut the run into its windows: a frame belongs to a window when the last tick it stepped lies in
 * the window's [from, to). Per window: frames, travel, districts, rides, chunk crossings and builds,
 * and frame work in total and by part.
 */
function cutWindows(stats) {
  const track = stats.track ?? {};
  const tick = track.tick ?? [];
  const parts = stats.parts ?? {};
  const steps = parts.steps ?? [];
  // Index of each frame's first step in stepMs.
  const firstStep = [];
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    firstStep.push(acc);
    acc += steps[i];
  }
  return (stats.windows ?? []).map((w) => {
    const idx = [];
    for (let i = 0; i < tick.length; i++) if (tick[i] > w.from && tick[i] <= w.to) idx.push(i);
    let travel = 0;
    let crossings = 0;
    const districtFrames = [0, 0, 0, 0];
    let hitches = 0;
    let slings = 0;
    let built = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      districtFrames[track.district[i]]++;
      hitches += track.hitches[i];
      slings += track.slings[i];
      built += track.built[i];
      if (k > 0) {
        const j = idx[k - 1];
        const d = Math.hypot(track.x[i] - track.x[j], track.z[i] - track.z[j]);
        if (d < TELEPORT_M) travel += d;
        if (track.chunk[i] !== track.chunk[j] && d < TELEPORT_M) crossings++;
      }
    }
    const seen = districtFrames.map((n, d) => (n > 0 ? DISTRICTS[d] : null)).filter((n) => n !== null);
    const main = districtFrames.indexOf(Math.max(...districtFrames));
    const stepMs = [];
    const oneStep = [];
    for (const i of idx) {
      for (let s = 0; s < steps[i]; s++) stepMs.push(stats.stepMs[firstStep[i] + s]);
      if (steps[i] === 1) oneStep.push(stats.workMs[i]);
    }
    const ticks = idx.length ? tick[idx[idx.length - 1]] - tick[idx[0]] : 0;
    const byPart = Object.fromEntries(Object.entries(parts).map(([n, v]) => [n, summarise(idx.map((i) => v[i]))]));
    return {
      name: w.name,
      from: w.from,
      to: w.to,
      district: DISTRICTS[main],
      districts: seen,
      frames: idx.length,
      travelM: travel,
      speed: ticks > 0 ? travel / (ticks / TICK_HZ) : 0,
      hitches,
      slings,
      crossings,
      built,
      work: summarise(idx.map((i) => stats.workMs[i])),
      step: summarise(stepMs),
      oneStep: summarise(oneStep),
      piece: summarise(idx.map((i) => track.piece[i])),
      drawCalls: summarise(idx.map((i) => track.draws[i])),
      triangles: summarise(idx.map((i) => track.tris[i])),
      parts: byPart,
      raw: {
        workMs: idx.map((i) => stats.workMs[i]),
        stepMs,
        oneStepMs: oneStep,
        steps: idx.map((i) => steps[i]),
        parts: Object.fromEntries(Object.entries(parts).map(([n, v]) => [n, idx.map((i) => v[i])])),
      },
    };
  });
}

async function main() {
  const load = loadavg();
  const started = Date.now();
  const problems = [];
  const { stats, tours } = await withAppAndBrowser(async (env) => {
    const stats = await measure(env, problems);
    const tours = [];
    for (const tt of TOUR_TIMES) tours.push({ ...tt, points: await tour(env, tt.t, problems) });
    return { stats, tours };
  });

  const wins = cutWindows(stats);
  const pool = (key) => wins.flatMap((w) => w.raw[key]);
  const work = summarise(pool('workMs'));
  const step = summarise(pool('stepMs'));
  const oneStep = summarise(pool('oneStepMs'));
  const stepsPerFrame = summarise(pool('steps'));
  // Every part of every timed frame, pooled across the windows.
  const pooledParts = Object.fromEntries(
    Object.keys(stats.parts ?? {}).map((name) => [name, summarise(wins.flatMap((w) => w.raw.parts[name] ?? []))]),
  );
  const worldPart = pooledParts.world ?? summarise([]);
  let tourDraw = 0;
  let tourTris = 0;
  for (const tt of tours) {
    for (const p of tt.points) {
      tourDraw = Math.max(tourDraw, p.drawCalls);
      tourTris = Math.max(tourTris, p.triangles);
    }
  }
  const metrics = {
    frames: work.n,
    workMeanMs: work.mean,
    workP50Ms: work.p50,
    workP95Ms: work.p95,
    workMaxMs: work.max,
    stepsPerFrame: stepsPerFrame.mean,
    stepMeanMs: step.mean,
    stepP95Ms: step.p95,
    oneStepFrames: oneStep.n,
    oneStepMeanMs: oneStep.mean,
    oneStepP95Ms: oneStep.p95,
    worldPartMaxMs: worldPart.max,
    worldPartP95Ms: worldPart.p95,
    pieceMaxMs: Math.max(0, ...wins.map((w) => w.piece.max)),
    drawCalls: Math.max(0, ...wins.map((w) => w.drawCalls.max)),
    triangles: Math.max(0, ...wins.map((w) => w.triangles.max)),
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

  // Did the run go anywhere?
  for (const w of wins) if (w.travelM < MIN_TRAVEL_M) problems.push(`window ${w.name}: the skater travelled ${w.travelM.toFixed(1)} m, less than ${MIN_TRAVEL_M} m`);
  const seen = new Set(wins.flatMap((w) => w.districts));
  const missing = DISTRICTS.filter((d) => !seen.has(d));
  if (missing.length > 0 && !process.env.SKITCH_PERF_PARAMS) problems.push(`the timed windows never saw ${missing.join(', ')}`);
  const hitches = wins.reduce((a, w) => a + w.hitches, 0);
  if (hitches < MIN_HITCHES) problems.push(`only ${hitches} hitch(es) in the timed frames, fewer than ${MIN_HITCHES}`);
  const slung = wins.filter((w) => w.hitches > 0 && w.slings > 0).length;
  if (slung < MIN_SLUNG_WINDOWS) problems.push(`only ${slung} window(s) hitched and slung, fewer than ${MIN_SLUNG_WINDOWS}`);
  if (!wins.some((w) => w.crossings >= STREAM_CROSSINGS && w.speed >= STREAM_SPEED && w.built >= STREAM_BUILDS)) {
    problems.push(`no window crossed ${STREAM_CROSSINGS} chunk boundaries at ${STREAM_SPEED} m/s or more while chunks streamed in`);
  }
  if (work.n < MIN_FRAMES) problems.push(`only ${work.n} timed frames, fewer than ${MIN_FRAMES}`);
  for (const tt of tours) if (tt.points.length < 2) problems.push(`the ${tt.name} tour visited only ${tt.points.length} viewpoint(s)`);

  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  console.log(`\nperf (${CPU_THROTTLE}x CPU throttle, route ${ROUTE}: ${wins.length} windows, played in ${(stats.runMs / 1000).toFixed(0)} s)`);
  console.log(`  load average ${load.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`  timed frames ${work.n}, sim steps per frame ${fmt(stepsPerFrame.mean)}, one-step frames ${oneStep.n}`);
  console.log(`  work ms        mean ${fmt(work.mean)}  p50 ${fmt(work.p50)}  p95 ${fmt(work.p95)}  max ${fmt(work.max)}`);
  console.log(`  one-step frame mean ${fmt(oneStep.mean)}  p50 ${fmt(oneStep.p50)}  p95 ${fmt(oneStep.p95)}  max ${fmt(oneStep.max)}`);
  console.log(`  game step      mean ${fmt(step.mean)}  p50 ${fmt(step.p50)}  p95 ${fmt(step.p95)}  max ${fmt(step.max)}  (${step.n} steps)`);
  if (stats.stream) {
    const s = stats.stream;
    console.log(`  streaming since load: ${s.builtTotal} chunks built, worst piece ${fmt(s.worstPieceMs)} ms, worst chunk ${fmt(s.worstChunkMs)} ms, worst frame of building ${fmt(s.worstFrameBuildMs)} ms (teleport builds included)`);
  }

  console.log(`  chunk building in timed frames: world part p95 ${fmt(worldPart.p95)} ms, max ${fmt(worldPart.max)} ms; longest piece ${fmt(metrics.pieceMaxMs)} ms`);
  const worst = [];
  const tick = stats.track?.tick ?? [];
  for (let i = 0; i < tick.length; i++) if (wins.some((w) => tick[i] > w.from && tick[i] <= w.to)) worst.push(i);
  worst.sort((a, b) => stats.parts.world[b] - stats.parts.world[a]);
  console.log(`  slowest world parts: ${worst.slice(0, 5).map((i) => `${fmt(stats.parts.world[i])} ms (piece ${fmt(stats.track.piece[i])}, built ${stats.track.built[i]})`).join(', ')}`);

  console.log(`\n  ${'window'.padEnd(10)}${'district'.padEnd(18)}${'frames'.padStart(7)}${'m'.padStart(6)}${'m/s'.padStart(6)}${'hitch'.padStart(6)}${'sling'.padStart(6)}${'rows'.padStart(5)}${'built'.padStart(6)}${'mean'.padStart(7)}${'p95'.padStart(7)}${'max'.padStart(7)}${'world'.padStart(7)}${'draws'.padStart(6)}${'tris'.padStart(8)}`);
  for (const w of wins) {
    const where = w.districts.length > 1 ? `${w.district} (+${w.districts.filter((d) => d !== w.district).join(',')})` : w.district;
    console.log(
      `  ${w.name.padEnd(10)}${where.padEnd(18)}${String(w.frames).padStart(7)}${w.travelM.toFixed(0).padStart(6)}${w.speed.toFixed(1).padStart(6)}${String(w.hitches).padStart(6)}${String(w.slings).padStart(6)}${String(w.crossings).padStart(5)}${String(w.built).padStart(6)}` +
        `${fmt(w.work.mean).padStart(7)}${fmt(w.work.p95).padStart(7)}${fmt(w.work.max).padStart(7)}${fmt(w.parts.world?.max ?? 0).padStart(7)}${String(w.drawCalls.max).padStart(6)}${String(w.triangles.max).padStart(8)}`,
    );
  }
  const names = Object.keys(stats.parts ?? {});
  if (names.length > 0 && wins.length > 0) {
    console.log(`\n  part, mean / p95 ms per frame`);
    console.log(`  ${''.padEnd(12)}${wins.map((w) => w.name.padStart(14)).join('')}${'pooled'.padStart(14)}`);
    const cell = (s) => `${fmt(s.mean)} / ${fmt(s.p95)}`.padStart(14);
    for (const name of names) console.log(`  ${name.padEnd(12)}${wins.map((w) => cell(w.parts[name])).join('')}${cell(pooledParts[name])}`);
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
  mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
  writeFileSync(
    join(ROOT, 'artifacts', 'perf.json'),
    JSON.stringify(
      {
        cpuThrottle: CPU_THROTTLE,
        route: ROUTE,
        loadAverage: load,
        wallMs: Date.now() - started,
        runMs: stats.runMs,
        metrics,
        breakdown: pooledParts,
        windows: wins,
        stream: stats.stream ?? null,
        tours,
        checks,
        problems,
        pass: ok,
      },
      null,
      2,
    ),
  );
  console.log(`\n  whole run ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.log(ok ? '\nperf: all budgets met' : '\nperf: FAILED');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
});
