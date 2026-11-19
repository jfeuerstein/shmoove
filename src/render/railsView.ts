/**
 * The rails: a bright bar for each, standing on dark posts.
 *
 * Each bar is a thin box from one end of the rail to the other, its top on the rail's line (where
 * the board rides), in `PALETTE.rail` with enough glow to pick out against the ground from the edge
 * of the fog. Posts in `PALETTE.railPost` hold it up at both ends and about every `POST_EVERY`
 * metres between, from a little under the ground to the bar's underside.
 *
 * Two instanced meshes, built once from `terrain.rails`: the rails never move, so nothing is written
 * after the constructor and nothing is done per frame.
 */
import { BoxGeometry, Group, InstancedMesh } from 'three';
import type { Rail, Terrain } from '../sim/terrain';
import { segmentMatrix } from './fxView';
import { PALETTE, flatMaterial, glowMaterial } from './look';

/** The bar's width and depth, m; its top is the rail's line. */
export const BAR_THICK = 0.16;
/** Posts: their width, and the most room between two along a rail, m. */
export const POST_THICK = 0.11;
export const POST_EVERY = 6;
/** Posts go this far into the ground, so none floats where the ground falls away beside it, m. */
const POST_SINK = 0.3;
/** The bar's glow: it is the one thing on the map you aim at, so it reads from afar. */
export const BAR_GLOW = 0.6;

/** How many posts a rail of horizontal length `len` stands on: one at each end, none more than `POST_EVERY` apart. */
export function postsFor(len: number): number {
  return Math.max(2, Math.ceil(len / POST_EVERY) + 1);
}

function railLength(r: Rail): number {
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  return Math.sqrt(dx * dx + dz * dz);
}

export class RailsView {
  readonly object = new Group();
  readonly bars: InstancedMesh;
  readonly posts: InstancedMesh;

  constructor(terrain: Terrain) {
    this.object.name = 'rails';
    const rails = terrain.rails;
    let postCount = 0;
    for (const r of rails) postCount += postsFor(railLength(r));

    const box = new BoxGeometry(1, 1, 1);
    this.bars = new InstancedMesh(box, glowMaterial(PALETTE.rail, BAR_GLOW), Math.max(1, rails.length));
    this.bars.name = 'rails-bars';
    this.posts = new InstancedMesh(box, flatMaterial(PALETTE.railPost), Math.max(1, postCount));
    this.posts.name = 'rails-posts';

    const bm = this.bars.instanceMatrix.array;
    const pm = this.posts.instanceMatrix.array;
    let p = 0;
    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      const half = BAR_THICK / 2;
      segmentMatrix(bm, i, r.x0, r.y0 - half, r.z0, r.x1, r.y1 - half, r.z1, BAR_THICK, BAR_THICK);
      const n = postsFor(railLength(r));
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const x = r.x0 + (r.x1 - r.x0) * t;
        const z = r.z0 + (r.z1 - r.z0) * t;
        const under = r.y0 + (r.y1 - r.y0) * t - BAR_THICK;
        const ground = terrain.heightAt(x, z) - POST_SINK;
        segmentMatrix(pm, p++, x, ground, z, x, under, z, POST_THICK, POST_THICK);
      }
    }
    this.bars.count = rails.length;
    this.posts.count = postCount;
    for (const mesh of [this.bars, this.posts]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.object.add(mesh);
    }
    this.object.matrixAutoUpdate = false;
  }
}
