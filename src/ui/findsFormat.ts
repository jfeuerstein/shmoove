/** Pure text and colour for the finds: tickets, the album, the wardrobe. */
import { DEFAULT_DECK, DEFAULT_KIT, type FindsCatalog, type Livery, type UnlockSource } from '../sim/game/finds';
import type { GameEvent } from '../sim/game/game';
import { DISTRICT_NAMES } from '../sim/world';
import { ticksClock } from './errandFormat';
import { boardText, hexColor } from './format';

/** Tier names in the album, and the border ink of each (as in the world). */
export const TIER_NAMES = ['Trail', 'Detour', 'Hidden'] as const;
export const TIER_INKS = [0xffae1a, 0xff2e88, 0x1f3fbf] as const;

export function districtName(d: number): string {
  return DISTRICT_NAMES[d] ?? `District ${d + 1}`;
}

/** "TILE 14/60". */
export function tileCounter(count: number, total: number): string {
  return `TILE ${count}/${total}`;
}

/** Tiles of a tier: found / total, except a hidden tier shows only how many are found ("2/?"). */
export function tierCount(tier: number, found: number, total: number): string {
  return tier >= 2 ? `${found}/?` : `${found}/${total}`;
}

/** Seconds with tenths, for runs: "12.4 s", or m:ss past a minute. */
export function runTime(ticks: number): string {
  const s = ticks / 60;
  if (s >= 60) return ticksClock(ticks);
  return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
}

export function slotWord(l: Livery): string {
  return l.slot === 'deck' ? 'Deck' : 'Kit';
}

/** How an item is earned, for the wardrobe ("15 TILES", "POSTCARD: LA FUENTE", "ALL SPOTS: DOCKS"). */
export function sourceText(src: UnlockSource | null, cat: FindsCatalog): string {
  if (src === null) return 'From the start';
  if (src.kind === 'tiles') return src.need >= cat.tiles.length ? `All ${src.need} tiles` : `${src.need} tiles`;
  if (src.kind === 'postcard') {
    const z = cat.landmarks.find((l) => l.id === src.landmark);
    return `Postcard: ${z ? z.name : src.landmark}`;
  }
  return `All spots: ${districtName(src.district)}`;
}

/** The unlock source of an item, null for the street pair. */
export function sourceOf(cat: FindsCatalog, id: string): UnlockSource | null {
  if (id === DEFAULT_DECK.id || id === DEFAULT_KIT.id) return null;
  for (const u of cat.unlocks) if (u.item.id === id) return u.source;
  return null;
}

/**
 * CSS for a swatch of an item: a deck as its base with the print in its accent, a kit as shirt,
 * trim and cap in three bands.
 */
export function swatchCss(l: Livery): string {
  if (l.slot === 'kit') {
    const s = hexColor(l.shirt);
    const t = hexColor(l.trim);
    const c = hexColor(l.cap);
    return `linear-gradient(${c} 0 30%,${s} 30% 72%,${t} 72% 100%)`;
  }
  const b = hexColor(l.base);
  const a = hexColor(l.accent);
  switch (l.pattern) {
    case 1:
      return `linear-gradient(${b} 0 40%,${a} 40% 60%,${b} 60%)`;
    case 2:
      return `repeating-conic-gradient(${a} 0 25%,${b} 0 50%) 0 0/10px 10px`;
    case 3:
      return `linear-gradient(90deg,${a} 0 18%,${b} 18% 82%,${a} 82%)`;
    case 4:
      return `repeating-linear-gradient(90deg,${b} 0 9px,${a} 9px 13px)`;
    default:
      return `linear-gradient(90deg,${b} 0 86%,${a} 86%)`;
  }
}

export interface FindsTicket {
  kind: 'tile' | 'spot' | 'postcard' | 'unlock' | 'best';
  title: string;
  body: string;
  stamp?: string;
}

/** What ticket a finds event shows, or null for events that are not finds. */
export function findsTicket(e: GameEvent): FindsTicket | null {
  switch (e.type) {
    case 'tile':
      return { kind: 'tile', title: tileCounter(e.count, e.total), body: '' };
    case 'spot':
      return { kind: 'spot', title: 'Spot found', body: '', stamp: boardText(e.name) };
    case 'postcard':
      return { kind: 'postcard', title: 'Postcard', body: e.name };
    case 'unlock':
      return { kind: 'unlock', title: `New ${e.slot === 'deck' ? 'deck' : 'kit'}`, body: e.name };
    case 'bestLine':
      return { kind: 'best', title: 'Best line', body: `${districtName(e.district)} · ${e.count} tricks` };
    case 'bestRun':
      return { kind: 'best', title: e.first ? 'Run timed' : 'Best run', body: `${e.name} · ${runTime(e.ticks)}` };
    default:
      return null;
  }
}
