import { describe, expect, it } from 'vitest';
import { gearCss, PALETTE } from '../../src/render/look';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { bossName } from '../../src/ui/bossBar';
import { clockText, formatTime, Hud } from '../../src/ui/hud';
import { KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL, KINDS } from '../../src/sim/world';

/** An element that counts the writes the HUD makes to it. */
class FakeEl {
  className = '';
  hidden = false;
  writes = 0;
  readonly children: FakeEl[] = [];
  readonly style = new Proxy({ color: '', transform: '', backgroundColor: '' } as Record<string, string>, {
    set: (t, k: string, v: string) => {
      if (t[k] !== v) this.writes++;
      t[k] = v;
      return true;
    },
  });
  private text = '';
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
    this.writes++;
  }
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

function walk(e: FakeEl, out: FakeEl[] = []): FakeEl[] {
  out.push(e);
  for (const c of e.children) walk(c, out);
  return out;
}

function build(run: boolean): { hud: Hud; parts: Map<string, FakeEl>; all: FakeEl[]; sim: Sim } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const root = new FakeEl();
  const hud = new Hud(root as unknown as HTMLElement, { run }, doc);
  const all = walk(root.children[0]).slice(1);
  const parts = new Map<string, FakeEl>();
  for (const e of all) if (!parts.has(e.className)) parts.set(e.className, e);
  return { hud, parts, all, sim: new Sim(flatTerrain(170), { horde: run }) };
}

const writesOf = (all: FakeEl[]): number => all.reduce((n, e) => n + e.writes, 0);
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

describe('Hud', () => {
  it('shows the speed in m/s, tinted by the gear', () => {
    const { hud, parts, sim } = build(false);
    const speed = parts.get('hud-speed');
    for (const [gear, v, text] of [
      [1, 4.4, '4 m/s'],
      [2, 12.4, '12 m/s'],
      [3, 17.5, '18 m/s'],
      [5, 29.6, '30 m/s'],
    ] as const) {
      sim.state.mover.gear = gear;
      sim.state.mover.speed = v;
      hud.update(sim);
      expect(speed?.textContent, `gear ${gear}`).toBe(text);
      expect(speed?.style.color, `gear ${gear}`).toBe(gearCss(gear));
    }
    expect(gearCss(1)).not.toBe(gearCss(5));
  });

  it('has no gear numeral and no gear name', () => {
    const { parts, all } = build(true);
    expect(parts.has('hud-gear')).toBe(false);
    expect(parts.has('hud-name')).toBe(false);
    expect(all.some((e) => /gear/i.test(e.className))).toBe(false);
  });

  it('shows the ollie chain only above zero', () => {
    const { hud, parts, sim } = build(false);
    const chain = parts.get('hud-chain');
    sim.state.mover.chain = 0;
    hud.update(sim);
    expect(chain?.hidden).toBe(true);
    sim.state.mover.chain = 4;
    hud.update(sim);
    expect(chain?.hidden).toBe(false);
    expect(chain?.textContent).toBe('OLLIE CHAIN ×4');
    sim.state.mover.chain = 0;
    hud.update(sim);
    expect(chain?.hidden).toBe(true);
  });

  it('has none of the run parts without a run', () => {
    const { parts } = build(false);
    for (const k of ['hud-clock', 'hud-kills', 'hud-hp', 'hud-xp', 'hud-level', 'hud-boss', 'hud-boss-banner']) expect(parts.has(k)).toBe(false);
  });

  it('writes only when a shown value changes', () => {
    const { hud, parts, all, sim } = build(true);
    const m = sim.state.mover;
    m.gear = 1;
    m.speed = 5;
    m.chain = 0;
    hud.update(sim);
    const afterFirst = writesOf(all);
    expect(afterFirst).toBeGreaterThan(0);

    for (let i = 0; i < 50; i++) hud.update(sim);
    expect(writesOf(all)).toBe(afterFirst);

    // A speed change that rounds to the same number writes nothing either.
    m.speed = 5.3;
    hud.update(sim);
    expect(writesOf(all)).toBe(afterFirst);

    // One shown value changes: only that element is written, once.
    m.speed = 9;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(afterFirst + 1);
    expect(parts.get('hud-speed')?.textContent).toBe('9 m/s');

    // The chain appearing writes its text once and no other.
    m.chain = 3;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(afterFirst + 2);
    expect(parts.get('hud-chain')?.hidden).toBe(false);
  });

  it('writes the run parts only when they change', () => {
    const { hud, parts, all, sim } = build(true);
    const w = sim.world;
    hud.update(sim);
    const base = writesOf(all);
    hud.update(sim);
    expect(writesOf(all)).toBe(base);

    // Still the same second, the same kill count, the same bar steps: nothing is written.
    w.run.ticks += 10;
    w.player.hp -= 0.1;
    w.player.xp += 0.001;
    hud.update(sim);
    expect(writesOf(all)).toBe(base);

    // A new second writes the clock once.
    w.run.ticks += 60;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(base + 1);
    expect(parts.get('hud-clock')?.textContent).toBe('0:01');

    // A kill writes the kills text once.
    w.player.kills = 4;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(base + 2);
    expect(parts.get('hud-kills')?.textContent).toBe('4 kills');
  });

  it('scales the bars and shows the level', () => {
    const { hud, all, parts, sim } = build(true);
    const p = sim.world.player;
    p.hp = 50;
    p.xp = 2;
    p.xpNext = 8;
    p.level = 3;
    hud.update(sim);
    const fills = all.filter((e) => e.className === 'hud-fill');
    expect(fills[0].style.transform).toBe('scaleX(0.5)');
    expect(fills[1].style.transform).toBe('scaleX(0.25)');
    expect(parts.get('hud-level')?.textContent).toBe('3');
  });

  it('turns the health bar to the warning colour under 30%', () => {
    const { hud, all, sim } = build(true);
    const hpFill = all.find((e) => e.className === 'hud-fill');
    if (!hpFill) throw new Error('no health bar');
    const p = sim.world.player;
    p.hp = 31;
    hud.update(sim);
    expect(hpFill.style.backgroundColor).toBe(hex(PALETTE.hp));
    p.hp = 29;
    hud.update(sim);
    expect(hpFill.style.backgroundColor).toBe(hex(PALETTE.hpLow));
    p.hp = 100;
    hud.update(sim);
    expect(hpFill.style.backgroundColor).toBe(hex(PALETTE.hp));
  });

  it('pulses the health bar when health drops and the XP bar on a level-up, not otherwise', () => {
    const { hud, parts, sim } = build(true);
    const p = sim.world.player;
    hud.update(sim);
    expect(parts.get('hud-hp')?.className).toBe('hud-hp');
    p.hp = 80;
    hud.update(sim);
    expect(parts.get('hud-hp')?.className).toContain('pulse-');
    expect(parts.get('hud-xp')?.className).toBe('hud-xp');
    p.level = 2;
    hud.update(sim);
    expect(parts.get('hud-xp')?.className).toContain('pulse-');
  });
});

