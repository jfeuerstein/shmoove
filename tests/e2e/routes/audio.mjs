// audio: no sound before a gesture (and nothing logged); after one real touch the AudioContext is
// running, the loop is being scheduled, and a hop, a landing and a kill each schedule their sound.
// Hiding the page suspends the context and showing it resumes it. With ?mute a touch schedules
// nothing. Read through the test hook's counters, not the audio graph. Screenshot after the kill.

/** Where the thumb taps: lower middle of a 390x844 screen. */
const X = 195;
const Y = 640;

async function sound(page) {
  return page.evaluate(() => window.__shmoove.sound());
}

/** One real tap through the DevTools protocol: a touch the browser counts as a gesture. */
async function tap(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X, y: Y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function waitState(page, want, ms = 5000) {
  try {
    await page.waitForFunction((w) => window.__shmoove?.sound()?.state === w, want, { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Step `by` ticks at a time until `pred(state)` holds; returns that state or null after `max` tries. */
async function stepUntil(hook, max, pred, by = 1) {
  for (let i = 0; i < max; i++) {
    await hook.step(by);
    const s = await hook.state();
    if (pred(s)) return s;
  }
  return null;
}

export default {
  name: 'audio',
  query: '?hook&nolesson&horde=80',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);

    // Before any gesture: no context at all, so nothing could warn.
    const before = await sound(page);
    check(before !== null && before.state === 'none', 'no audio context before the first touch', before);
    await hook.step(30);
    const still = await sound(page);
    check(still.notes === 0 && still.effects === 0, 'nothing is scheduled before the first touch', still);

    // A real tap starts it.
    await tap(page);
    check(await waitState(page, 'running'), 'after a real touch the context is running', await sound(page));
    // The loop runs on the audio clock, with the game paused or not.
    await page.waitForTimeout(600);
    const looping = await sound(page);
    check(looping.notes > 0, 'the music is being scheduled', looping);

    // The tap was a hop (tuck scheme); let it land, then hop again on purpose.
    await stepUntil(hook, 120, (s) => s.grounded);
    await hook.step(30);
    const s0 = await sound(page);
    await hook.hop();
    const up = await stepUntil(hook, 12, (s) => !s.grounded);
    check(up !== null, 'the hop leaves the ground');
    const s1 = await sound(page);
    check(s1.kinds.hop + s1.kinds.ollie > s0.kinds.hop + s0.kinds.ollie, 'a hop schedules its pop', { before: s0.kinds, after: s1.kinds });
    const down = await stepUntil(hook, 180, (s) => s.grounded);
    check(down !== null, 'and lands');
    const s2 = await sound(page);
    check(s2.kinds.land > s1.kinds.land, 'a landing schedules its thud', { before: s1.kinds, after: s2.kinds });

    // Ride into the crowd until the starting weapon kills something more.
    const kills0 = (await hook.state()).kills;
    // A wide circle keeps the rider among the crowd.
    await hook.hold({ steerX: 0.35, steerY: 1, carve: true });
    const killed = await stepUntil(hook, 90, (s) => s.kills > kills0, 20);
    await hook.hold(null);
    check(killed !== null, 'something was killed', killed);
    const s3 = await sound(page);
    check(s3.kinds.die > s2.kinds.die, 'a kill schedules its crunch', { before: s2.kinds, after: s3.kinds });
    check(s3.kinds.shot > 0, 'the weapon firing schedules its voice', s3.kinds);
    await t.shot();

    // Hidden: paused and suspended; shown: still paused and silent until RESUME.
    await setHidden(page, true);
    check(await waitState(page, 'suspended'), 'hiding the page suspends the context', await sound(page));
    await setHidden(page, false);
    await page.waitForTimeout(400);
    const shown = await sound(page);
    check(shown.state === 'suspended', 'showing it again leaves it silent: the game is paused', shown);
    check(await page.evaluate(() => window.__shmoove.paused()), 'and the game says it is paused');
    await page.tap('.pause-resume');
    check(await waitState(page, 'running'), 'RESUME wakes the context', await sound(page));

    // ?mute: a touch, a hop and a kill schedule nothing.
    await page.goto(page.url().replace(/\?.*$/, '?hook&nolesson&horde=80&mute'));
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    await hook.pause(true);
    await tap(page);
    await page.waitForTimeout(300);
    await hook.hold({ steerX: 0.35, steerY: 1, carve: true });
    const mutedKill = await stepUntil(hook, 90, (s) => s.kills > 0, 20);
    await hook.hold(null);
    check(mutedKill !== null, 'muted: something was killed', mutedKill);
    await hook.hop();
    await hook.step(90);
    const muted = await sound(page);
    check(muted.muted === true, 'the hook reports muted', muted);
    check(muted.notes === 0 && muted.effects === 0, 'with ?mute nothing is scheduled', muted);
    check(muted.state !== 'running', 'and no context is running', muted);
  },
};
