/**
 * Ride vehicles: one geometry per line (built from its kind and livery), one mesh per vehicle,
 * placed each frame from the timetable. Local frame: +z is the direction of travel, origin on the
 * path (ground level for ground rides, the carriage for overhead rides).
 */
import * as THREE from 'three';
import { DT } from '../sim/constants';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../sim/lines';
import { terrainHeight, topHeight, type World } from '../sim/world';
import { MeshBuilder, shade } from './geom';
import { INK, inkMaterial, shadowMaterial } from './look';

const GLASS = 0x2a2f6e;

/** A chunky rail car: skirt, window band, stripe, roof, lit destination boards, rear grab bar. */
function railCar(b: MeshBuilder, line: CompiledLine, opts: { roofStep: boolean }): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const { base, stripe, accent } = line.livery;
  const skirt = H * 0.42;
  const band = H * 0.3;
  b.box(0, 0.35 + skirt / 2, 0, W, skirt / 2, L, 1, 0, base, { bottom: true });
  b.box(0, 0.35 + skirt + band / 2, 0, W - 0.06, band / 2, L - 0.06, 1, 0, GLASS, { glow: 0.85 });
  b.box(0, 0.35 + skirt + band + (H - skirt - band - 0.35) / 2, 0, W, (H - skirt - band - 0.35) / 2, L, 1, 0, base, { top: stripe });
  // Livery stripe along both flanks, readable from a distance.
  b.box(0, 0.35 + skirt * 0.62, 0, W + 0.03, skirt * 0.16, L * 0.96, 1, 0, stripe, { noTop: true });
  // Window pillars.
  const pillars = Math.max(2, Math.round(L / 1.1));
  for (let i = 0; i <= pillars; i++) {
    const z = -L + (i * 2 * L) / pillars;
    b.box(0, 0.35 + skirt + band / 2, z, W + 0.01, band / 2, 0.09, 1, 0, base, { noTop: true });
  }
  // Destination boards front and back.
  b.box(0, H - 0.42, L + 0.02, W * 0.6, 0.2, 0.03, 1, 0, INK.ink, { glow: 0 });
  b.box(0, H - 0.42, L + 0.05, W * 0.5, 0.12, 0.02, 1, 0, INK.mango, { glow: 1 });
  b.box(0, H - 0.42, -L - 0.05, W * 0.5, 0.12, 0.02, 1, 0, INK.mango, { glow: 1 });
  // Headlamps.
  b.box(W * 0.6, 0.9, L + 0.03, 0.14, 0.12, 0.03, 1, 0, INK.white, { glow: 1 });
  b.box(-W * 0.6, 0.9, L + 0.03, 0.14, 0.12, 0.03, 1, 0, INK.white, { glow: 1 });
  // Roof mark: a big accent block, the line's signature from above.
  b.box(0, H + 0.14, 0, W * 0.55, 0.14, L * 0.45, 1, 0, accent, {});
  if (opts.roofStep) b.box(0, H + 0.36, L * 0.25, W * 0.4, 0.1, L * 0.18, 1, 0, stripe, {});
  // Wheels as dark blocks.
  for (const z of [-L * 0.62, L * 0.62]) b.box(0, 0.3, z, W * 0.92, 0.3, 0.5, 1, 0, INK.ink, { bottom: true });
  // Rear bumper and the grab bar a skater hitches to.
  const back = -line.anchorBack;
  b.box(0, 0.62, -L - 0.12, W * 0.9, 0.12, 0.12, 1, 0, INK.ink, {});
  b.beam(-0.5, line.anchorY, back, 0.5, line.anchorY, back, 0.05, INK.pink, 0.6);
  b.beam(-0.5, line.anchorY, back, -0.5, 0.7, -L - 0.1, 0.035, INK.pink);
  b.beam(0.5, line.anchorY, back, 0.5, 0.7, -L - 0.1, 0.035, INK.pink);
}

