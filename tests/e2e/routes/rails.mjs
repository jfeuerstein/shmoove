// rails: the bowl has rails, and one can be ridden. The rider is put at the start of the longest
// rail's run-up facing it (screenshot rails.png: can the rail be seen and aimed at), then sent down
// the run-up at run speed and hops a metre short of the rail: it grinds (`state().rail` is that
// rail), runs along it, and the screenshot rails-grind.png is taken mid-grind.
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

/** FEEL.runSpeed (src/sim/constants.ts), m/s. */
const RUN_SPEED = 10;
/** The clear run-up the generator leaves before each end of a rail, m. */
const RUN_UP = 3;
const FORWARD = { steerX: 0, steerY: 1, carve: true };
/** Thumb down, stick centred: the gentle brake, so the rider waits on the run-up. */
const WAIT = { steerX: 0, steerY: 0, carve: true };

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);

export default {
  name: 'rails',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    await hook.step(1);

    const rails = await call(page, 'rails');
    check(rails.length >= 8, 'the bowl has rails', rails.length);
    if (rails.length === 0) {
      await t.shot();
      return;
    }
    const len = (r) => Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    let pick = 0;
    for (let i = 1; i < rails.length; i++) if (len(rails[i]) > len(rails[pick])) pick = i;
    const r = rails[pick];
    const l = len(r);
    const ux = (r.x1 - r.x0) / l;
    const uz = (r.z1 - r.z0) / l;
    const yaw = Math.atan2(ux, uz);
    const sx = r.x0 - ux * RUN_UP;
    const sz = r.z0 - uz * RUN_UP;
    const along = (s) => (s.x - r.x0) * ux + (s.z - r.z0) * uz;

    // On the run-up, waiting, with the camera settled behind: the rail ahead.
    await call(page, 'place', sx, sz, yaw, 0);
    await hook.hold(WAIT);
    for (let i = 0; i < 6; i++) await hook.step(10);
    const waiting = await hook.state();
    check(waiting.rail === -1, 'not on a rail while waiting on the run-up', waiting);
    check(Math.hypot(waiting.x - sx, waiting.z - sz) < 1.5, 'still on the run-up', { x: waiting.x, z: waiting.z, sx, sz });
    await t.shot();

    // Down the run-up at run speed, a hop a metre short of the end, and onto the rail.
    await call(page, 'place', sx, sz, yaw, RUN_SPEED);
    await hook.hold(FORWARD);
    let s = await hook.state();
    for (let i = 0; i < 60 && along(s) < -1; i++) {
      await hook.step(1);
      s = await hook.state();
    }
    check(along(s) >= -1.5 && along(s) < 0.5, 'rode the run-up to the rail', { along: along(s) });
    await hook.hold(null);
    await hook.hop();
    let on = null;
    for (let i = 0; i < 50 && !on; i++) {
      await hook.step(1);
      const now = await hook.state();
      if (now.rail >= 0) on = now;
    }
    check(on !== null && on.rail === pick, 'a hop from the run-up lands on the rail and grinds it', { on, pick });
    if (on) {
      check(on.grounded === false, 'grinding is off the ground', on);
      check(Math.abs(on.y - (r.y0 + ((r.y1 - r.y0) * along(on)) / l)) < 0.01, 'the board is on the bar', on);
    }

    // Mid-grind: along the rail, still on it.
    await hook.step(12);
    const mid = await hook.state();
    check(mid.rail === pick, 'still grinding mid-rail', mid);
    check(along(mid) > 2 && along(mid) < l, 'moving along the rail', { along: along(mid), length: l });
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(undefined)))));
    await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'rails-grind.png') });

    // Off the end and down again.
    let off = null;
    for (let i = 0; i < 240 && !off; i++) {
      await hook.step(1);
      const now = await hook.state();
      if (now.rail === -1) off = now;
    }
    check(off !== null, 'comes off the rail', off);
  },
};
