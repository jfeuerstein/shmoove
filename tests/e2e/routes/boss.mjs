// boss: the three bosses on screen. For each: the clock is set to just before its time, the world is
// stepped until it is on the field; its bar (name and health) shows under the clock and its name goes
// across the upper screen; a screenshot; then it is brought down through the hook, which heals the
// player and opens a rare card (taken with a real touch). After the third, the CLEARED card.
// The rider waits at the spawn, still, looking into the bowl, so each boss comes up in view.
// Seeing the boss: with the Bruiser behind the rider, the edge marker points at it; its charge lane is
// on the ground through its tell; the Standstill's slow is a disc under it. The big name is timed by
// real time and fits a 360 px screen.
// Screenshots: boss-in.png (the Bruiser's arrival), boss-bruiser.png (the Bruiser in its tell, facing
// where it will charge, its lane coming at the rider), boss-lane.png (the same tell from the side, the
// lane crossing the frame), boss-mortar.png (the Mortar just after it lays its line of rings),
// boss-aura.png (the Standstill's disc with its first ring on it), boss.png (the Standstill with its
// first ring about 15 m out), boss-end.png (the CLEARED card).
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

/**
 * `wait` is the ticks after it arrives when its picture is taken: it rises for 36, then the Bruiser
 * walks 240 and tells for 48, the Mortar lays its first line at 240 (landing 72 later), the
 * Standstill sends its first ring at 210 and the front spreads 0.15 m a tick.
 */
const BOSSES = [
  { kind: 7, at: 180, name: 'THE BRUISER', shot: 'boss-bruiser', wait: 36 + 240 + 20 },
  { kind: 8, at: 360, name: 'THE MORTAR', shot: 'boss-mortar', wait: 36 + 240 + 30 },
  { kind: 9, at: 540, name: 'THE STANDSTILL', shot: null, wait: 36 + 210 + 100 },
];
/** Ticks after the Standstill's arrival when its first ring is about 6 m out, inside its 12 m disc. */
const AURA_WAIT = 36 + 210 + 40;
/** OFFER_BOSS: the rare card a fallen boss gives. */
const OFFER_BOSS = 4;

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
const shown = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || e.hidden) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const cardsUp = (page) => page.evaluate(() => document.querySelector('.cards')?.classList.contains('cards-show') === true);
/** Is a zero-size marker (drawn by its ::before) up, and where on the screen is it? */
const marker = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y };
  }, sel);
const endUp = (page) => page.evaluate(() => document.querySelector('.end')?.classList.contains('end-show') === true);
const picture = async (page, name) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
  await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', `${name}.png`), timeout: 120_000 });
};

/**
 * Advance `n` ticks of play. Level-ups from what the weapons kill open cards and hold the world;
 * those are taken (the first card) so the clock keeps going.
 */
async function play(page, hook, n, home) {
  let left = n;
  while (left > 0) {
    if (home) await home();
    let s = await hook.state();
    while (s.phase === 3) {
      await call(page, 'pick', 0);
      await hook.step(1);
      s = await hook.state();
    }
    const k = Math.min(5, left);
    const before = s.tick;
    await hook.step(k);
    s = await hook.state();
    left -= s.tick - before;
    if (s.phase !== 0 && s.phase !== 3) return;
  }
  let s = await hook.state();
  while (s.phase === 3) {
    await call(page, 'pick', 0);
    await hook.step(1);
    s = await hook.state();
  }
}

