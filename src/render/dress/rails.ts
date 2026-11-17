/**
 * Rails by kind. The rail itself is always a beam centred on the sim polyline (never sagged or
 * smoothed), so what you see is what you grind. Posts, flanges, markers and bulbs hang off it.
 */
import { District, districtAt, terrainHeight, type Rail, type World } from '../../sim/world';
import { type MeshBuilder, hash2, shade } from '../geom';
import { INK } from '../look';
import { paletteAt } from './kit';

export const RAIL_KINDS = ['handrail', 'ledge', 'wire', 'pipe', 'guy', 'fence'] as const;

interface RailStyle {
  half: number;
  color: number;
}

function styleOf(w: World, r: Rail): RailStyle {
  switch (r.kind) {
    case 'handrail':
      return { half: 0.05, color: INK.pink };
    case 'ledge':
      return { half: 0.07, color: paletteAt(w, r.pts[2]).accents[0] };
    case 'wire':
      return { half: 0.022, color: INK.ink };
    case 'pipe':
      return { half: 0.17, color: r.index % 2 ? INK.mango : INK.teal };
    case 'guy':
      return { half: 0.028, color: 0x2c2a3c };
    case 'fence':
      return { half: 0.04, color: INK.cobalt };
    default:
      return { half: 0.05, color: INK.ink };
  }
}

function segments(b: MeshBuilder, r: Rail, half: number, color: number): void {
  const p = r.pts;
  const n = p.length / 3;
  for (let i = 0; i < n - 1; i++) b.beam(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5], half, color);
}

/** Visit points every `spacing` metres along the rail (including both ends). */
function along(r: Rail, spacing: number, fn: (x: number, y: number, z: number, tx: number, tz: number, k: number) => void): void {
  const p = r.pts;
  const n = p.length / 3;
  const count = Math.max(1, Math.round(r.length / spacing));
  let seg = 0;
  for (let k = 0; k <= count; k++) {
    const s = (k / count) * r.length;
    while (seg < n - 2 && r.cum[seg + 1] < s) seg++;
    const len = r.cum[seg + 1] - r.cum[seg];
    const t = len > 0 ? Math.min(1, Math.max(0, (s - r.cum[seg]) / len)) : 0;
    const i = seg * 3;
    const dx = p[i + 3] - p[i];
    const dz = p[i + 5] - p[i + 2];
    const hl = Math.sqrt(dx * dx + dz * dz) || 1;
    fn(p[i] + dx * t, p[i + 1] + (p[i + 4] - p[i + 1]) * t, p[i + 2] + dz * t, dx / hl, dz / hl, k);
  }
}

/** Far: the beam alone (it is the outline). */
export function meshRailFar(b: MeshBuilder, w: World, r: Rail): void {
  const st = styleOf(w, r);
  segments(b, r, st.half, st.color);
}

export function meshRailNear(b: MeshBuilder, w: World, r: Rail): void {
  const st = styleOf(w, r);
  segments(b, r, st.half, st.color);
  switch (r.kind) {
    case 'handrail':
      posts(b, w, r, 2.4, 0.04, shade(st.color, 0.75));
      break;
    case 'ledge': {
      // A painted edge strip: the coping in the accent ink with a paper stripe under it.
      const p = r.pts;
      const n = p.length / 3;
      for (let i = 0; i < n - 1; i++) {
        b.beam(p[i * 3], p[i * 3 + 1] - 0.13, p[i * 3 + 2], p[i * 3 + 3], p[i * 3 + 4] - 0.13, p[i * 3 + 5], 0.05, INK.paper);
      }
      break;
    }
    case 'pipe':
      // Flanges every 3 m and supports to the ground.
      along(r, 3, (x, y, z, tx, tz) => {
        b.beam(x - tx * 0.06, y, z - tz * 0.06, x + tx * 0.06, y, z + tz * 0.06, st.half + 0.05, shade(st.color, 0.75));
        const g = terrainHeight(w, x, z);
        if (y - st.half - g > 0.15 && y - g < 6) b.beam(x, g, z, x, y - st.half, z, 0.05, INK.ink);
      });
      break;
    case 'guy':
      // Marker balls every 8 m, pink and white.
      along(r, 8, (x, y, z, _tx, _tz, k) => {
        b.box(x, y, z, 0.13, 0.13, 0.13, 0.7071, 0.7071, k % 2 ? INK.white : INK.pink, { bottom: true });
      });
      break;
    case 'fence':
      posts(b, w, r, 2, 0.035, INK.cobalt);
      {
        const p = r.pts;
        const n = p.length / 3;
        for (let i = 0; i < n - 1; i++) {
          b.beam(p[i * 3], p[i * 3 + 1] - 0.5, p[i * 3 + 2], p[i * 3 + 3], p[i * 3 + 4] - 0.5, p[i * 3 + 5], 0.025, INK.cobalt);
        }
      }
      break;
    case 'wire':
      wireDressing(b, w, r);
      break;
    default:
      break;
  }
}

function posts(b: MeshBuilder, w: World, r: Rail, spacing: number, half: number, color: number): void {
  along(r, spacing, (x, y, z) => {
    const g = terrainHeight(w, x, z);
    if (y - g > 0.1 && y - g < 3) b.beam(x, g, z, x, y, z, half, color);
  });
}

/** Wires carry laundry in the Terraces and strings of bulbs elsewhere (bulbs glow at night). */
function wireDressing(b: MeshBuilder, w: World, r: Rail): void {
  const district = districtAt(w, r.pts[2]);
  const laundry = district === District.TERRACES ? r.index % 3 !== 0 : r.index % 4 === 0;
  if (laundry) {
    const cloth = [INK.pink, INK.white, INK.mango, INK.cobalt, INK.teal, INK.white];
    along(r, 1.1, (x, y, z, tx, tz, k) => {
      if (k === 0 || hash2(r.index, k) < 0.35) return;
      const hw = 0.3;
      const h = 0.5 + 0.35 * hash2(k, r.index);
      const col = cloth[(k + r.index) % cloth.length];
      const ax = x - tx * hw;
      const az = z - tz * hw;
      const bx = x + tx * hw;
      const bz = z + tz * hw;
      b.quad(ax, y - h, az, bx, y - h, bz, bx, y - 0.02, bz, ax, y - 0.02, az, col);
      b.quad(bx, y - h, bz, ax, y - h, az, ax, y - 0.02, az, bx, y - 0.02, bz, shade(col, 0.88));
    });
    return;
  }
  along(r, 1.0, (x, y, z, tx, tz, k) => {
    if (k === 0) return;
    // A bulb on a short drop below the wire.
    b.box(x, y - 0.16, z, 0.06, 0.06, 0.06, tx, tz, k % 3 === 0 ? INK.pink : 0xffe3a0, { glow: 1, bottom: true });
  });
}

