// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced: what Chromium screenshots produce) and a
// flat-colour check, so the harness can catch a blank canvas without an image dependency.
import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param {Buffer} buf @returns {{ width: number, height: number, channels: number, data: Uint8Array }} */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colour = body[9];
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
        throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[dst - stride + x - channels] : 0;
      let p = raw[src + x];
      switch (filter) {
        case 0:
          break;
        case 1:
          p += a;
          break;
        case 2:
          p += b;
          break;
        case 3:
          p += (a + b) >> 1;
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      data[dst + x] = p & 0xff;
    }
  }
  return { width, height, channels, data };
}

/**
 * Fraction of pixels inside `rect` (device px) that differ from the rect's first pixel by more than
 * `tolerance` in any channel. 0 means one flat colour.
 */
export function nonFlatFraction(img, rect, tolerance = 8) {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return 0;
  const { data, channels, width } = img;
  const base = (y0 * width + x0) * channels;
  let differing = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      if (
        Math.abs(data[i] - data[base]) > tolerance ||
        Math.abs(data[i + 1] - data[base + 1]) > tolerance ||
        Math.abs(data[i + 2] - data[base + 2]) > tolerance
      ) {
        differing++;
      }
    }
  }
  return differing / ((x1 - x0) * (y1 - y0));
}
