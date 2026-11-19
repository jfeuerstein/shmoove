// pause: the run can be paused. The button (top right, at least 44 px, clear of the clock, the kills
// and the boss bar, above the steering zone) stops the real-time clock and puts up PAUSED; RESUME
// starts it again without catching up. Pressing it neither ollies nor steers (a tap on the game, for
// comparison, does ollie). The page being hidden pauses the game, and it stays paused when shown
// again until RESUME; a lost focus pauses too. Paused with cards open, RESUME comes back to the cards.
// HOW TO PLAY opens from the pause sheet and closes back to it.
// Screenshot: pause.png (the PAUSED sheet over the run).
const EV_HOP = 1;
const WIDTH = 390;
const HEIGHT = 844;

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
const box = (page, sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);
const overlayUp = async (page) => (await box(page, '.pause')) !== null;
const cardsUp = (page) => page.evaluate(() => document.querySelector('.cards')?.classList.contains('cards-show') === true);
const tap = async (page, sel) => {
  const b = await box(page, sel);
  if (!b) throw new Error(`${sel} is not on screen`);
  await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
};
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Let a few animation frames go by. */
const frames = (page, n) =>
  page.evaluate(
    (k) =>
      new Promise((r) => {
        let left = k;
        const f = () => (--left <= 0 ? r(undefined) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

export default {
  name: 'pause',
  query: '?hook&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    await hook.step(1);

    // The button: where it is and how big.
    const btn = await box(page, '.pause-btn');
    check(btn !== null, 'the pause button is on screen');
    if (btn) {
      check(btn.w >= 44 && btn.h >= 44, 'at least 44 px square', btn);
      check(btn.x + btn.w > WIDTH * 0.75 && btn.y < 60, 'in the top right corner', btn);
      check(btn.y >= 0, 'below the top edge (and the notch)', btn);
      check(btn.y + btn.h < HEIGHT / 3, 'outside the steering zone', btn);
      for (const sel of ['.hud-clock', '.hud-kills', '.hud-speed']) {
        const other = await box(page, sel);
        check(other !== null && !overlaps(btn, other), `clear of ${sel}`, { btn, other });
      }
    }

    // The real-time clock runs.
    let s = await hook.state();
    await page.waitForTimeout(500);
    let s2 = await hook.state();
    check(s2.tick > s.tick + 5, 'the run plays in real time', { before: s.tick, after: s2.tick });

    // The button pauses: no ticks go by in real time, and the sheet is up.
    await tap(page, '.pause-btn');
    check((await call(page, 'paused')) === true, 'the button pauses the game');
    check(await overlayUp(page), 'PAUSED is on screen');
    check((await page.evaluate(() => document.querySelector('.pause-title')?.textContent)) === 'PAUSED', 'it says PAUSED');
    s = await hook.state();
    await page.waitForTimeout(700);
    s2 = await hook.state();
    check(s2.tick === s.tick, 'no tick goes by while paused', { before: s.tick, after: s2.tick });
    check((await box(page, '.pause-btn')) === null, 'the button is out of the way while paused');
    check((await box(page, '.pause-resume')) !== null && (await box(page, '.pause-howto')) !== null, 'RESUME and HOW TO PLAY are there');
    await t.shot();

    // HOW TO PLAY opens over it and closes back to it.
    await tap(page, '.pause-howto');
    await frames(page, 2);
    check((await box(page, '.howto')) !== null, 'HOW TO PLAY opens');
    await tap(page, '.howto-close');
    await frames(page, 2);
    check((await box(page, '.howto')) === null && (await overlayUp(page)), 'and closes back to PAUSED');
    check((await call(page, 'paused')) === true, 'still paused');

    // RESUME: the clock starts again, with no catch-up.
    const held = await hook.state();
    await tap(page, '.pause-resume');
    const right = await hook.state();
    check((await call(page, 'paused')) === false && !(await overlayUp(page)), 'RESUME takes the sheet away');
    check(right.tick - held.tick <= 5, 'no catch-up steps on resume', { held: held.tick, resumed: right.tick });
    check(Math.hypot(right.x - held.x, right.z - held.z) < 0.5, 'the rider is where it was', { held, right });
    await page.waitForTimeout(400);
    s = await hook.state();
    check(s.tick > right.tick + 5, 'and the run plays again', { resumed: right.tick, now: s.tick });

    // Pressing the button neither ollies nor steers. The scripts hold the clock from here.
    await hook.pause(true);
    await hook.step(30);
    const before = await hook.state();
    check(before.grounded && (before.events & EV_HOP) === 0, 'standing on the ground', before);
    await tap(page, '.pause-btn');
    check((await call(page, 'paused')) === true, 'paused again');
    await tap(page, '.pause-resume');
    check((await call(page, 'paused')) === false, 'resumed again');
    let hopped = false;
    for (let n = 0; n < 20; n++) {
      await hook.step(1);
      s = await hook.state();
      if ((s.events & EV_HOP) !== 0 || !s.grounded) hopped = true;
    }
    check(!hopped, 'pressing pause and resume did not ollie');
    let turn = Math.abs(s.viewYaw - before.viewYaw) % (Math.PI * 2);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    check(turn < 0.01, 'nor steer', { before: before.viewYaw, after: s.viewYaw });
    // For comparison: the same tap on the game is an ollie.
    await page.touchscreen.tap(WIDTH / 2, HEIGHT * 0.7);
    let control = false;
    for (let n = 0; n < 10 && !control; n++) {
      await hook.step(1);
      s = await hook.state();
      if ((s.events & EV_HOP) !== 0 || !s.grounded) control = true;
    }
    check(control, 'a tap on the game does ollie (the check above can fail)');
    await hook.step(90);

    // The page hidden: paused, and still paused when it is shown again.
    await hook.pause(false);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check((await call(page, 'paused')) === true, 'a hidden page pauses the game');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    s = await hook.state();
    await page.waitForTimeout(500);
    s2 = await hook.state();
    check((await call(page, 'paused')) === true && (await overlayUp(page)), 'shown again, it stays paused');
    check(s2.tick === s.tick, 'and the clock stays stopped', { before: s.tick, after: s2.tick });
    await tap(page, '.pause-resume');
    check((await call(page, 'paused')) === false, 'until RESUME');

    // A lost focus pauses too.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check((await call(page, 'paused')) === true, 'losing focus pauses the game');
    await tap(page, '.pause-resume');
    check((await call(page, 'paused')) === false, 'and RESUME resumes');

    // Paused with cards open: RESUME comes back to the cards.
    await hook.pause(true);
    s = await hook.state();
    await call(page, 'giveXp', s.xpNext - s.xp + 1);
    await hook.step(2);
    s = await hook.state();
    check(s.phase === 3 && (await cardsUp(page)), 'a level puts up the cards', s.phase);
    check((await box(page, '.pause-btn')) !== null, 'the pause button is there over the cards');
    await tap(page, '.pause-btn');
    check((await call(page, 'paused')) === true && (await overlayUp(page)), 'the cards can be paused');
    const onTop = await page.evaluate(([w, h]) => document.elementFromPoint(w / 2, h * 0.7)?.closest('.pause') !== null, [WIDTH, HEIGHT]);
    check(onTop, 'the sheet is over the cards: they cannot be taken while paused');
    await tap(page, '.pause-resume');
    await hook.step(1);
    s = await hook.state();
    check((await call(page, 'paused')) === false, 'resumed');
    check(s.phase === 3 && (await cardsUp(page)), 'back to the cards, still open', s.phase);
    await tap(page, '.card');
    await hook.step(2);
    s = await hook.state();
    check(s.phase === 0, 'a card is taken and the run goes on', s.phase);
  },
};
