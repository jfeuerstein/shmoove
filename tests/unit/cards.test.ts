import { describe, expect, it } from 'vitest';
import {
  makeLoadout,
  P_HEART,
  P_WAX,
  PASSIVE_INFO,
  raisePassive,
  raiseWeapon,
  W_BUMPER,
  W_LANCE,
  W_SEEKERS,
  W_SLAM,
  W_WAKE,
  WEAPON_COUNT,
  WEAPON_INFO,
} from '../../src/sim/arsenal';
import {
  BOON_HEAL,
  BOON_INFO,
  BOON_MIGHT,
  BOON_REACH,
  BOON_TOKENS,
  BOON_VIGOUR,
  CARD_BOON,
  CARD_PASSIVE,
  CARD_WEAPON,
  makeOffer,
  OFFER_BOSS,
  OFFER_CRATE,
  OFFER_LEVEL,
  OFFER_SHRINE,
  OFFER_TOTEM,
  type Offer,
} from '../../src/sim/offer';
import { makeWorld, PHASE_CHOOSE, PHASE_PLAY } from '../../src/sim/world';
import { autoPickCard, Cards, describeCard, describeOffer, PICK_LOCK_SEC, sourceHeader } from '../../src/ui/cards';

function offerOf(source: number, cards: [number, number, number][]): Offer {
  const o = makeOffer();
  o.open = true;
  o.source = source;
  o.count = cards.length;
  cards.forEach(([type, id, by], i) => {
    o.type[i] = type;
    o.id[i] = id;
    o.by[i] = by;
  });
  return o;
}

