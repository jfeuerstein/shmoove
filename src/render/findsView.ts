/**
 * Painted tiles in the world, and the burst of paper squares when one is taken.
 *
 * A tile is a small square hanging in the air, turning on twos: a paper face with a mango diamond on
 * both sides, in a border that says its tier (mango for a tile on the line, pink for a detour,
 * cobalt double-framed for a hidden one). The faces glow at night; the borders do not, so the tier
 * still reads. Taken tiles are gone.
 *
 * Draw calls: two at most. Every tile within TILE_RANGE of the camera is copied from its tier's
 * template into one dynamic mesh, rewritten only when the animation frame (12 Hz) changes or a tile
 * is taken; the bursts are a second dynamic mesh, drawn only while one is flying. Nothing is
 * allocated per frame.
 *
 * It also dresses the skater in the deck and kit the wardrobe has on (when they change).
 */
import * as THREE from 'three';
import { wornDeck, wornKit } from '../sim/game/finds';
import type { Game, GameEvent } from '../sim/game/game';
import { MeshBuilder, hash2 } from './geom';
import { INK, inkMaterial } from './look';
import type { SkaterPalette, SkaterView } from './skater';

export interface FindsView {
  update(game: Game, events: readonly GameEvent[], camera: THREE.Camera, dt: number): void;
  /** Tiles drawn in the last frame, bursts flying. */
  readonly drawn: number;
  readonly bursts: number;
  dispose(): void;
}

/** Tiles further than this from the camera are not drawn, m. */
export const TILE_RANGE = 120;
/** Most tiles in range at once (the rest wait their turn, nearest first is not needed: worlds place 60). */
const MAX_TILES = 96;
/** Sim ticks per animation frame: 12 Hz, like the skater. */
const TWOS = 5;
/** Yaw per animation frame, rad. */
const TURN = 0.42;
const HALF = 0.5;
const THICK = 0.045;
const BORDER = [INK.mango, INK.pink, INK.cobalt] as const;
const PAPERS = [INK.paper, INK.mango, INK.pink, INK.white, INK.teal] as const;
const PIECES = 12;
const MAX_BURSTS = 4;
const BURST_LIFE = 0.75;
const GRAVITY = 7;

interface Template {
  pos: Float32Array;
  col: Float32Array;
  glo: Float32Array;
  idx: Uint32Array;
  nv: number;
}

function templateOf(b: MeshBuilder): Template {
  const g = b.build();
  const pos = Float32Array.from(g.getAttribute('position').array as Float32Array);
  const col = Float32Array.from(g.getAttribute('color').array as Float32Array);
  const ga = g.getAttribute('glow');
  const nv = pos.length / 3;
  const glo = ga ? Float32Array.from(ga.array as Float32Array) : new Float32Array(nv);
  const index = g.getIndex();
  const idx = new Uint32Array(index ? (index.array as ArrayLike<number>) : []);
  g.dispose();
  return { pos, col, glo, idx, nv };
}

/** One tile, centred at the origin, facing +z (it turns about y). */
function tileTemplate(tier: number): Template {
  const b = new MeshBuilder();
  const border = BORDER[tier] ?? INK.mango;
  b.box(0, 0, 0, HALF, HALF, THICK, 1, 0, border, { bottom: true });
  // The paper face on both sides, a little proud of the border, and the diamond on it.
  const face = tier === 2 ? HALF * 0.62 : HALF * 0.74;
  for (const s of [1, -1]) {
    const z = s * (THICK + 0.004);
    const z2 = s * (THICK + 0.008);
    const quad = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, zz: number, c: number, glow: number): void => {
      // Wound to face out on this side.
      if (s > 0) b.quad(ax, ay, zz, bx, by, zz, cx, cy, zz, dx, dy, zz, c, glow);
      else b.quad(dx, dy, zz, cx, cy, zz, bx, by, zz, ax, ay, zz, c, glow);
    };
    quad(-face, -face, face, -face, face, face, -face, face, z, INK.paper, 0.75);
    const d = face * 0.62;
    quad(0, -d, d, 0, 0, d, -d, 0, z2, tier === 2 ? INK.cobalt : INK.mango, 0.4);
    if (tier === 2) {
      // A hidden tile has a second, inner frame.
      const f = face * 1.18;
      const w = 0.03;
      quad(-f, f - w, f, f - w, f, f, -f, f, z, INK.cobalt, 0);
      quad(-f, -f, f, -f, f, -f + w, -f, -f + w, z, INK.cobalt, 0);
    }
  }
  // A thread up to where it hangs from.
  b.box(0, HALF + 0.22, 0, 0.008, 0.22, 0.008, 1, 0, INK.ink, {});
  return templateOf(b);
}

