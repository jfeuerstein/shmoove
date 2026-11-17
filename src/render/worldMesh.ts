/**
 * Meshers for the static world: heightfield cells, solids and rails into MeshBuilders.
 * The terrain uses the same per-cell diagonal as the sim (see src/sim/world.ts), so the drawn
 * ground is exactly the collision ground.
 */
import { Surface, terrainHeight, vertexHeight, type Rail, type Solid, type World } from '../sim/world';
import { MeshBuilder, hash2, shade } from './geom';
import { INK } from './look';

const SURFACE_COLOR: Record<number, number> = {
  [Surface.STREET]: INK.asphalt,
  [Surface.PLAZA]: INK.concrete,
  [Surface.STAIRS]: INK.curb,
  [Surface.DIRT]: INK.sand,
  [Surface.GRASS]: INK.leaf,
  [Surface.TRACK]: 0x6f6a78,
  [Surface.WATER]: INK.sea,
  [Surface.ROOF]: INK.concrete,
  [Surface.AWNING]: INK.pink,
};

export function surfaceColor(surface: number): number {
  return SURFACE_COLOR[surface] ?? INK.concrete;
}

/**
 * Mesh heightfield cells [ix0, ix1) x [iz0, iz1). Each cell is two triangles in its surface
 * colour with a little per-cell ink variation; stair cells are drawn as banded treads.
 */
export function meshTerrain(b: MeshBuilder, w: World, ix0: number, iz0: number, ix1: number, iz1: number): void {
  for (let iz = iz0; iz < iz1; iz++) {
    for (let ix = ix0; ix < ix1; ix++) {
      const surface = w.surfaces[iz * w.nx + ix];
      const x0 = w.minX + ix * w.cell;
      const z0 = w.minZ + iz * w.cell;
      const x1 = x0 + w.cell;
      const z1 = z0 + w.cell;
      const h00 = vertexHeight(w, ix, iz);
      const h10 = vertexHeight(w, ix + 1, iz);
      const h01 = vertexHeight(w, ix, iz + 1);
      const h11 = vertexHeight(w, ix + 1, iz + 1);
      let color = surfaceColor(surface);
      if (surface === Surface.STAIRS) {
        // Treads: alternate light and dark bands across the fall line.
        color = shade(color, (iz & 1) === 0 ? 1.04 : 0.86);
      } else if (surface === Surface.WATER) {
        color = shade(color, 0.94 + 0.1 * hash2(ix >> 1, iz));
      } else {
        color = shade(color, 0.97 + 0.06 * hash2(ix, iz));
      }
      const a = b.vert(x0, h00, z0, color);
      const c = b.vert(x1, h10, z0, color);
      const d = b.vert(x1, h11, z1, color);
      const e = b.vert(x0, h01, z1, color);
      b.tri(a, d, c);
      b.tri(a, e, d);
    }
  }
}

const BUILDING_INKS = [INK.mango, INK.pink, INK.teal, INK.cobalt, INK.brick, INK.sand, INK.white, 0xf58fb4];

