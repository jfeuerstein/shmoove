import { describe, expect, it } from 'vitest';
import { BANNER_SECONDS, BossBar, bannerShown } from '../../src/ui/bossBar';
import { KIND_BRUISER, KIND_STANDSTILL, KINDS, makeWorld, PHASE_CHOOSE, PHASE_DEAD, PHASE_PLAY, PHASE_WON, type World } from '../../src/sim/world';

class FakeEl {
  className = '';
  hidden = false;
  textContent = '';
  readonly children: FakeEl[] = [];
  readonly style: Record<string, string> = {};
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

function build(): { bar: BossBar; w: World; clock: { t: number } } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const clock = { t: 100 };
  const bar = new BossBar(doc, new FakeEl() as unknown as HTMLElement, () => clock.t);
  return { bar, w: makeWorld(1), clock };
}

function arrive(w: World, kind: number): void {
  w.boss.kind = kind;
  w.boss.hp = KINDS[kind].hp;
  w.boss.maxHp = KINDS[kind].hp;
}

describe('bannerShown', () => {
  it('shows for two real seconds after a boss arrives, while the run is played', () => {
    expect(bannerShown(KIND_BRUISER, 0, PHASE_PLAY)).toBe(true);
    expect(bannerShown(KIND_BRUISER, BANNER_SECONDS - 0.01, PHASE_PLAY)).toBe(true);
    expect(bannerShown(KIND_BRUISER, BANNER_SECONDS, PHASE_PLAY)).toBe(false);
    expect(bannerShown(-1, 0.5, PHASE_PLAY)).toBe(false);
  });

  it('is hidden when the run is over and while cards are open', () => {
    for (const phase of [PHASE_DEAD, PHASE_WON, PHASE_CHOOSE]) expect(bannerShown(KIND_BRUISER, 0.5, phase)).toBe(false);
  });
});

describe('BossBar', () => {
  it('times the name by real time, not by how far the world moved', () => {
    const { bar, w, clock } = build();
    bar.update(w);
    expect(bar.banner.hidden).toBe(true);
    arrive(w, KIND_STANDSTILL);
    bar.update(w);
    expect(bar.banner.hidden).toBe(false);
    expect(bar.banner.textContent).toBe('THE STANDSTILL');
    // The world can stand still: only the clock matters.
    clock.t += BANNER_SECONDS - 0.05;
    bar.update(w);
    expect(bar.banner.hidden).toBe(false);
    clock.t += 0.1;
    bar.update(w);
    expect(bar.banner.hidden).toBe(true);
    expect(bar.bar.hidden).toBe(false);
  });

  it('hides the name at once when the rider dies just after an arrival, and behind cards', () => {
    const { bar, w, clock } = build();
    arrive(w, KIND_BRUISER);
    bar.update(w);
    expect(bar.banner.hidden).toBe(false);
    w.run.phase = PHASE_CHOOSE;
    clock.t += 0.2;
    bar.update(w);
    expect(bar.banner.hidden).toBe(true);
    w.run.phase = PHASE_PLAY;
    bar.update(w);
    expect(bar.banner.hidden).toBe(false);
    w.run.phase = PHASE_DEAD;
    clock.t += 0.2;
    bar.update(w);
    expect(bar.banner.hidden).toBe(true);
    // And it stays down on the end card, however long it is up.
    for (let k = 0; k < 10; k++) {
      clock.t += 0.01;
      bar.update(w);
      expect(bar.banner.hidden).toBe(true);
    }
  });
});
