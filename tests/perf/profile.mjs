// CPU profile of the perf route (not part of the gate): the same page and throttle as `npm run perf`,
// with the V8 sampling profiler on for the measured window. Prints the functions with the most self
// time and the most inclusive time, and saves artifacts/perf.cpuprofile (opens in Chrome DevTools).
// Names come from the served bundle: run `npx vite build --minify false` first for readable ones
// (and `npm run build` again afterwards). Usage: node tests/perf/profile.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, newPhoneContext, waitForReady, withAppAndBrowser } from '../e2e/lib/browser.mjs';

const CPU_THROTTLE = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ url, browser }) {
  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    const extra = process.env.SKITCH_PERF_PARAMS ? '&' + process.env.SKITCH_PERF_PARAMS : '';
    await page.goto(url + '/?route=perf&mute' + extra);
    await waitForReady(page);
    await sleep(2000);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await sleep(Number(process.env.SKITCH_PROFILE_MS ?? 10000));
    const { profile } = await cdp.send('Profiler.stop');
    return profile;
  } finally {
    await context.close();
  }
}

const profile = await withAppAndBrowser(run);
mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
writeFileSync(join(ROOT, 'artifacts', 'perf.cpuprofile'), JSON.stringify(profile));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const counts = new Map();
for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
const total = profile.samples.length;
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
const self = new Map();
const incl = new Map();
for (const [id, c] of counts) {
  const n = byId.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + c);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    incl.set(k, (incl.get(k) ?? 0) + c);
  }
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`samples ${total}`);
console.log('\nself time');
for (const [k, c] of top(self, 40)) console.log(`  ${((100 * c) / total).toFixed(1).padStart(5)}%  ${k}`);
console.log('\ninclusive time');
for (const [k, c] of top(incl, 60)) console.log(`  ${((100 * c) / total).toFixed(1).padStart(5)}%  ${k}`);