/** A solid as a dressed box: walls in a flat ink, a paler lid, windows on buildings. */
export function meshSolid(b: MeshBuilder, o: Solid): void {
  const hy = (o.yTop - o.yBase) / 2;
  const cy = o.yBase + hy;
  if (o.kind === 'awning') {
    // Striped canopy: alternating bands along its length.
    const bands = Math.max(2, Math.round((o.hz * 2) / 1.2));
    const ink = o.style % 2 === 0 ? INK.pink : INK.teal;
    for (let i = 0; i < bands; i++) {
      const lz = -o.hz + ((i + 0.5) * 2 * o.hz) / bands;
      const cxw = o.cx - lz * o.sinR;
      const czw = o.cz + lz * o.cosR;
      b.box(cxw, cy, czw, o.hx, hy, o.hz / bands, o.cosR, o.sinR, i % 2 === 0 ? ink : INK.white, { bottom: true });
    }
    return;
  }
  const base = o.kind === 'kiosk' ? INK.teal : BUILDING_INKS[o.style % BUILDING_INKS.length];
  b.box(o.cx, cy, o.cz, o.hx, hy, o.hz, o.cosR, o.sinR, base, { top: shade(INK.concrete, 0.96) });
  // Roof lip so rooftops read from above.
  b.box(o.cx, o.yTop + 0.06, o.cz, o.hx + 0.12, 0.06, o.hz + 0.12, o.cosR, o.sinR, shade(base, 0.8), {});

  if (o.kind !== 'building' && o.kind !== 'kiosk') return;
  const win = 0x2a2f6e;
  const rows = Math.floor((o.yTop - o.yBase - 2.2) / 3);
  const face = (alongHalf: number, outHalf: number, axis: 0 | 1, sign: number): void => {
    const cols = Math.max(1, Math.floor((alongHalf * 2 - 1) / 2.8));
    for (let r = 0; r < rows; r++) {
      const wy = o.yBase + 3.2 + r * 3;
      for (let c = 0; c < cols; c++) {
        const t = -alongHalf + ((c + 0.5) * 2 * alongHalf) / cols;
        const lit = hash2(o.index * 31 + r * 7 + c, axis * 2 + sign) > 0.45 ? 1 : 0;
        // Local frame: `axis` 0 puts the face on local +-x, 1 on local +-z.
        const lx = axis === 0 ? sign * (outHalf + 0.03) : t;
        const lz = axis === 0 ? t : sign * (outHalf + 0.03);
        const tx = axis === 0 ? 0 : 0.6;
        const tz = axis === 0 ? 0.6 : 0;
        const p = (ox: number, oz: number): [number, number] => [
          o.cx + (lx + ox) * o.cosR - (lz + oz) * o.sinR,
          o.cz + (lx + ox) * o.sinR + (lz + oz) * o.cosR,
        ];
        // Order the corners so the quad faces outward.
        const flip = axis === 0 ? sign > 0 : sign < 0;
        const [ax, az] = p(flip ? -tx : tx, flip ? -tz : tz);
        const [bx, bz] = p(flip ? tx : -tx, flip ? tz : -tz);
        b.quad(ax, wy - 0.7, az, ax, wy + 0.7, az, bx, wy + 0.7, bz, bx, wy - 0.7, bz, win, lit);
      }
    }
  };
  if (rows > 0) {
    face(o.hz, o.hx, 0, 1);
    face(o.hz, o.hx, 0, -1);
    face(o.hx, o.hz, 1, 1);
    face(o.hx, o.hz, 1, -1);
  }
}

/** A rail as a beam, with posts down to the ground for handrails and ledges. */
export function meshRail(b: MeshBuilder, r: Rail, w: World): void {
  const p = r.pts;
  const n = p.length / 3;
  const color = r.kind === 'wire' || r.kind === 'guy' ? INK.ink : r.kind === 'ledge' ? INK.cobalt : INK.pink;
  const half = r.kind === 'wire' || r.kind === 'guy' ? 0.035 : 0.06;
  for (let i = 0; i < n - 1; i++) {
    b.beam(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5], half, color);
  }
  if (r.kind !== 'handrail' && r.kind !== 'ledge') return;
  const spacing = 2.5;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 3];
    const ay = p[i * 3 + 1];
    const az = p[i * 3 + 2];
    const dx = p[i * 3 + 3] - ax;
    const dy = p[i * 3 + 4] - ay;
    const dz = p[i * 3 + 5] - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const posts = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k <= posts; k++) {
      if (k === posts && i < n - 2) continue;
      const t = k / posts;
      const x = ax + dx * t;
      const z = az + dz * t;
      const top = ay + dy * t;
      const ground = terrainHeight(w, x, z);
      if (top - ground > 0.1 && top - ground < 3) b.beam(x, ground, z, x, top, z, 0.045, shade(color, 0.8));
    }
  }
}
