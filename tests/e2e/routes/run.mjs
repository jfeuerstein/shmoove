// run: the run on screen. On the bowl with a run: the clock reads 3:00 and counts down; a hit
// shortens the health bar; a killing hit ends the run, the STOPPED card rises and the mover stops;
// a real touch on AGAIN starts over (full health, clock back, card gone, the mover moves again).
// Screenshots: the HUD mid-run (run.png) and the end card (run-end.png).
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };

const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const hpScale = (page) =>
  page.evaluate(() => {
    const m = /scaleX\(([\d.]+)\)/.exec(document.querySelector('.hud-hp .hud-fill')?.style.transform ?? '');
    return m ? Number(m[1]) : null;
  });
const cardShown = (page) => page.evaluate(() => document.querySelector('.end')?.classList.contains('end-show') === true);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export default {
  name: 'run',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    const hurt = (n) => page.evaluate((d) => window.__shmoove.hurt(d), n);
    await hook.pause(true);
    await hook.step(1);

    check((await text(page, '.hud-clock')) === '3:00', 'the clock starts at 3:00', await text(page, '.hud-clock'));
    check((await hpScale(page)) === 1, 'the health bar starts full', await hpScale(page));
    check((await cardShown(page)) === false, 'no card while playing');

    await hook.step(120);
    check((await text(page, '.hud-clock')) === '2:58', 'the clock counts down', await text(page, '.hud-clock'));

    await hurt(30);
    await hook.step(1);
    const hit = await hook.state();
    const scale = await hpScale(page);
    check(hit.hp === 70, 'the hit took 30 health', hit);
    check(scale !== null && Math.abs(scale - 0.7) < 0.02, 'the health bar is shorter', scale);

    // The HUD mid-run: nothing over the middle of the screen.
    await hook.hold(FORWARD);
    await hook.step(90);
    // The hit pulse plays in real time: let it finish before the picture.
    await page.waitForTimeout(600);
    await t.shot();
    const mid = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let covering = 0;
      for (const sel of ['.hud-clock', '.hud-kills', '.hud-hp', '.hud-xp', '.end']) {
        const e = document.querySelector(sel);
        if (!e) continue;
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.bottom > h * 0.3 && r.top < h * 0.7 && r.right > w * 0.25 && r.left < w * 0.75 && sel !== '.end') covering++;
      }
      return covering;
    });
    check(mid === 0, 'no run HUD part over the middle of the screen', mid);

    // A killing hit.
    await hurt(500);
    await hook.step(1);
    check((await cardShown(page)) === false, 'the card waits for the pause');
    await hook.step(60);
    const dead = await hook.state();
    check(dead.phase === 1, 'the run is over', dead);
    check(dead.hp === 0, 'health is empty', dead);
    check((await cardShown(page)) === true, 'the card appears');
    const title = await text(page, '.end-title');
    check(title === 'STOPPED', 'the card says STOPPED', title);
    await hook.step(30);
    const still = await hook.state();
    check(dist(dead, still) < 0.001, 'the mover has stopped', { dead, still });
    const speed = await text(page, '.hud-speed');
    check(speed === '0 m/s', 'the HUD shows a speed of 0 m/s over the card', speed);
    // Let the card finish rising before the picture.
    await page.waitForTimeout(600);
    const file = join(ROOT, 'artifacts', 'screens', 'run-end.png');
    await page.screenshot({ path: file, timeout: 120_000 });

    // A real touch on AGAIN.
    const box = await page.locator('.end-again').boundingBox();
    check(box !== null && box.height >= 56 && box.width >= 390 * 0.6, 'AGAIN is big enough', box);
    if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await hook.step(1);
    check((await cardShown(page)) === false, 'the card goes');
    const fresh = await hook.state();
    check(fresh.hp === fresh.maxHp && fresh.maxHp > 0, 'health is full again', fresh);
    check(fresh.phase === 0 && fresh.level === 1 && fresh.kills === 0, 'a fresh run', fresh);
    check((await text(page, '.hud-clock')) === '3:00', 'the clock is back at 3:00', await text(page, '.hud-clock'));
    check((await hpScale(page)) === 1, 'the health bar is full again', await hpScale(page));

    await hook.hold(FORWARD);
    await hook.step(90);
    const moving = await hook.state();
    check(dist(fresh, moving) > 1 && moving.speed > 1, 'the mover moves again', { fresh, moving });
    await hook.hold(null);
  },
};