export default {
  name: 'boss',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    // The player stands still for a while at each boss: give it what keeps the horde off it.
    await call(page, 'setWeapon', 3, 5); // the Slam
    await call(page, 'setWeapon', 5, 5); // Static
    await call(page, 'setPassive', 5, 5); // Heart
    await hook.step(1);
    check((await shown(page, '.hud-boss')) === false, 'no boss bar at the start');
    // The rider waits at the spawn, still, looking into the bowl; it is put back there for each picture.
    const spawn = await hook.state();
    const home = () => call(page, 'place', spawn.x, spawn.z, spawn.viewYaw, 0);

    for (const b of BOSSES) {
      await home();
      await call(page, 'setClock', b.at - 2);
      await play(page, hook, 1, home);
      let s = await hook.state();
      check(s.seconds > b.at - 2.1 && s.seconds < b.at - 1.9, `the clock is set to ${b.at - 2} s`, s.seconds);
      check(s.boss.kind === -1, `no boss before ${b.at} s`, s.boss);
      for (let n = 0; n < 60 && s.boss.kind < 0; n++) {
        await play(page, hook, 5, home);
        s = await hook.state();
      }
      const arrivedAt = Date.now();
      const arrivedTick = s.tick;
      check(s.boss.kind === b.kind, `${b.name} is on the field at ${b.at} s`, { seconds: s.seconds, boss: s.boss });
      if (b.kind === 7) await picture(page, 'boss-in');
      check(s.seconds >= b.at && s.seconds < b.at + 0.3, 'on time', s.seconds);
      check(s.boss.hp === s.boss.maxHp && s.boss.maxHp > 0, 'at full health', s.boss);
      check(Math.hypot(s.boss.x - s.x, s.boss.z - s.z) > 40, 'well ahead of the mover', { boss: s.boss, x: s.x, z: s.z });

      check((await shown(page, '.hud-boss')) === true, `the boss bar shows for ${b.name}`);
      check((await text(page, '.hud-boss-name')) === b.name, 'the bar names it', await text(page, '.hud-boss-name'));
      check((await shown(page, '.hud-boss-banner')) === true, 'its name is across the screen');
      check((await text(page, '.hud-boss-banner')) === b.name, 'the banner names it', await text(page, '.hud-boss-banner'));
      const bar = await page.evaluate(() => document.querySelector('.hud-boss')?.getBoundingClientRect().top ?? -1);
      const clock = await page.evaluate(() => document.querySelector('.hud-clock')?.getBoundingClientRect().bottom ?? -1);
      check(bar >= clock && bar < 120, 'the bar is at the top, under the clock', { bar, clock });
      const pauseBtn = await page.evaluate(() => document.querySelector('.pause-btn')?.getBoundingClientRect().bottom ?? -1);
      check(bar >= pauseBtn, 'and under the pause button', { bar, pauseBtn });
      check(s.boss.kind !== 7 || (await marker(page, '.threat-boss')) === null, 'no edge marker while the boss is in view');

      if (b.kind === 9) {
        // The name fits a 360 px screen with 16 px or more either side.
        await page.setViewportSize({ width: 360, height: 780 });
        const span = await page.evaluate(() => {
          const e = document.querySelector('.hud-boss-banner');
          // As it rests once it has slammed in, not part way through that.
          e.style.animation = 'none';
          const range = document.createRange();
          range.selectNodeContents(e);
          const r = range.getBoundingClientRect();
          e.style.animation = '';
          return { left: r.left, right: r.right };
        });
        check(span.left >= 16 && span.right <= 360 - 16, 'THE STANDSTILL fits 360 px with 16 px either side', span);
        await page.setViewportSize({ width: 390, height: 844 });
        await hook.step(1);
      }

      if (b.kind === 7) {
        // Turned away from it, the Bruiser is behind the rider: the edge marker points at it.
        const away = spawn.viewYaw + Math.PI;
        for (let n = 0; n < 4; n++) {
          await call(page, 'place', spawn.x, spawn.z, away, 0);
          await hook.step(5);
        }
        const at = await marker(page, '.threat-boss');
        check(at !== null, 'with the Bruiser behind, its marker is up', at);
        check(at !== null && at.y > 844 * 0.75, 'on the lower edge: behind', at);
        const colour = await page.evaluate(() => getComputedStyle(document.querySelector('.threat-boss'), '::before').backgroundColor);
        check(colour === 'rgb(255, 106, 61)', 'in the Bruiser colour', colour);
        await home();
        await hook.step(1);
      }

      // Its name leaves the screen two real seconds after it came; the bar stays.
      const left = 2100 - (Date.now() - arrivedAt);
      if (left > 0) await page.waitForTimeout(left);
      await hook.step(1);
      check((await shown(page, '.hud-boss-banner')) === false, 'the name leaves the screen after two seconds');
      check((await shown(page, '.hud-boss')) === true, 'the bar stays');

      if (b.kind === 9) {
        await play(page, hook, arrivedTick + AURA_WAIT - (await hook.state()).tick, home);
        s = await hook.state();
        const ring = s.rings[0];
        check(s.rings.length === 1 && ring.r > 3 && ring.r < 11, 'a ring is spreading over the disc', s.rings);
        await picture(page, 'boss-aura');
      }

      await play(page, hook, arrivedTick + b.wait - (await hook.state()).tick, home);
      s = await hook.state();
      check(s.boss.kind === b.kind, 'still up for the picture', s.boss);
      if (b.kind === 7) {
        await picture(page, b.shot);
        // The same tell from the side: the rider beside the lane, looking across it.
        check(await page.evaluate(() => document.querySelector('.threat-boss')?.hidden === true), 'no marker with the Bruiser in view');
        const { x: bx, z: bz, aimX, aimZ } = s.boss;
        const mx = bx + aimX * 18;
        const mz = bz + aimZ * 18;
        // To the lane's right, facing back across it.
        const px = aimZ;
        const pz = -aimX;
        const yaw = Math.atan2(-px, -pz);
        await call(page, 'place', mx + px * 15, mz + pz * 15, yaw, 0);
        // One long frame, so the camera has caught up with the move; still inside the 48-tick tell.
        await hook.step(16);
        s = await hook.state();
        check(s.boss.kind === 7, 'the Bruiser is still telling', s.boss);
        await picture(page, 'boss-lane');
      } else if (b.kind === 9) {
        const ring = s.rings[0];
        check(s.rings.length === 1 && ring.r > 10 && ring.r < 20, 'its first ring is spreading over the ground', s.rings);
        await t.shot();
      } else {
        await picture(page, b.shot);
      }

      // Brought down: the heal, the sparks and the rare card.
      await call(page, 'hurt', 45);
      await play(page, hook, 1, home);
      const before = await hook.state();
      check(before.boss.kind === b.kind && before.phase === 0, 'still fighting', before.boss);
      check((await call(page, 'killBoss')) === true, 'the hook brings it down');
      await hook.step(1);
      s = await hook.state();
      check(s.boss.kind === -1, 'the bar is for no boss now', s.boss);
      check(s.boss.felled === before.boss.felled + 1, 'one more boss felled', s.boss);
      const give = Math.min(s.maxHp - before.hp, s.maxHp * 0.4);
      check(Math.abs(s.hp - (before.hp + give)) < 1.5, 'it gave back 40% of maximum health', { before: before.hp, after: s.hp, give });
      check((await shown(page, '.hud-boss')) === false, 'the bar is gone');

      if (b.kind !== 9) {
        check(s.phase === 3 && s.offer !== null && s.offer.source === OFFER_BOSS, 'a rare card is on the table', s.offer);
        await hook.step(1);
        check((await cardsUp(page)) === true, 'the cards are on screen');
        // Take it with a real touch, and any card queued behind it.
        for (let n = 0; n < 6 && (await hook.state()).phase === 3; n++) {
          const box = await page.locator('.card').first().boundingBox();
          if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          await hook.step(2);
        }
        s = await hook.state();
        check(s.phase === 0, 'the run goes on', s.phase);
      } else {
        check(s.phase === 2, 'the Standstill falling wins the run', s.phase);
      }
    }

    await hook.step(60);
    check((await endUp(page)) === true, 'the end card rises');
    check((await text(page, '.end-title')) === 'CLEARED', 'it says CLEARED', await text(page, '.end-title'));
    const rows = await page.evaluate(() => [...document.querySelectorAll('.end-row')].map((e) => e.textContent));
    check(rows.some((r) => r === 'Bosses  3 / 3'), 'with the bosses felled', rows);
    check(rows.some((r) => /^Time {2}9:\d\d$/.test(r ?? '')), 'and the time', rows);
    await page.waitForTimeout(600);
    await picture(page, 'boss-end');
  },
};