/** A paper square, both sides, in the xz plane at the origin (tumbled by the update). */
function pieceTemplate(color: number): Template {
  const b = new MeshBuilder();
  const h = 0.07;
  b.quad(-h, 0, -h, -h, 0, h, h, 0, h, h, 0, -h, color, 0.5);
  b.quad(h, 0, -h, h, 0, h, -h, 0, h, -h, 0, -h, color, 0.5);
  return templateOf(b);
}

interface Dyn {
  pos: Float32Array;
  col: Float32Array;
  glo: Float32Array;
  idx: Uint32Array;
  geo: THREE.BufferGeometry;
  posA: THREE.BufferAttribute;
  colA: THREE.BufferAttribute;
  gloA: THREE.BufferAttribute;
  idxA: THREE.BufferAttribute;
  mesh: THREE.Mesh;
  nv: number;
  ni: number;
}

function dynMesh(name: string, capV: number, capI: number): Dyn {
  const pos = new Float32Array(capV * 3);
  const col = new Float32Array(capV * 3);
  const glo = new Float32Array(capV);
  const idx = new Uint32Array(capI);
  const geo = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(pos, 3);
  const colA = new THREE.BufferAttribute(col, 3);
  const gloA = new THREE.BufferAttribute(glo, 1);
  const idxA = new THREE.BufferAttribute(idx, 1);
  for (const a of [posA, colA, gloA, idxA]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posA);
  geo.setAttribute('color', colA);
  geo.setAttribute('glow', gloA);
  geo.setIndex(idxA);
  geo.setDrawRange(0, 0);
  // Plain ink: these move, so they must not carry the world's printed pavers.
  const mesh = new THREE.Mesh(geo, inkMaterial());
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  return { pos, col, glo, idx, geo, posA, colA, gloA, idxA, mesh, nv: 0, ni: 0 };
}

/** Copy a template in at (x, y, z), yawed by (cs, sn) about y and pitched by (cp, sp) about x first. */
function put(d: Dyn, t: Template, x: number, y: number, z: number, cs: number, sn: number, cp = 1, sp = 0): void {
  const base = d.nv;
  const tp = t.pos;
  for (let i = 0; i < t.nv; i++) {
    const lx = tp[i * 3];
    const ly0 = tp[i * 3 + 1];
    const lz0 = tp[i * 3 + 2];
    const ly = ly0 * cp - lz0 * sp;
    const lz = ly0 * sp + lz0 * cp;
    const k = (base + i) * 3;
    d.pos[k] = x + lx * cs + lz * sn;
    d.pos[k + 1] = y + ly;
    d.pos[k + 2] = z - lx * sn + lz * cs;
    d.col[k] = t.col[i * 3];
    d.col[k + 1] = t.col[i * 3 + 1];
    d.col[k + 2] = t.col[i * 3 + 2];
    d.glo[base + i] = t.glo[i];
  }
  const ti = t.idx;
  for (let j = 0; j < ti.length; j++) d.idx[d.ni + j] = ti[j] + base;
  d.ni += ti.length;
  d.nv += t.nv;
}

function flush(d: Dyn): void {
  d.geo.setDrawRange(0, d.ni);
  d.mesh.visible = d.ni > 0;
  if (d.ni === 0) return;
  mark(d.posA, d.nv * 3);
  mark(d.colA, d.nv * 3);
  mark(d.gloA, d.nv);
  mark(d.idxA, d.ni);
}

function mark(a: THREE.BufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n);
  a.needsUpdate = true;
}

interface Burst {
  x: number;
  y: number;
  z: number;
  age: number;
  seed: number;
  live: boolean;
}

