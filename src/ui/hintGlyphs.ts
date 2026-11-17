/**
 * The hint glyphs: a printed thumb on a strip of glass, drawn in inline SVG, one group per frame
 * (`sk-fr sk-frN`, plus `sk-frs` on the frame shown with reduced motion). The stub shows one frame
 * at a time by a class on the glyph box. Pure strings, no DOM.
 */
import { GLYPH_FRAMES, GLYPH_STATIC, type GlyphKind } from './hintCopy';

const INK = '#1B1A2E';
const PAPER = '#F3EBDD';
const PINK = '#FF2E88';
const MANGO = '#FFAE1A';
const COBALT = '#1F3FBF';

/** A thumb, pad down, its tip at (x, y). `lifted` draws it raised off the glass (smaller, with a gap). */
function thumb(x: number, y: number, lifted = false): string {
  const s = lifted ? 0.86 : 1;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<rect x="-7.5" y="0" width="15" height="25" rx="7.5" fill="${PAPER}" stroke="${INK}" stroke-width="2.2"/>` +
    `<rect x="-4.6" y="2.4" width="9.2" height="8" rx="4" fill="${PINK}" opacity=".9"/>` +
    `<path d="M-7.5 17 H7.5" stroke="${INK}" stroke-width="1.4" opacity=".45"/>` +
    '</g>'
  );
}

/** Contact mark on the glass under a pressed thumb. */
function contact(x: number, y: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="6.5" ry="2.2" fill="${COBALT}" opacity=".55"/>`;
}

const arrow = (d: string, color = MANGO): string =>
  `<path d="${d}" stroke="${INK}" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

const GLASS = `<path d="M3 40 H45" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2 2.5" opacity=".5"/>`;

function frames(kind: GlyphKind): string[] {
  switch (kind) {
    case 'slide':
      // Thumb pressed on the glass, sliding left, centre, right.
      return [12, 24, 36].map(
        (x, i) =>
          contact(x, 38) +
          thumb(x, 13) +
          (i === 1 ? arrow('M9 10 L4 15 L9 20') + arrow('M39 10 L44 15 L39 20') : i === 0 ? arrow('M30 15 H43 M39 11 L43 15 L39 19') : arrow('M18 15 H5 M9 11 L5 15 L9 19')),
      );
    case 'flick':
      // Down on the glass, a fast flick up, then the trail.
      return [contact(24, 38) + thumb(24, 13), thumb(24, 5) + arrow('M24 44 V36', PINK), thumb(24, 1, true) + arrow('M24 46 V30 M18 36 L24 30 L30 36')];
    case 'press': {
      // Pressed still, a ring filling round it.
      const c = 2 * Math.PI * 17;
      return [1 / 3, 2 / 3, 1].map(
        (f) =>
          `<circle cx="24" cy="26" r="17" fill="none" stroke="${INK}" stroke-width="5" opacity=".18"/>` +
          `<circle cx="24" cy="26" r="17" fill="none" stroke="${MANGO}" stroke-width="4.2" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 26)" stroke-linecap="round"/>` +
          contact(24, 38) +
          thumb(24, 13),
      );
    }
    case 'drag':
      // Pressed and dragging one way, then the other, then lifted off: let go.
      return [
        contact(16, 38) + thumb(16, 13) + arrow('M28 30 H40 M36 26 L40 30 L36 34'),
        contact(32, 38) + thumb(32, 13) + arrow('M20 30 H8 M12 26 L8 30 L12 34'),
        thumb(32, 2, true) + arrow('M27 43 L31 33', PINK) + arrow('M37 43 L34 33', PINK),
      ];
    case 'map':
      // An arrow up and left, toward the map button.
      return [arrow('M38 38 L12 12 M12 26 V12 H26'), arrow('M34 34 L8 8 M8 22 V8 H22')];
    case 'lift':
      // A bumper with an arrow riding up off it.
      return [
        `<rect x="8" y="30" width="32" height="8" rx="2" fill="${PINK}" stroke="${INK}" stroke-width="2"/>` +
          `<circle cx="15" cy="40" r="3.2" fill="${INK}"/><circle cx="33" cy="40" r="3.2" fill="${INK}"/>` +
          arrow('M24 26 V6 M17 13 L24 6 L31 13'),
      ];
  }
}

const cache = new Map<GlyphKind, string>();

/** The glyph's SVG, every frame in it. */
export function glyphSvg(kind: GlyphKind): string {
  const hit = cache.get(kind);
  if (hit !== undefined) return hit;
  const fs = frames(kind);
  if (fs.length !== GLYPH_FRAMES[kind]) throw new Error(`glyph ${kind}: ${fs.length} frames`);
  let body = '';
  for (let i = 0; i < fs.length; i++) {
    const cls = 'sk-fr sk-fr' + i + (i === GLYPH_STATIC[kind] ? ' sk-frs' : '');
    body += `<g class="${cls}">${fs[i]}</g>`;
  }
  const svg = `<svg viewBox="0 0 48 48" aria-hidden="true">${kind === 'map' || kind === 'lift' ? '' : GLASS}${body}</svg>`;
  cache.set(kind, svg);
  return svg;
}
