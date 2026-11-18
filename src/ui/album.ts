/**
 * The album: the ledger's fourth tab. From the top: the totals; the wardrobe (every deck and kit
 * the world offers, locked ones dimmed with what earns them, the worn ones marked ON; tapping an
 * unlocked one puts it on); tiles per district and tier (hidden ones only as "?"); the spots, found
 * ones by name and stamped, the rest as silhouettes of their names; the postcards; the best lines
 * per district and the best run of each route.
 *
 * It changes game state only through `Game.findsWear`.
 */
import { districtFinds, isUnlocked, wardrobe, type Livery } from '../sim/game/finds';
import type { Game } from '../sim/game/game';
import { el } from './dom';
import { TIER_INKS, TIER_NAMES, districtName, runTime, slotWord, sourceOf, sourceText, swatchCss, tierCount } from './findsFormat';
import { boardText, hexColor } from './format';

export interface AlbumHost {
  tap(): void;
  /** Something changed (an item was put on): render again. */
  changed(): void;
}

/** Found and total of everything the album counts (tiles, spots, postcards). */
export function albumCounts(game: Game): [number, number] {
  const f = game.finds;
  const c = f.catalog;
  return [f.count + Object.keys(f.spots).length + Object.keys(f.postcards).length, c.tiles.length + c.spots.length + c.landmarks.length];
}

function section(title: string, aside = ''): HTMLElement {
  const s = el('div', 'sk-asec');
  const h = el('div', 'sk-ahead');
  h.append(el('span', '', title), el('span', 'sk-aside', aside));
  s.appendChild(h);
  return s;
}

/** The silhouette of a name: one dark bar per word, as long as the word. */
function silhouette(name: string): HTMLElement {
  const s = el('span', 'sk-asil');
  for (const w of name.split(/\s+/)) {
    if (!w) continue;
    const bar = el('i');
    bar.style.width = `${(w.length * 0.62).toFixed(2)}em`;
    s.appendChild(bar);
  }
  return s;
}

