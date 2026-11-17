/**
 * The drawn static world. `createStaticWorldView` meshes a whole (small) world up front: it is
 * what the feel slice uses. The city replaces it with a streaming implementation of the same
 * interface.
 */
import * as THREE from 'three';
import type { World } from '../sim/world';
import { MeshBuilder } from './geom';
import { inkMaterial } from './look';
import { meshRail, meshSolid, meshTerrain } from './worldMesh';

export interface WorldView {
  group: THREE.Group;
  /** Called once per frame with the camera position and day fraction. */
  update(camX: number, camZ: number, dayFrac: number): void;
  dispose(): void;
}

const TERRAIN_CHUNK = 32;

export function createStaticWorldView(world: World): WorldView {
  const group = new THREE.Group();
  group.name = 'world';
  const mat = inkMaterial();
  const geos: THREE.BufferGeometry[] = [];
  const add = (b: MeshBuilder, name: string): void => {
    if (b.triangleCount === 0) return;
    const g = b.build();
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    group.add(m);
  };
  // Terrain in chunks so the frustum can cull what is behind the camera.
  for (let iz = 0; iz < world.nz; iz += TERRAIN_CHUNK) {
    for (let ix = 0; ix < world.nx; ix += TERRAIN_CHUNK) {
      const b = new MeshBuilder();
      meshTerrain(b, world, ix, iz, Math.min(world.nx, ix + TERRAIN_CHUNK), Math.min(world.nz, iz + TERRAIN_CHUNK));
      add(b, `terrain_${ix}_${iz}`);
    }
  }
  // Solids and rails bucketed along z for the same reason.
  const band = 96;
  const buckets = new Map<number, MeshBuilder>();
  const bucket = (z: number): MeshBuilder => {
    const k = Math.floor((z - world.minZ) / band);
    let b = buckets.get(k);
    if (!b) {
      b = new MeshBuilder();
      buckets.set(k, b);
    }
    return b;
  };
  for (const o of world.solids) meshSolid(bucket(o.cz), o);
  for (const r of world.rails) meshRail(bucket(r.pts[2]), r, world);
  for (const [k, b] of buckets) add(b, `props_${k}`);

  return {
    group,
    update() {
      // Static: nothing to stream.
    },
    dispose() {
      for (const g of geos) g.dispose();
    },
  };
}
