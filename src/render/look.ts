/**
 * The look: the palette, the light and the screen treatment everything drawn follows.
 *
 * There are several looks (`LOOKS`), each a palette and a style laid over the base one. Which one
 * is in use is settled once, when this module loads: `?look=<id>` in the URL, else the one saved
 * on this device, else `night`. After that `PALETTE` and `STYLE` never change, so views read them
 * freely; changing the look saves the choice and reloads the page.
 *
 * Models are built to the palette with the two material kinds below and nothing else, so a look
 * applies to all of them at once. What a look may change: every colour, the sun and the fog, the
 * ground's pattern, and one pass over the finished frame (outlines from depth, a sky gradient,
 * chunky pixels, posterising and dither, halftone, grain, vignette). See `scene.ts` for the pass.
 */
import { Color, MeshLambertMaterial } from 'three';

export interface Palette {
  sky: number;
  fog: number;
  groundA: number;
  groundB: number;
  groundLine: number;
  rim: number;
  mover: number;
  moverTuck: number;
  pad: number;
  accent: number;
  /** One colour per gear, 1..5. Used by the HUD and anything that shows speed. */
  gears: number[];
  /** One colour per enemy kind (shuffler, gnat, bollard, cutter, lobber, sludge, clinger). */
  enemies: number[];
  elite: number;
  /** Zones: a mine, tar, where a lobbed shot will land. */
  zones: number[];
  /** Map things: crate, gold crate, shrine, gate, hoop, totem. */
  things: number[];
  orbit: number;
  arc: number;
  lance: number;
  stone: number;
  /** Bosses, in the order they arrive. */
  bosses: number[];
  ring: number;
  rail: number;
  railPost: number;
  grindSpark: number;
  slam: number;
  enemyFlash: number;
  spark: number;
  shot: number;
  wake: number;
  pop: number;
  threat: number;
  hp: number;
  hpLow: number;
  sun: number;
  ambient: number;
}

export interface Style {
  /** Where the fog starts and where nothing is visible any more, m. */
  fogNear: number;
  fogFar: number;
  /** Light direction (pointing from the ground toward the sun). */
  sunDir: { x: number; y: number; z: number };
  sunIntensity: number;
  ambientIntensity: number;
  /** Side of a ground checker square, m, and how often a line is drawn, m (0: no lines). */
  checker: number;
  lineEvery: number;
  /** How far the rim's banks go toward `PALETTE.rim`, 0..1. */
  rimMix: number;
  /** CSS pixels one drawn pixel covers: 1 is the device's own, 3 is chunky. */
  pixel: number;
  /** Outlines where depth breaks: strength 0..1 (0: none), width in drawn pixels, colour. */
  outline: number;
  outlineWidth: number;
  outlineColor: number;
  /** The sky above the horizon runs from the fog colour up to this. Negative: a flat sky. */
  skyTop: number;
  /** Colour levels per channel after posterising (0: off), and how much ordered dither hides the steps, 0..1. */
  posterize: number;
  dither: number;
  /** Printed dots in the darker tones, 0..1. */
  halftone: number;
  /** Paper grain, 0..1. */
  grain: number;
  /** Darkening toward the corners, 0..1. */
  vignette: number;
  /** 1 leaves the colours alone. */
  saturation: number;
  contrast: number;
  /** The overlay's words sit on a light picture: give them a dark edge. */
  lightUi: boolean;
}

export interface LookDef {
  id: string;
  name: string;
  /** One line for whoever is choosing. */
  blurb: string;
  palette: Partial<Palette>;
  style: Partial<Style>;
}

