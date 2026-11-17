// App icons, drawn procedurally and encoded as PNG by hand (zlib is in Node), so the repo holds no
// binary assets. Run before `vite build`: writes public/icon-192.png, icon-512.png,
// icon-maskable-512.png and apple-touch-icon.png. Deterministic: same bytes on every run.
//
// The mark: a mango skateboard seen from above on ink, a pink strap looping off its nose (the
// hitch), a halftone dot shadow, and the cobalt plate printed a pixel off-register.
//   node scripts/make-icons.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PALETTE = {
  ink: [0x1b, 0x1a, 0x2e],
  mango: [0xff, 0xae, 0x1a],
  pink: [0xff, 0x2e, 0x88],
  cobalt: [0x1f, 0x3f, 0xbf],
  paper: [0xf3, 0xeb, 0xdd],
};

/** The icons the manifest and index.html declare. */
export const ICONS = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'apple' },
];

/** Fraction of the icon (from the centre, as a radius over half the size) the maskable mark keeps inside. */
export const MASKABLE_SAFE_RADIUS = 0.8;

// ---------------------------------------------------------------------------------------------
// The mark, in unit coordinates: x right, y down. MARK_RADIUS (measured below) holds all of it.

const DECK = { cx: -0.1, cy: 0.16, angle: -0.6, half: 0.4, r: 0.18 };
const DECK_DIR = [Math.cos(DECK.angle), Math.sin(DECK.angle)];
const NOSE = [DECK.cx + DECK_DIR[0] * DECK.half, DECK.cy + DECK_DIR[1] * DECK.half];
/** The strap leaves the nose, swings out and loops back over itself, like a tow rope with a handle. */
const STRAP_POINTS = [
  NOSE,
  [0.36, -0.1],
  [0.52, -0.26],
  [0.56, -0.48],
  [0.42, -0.62],
  [0.24, -0.56],
  [0.22, -0.38],
  [0.38, -0.3],
  [0.6, -0.36],
  [0.74, -0.5],
];
const STRAP_WIDTH = 0.1;
const SHADOW = { dx: 0.08, dy: 0.11, pitch: 0.06, dot: 0.0125 };

function capsuleDist(x, y, cx, cy, dir, half, r) {
  const px = x - cx;
  const py = y - cy;
  let t = px * dir[0] + py * dir[1];
  t = Math.max(-half, Math.min(half, t));
  const qx = px - dir[0] * t;
  const qy = py - dir[1] * t;
  return Math.sqrt(qx * qx + qy * qy) - r;
}

function segmentDist(x, y, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  let t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy);
  t = Math.max(0, Math.min(1, t));
  const dx = x - ax - vx * t;
  const dy = y - ay - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** A Catmull-Rom curve through the points, as a dense polyline. */
function smooth(pts, per) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const STRAP = smooth(STRAP_POINTS, 12);

const deck = (x, y) => capsuleDist(x, y, DECK.cx, DECK.cy, DECK_DIR, DECK.half, DECK.r);

function strapDist(x, y) {
  let d = Infinity;
  for (let i = 0; i < STRAP.length - 1; i++) {
    const a = STRAP[i];
    const b = STRAP[i + 1];
    // Cheap reject: both ends far away.
    if (Math.abs(x - a[0]) > 0.2 && Math.abs(x - b[0]) > 0.2) continue;
    d = Math.min(d, segmentDist(x, y, a[0], a[1], b[0], b[1]));
  }
  return d - STRAP_WIDTH / 2;
}

/** Halftone dot shadow of the deck, on a 45-degree screen. */
function shadowDot(x, y) {
  if (deck(x - SHADOW.dx, y - SHADOW.dy) >= 0) return false;
  const u = (x + y) / SHADOW.pitch;
  const v = (x - y) / SHADOW.pitch;
  const fu = u - Math.round(u);
  const fv = v - Math.round(v);
  return Math.sqrt(fu * fu + fv * fv) * SHADOW.pitch * Math.SQRT1_2 < SHADOW.dot;
}

/**
 * Colour at a unit point for the full mark, with the cobalt plate offset by `reg` (unit units) and
 * the strap printed in pink.
 */
