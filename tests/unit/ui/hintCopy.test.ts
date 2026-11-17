import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, type HintId } from '../../../src/sim/game/onboarding';
import { GLYPH_FRAMES, GLYPH_LOOPS, GLYPH_STATIC, glyphFrame, hintCopy, type GlyphKind } from '../../../src/ui/hintCopy';
import { glyphSvg } from '../../../src/ui/hintGlyphs';

const ctx = { slingRetry: false, stopName: '' };
const ALL: HintId[] = [...ONBOARDING_STEPS, 'map', 'lift'];

describe('hint copy', () => {
  it('each step shows the gesture it teaches', () => {
    expect(hintCopy('carve', ctx)).toMatchObject({ glyph: 'slide', title: 'DRAG' });
    expect(hintCopy('hop', ctx)).toMatchObject({ glyph: 'flick', title: 'FLICK UP' });
    expect(hintCopy('grind', ctx)).toMatchObject({ glyph: 'flick', title: 'LAND ON THE RAIL' });
    expect(hintCopy('hitch', ctx)).toMatchObject({ glyph: 'press', title: 'PRESS AND HOLD STILL' });
    expect(hintCopy('sling', ctx)).toMatchObject({ glyph: 'drag', title: 'DRAG... THEN LET GO' });
    expect(hintCopy('map', ctx).title).toBe('YOUR MAP');
    expect(hintCopy('lift', ctx)).toMatchObject({ title: 'NO PUSHING.', sub: 'EVERYTHING THAT MOVES IS A LIFT.' });
    expect(hintCopy('chain', ctx).title).toBe('CATCH ANOTHER BEFORE YOU LAND');
  });

  it('a plain release turns the sling hint into a nudge to carve first', () => {
    expect(hintCopy('sling', { slingRetry: true, stopName: '' }).title).toBe('TRY CARVING BEHIND IT FIRST');
  });

  it('the ink hint names the stop to stay on to, when it is known', () => {
    expect(hintCopy('ink', { slingRetry: false, stopName: 'Rampa Este' })).toEqual({ glyph: 'press', title: 'STAY ON TO THE NEXT STOP', sub: '→ RAMPA ESTE' });
    expect(hintCopy('ink', ctx).sub).toBe('');
  });

  it('every hint is a few capitalised words that fit one line of the stub', () => {
    for (const id of ALL) {
      const c = hintCopy(id, { slingRetry: false, stopName: 'Puerta de la Antena' });
      expect(c.title, id).toBe(c.title.toUpperCase());
      expect(c.title.split(' ').length, id).toBeLessThanOrEqual(6);
      expect(c.title.length, id).toBeLessThanOrEqual(30);
    }
  });
});

describe('glyphs on twos', () => {
  const kinds = Object.keys(GLYPH_LOOPS) as GlyphKind[];

  it('each loop visits every frame of its glyph and repeats', () => {
    for (const k of kinds) {
      let total = 0;
      for (const [, n] of GLYPH_LOOPS[k]) total += n;
      const seen = new Set<number>();
      for (let s = 0; s < total; s++) seen.add(glyphFrame(k, s));
      expect(seen.size, k).toBe(GLYPH_FRAMES[k]);
      for (let s = 0; s < total; s++) expect(glyphFrame(k, s + total), k).toBe(glyphFrame(k, s));
    }
  });

  it('frames change no faster than every twos step and hold long enough to read (at least 2 steps but a flick)', () => {
    for (const k of kinds) for (const [, n] of GLYPH_LOOPS[k]) expect(n, k).toBeGreaterThanOrEqual(1);
    expect(GLYPH_LOOPS.slide.every(([, n]) => n >= 2)).toBe(true);
    expect(GLYPH_LOOPS.press.every(([, n]) => n >= 2)).toBe(true);
  });

  it('each SVG holds its frames, one marked as the reduced-motion still', () => {
    for (const k of kinds) {
      const svg = glyphSvg(k);
      expect(svg.match(/class="sk-fr /g)?.length, k).toBe(GLYPH_FRAMES[k]);
      expect(svg.match(/sk-frs/g)?.length, k).toBe(1);
      expect(svg).toContain(`sk-fr${GLYPH_STATIC[k]} sk-frs`);
      expect(svg.startsWith('<svg')).toBe(true);
    }
  });
});
