// App icons, drawn procedurally and encoded as PNG by hand (zlib is in Node), so the repo holds no
// binary assets. Run before `vite build` and `vite`: writes public/icon-192.png, icon-512.png,
// icon-maskable-512.png and apple-touch-icon.png. Deterministic: same bytes on every run.
//
// The mark: two nested yellow chevrons pointing up and a speed streak, on the dark palette ground.
//   node scripts/make-icons.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PALETTE = {
  dark: [0x1b, 0x16, 0x30],
  yellow: [0xff, 0xd2, 0x3f],
};

/** The icons the manifest and index.html declare. */
export const ICONS = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'apple' },
];

/** The maskable mark stays inside this share of half the icon (the spec's safe zone is a circle of 0.8). */
export const MASKABLE_SAFE_RADIUS = 0.72;
/** The plain mark fills this share of half the icon. */
const ANY_FILL = 0.84;

// ---------------------------------------------------------------------------------------------
// The mark, in unit coordinates: x right, y down. A chevron is a thick V on its side, apex up.

const HALF_WIDTH = 0.5;
const RISE = 0.3;
const THICK = 0.17;

/** A chevron's outline, apex at (0, apexY). */
function chevron(apexY) {
  return [
    [0, apexY],
    [HALF_WIDTH, apexY + RISE],
    [HALF_WIDTH, apexY + RISE + THICK],
    [0, apexY + THICK],
    [-HALF_WIDTH, apexY + RISE + THICK],
    [-HALF_WIDTH, apexY + RISE],
  ];
}

/** A tall bar under the chevrons, as thick as they are: the streak they leave behind. */
const STREAK = { x0: -THICK / 2, x1: THICK / 2, y0: 0.42, y1: 0.78 };

const SHAPES = [chevron(-0.46), chevron(-0.16)];

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inMark(x, y) {
  for (const s of SHAPES) if (inPolygon(x, y, s)) return true;
  return x >= STREAK.x0 && x <= STREAK.x1 && y >= STREAK.y0 && y <= STREAK.y1;
}

/** The mark's centre and the radius around it that holds all of it, measured from the shapes. */
const BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const take = (x, y) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const s of SHAPES) for (const [x, y] of s) take(x, y);
  take(STREAK.x0, STREAK.y0);
  take(STREAK.x1, STREAK.y1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let radius = 0;
  for (const [x, y] of [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]]) {
    radius = Math.max(radius, Math.hypot(x - cx, y - cy));
  }
  return { cx, cy, radius };
})();

/**
 * Render an icon into an RGBA buffer. kind: 'any' (rounded square plate, transparent corners),
 * 'maskable' (full bleed, mark inside the safe zone), 'apple' (full bleed square, iOS rounds it).
 */
export function renderIcon(size, kind) {
  const out = new Uint8Array(size * size * 4);
  const fill = kind === 'maskable' ? MASKABLE_SAFE_RADIUS : ANY_FILL;
  const scale = (fill / BOUNDS.radius) * (size / 2);
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
          const col = inMark((fx - half) / scale + BOUNDS.cx, (fy - half) / scale + BOUNDS.cy) ? PALETTE.yellow : PALETTE.dark;
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
