// arsenal: every weapon at level 3, one of each map thing in a row ahead (after the map's own) and
// one of each zone beside it, with a crowd of 120 of every kind around (elites included). First a
// look down the row of things (arsenal-row.png); then the rider pushes in, hops and lands, and tucks
// to coast through the fight while every weapon fires on its timer (arsenal.png). The frame must
// stay within the draw-call and triangle budgets, draw more than the empty bowl, and log nothing.
// Last, the same stage in a second page at a high pixel density, cropped close round the rider so
// the board and the pose can be judged (arsenal-rider.png).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newPhoneContext, ROOT, waitForHook, watchProblems } from '../run.mjs';

// The budgets with everything on screen are the perf runner's: one place to change them.
const BUDGETS = JSON.parse(readFileSync(join(ROOT, 'tests', 'perf', 'budgets.json'), 'utf8'));
const DRAW_CALL_BUDGET = BUDGETS.hordeDrawCalls;
const TRIANGLE_BUDGET = BUDGETS.hordeTriangles;
/** The empty bowl draws about 46 000 triangles; the crowd, things and weapons add well over this. */
const MIN_EXTRA_TRIANGLES = 6000;
const FORWARD = { steerX: 0, steerY: 1, carve: true };
const TUCK = { steerX: 0, steerY: 1, carve: false };
/** EV_HOP, EV_LAND in src/sim/types.ts. */
const EV_HOP = 1;
const EV_LAND = 4;
/** PHASE_CHOOSE in src/sim/world.ts. */
const PHASE_CHOOSE = 3;
/** The close look at the rider: pixel density, and the crop round it in CSS px (the rider sits a
 *  little below the middle of the screen, where the chase camera keeps it). */
const CLOSE_DPR = 6;
const CLOSE = { x: 120, y: 470, width: 150, height: 150 };

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

/** Step n ticks, answering any card offer that opens so the stage can never hold on one. */
async function stepThrough(page, n) {
  for (let left = n; left > 0; ) {
    const k = Math.min(left, 10);
    await page.evaluate((m) => window.__shmoove.step(m), k);
    left -= k;
    const phase = await page.evaluate(() => window.__shmoove.state().phase);
    if (phase === PHASE_CHOOSE) await page.evaluate(() => window.__shmoove.pick(0));
  }
}

export default {
  name: 'arsenal',
  query: '?hook&arsenal&horde=120',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    await stepThrough(page, 2);
    const start = await hook.state();
    check(start.weapons.length === 4 && start.weapons.every((w) => w.level === 3), 'the slots show four weapons at level 3', start.weapons);
    check(start.enemies === 120, 'the crowd is there', start.enemies);
    check(start.offer === null, 'no offer holds the stage', start.offer);

    // Down the row of things, before anything moves.
    await stepThrough(page, 4);
    await page.waitForTimeout(200);
    await settle(page);
    await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'arsenal-row.png'), timeout: 120_000 });

    // Push in among them.
    await hook.hold(FORWARD);
    await stepThrough(page, 120);
    const riding = await hook.state();
    check(riding.phase === 0, 'still playing: offers never hold the stage', riding);
    check(Math.hypot(riding.x - start.x, riding.z - start.z) > 5, 'the rider pushed in', riding);

    // A hop, and the landing.
    await hook.hop();
    await stepThrough(page, 1);
    let events = (await hook.state()).events;
    let sawHop = (events & EV_HOP) !== 0;
    let sawLand = false;
    for (let i = 0; i < 120 && !sawLand; i++) {
      await stepThrough(page, 1);
      events = (await hook.state()).events;
      sawHop ||= (events & EV_HOP) !== 0;
      sawLand ||= (events & EV_LAND) !== 0;
    }
    check(sawHop, 'the rider hopped');
    check(sawLand, 'and landed');

    // Tuck and coast through the fight: the Slam, the Skipper and the Lance all fire on their timers.
    await hook.hold(TUCK);
    await stepThrough(page, 40);
    const tucked = await hook.state();
    check(tucked.tucked === true, 'the rider is tucked', tucked);
    check(tucked.phase === 0, 'still playing', tucked);
    check(tucked.kills > 0, 'the weapons are killing', tucked);

    // A few frames so the stats window is all fight, then the picture with a hop in flight.
    await hook.hop();
    await stepThrough(page, 8);
    const stats = await hook.stats();
    check(stats.drawCalls > 0 && stats.drawCalls <= DRAW_CALL_BUDGET, `draw calls within ${DRAW_CALL_BUDGET}`, stats);
    check(stats.triangles > 46000 + MIN_EXTRA_TRIANGLES, 'the crowd, things and weapons are drawn', stats);
    check(stats.triangles <= TRIANGLE_BUDGET, `triangles within ${TRIANGLE_BUDGET}`, stats);
    await page.waitForTimeout(200);
    await t.shot();
    await hook.hold(null);

    // The rider, close: a second page of the same stage at a high pixel density, pushing off.
    const url = new URL(page.url());
    const context = await newPhoneContext(page.context().browser(), CLOSE_DPR);
    const problems = [];
    try {
      const close = await context.newPage();
      watchProblems(close, problems);
      await close.goto(url.href);
      await waitForHook(close);
      await close.evaluate(() => window.__shmoove.pause(true));
      await close.evaluate((f) => window.__shmoove.hold(f), { steerX: 0, steerY: 1, carve: true });
      await stepThrough(close, 40);
      await close.waitForTimeout(200);
      await settle(close);
      await close.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'arsenal-rider.png'), clip: CLOSE, timeout: 120_000 });
    } finally {
      await context.close();
    }
    check(problems.length === 0, 'the close look logged nothing', problems);
  },
};