describe('card text', () => {
  it('says NEW and the blurb for a weapon not carried, with what feeds it', () => {
    const c = describeCard(offerOf(OFFER_LEVEL, [[CARD_WEAPON, W_SLAM, 1]]), 0, makeLoadout());
    expect(c.kind).toBe('weapon');
    expect(c.code).toBe('SL');
    expect(c.name).toBe('Slam');
    expect(c.tag).toBe('NEW');
    expect(c.blurb).toBe(WEAPON_INFO[W_SLAM].blurb);
    expect(c.fedBy).toBe(WEAPON_INFO[W_SLAM].fedBy);
    expect(c.rare).toBe(false);
    expect(c.bonus).toBe('');
  });

  it('says Lv 2 > 3 for a level on something carried', () => {
    const l = makeLoadout();
    raiseWeapon(l, W_SEEKERS, 2);
    const c = describeCard(offerOf(OFFER_LEVEL, [[CARD_WEAPON, W_SEEKERS, 1]]), 0, l);
    expect(c.tag).toBe('Lv 2 > 3');
    expect(c.rare).toBe(false);
  });

  it('marks a rare card with +2 and the two levels it gives', () => {
    const l = makeLoadout();
    raiseWeapon(l, W_BUMPER, 1);
    const c = describeCard(offerOf(OFFER_LEVEL, [[CARD_WEAPON, W_BUMPER, 2]]), 0, l);
    expect(c.tag).toBe('Lv 1 > 3');
    expect(c.rare).toBe(true);
    expect(c.bonus).toBe('+2');
  });

  it('never promises more than level 5', () => {
    const l = makeLoadout();
    raiseWeapon(l, W_WAKE, 4);
    expect(describeCard(offerOf(OFFER_LEVEL, [[CARD_WEAPON, W_WAKE, 2]]), 0, l).tag).toBe('Lv 4 > 5');
  });

  it('a new rare weapon starts at level 2', () => {
    const c = describeCard(offerOf(OFFER_TOTEM, [[CARD_WEAPON, W_LANCE, 2]]), 0, makeLoadout());
    expect(c.tag).toBe('NEW  Lv 2');
    expect(c.rare).toBe(true);
  });

  it('words a passive: new, a level, and no fed-by print', () => {
    const l = makeLoadout();
    raisePassive(l, P_WAX, 1);
    const o = offerOf(OFFER_CRATE, [
      [CARD_PASSIVE, P_HEART, 1],
      [CARD_PASSIVE, P_WAX, 1],
    ]);
    const fresh = describeCard(o, 0, l);
    expect(fresh.kind).toBe('passive');
    expect(fresh.code).toBe(PASSIVE_INFO[P_HEART].code);
    expect(fresh.tag).toBe('NEW');
    expect(fresh.blurb).toBe(PASSIVE_INFO[P_HEART].blurb);
    expect(fresh.fedBy).toBe('');
    expect(describeCard(o, 1, l).tag).toBe('Lv 1 > 2');
  });

  it('words every boon from BOON_INFO', () => {
    for (const id of [BOON_HEAL, BOON_TOKENS, BOON_MIGHT, BOON_VIGOUR, BOON_REACH]) {
      const c = describeCard(offerOf(OFFER_SHRINE, [[CARD_BOON, id, 1]]), 0, makeLoadout());
      expect(c.kind).toBe('boon');
      expect(c.name).toBe(BOON_INFO[id].name);
      expect(c.blurb).toBe(BOON_INFO[id].blurb);
      expect(c.tag).toBe('BOON');
      expect(c.code).toHaveLength(2);
      expect(c.rare).toBe(false);
    }
  });

  it('has a card for every weapon the arsenal names', () => {
    for (let id = 0; id < WEAPON_COUNT; id++) {
      const c = describeCard(offerOf(OFFER_LEVEL, [[CARD_WEAPON, id, 1]]), 0, makeLoadout());
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      expect(c.code).toHaveLength(2);
    }
  });

  it('says where the offer came from', () => {
    expect(sourceHeader(OFFER_LEVEL)).toBe('LEVEL UP');
    expect(sourceHeader(OFFER_CRATE)).toBe('CRATE');
    expect(sourceHeader(OFFER_SHRINE)).toBe('SHRINE');
    expect(sourceHeader(OFFER_TOTEM)).toBe('TOTEM');
    expect(sourceHeader(OFFER_BOSS)).toBe('BOSS DOWN');
  });

  it('describes a whole offer in order, only as many cards as it has', () => {
    const t = describeOffer(
      offerOf(OFFER_TOTEM, [
        [CARD_WEAPON, W_SLAM, 2],
        [CARD_BOON, BOON_TOKENS, 1],
      ]),
      makeLoadout(),
    );
    expect(t.header).toBe('TOTEM');
    expect(t.cards.map((c) => c.name)).toEqual(['Slam', BOON_INFO[BOON_TOKENS].name]);
  });

  it('is a pure function of the offer and the loadout', () => {
    const o = offerOf(OFFER_LEVEL, [[CARD_WEAPON, W_BUMPER, 1]]);
    const l = makeLoadout();
    expect(describeOffer(o, l)).toEqual(describeOffer(o, l));
  });
});

describe('auto-pick policy', () => {
  function worldWith(cards: [number, number, number][]) {
    const w = makeWorld(1);
    const o = offerOf(OFFER_LEVEL, cards);
    w.offer.open = true;
    w.offer.count = o.count;
    for (let i = 0; i < o.count; i++) {
      w.offer.type[i] = o.type[i];
      w.offer.id[i] = o.id[i];
      w.offer.by[i] = o.by[i];
    }
    return w;
  }

  it('takes a new weapon if one is offered', () => {
    const w = worldWith([
      [CARD_PASSIVE, P_HEART, 1],
      [CARD_WEAPON, W_WAKE, 1],
      [CARD_WEAPON, W_SLAM, 1],
    ]);
    raiseWeapon(w.player.loadout, W_WAKE, 1);
    expect(autoPickCard(w)).toBe(2);
  });

  it('else the first weapon card', () => {
    const w = worldWith([
      [CARD_PASSIVE, P_HEART, 1],
      [CARD_WEAPON, W_SEEKERS, 1],
      [CARD_WEAPON, W_WAKE, 1],
    ]);
    raiseWeapon(w.player.loadout, W_WAKE, 1);
    raiseWeapon(w.player.loadout, W_SEEKERS, 1);
    expect(autoPickCard(w)).toBe(1);
  });

  it('else the first card', () => {
    const w = worldWith([
      [CARD_BOON, BOON_HEAL, 1],
      [CARD_BOON, BOON_TOKENS, 1],
    ]);
    expect(autoPickCard(w)).toBe(0);
  });
});

