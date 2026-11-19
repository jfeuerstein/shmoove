import { Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { addThing, HOOP_TAKEN } from '../../src/sim/things';
import {
  makeWorld,
  PHASE_CHOOSE,
  PHASE_DEAD,
  PHASE_PLAY,
  THING_CRATE,
  THING_DONE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  type World,
} from '../../src/sim/world';
import {
  LABEL_BOTTOM,
  LABEL_H,
  LABEL_MAX,
  LABEL_RANGE,
  LABEL_TOP,
  labelOf,
  makeLabelPicks,
  pickLabels,
  ThingLabels,
  type LabelView,
} from '../../src/ui/thingLabels';

const W = 390;
const H = 844;

/** The chase view: behind and above a rider at the origin facing +z, looking a little ahead of it. */
function chaseView(): { view: LabelView; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(62, W / H, 0.1, 600);
  camera.position.set(0, 5.5, -9);
  camera.lookAt(0, 1, 8);
  camera.updateMatrixWorld();
  const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { view: { mx: 0, my: 0, mz: 0, viewProj: vp.elements, width: W, height: H }, camera };
}

function text(w: World, i: number): string | null {
  return labelOf(w, i)?.text ?? null;
}

function shown(w: World, view: LabelView): { things: number[]; texts: string[]; ys: number[] } {
  const out = makeLabelPicks();
  pickLabels(w, view, out);
  const things: number[] = [];
  const texts: string[] = [];
  const ys: number[] = [];
  for (let k = 0; k < out.count; k++) {
    things.push(out.thing[k]);
    texts.push(out.label[k]?.text ?? '');
    ys.push(out.y[k]);
  }
  return { things, texts, ys };
}

describe('what a label says', () => {
  it('names each live thing and, in a few words, what to do with it', () => {
    const w = makeWorld(1);
    const crate = addThing(w, THING_CRATE, 0, 0, 10, 0, 0);
    const gold = addThing(w, THING_GOLD_CRATE, 0, 0, 12, 0, 0);
    const shrine = addThing(w, THING_SHRINE, 0, 0, 14, 0, 0);
    const hoop = addThing(w, THING_HOOP, 0, 2, 16, 0, 0);
    const totem = addThing(w, THING_TOTEM, 0, 0, 18, 0, 0);
    expect(text(w, crate)).toBe('CRATE');
    expect(text(w, gold)).toBe('GOLD CRATE');
    expect(text(w, shrine)).toBe('SHRINE · ride in');
    expect(text(w, hoop)).toBe('HOOP · jump through');
    expect(text(w, totem)).toBe('TOTEM · calls elites');
    // Spent, or a hoop not back yet: nothing.
    for (const i of [crate, gold, shrine, totem]) w.things.state[i] = THING_DONE;
    w.things.state[hoop] = HOOP_TAKEN;
    for (const i of [crate, gold, shrine, hoop, totem]) expect(text(w, i)).toBeNull();
  });

  it('counts a slalom over its next gate only: GATES 2/5, and nothing once it is done', () => {
    const w = makeWorld(1);
    // Another slalom first, so places are counted within the group.
    for (let k = 0; k < 5; k++) addThing(w, THING_GATE, 50, 0, 18 * k, 0, 1);
    const first = w.things.count;
    for (let k = 0; k < 5; k++) addThing(w, THING_GATE, 0, 0, 18 * k, 0, 2);
    const texts = (): (string | null)[] => [0, 1, 2, 3, 4].map((k) => text(w, first + k));
    expect(texts()).toEqual(['GATES 0/5', null, null, null, null]);
    for (let k = 0; k < 5; k++) w.things.state[first + k] = 2;
    expect(texts()).toEqual([null, null, 'GATES 2/5', null, null]);
    expect(text(w, 0)).toBe('GATES 0/5');
    for (let k = 0; k < 5; k++) w.things.state[first + k] = THING_DONE;
    expect(texts()).toEqual([null, null, null, null, null]);
  });
});

describe('which labels show', () => {
  it('shows a thing ahead within range and in frame, and not one further than 35 m or behind the rider', () => {
    const { view } = chaseView();
    const w = makeWorld(1);
    const near = addThing(w, THING_SHRINE, 3, 0, 20, 0, 0);
    addThing(w, THING_TOTEM, -3, 0, LABEL_RANGE + 4, 0, 0);
    addThing(w, THING_GOLD_CRATE, 0, 0, -20, 0, 0);
    // Off to the side, out of frame though near.
    addThing(w, THING_CRATE, 30, 0, 8, 0, 0);
    expect(shown(w, view).things).toEqual([near]);
    expect(shown(w, view).texts).toEqual(['SHRINE · ride in']);
  });

  it('shows at most three, the nearest first', () => {
    const { view } = chaseView();
    const w = makeWorld(1);
    // Five crates spread so that no two of the nearest tags would overlap, added out of order.
    const spots = [
      [-7, 28],
      [0, 14],
      [8, 22],
      [-4, 9],
      [0, 34],
    ];
    const ids = spots.map(([x, z]) => addThing(w, THING_CRATE, x, 0, z, 0, 0));
    const s = shown(w, view);
    expect(LABEL_MAX).toBe(3);
    expect(s.things).toEqual([ids[3], ids[1], ids[2]]);
  });

  it('shows none while a card is up, after the run, or when there is nothing near', () => {
    const { view } = chaseView();
    const w = makeWorld(1);
    addThing(w, THING_SHRINE, 3, 0, 20, 0, 0);
    expect(shown(w, view).things).toHaveLength(1);
    for (const phase of [PHASE_CHOOSE, PHASE_DEAD]) {
      w.run.phase = phase;
      expect(shown(w, view).things).toHaveLength(0);
    }
    w.run.phase = PHASE_PLAY;
    expect(shown(w, { ...view, mz: 200 }).things).toHaveLength(0);
  });

  it('never puts a label over the rider, the top HUD or the build bar', () => {
    const { view } = chaseView();
    // Right where the rider stands: its tag would be over the rider.
    const w = makeWorld(1);
    addThing(w, THING_CRATE, 0, 0, 1, 0, 0);
    expect(shown(w, view).things).toHaveLength(0);
    // High on a hill far ahead: its tag would be under the HUD.
    const hill = makeWorld(1);
    addThing(hill, THING_TOTEM, 0, 30, 30, 0, 0);
    expect(shown(hill, view).things).toHaveLength(0);
    // A field of things all round: whatever shows stays clear of the top and the bottom.
    const field = makeWorld(1);
    for (let x = -20; x <= 20; x += 5) for (let z = -6; z <= 34; z += 4) addThing(field, THING_SHRINE, x, 0, z, 0, 0);
    const out = makeLabelPicks();
    pickLabels(field, view, out);
    expect(out.count).toBeGreaterThan(0);
    for (let k = 0; k < out.count; k++) {
      expect(out.y[k] - LABEL_H).toBeGreaterThanOrEqual(LABEL_TOP);
      expect(out.y[k]).toBeLessThanOrEqual(H - LABEL_BOTTOM);
    }
  });

  it('keeps labels off one another', () => {
    const { view } = chaseView();
    const w = makeWorld(1);
    // Two side by side at the same distance: their tags would overlap, so only one shows.
    addThing(w, THING_SHRINE, 0.5, 0, 20, 0, 0);
    addThing(w, THING_TOTEM, -0.5, 0, 20.2, 0, 0);
    expect(shown(w, view).things).toHaveLength(1);
  });
});

/** Just enough of an element for the pool, counting what is written. */
class FakeEl {
  className = '';
  hidden = false;
  writes = 0;
  private text = '';
  readonly children: FakeEl[] = [];
  readonly style: { transform: string; setProperty: (k: string, v: string) => void } = { transform: '', setProperty: () => undefined };
  constructor() {
    let t = '';
    Object.defineProperty(this.style, 'transform', {
      get: () => t,
      set: (v: string) => {
        t = v;
        this.writes++;
      },
    });
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
    this.writes++;
  }
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
}

describe('ThingLabels', () => {
  function build(): { labels: ThingLabels; tags: FakeEl[]; made: () => number } {
    let made = 0;
    const doc = {
      createElement: () => {
        made++;
        return new FakeEl();
      },
    } as unknown as Document;
    const root = new FakeEl();
    const labels = new ThingLabels(root as unknown as HTMLElement, doc);
    return { labels, tags: root.children[0].children, made: () => made };
  }

  it('fills a fixed pool, writes nothing that has not changed, and hides what is gone', () => {
    const { view, camera } = chaseView();
    const { labels, tags, made } = build();
    const w = makeWorld(1);
    const s = addThing(w, THING_SHRINE, 3, 0, 20, 0, 0);
    addThing(w, THING_GOLD_CRATE, -4, 0, 12, 0, 0);
    labels.apply(w, view);
    expect(labels.active).toBe(2);
    const built = made();
    const visible = tags.filter((t) => !t.hidden);
    expect(visible.map((t) => `${t.children[0].textContent}|${t.children[1].textContent}`).sort()).toEqual(['GOLD CRATE|', 'SHRINE|ride in']);
    const writes = tags.reduce((n, t) => n + t.writes + t.children[0].writes + t.children[1].writes, 0);
    // The same frame again: not one write, not one new element.
    labels.apply(w, view);
    expect(tags.reduce((n, t) => n + t.writes + t.children[0].writes + t.children[1].writes, 0)).toBe(writes);
    expect(made()).toBe(built);
    // The shrine is spent: its tag goes.
    w.things.state[s] = THING_DONE;
    labels.apply(w, view);
    expect(labels.active).toBe(1);
    expect(tags.filter((t) => !t.hidden)).toHaveLength(1);
    // Through the camera, the same as the frame worked out by hand.
    w.things.state[s] = 0;
    labels.update(w, camera, 0, 0, 0, W, H);
    expect(labels.active).toBe(2);
    // A card opens: all hidden.
    w.run.phase = PHASE_CHOOSE;
    labels.apply(w, view);
    expect(labels.active).toBe(0);
    expect(tags.every((t) => t.hidden)).toBe(true);
  });
});
