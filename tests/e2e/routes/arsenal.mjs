// arsenal: every weapon at level 3, one of each map thing in a row ahead (after the map's own) and
// one of each zone beside it, with a crowd of 120 of every kind around (elites included). First a
// look down the row of things (arsenal-row.png); then the rider pushes in, hops and lands, and tucks
// to coast through the fight while every weapon fires on its timer (arsenal.png). The frame must
// stay within the draw-call and triangle budgets, draw more than the empty bowl, and log nothing.
// Then the same stage in a second page at a high pixel density, cropped close round the rider so
// the board and the pose can be judged (arsenal-rider.png).
//
// Then, each in a page of its own:
// - the zones beside the row of things, close (zones.png): a spiked mine, tar, a lob ring;
// - the sparks of a crowd of 400 being pulled in (sparks.png), and a level-up (level-up.png);
// - the arsenal at its loudest: the four slotted weapons raised to level 5 with 400 around
//   (arsenal-loud.png). (The fixture puts the other six outside the four slots, where the hook
//   cannot raise them.)
//
// With SHMOOVE_GALLERY=1 (the first five weapons) or =2 (the other five) the close look and those
// three are skipped for the weapon gallery (all of it would not fit in a route's time): each weapon
// alone, at level 1 and at level 5, caught firing into a crowd of 200 that has closed in round the
// rider (weapon-<name>-l1.png, weapon-<name>-l5.png). Each waits until its weapon kills, then a few ticks more so its effect is in
// the air; the Bumper is set off by a hit, and the Wake rides a circle until a loop pops.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newPhoneContext, ROOT, waitForHook, watchProblems } from '../run.mjs';

const budgets = JSON.parse(readFileSync(join(ROOT, 'tests', 'perf', 'budgets.json'), 'utf8'));
/** tests/perf/budgets.json: the budget with everything on screen. */
const DRAW_CALL_BUDGET = budgets.hordeDrawCalls;
const TRIANGLE_BUDGET = budgets.hordeTriangles;
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
/** Weapon ids (src/sim/arsenal.ts W_*), in order, and passives there are. */
const WEAPONS = ['wake', 'seekers', 'bumper', 'slam', 'orbit', 'static', 'skipper', 'slipstream', 'crumbs', 'lance'];
const PASSIVE_COUNT = 11;
/** Ticks for the crowd to close in round a rider standing still, between two pictures, and the most to wait for a kill. */
const GATHER_TICKS = 150;
const BETWEEN_TICKS = 60;
const WAIT_TICKS = 240;
/** Ticks stepped at a time while waiting for a kill. */
const WAIT_STEP = 3;
/** SHMOOVE_GALLERY=1 shoots the first five weapons, =2 the other five. */
const GALLERY = process.env.SHMOOVE_GALLERY === '1' ? [0, 1, 2, 3, 4] : process.env.SHMOOVE_GALLERY === '2' ? [5, 6, 7, 8, 9] : null;
/** Ticks after the first kill before the picture, per weapon: long enough for its effect to be in the air. */
const AFTER_KILL = { wake: 3, seekers: 1, bumper: 2, slam: 5, orbit: 0, static: 2, skipper: 3, slipstream: 0, crumbs: 3, lance: 0 };
/** Round and round among the crowd, so the camera follows from behind; the Wake's circle is tighter, to close a loop. */
const CIRCLE = { steerX: 0.55, steerY: 0.8, carve: true };
const TIGHT = { steerX: 1, steerY: 0.4, carve: true };
/** Weapons whose effect is over in a blink: their picture is taken at once. */
const QUICK = new Set(['static', 'seekers', 'bumper', 'skipper']);
/** Weapons that are always on: no kill to wait for. */
const ALWAYS_ON = new Set(['orbit', 'lance', 'slipstream']);

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

/** Only weapon `id` at `level`: everything else, passives too, taken away (a card pick may have added some). */
async function only(page, id, level) {
  await page.evaluate(
    ([id, level, n, np]) => {
      const h = window.__shmoove;
      for (let k = 0; k < n; k++) if (k !== id) h.setWeapon(k, 0);
      for (let k = 0; k < np; k++) h.setPassive(k, 0);
      h.setWeapon(id, level);
    },
    [id, level, WEAPONS.length, PASSIVE_COUNT],
  );
}

/** Step a few ticks at a time until the kill count rises by at least `jump` in one go (or `most` ticks); returns whether it did. */
async function untilKill(page, id, level, most, jump = 1) {
  let kills = await page.evaluate(() => window.__shmoove.state().kills);
  for (let t = 0; t < most; t += WAIT_STEP) {
    const s = await page.evaluate((n) => {
      const h = window.__shmoove;
      h.step(n);
      return h.state();
    }, WAIT_STEP);
    if (s.phase === PHASE_CHOOSE) {
      await page.evaluate(() => {
        const h = window.__shmoove;
        h.pick(0);
        h.step(1);
      });
      await only(page, id, level);
    }
    if (s.kills - kills >= jump) return true;
    kills = s.kills;
  }
  return false;
}

/** The picture. Effects age in real time even while the sim is held, so a quick one is taken at once. */
async function screenshot(page, name, quick = false) {
  if (!quick) await page.waitForTimeout(120);
  await settle(page);
  await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', `${name}.png`), timeout: 120_000 });
}

