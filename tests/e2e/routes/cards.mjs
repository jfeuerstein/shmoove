// cards: the build on screen. On the bowl with a run: enough XP for a level brings up three cards in
// the lower half and the world holds still behind them; a real touch on the second card takes it, the
// cards go, the build bar shows the new tile, the world advances again and the mover keeps its speed.
// Several more levels fill the build bar. With the auto-pick setting on (a real tap on its switch in
// the debug panel) a level never shows cards.
// Screenshots: the cards up (cards-up.png) and the build bar after several levels (cards.png).
import { join } from 'node:path';
import { ROOT } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };
const HEIGHT = 844;
const WIDTH = 390;

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
const cardsUp = (page) => page.evaluate(() => document.querySelector('.cards')?.classList.contains('cards-show') === true);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export default {
  name: 'cards',
  query: '?hook&debug&nolesson',
  async run(t) {
    const { page, hook, check } = t;
    const level = async () => {
      const s = await hook.state();
      await call(page, 'giveXp', s.xpNext - s.xp + 1);
      await hook.step(2);
    };
    await hook.pause(true);
    await hook.step(1);
    check((await cardsUp(page)) === false, 'no cards while playing');

    // Get some speed first, so "the mover still has its speed" means something.
    await hook.hold(FORWARD);
    await hook.step(150);
    const before = await hook.state();
    check(before.speed > 4, 'the mover has speed before the level', before);
    check(before.offer === null && before.phase === 0, 'no offer yet', before);
    check(before.weapons.length === 1 && before.passives.length === 0, 'the run starts with one weapon', before);

    await level();
    const up = await hook.state();
    check(up.phase === 3 && up.offer !== null, 'a level opens an offer and holds the world', up);
    check(up.offer?.cards.length === 3, 'three cards', up.offer);
    check((await cardsUp(page)) === true, 'the cards are on screen');

    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.card')]
        .filter((c) => !c.hidden)
        .map((c) => {
          const r = c.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, scrollW: c.scrollWidth, clientW: c.clientWidth };
        }),
    );
    check(boxes.length === 3, 'three card elements are showing', boxes);
    check(boxes.every((b) => b.y >= HEIGHT / 2), 'every card is in the lower half', boxes);
    check(boxes.every((b) => b.h >= 84), 'every card is at least 84 px tall', boxes);
    check(boxes.every((b) => b.w >= WIDTH * 0.9), 'every card is nearly full width', boxes);
    check(boxes.every((b) => b.x >= 0 && b.x + b.w <= WIDTH), 'every card is inside the screen', boxes);
    check(boxes.every((b) => b.scrollW <= b.clientW), 'no card text is cut off sideways', boxes);
    const head = await page.evaluate(() => document.querySelector('.cards-head')?.textContent);
    check(head === 'LEVEL UP', 'the header says where it came from', head);

    // Touches anywhere land on the overlay, never on the game canvas.
    const hits = await page.evaluate(
      ([w, h]) => [
        document.elementFromPoint(w / 2, h * 0.25)?.closest('.cards') !== null,
        document.elementFromPoint(w / 2, h * 0.6)?.closest('.cards') !== null,
      ],
      [WIDTH, HEIGHT],
    );
    check(hits[0] && hits[1], 'the overlay covers the game: touches never reach it', hits);

    // The world holds still while the cards are up.
    await hook.step(90);
    const held = await hook.state();
    check(held.tick === up.tick && dist(held, up) < 0.001, 'the world does not advance behind the cards', { up, held });
    check(held.phase === 3, 'still waiting for a card', held);

    await page.waitForTimeout(300);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
    await page.screenshot({ path: join(ROOT, 'artifacts', 'screens', 'cards-up.png'), timeout: 120_000 });

    // A real touch on the second card.
    const second = boxes[1];
    await page.touchscreen.tap(second.x + second.w / 2, second.y + second.h / 2);
    await hook.step(1);
    const taken = await hook.state();
    const card = up.offer.cards[1];
    check(taken.offer === null && taken.phase === 0, 'the offer is closed and play resumes', taken);
    check((await cardsUp(page)) === false, 'the cards go');
    const list = card.type === 0 ? taken.weapons : taken.passives;
    check(list.some((i) => i.id === card.id && i.level >= card.by), 'the second card was taken', { card, taken });
    const tiles = await page.evaluate(() => document.querySelectorAll('.bb-tile:not(.bb-empty)').length);
    const carried = taken.weapons.length + taken.passives.length;
    check(tiles === carried, 'the build bar shows what is carried', { tiles, carried });
    const wasNew = !(card.type === 0 ? before.weapons : before.passives).some((i) => i.id === card.id);
    check(!wasNew || tiles === 2, 'a new card adds a tile', { card, tiles });

    await hook.step(40);
    const after = await hook.state();
    check(after.tick > taken.tick + 20, 'the world advances again', { taken, after });
    // Its speed the moment play resumed, not 40 ticks of hillside later.
    check(taken.speed > before.speed * 0.9, 'the mover still has its speed', { before: before.speed, taken: taken.speed });

    // Several levels fill the build bar.
    for (let i = 0; i < 4; i++) {
      await level();
      const s = await hook.state();
      check(s.phase === 3, `level ${i + 2} offers cards`, s);
      await call(page, 'pick', 0);
      await hook.step(1);
    }
    await call(page, 'setWeapon', 0, 4);
    await call(page, 'setPassive', 5, 3);
    await hook.step(45);
    const built = await hook.state();
    check(built.phase === 0 && built.offer === null, 'back in play with a built loadout', built);
    check(built.weapons.length + built.passives.length >= 4, 'the build has grown', built);
    const pips = await page.evaluate(() => document.querySelectorAll('.bb-pip.on').length);
    check(pips >= 7, 'the build bar shows level pips', pips);
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.bb')?.getBoundingClientRect();
      const tile = document.querySelector('.bb-tile')?.getBoundingClientRect();
      return r && tile ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, tile: tile.width } : null;
    });
    check(bar !== null && bar.top > HEIGHT * 0.8, 'the build bar sits low, clear of the middle of the screen', bar);
    check(bar !== null && bar.left >= 0 && bar.right <= WIDTH && bar.tile >= 30, 'all eight tiles fit', bar);
    await page.waitForTimeout(600);
    await t.shot();

    // Auto-pick: a real tap on the switch at the top of the debug panel.
    await page.locator('.dbg-toggle').tap();
    const sw = page.locator('.dbg-autopick');
    check((await sw.getAttribute('aria-pressed')) === 'false', 'auto-pick starts off');
    await sw.tap();
    check((await sw.getAttribute('aria-pressed')) === 'true', 'the switch turns auto-pick on');
    await page.locator('.dbg-toggle').tap();
    const lvlBefore = (await hook.state()).level;
    await level();
    await hook.step(3);
    const auto = await hook.state();
    check(auto.level > lvlBefore, 'a level happened', { lvlBefore, auto });
    check(auto.offer === null && auto.phase === 0, 'auto-pick answered the offer at once', auto);
    check((await cardsUp(page)) === false, 'the cards never showed');
    await hook.hold(null);
  },
};
