import type { InstancedBufferAttribute, InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { LOB_INNER, lobFill, MINE_BLINK_TICKS, MINE_IDLE, MINE_OFF, MINE_ON, MINE_SIZE, mineStrength, RING_BAND, ZonesView } from '../../src/render/zonesView';
import { PALETTE } from '../../src/render/look';
import { BOSS } from '../../src/sim/bosses';
import { DT } from '../../src/sim/constants';
import { terrainFromHeight } from '../../src/sim/terrain';
import { CRUMBS } from '../../src/sim/weapons/crumbs';
import { addZone, makeWorld, removeZone, ZONE_LOB, ZONE_MINE, ZONE_RING, ZONE_TAR } from '../../src/sim/world';

function matrix(mesh: InstancedMesh, n: number): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(n * 16, n * 16 + 16));
}

function disc(mesh: InstancedMesh, n: number): number[] {
  const a = mesh.geometry.getAttribute('aDisc') as InstancedBufferAttribute;
  return [a.getX(n), a.getY(n), a.getZ(n)];
}

describe('ZonesView', () => {
  it('draws each kind of zone in its own mesh, at its place and size', () => {
    const w = makeWorld(1);
    addZone(w, ZONE_MINE, 1, 0.5, 2, 3.6, 600, 40);
    addZone(w, ZONE_TAR, -4, 0.2, 6, 1.1, 600, 1.2);
    addZone(w, ZONE_LOB, 8, 1, -3, 1.2, 66, 12);
    addZone(w, ZONE_TAR, 10, 0, 10, 1.1, 600, 1.2);
    w.zones.age.fill(40);
    const view = new ZonesView();
    view.update(w);
    expect(view.mines.count).toBe(1);
    expect(view.tar.count).toBe(2);
    expect(view.lobs.count).toBe(1);
    expect(view.mines.visible && view.tar.visible && view.lobs.visible).toBe(true);

    // A mine is a small disc where it lies, not as wide as its blast.
    const m = matrix(view.mines, 0);
    expect(m[0]).toBeCloseTo(MINE_SIZE, 5);
    expect(m[10]).toBeCloseTo(MINE_SIZE, 5);
    expect(m[12]).toBeCloseTo(1, 5);
    expect(m[13]).toBeGreaterThan(0.5);
    expect(m[14]).toBeCloseTo(2, 5);
    // Tar is as wide as it drags.
    const t = matrix(view.tar, 0);
    expect(t[0]).toBeCloseTo(1.1, 5);
    expect([t[12], t[14]]).toEqual([-4, 6]);
    // The lob ring is as wide as where the shot lands.
    const l = matrix(view.lobs, 0);
    expect(l[0]).toBeCloseTo(1.2, 5);
    expect([l[12], l[14]]).toEqual([8, -3]);
  });

  it('dims a mine while it arms and blinks it once armed', () => {
    expect(mineStrength(0)).toBe(MINE_IDLE);
    expect(mineStrength(CRUMBS.armTicks - 1)).toBe(MINE_IDLE);
    expect(mineStrength(CRUMBS.armTicks)).toBe(MINE_ON);
    expect(mineStrength(CRUMBS.armTicks + MINE_BLINK_TICKS)).toBe(MINE_OFF);
    expect(mineStrength(CRUMBS.armTicks + 2 * MINE_BLINK_TICKS)).toBe(MINE_ON);
    const w = makeWorld(1);
    addZone(w, ZONE_MINE, 0, 0, 0, 3, 600, 30);
    const view = new ZonesView();
    const seen = new Set<number>();
    for (let age = CRUMBS.armTicks; age < CRUMBS.armTicks + 4 * MINE_BLINK_TICKS; age++) {
      w.zones.age[0] = age;
      view.update(w);
      seen.add(Math.round(disc(view.mines, 0)[2] * 1000) / 1000);
    }
    expect([...seen].sort()).toEqual([MINE_OFF, MINE_ON].sort());
  });

  it('fills a lob ring from the middle as its time runs out: full the tick it lands', () => {
    const w = makeWorld(1);
    addZone(w, ZONE_LOB, 0, 0, 0, 1.2, 66, 12);
    const view = new ZonesView();
    const cores: number[] = [];
    for (let age = 0; age <= 66; age += 11) {
      w.zones.age[0] = age;
      w.zones.life[0] = 66 - age;
      view.update(w);
      const [inner, core, fade] = disc(view.lobs, 0);
      expect(inner).toBeCloseTo(LOB_INNER, 6);
      expect(fade).toBeGreaterThan(0.5);
      cores.push(core);
    }
    expect(cores[0]).toBe(0);
    for (let k = 1; k < cores.length; k++) expect(cores[k]).toBeGreaterThan(cores[k - 1]);
    expect(cores[cores.length - 1]).toBeCloseTo(LOB_INNER, 6);
    expect(lobFill(33, 33)).toBeCloseTo(0.5, 9);
    expect(lobFill(0, 0)).toBe(1);
  });

  it('spreads tar when it is laid and shrinks it away at the end', () => {
    const w = makeWorld(1);
    addZone(w, ZONE_TAR, 0, 0, 0, 1.1, 600, 1.2);
    const view = new ZonesView();
    const r = (age: number, life: number): number => {
      w.zones.age[0] = age;
      w.zones.life[0] = life;
      view.update(w);
      return matrix(view.tar, 0)[0];
    };
    expect(r(0, 600)).toBe(0);
    expect(r(6, 594)).toBeGreaterThan(0.2);
    expect(r(100, 500)).toBeCloseTo(1.1, 5);
    expect(r(590, 10)).toBeLessThan(0.5);
  });

  it('lays each disc flat on the slope under it', () => {
    // A plane rising 0.3 m per m along x.
    const terrain = terrainFromHeight((x) => 0.3 * x, 100);
    const w = makeWorld(1);
    addZone(w, ZONE_TAR, 5, 1.5, 0, 1, 600, 1.2);
    w.zones.age[0] = 100;
    const view = new ZonesView(terrain);
    view.update(w);
    const m = matrix(view.tar, 0);
    // The disc's up axis is the ground's normal; its x axis climbs with the slope.
    const n = Math.hypot(0.3, 1);
    expect(m[4]).toBeCloseTo(-0.3 / n, 3);
    expect(m[5]).toBeCloseTo(1 / n, 3);
    expect(m[1] / m[0]).toBeCloseTo(0.3, 3);
  });

  it('follows the pool as zones come and go', () => {
    const w = makeWorld(1);
    for (let k = 0; k < 9; k++) addZone(w, k % 3, k, 0, 0, 1, 600, 1);
    const view = new ZonesView();
    view.update(w);
    expect([view.mines.count, view.tar.count, view.lobs.count]).toEqual([3, 3, 3]);
    for (let i = w.zones.count - 1; i >= 0; i--) if (w.zones.kind[i] === ZONE_TAR) removeZone(w, i);
    view.update(w);
    expect([view.mines.count, view.tar.count, view.lobs.count]).toEqual([3, 0, 3]);
    expect(view.tar.visible).toBe(false);
    w.zones.count = 0;
    view.update(w);
    expect(view.mines.visible || view.tar.visible || view.lobs.visible).toBe(false);
    for (const mesh of [view.mines, view.tar, view.lobs]) expect(mesh.frustumCulled).toBe(false);
  });
});

