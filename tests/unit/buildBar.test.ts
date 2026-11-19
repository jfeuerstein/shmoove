import { describe, expect, it } from 'vitest';
import {
  makeLoadout,
  P_HEART,
  P_LUCK,
  P_WAX,
  P_WIDE_LOAD,
  PASSIVE_INFO,
  raisePassive,
  raiseWeapon,
  W_BUMPER,
  W_SEEKERS,
  W_SLAM,
  W_WAKE,
  WEAPON_INFO,
} from '../../src/sim/arsenal';
import { BuildBar, tileOf } from '../../src/ui/buildBar';

/** An element that counts every write to its text and class. */
class CountingEl {
  hidden = false;
  writes = 0;
  classWrites = 0;
  readonly children: CountingEl[] = [];
  readonly style = { setProperty: (): void => undefined };
  private text = '';
  private name = '';
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
    this.writes++;
  }
  get className(): string {
    return this.name;
  }
  set className(v: string) {
    this.name = v;
    this.classWrites++;
  }
  setAttribute(): void {}
  appendChild(c: CountingEl): CountingEl {
    this.children.push(c);
    return c;
  }
}

function build(): { bar: BuildBar; tiles: CountingEl[]; all: CountingEl[] } {
  const all: CountingEl[] = [];
  const doc = {
    createElement: () => {
      const e = new CountingEl();
      all.push(e);
      return e;
    },
  } as unknown as Document;
  const root = new CountingEl();
  const bar = new BuildBar(root as unknown as HTMLElement, doc);
  const tiles = root.children[0].children.filter((c) => c.className.startsWith('bb-tile'));
  return { bar, tiles, all };
}

const writes = (all: CountingEl[]): number => all.reduce((n, e) => n + e.writes + e.classWrites, 0);
const pipsOn = (tile: CountingEl): number => tile.children[1].children.filter((p) => p.className === 'bb-pip on').length;

describe('BuildBar', () => {
  it('has four weapon tiles and four passive tiles', () => {
    const { tiles } = build();
    expect(tiles).toHaveLength(8);
  });

  it('shows an empty loadout as eight faint outlines with no pips', () => {
    const { bar, tiles } = build();
    bar.update(makeLoadout());
    for (const t of tiles) {
      expect(t.className).toContain('bb-empty');
      expect(t.children[0].textContent).toBe('');
      expect(pipsOn(t)).toBe(0);
    }
  });

  it('shows a partial loadout: code and pips for what is carried, outlines for the rest', () => {
    const { bar, tiles } = build();
    const l = makeLoadout();
    raiseWeapon(l, W_WAKE, 1);
    raiseWeapon(l, W_SLAM, 3);
    raisePassive(l, P_HEART, 2);
    bar.update(l);
    expect(tiles[0].children[0].textContent).toBe(WEAPON_INFO[W_WAKE].code);
    expect(pipsOn(tiles[0])).toBe(1);
    expect(tiles[1].children[0].textContent).toBe(WEAPON_INFO[W_SLAM].code);
    expect(pipsOn(tiles[1])).toBe(3);
    expect(tiles[2].className).toContain('bb-empty');
    expect(tiles[3].className).toContain('bb-empty');
    expect(tiles[4].children[0].textContent).toBe(PASSIVE_INFO[P_HEART].code);
    expect(tiles[4].className).toContain('bb-passive');
    expect(pipsOn(tiles[4])).toBe(2);
    expect(tiles[4].className).not.toContain('bb-empty');
    expect(tiles[5].className).toContain('bb-empty');
  });

  it('shows a full loadout at level 5 with every pip lit and no outlines', () => {
    const { bar, tiles } = build();
    const l = makeLoadout();
    for (const id of [W_WAKE, W_SEEKERS, W_BUMPER, W_SLAM]) raiseWeapon(l, id, 5);
    for (const id of [P_HEART, P_WAX, P_LUCK, P_WIDE_LOAD]) raisePassive(l, id, 5);
    bar.update(l);
    for (const t of tiles) {
      expect(t.className).not.toContain('bb-empty');
      expect(pipsOn(t)).toBe(5);
    }
  });

  it('writes nothing when the loadout has not changed', () => {
    const { bar, all } = build();
    const l = makeLoadout();
    raiseWeapon(l, W_WAKE, 2);
    bar.update(l);
    const before = writes(all);
    for (let i = 0; i < 100; i++) bar.update(l);
    expect(writes(all)).toBe(before);
  });

  it('rewrites only the tile that changed', () => {
    const { bar, tiles, all } = build();
    const l = makeLoadout();
    raiseWeapon(l, W_WAKE, 1);
    raiseWeapon(l, W_SLAM, 1);
    bar.update(l);
    const others = tiles.filter((_, i) => i !== 1);
    const mark = others.map((t) => t.writes + t.classWrites + t.children[0].writes);
    raiseWeapon(l, W_SLAM, 1);
    const before = writes(all);
    bar.update(l);
    expect(writes(all)).toBeGreaterThan(before);
    expect(pipsOn(tiles[1])).toBe(2);
    expect(others.map((t) => t.writes + t.classWrites + t.children[0].writes)).toEqual(mark);
  });

  it('tileOf reports the slot order and level', () => {
    const l = makeLoadout();
    raiseWeapon(l, W_BUMPER, 2);
    expect(tileOf(l, false, 0)).toEqual({ code: WEAPON_INFO[W_BUMPER].code, level: 2 });
    expect(tileOf(l, false, 1)).toEqual({ code: '', level: 0 });
    expect(tileOf(l, true, 0)).toEqual({ code: '', level: 0 });
  });
});