const BASE_PALETTE: Palette = {
  sky: 0x1b1630,
  fog: 0x1b1630,
  groundA: 0x2a2548,
  groundB: 0x3b3466,
  groundLine: 0x5a52a0,
  rim: 0x5b3a8c,
  mover: 0xffd23f,
  moverTuck: 0xff8a3d,
  pad: 0x3df5c8,
  accent: 0xff4d8d,
  gears: [0x8a86a8, 0x6ec6ff, 0x3df5c8, 0xffd23f, 0xff4d8d],
  enemies: [0xf0567a, 0xc4f04a, 0x8f6bff, 0xff7a2f, 0x4ad9f0, 0x6f8f3a, 0xf0e04a],
  elite: 0xffffff,
  zones: [0xffd23f, 0x23301a, 0xff3355],
  things: [0xb07a3c, 0xffd23f, 0x9bf6ff, 0xffffff, 0xff9a3d, 0xff4d8d],
  orbit: 0xffe37a,
  arc: 0xb8f4ff,
  lance: 0xfff1b0,
  stone: 0xd8d2c4,
  bosses: [0xff6a3d, 0x4ad9f0, 0xf4f0ff],
  ring: 0xff3355,
  rail: 0xe8e4f4,
  railPost: 0x6a62a8,
  grindSpark: 0xffe37a,
  slam: 0xfff1b0,
  enemyFlash: 0xffffff,
  spark: 0x9bf6ff,
  shot: 0xffffff,
  wake: 0xff9a3d,
  pop: 0xfff1b0,
  threat: 0xff3355,
  hp: 0x5df58a,
  hpLow: 0xff3355,
  sun: 0xfff1d6,
  ambient: 0x6a62a8,
};

const BASE_STYLE: Style = {
  fogNear: 60,
  fogFar: 260,
  sunDir: { x: 0.45, y: 1, z: 0.3 },
  sunIntensity: 2.2,
  ambientIntensity: 1.3,
  checker: 4,
  lineEvery: 16,
  rimMix: 0.85,
  pixel: 1,
  outline: 0,
  outlineWidth: 1,
  outlineColor: 0x000000,
  skyTop: -1,
  posterize: 0,
  dither: 0,
  halftone: 0,
  grain: 0,
  vignette: 0,
  saturation: 1,
  contrast: 1,
  lightUi: false,
};

export const DEFAULT_LOOK = 'night';

/**
 * The looks on offer. The first is the one the game was built in; the others are prototypes for
 * the owner to choose between.
 */