describe("the Standstill's ring", () => {
  /** Distances from (cx, cz) of every point of ring slot 0, inner and outer edges apart. */
  function radii(view: ZonesView, cx: number, cz: number): { inner: number[]; outer: number[]; ys: number[] } {
    const r = view.rings;
    const inner: number[] = [];
    const outer: number[] = [];
    const ys: number[] = [];
    for (let v = 0; v < (r.segments + 1) * 2; v++) {
      const d = Math.hypot(r.positions[v * 3] - cx, r.positions[v * 3 + 2] - cz);
      (v % 2 === 0 ? inner : outer).push(d);
      ys.push(r.positions[v * 3 + 1]);
    }
    return { inner, outer, ys };
  }

  it('is a bright band on the ground at the front, in the ring colour', () => {
    const w = makeWorld(1);
    addZone(w, ZONE_RING, 3, 0, -2, 12, 200, 15);
    const view = new ZonesView();
    view.update(w);
    expect(view.rings.count).toBe(1);
    expect(view.rings.mesh.visible).toBe(true);
    const { inner, outer } = radii(view, 3, -2);
    for (const d of outer) expect(d).toBeCloseTo(12, 4);
    for (const d of inner) expect(d).toBeCloseTo(12 - RING_BAND, 4);
    const c = new Color(PALETTE.ring);
    expect(view.rings.colors[0]).toBeCloseTo(c.r, 4);
    expect(view.rings.colors[1]).toBeCloseTo(c.g, 4);
    expect(view.rings.colors[2]).toBeCloseTo(c.b, 4);
    // At full strength: the brightest thing on the ground.
    expect(Math.min(...view.rings.fades.slice(0, (view.rings.segments + 1) * 2))).toBe(1);
  });

  it('is drawn where the front is at the frame, between ticks', () => {
    const w = makeWorld(1);
    addZone(w, ZONE_RING, 0, 0, 0, 20, 200, 15);
    const view = new ZonesView();
    view.update(w, 0.5);
    const { outer } = radii(view, 0, 0);
    expect(outer[0]).toBeCloseTo(20 - BOSS.standstill.ringSpeed * 0.5 * DT, 4);
  });

  it('follows the ground it spreads over, and goes when the zone does', () => {
    const terrain = terrainFromHeight((x) => x * 0.25, 500);
    const w = makeWorld(1);
    addZone(w, ZONE_RING, 0, 0, 0, 16, 200, 15);
    const view = new ZonesView(terrain);
    view.update(w);
    const r = view.rings;
    for (let v = 0; v < (r.segments + 1) * 2; v++) {
      expect(r.positions[v * 3 + 1]).toBeGreaterThan(r.positions[v * 3] * 0.25);
      expect(r.positions[v * 3 + 1]).toBeLessThan(r.positions[v * 3] * 0.25 + 0.5);
    }
    removeZone(w, 0);
    view.update(w);
    expect(view.rings.count).toBe(0);
    expect(view.rings.mesh.visible).toBe(false);
  });
});
