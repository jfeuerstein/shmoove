/**
 * Carving streets into the heightfield. A carve pulls the terrain toward its own target height
 * (full weight inside, fading over `blend` outside) and paints its surface on the cells it covers.
 * Carves apply in order, so later ones win. Sharp carve edges can be flagged as cliffs: after the
 * last carve, every flagged cell that ends up as a real step becomes a retaining wall solid, and
 * any cell steeper than 100% that nothing else covers does too (vertical faces are solids).
 */
import { Surface, addSolid, type World } from '../world';

export interface RectCarve {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Blend distances outside the rect along x and z (0 = sharp edge). */
  bx: number;
  bz: number;
  /** Target height, evaluated at the nearest point of the rect. */
  h: (x: number, z: number) => number;
  /** Surface for cells whose centre is inside the rect; -1 keeps what is there. */
  surf: (x: number, z: number) => number;
  /** Flag the cells straddling the z edges / x edges as cliff candidates. */
  cliffZ?: boolean;
  cliffX?: boolean;
  /** Restrict cliff flags to this x range (z edges) or z range (x edges). */
  cliffLo?: number;
  cliffHi?: number;
  /** Evaluate the target height at the vertex's own x in the side blends (h is defined beyond the rect). */
  actualX?: boolean;
}

export interface PathCarve {
  /** xyz triplets; y is the target height of the centre line. */
  pts: ArrayLike<number>;
  half: number;
  blend: number;
  /** Surface painted within `half`, per segment index (or one value). */
  surf: number | ((seg: number) => number);
}

export class Carver {
  readonly w: World;
  readonly row: number;
  /** Cells flagged as cliff candidates. */
  readonly cliff: Uint8Array;
  private stamp: Int32Array;
  private bestD: Float64Array;
  private bestH: Float64Array;
  private cellStamp: Int32Array;
  private cellD: Float64Array;
  private cellSeg: Int32Array;
  private gen = 0;

  constructor(w: World) {
    this.w = w;
    this.row = w.nx + 1;
    const nv = (w.nx + 1) * (w.nz + 1);
    const nc = w.nx * w.nz;
    this.cliff = new Uint8Array(nc);
    this.stamp = new Int32Array(nv);
    this.bestD = new Float64Array(nv);
    this.bestH = new Float64Array(nv);
    this.cellStamp = new Int32Array(nc);
    this.cellD = new Float64Array(nc);
    this.cellSeg = new Int32Array(nc);
  }

  private ixOf(x: number): number {
    return Math.round((x - this.w.minX) / this.w.cell);
  }

  private izOf(z: number): number {
    return Math.round((z - this.w.minZ) / this.w.cell);
  }

  private clampI(i: number, n: number): number {
    return i < 0 ? 0 : i > n ? n : i;
  }

