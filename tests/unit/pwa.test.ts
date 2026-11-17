import { describe, expect, it } from 'vitest';
import { ICONS, MASKABLE_SAFE_RADIUS, PALETTE, makeIcons } from '../../scripts/make-icons.mjs';
import { CACHE_PREFIX, buildServiceWorker, writeServiceWorker } from '../../scripts/make-sw.mjs';
import { shouldRegisterSw } from '../../src/app/pwa';
import { rotateShown } from '../../src/ui/rotate';

// Node built-ins and the e2e PNG decoder are plain JS without type declarations in this project:
// load them by computed specifier and describe the few functions used.
interface FsLike {
  readFileSync(p: string | URL, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  mkdirSync(p: string, o: { recursive: boolean }): void;
  mkdtempSync(prefix: string): string;
  rmSync(p: string, o: { recursive: boolean; force: boolean }): void;
}
interface PathLike {
  join(...p: string[]): string;
}
interface OsLike {
  tmpdir(): string;
}
interface Png {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}
interface PngLib {
  decodePng(buf: Uint8Array): Png;
}
const load = async <T>(spec: string): Promise<T> => (await import(/* @vite-ignore */ spec)) as T;
const fs = await load<FsLike>('node:' + 'fs');
const path = await load<PathLike>('node:' + 'path');
const os = await load<OsLike>('node:' + 'os');
const png = await load<PngLib>(new URL('../e2e/lib/png.mjs', import.meta.url).href);

const MANIFEST_URL = new URL('../../public/manifest.webmanifest', import.meta.url);
const INDEX_URL = new URL('../../index.html', import.meta.url);

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const isRelative = (u: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/');

describe('web app manifest', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_URL, 'utf8')) as Record<string, unknown>;

  it('names the game and runs fullscreen in portrait', () => {
    expect(m.name).toBe('SKITCH');
    expect(typeof m.short_name).toBe('string');
    expect(typeof m.description).toBe('string');
    expect(m.display).toBe('fullscreen');
    expect(m.display_override).toEqual(['fullscreen', 'standalone']);
    expect(m.orientation).toBe('portrait');
  });

  it('uses the ink palette for theme and background', () => {
    expect(String(m.theme_color).toUpperCase()).toBe('#1B1A2E');
    expect(String(m.background_color).toUpperCase()).toBe('#1B1A2E');
  });

  it('keeps start_url, scope and every icon URL relative, so dist/ works from a sub-path', () => {
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    const icons = m.icons as ManifestIcon[];
    for (const i of icons) expect(isRelative(i.src)).toBe(true);
  });

  it('declares a 192, a 512 and a maskable 512 icon that the icon script makes', () => {
    const icons = m.icons as ManifestIcon[];
    const find = (sizes: string, purpose: string): ManifestIcon | undefined =>
      icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any').split(' ').includes(purpose));
    expect(find('192x192', 'any')).toBeDefined();
    expect(find('512x512', 'any')).toBeDefined();
    expect(find('512x512', 'maskable')).toBeDefined();
    for (const i of icons) {
      expect(i.type).toBe('image/png');
      const made = ICONS.find((x) => x.file === i.src);
      expect(made, i.src).toBeDefined();
      expect(`${made?.size}x${made?.size}`).toBe(i.sizes);
    }
  });

  it('is linked from index.html with the apple tags and touch icon', () => {
    const html = fs.readFileSync(INDEX_URL, 'utf8');
    expect(html).toMatch(/<link rel="manifest" href="[^"]*manifest\.webmanifest"/);
    expect(html).toMatch(/name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style"/);
    expect(html).toMatch(/rel="apple-touch-icon" href="[^"]*apple-touch-icon\.png"/);
    expect(html).toMatch(/rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
    expect(ICONS.some((i) => i.file === 'apple-touch-icon.png' && i.size === 180)).toBe(true);
  });
});

describe('icon script', () => {
  const first = makeIcons();
  const decoded = first.map((i) => ({ ...i, img: png.decodePng(i.png) }));

  it('makes valid PNGs of the declared sizes', () => {
    for (const d of decoded) {
      expect(d.img.width, d.file).toBe(d.size);
      expect(d.img.height, d.file).toBe(d.size);
      expect(d.img.channels).toBe(4);
    }
  });

  it('draws a mark, not a flat colour: mango, pink and cobalt all appear on the ink', () => {
    const has = (img: Png, rgb: readonly number[]): boolean => {
      for (let o = 0; o < img.data.length; o += 4) {
        if (img.data[o + 3] === 255 && img.data[o] === rgb[0] && img.data[o + 1] === rgb[1] && img.data[o + 2] === rgb[2]) return true;
      }
      return false;
    };
    for (const d of decoded) {
      for (const c of [PALETTE.ink, PALETTE.mango, PALETTE.pink, PALETTE.cobalt]) expect(has(d.img, c), `${d.file} ${c}`).toBe(true);
    }
  });

  it('is deterministic: two runs give identical bytes', () => {
    const second = makeIcons();
    const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
    for (let i = 0; i < first.length; i++) expect(same(second[i].png, first[i].png), first[i].file).toBe(true);
  });

  it('keeps the maskable mark inside the central 80% safe zone, on a full-bleed ink plate', () => {
    const d = decoded.find((x) => x.kind === 'maskable');
    expect(d).toBeDefined();
    if (!d) return;
    const { width: w, data } = d.img;
    const half = w / 2;
    const safe = half * MASKABLE_SAFE_RADIUS;
    let outside = 0;
    let inkedInside = 0;
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const ink = data[o] === PALETTE.ink[0] && data[o + 1] === PALETTE.ink[1] && data[o + 2] === PALETTE.ink[2];
        expect(data[o + 3]).toBe(255);
        const r = Math.hypot(x + 0.5 - half, y + 0.5 - half);
        if (r > safe && !ink) outside++;
        if (r <= safe && !ink) inkedInside++;
      }
    }
    expect(outside).toBe(0);
    // And the mark is big enough to read: it covers a good share of the safe circle.
    expect(inkedInside / (Math.PI * safe * safe)).toBeGreaterThan(0.12);
  });

