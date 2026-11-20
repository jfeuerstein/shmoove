// cards: the build on screen. On the bowl with a run: enough XP for a level brings up three cards in
// the lower half and the world holds still behind them; a real touch on the second card takes it, the
// cards go, the build bar shows the new tile, the world advances again and the mover keeps its speed.
// Several more levels grow the build. Circling a shrine brings its boon offer; a
// boss brought down brings a BOSS DOWN offer, and the same cards fit a 360x640 screen without
// scrolling. Every card and every build tile is an icon, never a two-letter code. The build bar full.
// With the auto-pick setting on (a real tap on its switch in the debug panel) a level never shows
// cards. A fatal hit brings the end card with the build on it. Last, every icon at 28 and 64 px,
// labelled, injected into a blank overlay over the page for judging the set.
// Screenshots: the cards up (cards-up.png), a shrine offer (cards-shrine.png), a boss offer
// (cards-boss.png), the cards at 360x640 (cards-small.png), the build bar full (cards.png), the end
// card (cards-end.png) and the icon set (icons.png).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../run.mjs';

const FORWARD = { steerX: 0, steerY: 1, carve: true };
const HEIGHT = 844;
const WIDTH = 390;

const call = (page, method, ...args) => page.evaluate(([m, a]) => window.__shmoove[m](...a), [method, args]);
const cardsUp = (page) => page.evaluate(() => document.querySelector('.cards')?.classList.contains('cards-show') === true);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))));
const screen = (page, name) => page.screenshot({ path: join(ROOT, 'artifacts', 'screens', name), timeout: 120_000 });
const header = (page) => page.evaluate(() => document.querySelector('.cards-head')?.textContent);
/** OFFER_SHRINE, OFFER_BOSS in src/sim/offer.ts; PHASE_DEAD, PHASE_CHOOSE in src/sim/world.ts. */
const OFFER_SHRINE = 3;
const OFFER_BOSS = 4;
const PHASE_DEAD = 1;
const PHASE_CHOOSE = 3;

/**
 * Bundle a few exports of the game's own source with Vite and load them here, in Node: the icon set
 * and the names for the gallery, and the map for where its shrines stand. The built app is one
 * bundle, so nothing can be imported from the page itself.
 */
async function loadSource() {
  const { build } = await import('vite');
  const dir = join(ROOT, 'artifacts', 'tmp');
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, 'cards-entry.ts');
  writeFileSync(
    entry,
    [
      "export { WEAPON_ICONS, PASSIVE_ICONS, BOON_ICONS } from '../../src/ui/icons';",
      "export { WEAPON_INFO, PASSIVE_INFO } from '../../src/sim/arsenal';",
      "export { BOON_INFO } from '../../src/sim/offer';",
      "export { makeBowl } from '../../src/sim/bowl';",
      '',
    ].join('\n'),
  );
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    root: ROOT,
    build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'cards-source' } },
  });
  const result = Array.isArray(out) ? out[0] : out;
  const file = join(dir, 'cards-source.mjs');
  writeFileSync(file, result.output[0].code);
  return import(`${pathToFileURL(file).href}?t=${Date.now()}`);
}

/** Two capital letters standing alone: what the build used to be named by. */
const CODE = /(^|\s)[A-Z]{2}(\s|$)/;

/** For each visible card: how many SVG icons its tile holds, the tile's text and the card's text. */
function cardFaces(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.card')]
      .filter((c) => !c.hidden)
      .map((c) => {
        const tile = c.querySelector('.card-tile');
        return { svg: tile?.querySelectorAll('svg').length ?? 0, tileText: tile?.textContent ?? '', text: c.textContent ?? '', cls: c.className };
      }),
  );
}
const allIcons = (faces) => faces.length > 0 && faces.every((f) => f.svg === 1 && f.tileText === '' && !CODE.test(f.text));

/**
 * Circle the shrine at (cx, cz) once at radius `r` and `speed` (put on the circle each tick), answering
 * any other offer on the way. Resolves when the shrine's offer is up.
 */
function circleShrine(page, cx, cz, r, speed) {
  return page.evaluate(
    ([cx, cz, r, speed, shrine, choose]) => {
      const h = window.__shmoove;
      const ticks = Math.ceil((1.3 * 2 * Math.PI * r) / (speed / 60));
      let a = 0;
      for (let t = 0; t < ticks; t++) {
        const s = h.state();
        if (s.phase === choose) {
          if (s.offer?.source === shrine) return { done: true, t };
          h.pick(0);
          h.step(1);
          continue;
        }
        if (s.phase !== 0) return { done: false, t, phase: s.phase };
        a += speed / 60 / r;
        h.place(cx + r * Math.sin(a), cz + r * Math.cos(a), a + Math.PI / 2, speed);
        h.step(1);
      }
      return { done: false, t: ticks };
    },
    [cx, cz, r, speed, OFFER_SHRINE, PHASE_CHOOSE],
  );
}

