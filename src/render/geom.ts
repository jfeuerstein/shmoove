/**
 * MeshBuilder: accumulate flat-coloured quads, boxes and beams into one BufferGeometry for
 * `inkMaterial()`. Colours are 0xRRGGBB display values. Faces are wound counter-clockwise seen
 * from outside. No normals: the ink shader derives flat normals itself.
 */
import * as THREE from 'three';

export class MeshBuilder {
  // Growable typed storage (doubling): pushing into big JS arrays and converting them in build()
  // was a large share of a chunk build. Positions stay doubles until build(), exactly as before,
  // so append() transforms the same numbers; colours and glow are stored as the float32 values
  // build() produced anyway, so every built geometry is identical.
  private pos = new Float64Array(96);
  private col = new Float32Array(96);
  private glo = new Float32Array(32);
  private idx = new Uint32Array(96);
  private nv = 0;
  private ni = 0;
  private anyGlow = false;

  get vertexCount(): number {
    return this.nv;
  }

  get triangleCount(): number {
    return this.ni / 3;
  }

  private growVerts(need: number): void {
    let cap = this.glo.length;
    if (need <= cap) return;
    while (cap < need) cap *= 2;
    const pos = new Float64Array(cap * 3);
    pos.set(this.pos.subarray(0, this.nv * 3));
    this.pos = pos;
    const col = new Float32Array(cap * 3);
    col.set(this.col.subarray(0, this.nv * 3));
    this.col = col;
    const glo = new Float32Array(cap);
    glo.set(this.glo.subarray(0, this.nv));
    this.glo = glo;
  }

  private growIdx(need: number): void {
    let cap = this.idx.length;
    if (need <= cap) return;
    while (cap < need) cap *= 2;
    const idx = new Uint32Array(cap);
    idx.set(this.idx.subarray(0, this.ni));
    this.idx = idx;
  }

  vert(x: number, y: number, z: number, color: number, glow = 0): number {
    const v = this.nv;
    if (v >= this.glo.length) this.growVerts(v + 1);
    const k = v * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.col[k] = ((color >> 16) & 255) / 255;
    this.col[k + 1] = ((color >> 8) & 255) / 255;
    this.col[k + 2] = (color & 255) / 255;
    this.glo[v] = glow;
    if (glow > 0) this.anyGlow = true;
    this.nv = v + 1;
    return v;
  }

  private pushIdx3(a: number, b: number, c: number): void {
    const n = this.ni;
    if (n + 3 > this.idx.length) this.growIdx(n + 3);
    this.idx[n] = a;
    this.idx[n + 1] = b;
    this.idx[n + 2] = c;
    this.ni = n + 3;
  }

  tri(a: number, b: number, c: number): void {
    this.pushIdx3(a, b, c);
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
    this.pushIdx3(a, b, c);
    this.pushIdx3(a, c, d);
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
    const base = this.nv;
    const n = other.nv;
    this.growVerts(base + n);
    const v = new THREE.Vector3();
    const op = other.pos;
    for (let i = 0; i < n; i++) {
      v.set(op[i * 3], op[i * 3 + 1], op[i * 3 + 2]).applyMatrix4(m);
      const k = (base + i) * 3;
      this.pos[k] = v.x;
      this.pos[k + 1] = v.y;
      this.pos[k + 2] = v.z;
    }
    this.col.set(other.col.subarray(0, n * 3), base * 3);
    this.glo.set(other.glo.subarray(0, n), base);
    this.nv = base + n;
    if (other.anyGlow) this.anyGlow = true;
    const ni = other.ni;
    this.growIdx(this.ni + ni);
    for (let i = 0; i < ni; i++) this.idx[this.ni + i] = other.idx[i] + base;
    this.ni += ni;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos.subarray(0, n * 3)), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    if (this.anyGlow) g.setAttribute('glow', new THREE.BufferAttribute(this.glo.slice(0, n), 1));
    const idx = this.idx.subarray(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? idx.slice() : new Uint16Array(idx), 1));
    // Bounds in one pass over the doubles: the box, and the sphere around the box. three's own
    // pair walks the vertices three times, which was most of the cost of this call on a big chunk
    // (and this call is the largest single piece of a streamed chunk build). The sphere is a
    // little larger than the tightest one, which only makes culling conservative.
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    const pos = this.pos;
    for (let k = 0; k < n * 3; k += 3) {
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    if (n === 0) x0 = y0 = z0 = x1 = y1 = z1 = 0;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    const centre = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.boundingSphere = new THREE.Sphere(centre, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1e-4);
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
