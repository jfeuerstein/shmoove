/**
 * Big-body rides: tram (with pantograph), ghost tram, the night bus and the stepped funicular.
 */
import * as THREE from 'three';
import type { CompiledLine } from '../../sim/lines';
import { MeshBuilder, shade } from '../geom';
import { INK } from '../look';
import { flank, flanks, front, grabBar, pattern, prismX, rear, rect, roofMark, wheel, type Plane } from './paint';

const GLASS = 0x2a2f6e;
/** Ghost-tram window light: a cold paper-cobalt mix that reads lit even by day. */
const GHOST_GLASS = 0xcfdcf5;

interface CarInks {
  base: number;
  upper: number;
  glass: number;
  glassGlow: number;
  board: number;
  boardGlow: number;
  lamp: number;
}

function inksFor(line: CompiledLine): CarInks {
  const { base } = line.livery;
  if (line.kind === 'ghosttram') {
    return { base, upper: shade(base, 0.96), glass: GHOST_GLASS, glassGlow: 0.55, board: INK.cobalt, boardGlow: 0, lamp: GHOST_GLASS };
  }
  return { base, upper: base, glass: GLASS, glassGlow: 0.85, board: INK.mango, boardGlow: 1, lamp: INK.white };
}

/** Tram or ghost tram: skirt with the livery pattern, window band, roof mark, pantograph, grab bar. */
export function tram(b: MeshBuilder, line: CompiledLine): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const liv = line.livery;
  const ink = inksFor(line);
  const floor = 0.35;
  const skirt = H * 0.42;
  const band = H * 0.3;
  const upperY0 = floor + skirt + band;
  // Skirt, glass band, upper body.
  b.box(0, floor + skirt / 2, 0, W, skirt / 2, L, 1, 0, ink.base, { bottom: true, noTop: true });
  b.box(0, floor + skirt + band / 2, 0, W - 0.06, band / 2, L - 0.06, 1, 0, ink.glass, { glow: ink.glassGlow, noTop: true });
  b.box(0, (upperY0 + H) / 2, 0, W, (H - upperY0) / 2, L, 1, 0, ink.upper, {});
  // Livery pattern along both flanks of the skirt, and the roof mark.
  flanks(b, liv, W, -L * 0.94, L * 0.94, floor + 0.1, floor + skirt - 0.08);
  roofMark(b, liv, H, W * 0.82, -L * 0.86, L * 0.62);
  // Window pillars.
  const pillars = Math.max(2, Math.round(L / 1.1));
  for (let i = 0; i <= pillars; i++) {
    const z = -L + (i * 2 * L) / pillars;
    b.box(0, floor + skirt + band / 2, z, W + 0.01, band / 2, 0.09, 1, 0, ink.upper, { noTop: true });
  }
  // Destination boards front and back, headlamps, a livery block on the rear.
  for (const s of [1, -1]) {
    b.box(0, H - 0.42, s * (L + 0.02), W * 0.6, 0.2, 0.03, 1, 0, INK.ink, {});
    b.box(0, H - 0.42, s * (L + 0.05), W * 0.5, 0.12, 0.02, 1, 0, ink.board, { glow: ink.boardGlow });
  }
  for (const x of [W * 0.6, -W * 0.6]) b.box(x, 0.9, L + 0.03, 0.14, 0.12, 0.03, 1, 0, ink.lamp, { glow: 1 });
  for (const x of [W * 0.62, -W * 0.62]) b.box(x, 0.85, -L - 0.03, 0.12, 0.1, 0.03, 1, 0, INK.pink, { glow: 0.8 });
  rect(b, rear(L), -W * 0.9, floor + skirt * 0.55, W * 0.9, floor + skirt * 0.85, liv.stripe);
  rect(b, front(L), -W * 0.9, floor + skirt * 0.55, W * 0.9, floor + skirt * 0.85, liv.stripe);
  // Bogies.
  for (const z of [-L * 0.62, L * 0.62]) b.box(0, 0.3, z, W * 0.92, 0.3, 0.5, 1, 0, INK.ink, { bottom: true });
  // Pantograph: a base, a folded diamond frame and the contact bar.
  const py = H;
  b.box(0, py + 0.08, 0.4, 0.45, 0.08, 0.35, 1, 0, INK.ink, {});
  b.beam(0, py + 0.16, 0.1, 0, py + 0.95, 0.9, 0.07, INK.ink);
  b.beam(0, py + 0.95, 0.9, 0, py + 1.55, 0.45, 0.07, INK.ink);
  b.beam(-0.75, py + 1.6, 0.45, 0.75, py + 1.6, 0.45, 0.08, liv.accent);
  // Rear bumper and the grab bar.
  b.box(0, 0.62, -L - 0.12, W * 0.9, 0.12, 0.12, 1, 0, INK.ink, {});
  grabBar(b, line, -L - 0.1, 0.7, 0.5);
}