/** Geometry for one vehicle of `line`. Kinds not drawn specially fall back to a livery box. */
export function buildVehicleGeometry(line: CompiledLine): THREE.BufferGeometry {
  const b = new MeshBuilder();
  switch (line.kind) {
    case 'tram':
    case 'ghosttram':
    case 'bus':
      railCar(b, line, { roofStep: false });
      break;
    case 'funicular':
      railCar(b, line, { roofStep: true });
      break;
    default: {
      const L = Math.max(line.bodyHalfLen, 0.8);
      const W = Math.max(line.bodyHalfWid, 0.6);
      const H = Math.max(line.bodyHeight, 1.2);
      const y = line.overhead ? -H / 2 : H / 2 + 0.2;
      b.box(0, y, 0, W, H / 2, L, 1, 0, line.livery.base, { top: line.livery.stripe, bottom: true });
      b.box(0, y, 0, W + 0.03, H * 0.12, L * 0.9, 1, 0, line.livery.stripe, { noTop: true });
      if (line.overhead) b.beam(0, -H, 0, 0, line.anchorY - line.hang, -line.anchorBack, 0.04, shade(line.livery.accent, 1));
    }
  }
  return b.build();
}

const _v: VehicleState = makeVehicleState();
const _g = { x: 0, y: 0, z: 0 };

export interface VehicleView {
  group: THREE.Group;
  /** Place every vehicle for sim tick `tick`, `alpha` (0..1) of the way from the previous tick. */
  update(tick: number, alpha: number): void;
  /** World position of a vehicle's grab point at the same instant (for the strap). */
  grabAt(line: number, vehicle: number, tick: number, alpha: number, out: THREE.Vector3): void;
  dispose(): void;
}

export function createVehicleView(world: World): VehicleView {
  const group = new THREE.Group();
  group.name = 'vehicles';
  const mat = inkMaterial();
  const shadowMat = shadowMaterial();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const geos: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[][] = [];
  const shadows: THREE.Mesh[][] = [];
  for (const line of world.lines) {
    const geo = buildVehicleGeometry(line);
    geos.push(geo);
    const row: THREE.Mesh[] = [];
    const srow: THREE.Mesh[] = [];
    for (let i = 0; i < line.vehicles; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.order = 'YXZ';
      group.add(m);
      row.push(m);
      const s = new THREE.Mesh(shadowGeo, shadowMat);
      s.scale.set(Math.max(1.5, line.bodyHalfWid * 2 + 1.6), 1, Math.max(1.5, line.bodyHalfLen * 2 + 1.6));
      s.renderOrder = 2;
      group.add(s);
      srow.push(s);
    }
    meshes.push(row);
    shadows.push(srow);
  }

  return {
    group,
    update(tick, alpha) {
      const back = (alpha - 1) * DT;
      for (let li = 0; li < world.lines.length; li++) {
        const line = world.lines[li];
        for (let i = 0; i < line.vehicles; i++) {
          const m = meshes[li][i];
          const s = shadows[li][i];
          vehicleAt(line, i, tick, _v);
          m.visible = _v.active;
          s.visible = _v.active;
          if (!_v.active) continue;
          const x = _v.x + _v.vx * back;
          const y = _v.y + _v.vy * back;
          const z = _v.z + _v.vz * back;
          m.position.set(x, y, z);
          const yaw = Math.atan2(_v.hx, _v.hz);
          let pitch = 0;
          if (!line.overhead) {
            const d = Math.max(1, line.bodyHalfLen * 0.7);
            const front = terrainHeight(world, x + _v.hx * d, z + _v.hz * d);
            const rear = terrainHeight(world, x - _v.hx * d, z - _v.hz * d);
            pitch = Math.atan2(front - rear, 2 * d);
          }
          m.rotation.set(-pitch, yaw, 0);
          s.position.set(x, (line.overhead ? topHeight(world, x, z) : y) + 0.04, z);
          s.rotation.y = yaw;
        }
      }
    },
    grabAt(li, vi, tick, alpha, out) {
      const line = world.lines[li];
      vehicleAt(line, vi, tick, _v);
      grabPoint(line, _v, _g);
      const back = (alpha - 1) * DT;
      out.set(_g.x + _v.vx * back, _g.y + _v.vy * back, _g.z + _v.vz * back);
    },
    dispose() {
      for (const g of geos) g.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
    },
  };
}
