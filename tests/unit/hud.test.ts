import { describe, expect, it } from 'vitest';
import { PALETTE } from '../../src/render/look';
import { RUN_TICKS } from '../../src/sim/balance';
import { Sim } from '../../src/sim/sim';
import { flatTerrain } from '../../src/sim/terrain';
import { clockText, formatTime, Hud } from '../../src/ui/hud';

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
  it('shows the gear and the speed', () => {
    const { hud, parts, sim } = build(false);
    sim.state.mover.gear = 2;
    sim.state.mover.speed = 12.4;
    hud.update(sim);
    expect(parts.get('hud-gear')?.textContent).toBe('2');
    expect(parts.get('hud-speed')?.textContent).toBe('12 m/s');
  });

  it('has none of the run parts without a run', () => {
    const { parts } = build(false);
    for (const k of ['hud-clock', 'hud-kills', 'hud-hp', 'hud-xp', 'hud-level']) expect(parts.has(k)).toBe(false);
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
    expect(parts.get('hud-clock')?.textContent).toBe('2:59');

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

  it('counts down from the full run, rounding up', () => {
    expect(clockText(0)).toBe('3:00');
    expect(clockText(1)).toBe('3:00');
    expect(clockText(60)).toBe('2:59');
    expect(clockText(RUN_TICKS - 61)).toBe('0:02');
    expect(clockText(RUN_TICKS - 1)).toBe('0:01');
    expect(clockText(RUN_TICKS)).toBe('0:00');
  });
});