/** Night bus: long body, big raked windscreen, glowing window band, roof rack with luggage. */
export function bus(b: MeshBuilder, line: CompiledLine): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const liv = line.livery;
  const floor = 0.42;
  const winY0 = floor + 1.05;
  const winY1 = H - 0.35;
  // Lower body and roof slab.
  b.box(0, (floor + winY0) / 2, -0.25, W, (winY0 - floor) / 2, L - 0.25, 1, 0, liv.base, { bottom: true, noTop: true });
  b.box(0, (winY0 + winY1) / 2, -0.4, W - 0.05, (winY1 - winY0) / 2, L - 0.55, 1, 0, GLASS, { glow: 1, noTop: true });
  b.box(0, (winY1 + H) / 2, -0.25, W, (H - winY1) / 2, L - 0.25, 1, 0, liv.base, {});
  // Raked nose with the big windscreen.
  const zf = L - 0.5;
  prismX(b, [zf, floor, L, floor, L, winY0, zf, winY0], -W, W, liv.base);
  prismX(b, [zf, winY0, L, winY0, zf + 0.15, H - 0.1, zf - 0.02, H - 0.1], -W + 0.04, W - 0.04, GLASS, { capColor: liv.base, glow: 0.5 });
  // Window pillars.
  const n = Math.max(3, Math.round(L / 1.2));
  for (let i = 0; i <= n; i++) {
    const z = -L + 0.1 + (i * (2 * L - 1.2)) / n;
    b.box(0, (winY0 + winY1) / 2, z, W + 0.01, (winY1 - winY0) / 2, 0.08, 1, 0, liv.base, { noTop: true });
  }
  flanks(b, liv, W, -L * 0.94, L * 0.8, floor + 0.12, winY0 - 0.1);
  roofMark(b, liv, H, W * 0.85, -L * 0.92, -L * 0.12);
  // Destination board, lamps, tail lamps, mirrors.
  b.box(0, H - 0.22, L - 0.48, W * 0.7, 0.13, 0.03, 1, 0, INK.ink, {});
  b.box(0, H - 0.22, L - 0.44, W * 0.6, 0.08, 0.02, 1, 0, INK.mango, { glow: 1 });
  for (const x of [W * 0.65, -W * 0.65]) b.box(x, floor + 0.3, L + 0.03, 0.18, 0.1, 0.03, 1, 0, INK.white, { glow: 1 });
  for (const x of [W * 0.7, -W * 0.7]) b.box(x, floor + 0.4, -L - 0.03, 0.14, 0.18, 0.03, 1, 0, INK.pink, { glow: 0.9 });
  for (const s of [1, -1]) {
    b.beam(s * W, H - 0.6, L - 0.3, s * (W + 0.35), H - 0.6, L - 0.1, 0.03, INK.ink);
    b.box(s * (W + 0.38), H - 0.85, L - 0.1, 0.05, 0.2, 0.08, 1, 0, INK.ink, {});
  }
  rect(b, rear(L), -W * 0.9, floor + 0.55, W * 0.9, floor + 0.8, liv.stripe);
  // Roof rack: two rails on posts, suitcases and a bundle.
  const ry = H + 0.32;
  for (const s of [1, -1]) {
    b.beam(s * W * 0.8, ry, L * 0.05, s * W * 0.8, ry, L * 0.8, 0.035, INK.ink);
    for (const z of [L * 0.1, L * 0.45, L * 0.75]) b.beam(s * W * 0.8, H, z, s * W * 0.8, ry, z, 0.03, INK.ink);
  }
  b.box(0.25, H + 0.2, L * 0.3, 0.45, 0.2, 0.35, 1, 0, INK.mango, {});
  b.box(-0.3, H + 0.18, L * 0.58, 0.4, 0.18, 0.3, 1, 0, INK.teal, {});
  b.box(0.1, H + 0.16, L * 0.8, 0.5, 0.16, 0.18, 1, 0, INK.pink, {});
  // Wheels.
  for (const z of [-L * 0.62, L * 0.6]) for (const s of [1, -1]) wheel(b, s * (W - 0.18), 0.48, z, 0.48, 0.17, 0.3);
  // Rear bumper and grab bar.
  b.box(0, 0.6, -L - 0.1, W * 0.92, 0.12, 0.12, 1, 0, INK.ink, {});
  grabBar(b, line, -L - 0.1, 0.65, 0.5);
}

