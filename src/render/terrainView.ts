/**
 * The ground as one mesh, for any `Terrain`.
 *
 * `heightAt` is sampled on a 2 m grid over the terrain's disc. Each triangle carries its own colour
 * (non-indexed geometry), so the checker of 8 m squares, the 32 m lines and the rim shading stay crisp
 * under flat shading: speed and slope read without any texture. Grid points outside the disc are
 * pulled onto its edge, so the mesh ends in a clean circle. Boost pads are a second mesh: flat discs
 * that follow the ground just above it. Two draw calls at most.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, type Object3D } from 'three';
import type { Terrain } from '../sim/terrain';
import { PALETTE, flatMaterial } from './look';

/** Grid spacing, m. */
export const TERRAIN_CELL = 2;
/** Side of a checker square, m. */
export const CHECKER = 4;
/** Every this many metres a grid line is drawn in `PALETTE.groundLine`. */
export const LINE_EVERY = 16;
/**
 * Most ground triangles one view may hold. Up to a radius of about 270 m the grid is 2 m; beyond
 * that the cell doubles until the disc fits, so a huge test terrain still draws.
 */
export const MAX_GROUND_TRIANGLES = 100_000;
/** Height above the floor where the rim tint starts, and where it is full, m. */
const RIM_START = 8;
const RIM_FULL = 30;
/** How far the rim tint goes toward `PALETTE.rim`, 0..1. */
const RIM_MIX = 0.85;
/** How far boost pads sit above the ground, m. */
const PAD_LIFT = 0.06;
const PAD_SEGMENTS = 24;
/** Twice the plan area below which an edge triangle is dropped, m^2. */
const MIN_AREA = 1e-4;

export const GROUND_NAME = 'ground';
export const PADS_NAME = 'pads';

/** Cell size for a disc of `radius`: 2 m, doubled until the triangle count fits. */
export function terrainCellFor(radius: number): number {
  let cell = TERRAIN_CELL;
  // A disc of radius r on cells of size c covers about pi r^2 / c^2 cells of two triangles each.
  while ((2 * Math.PI * radius * radius) / (cell * cell) > MAX_GROUND_TRIANGLES * 0.95) cell *= 2;
  return cell;
}

function smooth(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Integer floor division that is right for negatives. */
function fdiv(v: number, d: number): number {
  return Math.floor(v / d);
}

/** The floor height: the mean over the inner three quarters of the disc. Rim tint is measured from it. */
function floorHeight(terrain: Terrain, cell: number): number {
  const r = terrain.radius * 0.75;
  const n = Math.ceil(r / cell);
  let sum = 0;
  let count = 0;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x = i * cell;
      const z = j * cell;
      if (x * x + z * z > r * r) continue;
      sum += terrain.heightAt(x, z);
      count++;
    }
  }
  return count > 0 ? sum / count : terrain.heightAt(0, 0);
}

function buildGround(terrain: Terrain): Mesh {
  const R = terrain.radius;
  const cell = terrainCellFor(R);
  const n = Math.ceil(R / cell);
  const side = 2 * n + 1;
  const floor = floorHeight(terrain, cell);

  // Grid points, with those outside the disc pulled onto its edge.
  const gx = new Float32Array(side * side);
  const gz = new Float32Array(side * side);
  const gy = new Float32Array(side * side);
  const inside = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      let x = (i - n) * cell;
      let z = (j - n) * cell;
      const r = Math.sqrt(x * x + z * z);
      if (r <= R) inside[k] = 1;
      else {
        x *= R / r;
        z *= R / r;
      }
      gx[k] = x;
      gz[k] = z;
      gy[k] = terrain.heightAt(x, z);
    }
  }

  const cA = new Color(PALETTE.groundA);
  const cB = new Color(PALETTE.groundB);
  const cLine = new Color(PALETTE.groundLine);
  const cRim = new Color(PALETTE.rim);
  const tmp = new Color();

  const pos: number[] = [];
  const col: number[] = [];
  const lineCells = Math.max(1, Math.round(LINE_EVERY / cell));
  const push = (k: number): void => {
    pos.push(gx[k], gy[k], gz[k]);
    col.push(tmp.r, tmp.g, tmp.b);
  };
  /** One triangle, unless pulling its corners onto the edge has squashed it flat or flipped it. */
  const tri = (a: number, b: number, c: number): void => {
    const up = (gz[b] - gz[a]) * (gx[c] - gx[a]) - (gx[b] - gx[a]) * (gz[c] - gz[a]);
    if (up <= MIN_AREA) return;
    push(a);
    push(b);
    push(c);
  };
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const k00 = j * side + i;
      const k10 = k00 + 1;
      const k01 = k00 + side;
      const k11 = k01 + 1;
      // A cell is drawn when any of its corners lies in the disc.
      if (!(inside[k00] | inside[k10] | inside[k01] | inside[k11])) continue;
      const x0 = (i - n) * cell;
      const z0 = (j - n) * cell;
      const onLine = (i - n) % lineCells === 0 || (j - n) % lineCells === 0;
      if (onLine) tmp.copy(cLine);
      else tmp.copy((fdiv(x0, CHECKER) + fdiv(z0, CHECKER)) % 2 === 0 ? cA : cB);
      const h = (gy[k00] + gy[k10] + gy[k01] + gy[k11]) * 0.25 - floor;
      const rim = smooth((h - RIM_START) / (RIM_FULL - RIM_START)) * RIM_MIX;
      if (rim > 0) tmp.lerp(cRim, rim);
      // Wound so the face points up: (x, z), (x, z + 1), (x + 1, z).
      tri(k00, k01, k10);
      tri(k10, k01, k11);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Vertex colours carry the whole colour; the material's own colour is white so they show as is.
  const mesh = new Mesh(geo, flatMaterial(0xffffff, true));
  mesh.name = GROUND_NAME;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function buildPads(terrain: Terrain): Mesh | null {
  if (terrain.pads.length === 0) return null;
  const pos: number[] = [];
  for (const p of terrain.pads) {
    for (let s = 0; s < PAD_SEGMENTS; s++) {
      const a0 = (s / PAD_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / PAD_SEGMENTS) * Math.PI * 2;
      const x0 = p.x + Math.sin(a0) * p.radius;
      const z0 = p.z + Math.cos(a0) * p.radius;
      const x1 = p.x + Math.sin(a1) * p.radius;
      const z1 = p.z + Math.cos(a1) * p.radius;
      // Centre, then the rim in order of increasing angle, which makes the face point up.
      pos.push(p.x, terrain.heightAt(p.x, p.z) + PAD_LIFT, p.z);
      pos.push(x0, terrain.heightAt(x0, z0) + PAD_LIFT, z0);
      pos.push(x1, terrain.heightAt(x1, z1) + PAD_LIFT, z1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new Mesh(geo, flatMaterial(PALETTE.pad));
  mesh.name = PADS_NAME;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function makeTerrainView(terrain: Terrain): Object3D {
  const group = new Group();
  group.name = 'terrain';
  group.add(buildGround(terrain));
  const pads = buildPads(terrain);
  if (pads) group.add(pads);
  group.matrixAutoUpdate = false;
  return group;
}