export const LOOKS: readonly LookDef[] = [
  {
    id: 'night',
    name: 'NIGHT BOWL',
    blurb: 'Dark ground, neon things, heavy fog.',
    palette: {},
    style: {},
  },
  {
    id: 'pool',
    name: 'POOL DAY',
    blurb: 'A drained swimming pool at noon: tile blue, hard sun, ink outlines.',
    palette: {
      sky: 0xcdeef6,
      fog: 0xcdeef6,
      groundA: 0x3ea7bd,
      groundB: 0x3598ae,
      groundLine: 0x58b9cc,
      rim: 0xf2e2c2,
      mover: 0xff4b33,
      moverTuck: 0xffb300,
      pad: 0xfff06a,
      accent: 0xff3d7f,
      gears: [0xe7f3f5, 0xfff06a, 0xffb300, 0xff7a2f, 0xff3d7f],
      enemies: [0xe0336d, 0xb7ec2c, 0x7a45ea, 0xff7a14, 0x1b4fd8, 0x4f6b22, 0xffd21a],
      elite: 0xffffff,
      zones: [0xffb300, 0x1f3038, 0xe5202e],
      things: [0xa86f38, 0xffc928, 0xffffff, 0x22304a, 0xff7a14, 0xe0336d],
      orbit: 0xffd21a,
      arc: 0xffffff,
      lance: 0xfff3b0,
      stone: 0xf2e2c2,
      bosses: [0xf0500a, 0x1b4fd8, 0x22304a],
      ring: 0xe5202e,
      rail: 0x22304a,
      railPost: 0x55708a,
      grindSpark: 0xffe37a,
      slam: 0xffffff,
      spark: 0xfff6a8,
      shot: 0x22304a,
      wake: 0xff7a14,
      pop: 0xfff3b0,
      threat: 0xe5202e,
      hp: 0x35d06a,
      hpLow: 0xe5202e,
      sun: 0xfff6dc,
      ambient: 0xbfe6ff,
    },
    style: {
      fogNear: 90,
      fogFar: 320,
      sunDir: { x: 0.35, y: 1, z: 0.5 },
      sunIntensity: 2.5,
      ambientIntensity: 1.7,
      checker: 2,
      lineEvery: 16,
      rimMix: 0.95,
      outline: 0.85,
      outlineWidth: 1.5,
      outlineColor: 0x14213a,
      skyTop: 0x2f8fe6,
      vignette: 0.18,
      saturation: 1.08,
      lightUi: true,
    },
  },
  {
    id: 'tape',
    name: 'RENTAL TAPE',
    blurb: 'A 1998 console: fat pixels, banded colour, fog up close.',
    palette: {
      sky: 0x93a08f,
      fog: 0x93a08f,
      groundA: 0x4c5a4a,
      groundB: 0x586855,
      groundLine: 0x6f7f63,
      rim: 0x7a5f47,
      mover: 0xffd400,
      moverTuck: 0xff8a00,
      pad: 0x00e0c0,
      accent: 0xff2e63,
      gears: [0xb9c2b4, 0x4fb3ff, 0x00e0c0, 0xffd400, 0xff2e63],
      enemies: [0xe8243c, 0xa8e000, 0x7c4dff, 0xff6a00, 0x00b8e0, 0x3e5a20, 0xffe000],
      zones: [0xffd400, 0x1c2418, 0xff2030],
      things: [0x8a5a2c, 0xffd400, 0xa0f0ff, 0xf0f0e0, 0xff8a00, 0xff2e63],
      bosses: [0xff5a1e, 0x00b8e0, 0xe8e8d8],
      rail: 0xd8dccc,
      railPost: 0x3a4438,
      sun: 0xfff0d0,
      ambient: 0x9fb09a,
    },
    style: {
      fogNear: 34,
      fogFar: 190,
      sunIntensity: 2.3,
      ambientIntensity: 1.5,
      checker: 8,
      lineEvery: 0,
      rimMix: 0.9,
      pixel: 3,
      posterize: 20,
      dither: 0.9,
      vignette: 0.22,
      saturation: 1.15,
      contrast: 1.08,
      lightUi: true,
    },
  },
  {
    id: 'riso',
    name: 'RISO ZINE',
    blurb: 'A photocopied skate zine: four inks, chalk lines, halftone and grain.',
    palette: {
      sky: 0x17142b,
      fog: 0x17142b,
      groundA: 0x262050,
      groundB: 0x30295f,
      groundLine: 0x3d3180,
      rim: 0x4a2f7a,
      mover: 0xfff200,
      moverTuck: 0xff48b0,
      pad: 0x5ef0ff,
      accent: 0xff48b0,
      gears: [0xf2ecdf, 0x5ef0ff, 0x5ef0ff, 0xfff200, 0xff48b0],
      enemies: [0xff48b0, 0xfff200, 0xf2ecdf, 0xff7a5c, 0x5ef0ff, 0x2fa98f, 0xfff200],
      elite: 0xf2ecdf,
      zones: [0xfff200, 0x0e0c1c, 0xff48b0],
      things: [0xf2ecdf, 0xfff200, 0x5ef0ff, 0xf2ecdf, 0xff7a5c, 0xff48b0],
      orbit: 0xfff200,
      arc: 0x5ef0ff,
      lance: 0xf2ecdf,
      stone: 0xf2ecdf,
      bosses: [0xff7a5c, 0x5ef0ff, 0xf2ecdf],
      ring: 0xff48b0,
      rail: 0xf2ecdf,
      railPost: 0x5ef0ff,
      grindSpark: 0xfff200,
      slam: 0xf2ecdf,
      spark: 0x5ef0ff,
      shot: 0xf2ecdf,
      wake: 0xff7a5c,
      pop: 0xfff200,
      threat: 0xff48b0,
      hp: 0x5ef0ff,
      hpLow: 0xff48b0,
      sun: 0xfff6e6,
      ambient: 0x7d6fd0,
    },
    style: {
      fogNear: 50,
      fogFar: 230,
      sunDir: { x: -0.5, y: 1, z: 0.25 },
      sunIntensity: 2.4,
      ambientIntensity: 1.0,
      checker: 4,
      lineEvery: 16,
      outline: 0.8,
      outlineWidth: 1.25,
      outlineColor: 0xf2ecdf,
      posterize: 8,
      dither: 0.4,
      halftone: 0.7,
      grain: 0.5,
      vignette: 0.3,
      saturation: 1.1,
      contrast: 1.1,
    },
  },
];

export const LOOK_KEY = 'shmoove.look';

export function isLook(id: string | null | undefined): id is string {
  return typeof id === 'string' && LOOKS.some((l) => l.id === id);
}