/** A fresh page on `query`, paused, with the problems it logs collected. */
async function openPage(browser, url, query, problems, dpr = 2) {
  const context = await newPhoneContext(browser, dpr);
  const page = await context.newPage();
  watchProblems(page, problems);
  await page.goto(`${url.origin}/${query}`);
  await waitForHook(page);
  await page.evaluate(() => window.__shmoove.pause(true));
  return { context, page };
}

/** Weapons `ids`, each alone at level 1 and then at level 5, caught firing into a crowd closed in round the rider. */
async function weaponsPage(browser, url, ids, problems, check) {
  const { context, page } = await openPage(browser, url, '?hook&horde=200', problems);
  try {
    await page.evaluate((f) => window.__shmoove.hold(f), CIRCLE);
    await stepThrough(page, GATHER_TICKS);
    for (const id of ids) {
      const name = WEAPONS[id];
      for (const level of [1, 5]) {
        await only(page, id, level);
        await page.evaluate((f) => window.__shmoove.hold(f), name === 'wake' ? TIGHT : CIRCLE);
        if (name === 'wake') {
          // The loop pops: many go at once.
          await untilKill(page, id, level, WAIT_TICKS * 2, 3);
        } else {
          await stepThrough(page, BETWEEN_TICKS);
          await only(page, id, level);
          if (name === 'bumper') await page.evaluate(() => window.__shmoove.hurt(8));
          else if (!ALWAYS_ON.has(name)) {
            const killed = await untilKill(page, id, level, WAIT_TICKS, name === 'slam' ? 2 : 1);
            check(killed, `${name} at level ${level} killed something in the crowd`);
          }
        }
        await page.evaluate((n) => window.__shmoove.step(n), AFTER_KILL[name]);
        // A level-up's cards would cover the picture: take one, put the loadout back, step on.
        if ((await page.evaluate(() => window.__shmoove.state().phase)) === PHASE_CHOOSE) {
          await page.evaluate(() => window.__shmoove.pick(0));
          await only(page, id, level);
          await page.evaluate(() => window.__shmoove.step(2));
        }
        await screenshot(page, `weapon-${name}-l${level}`, QUICK.has(name));
      }
    }
  } finally {
    await context.close();
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

    const url = new URL(page.url());
    const browser = page.context().browser();
    const problems = [];

    if (GALLERY) {
      await weaponsPage(browser, url, GALLERY, problems, check);
      check(problems.length === 0, 'the other pages logged nothing', problems);
      return;
    }

    // The rider, close: a second page of the same stage at a high pixel density, pushing off.
    {
      const { context, page: close } = await openPage(browser, url, url.search, problems, CLOSE_DPR);
      try {
        await close.evaluate((f) => window.__shmoove.hold(f), FORWARD);
        await stepThrough(close, 40);
        await close.waitForTimeout(200);
        await settle(close);
        await close.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'arsenal-rider.png'), clip: CLOSE, timeout: 120_000 });
      } finally {
        await context.close();
      }
    }

    // The zones, close: placed beside them, looking along the row (the fixture lays them 14, 19 and
    // 24 m ahead of the spawn and 3.5 m to the side away from the things).
    {
      const { context, page: z } = await openPage(browser, url, '?hook&arsenal', problems);
      try {
        await z.evaluate(() => {
          const h = window.__shmoove;
          const s = h.state();
          const yaw = s.viewYaw;
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          // Back a little and over toward the zones' side.
          h.place(s.x + fx * 6 - fz * 2, s.z + fz * 6 + fx * 2, yaw, 0);
          h.step(30);
        });
        await screenshot(z, 'zones');
      } finally {
        await context.close();
      }
    }

    // A level-up in the crowd, and the sparks it has dropped being pulled in.
    {
      const { context, page: l } = await openPage(browser, url, '?hook&horde=400&sparks=600', problems);
      try {
        await l.evaluate((f) => window.__shmoove.hold(f), FORWARD);
        await stepThrough(l, 60);
        await l.evaluate(() => {
          const h = window.__shmoove;
          h.setWeapon(7, 5);
          h.setPassive(4, 5);
        });
        await l.evaluate(() => window.__shmoove.step(20));
        await screenshot(l, 'sparks');
        await l.evaluate(() => {
          const h = window.__shmoove;
          h.giveXp(h.state().xpNext);
          h.step(3);
        });
        await screenshot(l, 'level-up');
      } finally {
        await context.close();
      }
    }

    // At its loudest: the slotted four at level 5, the rest at 3, with 400 around.
    {
      const { context, page: a } = await openPage(browser, url, '?hook&arsenal&horde=400', problems);
      try {
        await a.evaluate(() => {
          const h = window.__shmoove;
          for (const w of h.state().weapons) h.setWeapon(w.id, 5);
        });
        await a.evaluate((f) => window.__shmoove.hold(f), FORWARD);
        await stepThrough(a, 150);
        await a.evaluate((f) => window.__shmoove.hold(f), TUCK);
        await stepThrough(a, 30);
        await screenshot(a, 'arsenal-loud');
      } finally {
        await context.close();
      }
    }
    check(problems.length === 0, 'the other pages logged nothing', problems);
  },
};
