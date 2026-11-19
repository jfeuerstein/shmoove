/**
 * The rails: a bright bar for each, standing on dark posts with feet.
 *
 * Each bar is a thin box from one end of the rail to the other, its top on the rail's line (where
 * the board rides), in `PALETTE.rail` with enough glow to pick out against the ground from the edge
 * of the fog. Posts in `PALETTE.railPost` hold it up at both ends and about every `POST_EVERY`
 * metres between, from a little under the ground to the bar's underside.
 *
 * The trim: a foot plate on the ground under every post, a strip along the bar's top in a lighter
 * tone of the rail that glows hard (the edge you aim the board at), and a chunky cap on each end.
 * The faint glow along the rail being ground is drawn by `ParkView`, which is updated per frame.
 *
 * Three instanced meshes, built once from `terrain.rails`: the rails never move, so nothing is
 * written after the constructor and nothing is done per frame.
 */
import { BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh } from 'three';
import type { Rail, Terrain } from '../sim/terrain';
import { addInstanceFloat, rgbInto, segmentMatrix, tintMaterial } from './fxView';
import { PALETTE, flatMaterial, glowMaterial, tone } from './look';

/** The bar's width and depth, m; its top is the rail's line. */
export const BAR_THICK = 0.16;
/** Posts: their width, and the most room between two along a rail, m. */
export const POST_THICK = 0.14;
export const POST_EVERY = 6;
/** Posts go this far into the ground, so none floats where the ground falls away beside it, m. */
const POST_SINK = 0.3;
/** The bar's glow: it is the one thing on the map you aim at, so it reads from afar. */
export const BAR_GLOW = 0.6;
/** The top strip: how tall, how far it stands out each side of the bar, and its glow. */
export const EDGE_HIGH = 0.05;
const EDGE_OUT = 0.012;
export const EDGE_GLOW = 1;
/** A foot plate: its side and thickness, m. */
export const FOOT_WIDE = 0.44;
const FOOT_HIGH = 0.1;
/** An end cap: its side and length, m. */
export const CAP_WIDE = 0.26;
const CAP_LONG = 0.3;
/** Trim boxes per rail beyond its feet: the top strip and two caps. */
export const TRIM_PER_RAIL = 3;

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
  /** Feet, top strips and end caps. */
  readonly trim: InstancedMesh;

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

    const trimCount = postCount + rails.length * TRIM_PER_RAIL;
    const trimGlow: InstancedBufferAttribute = addInstanceFloat(box, 'aGlow', Math.max(1, trimCount));
    this.trim = new InstancedMesh(box, tintMaterial(), Math.max(1, trimCount));
    this.trim.name = 'rails-trim';
    const trimRgb = new Float32Array(Math.max(1, trimCount) * 3);
    const foot = tone(PALETTE.railPost, -0.35);
    const edge = tone(PALETTE.rail, 0.6);
    const cap = tone(PALETTE.railPost, 0.25);
    const tg = trimGlow.array as Float32Array;

    const bm = this.bars.instanceMatrix.array;
    const pm = this.posts.instanceMatrix.array;
    const tm = this.trim.instanceMatrix.array;
    let p = 0;
    let q = 0;
    const paint = (color: number, glow: number): void => {
      rgbInto(trimRgb, q * 3, color);
      tg[q] = glow;
      q++;
    };
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
        const gy = terrain.heightAt(x, z);
        segmentMatrix(pm, p++, x, gy - POST_SINK, z, x, under, z, POST_THICK, POST_THICK);
        // The foot: a plate on the ground, square to the rail.
        const dx = r.x1 - r.x0;
        const dz = r.z1 - r.z0;
        const l = Math.max(1e-6, Math.sqrt(dx * dx + dz * dz));
        const fx = (dx / l) * FOOT_WIDE * 0.5;
        const fz = (dz / l) * FOOT_WIDE * 0.5;
        segmentMatrix(tm, q, x - fx, gy + FOOT_HIGH / 2 - 0.02, z - fz, x + fx, gy + FOOT_HIGH / 2 - 0.02, z + fz, FOOT_WIDE, FOOT_HIGH);
        paint(foot, 0);
      }
      // The strip along the top: its top just over the rail's line, a little wider than the bar.
      const ey = EDGE_HIGH / 2 - EDGE_HIGH + 0.005;
      segmentMatrix(tm, q, r.x0, r.y0 + ey, r.z0, r.x1, r.y1 + ey, r.z1, BAR_THICK + EDGE_OUT * 2, EDGE_HIGH);
      paint(edge, EDGE_GLOW);
      // A cap on each end, round the bar's end.
      const dx = r.x1 - r.x0;
      const dy = r.y1 - r.y0;
      const dz = r.z1 - r.z0;
      const l = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const ux = (dx / l) * CAP_LONG * 0.5;
      const uy = (dy / l) * CAP_LONG * 0.5;
      const uz = (dz / l) * CAP_LONG * 0.5;
      for (let e = 0; e < 2; e++) {
        const ex = e === 0 ? r.x0 + ux * 0.6 : r.x1 - ux * 0.6;
        const cy = (e === 0 ? r.y0 + uy * 0.6 : r.y1 - uy * 0.6) - half;
        const ez = e === 0 ? r.z0 + uz * 0.6 : r.z1 - uz * 0.6;
        segmentMatrix(tm, q, ex - ux, cy - uy, ez - uz, ex + ux, cy + uy, ez + uz, CAP_WIDE, CAP_WIDE);
        paint(cap, 0.15);
      }
    }
    this.bars.count = rails.length;
    this.posts.count = postCount;
    this.trim.count = q;
    this.trim.instanceColor = new InstancedBufferAttribute(trimRgb, 3);
    for (const mesh of [this.bars, this.posts, this.trim]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.object.add(mesh);
    }
    this.object.matrixAutoUpdate = false;
  }
}
