// figures: the rider close, as the chase camera sees it, in each pose and carrying the passives. A
// second page of the bowl with no horde (`?solo`) at a high pixel density, cropped round the rider:
// pushing off (figures-push.png), riding (figures-ride.png), coasting tucked (figures-coast.png),
// carving hard (figures-carve.png), the ollie's pop, air and landing (figures-pop.png,
// figures-air.png, figures-land.png), a boardslide on the longest rail (figures-grind.png), the
// flinch of a hit (figures-hurt.png), the passives four at a time at level 1 and at level 5
// (figures-passives-a1.png ... figures-passives-c5.png), and last the wipe-out when the run ends
// dead (figures-wipeout.png). The route's own screenshot (figures.png) is the whole screen, riding.
import { join } from 'node:path';
import { newPhoneContext, ROOT, waitForHook, watchProblems } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };
const TUCK = { steerX: 0, steerY: 1, carve: false };
const CARVE = { steerX: 1, steerY: 0.5, carve: true };
/** EV_LAND in src/sim/types.ts. */
const EV_LAND = 4;
/** PHASE_DEAD in src/sim/world.ts. */
const PHASE_DEAD = 1;
/** P_* in src/sim/arsenal.ts, four at a time (a build carries at most four). */
const PASSIVE_GROUPS = [
  ['a', [0, 1, 2, 3]], // Wax, Haste, Springs, Wings
  ['b', [4, 5, 6, 7]], // Magnet, Heart, Regen, Might
  ['c', [8, 9, 10]], // Hide, Luck, Wide Load
];
/** The clear run-up the generator leaves before each end of a rail, m, and FEEL.runSpeed, m/s. */
const RUN_UP = 3;
const RUN_SPEED = 10;
/** The close look: pixel density, and the crop round the rider in CSS px (the chase camera keeps it
 *  a little below the middle of the screen). */
const CLOSE_DPR = 5;
const CLOSE = { x: 105, y: 440, width: 180, height: 200 };

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);

export default {
  name: 'figures',
  query: '?hook&solo',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    await hook.hold(FORWARD);
    await hook.step(90);
    await t.shot();
    await hook.hold(null);

    const url = new URL(page.url());
    const context = await newPhoneContext(page.context().browser(), CLOSE_DPR);
    const problems = [];
    try {
      const close = await context.newPage();
      watchProblems(close, problems);
      await close.goto(url.href);
      await waitForHook(close);
      const c = (m, ...a) => call(close, m, ...a);
      const shot = async (name) => {
        await settle(close);
        await close.screenshot({ path: join(ROOT, 'artifacts', 'screens', `figures-${name}.png`), clip: CLOSE, timeout: 120_000 });
      };
      await c('pause', true);
      await c('step', 1);
      const spawn = await c('state');
      const home = (speed) => c('place', spawn.x, spawn.z, spawn.viewYaw, speed);

      // Pushing off from standing.
      await home(0);
      await c('hold', FORWARD);
      await c('step', 24);
      let s = await c('state');
      check(s.speed > 0.5 && s.speed < RUN_SPEED * 0.95 && s.grounded && !s.tucked, 'pushing: under way, below run speed', s);
      await shot('push');

      // Riding at speed with the stick held.
      await home(RUN_SPEED * 1.2);
      await c('step', 8);
      await shot('ride');

      // Coasting, tucked.
      await c('hold', TUCK);
      await c('step', 20);
      s = await c('state');
      check(s.tucked, 'coasting tucked', s);
      await shot('coast');

      // Carving hard.
      await home(RUN_SPEED * 1.3);
      await c('hold', CARVE);
      await c('step', 10);
      await shot('carve');

      // The ollie: pop, air, landing.
      await home(RUN_SPEED * 1.2);
      await c('hold', FORWARD);
      await c('step', 4);
      await c('hop');
      await c('step', 2);
      s = await c('state');
      check(!s.grounded, 'popped off the ground', s);
      await shot('pop');
      await c('step', 12);
      await shot('air');
      let landed = false;
      for (let i = 0; i < 120 && !landed; i++) {
        await c('step', 1);
        landed = ((await c('state')).events & EV_LAND) !== 0;
      }
      check(landed, 'landed');
      await c('step', 2);
      await shot('land');

      // A boardslide on the longest rail.
      const rails = await c('rails');
      check(rails.length > 0, 'the bowl has rails', rails.length);
      if (rails.length > 0) {
        const len = (r) => Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        let pick = 0;
        for (let i = 1; i < rails.length; i++) if (len(rails[i]) > len(rails[pick])) pick = i;
        const r = rails[pick];
        const l = len(r);
        const ux = (r.x1 - r.x0) / l;
        const uz = (r.z1 - r.z0) / l;
        const along = (p) => (p.x - r.x0) * ux + (p.z - r.z0) * uz;
        await c('place', r.x0 - ux * RUN_UP, r.z0 - uz * RUN_UP, Math.atan2(ux, uz), RUN_SPEED);
        await c('hold', FORWARD);
        s = await c('state');
        for (let i = 0; i < 60 && along(s) < -1; i++) {
          await c('step', 1);
          s = await c('state');
        }
        await c('hop');
        for (let i = 0; i < 40 && s.rail < 0; i++) {
          await c('step', 1);
          s = await c('state');
        }
        check(s.rail === pick, 'grinding the rail', s);
        await c('step', 8);
        await shot('grind');
      }

      // A hit: the flinch.
      await home(RUN_SPEED);
      await c('hold', FORWARD);
      await c('step', 6);
      await c('hurt', 5);
      await c('step', 5);
      await shot('hurt');
      await c('step', 60);

      // The passives, four at a time, at level 1 and at level 5.
      for (const [name, ids] of PASSIVE_GROUPS) {
        for (const level of [1, 5]) {
          for (let id = 0; id < 11; id++) await c('setPassive', id, ids.includes(id) ? level : 0);
          await home(RUN_SPEED);
          await c('hold', FORWARD);
          await c('step', 20);
          s = await c('state');
          check(s.passives.length === ids.length && s.passives.every((p) => p.level === level), `passives ${name} at level ${level}`, s.passives);
          await shot(`passives-${name}${level}`);
        }
      }
      for (let id = 0; id < 11; id++) await c('setPassive', id, 0);

      // The run ends dead: the wipe-out.
      await home(RUN_SPEED * 0.6);
      await c('hold', null);
      await c('hurt', 100000);
      await c('step', 40);
      s = await c('state');
      check(s.phase === PHASE_DEAD, 'the run is over, dead', s.phase);
      await shot('wipeout');
    } finally {
      await context.close();
    }
    check(problems.length === 0, 'the close look logged nothing', problems);
  },
};
