import { describe, expect, it } from 'vitest';
import { POSTCARD_KITS, TILE_DECKS, buildCatalog } from '../../../src/sim/game/finds';
import { addPickup, addZone, createWorld, finalizeWorld } from '../../../src/sim/world';
import { findsTicket, runTime, sourceOf, sourceText, swatchCss, tierCount, tileCounter } from '../../../src/ui/findsFormat';

describe('finds text', () => {
  it('the counter, tier counts (hidden only as ?) and run times', () => {
    expect(tileCounter(14, 60)).toBe('TILE 14/60');
    expect(tierCount(0, 3, 10)).toBe('3/10');
    expect(tierCount(1, 0, 6)).toBe('0/6');
    expect(tierCount(2, 1, 10)).toBe('1/?');
    expect(runTime(744)).toBe('12.4 s');
    expect(runTime(60 * 75)).toBe('1:15');
  });

  it('tickets for each finds event, none for others', () => {
    expect(findsTicket({ type: 'tile', index: 3, tier: 0, district: 1, count: 14, total: 60 })).toMatchObject({ kind: 'tile', title: 'TILE 14/60' });
    expect(findsTicket({ type: 'spot', id: 'g', name: 'Salto de los Gatos' })).toMatchObject({ kind: 'spot', stamp: 'SALTO DE LOS GATOS' });
    expect(findsTicket({ type: 'unlock', id: 'deck.mangoCheck', slot: 'deck', name: 'Mango Check' })).toMatchObject({ kind: 'unlock', title: 'New deck', body: 'Mango Check' });
    expect(findsTicket({ type: 'postcard', id: 't', name: 'Torre' })).toMatchObject({ kind: 'postcard', body: 'Torre' });
    expect(findsTicket({ type: 'bestRun', name: 'La Bajada', ticks: 300, first: false })?.body).toBe('La Bajada · 5.0 s');
    expect(findsTicket({ type: 'mapComplete' })).toBeNull();
  });

  it('says how each item is earned and draws a swatch for each', () => {
    const w = createWorld({ seed: 1, minX: 0, minZ: 0, cell: 4, nx: 10, nz: 10 });
    finalizeWorld(w);
    for (let i = 0; i < 60; i++) addPickup(w, 'tile', 2 + (i % 8) * 4, 1, 2 + Math.floor(i / 8) * 4, i % 3);
    addZone(w, { id: 'torre', name: 'Torre del Reloj', kind: 'landmark', x: 20, y: 0, z: 20, r: 5 });
    addZone(w, { id: 's1', name: 'Gap', kind: 'spot', x: 10, y: 0, z: 10, r: 3 });
    const c = buildCatalog(w);
    expect(sourceText(sourceOf(c, TILE_DECKS[1].id), c)).toBe('15 tiles');
    expect(sourceText(sourceOf(c, TILE_DECKS[4].id), c)).toBe('All 60 tiles');
    expect(sourceText(sourceOf(c, POSTCARD_KITS[0].id), c)).toBe('Postcard: Torre del Reloj');
    expect(sourceText(sourceOf(c, 'deck.brickBands'), c)).toBe('All spots: Docks');
    expect(sourceText(sourceOf(c, 'deck.street'), c)).toBe('From the start');
    for (const u of c.unlocks) expect(swatchCss(u.item)).toMatch(/gradient/);
  });
});
