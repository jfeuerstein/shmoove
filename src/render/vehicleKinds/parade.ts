/**
 * La Boda: the wedding float. A skirted flatbed under a flowered arch, the couple on a dais, a
 * three-piece band on the back deck, bunting with string lights. Three frames on twos: the band
 * plays and the bunting sways.
 */
import type { CompiledLine } from '../../sim/lines';
import { MeshBuilder, shade } from '../geom';
import { INK } from '../look';
import { face, figure, flanks, grabBar, ngon, pattern, prismX, prismZ, rear, rect, roof } from './paint';

export const PARADE_FRAMES = 3;

const FLOWERS = [INK.pink, INK.mango, INK.paper, INK.teal];

/** A string of triangular flags between two points, with lamps, swaying by `sway` metres. */
function bunting(
  b: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  flags: number,
  sway: number,
  inks: number[],
): void {
  const sag = 0.35;
  const pt = (t: number): [number, number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t - sag * 2 * Math.min(t, 1 - t), az + (bz - az) * t];
  // The string in two straight runs, sagging at the middle.
  let prev = pt(0);
  for (const t of [0.5, 1]) {
    const cur = pt(t);
    b.beam(prev[0], prev[1], prev[2], cur[0], cur[1], cur[2], 0.015, INK.ink);
    prev = cur;
  }
  for (let i = 0; i < flags; i++) {
    const p0 = pt((i + 0.15) / flags);
    const p1 = pt((i + 0.85) / flags);
    const m = pt((i + 0.5) / flags);
    const s = sway * (i % 2 === 0 ? 1 : -1);
    const tip: [number, number, number] = [m[0] + s, m[1] - 0.38, m[2]];
    const col = inks[i % inks.length];
    const tri = [p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], tip[0], tip[1], tip[2]];
    // Both faces, so a flag never vanishes edge-on or from behind.
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = tip[0] - p0[0];
    const vy = tip[1] - p0[1];
    const vz = tip[2] - p0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    face(b, tri, m[0] - nx, m[1] - ny, m[2] - nz, col);
    face(b, tri, m[0] + nx, m[1] + ny, m[2] + nz, col);
    if (i % 2 === 0) b.box(m[0], m[1] + 0.02, m[2], 0.05, 0.05, 0.05, 1, 0, INK.white, { glow: 1 });
  }
}

