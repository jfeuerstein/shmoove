// boot: the game loads on a phone screen, the canvas covers the viewport, the HUD shows the speed, small, at the top centre.
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
      const sp = document.querySelector('.hud-speed');
      const r = sp ? sp.getBoundingClientRect() : null;
      return {
        speed: sp?.textContent ?? null,
        font: sp ? parseFloat(getComputedStyle(sp).fontSize) : 0,
        mid: r ? (r.left + r.right) / 2 : -1,
        top: r ? r.top : -1,
        bottom: r ? r.bottom : -1,
        gearEls: document.querySelectorAll('.hud-gear, .hud-name').length,
      };
    });
    const shown = await hook.state();
    check(hud.speed === `${Math.round(shown.speed)} m/s`, 'HUD shows the speed in m/s', { hud, speed: shown.speed });
    check(hud.gearEls === 0, 'there is no gear numeral or gear name', hud);
    check(hud.font <= 20, 'the speed readout is small', hud);
    check(Math.abs(hud.mid - VIEWPORT.width / 2) < 2, 'the speed sits at the top centre', hud);
    check(hud.top >= 0 && hud.bottom < VIEWPORT.height * 0.08, 'and at the very top of the screen', hud);

    const s = await hook.state();
    check(s.tick === before.tick + 30 && s.grounded && s.gear === 1, 'stepping by hand advances the sim', { before, s });
    // Paused means paused: real time passing does not step the sim.
    await page.waitForTimeout(300);
    const still = await hook.state();
    check(still.tick === s.tick, 'the clock stops while paused', still);
    await t.shot();
  },
};