  it('cuts round corners on the plain icons and leaves the Apple icon opaque', () => {
    for (const d of decoded) {
      const corner = d.img.data[3];
      const centre = d.img.data[((d.size >> 1) * d.size + (d.size >> 1)) * 4 + 3];
      expect(centre).toBe(255);
      expect(corner, d.file).toBe(d.kind === 'any' ? 0 : 255);
    }
  });
});

describe('service worker generator', () => {
  const makeDist = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skitch-dist-'));
    for (const [name, body] of Object.entries(files)) {
      const parts = name.split('/');
      if (parts.length > 1) fs.mkdirSync(path.join(dir, ...parts.slice(0, -1)), { recursive: true });
      fs.writeFileSync(path.join(dir, ...parts), body);
    }
    return dir;
  };
  const FILES = {
    'index.html': '<!doctype html><title>SKITCH</title>',
    'assets/index-abc.js': 'console.log(1)',
    'manifest.webmanifest': '{}',
    'icon-192.png': 'png',
    // Netlify / Cloudflare Pages header rules: shipped in dist/ but never served.
    _headers: '/sw.js\n  Cache-Control: no-cache\n',
  };

  it('lists exactly the built files (not itself), with relative URLs', () => {
    const dir = makeDist(FILES);
    try {
      const sw = writeServiceWorker(dir);
      expect(sw.files).toEqual(['assets/index-abc.js', 'icon-192.png', 'index.html', 'manifest.webmanifest']);
      // Written out, then built again: sw.js is never in its own list.
      expect(buildServiceWorker(dir).files).toEqual(sw.files);
      const source = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
      const listed = /const FILES = (\[.*\]);/.exec(source);
      expect(listed).not.toBeNull();
      expect(JSON.parse(listed ? listed[1] : '[]')).toEqual(sw.files);
      for (const f of sw.files) expect(isRelative(f)).toBe(true);
      expect(source).toContain(`const CACHE = "${sw.name}"`);
      expect(sw.name.startsWith(CACHE_PREFIX)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives the cache name from file contents: same files, same name; one byte changed, new name', () => {
    const a = makeDist(FILES);
    const b = makeDist(FILES);
    const c = makeDist({ ...FILES, 'assets/index-abc.js': 'console.log(2)' });
    try {
      const na = buildServiceWorker(a).name;
      expect(buildServiceWorker(b).name).toBe(na);
      expect(buildServiceWorker(c).name).not.toBe(na);
    } finally {
      for (const d of [a, b, c]) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('only takes over when the page asks, and deletes old caches on activate', () => {
    const dir = makeDist(FILES);
    try {
      const { source } = buildServiceWorker(dir);
      expect(source).toMatch(/addEventListener\('message'[\s\S]*skipWaiting\(\)/);
      const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"));
      expect(install.length).toBeGreaterThan(0);
      expect(install).not.toContain('skipWaiting');
      expect(source).toMatch(/caches\.delete/);
      expect(source).toMatch(/req\.mode === 'navigate'/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a directory without index.html', () => {
    const dir = makeDist({ 'a.js': '1' });
    try {
      expect(() => buildServiceWorker(dir)).toThrow(/index\.html/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('service worker registration policy', () => {
  const base = { production: true, e2e: false, sw: false, supported: true };
  it('registers in a production build', () => expect(shouldRegisterSw(base)).toBe(true));
  it('never under the dev server', () => expect(shouldRegisterSw({ ...base, production: false, sw: true })).toBe(false));
  it('not under ?e2e unless the URL also has sw', () => {
    expect(shouldRegisterSw({ ...base, e2e: true })).toBe(false);
    expect(shouldRegisterSw({ ...base, e2e: true, sw: true })).toBe(true);
  });
  it('not where service workers are unsupported', () => expect(shouldRegisterSw({ ...base, supported: false })).toBe(false));
});

describe('rotate card rule', () => {
  it('shows on a touch screen held sideways', () => {
    expect(rotateShown(844, 390, true)).toBe(true);
  });
  it('hides when the phone is upright, or square', () => {
    expect(rotateShown(390, 844, true)).toBe(false);
    expect(rotateShown(600, 600, true)).toBe(false);
  });
  it('never shows for a mouse-driven desktop window, however wide', () => {
    expect(rotateShown(1920, 1080, false)).toBe(false);
  });
});
