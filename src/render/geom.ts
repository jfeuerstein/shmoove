/**
 * MeshBuilder: accumulate flat-coloured quads, boxes and beams into one BufferGeometry for
 * `inkMaterial()`. Colours are 0xRRGGBB display values. Faces are wound counter-clockwise seen
 * from outside. No normals: the ink shader derives flat normals itself.
 */
import * as THREE from 'three';

export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private glo: number[] = [];
  private idx: number[] = [];
  private anyGlow = false;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  vert(x: number, y: number, z: number, color: number, glow = 0): number {
    this.pos.push(x, y, z);
    this.col.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    this.glo.push(glow);
    if (glow > 0) this.anyGlow = true;
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad a-b-c-d, counter-clockwise seen from its front. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: number,
    glow = 0,
  ): void {
    const a = this.vert(ax, ay, az, color, glow);
    const b = this.vert(bx, by, bz, color, glow);
    const c = this.vert(cx, cy, cz, color, glow);
    const d = this.vert(dx, dy, dz, color, glow);
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Box centred at (cx, cy, cz) with half extents (hx, hy, hz), yawed so its local +x axis is
   * (cosR, sinR) in world (x, z), the same convention as a sim Solid. `top` recolours the lid.
   */
  box(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    cosR: number, sinR: number,
    color: number,
    opts: { top?: number; bottom?: boolean; glow?: number; noTop?: boolean } = {},
  ): void {
    const g = opts.glow ?? 0;
    const px = (lx: number, lz: number): number => cx + lx * cosR - lz * sinR;
    const pz = (lx: number, lz: number): number => cz + lx * sinR + lz * cosR;
    const y0 = cy - hy;
    const y1 = cy + hy;
    // +x, -x, +z, -z sides.
    this.quad(px(hx, -hz), y0, pz(hx, -hz), px(hx, -hz), y1, pz(hx, -hz), px(hx, hz), y1, pz(hx, hz), px(hx, hz), y0, pz(hx, hz), color, g);
    this.quad(px(-hx, hz), y0, pz(-hx, hz), px(-hx, hz), y1, pz(-hx, hz), px(-hx, -hz), y1, pz(-hx, -hz), px(-hx, -hz), y0, pz(-hx, -hz), color, g);
    this.quad(px(hx, hz), y0, pz(hx, hz), px(hx, hz), y1, pz(hx, hz), px(-hx, hz), y1, pz(-hx, hz), px(-hx, hz), y0, pz(-hx, hz), color, g);
    this.quad(px(-hx, -hz), y0, pz(-hx, -hz), px(-hx, -hz), y1, pz(-hx, -hz), px(hx, -hz), y1, pz(hx, -hz), px(hx, -hz), y0, pz(hx, -hz), color, g);
    if (!opts.noTop) {
      this.quad(px(-hx, -hz), y1, pz(-hx, -hz), px(-hx, hz), y1, pz(-hx, hz), px(hx, hz), y1, pz(hx, hz), px(hx, -hz), y1, pz(hx, -hz), opts.top ?? color, g);
    }
    if (opts.bottom) {
      this.quad(px(-hx, -hz), y0, pz(-hx, -hz), px(hx, -hz), y0, pz(hx, -hz), px(hx, hz), y0, pz(hx, hz), px(-hx, hz), y0, pz(-hx, hz), color, g);
    }
  }

  /** Square-section beam from a to b, `half` thick: rails, posts, wires, straps. */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, half: number, color: number, glow = 0): void {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;
    // Side vector: perpendicular to the beam and as horizontal as possible.
    let sx = dz;
    const sy = 0;
    let sz = -dx;
    let sl = Math.sqrt(sx * sx + sz * sz);
    if (sl < 1e-4) {
      sx = 1;
      sz = 0;
      sl = 1;
    }
    sx /= sl;
    sz /= sl;
    // Up vector: side x dir.
    const ux = sy * dz - sz * dy;
    const uy = sz * dx - sx * dz;
    const uz = sx * dy - sy * dx;
    const h = half;
    const c = (e: number, s: number, u: number, k: number): number => {
      const base = k === 0 ? (e ? bx : ax) : k === 1 ? (e ? by : ay) : e ? bz : az;
      const sv = k === 0 ? sx : k === 1 ? sy : sz;
      const uv = k === 0 ? ux : k === 1 ? uy : uz;
      return base + sv * s * h + uv * u * h;
    };
    const face = (s0: number, u0: number, s1: number, u1: number): void => {
      this.quad(
        c(0, s0, u0, 0), c(0, s0, u0, 1), c(0, s0, u0, 2),
        c(1, s0, u0, 0), c(1, s0, u0, 1), c(1, s0, u0, 2),
        c(1, s1, u1, 0), c(1, s1, u1, 1), c(1, s1, u1, 2),
        c(0, s1, u1, 0), c(0, s1, u1, 1), c(0, s1, u1, 2),
        color,
        glow,
      );
    };
    face(1, 1, -1, 1);
    face(-1, 1, -1, -1);
    face(-1, -1, 1, -1);
    face(1, -1, 1, 1);
  }

  /** Append another builder's contents, transformed by `m`. */
  append(other: MeshBuilder, m: THREE.Matrix4): void {
    const base = this.vertexCount;
    const v = new THREE.Vector3();
    for (let i = 0; i < other.pos.length; i += 3) {
      v.set(other.pos[i], other.pos[i + 1], other.pos[i + 2]).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
    }
    for (const c of other.col) this.col.push(c);
    for (const g of other.glo) this.glo.push(g);
    if (other.anyGlow) this.anyGlow = true;
    for (const i of other.idx) this.idx.push(i + base);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    if (this.anyGlow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(this.glo), 1));
    const n = this.pos.length / 3;
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Small deterministic hash for dressing decisions (which windows are lit, colour jitter). */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Scale a colour's brightness: k = 1 leaves it, below darkens, above lightens (clamped). */
export function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}
