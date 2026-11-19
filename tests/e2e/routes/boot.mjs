// boot: the game loads on a phone screen, the canvas covers the viewport, the HUD shows gear 1.
import { VIEWPORT } from '../run.mjs';

export default {
  name: 'boot',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    const before = await hook.state();
    // Let the camera settle behind the mover.
    await hook.step(30);

    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, bw: c.width, bh: c.height };
    });
    check(canvas !== null, 'there is a canvas');
    if (canvas) {
      check(canvas.x === 0 && canvas.y === 0, 'canvas starts at the top left', canvas);
      check(canvas.w === VIEWPORT.width && canvas.h === VIEWPORT.height, 'canvas covers the viewport', canvas);
      check(canvas.bw === VIEWPORT.width * 2 && canvas.bh === VIEWPORT.height * 2, 'canvas draws at device pixel ratio 2', canvas);
    }

    const hud = await page.evaluate(() => {
      const g = document.querySelector('.hud-gear');
      const n = document.querySelector('.hud-name');
      const r = g ? g.getBoundingClientRect() : null;
      return { gear: g?.textContent ?? null, name: n?.textContent ?? null, top: r ? r.top : -1, bottom: r ? r.bottom : -1 };
    });
    check(hud.gear === '1', 'HUD shows gear 1', hud);
    check(typeof hud.name === 'string' && hud.name.length > 0, 'HUD names the gear', hud);
    check(hud.top >= 0 && hud.bottom < VIEWPORT.height * 0.2, 'the gear numeral sits at the top of the screen', hud);

    const s = await hook.state();
    check(s.tick === before.tick + 30 && s.grounded && s.gear === 1, 'stepping by hand advances the sim', { before, s });
    // Paused means paused: real time passing does not step the sim.
    await page.waitForTimeout(300);
    const still = await hook.state();
    check(still.tick === s.tick, 'the clock stops while paused', still);
    await t.shot();
  },
};