// ---- the DOM ---------------------------------------------------------------------------------

type Handler = (e: { stopPropagation(): void }) => void;

class FakeEl {
  className = '';
  hidden = false;
  textContent = '';
  readonly children: FakeEl[] = [];
  readonly handlers = new Map<string, Handler[]>();
  readonly style = { setProperty: (): void => undefined };
  setAttribute(): void {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  addEventListener(type: string, h: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(h);
    this.handlers.set(type, list);
  }
  click(): void {
    for (const h of this.handlers.get('click') ?? []) h({ stopPropagation: () => undefined });
  }
}

function build(): { cards: Cards; root: FakeEl; picks: number[]; buttons: FakeEl[] } {
  const doc = { createElement: () => new FakeEl() } as unknown as Document;
  const root = new FakeEl();
  const picks: number[] = [];
  const cards = new Cards(root as unknown as HTMLElement, (i) => picks.push(i), doc);
  const overlay = root.children[0];
  const buttons = overlay.children[0].children.slice(1);
  return { cards, root, picks, buttons };
}

function open(w: ReturnType<typeof makeWorld>, source: number, cards: [number, number, number][]): void {
  const o = offerOf(source, cards);
  w.offer.open = true;
  w.offer.source = source;
  w.offer.count = o.count;
  for (let i = 0; i < o.count; i++) {
    w.offer.type[i] = o.type[i];
    w.offer.id[i] = o.id[i];
    w.offer.by[i] = o.by[i];
  }
  w.run.phase = PHASE_CHOOSE;
}

describe('Cards overlay', () => {
  it('shows only while an offer is open and writes the text for each card', () => {
    const { cards, root, buttons } = build();
    const w = makeWorld(1);
    cards.update(w, 0.016);
    expect(root.children[0].className).toBe('cards');
    open(w, OFFER_CRATE, [
      [CARD_WEAPON, W_SLAM, 1],
      [CARD_PASSIVE, P_HEART, 2],
    ]);
    cards.update(w, 0.016);
    expect(cards.visible).toBe(true);
    expect(root.children[0].className).toContain('cards-show');
    expect(root.children[0].children[0].children[0].textContent).toBe('CRATE');
    expect(buttons[0].children[1].children[0].children[0].textContent).toBe('Slam');
    expect(buttons[1].className).toContain('card-rare');
    expect(buttons[2].hidden).toBe(true);
    w.run.phase = PHASE_PLAY;
    w.offer.open = false;
    cards.update(w, 0.016);
    expect(cards.visible).toBe(false);
    expect(root.children[0].className).toBe('cards');
  });

  it('sends the index of the card tapped, and ignores a second tap right after', () => {
    const { cards, picks, buttons } = build();
    const w = makeWorld(1);
    open(w, OFFER_LEVEL, [
      [CARD_WEAPON, W_SLAM, 1],
      [CARD_WEAPON, W_WAKE, 1],
      [CARD_BOON, BOON_HEAL, 1],
    ]);
    cards.update(w, 0.016);
    buttons[1].click();
    buttons[2].click();
    expect(picks).toEqual([1]);
    cards.update(w, PICK_LOCK_SEC + 0.01);
    buttons[2].click();
    expect(picks).toEqual([1, 2]);
  });

  it('ignores taps while nothing is offered', () => {
    const { picks, buttons } = build();
    buttons[0].click();
    expect(picks).toEqual([]);
  });

  it('writes nothing while the same offer stays up', () => {
    const { cards, buttons } = build();
    const w = makeWorld(1);
    open(w, OFFER_LEVEL, [[CARD_WEAPON, W_SLAM, 1]]);
    cards.update(w, 0.016);
    buttons[0].children[1].children[0].children[0].textContent = 'sentinel';
    cards.update(w, 0.016);
    expect(buttons[0].children[1].children[0].children[0].textContent).toBe('sentinel');
  });
});
