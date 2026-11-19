import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOK_ID, LOOKS, nextLook, PALETTE, paletteOf, pickLook, STYLE, styleOf, tone } from '../../src/render/look';
import { needsPass, targetSize } from '../../src/render/scene';
import { KINDS, THING_TOTEM } from '../../src/sim/world';

describe('the looks', () => {
  it('has a few to choose between, each with its own id, name and line', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
    expect(new Set(LOOKS.map((l) => l.name)).size).toBe(LOOKS.length);
    for (const l of LOOKS) expect(l.blurb.length).toBeGreaterThan(10);
    expect(LOOKS[0].id).toBe(DEFAULT_LOOK);
  });

  it('without a URL or a saved choice the game is in the default look', () => {
    expect(LOOK_ID).toBe(DEFAULT_LOOK);
    expect(PALETTE).toEqual(paletteOf(DEFAULT_LOOK));
    expect(STYLE).toEqual(styleOf(DEFAULT_LOOK));
  });

  it('the URL wins over the saved choice, and an unknown look is ignored', () => {
    expect(pickLook('?look=tape', 'pool')).toBe('tape');
    expect(pickLook('?seed=3', 'pool')).toBe('pool');
    expect(pickLook('?look=POOL', null)).toBe('pool');
    expect(pickLook('?look=nope', 'riso')).toBe('riso');
    expect(pickLook('?look=nope', 'gone')).toBe(DEFAULT_LOOK);
    expect(pickLook('', null)).toBe(DEFAULT_LOOK);
  });

  it('stepping through the looks visits every one and comes back', () => {
    let id = DEFAULT_LOOK;
    const seen = new Set<string>();
    for (let i = 0; i < LOOKS.length; i++) {
      seen.add(id);
      id = nextLook(id);
    }
    expect(seen.size).toBe(LOOKS.length);
    expect(id).toBe(DEFAULT_LOOK);
  });

  for (const look of LOOKS) {
    describe(look.name, () => {
      const p = paletteOf(look.id);
      const s = styleOf(look.id);

      it('has a colour for every gear, enemy, boss, zone and map thing', () => {
        expect(p.gears.length).toBe(5);
        expect(p.enemies.length).toBeGreaterThanOrEqual(7);
        expect(p.enemies.length + p.bosses.length).toBe(KINDS.length);
        expect(p.zones.length).toBeGreaterThanOrEqual(3);
        expect(p.things.length).toBe(THING_TOTEM + 1);
      });

      it('does not share its lists with another look', () => {
        const q = paletteOf(look.id);
        expect(q.enemies).not.toBe(p.enemies);
        q.enemies[0] = 0;
        expect(paletteOf(look.id).enemies[0]).toBe(p.enemies[0]);
      });

      it('tells the enemy kinds apart by colour or leaves it to shape for at most two pairs', () => {
        let same = 0;
        for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) if (p.enemies[a] === p.enemies[b]) same++;
        expect(same).toBeLessThanOrEqual(2);
      });

      it('keeps the rider and the dangers off the ground colours', () => {
        for (const c of [p.mover, p.ring, p.threat, p.enemies[0]]) {
          expect(c).not.toBe(p.groundA);
          expect(c).not.toBe(p.groundB);
        }
      });

      it('has sane fog, light and screen settings', () => {
        expect(s.fogNear).toBeGreaterThan(0);
        expect(s.fogFar).toBeGreaterThan(s.fogNear + 50);
        expect(s.sunDir.y).toBeGreaterThan(0);
        expect(s.pixel).toBeGreaterThanOrEqual(1);
        expect(s.outline).toBeGreaterThanOrEqual(0);
        expect(s.outline).toBeLessThanOrEqual(1);
        expect(s.checker).toBeGreaterThan(0);
      });
    });
  }

  it('the default look is drawn straight to the screen; the others ask for the pass', () => {
    expect(needsPass(styleOf('night'))).toBe(false);
    expect(needsPass(styleOf('pool'))).toBe(true);
    expect(needsPass(styleOf('tape'))).toBe(true);
    expect(needsPass(styleOf('riso'))).toBe(true);
  });

  it('a blocky look is drawn small whatever the screen density; the others at the screen density', () => {
    const out = { w: 0, h: 0 };
    targetSize(390, 844, 2, 3, out);
    expect(out).toEqual({ w: 130, h: 281 });
    targetSize(390, 844, 2, 1, out);
    expect(out).toEqual({ w: 780, h: 1688 });
    targetSize(1, 1, 1, 8, out);
    expect(out).toEqual({ w: 1, h: 1 });
  });

  it('tone lightens toward white and darkens toward black', () => {
    expect(tone(0x804020, 0)).toBe(0x804020);
    expect(tone(0x804020, 1)).toBe(0xffffff);
    expect(tone(0x804020, -1)).toBe(0x000000);
    expect(tone(0x808080, 0.5)).toBe(0xc0c0c0);
    expect(tone(0x808080, -0.5)).toBe(0x404040);
  });
});
