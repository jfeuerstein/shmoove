// report: the run report. Play a short run to death with the hook; the end card shows the stats
// block and COPY REPORT; the copied text is a readable summary then one line of JSON that parses and
// whose kills equal the game's; AGAIN starts a new log; after a reload the REPORTS sheet (opened from
// the pause sheet) lists the finished run and copies it; where the clipboard refuses, a text box
// holds the report; the end card still fits at 360x640.
// Screenshots: the end card (report.png) and the REPORTS sheet (report-list.png).
import { join } from 'node:path';
import { ROOT } from '../run.mjs';
import { waitForHook } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };

const box = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || e.hidden || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent };
  }, sel);
const tap = async (page, sel) => {
  const b = await box(page, sel);
  if (!b) throw new Error(`${sel} is not on screen`);
  await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
};
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const report = (page) => page.evaluate(() => window.__shmoove.report());

/** The pasted text: lines, then JSON on the last line. */
function split(text) {
  const lines = text.split('\n');
  return { lines, json: JSON.parse(lines[lines.length - 1]) };
}

export default {
  name: 'report',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await hook.pause(true);
    await hook.step(1);

    const first = await report(page);
    check(first !== null && first.outcome === 'running', 'a report of the run so far exists', first?.outcome);

    // A short run: ride forward for twenty seconds, then take a killing hit.
    await hook.hold(FORWARD);
    for (let n = 0; n < 20; n++) {
      await hook.step(60);
      // A level opens cards and holds the clock: take the first.
      if ((await hook.state()).phase === 3) {
        await page.evaluate(() => window.__shmoove.pick(0));
        await hook.step(1);
      }
    }
    await hook.hold(null);
    await page.evaluate(() => window.__shmoove.hurt(10000));
    await hook.step(90);
    const dead = await hook.state();
    check(dead.phase === 1, 'the run is over', dead.phase);
    const live = await report(page);
    check(live.outcome === 'dead' && live.kills === dead.kills, 'the hook report says dead with the game\'s kills', { live: live.kills, dead: dead.kills });
    check(live.seconds > 19 && live.seconds < 23, 'the report has the run time', live.seconds);
    check(live.movement.distance > 50, 'the report has the distance ridden', live.movement.distance);
    check(live.movement.holdingShare > 0.9, 'the report saw the thumb down', live.movement.holdingShare);

    // The end card: the stats block and the button.
    await page.waitForTimeout(600);
    const stats = await box(page, '.end-stats');
    check(stats !== null && stats.text.split('\n').length === 3, 'the end card shows a three-line stats block', stats?.text);
    check(/kills/.test(stats?.text ?? '') && /Top weapon/.test(stats?.text ?? '') && /Hurt most/.test(stats?.text ?? ''), 'the block has kills, top weapon and what hurt most', stats?.text);
    const copyBtn = await box(page, '.end-report');
    check(copyBtn !== null && copyBtn.h >= 44, 'COPY REPORT is on the card and big enough', copyBtn);
    await t.shot();

    // COPY REPORT, by touch.
    await tap(page, '.end-report');
    await page.waitForTimeout(150);
    const label = await box(page, '.end-report');
    check(label?.text === 'Copied', 'the button says Copied', label?.text);
    const text = await clipboard(page);
    let parsed = null;
    try {
      parsed = split(text);
    } catch (e) {
      check(false, 'the copied text ends in JSON that parses', String(e));
    }
    if (parsed) {
      check(parsed.lines.length >= 20 && parsed.lines.length <= 30, 'about 25 lines then the JSON', parsed.lines.length);
      check(parsed.json.kills === dead.kills, 'the JSON kills equal the game\'s', { json: parsed.json.kills, game: dead.kills });
      check(parsed.json.outcome === 'dead' && parsed.json.level === dead.level, 'the JSON says dead at the game\'s level', parsed.json.outcome);
      check(/^SHMOOVE run report/.test(parsed.lines[0]) && /Outcome: died/.test(parsed.lines[1]), 'the text opens with the summary', parsed.lines.slice(0, 2));
      check(typeof parsed.json.device.userAgent === 'string' && parsed.json.device.screenW > 0 && parsed.json.device.dpr > 0, 'the device is in it', parsed.json.device);
      check(typeof parsed.json.device.build === 'string' && parsed.json.device.build.length > 0, 'the build id is in it', parsed.json.device.build);
      check(Array.isArray(parsed.json.build.weapons) && parsed.json.build.weapons.length >= 1, 'the build is in it', parsed.json.build);
    }
    await page.waitForTimeout(1700);
    check((await box(page, '.end-report'))?.text === 'COPY REPORT', 'the button goes back to COPY REPORT');

    // The card still fits a small phone.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(300);
    const small = await page.evaluate(() => {
      const r = document.querySelector('.end').getBoundingClientRect();
      const kids = [...document.querySelector('.end').children].filter((c) => !c.hidden && getComputedStyle(c).display !== 'none');
      const last = kids[kids.length - 1].getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, lastBottom: last.bottom, w: window.innerWidth, h: window.innerHeight };
    });
    check(small.top >= 0 && small.bottom <= small.h && small.left >= 0 && small.right <= small.w, 'the end card fits at 360x640', small);
    check(small.lastBottom <= small.bottom, 'nothing spills out of the card at 360x640', small);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // AGAIN starts a new log.
    await tap(page, '.end-again');
    await hook.step(1);
    const fresh = await report(page);
    check(fresh.outcome === 'running' && fresh.kills === 0 && fresh.seconds < 0.1, 'AGAIN starts a new log', { outcome: fresh.outcome, seconds: fresh.seconds });
    check(fresh.id !== live.id, 'the new log is a new run', { fresh: fresh.id, old: live.id });
    check(fresh.movement.distance < 1 && fresh.damage.total === 0, 'nothing carried over', fresh.movement.distance);

    // The finished run is kept: after a reload it is on the REPORTS sheet.
    await page.reload();
    await waitForHook(page);
    await hook.pause(true);
    await hook.step(1);
    await tap(page, '.pause-btn');
    await page.waitForTimeout(200);
    check((await box(page, '.pause')) !== null, 'the pause sheet is up');
    const reportsBtn = await box(page, '.pause-reports');
    check(reportsBtn !== null && reportsBtn.h >= 44, 'the pause sheet has REPORTS', reportsBtn);
    await tap(page, '.pause-reports');
    await page.waitForTimeout(200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.reports-row .reports-when')].map((e) => e.textContent));
    check(rows.length === 1, 'the kept list shows the finished run after a reload', rows);
    check(/DIED/.test(rows[0] ?? '') && /0:2\d/.test(rows[0] ?? ''), 'the row has when, outcome and time', rows[0]);
    await page.waitForTimeout(300);
    const list = join(ROOT, 'artifacts', 'screens', 'report-list.png');
    await page.screenshot({ path: list, timeout: 120_000 });

    // Copy it from the list.
    await tap(page, '.reports-copy');
    await page.waitForTimeout(150);
    check((await box(page, '.reports-copy'))?.text === 'Copied', 'the row button says Copied');
    const again = split(await clipboard(page));
    check(again.json.kills === dead.kills && again.json.id === live.id, 'the kept report is the one that finished', { kills: again.json.kills });
    await tap(page, '.reports-all');
    await page.waitForTimeout(150);
    check((await clipboard(page)).includes('"outcome":"dead"'), 'COPY ALL copies them');

    // Where the clipboard refuses, the text is in a box.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    });
    await tap(page, '.reports-copy');
    await page.waitForTimeout(200);
    const fallback = await page.evaluate(() => {
      const b = document.querySelector('.reports-box');
      const ta = document.querySelector('.reports-text');
      return b && !b.hidden ? ta.value : null;
    });
    check(fallback !== null, 'a refused clipboard opens the text box');
    if (fallback !== null) {
      const f = split(fallback);
      check(f.json.kills === dead.kills, 'the box holds the same report', f.json.kills);
    }
  },
};
