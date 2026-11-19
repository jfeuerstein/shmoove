// arsenal: every weapon at level 3, one of each map thing in a row ahead and one of each zone beside
// it, with a crowd of 120 of every kind around (elites included). First a look down the row of things
// (arsenal-row.png); then the mover rides in, hops (Skipper stones on the hop, Slam on the landing)
// and tucks (the Lance) in the middle of the fight (arsenal.png). The frame must stay within the
// draw-call budget, draw more than the empty bowl, and log nothing.
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

/** tests/perf/budgets.json `hordeDrawCalls`: the budget with everything M3 draws on screen. */
const DRAW_CALL_BUDGET = 32;
/** tests/perf/budgets.json `hordeTriangles`. */
const TRIANGLE_BUDGET = 120000;
/** The empty bowl draws about 46 000 triangles; the crowd, things and weapons add well over this. */
const MIN_EXTRA_TRIANGLES = 6000;
const FORWARD = { steerX: 0, steerY: 1, carve: true };
const TUCK = { steerX: 0, steerY: 1, carve: false };
/** EV_HOP, EV_LAND in src/sim/types.ts. */
const EV_HOP = 1;
const EV_LAND = 4;

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));

export default {
  name: 'arsenal',
  query: '?hook&arsenal&horde=120',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    await hook.step(2);
    const start = await hook.state();
    check(start.weapons.length === 4 && start.weapons.every((w) => w.level === 3), 'the slots show four weapons at level 3', start.weapons);
    check(start.enemies === 120, 'the crowd is there', start.enemies);
    check(start.offer === null, 'no offer holds the stage', start.offer);

    // Down the row of things, before anything moves.
    for (let i = 0; i < 4; i++) await hook.step(1);
    await page.waitForTimeout(200);
    await settle(page);
    await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'arsenal-row.png'), timeout: 120_000 });

    // Ride in and build speed: gear 2 at least, so the Lance will come on when tucked.
    await hook.hold(FORWARD);
    await hook.step(60);
    let riding = await hook.state();
    for (let i = 0; i < 30 && riding.gear < 2; i++) {
      await hook.step(15);
      riding = await hook.state();
    }
    check(riding.gear >= 2, 'the mover got up to gear 2', riding);
    check(riding.offer === null && riding.phase === 0, 'offers are answered at once: the stage never holds', riding);
    check(Math.hypot(riding.x - start.x, riding.z - start.z) > 5, 'the mover rode in', riding);

    // A hop: a stone (or two) leaves on the hop, and the landing slams.
    await hook.hop();
    await hook.step(1);
    let events = (await hook.state()).events;
    let sawHop = (events & EV_HOP) !== 0;
    let sawLand = false;
    for (let i = 0; i < 120 && !sawLand; i++) {
      await hook.step(1);
      events = (await hook.state()).events;
      sawHop ||= (events & EV_HOP) !== 0;
      sawLand ||= (events & EV_LAND) !== 0;
    }
    check(sawHop, 'the mover hopped');
    check(sawLand, 'and landed');

    // Tuck: the Lance comes on once the gear is high enough.
    await hook.hold(TUCK);
    await hook.step(20);
    const tucked = await hook.state();
    check(tucked.tucked === true, 'the mover is tucked', tucked);
    check(tucked.gear >= 2, 'in gear 2 or better, so the Lance is on', tucked);
    check(tucked.phase === 0, 'still playing', tucked);

    // A few frames so the stats window is all fight, then the picture with a hop in flight.
    await hook.hop();
    for (let i = 0; i < 8; i++) await hook.step(1);
    const stats = await hook.stats();
    check(stats.drawCalls > 0 && stats.drawCalls <= DRAW_CALL_BUDGET, `draw calls within ${DRAW_CALL_BUDGET}`, stats);
    check(stats.triangles > 46000 + MIN_EXTRA_TRIANGLES, 'the crowd, things and weapons are drawn', stats);
    check(stats.triangles <= TRIANGLE_BUDGET, `triangles within ${TRIANGLE_BUDGET}`, stats);
    await page.waitForTimeout(200);
    await t.shot();
    await hook.hold(null);
  },
};