export function lookOf(id: string): LookDef {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0];
}

/** The whole palette of a look: the base with the look's colours over it. */
export function paletteOf(id: string): Palette {
  const p = lookOf(id).palette;
  const out: Palette = { ...BASE_PALETTE, ...p };
  // Never share an array with the base or the definition.
  out.gears = [...out.gears];
  out.enemies = [...out.enemies];
  out.zones = [...out.zones];
  out.things = [...out.things];
  out.bosses = [...out.bosses];
  return out;
}

export function styleOf(id: string): Style {
  const s: Style = { ...BASE_STYLE, ...lookOf(id).style };
  s.sunDir = { ...s.sunDir };
  return s;
}

/** Which look a URL query and a saved choice ask for: the URL wins, an unknown id is ignored. */
export function pickLook(search: string, saved: string | null): string {
  const q = new URLSearchParams(search).get('look');
  const fromUrl = q === null ? null : q.trim().toLowerCase();
  if (isLook(fromUrl)) return fromUrl;
  if (isLook(saved)) return saved;
  return DEFAULT_LOOK;
}

function savedLook(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(LOOK_KEY);
  } catch {
    return null;
  }
}

/** The look in use for this page load. */
export const LOOK_ID: string = pickLook(typeof location === 'undefined' ? '' : location.search, savedLook());
export const PALETTE: Palette = paletteOf(LOOK_ID);
export const STYLE: Style = styleOf(LOOK_ID);

/** The look after `id` in the list, wrapping. */
export function nextLook(id: string): string {
  const i = LOOKS.findIndex((l) => l.id === id);
  return LOOKS[(i + 1) % LOOKS.length].id;
}

/**
 * Save `id` as this device's look and load the page again with it. The run in progress is lost:
 * every view was built to the old palette.
 */
export function switchLook(id: string): void {
  if (!isLook(id)) return;
  try {
    localStorage.setItem(LOOK_KEY, id);
  } catch {
    // Not saved; the URL below still carries it for this visit.
  }
  const url = new URL(location.href);
  url.searchParams.set('look', id);
  location.replace(url.toString());
}

/** Where the fog starts and where nothing is visible any more, metres. */
export const FOG_NEAR = STYLE.fogNear;
export const FOG_FAR = STYLE.fogFar;

/** Light direction (pointing from the sun toward the ground is the negative of this). */
export const SUN_DIR = STYLE.sunDir;
export const SUN_INTENSITY = STYLE.sunIntensity;
export const AMBIENT_INTENSITY = STYLE.ambientIntensity;

/** The one kind of surface in the game: flat-shaded, lit, fogged, optionally vertex-coloured. */
export function flatMaterial(color: number, vertexColors = false): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, flatShading: true, vertexColors });
}

/**
 * For the few things that must read from any side in any light (the mover): the flat surface, plus
 * enough of its own colour as glow that the unlit side is still that colour.
 */
export function glowMaterial(color: number, glow = 0.55): MeshLambertMaterial {
  const m = flatMaterial(color);
  m.emissive.setHex(color);
  m.emissiveIntensity = glow;
  return m;
}

/**
 * A colour made lighter (k > 0, toward white) or darker (k < 0, toward black), k in -1..1. For the
 * two or three tones a model is built from: derive them from the palette, do not invent colours.
 */
export function tone(color: number, k: number): number {
  const to = k > 0 ? 255 : 0;
  const a = Math.min(1, Math.abs(k));
  const r = Math.round(((color >> 16) & 255) * (1 - a) + to * a);
  const g = Math.round(((color >> 8) & 255) * (1 - a) + to * a);
  const b = Math.round((color & 255) * (1 - a) + to * a);
  return (r << 16) | (g << 8) | b;
}

/** Recolour a glow material, keeping surface and glow in step. */
export function setGlowColor(m: MeshLambertMaterial, color: number): void {
  m.color.setHex(color);
  m.emissive.setHex(color);
}

/** CSS colour for a gear, for the DOM overlay. */
export function gearCss(gear: number): string {
  const i = Math.min(PALETTE.gears.length, Math.max(1, Math.round(gear))) - 1;
  return `#${new Color(PALETTE.gears[i]).getHexString()}`;
}