/** Pitch the funicular compartments are stepped against, rad (about 20 degrees). */
export const FUNI_STEP = 0.35;

/**
 * Funicular: a low chassis carrying three stepped compartments whose floors are level on a 20 degree
 * climb. `dir` +1 steps for travelling uphill (front higher), -1 for travelling downhill.
 */
export function funicular(b: MeshBuilder, line: CompiledLine, dir: number): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const liv = line.livery;
  const chassis = 0.55;
  const third = L / 3;
  // Each compartment is level in the world, so in the track frame it is rotated against the climb.
  const a = FUNI_STEP * dir;
  const drop = Math.sin(FUNI_STEP) * third;
  const base = chassis + drop + 0.05;
  const ch = H - base - drop;
  b.box(0, chassis / 2 + 0.05, 0, W * 0.9, chassis / 2, L * 0.98, 1, 0, INK.ink, { bottom: true });
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  for (let k = 0; k < 3; k++) {
    const zc = -L + third * (2 * k + 1);
    const c = new MeshBuilder();
    compartment(c, line, third - 0.06, W, ch, k);
    m.makeTranslation(0, base, zc);
    r.makeRotationX(a);
    m.multiply(r);
    b.append(c, m);
    // Wedge under the compartment, from the chassis up to its tilted floor.
    const hl = third - 0.06;
    const zr = zc - hl * Math.cos(a);
    const zf = zc + hl * Math.cos(a);
    const yr = base + Math.sin(a) * hl;
    const yf = base - Math.sin(a) * hl;
    prismX(b, [zr, chassis, zf, chassis, zf, yf + 0.02, zr, yr + 0.02], -W + 0.08, W - 0.08, liv.stripe, { capColor: liv.stripe });
  }
  // Lamps front and back.
  b.box(0, chassis * 0.6, L + 0.02, W * 0.5, 0.1, 0.03, 1, 0, INK.white, { glow: 1 });
  b.box(0, chassis * 0.6, -L - 0.02, W * 0.5, 0.1, 0.03, 1, 0, INK.pink, { glow: 0.9 });
  for (const z of [-L * 0.7, L * 0.7]) b.box(0, 0.22, z, W * 0.85, 0.22, 0.4, 1, 0, shade(INK.ink, 1.4), { bottom: true });
  grabBar(b, line, -L * 0.98, 0.55, 0.5);
}

/** One funicular compartment in its own frame: floor at y = 0, centred on z = 0. */
function compartment(b: MeshBuilder, line: CompiledLine, hl: number, W: number, H: number, k: number): void {
  const liv = line.livery;
  const winY0 = H * 0.38;
  const winY1 = H * 0.82;
  b.box(0, winY0 / 2, 0, W, winY0 / 2, hl, 1, 0, liv.base, { bottom: true, noTop: true });
  b.box(0, (winY0 + winY1) / 2, 0, W - 0.05, (winY1 - winY0) / 2, hl - 0.05, 1, 0, GLASS, { glow: 0.9, noTop: true });
  b.box(0, (winY1 + H) / 2, 0, W, (H - winY1) / 2, hl, 1, 0, liv.base, {});
  for (const z of [-hl, 0, hl]) b.box(0, (winY0 + winY1) / 2, z, W + 0.01, (winY1 - winY0) / 2, 0.08, 1, 0, liv.base, { noTop: true });
  for (const side of [1, -1]) {
    const P = flank(side, W);
    // The diagonal (or whatever the line's pattern is) runs on across all three compartments.
    patternSlice(b, P, liv.pattern, hl, winY0, liv.stripe, liv.accent, k);
  }
  roofMark(b, liv, H, W * 0.8, -hl * 0.85, hl * 0.85);
}

function patternSlice(b: MeshBuilder, P: Plane, kind: number, hl: number, h: number, color: number, second: number, k: number): void {
  pattern(b, P, kind, -hl * 0.96, hl * 0.96, h * 0.15, h * 0.9, color, k === 1 ? second : undefined);
}
