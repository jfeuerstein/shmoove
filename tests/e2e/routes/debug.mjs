// debug: the feel panel (?debug) opens beside the game, a slider changes the mover's top speed, the
// scheme choice survives a reload, reset all restores the defaults, and without ?debug there is no
// panel button. Screenshot with the panel open.
import { VIEWPORT } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };
const DEFAULT_RUN_SPEED = 10;

async function settle(hook, ticks) {
  await hook.hold(FORWARD);
  await hook.step(ticks);
  const s = await hook.state();
  await hook.hold(null);
  return s;
}

export default {
  name: 'debug',
  query: '?debug&hook',
  async run(t) {
    const { page, hook, check } = t;
    await hook.pause(true);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    await hook.pause(true);

    // The button is at the top right, inside the screen, at least 44 px tall; the sheet is closed.
    const btn = page.locator('.dbg-toggle');
    check((await btn.count()) === 1, 'there is a panel button with ?debug');
    const box = await btn.boundingBox();
    check(box !== null && box.height >= 44 && box.x + box.width <= VIEWPORT.width && box.y >= 0, 'button is a full-size target on screen', box);
    check(box !== null && box.x > VIEWPORT.width * 0.6 && box.y < 80, 'button is at the top right', box);
    check(!(await page.locator('.dbg-sheet').isVisible()), 'the sheet starts closed');

    await btn.tap();
    check(await page.locator('.dbg-sheet').isVisible(), 'the button opens the sheet');
    const sheet = await page.locator('.dbg-sheet').boundingBox();
    check(
      sheet !== null && Math.abs(sheet.width - (VIEWPORT.width * 2) / 3) < 2 && sheet.height === VIEWPORT.height && sheet.x + sheet.width === VIEWPORT.width,
      'the sheet is the right two thirds, full height',
      sheet,
    );

    // Every constant has a row; groups collapse and open.
    const rowCount = await page.locator('.dbg-row').count();
    const keyCount = await page.evaluate(() => document.querySelectorAll('.dbg-slider').length);
    check(rowCount > 40 && rowCount === keyCount, 'one row and one slider per constant', { rowCount, keyCount });
    const group = page.locator('.dbg-group', { hasText: 'run' }).first();
    await group.locator('summary').tap();
    check(await page.locator('input[data-key="runSpeed"]').isVisible(), 'opening the run group shows its sliders');

    // Touches on the panel never reach the game: no stick appears.
    const stickShown = await page.evaluate(() => getComputedStyle(document.querySelector('.stick-view')).visibility);
    check(stickShown === 'hidden', 'touching the panel does not start the stick', stickShown);

    // Baseline speed, then drag the runSpeed slider to a lower value.
    await page.evaluate(() => window.__shmoove.pause(true));
    const base = await settle(hook, 240);
    check(Math.abs(base.speed - DEFAULT_RUN_SPEED) < 0.75, 'default run speed is reached', base);

    const slider = page.locator('input[data-key="runSpeed"]');
    await slider.scrollIntoViewIfNeeded();
    const sb = await slider.boundingBox();
    if (sb) {
      // Drag from the thumb (at the 50% mark for 10 in 4..16) to a quarter of the way along.
      await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(sb.x + sb.width * 0.25, sb.y + sb.height / 2, { steps: 8 });
      await page.mouse.up();
    }
    const newSpeed = await page.evaluate(() => Number(document.querySelector('input[data-key="runSpeed"]').value));
    check(newSpeed < 9 && newSpeed >= 4, 'dragging the slider lowered runSpeed', newSpeed);
    check((await page.locator('.dbg-row.changed').count()) === 1, 'the changed row is highlighted');
    check(await page.locator('.dbg-reset:visible').count() === 1, 'and shows its own reset');

    await page.evaluate(() => window.__shmoove.pause(true));
    const slow = await settle(hook, 300);
    check(Math.abs(slow.speed - newSpeed) < 0.75, 'the mover settles at the new run speed', { newSpeed, speed: slow.speed });

    await t.shot();

    // Scheme switch sticks across a reload (no ?scheme= in the URL).
    await page.locator('.dbg-scheme', { hasText: 'Swipe' }).tap();
    const pressed = await page.locator('.dbg-scheme[aria-pressed="true"]').innerText();
    check(pressed.startsWith('Swipe'), 'the scheme button shows the choice', pressed);
    await page.reload();
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    await page.locator('.dbg-toggle').tap();
    const after = await page.locator('.dbg-scheme[aria-pressed="true"]').innerText();
    check(after.startsWith('Swipe'), 'the scheme survives a reload', after);
    const keptSpeed = await page.evaluate(() => Number(document.querySelector('input[data-key="runSpeed"]').value));
    check(keptSpeed === newSpeed, 'and so does the edited value', { keptSpeed, newSpeed });

    // Reset all restores the default, in the slider and in the mover.
    await page.locator('.dbg-btn', { hasText: 'Reset all' }).tap();
    const reset = await page.evaluate(() => Number(document.querySelector('input[data-key="runSpeed"]').value));
    check(reset === DEFAULT_RUN_SPEED, 'reset all restores the default value', reset);
    check((await page.locator('.dbg-row.changed').count()) === 0, 'nothing is highlighted after reset');
    await hook.pause(true);
    const back = await settle(hook, 300);
    check(Math.abs(back.speed - DEFAULT_RUN_SPEED) < 0.75, 'the mover is back at the default run speed', back);

    // Closing: the same button.
    await page.locator('.dbg-toggle').tap();
    check(!(await page.locator('.dbg-sheet').isVisible()), 'the same button closes the sheet');

    // Without ?debug there is no button.
    await page.goto(page.url().replace('?debug&hook', '?hook'));
    await page.waitForFunction(() => window.__shmoove?.ready === true);
    check((await page.locator('.dbg-toggle').count()) === 0, 'without ?debug the button does not exist');
    check((await page.locator('.dbg').count()) === 0, 'nor any panel');
  },
};
