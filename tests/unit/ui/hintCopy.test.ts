import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, type HintId } from '../../../src/sim/game/onboarding';
import { GLYPH_FRAMES, GLYPH_LOOPS, GLYPH_STATIC, glyphFrame, hintCopy, type GlyphKind } from '../../../src/ui/hintCopy';
import { glyphSvg } from '../../../src/ui/hintGlyphs';

const ctx = { slingRetry: false, stopName: '', inkCatch: false, brakeAsk: false, target: { hop: false } };
const ALL: HintId[] = [...ONBOARDING_STEPS, 'map', 'lift'];

describe('hint copy', () => {
  it('each step shows the gesture it teaches', () => {
    expect(hintCopy('carve', ctx)).toMatchObject({ glyph: 'slide', title: 'DRAG' });
    expect(hintCopy('hop', ctx)).toMatchObject({ glyph: 'flick', title: 'FLICK UP' });
    expect(hintCopy('grind', ctx)).toMatchObject({ glyph: 'flick', title: 'LAND ON THE RAIL' });
    expect(hintCopy('hitch', ctx)).toMatchObject({ glyph: 'press', title: 'HOLD FOR THE RIDE' });
    expect(hintCopy('sling', ctx)).toMatchObject({ glyph: 'drag', title: 'DRAG... THEN LET GO' });
    expect(hintCopy('map', ctx).title).toBe('YOUR MAP');
    expect(hintCopy('lift', ctx)).toMatchObject({ title: 'NO PUSHING.', sub: 'EVERYTHING THAT MOVES IS A LIFT.' });
    expect(hintCopy('chain', ctx).title).toBe('CATCH ANOTHER BEFORE YOU LAND');
    expect(hintCopy('roll', ctx)).toMatchObject({ glyph: 'slide', title: 'WIGGLE TO ROLL' });
  });

  it('a ride that needs a hop to reach asks for the flick first', () => {
    expect(hintCopy('hitch', { ...ctx, target: { hop: true } })).toMatchObject({ glyph: 'flick', title: 'FLICK UP, THEN HOLD' });
    expect(hintCopy('ink', { ...ctx, inkCatch: true, target: { hop: true } })).toMatchObject({ glyph: 'flick', title: 'FLICK UP, THEN HOLD' });
  });

  it('the ink hint asks to catch a ride first when the skater is not on one', () => {
    expect(hintCopy('ink', { ...ctx, inkCatch: true })).toEqual({ glyph: 'press', title: 'HOLD FOR THE RIDE', sub: 'RIDE IT TO THE NEXT STOP' });
  });

  it('led to a waiting spot the first time, the hint teaches the brake: pull down to stop', () => {
    expect(hintCopy('hitch', { ...ctx, brakeAsk: true })).toEqual({ glyph: 'pull', title: 'PULL DOWN TO STOP', sub: '' });
    expect(hintCopy('ink', { ...ctx, inkCatch: true, brakeAsk: true })).toEqual({ glyph: 'pull', title: 'PULL DOWN TO STOP', sub: 'RIDE IT TO THE NEXT STOP' });
    // A ride that needs a hop asks for the flick whatever the brake.
    expect(hintCopy('hitch', { ...ctx, brakeAsk: true, target: { hop: true } }).glyph).toBe('flick');
    // Nothing teaches the brake once the skater is on the ride.
    expect(hintCopy('ink', { ...ctx, brakeAsk: true }).title).toBe('STAY ON TO THE NEXT STOP');
  });

  it('a plain release turns the sling hint into a nudge to carve first', () => {
    expect(hintCopy('sling', { ...ctx, slingRetry: true }).title).toBe('TRY CARVING BEHIND IT FIRST');
  });

  it('the ink hint names the stop to stay on to, when it is known', () => {
    expect(hintCopy('ink', { ...ctx, stopName: 'Rampa Este' })).toEqual({ glyph: 'press', title: 'STAY ON TO THE NEXT STOP', sub: '→ RAMPA ESTE' });
    expect(hintCopy('ink', ctx).sub).toBe('');
  });

  it('every hint is a few capitalised words that fit one line of the stub', () => {
    for (const id of ALL) {
      for (const brakeAsk of [false, true]) {
        const c = hintCopy(id, { ...ctx, brakeAsk, inkCatch: brakeAsk, stopName: 'Puerta de la Antena' });
        expect(c.title, id).toBe(c.title.toUpperCase());
        expect(c.title.split(' ').length, id).toBeLessThanOrEqual(6);
        expect(c.title.length, id).toBeLessThanOrEqual(30);
      }
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
    expect(GLYPH_LOOPS.pull.every(([, n]) => n >= 2)).toBe(true);
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
