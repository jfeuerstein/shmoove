import { describe, expect, it } from 'vitest';
import { P_LUCK, PASSIVE_COUNT, PASSIVE_INFO, raisePassive, raiseWeapon, W_ORBIT, W_SEEKERS, WEAPON_COUNT, WEAPON_INFO } from '../../src/sim/arsenal';
import { BOON_INFO, SHRINE_BOONS } from '../../src/sim/offer';
import { makeWorld, PHASE_DEAD } from '../../src/sim/world';
import { EndScreen } from '../../src/ui/endScreen';
import { BOON_ICONS, iconSvg, PASSIVE_ICONS, WEAPON_ICONS, type IconKind } from '../../src/ui/icons';

const ALL: { kind: IconKind; id: number; name: string }[] = [
  ...WEAPON_INFO.map((w, id) => ({ kind: 'weapon' as const, id, name: w.name })),
  ...PASSIVE_INFO.map((p, id) => ({ kind: 'passive' as const, id, name: p.name })),
  ...BOON_INFO.map((b, id) => ({ kind: 'boon' as const, id, name: b.name })),
];

interface Tag {
  name: string;
  attrs: Map<string, string>;
}

/**
 * A strict little XML reader, enough for the markup icons.ts writes: every tag closed and nested,
 * every attribute quoted and not repeated, no text outside tags. Throws on anything else.
 */
function parseXml(src: string): Tag[] {
  const tags: Tag[] = [];
  const open: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '<') throw new Error(`text outside a tag at ${i}: ${src.slice(i, i + 20)}`);
    const end = src.indexOf('>', i);
    if (end < 0) throw new Error('unclosed tag');
    const raw = src.slice(i + 1, end);
    i = end + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1);
      if (open.pop() !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = /^([a-z][a-z0-9-]*)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*="[^"<>]*")*)\s*$/.exec(body);
    if (!m) throw new Error(`malformed tag <${raw}>`);
    const attrs = new Map<string, string>();
    for (const a of m[2].matchAll(/([a-zA-Z][a-zA-Z0-9:-]*)="([^"]*)"/g)) {
      if (attrs.has(a[1])) throw new Error(`repeated attribute ${a[1]}`);
      attrs.set(a[1], a[2]);
    }
    tags.push({ name: m[1], attrs });
    if (!selfClose) open.push(m[1]);
  }
  if (open.length > 0) throw new Error(`unclosed <${open.join('>, <')}>`);
  return tags;
}

/** Path data: commands and numbers only, starting with a move. */
const PATH_D = /^M[-\d.]+[ ,]?[-\d.]+(?:[ ,]*[MmLlHhVvCcSsQqTtAaZz]|[ ,]*-?\d*\.?\d+(?:e-?\d+)?)*$/;

describe('icons', () => {
  it('has one for every weapon, passive and boon id', () => {
    expect(WEAPON_ICONS).toHaveLength(WEAPON_COUNT);
    expect(PASSIVE_ICONS).toHaveLength(PASSIVE_COUNT);
    expect(BOON_ICONS).toHaveLength(SHRINE_BOONS);
    expect(BOON_ICONS).toHaveLength(BOON_INFO.length);
    for (const { kind, id } of ALL) {
      expect(typeof iconSvg(kind, id)).toBe('string');
      expect(iconSvg(kind, id).length).toBeGreaterThan(100);
    }
    expect(iconSvg('weapon', WEAPON_COUNT)).toBe('');
  });

  it('is valid SVG on the 24-unit grid, drawn in currentColor', () => {
    for (const { kind, id, name } of ALL) {
      const s = iconSvg(kind, id);
      const tags = parseXml(s);
      const root = tags[0];
      expect(root.name, name).toBe('svg');
      expect(root.attrs.get('xmlns'), name).toBe('http://www.w3.org/2000/svg');
      expect(root.attrs.get('viewBox'), name).toBe('0 0 24 24');
      const shapes = tags.slice(1);
      expect(shapes.length, name).toBeGreaterThan(0);
      for (const t of shapes) {
        expect(t.name, name).toBe('path');
        const d = t.attrs.get('d') ?? '';
        expect(d, `${name}: ${d}`).toMatch(PATH_D);
        expect(d, name).not.toMatch(/NaN|Infinity/);
        // Every mark is in the caller's colour: no fixed colours anywhere.
        const paint = [t.attrs.get('fill'), t.attrs.get('stroke')].filter((v) => v !== undefined && v !== 'none');
        expect(paint.length, name).toBeGreaterThan(0);
        for (const p of paint) expect(p, name).toBe('currentColor');
      }
      expect(s, name).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|<text|<image|href=/i);
    }
  });

  it('keeps every icon inside its grid', () => {
    for (const { kind, id, name } of ALL) {
      for (const t of parseXml(iconSvg(kind, id)).slice(1)) {
        // Absolute coordinates only appear after M, L, H, V, Q, C, A; a rough bound on all numbers
        // that are not flags or radii is enough to catch a shape drawn off the grid.
        const d = t.attrs.get('d') ?? '';
        for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
          const x = Number(m[1]);
          const y = Number(m[2]);
          expect(x, `${name} x`).toBeGreaterThanOrEqual(-0.5);
          expect(x, `${name} x`).toBeLessThanOrEqual(24.5);
          expect(y, `${name} y`).toBeGreaterThanOrEqual(-0.5);
          expect(y, `${name} y`).toBeLessThanOrEqual(24.5);
        }
      }
    }
  });

  it('draws no two the same', () => {
    const drawings = ALL.map(({ kind, id }) => {
      // Compare the drawing itself, not the class names that carry the kind and name.
      const s = iconSvg(kind, id);
      return s.slice(s.indexOf('>') + 1);
    });
    expect(new Set(drawings).size).toBe(ALL.length);
  });

  it('hands out the same markup every time', () => {
    expect(iconSvg('weapon', W_SEEKERS)).toBe(iconSvg('weapon', W_SEEKERS));
  });
});

// ---- the end card's build summary -----------------------------------------------------------

class FakeEl {
  className = '';
  textContent = '';
  innerHTML = '';
  hidden = false;
  readonly children: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(): void {}
}

describe('the end card', () => {
  it('shows the build the run ended with as icons with levels', () => {
    const doc = { createElement: () => new FakeEl() } as unknown as Document;
    const root = new FakeEl();
    const screen = new EndScreen(root as unknown as HTMLElement, () => undefined, doc);
    const w = makeWorld(1);
    const l = w.player.loadout;
    l.weapons.fill(-1);
    l.weaponLevel.fill(0);
    raiseWeapon(l, W_ORBIT, 4);
    raiseWeapon(l, W_SEEKERS, 1);
    raisePassive(l, P_LUCK, 2);
    w.run.phase = PHASE_DEAD;
    screen.update(w, 1);
    const card = root.children[0];
    const row = card.children.find((c) => c.className === 'bb-row');
    expect(row).toBeDefined();
    expect(row?.hidden).toBe(false);
    const shown = (row?.children ?? []).filter((t) => !t.hidden);
    expect(shown.map((t) => t.children[0].innerHTML)).toEqual([
      iconSvg('weapon', W_ORBIT),
      iconSvg('weapon', W_SEEKERS),
      iconSvg('passive', P_LUCK),
    ]);
    expect(shown.map((t) => t.children[1].children.filter((p) => p.className === 'bb-pip on').length)).toEqual([4, 1, 2]);
    // Icons, not codes: no text in the summary.
    expect(shown.every((t) => t.textContent === '' && t.children[0].textContent === '')).toBe(true);
  });
});