/** Step until an offer from `source` is up, answering any other, at most `limit` ticks. */
function stepUntilOffer(page, source, limit) {
  return page.evaluate(
    ([source, limit, choose]) => {
      const h = window.__shmoove;
      for (let t = 0; t < limit; t++) {
        const s = h.state();
        if (s.phase === choose) {
          if (s.offer?.source === source) return true;
          h.pick(0);
        }
        h.step(1);
      }
      return false;
    },
    [source, limit, PHASE_CHOOSE],
  );
}

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
    const head = await header(page);
    check(head === 'LEVEL UP', 'the header says where it came from', head);
    const faces = await cardFaces(page);
    check(allIcons(faces), 'every card shows an icon, never a two-letter code', faces);

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
    const tiles = await page.evaluate(() => document.querySelectorAll('.bb .bb-tile:not(.bb-empty)').length);
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
    await hook.hold(null);
    const source = await loadSource();

    // A shrine: circling it once brings three boons.
    const shrines = source.makeBowl(1).features.sites.filter((x) => x.kind === 'shrine');
    check(shrines.length > 0, 'the map has a shrine', shrines.length);
    if (shrines.length > 0) {
      const ride = await circleShrine(page, shrines[0].x, shrines[0].z, 6, 9);
      check(ride.done === true, 'circling the shrine brings its offer', ride);
      if (ride.done) {
        await page.waitForTimeout(300);
        await settle(page);
        const s = await hook.state();
        check(s.offer?.cards.every((c) => c.type === 2) === true, 'a shrine offers boons', s.offer);
        check((await header(page)) === 'SHRINE', 'the header says SHRINE');
        const boons = await cardFaces(page);
        check(boons.length === 3 && boons.every((f) => f.cls.includes('card-boon')), 'three boon cards, framed as boons', boons);
        check(allIcons(boons), 'every boon card shows an icon', boons);
        await screen(page, 'cards-shrine.png');
        await call(page, 'pick', 0);
        await hook.step(1);
      }
    }

    // A boss brought down: its rare offer.
    await call(page, 'setClock', 180);
    await stepUntilOffer(page, -1, 5);
    const killed = await call(page, 'killBoss');
    check(killed === true, 'a boss came and was brought down', killed);
    const bossUp = await stepUntilOffer(page, OFFER_BOSS, 240);
    check(bossUp, 'a fallen boss brings an offer');
    if (bossUp) {
      await page.waitForTimeout(300);
      await settle(page);
      const bossHead = await header(page);
      check(bossHead === 'BOSS DOWN', 'the header says BOSS DOWN', bossHead);
      const rares = await cardFaces(page);
      check(allIcons(rares), 'the boss cards are icons', rares);
      await screen(page, 'cards-boss.png');

      // The same cards on a small phone: all of them on screen, nothing to scroll.
      await page.setViewportSize({ width: 360, height: 640 });
      await page.waitForTimeout(200);
      await settle(page);
      const fit = await page.evaluate(() => {
        const stack = document.querySelector('.cards-stack')?.getBoundingClientRect();
        const cards = [...document.querySelectorAll('.card:not([hidden])')];
        return {
          top: stack?.top ?? -1,
          bottom: stack?.bottom ?? 1e9,
          scroll: document.scrollingElement?.scrollHeight ?? 0,
          cut: cards.some((c) => c.scrollWidth > c.clientWidth || c.scrollHeight > c.clientHeight + 1),
        };
      });
      check(fit.top >= 0 && fit.bottom <= 640 && fit.scroll <= 640 && !fit.cut, 'the cards fit 360x640 without scrolling', fit);
      await screen(page, 'cards-small.png');
      await page.setViewportSize({ width: WIDTH, height: HEIGHT });
      await call(page, 'pick', 0);
      await hook.step(1);
    }

    // The build bar full: four weapons and four passives, at a spread of levels.
    const now = await hook.state();
    const weaponIds = now.weapons.map((w) => w.id).concat([1, 4, 5, 8, 9, 0].filter((id) => !now.weapons.some((w) => w.id === id)));
    for (const [k, id] of weaponIds.slice(0, 4).entries()) await call(page, 'setWeapon', id, 5 - k);
    const passiveIds = now.passives.map((p) => p.id).concat([5, 2, 4, 9, 6, 8].filter((id) => !now.passives.some((p) => p.id === id)));
    for (const [k, id] of passiveIds.slice(0, 4).entries()) await call(page, 'setPassive', id, 2 + k);
    await stepUntilOffer(page, -1, 45);
    const built = await hook.state();
    check(built.phase === 0 && built.offer === null, 'back in play with a built loadout', built);
    check(built.weapons.length === 4 && built.passives.length === 4, 'the build is full', built);
    const tilesNow = await page.evaluate(() =>
      [...document.querySelectorAll('.bb .bb-tile')].map((t) => ({ empty: t.classList.contains('bb-empty'), svg: t.querySelectorAll('svg').length, text: t.textContent ?? '' })),
    );
    check(tilesNow.length === 8 && tilesNow.every((t) => !t.empty && t.svg === 1 && t.text.trim() === ''), 'every build tile is an icon, never letters', tilesNow);
    const pips = await page.evaluate(() => document.querySelectorAll('.bb .bb-pip.on').length);
    check(pips >= 7, 'the build bar shows level pips', pips);
    const bar = await page.evaluate(() => {
      const r = document.querySelector('.bb')?.getBoundingClientRect();
      const tile = document.querySelector('.bb .bb-tile')?.getBoundingClientRect();
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

    // The end card, with the build on it.
    const last = await hook.state();
    for (let i = 0; i < 120 && (await hook.state()).phase !== PHASE_DEAD; i++) {
      await call(page, 'hurt', 100000);
      await hook.step(1);
    }
    check((await hook.state()).phase === PHASE_DEAD, 'a fatal hit ends the run');
    // The hook holds the real-time clock: a second of game time lets the card's pause run out.
    await hook.step(60);
    await page.waitForFunction(() => document.querySelector('.end')?.classList.contains('end-show') === true, undefined, { timeout: 10_000 });
    await page.waitForTimeout(500);
    await settle(page);
    const summary = await page.evaluate(() =>
      [...document.querySelectorAll('.end .bb-tile:not([hidden])')].map((t) => ({
        svg: t.querySelectorAll('svg').length,
        pips: t.querySelectorAll('.bb-pip.on').length,
        text: t.textContent ?? '',
      })),
    );
    const levels = [...last.weapons, ...last.passives].map((i) => i.level);
    check(summary.length === levels.length && summary.every((t) => t.svg === 1 && t.text === ''), 'the end card shows the build as icons', { summary, levels });
    check(JSON.stringify(summary.map((t) => t.pips)) === JSON.stringify(levels), 'with their levels', { summary, levels });
    const endTop = await page.evaluate(() => document.querySelector('.end')?.getBoundingClientRect().top ?? -1);
    check(endTop >= 0, 'the end card is all on screen', endTop);
    await screen(page, 'cards-end.png');

    // The icon set at 64 and 28 px, labelled, over a blank overlay, in the colours the cards use.
    const sets = [
      { color: '--card-weapon', icons: source.WEAPON_ICONS, names: source.WEAPON_INFO.map((i) => i.name) },
      { color: '--card-passive', icons: source.PASSIVE_ICONS, names: source.PASSIVE_INFO.map((i) => i.name) },
      { color: '--card-boon', icons: source.BOON_ICONS, names: source.BOON_INFO.map((i) => i.name) },
    ];
    const gallery = await page.evaluate((sets) => {
      const cards = document.querySelector('.cards');
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:100;overflow:hidden;background:#1b1630;color:#fff;padding:10px 4px;box-sizing:border-box;' +
        'font:700 10px/1.1 system-ui,sans-serif;display:flex;flex-direction:column;gap:12px';
      const bad = [];
      for (const set of sets) {
        const color = cards instanceof HTMLElement ? cards.style.getPropertyValue(set.color) : '#fff';
        const row = document.createElement('div');
        row.style.cssText = `display:flex;flex-wrap:wrap;gap:6px 2px;justify-content:center;color:${color}`;
        set.icons.forEach((markup, i) => {
          const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
          if (parsed.querySelector('parsererror') || parsed.documentElement.nodeName !== 'svg') bad.push(set.names[i]);
          const cell = document.createElement('div');
          cell.style.cssText = 'width:74px;display:flex;flex-direction:column;align-items:center;gap:3px';
          for (const px of [64, 28]) {
            const box = document.createElement('div');
            box.style.cssText = `width:${px}px;height:${px}px`;
            box.innerHTML = markup;
            cell.appendChild(box);
          }
          const label = document.createElement('div');
          label.style.cssText = 'color:#fff;text-align:center';
          label.textContent = set.names[i];
          cell.appendChild(label);
          row.appendChild(cell);
        });
        overlay.appendChild(row);
      }
      document.body.appendChild(overlay);
      for (const s of overlay.querySelectorAll('svg')) s.style.cssText = 'display:block;width:100%;height:100%';
      const empty = [...overlay.querySelectorAll('svg')].filter((s) => {
        const b = s.getBBox();
        return !(b.width > 4 && b.height > 4);
      }).length;
      const r = overlay.lastElementChild?.getBoundingClientRect();
      return { bad, empty, count: overlay.querySelectorAll('svg').length, bottom: r?.bottom ?? 1e9 };
    }, sets);
    const total = sets.reduce((n, s) => n + s.icons.length, 0);
    check(gallery.bad.length === 0, 'every icon parses as SVG', gallery.bad);
    check(gallery.count === total * 2 && gallery.empty === 0, 'every icon draws something at both sizes', gallery);
    check(gallery.bottom <= HEIGHT, 'the whole set fits one screen', gallery);
    await settle(page);
    await screen(page, 'icons.png');
  },
};