export function createFindsView(scene: THREE.Scene, skater: SkaterView | null = null): FindsView {
  const tiles = [tileTemplate(0), tileTemplate(1), tileTemplate(2)];
  const pieces = PAPERS.map(pieceTemplate);
  let tv = 0;
  let ti = 0;
  for (const t of tiles) {
    tv = Math.max(tv, t.nv);
    ti = Math.max(ti, t.idx.length);
  }
  const tileMesh = dynMesh('tiles', MAX_TILES * tv, MAX_TILES * ti);
  const burstMesh = dynMesh('tileBursts', MAX_BURSTS * PIECES * pieces[0].nv, MAX_BURSTS * PIECES * pieces[0].idx.length);
  scene.add(tileMesh.mesh, burstMesh.mesh);
  const bursts: Burst[] = [];
  for (let i = 0; i < MAX_BURSTS; i++) bursts.push({ x: 0, y: 0, z: 0, age: 0, seed: 0, live: false });
  let lastFrame = -1;
  let lastCount = -1;
  let lastBurstFrame = -1;
  let drawn = 0;
  let flying = 0;
  let clock = 0;
  let nextBurst = 0;
  let wornDeckId = '';
  let wornKitId = '';
  const pal: SkaterPalette = { deckBase: 0, deckAccent: 0, deckPattern: 0, shirt: 0, trim: 0, cap: 0 };

  return {
    update(game, events, camera, dt) {
      const world = game.sim.world;
      const f = game.finds;
      if (skater && (f.deck !== wornDeckId || f.kit !== wornKitId)) {
        wornDeckId = f.deck;
        wornKitId = f.kit;
        const d = wornDeck(f);
        const k = wornKit(f);
        pal.deckBase = d.base;
        pal.deckAccent = d.accent;
        pal.deckPattern = d.pattern;
        pal.shirt = k.shirt;
        pal.trim = k.trim;
        pal.cap = k.cap;
        skater.setPalette(pal);
      }
      for (const e of events) {
        if (e.type !== 'tile') continue;
        const p = world.pickups[e.index];
        const b = bursts[nextBurst];
        nextBurst = (nextBurst + 1) % MAX_BURSTS;
        b.x = p.x;
        b.y = p.y;
        b.z = p.z;
        b.age = 0;
        b.seed = e.index;
        b.live = true;
      }
      const frame = Math.floor(game.sim.tick / TWOS);
      const cx = camera.position.x;
      const cz = camera.position.z;
      if (frame !== lastFrame || f.count !== lastCount) {
        lastFrame = frame;
        lastCount = f.count;
        tileMesh.nv = 0;
        tileMesh.ni = 0;
        drawn = 0;
        const r2 = TILE_RANGE * TILE_RANGE;
        const list = f.catalog.tiles;
        for (let k = 0; k < list.length && drawn < MAX_TILES; k++) {
          const i = list[k];
          if (f.taken[i]) continue;
          const p = world.pickups[i];
          const dx = p.x - cx;
          const dz = p.z - cz;
          if (dx * dx + dz * dz > r2) continue;
          // Each tile turns on twos from its own start, and bobs a little.
          const a = (frame + i * 3) * TURN;
          const bob = ((frame + i) & 3) === 0 ? 0.05 : ((frame + i) & 3) === 2 ? -0.05 : 0;
          put(tileMesh, tiles[f.catalog.tileTier[i]] ?? tiles[0], p.x, p.y + bob, p.z, Math.cos(a), Math.sin(a));
          drawn++;
        }
        flush(tileMesh);
      }
      // Bursts: paper squares thrown out and falling, stepped on twos.
      clock += dt;
      flying = 0;
      for (const b of bursts) {
        if (!b.live) continue;
        b.age += dt;
        if (b.age >= BURST_LIFE) b.live = false;
        else flying++;
      }
      const bf = Math.floor(clock * 12);
      if (flying > 0 || burstMesh.ni > 0) {
        if (bf !== lastBurstFrame || flying === 0) {
          lastBurstFrame = bf;
          burstMesh.nv = 0;
          burstMesh.ni = 0;
          for (const b of bursts) {
            if (!b.live) continue;
            const t = Math.floor(b.age * 12) / 12;
            for (let j = 0; j < PIECES; j++) {
              const h1 = hash2(b.seed, j);
              const h2 = hash2(j, b.seed + 17);
              const ang = (j / PIECES) * 6.2832 + h1;
              const sp = 2.2 + 2.4 * h2;
              const up = 2 + 3 * h1;
              const x = b.x + Math.cos(ang) * sp * t;
              const z = b.z + Math.sin(ang) * sp * t;
              const y = b.y + up * t - 0.5 * GRAVITY * t * t;
              const spin = (h2 * 6 + t * 14) * (j & 1 ? 1 : -1);
              put(burstMesh, pieces[j % pieces.length], x, y, z, Math.cos(ang + spin), Math.sin(ang + spin), Math.cos(spin * 1.3), Math.sin(spin * 1.3));
            }
          }
          flush(burstMesh);
        }
      }
    },
    get drawn() {
      return drawn;
    },
    get bursts() {
      return flying;
    },
    dispose() {
      scene.remove(tileMesh.mesh, burstMesh.mesh);
      tileMesh.geo.dispose();
      burstMesh.geo.dispose();
    },
  };
}
