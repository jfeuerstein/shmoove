/**
 * Ride vehicles: a few geometries per line (built from its kind and livery: animation frames on
 * twos, or the funicular's up/down stepping), one mesh per vehicle, placed each frame from the
 * timetable. Local frame: +z is the direction of travel, origin on the path (ground level for
 * ground rides, the carriage for overhead rides). Kind builders live in `vehicleKinds/`.
 */
import * as THREE from 'three';
import { DT } from '../sim/constants';
import { grabPoint, makeVehicleState, vehicleAt, type CompiledLine, type VehicleState } from '../sim/lines';
import { terrainHeight, topHeight, type World } from '../sim/world';
import { MeshBuilder } from './geom';
import { inkMaterial, shadowMaterial } from './look';
import { buildKind, shadowSize, variantCount } from './vehicleKinds';

/** Vehicles further than this from the camera are not drawn, m. */
export const VEHICLE_DRAW_DIST = 240;
/** Blob shadows are drawn only within this distance of the camera, m. */
export const VEHICLE_SHADOW_DIST = 120;
/** Sim ticks per animation frame: 60 Hz / 5 = 12 Hz, "on twos". */
const TWOS = 5;

/** How many geometry variants (animation frames, or funicular stepping) a line's vehicles use. */
export function vehicleVariants(line: CompiledLine): number {
  return variantCount(line.kind);
}

/**
 * Geometry for one vehicle of `line`. `variant` picks the animation frame (wrapped), or for the
 * funicular 0 = stepped for climbing, 1 = stepped for descending.
 */
export function buildVehicleGeometry(line: CompiledLine, variant = 0): THREE.BufferGeometry {
  const b = new MeshBuilder();
  buildKind(b, line, variant);
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
  /**
   * Camera position for distance culling (vehicles beyond VEHICLE_DRAW_DIST hidden, shadows beyond
   * VEHICLE_SHADOW_DIST hidden). Until it is first called, everything in service is drawn.
   */
  setCamera(x: number, y: number, z: number): void;
  dispose(): void;
}

export function createVehicleView(world: World): VehicleView {
  const group = new THREE.Group();
  group.name = 'vehicles';
  const mat = inkMaterial();
  const shadowMat = shadowMaterial();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const geos: THREE.BufferGeometry[][] = [];
  const meshes: THREE.Mesh[][] = [];
  const shadows: THREE.Mesh[][] = [];
  for (const line of world.lines) {
    const n = vehicleVariants(line);
    const variants: THREE.BufferGeometry[] = [];
    for (let v = 0; v < n; v++) variants.push(buildVehicleGeometry(line, v));
    geos.push(variants);
    const [sw, sl] = shadowSize(line);
    const row: THREE.Mesh[] = [];
    const srow: THREE.Mesh[] = [];
    for (let i = 0; i < line.vehicles; i++) {
      const m = new THREE.Mesh(variants[0], mat);
      m.rotation.order = 'YXZ';
      m.visible = false;
      group.add(m);
      row.push(m);
      const s = new THREE.Mesh(shadowGeo, shadowMat);
      s.scale.set(sw, 1, sl);
      s.renderOrder = 2;
      s.visible = false;
      group.add(s);
      srow.push(s);
    }
    meshes.push(row);
    shadows.push(srow);
  }

  let haveCam = false;
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  const drawD2 = VEHICLE_DRAW_DIST * VEHICLE_DRAW_DIST;
  const shadowD2 = VEHICLE_SHADOW_DIST * VEHICLE_SHADOW_DIST;

  return {
    group,
    update(tick, alpha) {
      const back = (alpha - 1) * DT;
      const anim = Math.floor(tick / TWOS);
      for (let li = 0; li < world.lines.length; li++) {
        const line = world.lines[li];
        const variants = geos[li];
        // Every vehicle stays on its path: a line whose path box is out of drawing range has
        // nothing to draw, without asking where each vehicle is.
        if (haveCam) {
          const bx = camX < line.minX ? line.minX - camX : camX > line.maxX ? camX - line.maxX : 0;
          const bz = camZ < line.minZ ? line.minZ - camZ : camZ > line.maxZ ? camZ - line.maxZ : 0;
          if (bx * bx + bz * bz > drawD2) {
            for (let i = 0; i < line.vehicles; i++) {
              meshes[li][i].visible = false;
              shadows[li][i].visible = false;
            }
            continue;
          }
        }
        for (let i = 0; i < line.vehicles; i++) {
          const m = meshes[li][i];
          const s = shadows[li][i];
          vehicleAt(line, i, tick, _v);
          if (!_v.active) {
            m.visible = false;
            s.visible = false;
            continue;
          }
          const x = _v.x + _v.vx * back;
          const y = _v.y + _v.vy * back;
          const z = _v.z + _v.vz * back;
          let d2 = 0;
          if (haveCam) {
            const dx = x - camX;
            const dy = y - camY;
            const dz = z - camZ;
            d2 = dx * dx + dy * dy + dz * dz;
          }
          if (d2 > drawD2) {
            m.visible = false;
            s.visible = false;
            continue;
          }
          m.visible = true;
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
          if (line.kind === 'funicular') m.geometry = variants[pitch < -0.01 ? 1 : 0];
          else if (variants.length > 1) m.geometry = variants[(anim + i) % variants.length];
          s.visible = d2 <= shadowD2;
          if (s.visible) {
            s.position.set(x, (line.overhead ? topHeight(world, x, z) : y) + 0.04, z);
            s.rotation.y = yaw;
          }
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
    setCamera(x, y, z) {
      haveCam = true;
      camX = x;
      camY = y;
      camZ = z;
    },
    dispose() {
      for (const row of geos) for (const g of row) g.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
    },
  };
}
