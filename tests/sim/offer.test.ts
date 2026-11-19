/** What a player would notice about the cards they are offered. */
import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  makeLoadout,
  P_HEART,
  P_WAX,
  PASSIVE_COUNT,
  raisePassive,
  raiseWeapon,
  SLOTS,
  W_BUMPER,
  W_ORBIT,
  W_SEEKERS,
  W_SLAM,
  W_WAKE,
  WEAPON_COUNT,
  type Loadout,
} from '../../src/sim/arsenal';
import {
  BOON_HEAL,
  CARD_BOON,
  CARD_WEAPON,
  makeOffer,
  OFFER_LEVEL,
  OFFER_TOTEM,
  rollOffer,
  takeCard,
} from '../../src/sim/offer';
import { Rng } from '../../src/sim/rng';
import { BUMPER, makeStats, recomputeStats } from '../../src/sim/stats';

const ALL = new Uint8Array(WEAPON_COUNT).fill(1);

function starter(): Loadout {
  const l = makeLoadout();
  raiseWeapon(l, W_WAKE);
  return l;
}

function key(type: number, id: number): number {
  return type * 100 + id;
}

describe('an offer', () => {
  it('is three different cards', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const o = makeOffer();
      rollOffer(o, starter(), ALL, 0, new Rng(seed), OFFER_LEVEL);
      expect(o.open).toBe(true);
      expect(o.count).toBe(3);
      const seen = new Set([0, 1, 2].map((k) => key(o.type[k], o.id[k])));
      expect(seen.size).toBe(3);
    }
  });

  it('always shows a new weapon to a player who carries only one', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const o = makeOffer();
      const l = starter();
      rollOffer(o, l, ALL, 0, new Rng(seed), OFFER_LEVEL);
      const fresh = [0, 1, 2].filter((k) => o.type[k] === CARD_WEAPON && l.weaponLevel[o.id[k]] === 0);
      expect(fresh.length).toBeGreaterThan(0);
    }
  });

  it('only offers weapons from the pool', () => {
    const pool = new Uint8Array(WEAPON_COUNT);
    pool[W_WAKE] = 1;
    pool[W_SEEKERS] = 1;
    for (let seed = 1; seed <= 200; seed++) {
      const o = makeOffer();
      rollOffer(o, starter(), pool, 0, new Rng(seed), OFFER_LEVEL);
      for (let k = 0; k < o.count; k++) {
        if (o.type[k] === CARD_WEAPON) expect([W_WAKE, W_SEEKERS]).toContain(o.id[k]);
      }
    }
  });

  it('never offers a fifth weapon or a level past the top', () => {
    const l = makeLoadout();
    for (const id of [W_WAKE, W_SEEKERS, W_BUMPER, W_SLAM]) raiseWeapon(l, id, MAX_LEVEL);
    raiseWeapon(l, W_WAKE, 0);
    l.weaponLevel[W_SLAM] = 3;
    for (let seed = 1; seed <= 200; seed++) {
      const o = makeOffer();
      rollOffer(o, l, ALL, 0, new Rng(seed), OFFER_LEVEL);
      for (let k = 0; k < o.count; k++) {
        if (o.type[k] !== CARD_WEAPON) continue;
        expect(o.id[k]).toBe(W_SLAM);
        expect(l.weaponLevel[W_SLAM] + o.by[k]).toBeLessThanOrEqual(MAX_LEVEL);
      }
    }
  });

  it('turns to boons when the build is full', () => {
    const l = makeLoadout();
    for (const id of [W_WAKE, W_SEEKERS, W_BUMPER, W_SLAM]) raiseWeapon(l, id, MAX_LEVEL);
    for (let id = 0; id < SLOTS; id++) raisePassive(l, id, MAX_LEVEL);
    const o = makeOffer();
    rollOffer(o, l, ALL, 0, new Rng(3), OFFER_LEVEL);
    expect(o.count).toBeGreaterThanOrEqual(1);
    for (let k = 0; k < o.count; k++) expect(o.type[k]).toBe(CARD_BOON);
    expect(o.id[0]).toBe(BOON_HEAL);
  });

  it('is rare more often with luck, and always from a totem', () => {
    const rares = (luck: number, source: number, rareOnly: boolean): number => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const o = makeOffer();
        rollOffer(o, starter(), ALL, luck, new Rng(seed), source, rareOnly);
        for (let k = 0; k < o.count; k++) if (o.by[k] === 2) n++;
      }
      return n;
    };
    const plain = rares(0, OFFER_LEVEL, false);
    expect(plain).toBeGreaterThan(20);
    expect(plain).toBeLessThan(160);
    expect(rares(0.5, OFFER_LEVEL, false)).toBeGreaterThan(plain * 2.5);
    expect(rares(0, OFFER_TOTEM, true)).toBe(1200);
  });

  it('is the same for the same seed', () => {
    const roll = (): string => {
      const o = makeOffer();
      rollOffer(o, starter(), ALL, 0.2, new Rng(99), OFFER_LEVEL);
      return [0, 1, 2].map((k) => `${o.type[k]}:${o.id[k]}:${o.by[k]}`).join(',');
    };
    expect(roll()).toBe(roll());
  });
});

