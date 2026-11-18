import { describe, expect, it } from 'vitest';
import { flatTerrain } from '../../src/sim/terrain';
import { Sim } from '../../src/sim/sim';
import { Hud } from '../../src/ui/hud';

/** An element that counts the writes the HUD makes to it. */
class FakeEl {
  className = '';
  hidden = false;
  writes = 0;
  readonly children: FakeEl[] = [];
  readonly style = { color: '' };
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

function build(): { hud: Hud; texts: Map<string, FakeEl>; sim: Sim } {
  const texts = new Map<string, FakeEl>();
  const doc = {
    createElement: () => new FakeEl(),
  } as unknown as Document;
  const root = new FakeEl();
  const hud = new Hud(root as unknown as HTMLElement, doc);
  for (const c of (root.children[0] as FakeEl).children) texts.set(c.className, c);
  return { hud, texts, sim: new Sim(flatTerrain(170)) };
}

const writesOf = (texts: Map<string, FakeEl>): number => [...texts.values()].reduce((n, e) => n + e.writes, 0);

describe('Hud', () => {
  it('shows the gear and the speed', () => {
    const { hud, texts, sim } = build();
    sim.state.mover.gear = 2;
    sim.state.mover.speed = 12.4;
    hud.update(sim.state);
    expect(texts.get('hud-gear')?.textContent).toBe('2');
    expect(texts.get('hud-speed')?.textContent).toBe('12 m/s');
  });

  it('writes text only when a shown value changes', () => {
    const { hud, texts, sim } = build();
    const m = sim.state.mover;
    m.gear = 1;
    m.speed = 5;
    m.chain = 0;
    hud.update(sim.state);
    const afterFirst = writesOf(texts);
    expect(afterFirst).toBeGreaterThan(0);

    for (let i = 0; i < 50; i++) hud.update(sim.state);
    expect(writesOf(texts)).toBe(afterFirst);

    // A speed change that rounds to the same number writes nothing either.
    m.speed = 5.3;
    hud.update(sim.state);
    expect(writesOf(texts)).toBe(afterFirst);

    // One shown value changes: only that element is written, once.
    m.speed = 9;
    hud.update(sim.state);
    hud.update(sim.state);
    expect(writesOf(texts)).toBe(afterFirst + 1);
    expect(texts.get('hud-speed')?.textContent).toBe('9 m/s');

    // The chain appearing writes its text once and no other.
    m.chain = 3;
    hud.update(sim.state);
    hud.update(sim.state);
    expect(writesOf(texts)).toBe(afterFirst + 2);
    expect(texts.get('hud-chain')?.hidden).toBe(false);
  });
});
