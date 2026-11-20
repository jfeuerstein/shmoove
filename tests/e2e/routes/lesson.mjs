// lesson: the first-run lesson and the how-to sheet. With ?lesson the first line shows and the horde
// is held back; each step is driven through the hook (steer, ollie, a hill, three kills, sparks, a
// real touch on a card, the end) and the line changes every time. SKIP starts a normal run at 0:00;
// after a reload the lesson is gone; with ?nolesson it never shows. The how-to sheet opens from the
// end card, fits without scrolling, and REPLAY THE LESSON brings the lesson back.
// Screenshots: step 3 (lesson.png) and the how-to sheet (lesson-howto.png).
import { join } from 'node:path';
import { ROOT, waitForHook } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };

const LINES = [
  'Drag to steer.',
  'Tap to ollie.',
  'Hills make you fast. Find one.',
  'Your weapons fire themselves. Stay out of reach.',
  'Pick up the sparks. They are your levels.',
  'Take a card.',
  "That is the game. Don't get touched.",
];
const DIP = 'Head for the dip in the middle.';

export default {
  name: 'lesson',
  query: '?hook&lesson',
  async run(t) {
    const { page, hook, check } = t;
    const call = (method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
    const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
    const line = () => text('.lesson-text');
    const lessonShown = () =>
      page.evaluate(() => {
        const e = document.querySelector('.lesson');
        return e !== null && !e.hidden && getComputedStyle(e).display !== 'none';
      });
    const dots = () => page.evaluate(() => [...document.querySelectorAll('.lesson-dot')].map((d) => d.className.replace('lesson-dot', '').trim()));

    /** Step `chunk` ticks at a time, running `each` before every chunk, until the line is not `from`. */
    async function untilLineChanges(from, maxTicks, chunk, each) {
      for (let n = 0; n < maxTicks; n += chunk) {
        if (each) await each();
        await hook.step(chunk);
        const l = await line();
        if (l !== from) return l;
      }
      return await line();
    }

    /** Load `query` in the same browser context and stop the clock. */
    async function open(query) {
      await page.goto(`${new URL(page.url()).origin}/${query}`);
      await waitForHook(page);
      await hook.pause(true);
    }

    async function freshStorage() {
      await page.evaluate(() => {
        try {
          localStorage.clear();
        } catch {
          // no storage: nothing to clear
        }
      });
    }

    // ---- the first line, and nothing has spawned ----
    await hook.pause(true);
    await hook.step(1);
    check(await lessonShown(), 'the lesson shows with ?lesson');
    check((await line()) === LINES[0], 'the first line is "Drag to steer."', await line());
    await hook.step(600);
    let s = await hook.state();
    check(s.enemies === 0, 'nothing has spawned after ten seconds of standing still', s);
    check(s.seconds === 0, 'the run clock is not counting', s);
    check((await text('.hud-clock')) === '0:00', 'the HUD clock reads 0:00', await text('.hud-clock'));
    check(s.phase === 0, 'still playing', s);
    check((await line()) === LINES[0], 'standing still does not finish step 1', await line());
    check((await dots()).length === 7, 'seven progress dots', await dots());

    // ---- step 1: drag to steer; step 2 line comes up ----
    await hook.hold(FORWARD);
    let l = await untilLineChanges(LINES[0], 900, 30);
    check(l === LINES[1], 'steering 2 s and 15 m moves on to "Tap to ollie."', l);
    check((await dots())[0].includes('lesson-dot-done'), 'the first dot is filled', await dots());

    // ---- step 2: a hop ----
    await hook.hop();
    l = await untilLineChanges(LINES[1], 120, 1);
    check(l === LINES[2], 'a hop moves on to "Hills make you fast. Find one."', l);

    // The screenshot of step 3, and where its parts sit.
    await t.shot();
    const geo = await page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
      };
      return { band: r('.lesson-band'), skip: r('.lesson-skip'), kills: r('.hud-kills'), speed: r('.hud-speed'), h: window.innerHeight, w: window.innerWidth, font: getComputedStyle(document.querySelector('.lesson-text')).fontSize };
    });
    check(geo.band !== null && geo.speed !== null && geo.band.top >= geo.speed.bottom, 'the band sits under the speed readout', geo);
    check(geo.band !== null && geo.band.bottom < geo.h * 0.36, 'the band stays out of the middle of the screen and the thumb zone', geo.band);
    check(geo.band !== null && geo.band.left >= 0 && geo.band.right <= geo.w, 'the band fits the width', geo.band);
    check(geo.skip !== null && geo.skip.width >= 44 && geo.skip.height >= 44, 'SKIP is at least 44 px', geo.skip);
    check(geo.skip !== null && geo.kills !== null && geo.skip.top >= geo.kills.bottom, 'SKIP is under the kills counter', geo);
    check(geo.skip !== null && geo.band !== null && geo.skip.bottom <= geo.band.top, 'SKIP does not cover the band', geo);
    check(parseFloat(geo.font) >= 18, 'the line is large', geo.font);

    // ---- step 3: let go; the slope does the work. The alternate line comes up after 12 s if not. ----
    await hook.hold(null);
    let sawDip = false;
    l = await untilLineChanges(
      LINES[2],
      2400,
      10,
      async () => {
        if ((await line()) === DIP) sawDip = true;
      },
    );
    if (l === DIP) {
      sawDip = true;
      l = await untilLineChanges(DIP, 2400, 10);
    }
    check(l === LINES[3], 'going fast moves on to the weapons line', { l, sawDip, s: await hook.state() });
    s = await hook.state();
    check(s.enemies === 8, 'eight shufflers come up', s);
    check(s.seconds === 0, 'the clock has not counted', s);

    // ---- step 4: they come to us; the weapons fire themselves; three die ----
    await hook.hold(null);
    l = await untilLineChanges(LINES[3], 3600, 30);
    s = await hook.state();
    check(l === LINES[4], 'three dead moves on to "Pick up the sparks."', { l, s });
    check(s.kills >= 3, 'with three kills', s);
    check(s.hp >= 30 && s.phase !== 1, 'health is held at 30 or above', s);

    // ---- step 5: sparks; an offer opens by itself or from the top-up within 10 s ----
    l = await untilLineChanges(LINES[4], 1500, 10);
    s = await hook.state();
    check(l === LINES[5], 'an offer opening moves on to "Take a card."', { l, s });
    check(s.phase === 3 && s.offer !== null, 'the cards are up', s);
    check((await lessonShown()) === true, 'the lesson line is still on screen over the cards');

    // ---- step 6: a real touch on a card; the line sits above the cards and is not covered ----
    const over = await page.evaluate(() => {
      const band = document.querySelector('.lesson-band')?.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.card')].filter((c) => !c.hidden).map((c) => c.getBoundingClientRect());
      const hit = band ? document.elementFromPoint((band.left + band.right) / 2, (band.top + band.bottom) / 2) : null;
      return { band: band ? { top: band.top, bottom: band.bottom } : null, cardTop: Math.min(...cards.map((c) => c.top)), cards: cards.length, inLesson: hit?.closest('.lesson') !== null && hit !== null, hasHit: hit !== null };
    });
    check(over.cards === 3 && over.band !== null && over.band.bottom < over.cardTop, 'the line sits above the cards', over);
    await page.waitForTimeout(500);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
    const card = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.card')].filter((e) => !e.hidden)[1];
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await hook.step(30);
    s = await hook.state();
    check(s.phase === 3, 'a card offer is not auto-picked during the lesson', s);
    await page.touchscreen.tap(card.x, card.y);
    await hook.step(1);
    s = await hook.state();
    check(s.phase === 0 && s.offer === null, 'a touch on a card takes it', s);
    l = await untilLineChanges(LINES[5], 120, 5);
    check(l === LINES[6], 'then the last line', l);

    // ---- step 7: the end, then a normal run ----
    check((await lessonShown()) === true, 'the last line is on screen');
    await hook.step(60);
    check((await lessonShown()) === true, 'for 2 s');
    await hook.step(100);
    check((await lessonShown()) === false, 'then the lesson is gone');
    s = await hook.state();
    check(s.tick < 120 && s.seconds < 2 && s.kills === 0 && s.hp === 100 && s.phase === 0, 'and a new run has begun', s);
    check((await text('.hud-clock')) === '0:00' || (await text('.hud-clock')) === '0:01', 'with the clock at 0:00', await text('.hud-clock'));
    await hook.hold(FORWARD);
    await hook.step(120);
    s = await hook.state();
    check(s.seconds > 1.9, 'the clock counts now', s);
    await hook.step(900);
    s = await hook.state();
    check(s.enemies > 0, 'the director is on: the horde comes', s);
    await hook.hold(null);

    // ---- after a reload the lesson does not show again ----
    await open('?hook');
    await hook.step(2);
    check((await lessonShown()) === false, 'after a reload the lesson is not shown again');
    s = await hook.state();
    check(s.seconds < 1, 'and the run is a normal one', s);

    // ---- ?lesson forces it back ----
    await open('?hook&lesson');
    await hook.step(2);
    check((await lessonShown()) === true, '?lesson shows it again');

    // ---- SKIP ends it and a normal run begins with the clock at 0:00 ----
    await freshStorage();
    await open('?hook&lesson');
    await hook.hold(FORWARD);
    await hook.step(200);
    check((await lessonShown()) === true, 'the lesson shows for a player who has not done it');
    const skip = await page.locator('.lesson-skip').boundingBox();
    check(skip !== null && skip.width >= 44 && skip.height >= 44, 'SKIP is a real, big enough button', skip);
    if (skip) await page.touchscreen.tap(skip.x + skip.width / 2, skip.y + skip.height / 2);
    await hook.step(1);
    check((await lessonShown()) === false, 'SKIP ends the lesson');
    s = await hook.state();
    check(s.seconds < 0.1 && s.tick < 5, 'a normal run begins', s);
    check((await text('.hud-clock')) === '0:00', 'with the clock at 0:00', await text('.hud-clock'));
    await open('?hook');
    await hook.step(2);
    check((await lessonShown()) === false, 'a skipped lesson stays skipped after a reload');

    // ---- ?nolesson: never ----
    await freshStorage();
    await open('?hook&nolesson');
    await hook.step(2);
    check((await lessonShown()) === false, '?nolesson never shows it');
    await open('?hook&lesson&nolesson');
    await hook.step(2);
    check((await lessonShown()) === false, '?nolesson wins over ?lesson');
    await open('?hook&flat&lesson');
    await hook.step(2);
    check((await lessonShown()) === false, 'it never shows on flat ground');

    // ---- the how-to sheet, from the end card ----
    await open('?hook&nolesson');
    await hook.step(1);
    await call('hurt', 500);
    await hook.step(60);
    await page.waitForTimeout(700);
    const how = await page.locator('.end-howto').boundingBox();
    check(how !== null && how.height >= 44, 'HOW TO PLAY is under AGAIN and big enough', how);
    const again = await page.locator('.end-again').boundingBox();
    check(how !== null && again !== null && how.y >= again.y + again.height - 1, 'HOW TO PLAY sits under AGAIN', { how, again });
    if (how) await page.touchscreen.tap(how.x + how.width / 2, how.y + how.height / 2);
    await page.waitForTimeout(200);
    const sheet = await page.evaluate(() => {
      const e = document.querySelector('.howto');
      if (!e || e.hidden) return null;
      const b = e.getBoundingClientRect();
      return {
        lines: e.querySelectorAll('.howto-line').length,
        fits: e.scrollHeight <= e.clientHeight + 1 && b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth,
        scroll: e.scrollHeight,
        client: e.clientHeight,
        bottoms: [...e.querySelectorAll('button')].map((x) => x.getBoundingClientRect().bottom),
        h: window.innerHeight,
      };
    });
    check(sheet !== null, 'HOW TO PLAY opens the sheet');
    check(sheet !== null && sheet.lines === 8, 'eight lines', sheet);
    check(sheet !== null && sheet.fits, 'the sheet fits without scrolling', sheet);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'lesson-howto.png'), timeout: 120_000 });

    // CLOSE goes back to the end card.
    const close = await page.locator('.howto-close').boundingBox();
    check(close !== null && close.height >= 44, 'CLOSE is big enough', close);
    if (close) await page.touchscreen.tap(close.x + close.width / 2, close.y + close.height / 2);
    check((await page.locator('.howto').isVisible()) === false, 'CLOSE closes the sheet');
    check(await page.evaluate(() => document.querySelector('.end')?.classList.contains('end-show') === true), 'the end card is still there');

    // REPLAY THE LESSON starts it again, even though it was never done in this storage.
    await freshStorage();
    const how2 = await page.locator('.end-howto').boundingBox();
    if (how2) await page.touchscreen.tap(how2.x + how2.width / 2, how2.y + how2.height / 2);
    await page.waitForTimeout(150);
    const replay = await page.locator('.howto-replay').boundingBox();
    check(replay !== null && replay.height >= 44, 'REPLAY THE LESSON is big enough', replay);
    if (replay) await page.touchscreen.tap(replay.x + replay.width / 2, replay.y + replay.height / 2);
    await hook.step(2);
    check((await lessonShown()) === true, 'REPLAY THE LESSON brings the lesson back');
    check((await line()) === LINES[0], 'at the first line', await line());
    check((await page.locator('.howto').isVisible()) === false, 'and closes the sheet');
    s = await hook.state();
    check(s.phase === 0 && s.enemies === 0 && s.seconds === 0, 'in a fresh run with nothing spawned', s);
    await hook.hold(null);
  },
};
