/**
 * The vehicle view skips lines whose path is out of drawing range (performance pass). It must still
 * draw exactly the vehicles in service within VEHICLE_DRAW_DIST of the camera, wherever they are.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { createVehicleView, VEHICLE_DRAW_DIST } from '../../src/render/vehicles';
import { buildCity } from '../../src/sim/city/index';
import { DAY_TICKS, DT } from '../../src/sim/constants';
import { makeVehicleState, vehicleAt } from '../../src/sim/lines';

describe('vehicle view range culling', () => {
  const world = buildCity(1).world;
  const view = createVehicleView(world);
  // Children are added per vehicle as (body, shadow), line by line.
  const bodies: THREE.Object3D[][] = [];
  let c = 0;
  for (const L of world.lines) {
    const row: THREE.Object3D[] = [];
    for (let i = 0; i < L.vehicles; i++) {
      row.push(view.group.children[c]);
      c += 2;
    }
    bodies.push(row);
  }
  const v = makeVehicleState();

  it('draws exactly the in-service vehicles within range, from cameras all over the city at all hours', () => {
    let seed = 99;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let shown = 0;
    let hidden = 0;
    for (let n = 0; n < 400; n++) {
      const cx = world.minX - 200 + rand() * (world.nx * world.cell + 400);
      const cz = world.minZ - 200 + rand() * (world.nz * world.cell + 400);
      const cy = 20 + rand() * 200;
      const tick = Math.floor(rand() * DAY_TICKS * 2);
      const alpha = rand();
      view.setCamera(cx, cy, cz);
      view.update(tick, alpha);
      const back = (alpha - 1) * DT;
      for (let li = 0; li < world.lines.length; li++) {
        const L = world.lines[li];
        for (let i = 0; i < L.vehicles; i++) {
          vehicleAt(L, i, tick, v);
          const x = v.x + v.vx * back;
          const y = v.y + v.vy * back;
          const z = v.z + v.vz * back;
          const d = Math.hypot(x - cx, y - cy, z - cz);
          const want = v.active && d <= VEHICLE_DRAW_DIST;
          // Stay clear of the exact boundary, where rounding of the two distance forms may differ.
          if (Math.abs(d - VEHICLE_DRAW_DIST) < 1e-6) continue;
          expect(bodies[li][i].visible, `${L.id} #${i} at d=${d.toFixed(1)}`).toBe(want);
          if (want) {
            shown++;
            expect(bodies[li][i].position.x).toBe(x);
            expect(bodies[li][i].position.z).toBe(z);
          } else hidden++;
        }
      }
    }
    expect(shown).toBeGreaterThan(100);
    expect(hidden).toBeGreaterThan(100);
  });
});
