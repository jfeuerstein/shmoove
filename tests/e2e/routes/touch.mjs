// touch: real touch events through CDP (Input.dispatchTouchEvent), not the hook's hold. In the tuck
// scheme a drag up and held runs the mover into gear 2, lifting the thumb tucks, a quick tap hops.
// In ?scheme=lift lifting after a hold hops. In ?scheme=swipe a fast flick up while holding hops and
// a tap does not. The stick ring shows while a thumb is down and is gone after. Screenshot during
// the drag. Flat ground so "leaves the ground" can only mean a hop.

/** Where the thumb lands: lower middle of a 390x844 screen, in the thumb zone. */
const X = 195;
const Y = 640;
/** Further than the stick's full-travel radius (FEEL.stickRadiusPx = 56), so the stick is at full. */
const DRAG_UP = 80;
/** A slow drag: this many px per move, this many ms apart (0.2 px/ms, far below a flick). */
const SLOW_STEP_PX = 6;
const SLOW_STEP_MS = 30;
/** A flick: moves this long, px, sent back to back. FEEL.swipeSpeed is 1.2 px/ms, so this is a flick
 * as long as the protocol delivers moves under 50 ms apart (they come a frame apart, about 33 ms). */
const FLICK_STEP_PX = 60;
const FLICK_STEPS = 4;
/** FEEL.runSpeed and FEEL.gear2 (src/sim/constants.ts), m/s. */
const RUN_SPEED = 10;
const GEAR2 = 7;

/** One finger on the screen, driven through the DevTools protocol. */
function finger(cdp) {
  const point = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  let x = X;
  let y = Y;
  return {
    async down(px = X, py = Y) {
      x = px;
      y = py;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
    },
    /** Move by (dx, dy) in `steps` moves, `gapMs` apart in real time (0 for as fast as possible). */
    async move(dx, dy, steps, gapMs) {
      for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: point(x + (dx * i) / steps, y + (dy * i) / steps),
        });
        if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
      }
      x += dx;
      y += dy;
    },
    async up() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async tap() {
      await this.down();
      await this.up();
    },
  };
}

async function stickShown(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.stick-view');
    return el ? getComputedStyle(el).visibility === 'visible' : null;
  });
}

/** Step one tick at a time until `pred(state)` holds; returns that state or null after `max` ticks. */
async function stepUntil(hook, max, pred) {
  for (let i = 0; i < max; i++) {
    await hook.step(1);
    const s = await hook.state();
    if (pred(s)) return s;
  }
  return null;
}

/** Load the game with `query`, paused, with a fresh finger. */
async function open(t, query) {
  const { page } = t;
  await page.goto(page.url().replace(/\?.*$/, query));
  await page.waitForFunction(() => window.__shmoove?.ready === true);
  await t.hook.pause(true);
  const cdp = await page.context().newCDPSession(page);
  return finger(cdp);
}

export default {
  name: 'touch',
  query: '?hook&flat',
  async run(t) {
    const { page, hook, check } = t;

    // --- tuck scheme (the default) --------------------------------------------------------------
    let f = await open(t, '?hook&flat');
    const start = await hook.state();
    check(start.speed < 0.5, 'the mover starts still', start);
    check((await stickShown(page)) === false, 'no stick before the thumb lands');

    await f.down();
    await f.move(0, -DRAG_UP, DRAG_UP / SLOW_STEP_PX, SLOW_STEP_MS);
    await hook.step(1);
    check((await stickShown(page)) === true, 'the stick ring shows while the thumb is down');
    const ring = await page.evaluate(() => {
      const r = document.querySelector('.stick-ring')?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null;
    });
    check(ring !== null && Math.abs(ring.x - X) < 4 && ring.y < Y && ring.y > Y - DRAG_UP, 'the ring sits under the thumb', ring);
    await hook.step(119);
    const mid = await hook.state();
    check(mid.speed > GEAR2 && !mid.tucked, 'a drag up and held carves the mover up to speed', mid);
    await t.shot();
    await hook.step(120);
    const held = await hook.state();
    const moved = Math.hypot(held.x - start.x, held.z - start.z);
    check(moved > 25, 'the mover moved', { moved });
    check(Math.abs(held.speed - RUN_SPEED) < 0.75, 'and runs at run speed', held);
    check(held.gear === 2, 'in gear 2', held);
    const gearText = await page.evaluate(() => document.querySelector('.hud-gear')?.textContent ?? null);
    check(gearText === '2', 'the HUD shows gear 2', gearText);

    await f.up();
    await hook.step(2);
    const lifted = await hook.state();
    check(lifted.tucked && lifted.grounded, 'lifting the thumb tucks', lifted);
    check((await stickShown(page)) === false, 'the stick ring is gone after the thumb lifts');
    check(lifted.speed > RUN_SPEED * 0.9, 'and the tuck coasts on', lifted);

    await hook.step(30);
    await f.tap();
    const hopped = await stepUntil(hook, 12, (s) => !s.grounded);
    check(hopped !== null, 'a quick tap hops: the mover leaves the ground');
    const landed = await stepUntil(hook, 120, (s) => s.grounded);
    check(landed !== null, 'and lands again');
    check((await stickShown(page)) === false, 'a tap leaves no stick behind');

    // --- lift scheme ----------------------------------------------------------------------------
    f = await open(t, '?hook&flat&scheme=lift');
    await f.down();
    await f.move(0, -DRAG_UP, DRAG_UP / SLOW_STEP_PX, SLOW_STEP_MS);
    await hook.step(1);
    check((await stickShown(page)) === true, 'lift: the stick ring shows while held');
    await hook.step(119);
    const liftHeld = await hook.state();
    check(liftHeld.grounded && liftHeld.speed > GEAR2, 'lift: holding the stick carves along the ground', liftHeld);
    await f.up();
    const liftHop = await stepUntil(hook, 12, (s) => !s.grounded);
    check(liftHop !== null, 'lift: lifting the thumb after a hold hops');
    await hook.step(1);
    check((await stickShown(page)) === false, 'lift: the stick ring is gone after the lift');

    // --- swipe scheme ---------------------------------------------------------------------------
    f = await open(t, '?hook&flat&scheme=swipe');
    await f.down();
    await f.move(0, -DRAG_UP, DRAG_UP / SLOW_STEP_PX, SLOW_STEP_MS);
    const slow = await stepUntil(hook, 120, (s) => !s.grounded);
    check(slow === null, 'swipe: a slow drag up does not hop');
    check((await stickShown(page)) === true, 'swipe: the stick ring shows while held');
    const swipeHeld = await hook.state();
    check(swipeHeld.speed > GEAR2, 'swipe: holding the stick carves', swipeHeld);

    // A flick: big moves up, back to back. The protocol acknowledges a touch event only after a
    // frame, so moves arrive a frame apart, and a flick is measured between two moves.
    await f.move(0, -FLICK_STEP_PX * FLICK_STEPS, FLICK_STEPS, 0);
    const flick = await stepUntil(hook, 12, (s) => !s.grounded);
    check(flick !== null, 'swipe: a fast flick up while holding hops');
    const back = await stepUntil(hook, 120, (s) => s.grounded);
    check(back !== null, 'swipe: and lands');
    await f.up();
    await hook.step(30);
    check((await stickShown(page)) === false, 'swipe: the stick ring is gone after the thumb lifts');

    await f.tap();
    const tapHop = await stepUntil(hook, 40, (s) => !s.grounded);
    check(tapHop === null, 'swipe: a tap does not hop', tapHop);
  },
};