describe('taking a card', () => {
  it('adds the weapon or level and closes the offer', () => {
    const l = starter();
    const o = makeOffer();
    rollOffer(o, l, ALL, 0, new Rng(5), OFFER_LEVEL);
    const k = [0, 1, 2].find((i) => o.type[i] === CARD_WEAPON && l.weaponLevel[o.id[i]] === 0) ?? 0;
    const id = o.id[k];
    const by = o.by[k];
    expect(takeCard(o, k, l)).toBe(CARD_WEAPON);
    expect(l.weaponLevel[id]).toBe(by);
    expect(Array.from(l.weapons)).toContain(id);
    expect(o.open).toBe(false);
    // And it cannot be taken twice.
    expect(takeCard(o, k, l)).toBe(-1);
    expect(l.weaponLevel[id]).toBe(by);
  });

  it('ignores a choice that is not on the table', () => {
    const l = starter();
    const o = makeOffer();
    rollOffer(o, l, ALL, 0, new Rng(5), OFFER_LEVEL);
    expect(takeCard(o, 3, l)).toBe(-1);
    expect(takeCard(o, -1, l)).toBe(-1);
    expect(o.open).toBe(true);
  });
});

describe('the build', () => {
  it('holds four weapons and four passives', () => {
    const l = makeLoadout();
    let taken = 0;
    for (let id = 0; id < WEAPON_COUNT; id++) if (raiseWeapon(l, id)) taken++;
    expect(taken).toBe(SLOTS);
    taken = 0;
    for (let id = 0; id < PASSIVE_COUNT; id++) if (raisePassive(l, id)) taken++;
    expect(taken).toBe(SLOTS);
    // What is carried can still go up.
    expect(raiseWeapon(l, W_WAKE)).toBe(true);
    expect(raiseWeapon(l, W_ORBIT)).toBe(false);
  });

  it('turns passives and the Bumper into stats', () => {
    const l = starter();
    const st = makeStats();
    recomputeStats(st, l);
    expect(st.maxHp).toBe(100);
    expect(st.drag).toBe(1);
    expect(st.thorns).toBe(0);

    raisePassive(l, P_HEART, 2);
    raisePassive(l, P_WAX, 1);
    raiseWeapon(l, W_BUMPER, 3);
    recomputeStats(st, l);
    expect(st.maxHp).toBe(140);
    expect(st.drag).toBeLessThan(1);
    expect(st.thorns).toBe(BUMPER.thorns[2]);

    // Recomputing is not cumulative.
    recomputeStats(st, l);
    expect(st.maxHp).toBe(140);
  });
});
