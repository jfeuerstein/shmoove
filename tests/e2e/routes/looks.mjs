// looks: every look loads, draws a crowd without a console error or warning, shows which look it
// is, and the saved choice is used when the URL names none. Saves look-<id>.png for each.
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

const LOOKS = ['night', 'pool', 'tape', 'riso'];

/** The frame as the player sees it, as PNG bytes; saved under `name` too. */
async function picture(page, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  return page.screenshot({ path: join(ROOT, 'artifacts', 'screens', `${name}.png`), timeout: 120_000 });
}

/** The share of sampled screen pixels that differ between two screenshots, 0..1. */
async function differs(page, a, b) {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 128;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 64, 128);
        return g.getImageData(0, 0, 64, 128).data;
      };
      const p = await load(x);
      const q = await load(y);
      let n = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 60) n++;
      }
      return n / (p.length / 4);
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

export default {
  name: 'looks',
  query: '?hook&nolesson&mute&horde=120&sparks=80&arsenal',
  async run(t) {
    const { page, hook, check } = t;
    const base = page.url().replace(/\?.*$/, '');
    const shots = [];
    for (const look of LOOKS) {
      await page.goto(`${base}?hook&nolesson&mute&horde=120&sparks=80&arsenal&look=${look}`);
      await page.waitForFunction(() => window.__shmoove?.ready === true);
      await hook.pause(true);
      await hook.hold({ steerX: 0.25, steerY: 1, carve: true });
      await hook.step(150);
      const s = await hook.state();
      check(s.enemies > 50, `${look}: the crowd is there`, s.enemies);
      const ui = await page.evaluate(() => document.documentElement.dataset.look);
      check(ui === look, `${look}: the page says which look it is in`, ui);
      const stats = await hook.stats();
      check(stats.drawCalls > 5, `${look}: the whole frame's draw calls are counted, not just the last pass`, stats);
      shots.push(await picture(page, `look-${look}`));
    }
    for (let i = 1; i < shots.length; i++) {
      const d = await differs(page, shots[0], shots[i]);
      check(d > 0.3, `${LOOKS[i]} looks different from ${LOOKS[0]}`, d);
    }

    // The saved choice is used when the URL names no look; the URL wins when it does.
    await page.evaluate(() => localStorage.setItem('shmoove.look', 'tape'));
    await page.goto(`${base}?hook&nolesson&mute`);
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    check((await page.evaluate(() => document.documentElement.dataset.look)) === 'tape', 'the saved look is used');
    await page.goto(`${base}?hook&nolesson&mute&look=pool`);
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    check((await page.evaluate(() => document.documentElement.dataset.look)) === 'pool', 'the URL wins over the saved look');
    await page.evaluate(() => localStorage.removeItem('shmoove.look'));
    await t.shot();
  },
};
