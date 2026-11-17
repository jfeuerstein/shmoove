/**
 * What each onboarding hint says and shows: a few words and which thumb glyph, and how the glyph's
 * frames run on twos. Pure (no DOM), so it is unit tested.
 */
import type { HintId } from '../sim/game/onboarding';

/** The thumb animations: slide (carve), flick (hop), press-and-fill (hold), drag-then-lift (sling), plus two closing glyphs. */
export type GlyphKind = 'slide' | 'flick' | 'press' | 'drag' | 'map' | 'lift';

export interface HintCopy {
  glyph: GlyphKind;
  /** Two or three words, in capitals. */
  title: string;
  /** A second line ('' for none): the stop to stay on to, or the closing ticket's second half. */
  sub: string;
}

export interface HintContext {
  /** The last release was a plain one: ask for a real whip. */
  slingRetry: boolean;
  /** The stop where the current ride will ink its first segment ('' if unknown). */
  stopName: string;
  /** The ink hint is asking to catch a ride first (not hitched yet). */
  inkCatch: boolean;
  /** What the world pointer is over: `hop` when that ride needs a hop to reach. */
  target: { readonly hop: boolean };
}

export function hintCopy(id: HintId, ctx: HintContext): HintCopy {
  switch (id) {
    case 'carve':
      return { glyph: 'slide', title: 'DRAG', sub: '' };
    case 'hop':
      return { glyph: 'flick', title: 'FLICK UP', sub: '' };
    case 'grind':
      return { glyph: 'flick', title: 'LAND ON THE RAIL', sub: '' };
    case 'hitch':
      return ctx.target.hop ? { glyph: 'flick', title: 'FLICK UP, THEN HOLD', sub: '' } : { glyph: 'press', title: 'PRESS AND HOLD STILL', sub: '' };
    case 'sling':
      return ctx.slingRetry
        ? { glyph: 'drag', title: 'TRY CARVING BEHIND IT FIRST', sub: '' }
        : { glyph: 'drag', title: 'DRAG... THEN LET GO', sub: '' };
    case 'ink':
      if (ctx.inkCatch) {
        return ctx.target.hop
          ? { glyph: 'flick', title: 'FLICK UP, THEN HOLD', sub: 'RIDE IT TO THE NEXT STOP' }
          : { glyph: 'press', title: 'PRESS AND HOLD STILL', sub: 'RIDE IT TO THE NEXT STOP' };
      }
      return { glyph: 'press', title: 'STAY ON TO THE NEXT STOP', sub: ctx.stopName === '' ? '' : '→ ' + ctx.stopName.toUpperCase() };
    case 'chain':
      return { glyph: 'press', title: 'CATCH ANOTHER BEFORE YOU LAND', sub: '' };
    case 'roll':
      return { glyph: 'slide', title: 'WIGGLE TO ROLL', sub: '' };
    case 'map':
      return { glyph: 'map', title: 'YOUR MAP', sub: '' };
    case 'lift':
      return { glyph: 'lift', title: 'NO PUSHING.', sub: 'EVERYTHING THAT MOVES IS A LIFT.' };
  }
}

/** Each glyph's loop as [frame, twos steps held]. */
export const GLYPH_LOOPS: Readonly<Record<GlyphKind, ReadonlyArray<readonly [number, number]>>> = {
  slide: [
    [0, 3],
    [1, 3],
    [2, 3],
    [1, 3],
  ],
  flick: [
    [0, 6],
    [1, 2],
    [2, 4],
  ],
  press: [
    [0, 4],
    [1, 4],
    [2, 7],
  ],
  drag: [
    [0, 4],
    [1, 4],
    [2, 7],
  ],
  map: [
    [0, 3],
    [1, 3],
  ],
  lift: [[0, 1]],
};

/** The frame a glyph shows reduced motion: the one that says the most on its own. */
export const GLYPH_STATIC: Readonly<Record<GlyphKind, number>> = { slide: 1, flick: 2, press: 2, drag: 2, map: 0, lift: 0 };

/** Frames in each glyph's SVG. */
export const GLYPH_FRAMES: Readonly<Record<GlyphKind, number>> = { slide: 3, flick: 3, press: 3, drag: 3, map: 2, lift: 1 };

/** The frame showing `steps` twos steps into a glyph's loop. */
export function glyphFrame(kind: GlyphKind, steps: number): number {
  const loop = GLYPH_LOOPS[kind];
  let total = 0;
  for (const [, n] of loop) total += n;
  let t = ((Math.floor(steps) % total) + total) % total;
  for (const [f, n] of loop) {
    if (t < n) return f;
    t -= n;
  }
  return loop[0][0];
}