  rect(c: RectCarve): void {
    const w = this.w;
    const ix0 = this.clampI(Math.floor((c.x0 - c.bx - w.minX) / w.cell), w.nx);
    const ix1 = this.clampI(Math.ceil((c.x1 + c.bx - w.minX) / w.cell), w.nx);
    const iz0 = this.clampI(Math.floor((c.z0 - c.bz - w.minZ) / w.cell), w.nz);
    const iz1 = this.clampI(Math.ceil((c.z1 + c.bz - w.minZ) / w.cell), w.nz);
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = w.minZ + iz * w.cell;
      const cz = z < c.z0 ? c.z0 : z > c.z1 ? c.z1 : z;
      const wz = fade(Math.abs(z - cz), c.bz);
      if (wz <= 0) continue;
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = w.minX + ix * w.cell;
        const cx = x < c.x0 ? c.x0 : x > c.x1 ? c.x1 : x;
        const wt = wz * fade(Math.abs(x - cx), c.bx);
        if (wt <= 0) continue;
        const k = iz * this.row + ix;
        w.heights[k] += (c.h(c.actualX ? x : cx, cz) - w.heights[k]) * wt;
      }
    }
    // Cells: paint inside, clear old cliff flags inside, flag the new edges.
    for (let iz = Math.max(0, iz0 - 1); iz < Math.min(w.nz, iz1 + 1); iz++) {
      const zc = w.minZ + (iz + 0.5) * w.cell;
      const zLo = zc - w.cell / 2;
      const zHi = zc + w.cell / 2;
      for (let ix = Math.max(0, ix0 - 1); ix < Math.min(w.nx, ix1 + 1); ix++) {
        const xc = w.minX + (ix + 0.5) * w.cell;
        const xLo = xc - w.cell / 2;
        const xHi = xc + w.cell / 2;
        const ci = iz * w.nx + ix;
        const inside = xc >= c.x0 && xc <= c.x1 && zc >= c.z0 && zc <= c.z1;
        if (inside) {
          const s = c.surf(xc, zc);
          if (s >= 0) w.surfaces[ci] = s;
        }
        // A cell fully inside the carve is the carve's now.
        if (xLo >= c.x0 && xHi <= c.x1 && zLo >= c.z0 && zHi <= c.z1) this.cliff[ci] = 0;
        if (c.cliffZ && xc >= c.x0 && xc <= c.x1 && xc >= (c.cliffLo ?? -Infinity) && xc <= (c.cliffHi ?? Infinity)) {
          if ((zLo < c.z0 && zHi > c.z0 - c.bz - 1e-6 && zHi <= c.z0 + 1e-6) || (zHi > c.z1 && zLo < c.z1 + c.bz + 1e-6 && zLo >= c.z1 - 1e-6)) {
            this.cliff[ci] = 2;
          }
        }
        if (c.cliffX && zc >= c.z0 && zc <= c.z1 && zc >= (c.cliffLo ?? -Infinity) && zc <= (c.cliffHi ?? Infinity)) {
          if ((xLo < c.x0 && xHi > c.x0 - c.bx - 1e-6 && xHi <= c.x0 + 1e-6) || (xHi > c.x1 && xLo < c.x1 + c.bx + 1e-6 && xLo >= c.x1 - 1e-6)) {
            this.cliff[ci] = 1;
          }
        }
      }
    }
  }

  path(c: PathCarve): void {
    const w = this.w;
    const n = Math.floor(c.pts.length / 3);
    if (n < 2) return;
    const reach = c.half + c.blend;
    this.gen++;
    const g = this.gen;
    const touched: number[] = [];
    const touchedCells: number[] = [];
    const p = c.pts;
    for (let s = 0; s < n - 1; s++) {
      const ax = p[s * 3];
      const ay = p[s * 3 + 1];
      const az = p[s * 3 + 2];
      const ex = p[s * 3 + 3] - ax;
      const ey = p[s * 3 + 4] - ay;
      const ez = p[s * 3 + 5] - az;
      const l2 = ex * ex + ez * ez;
      const bx0 = Math.min(ax, ax + ex) - reach;
      const bx1 = Math.max(ax, ax + ex) + reach;
      const bz0 = Math.min(az, az + ez) - reach;
      const bz1 = Math.max(az, az + ez) + reach;
      const ix0 = this.clampI(Math.floor((bx0 - w.minX) / w.cell), w.nx);
      const ix1 = this.clampI(Math.ceil((bx1 - w.minX) / w.cell), w.nx);
      const iz0 = this.clampI(Math.floor((bz0 - w.minZ) / w.cell), w.nz);
      const iz1 = this.clampI(Math.ceil((bz1 - w.minZ) / w.cell), w.nz);
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = w.minZ + iz * w.cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = w.minX + ix * w.cell;
          let t = l2 > 1e-12 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const dx = x - (ax + ex * t);
          const dz = z - (az + ez * t);
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > reach) continue;
          const k = iz * this.row + ix;
          if (this.stamp[k] !== g) {
            this.stamp[k] = g;
            this.bestD[k] = d;
            this.bestH[k] = ay + ey * t;
            touched.push(k);
          } else if (d < this.bestD[k]) {
            this.bestD[k] = d;
            this.bestH[k] = ay + ey * t;
          }
          // Cells: use the cell this vertex is the low corner of.
          if (ix < w.nx && iz < w.nz) {
            const xc = x + w.cell / 2;
            const zc = z + w.cell / 2;
            let tc = l2 > 1e-12 ? ((xc - ax) * ex + (zc - az) * ez) / l2 : 0;
            if (tc < 0) tc = 0;
            else if (tc > 1) tc = 1;
            const cdx = xc - (ax + ex * tc);
            const cdz = zc - (az + ez * tc);
            const cd = Math.sqrt(cdx * cdx + cdz * cdz);
            const ci = iz * w.nx + ix;
            if (this.cellStamp[ci] !== g) {
              this.cellStamp[ci] = g;
              this.cellD[ci] = cd;
              this.cellSeg[ci] = s;
              touchedCells.push(ci);
            } else if (cd < this.cellD[ci]) {
              this.cellD[ci] = cd;
              this.cellSeg[ci] = s;
            }
          }
        }
      }
    }
    for (const k of touched) {
      const d = this.bestD[k];
      const wt = d <= c.half ? 1 : fade(d - c.half, c.blend);
      w.heights[k] += (this.bestH[k] - w.heights[k]) * wt;
    }
    for (const ci of touchedCells) {
      if (this.cellD[ci] > c.half) continue;
      const s = typeof c.surf === 'number' ? c.surf : c.surf(this.cellSeg[ci]);
      if (s >= 0) w.surfaces[ci] = s;
      this.cliff[ci] = 0;
    }
  }

  /** Vertex heights of a cell: min and max. */
  cellRange(ix: number, iz: number, out: { lo: number; hi: number }): void {
    const h = this.w.heights;
    const k = iz * this.row + ix;
    const a = h[k];
    const b = h[k + 1];
    const c = h[k + this.row];
    const d = h[k + this.row + 1];
    out.lo = Math.min(a, b, c, d);
    out.hi = Math.max(a, b, c, d);
  }

  /** Steepest grade of the cell's two triangles (the split world.ts uses). */
  cellGrade(ix: number, iz: number): number {
    const h = this.w.heights;
    const k = iz * this.row + ix;
    const h00 = h[k];
    const h10 = h[k + 1];
    const h01 = h[k + this.row];
    const h11 = h[k + this.row + 1];
    const c = this.w.cell;
    const a = Math.sqrt((h10 - h00) * (h10 - h00) + (h11 - h10) * (h11 - h10)) / c;
    const b = Math.sqrt((h11 - h01) * (h11 - h01) + (h01 - h00) * (h01 - h00)) / c;
    return a > b ? a : b;
  }

  /**
   * Turn flagged steps and every uncovered cell steeper than 100% into wall solids, merged along
   * rows. Returns the number of walls added.
   */
  buildWalls(style = 0): number {
    const w = this.w;
    const r = { lo: 0, hi: 0 };
    const isWall = new Uint8Array(w.nx * w.nz);
    const lo = new Float64Array(w.nx * w.nz);
    const hi = new Float64Array(w.nx * w.nz);
    for (let iz = 0; iz < w.nz; iz++) {
      for (let ix = 0; ix < w.nx; ix++) {
        const ci = iz * w.nx + ix;
        if (w.surfaces[ci] === Surface.WATER) continue;
        this.cellRange(ix, iz, r);
        // The step across a flagged edge (not the slope along it).
        const hh = w.heights;
        const k = iz * this.row + ix;
        const across =
          this.cliff[ci] === 1
            ? Math.max(Math.abs(hh[k + 1] - hh[k]), Math.abs(hh[k + this.row + 1] - hh[k + this.row]))
            : this.cliff[ci] === 2
              ? Math.max(Math.abs(hh[k + this.row] - hh[k]), Math.abs(hh[k + this.row + 1] - hh[k + 1]))
              : 0;
        const step = this.cliff[ci] === 1 ? 0.5 : 1.2;
        if ((this.cliff[ci] && across > step) || this.cellGrade(ix, iz) > 0.98) {
          isWall[ci] = 1;
          lo[ci] = r.lo;
          hi[ci] = r.hi;
        }
      }
    }
    let count = 0;
    const used = new Uint8Array(w.nx * w.nz);
    // Runs along x first, then the leftovers along z.
    for (let iz = 0; iz < w.nz; iz++) {
      let ix = 0;
      while (ix < w.nx) {
        const ci = iz * w.nx + ix;
        if (!isWall[ci]) {
          ix++;
          continue;
        }
        let end = ix;
        let top = hi[ci];
        let topLo = hi[ci];
        let base = lo[ci];
        // A run's top is its highest cell: keep the run's tops within WALL_TOP_TOL of each other so
        // the wall never stands proud of the ground it holds up (merging step by step would let a
        // wall along a sloping road creep metres above its low end).
        while (end + 1 < w.nx) {
          const cj = iz * w.nx + end + 1;
          if (!isWall[cj] || Math.max(top, hi[cj]) - Math.min(topLo, hi[cj]) > WALL_TOP_TOL) break;
          top = Math.max(top, hi[cj]);
          topLo = Math.min(topLo, hi[cj]);
          base = Math.min(base, lo[cj]);
          end++;
        }
        if (end > ix) {
          for (let k = ix; k <= end; k++) used[iz * w.nx + k] = 1;
          this.addWall(ix, end, iz, iz, base, top, style);
          count++;
        }
        ix = end + 1;
      }
    }
    for (let ix = 0; ix < w.nx; ix++) {
      let iz = 0;
      while (iz < w.nz) {
        const ci = iz * w.nx + ix;
        if (!isWall[ci] || used[ci]) {
          iz++;
          continue;
        }
        let end = iz;
        let top = hi[ci];
        let topLo = hi[ci];
        let base = lo[ci];
        while (end + 1 < w.nz) {
          const cj = (end + 1) * w.nx + ix;
          if (!isWall[cj] || used[cj] || Math.max(top, hi[cj]) - Math.min(topLo, hi[cj]) > WALL_TOP_TOL) break;
          top = Math.max(top, hi[cj]);
          topLo = Math.min(topLo, hi[cj]);
          base = Math.min(base, lo[cj]);
          end++;
        }
        this.addWall(ix, ix, iz, end, base, top, style);
        count++;
        iz = end + 1;
      }
    }
    return count;
  }

  private addWall(ix0: number, ix1: number, iz0: number, iz1: number, base: number, top: number, style: number): void {
    const w = this.w;
    const x0 = w.minX + ix0 * w.cell;
    const x1 = w.minX + (ix1 + 1) * w.cell;
    const z0 = w.minZ + iz0 * w.cell;
    const z1 = w.minZ + (iz1 + 1) * w.cell;
    addSolid(w, {
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      hx: (x1 - x0) / 2,
      hz: (z1 - z0) / 2,
      rot: 0,
      yBase: base - 0.5,
      yTop: top,
      surface: Surface.PLAZA,
      kind: 'wall',
      style,
    });
  }

  /** Paint a rectangle of cells (centres inside) without touching heights. */
  paint(x0: number, x1: number, z0: number, z1: number, s: number): void {
    const w = this.w;
    const ix0 = Math.max(0, this.ixOf(x0) - 1);
    const ix1 = Math.min(w.nx - 1, this.ixOf(x1) + 1);
    const iz0 = Math.max(0, this.izOf(z0) - 1);
    const iz1 = Math.min(w.nz - 1, this.izOf(z1) + 1);
    for (let iz = iz0; iz <= iz1; iz++) {
      const zc = w.minZ + (iz + 0.5) * w.cell;
      if (zc < z0 || zc > z1) continue;
      for (let ix = ix0; ix <= ix1; ix++) {
        const xc = w.minX + (ix + 0.5) * w.cell;
        if (xc < x0 || xc > x1) continue;
        w.surfaces[iz * w.nx + ix] = s;
      }
    }
  }
}

/** Most a merged wall's top may differ along its length, m. */
const WALL_TOP_TOL = 0.3;

/** Weight 1 at d = 0 fading smoothly to 0 at d = b. */
function fade(d: number, b: number): number {
  if (d <= 1e-9) return 1;
  if (b <= 0) return 0;
  const t = 1 - d / b;
  if (t <= 0) return 0;
  return t * t * (3 - 2 * t);
}