export function renderAlbum(body: HTMLElement, game: Game, host: AlbumHost): void {
  const f = game.finds;
  const c = f.catalog;
  const spotsFound = Object.keys(f.spots).length;
  const postFound = Object.keys(f.postcards).length;

  const sum = el('div', 'sk-asum');
  const fact = (label: string, v: string): void => {
    sum.append(el('span', 'sk-cfact', label), el('b', '', v));
  };
  fact('Tiles', `${f.count}/${c.tiles.length}`);
  fact('Spots', `${spotsFound}/${c.spots.length}`);
  fact('Cards', `${postFound}/${c.landmarks.length}`);
  body.appendChild(sum);

  // Wardrobe.
  const items = wardrobe(c);
  let open = 0;
  for (const it of items) if (isUnlocked(f, it.id)) open++;
  const wr = section('Wardrobe', `${open}/${items.length}`);
  for (const slot of ['deck', 'kit'] as const) {
    const row = el('div', 'sk-awrow');
    for (const it of items) if (it.slot === slot) row.appendChild(wearButton(game, it, host));
    wr.appendChild(row);
  }
  body.appendChild(wr);

  // Tiles per district and tier.
  const tiles = section('Tiles', `${f.count}/${c.tiles.length}`);
  for (let d = 0; d < c.districts; d++) {
    const n = districtFinds(f, d);
    if (n.tilesTotal === 0) continue;
    const row = el('div', 'sk-arow');
    row.dataset.district = String(d);
    row.appendChild(el('span', 'sk-aname', boardText(districtName(d))));
    for (let t = 0; t < 3; t++) {
      const tot = c.totals[d * 3 + t];
      if (tot === 0) continue;
      const chip = el('span', 'sk-atier');
      chip.style.setProperty('--sk-tier', hexColor(TIER_INKS[t]));
      chip.append(el('i'), el('span', '', `${TIER_NAMES[t]} ${tierCount(t, f.found[d * 3 + t], tot)}`));
      row.appendChild(chip);
    }
    tiles.appendChild(row);
  }
  if (c.tiles.length === 0) tiles.appendChild(el('div', 'sk-anone', 'No tiles here'));
  body.appendChild(tiles);

  // Spots.
  const spots = section('Spots', `${spotsFound}/${c.spots.length}`);
  for (let i = 0; i < c.spots.length; i++) {
    const z = c.spots[i];
    const found = f.spots[z.id] !== undefined;
    const row = el('div', 'sk-lrow sk-aspot' + (found ? ' sk-lpunched' : ''));
    row.dataset.spot = z.id;
    const txt = el('div', 'sk-lrowtxt');
    const name = el('div', 'sk-lrowtask');
    if (found) name.textContent = boardText(z.name);
    else name.appendChild(silhouette(z.name));
    txt.append(name, el('div', 'sk-lrowsub', `${boardText(districtName(c.spotDistrict[i]))}${found ? ' · FOUND' : ' · IN THE AIR OR AT SPEED'}`));
    row.append(el('span', 'sk-astamp' + (found ? ' sk-on' : '')), txt);
    spots.appendChild(row);
  }
  if (c.spots.length === 0) spots.appendChild(el('div', 'sk-anone', 'No spots here'));
  body.appendChild(spots);

  // Postcards.
  const cards = section('Postcards', `${postFound}/${c.landmarks.length}`);
  const grid = el('div', 'sk-acards');
  for (const z of c.landmarks) {
    const got = f.postcards[z.id] !== undefined;
    const card = el('div', 'sk-acard' + (got ? ' sk-on' : ''));
    card.dataset.postcard = z.id;
    card.append(el('span', 'sk-acardname', boardText(z.name)), el('span', 'sk-acardsub', got ? 'SENT' : 'NOT YET'));
    grid.appendChild(card);
  }
  cards.appendChild(grid);
  body.appendChild(cards);

  // Best lines and runs.
  const best = section('Best');
  const facts = el('div', 'sk-abest');
  let any = false;
  for (let d = 0; d < f.bestLines.length; d++) {
    if (f.bestLines[d] <= 0) continue;
    any = true;
    facts.append(el('span', 'sk-cfact', `Line · ${boardText(districtName(d))}`), el('b', '', `${f.bestLines[d]} tricks`));
  }
  for (const r of c.routes) {
    const t = f.bestRuns[r.name];
    any = true;
    facts.append(el('span', 'sk-cfact', `Run · ${boardText(r.name)}`), el('b', t === undefined ? 'sk-cnone' : '', t === undefined ? '—' : runTime(t)));
  }
  if (!any) facts.appendChild(el('span', 'sk-anone', 'String tricks into a line to set one'));
  best.appendChild(facts);
  body.appendChild(best);
}

function wearButton(game: Game, it: Livery, host: AlbumHost): HTMLElement {
  const f = game.finds;
  const open = isUnlocked(f, it.id);
  const on = (it.slot === 'deck' ? f.deck : f.kit) === it.id;
  const b = el('button', 'sk-awear' + (open ? '' : ' sk-locked') + (on ? ' sk-sel' : ''));
  b.type = 'button';
  b.dataset.sk = `wear.${it.id}`;
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${slotWord(it)}: ${it.name}${open ? '' : ' (locked)'}`);
  const sw = el('span', 'sk-aswatch sk-a' + it.slot);
  sw.style.background = swatchCss(it);
  b.append(sw, el('span', 'sk-awname', boardText(it.name)), el('span', 'sk-awsub', on ? 'ON' : open ? slotWord(it).toUpperCase() : boardText(sourceText(sourceOf(f.catalog, it.id), f.catalog))));
  b.disabled = !open;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!open || on) return;
    if (game.findsWear(it.id).ok) {
      host.tap();
      host.changed();
    }
  });
  return b;
}