describe('the run clock', () => {
  it('formats m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(180)).toBe('3:00');
  });

  it('counts up from 0:00 in whole seconds, and keeps counting past the final boss', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(59)).toBe('0:00');
    expect(clockText(60)).toBe('0:01');
    expect(clockText(180 * 60)).toBe('3:00');
    expect(clockText(540 * 60 - 1)).toBe('8:59');
    expect(clockText(540 * 60)).toBe('9:00');
    expect(clockText(725 * 60)).toBe('12:05');
  });
});

describe('the boss bar', () => {
  /** Put a boss of `kind` on the HUD's view of the world, at `hp`. */
  function setBoss(sim: Sim, kind: number, hp: number): void {
    const b = sim.world.boss;
    b.kind = kind;
    b.hp = hp;
    b.maxHp = kind >= 0 ? KINDS[kind].hp : 0;
  }

  it('is hidden with no boss, and shows the name and the health while one is up', () => {
    const { hud, parts, sim } = build(true);
    hud.update(sim);
    const bar = parts.get('hud-boss');
    const name = parts.get('hud-boss-name');
    const fill = parts.get('hud-boss-track')?.children[0];
    expect(bar?.hidden).toBe(true);
    setBoss(sim, KIND_BRUISER, KINDS[KIND_BRUISER].hp);
    hud.update(sim);
    expect(bar?.hidden).toBe(false);
    expect(name?.textContent).toBe('THE BRUISER');
    expect(fill?.style.transform).toBe('scaleX(1)');
    setBoss(sim, KIND_BRUISER, KINDS[KIND_BRUISER].hp / 4);
    hud.update(sim);
    expect(fill?.style.transform).toBe('scaleX(0.25)');
    setBoss(sim, -1, 0);
    hud.update(sim);
    expect(bar?.hidden).toBe(true);
  });

  it('names each boss', () => {
    expect([KIND_BRUISER, KIND_MORTAR, KIND_STANDSTILL].map(bossName)).toEqual(['THE BRUISER', 'THE MORTAR', 'THE STANDSTILL']);
  });

  it('shows the name across the screen when a boss arrives (its timing: bossBar.test.ts)', () => {
    const { hud, parts, sim } = build(true);
    const banner = parts.get('hud-boss-banner');
    hud.update(sim);
    expect(banner?.hidden).toBe(true);
    setBoss(sim, KIND_MORTAR, KINDS[KIND_MORTAR].hp);
    hud.update(sim);
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toBe('THE MORTAR');
  });

  it('writes only when the boss or its bar step changes', () => {
    const { hud, all, sim } = build(true);
    setBoss(sim, KIND_STANDSTILL, KINDS[KIND_STANDSTILL].hp);
    hud.update(sim);
    const base = writesOf(all);
    sim.world.boss.hp -= 1;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(base);
    sim.world.boss.hp = KINDS[KIND_STANDSTILL].hp / 2;
    hud.update(sim);
    hud.update(sim);
    expect(writesOf(all)).toBe(base + 1);
  });
});