function sample(x, y, reg) {
  let col = shadowDot(x, y) ? PALETTE.cobalt : null;
  // Cobalt plate: the deck, off-register down-left.
  if (deck(x + reg, y - reg) < 0) col = PALETTE.cobalt;
  // Mango deck on top, with ink truck bars and paper bolts.
  const dk = deck(x, y);
  if (dk < 0) {
    col = PALETTE.mango;
    const px = x - DECK.cx;
    const py = y - DECK.cy;
    const along = px * DECK_DIR[0] + py * DECK_DIR[1];
    const across = -px * DECK_DIR[1] + py * DECK_DIR[0];
    for (const at of [-0.24, 0.24]) {
      if (Math.abs(along - at) < 0.035 && Math.abs(across) < DECK.r * 0.78) col = PALETTE.ink;
    }
    // Grip tape line near the edge: a thin ink rule inset from the outline.
    if (dk > -0.03 && dk < -0.018) col = PALETTE.ink;
  }
  if (strapDist(x, y) < 0) col = PALETTE.pink;
  return col;
}

/**
 * Radius of a circle around the origin that holds every inked point of the mark (measured on a
 * fine grid, plus the off-register shift and a margin), so each icon can size the mark to fit.
 */
const MEASURED = (() => {
  const N = 600;
  const inked = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -1.2 + (2.4 * i) / N;
      const y = -1.2 + (2.4 * j) / N;
      if (sample(x, y, 0) === null) continue;
      inked.push(x, y);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let r = 0;
  for (let k = 0; k < inked.length; k += 2) r = Math.max(r, Math.hypot(inked[k] - cx, inked[k + 1] - cy));
  return { cx, cy, r: r + 0.03 };
})();
/** Centre of the mark's bounding box, in unit coordinates: icons put it at their centre. */
export const MARK_CENTRE = [MEASURED.cx, MEASURED.cy];
export const MARK_RADIUS = MEASURED.r;

/**
 * Render an icon into an RGBA buffer. kind: 'any' (rounded square plate, transparent corners),
 * 'maskable' (full bleed, mark inside the safe zone), 'apple' (full bleed square, iOS rounds it).
 */
export function renderIcon(size, kind) {
  const out = new Uint8Array(size * size * 4);
  // Scale from unit mark coordinates to pixels: the mark's radius maps to this share of half the size.
  const fill = kind === 'maskable' ? (MASKABLE_SAFE_RADIUS - 0.04) : 0.98;
  const scale = (fill / MARK_RADIUS) * (size / 2);
  // One printer's pixel off-register: about a hundredth of the icon.
  const reg = Math.max(1, Math.round(size / 100)) / scale;
  const corner = kind === 'any' ? size * 0.2 : 0;
  const SS = 4;
  const half = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          if (corner > 0 && !insideRoundedSquare(fx, fy, size, corner)) continue;
          const col = sample((fx - half) / scale + MEASURED.cx, (fy - half) / scale + MEASURED.cy, reg) ?? PALETTE.ink;
          r += col[0];
          g += col[1];
          b += col[2];
          a += 1;
        }
      }
      const o = (py * size + px) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return out;
}

function insideRoundedSquare(x, y, size, r) {
  const cx = Math.max(r, Math.min(size - r, x));
  const cy = Math.max(r, Math.min(size - r, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------------------------------------
// PNG encoder: 8-bit RGBA, no interlace, filter 0 on every row.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/** Encode an RGBA buffer as a PNG file. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Render every icon. Returns [{ file, size, kind, png }]. */
export function makeIcons() {
  return ICONS.map((icon) => ({ ...icon, png: encodePng(icon.size, icon.size, renderIcon(icon.size, icon.kind)) }));
}

/** Render every icon and write it into `outDir`. */
export function writeIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const made = makeIcons();
  for (const icon of made) writeFileSync(join(outDir, icon.file), icon.png);
  return made;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = resolve(process.argv[2] ?? join(ROOT, 'public'));
  const made = writeIcons(outDir);
  console.log(`[icons] ${made.map((m) => `${m.file} (${m.png.length} B)`).join(', ')} -> ${outDir}`);
}
