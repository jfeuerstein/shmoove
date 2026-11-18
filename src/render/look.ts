/**
 * The core look: palette and the few rules everything drawn follows.
 *
 * Dark ground, saturated things on it, heavy fog. Flat shading everywhere. The greybox uses the
 * same palette so nothing has to be recoloured when real models arrive.
 */
import { Color, MeshLambertMaterial } from 'three';

export const PALETTE = {
  sky: 0x1b1630,
  fog: 0x1b1630,
  groundA: 0x2a2548,
  groundB: 0x332d57,
  groundLine: 0x4a4380,
  rim: 0x5b3a8c,
  mover: 0xffd23f,
  moverTuck: 0xff8a3d,
  pad: 0x3df5c8,
  accent: 0xff4d8d,
  /** One colour per gear, 1..5. Used by the HUD and anything that shows speed. */
  gears: [0x8a86a8, 0x6ec6ff, 0x3df5c8, 0xffd23f, 0xff4d8d],
  sun: 0xfff1d6,
  ambient: 0x6a62a8,
} as const;

/** Where the fog starts and where nothing is visible any more, metres. */
export const FOG_NEAR = 60;
export const FOG_FAR = 260;

/** Light direction (pointing from the sun toward the ground is the negative of this). */
export const SUN_DIR = { x: 0.45, y: 1, z: 0.3 } as const;
export const SUN_INTENSITY = 2.2;
export const AMBIENT_INTENSITY = 1.3;

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