export function parade(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const liv = line.livery;
  const f = ((frame % PARADE_FRAMES) + PARADE_FRAMES) % PARADE_FRAMES;
  const deck = 0.95;
  // Skirted flatbed: skirt with the livery, a scalloped hem, deck painted with the accent mark.
  b.box(0, (0.18 + deck) / 2, 0, W, (deck - 0.18) / 2, L, 1, 0, liv.base, { top: INK.concrete });
  flanks(b, liv, W, -L * 0.95, L * 0.95, 0.28, deck - 0.12);
  rect(b, rear(L), -W * 0.9, 0.3, W * 0.9, deck - 0.12, liv.stripe);
  for (const s of [1, -1]) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const z = -L + ((i + 0.5) * 2 * L) / n;
      face(b, [s * (W + 0.03), 0.3, z - 0.3, s * (W + 0.03), 0.3, z + 0.3, s * (W + 0.03), 0.12, z], 0, 0.5, z, i % 2 === 0 ? liv.stripe : liv.accent);
    }
  }
  pattern(b, roof(deck), liv.pattern, -L * 0.95, L * 0.95, -W * 0.92, W * 0.92, liv.accent);
  // Front: a cab nose dressed in flowers.
  prismX(b, [L - 0.05, 0.2, L + 0.6, 0.2, L + 0.6, 0.9, L - 0.05, 1.3], -W * 0.8, W * 0.8, liv.stripe);
  for (let i = 0; i < 5; i++) b.box(-W * 0.6 + i * W * 0.3, 1.0, L + 0.62, 0.11, 0.11, 0.06, 1, 0, FLOWERS[i % 4], {});
  for (const s of [1, -1]) b.box(s * W * 0.6, 0.5, L + 0.62, 0.13, 0.1, 0.03, 1, 0, INK.white, { glow: 1 });
  // The arch: two posts and a seven-segment curve, flowers all along it, a heart at the top.
  const az = L * 0.45;
  const aw = W - 0.1;
  const top = 4.6;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 7; i++) {
    const t = Math.PI * (i / 7);
    pts.push([aw * Math.cos(t), deck + 2.2 + (top - deck - 2.2) * Math.sin(t)]);
  }
  for (const s of [1, -1]) b.beam(s * aw, deck, az, s * aw, deck + 2.2, az, 0.08, INK.paper);
  for (let i = 0; i < 7; i++) {
    b.beam(pts[i][0], pts[i][1], az, pts[i + 1][0], pts[i + 1][1], az, 0.08, INK.paper);
    b.box(pts[i][0], pts[i][1], az, 0.14, 0.14, 0.14, 1, 0, FLOWERS[i % 4], {});
  }
  for (let i = 0; i < 2; i++) for (const s of [1, -1]) b.box(s * aw, deck + 0.7 + i * 0.9, az, 0.13, 0.13, 0.13, 1, 0, FLOWERS[(i + 1) % 4], {});
  // Heart: two lobes and a point, both faces.
  const hy = top + 0.55;
  const heart = [0, hy - 0.55, az, 0.5, hy, az, 0.3, hy + 0.3, az, 0, hy + 0.12, az, -0.3, hy + 0.3, az, -0.5, hy, az];
  face(b, heart, 0, hy, az - 1, INK.pink, 0.4);
  face(b, heart, 0, hy, az + 1, INK.pink, 0.4);
  // The dais and the couple.
  b.box(0, deck + 0.15, az, 0.9, 0.15, 0.7, 1, 0, INK.paper, { top: liv.stripe });
  const dy = deck + 0.3;
  // Bride: paper dress as a wide skirt, veil; groom in ink with a tall hat. They wave on twos.
  prismZ(b, [-0.4, dy, 0.4, dy, 0.18, dy + 0.85, -0.18, dy + 0.85], az - 0.32, az + 0.32, INK.paper);
  const wave = f === 1 ? 0.25 : 0;
  figure(b, 0.42, dy, az, {
    shirt: INK.paper,
    legs: INK.paper,
    hat: INK.white,
    stride: 0,
    handL: [0.25, 1.75 + wave, 0.1],
    handR: null,
  });
  b.box(0.42, dy + 1.62, az - 0.18, 0.15, 0.25, 0.04, 1, 0, INK.white, {});
  figure(b, -0.42, dy, az, {
    shirt: INK.ink,
    legs: INK.ink,
    hat: INK.ink,
    stride: 0,
    handL: null,
    handR: [-0.25, 1.75 + (f === 2 ? 0.25 : 0), 0.1],
  });
  b.box(-0.42, dy + 1.8, az, 0.1, 0.12, 0.1, 1, 0, INK.ink, {});
  b.box(-0.42, dy + 1.1, az + 0.13, 0.04, 0.12, 0.01, 1, 0, INK.pink, {});
  // The band on the back deck: trumpet, drum, guitar.
  const bz = -L * 0.45;
  const lift = [0, 0.12, 0.05][f];
  const swing = [0, 0.15, -0.1][f];
  figure(b, 0.85, deck, bz + 0.6, {
    shirt: INK.cobalt, legs: INK.ink, hat: INK.mango, stride: 0,
    handL: [0.05, 1.35 + lift, 0.4], handR: [-0.15, 1.38 + lift, 0.38],
  });
  b.beam(0.85, deck + 1.4 + lift, bz + 1.0, 0.85, deck + 1.45 + lift, bz + 1.5, 0.04, INK.mango);
  prismZ(b, ngon(0.85, deck + 1.45 + lift, 0.16, 6), bz + 1.5, bz + 1.6, INK.mango);
  figure(b, 0, deck, bz - 0.5, {
    shirt: INK.teal, legs: INK.ink, hat: INK.pink, stride: 0,
    handL: [0.3, 1.05 + swing, 0.45], handR: [-0.3, 1.05 - swing, 0.45],
  });
  prismX(b, ngon(bz - 0.02, deck + 0.75, 0.35, 8), -0.32, 0.32, INK.paper, { capColor: liv.accent });
  b.beam(0.3, deck + 1.05 + swing, bz, 0.3, deck + 1.25 + swing, bz + 0.25, 0.02, INK.ink);
  figure(b, -0.85, deck, bz + 0.3, {
    shirt: INK.pink, legs: INK.ink, hat: INK.cobalt, stride: 0,
    handL: [0.3, 1.05, 0.25], handR: [-0.05, 0.9 + lift, 0.3 + swing],
  });
  prismX(b, [bz + 0.1, deck + 0.75, bz + 0.6, deck + 0.85, bz + 0.6, deck + 1.15, bz + 0.1, deck + 1.2], -0.95, -0.75, INK.mango);
  b.beam(-0.85, deck + 1.0, bz + 0.6, -0.55, deck + 1.1, bz + 1.15, 0.03, INK.ink);
  // Rear posts and bunting from the arch to them, both sides, plus a garland across the back.
  const pz = -L + 0.2;
  const ph = deck + 2.4;
  for (const s of [1, -1]) {
    b.beam(s * aw, deck, pz, s * aw, ph, pz, 0.06, INK.paper);
    b.box(s * aw, ph + 0.1, pz, 0.15, 0.15, 0.15, 1, 0, FLOWERS[s > 0 ? 0 : 1], {});
  }
  const sway = [0, 0.1, -0.1][f];
  const inks = [INK.pink, INK.mango, INK.teal, INK.cobalt, INK.paper];
  for (const s of [1, -1]) bunting(b, s * aw, deck + 2.4, az, s * aw, ph, pz, 6, sway, inks);
  bunting(b, aw, ph, pz, -aw, ph, pz, 4, -sway, inks);
  bunting(b, pts[2][0], pts[2][1], az, pts[5][0], pts[5][1], az, 3, sway, inks.slice(1));
  // Wheels peeking under the skirt.
  for (const z of [-L * 0.6, L * 0.6]) b.box(0, 0.25, z, W * 0.9, 0.25, 0.45, 1, 0, shade(INK.ink, 1), { bottom: true });
  for (const s of [1, -1]) b.box(s * W * 0.7, 0.6, -L - 0.03, 0.12, 0.1, 0.03, 1, 0, INK.pink, { glow: 0.9 });
  b.box(0, 0.55, -L - 0.1, W * 0.85, 0.1, 0.1, 1, 0, INK.ink, {});
  grabBar(b, line, -L - 0.08, 0.6, 0.5);
}
