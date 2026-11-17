/**
 * Overhead rides. Origin is the moving carriage itself (trolley, cable grip, kite, airship); the
 * strap hangs from (0, anchorY, -anchorBack) to the pink handle at the grab point.
 */
import * as THREE from 'three';
import type { CompiledLine } from '../../sim/lines';
import { MeshBuilder, shade } from '../geom';
import { INK } from '../look';
import { face, figure, flank, flanks, handle, lift, ngon, pattern, poly, prismX, prismZ, rect, roofMark, strap, type Plane } from './paint';

const GLASS = 0x2a2f6e;

/** Gantry crane trolley: wheeled frame on two rail stubs, operator cab, cables to the hook block. */
export function crane(b: MeshBuilder, line: CompiledLine): void {
  const liv = line.livery;
  const W = 1.5;
  const L = 1.3;
  // Rail stubs (the gantry's runway) and the trolley wheels on them.
  for (const s of [1, -1]) {
    b.box(s * 1.35, 0.95, 0, 0.12, 0.1, 3.2, 1, 0, INK.ink, { bottom: true });
    for (const z of [-0.9, 0.9]) b.box(s * 1.35, 1.2, z, 0.1, 0.16, 0.2, 1, 0, INK.concrete, {});
  }
  // Frame: a deep box in the base ink carrying the pattern and a big roof mark.
  b.box(0, 0.6, 0, W, 0.75, L, 1, 0, liv.base, { bottom: true });
  flanks(b, liv, W, -L * 0.95, L * 0.95, 0.0, 1.25);
  for (const z of [L, -L]) {
    const P: Plane = { o: [0, 0, z + (z > 0 ? 0.025 : -0.025)], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, z > 0 ? 1 : -1] };
    pattern(b, P, liv.pattern, -W * 0.92, W * 0.92, 0.0, 1.25, liv.stripe);
  }
  b.box(0, 1.4, 0, W * 0.75, 0.05, L * 0.8, 1, 0, INK.ink, {});
  roofMark(b, liv, 1.45, W * 0.7, -L * 0.75, L * 0.75);
  // Winch drum on top.
  prismX(b, ngon(0, 1.75, 0.3, 8), -0.8, 0.8, INK.concrete, { capColor: liv.stripe });
  // Operator cab slung under one side, glazed, with the operator inside.
  b.box(1.0, -0.65, 0.55, 0.55, 0.55, 0.55, 1, 0, liv.stripe, { bottom: true });
  for (const s of [1, -1]) rect(b, flank(s, 0.55), 0.15, -0.95, 0.95, -0.4, GLASS, 0.9);
  b.box(1.0, -0.65, 1.12, 0.45, 0.3, 0.03, 1, 0, GLASS, { glow: 0.9 });
  figure(b, 1.0, -1.15, 0.55, { shirt: INK.mango, legs: INK.cobalt, hat: INK.mango, stride: 0, scale: 0.7 });
  // Beacon lamps at the corners.
  for (const s of [1, -1]) b.box(s * (W - 0.1), 1.45, L - 0.1, 0.1, 0.08, 0.1, 1, 0, INK.mango, { glow: 1 });
  // Twin cables down to the hook block.
  const z = -line.anchorBack;
  const gy = line.anchorY - line.hang;
  const blockTop = gy + 1.3;
  for (const x of [0.32, -0.32]) b.beam(x, line.anchorY, z, x * 0.75, blockTop, z, 0.045, INK.ink);
  // Hook block with hazard slashes, then the hook: the shank and the pink handle.
  b.box(0, blockTop - 0.35, z, 0.5, 0.35, 0.3, 1, 0, INK.mango, { bottom: true });
  const hz: Plane = { o: [0, 0, z - 0.325], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] };
  pattern(b, hz, 3, -0.48, 0.48, blockTop - 0.68, blockTop - 0.02, INK.ink);
  const hzf: Plane = { o: [0, 0, z + 0.325], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  pattern(b, hzf, 3, -0.48, 0.48, blockTop - 0.68, blockTop - 0.02, INK.ink);
  b.beam(0, blockTop - 0.7, z, 0, gy + 0.34, z, 0.06, INK.ink);
  handle(b, 0, gy, z);
  // The hook's curl under the handle.
  b.beam(0.26, gy, z, 0.3, gy - 0.22, z, 0.045, INK.ink);
  b.beam(0.3, gy - 0.22, z, 0.05, gy - 0.32, z, 0.045, INK.ink);
}

/** Cable car: a gondola hanging from its grip arm, strap below the floor. */
export function cablecar(b: MeshBuilder, line: CompiledLine): void {
  const liv = line.livery;
  const floor = line.anchorY;
  const H = 2.0;
  const W = 1.05;
  const L = 1.35;
  const roofY = floor + H;
  // Grip on the cable, hanger arm and yoke.
  b.box(0, 0.05, 0, 0.18, 0.22, 0.45, 1, 0, INK.ink, { bottom: true });
  b.beam(0, 0, 0, 0.0, roofY + 0.75, -0.15, 0.08, INK.ink);
  b.beam(0, roofY + 0.75, -0.15, 0, roofY + 0.25, 0, 0.08, INK.ink);
  b.beam(-0.7, roofY + 0.25, 0, 0.7, roofY + 0.25, 0, 0.06, INK.ink);
  // Cabin: patterned lower panel, glowing window band, roof with the mark.
  const winY0 = floor + 0.85;
  const winY1 = floor + 1.75;
  b.box(0, (floor + winY0) / 2, 0, W, (winY0 - floor) / 2, L, 1, 0, liv.base, { bottom: true, noTop: true });
  b.box(0, (winY0 + winY1) / 2, 0, W - 0.04, (winY1 - winY0) / 2, L - 0.04, 1, 0, GLASS, { glow: 0.9, noTop: true });
  b.box(0, (winY1 + roofY) / 2, 0, W, (roofY - winY1) / 2, L, 1, 0, liv.base, {});
  for (const x of [W, -W]) for (const z of [L, -L]) b.box(x, (winY0 + winY1) / 2, z, 0.06, (winY1 - winY0) / 2, 0.06, 1, 0, liv.base, {});
  b.box(0, (winY0 + winY1) / 2, 0, W + 0.01, (winY1 - winY0) / 2, 0.05, 1, 0, liv.base, { noTop: true });
  flanks(b, liv, W, -L * 0.94, L * 0.94, floor + 0.08, winY0 - 0.08);
  for (const z of [L, -L]) {
    const P: Plane = { o: [0, 0, z + (z > 0 ? 0.025 : -0.025)], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, z > 0 ? 1 : -1] };
    pattern(b, P, liv.pattern, -W * 0.92, W * 0.92, floor + 0.08, winY0 - 0.08, liv.stripe);
  }
  prismZ(b, [-W * 0.8, roofY, W * 0.8, roofY, W * 0.5, roofY + 0.25, -W * 0.5, roofY + 0.25], -L * 0.85, L * 0.85, liv.stripe);
  roofMark(b, liv, roofY + 0.25, W * 0.5, -L * 0.8, L * 0.8);
  // Lamp under the floor.
  b.box(0, floor - 0.08, 0, 0.3, 0.06, 0.3, 1, 0, INK.mango, { glow: 1 });
  strap(b, line, INK.ink, 0.035, floor - 0.08);
}

/**
 * Kite. Small kites are a patterned diamond with a long tail of bows; the king kite (a line that
 * needs a chain) is more than twice the size, with a crown. Three frames: the tail waves.
 */
export function kite(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const king = line.minChainN > 1;
  const S = king ? 2.3 : 1;
  // The sail is painted on both faces and turned 40 degrees off the line of travel, so it shows a
  // face (never an edge) to a camera behind it, beside it or above it.
  const body = new MeshBuilder();
  const keel = kiteBody(body, line, frame, S, king);
  const m = new THREE.Matrix4().makeRotationY(0.7);
  b.append(body, m);
  const kt = new THREE.Vector3(keel[0], keel[1], keel[2]).applyMatrix4(m);
  // The kite line: from the keel tip down to the handle.
  const gz = -line.anchorBack;
  const gy = line.anchorY - line.hang;
  b.beam(kt.x, kt.y, kt.z, 0, gy + 0.34, gz, 0.03, INK.ink);
  handle(b, 0, gy, gz);
}

/** The kite itself, facing back and up; returns where its line is tied (the keel tip). */
function kiteBody(b: MeshBuilder, line: CompiledLine, frame: number, S: number, king: boolean): [number, number, number] {
  const liv = line.livery;
  const f = ((frame % 3) + 3) % 3;
  const lean = 0.6;
  const vy = Math.cos(lean);
  const vz = Math.sin(lean);
  const nrm: [number, number, number] = [0, vz, -vy];
  const at = (u: number, v: number, d = 0): [number, number, number] => [u, v * vy + nrm[1] * d, v * vz + nrm[2] * d];
  const top = 1.7 * S;
  const bot = -1.7 * S;
  const half = 1.25 * S;
  const cross = 0.45 * S;
  const mid = cross * 0.4;
  for (const side of [1, -1]) {
    // Each face: four panels in two inks, the pattern on both wings in the accent, spars.
    const n: [number, number, number] = [0, nrm[1] * side, nrm[2] * side];
    const P: Plane = { o: [0, n[1] * 0.01, n[2] * 0.01], u: [1, 0, 0], v: [0, vy, vz], n };
    poly(b, P, [0, top, half, cross, 0, mid], side > 0 ? liv.base : liv.stripe);
    poly(b, P, [0, top, 0, mid, -half, cross], side > 0 ? liv.stripe : liv.base);
    poly(b, P, [-half, cross, 0, mid, 0, bot], side > 0 ? liv.base : liv.stripe);
    poly(b, P, [0, mid, half, cross, 0, bot], side > 0 ? liv.stripe : liv.base);
    const front = lift(P, 0.03);
    pattern(b, front, liv.pattern, 0.08 * S, half * 0.62, -0.75 * S, 0.0, liv.accent);
    pattern(b, front, liv.pattern, -half * 0.62, -0.08 * S, -0.75 * S, 0.0, liv.accent);
    if (king) {
      const c = lift(P, 0.06);
      const cy = 0.5 * S;
      const w = 0.55 * S;
      const h = 0.55 * S;
      rect(b, c, -w, cy - 0.14 * S, w, cy, INK.pink);
      for (const k of [-1, 0, 1]) {
        const cx = k * w * 0.75;
        const tipY = cy + h * (k === 0 ? 1.1 : 0.8);
        poly(b, c, [cx - 0.22 * S, cy, cx + 0.22 * S, cy, cx, tipY], INK.pink);
        poly(b, lift(c, 0.02), [cx - 0.08 * S, tipY, cx + 0.08 * S, tipY, cx + 0.08 * S, tipY + 0.16 * S, cx - 0.08 * S, tipY + 0.16 * S], INK.paper);
      }
    }
  }
  const a = at(0, top, 0.06);
  const c0 = at(0, bot, 0.06);
  const l = at(-half, cross, 0.06);
  const r = at(half, cross, 0.06);
  b.beam(a[0], a[1], a[2], c0[0], c0[1], c0[2], 0.035 * S, INK.ink);
  b.beam(l[0], l[1], l[2], r[0], r[1], r[2], 0.035 * S, INK.ink);
  // Keel: a double-sided fin under the spine, where the line is tied.
  const k0 = at(0, mid);
  const k1 = at(0, bot * 0.55);
  const kt = at(0, (mid + bot * 0.55) / 2 - 0.15 * S, 0.75 * S);
  const keel = [k0[0], k0[1], k0[2], k1[0], k1[1], k1[2], kt[0], kt[1], kt[2]];
  face(b, keel, -1, kt[1], kt[2], liv.accent);
  face(b, keel, 1, kt[1], kt[2], liv.accent);
  // Tail: a waving string of bows from the bottom point, three frames.
  const tail = king ? 10 : 8;
  const seg = 0.7 * S;
  const phase = (f * Math.PI * 2) / 3;
  let px = 0;
  let py = bot * vy;
  let pz = bot * vz;
  for (let i = 1; i <= tail; i++) {
    const x = Math.sin(i * 0.9 + phase) * 0.35 * S * (i / tail + 0.3);
    const y = bot * vy - i * seg * 0.75;
    const z = bot * vz - i * seg * 0.55;
    b.beam(px, py, pz, x, y, z, 0.02 * S, INK.ink);
    const col = i % 2 === 0 ? liv.accent : liv.stripe;
    const bw = 0.3 * S;
    const bh = 0.16 * S;
    // A bow: two triangles meeting at the knot, double-sided.
    for (const s of [1, -1]) {
      const tri = [x, y, z, x + s * bw, y + bh, z, x + s * bw, y - bh, z];
      face(b, tri, x, y, z + 1, col);
      face(b, tri, x, y, z - 1, col);
    }
    px = x;
    py = y;
    pz = z;
  }
  return kt;
}

/** 3x5 block letters, rows top to bottom, '1' = filled. */
const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
};

/** Upper-case, accents folded, only letters and spaces kept. */
export function blockText(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, '');
}

/** Hull radius profile of the airship as [z, r] pairs, nose last. */
const HULL: number[] = [-8, 0, -7.4, 1.3, -6, 2.2, -3.5, 2.8, 0, 3.0, 3, 2.85, 5.5, 2.2, 7.2, 1.2, 8, 0];
const SIDES = 12;

function hullR(z: number): number {
  for (let i = 0; i + 2 < HULL.length; i += 2) {
    const z0 = HULL[i];
    const z1 = HULL[i + 2];
    if (z >= z0 && z <= z1) return HULL[i + 1] + ((HULL[i + 3] - HULL[i + 1]) * (z - z0)) / (z1 - z0);
  }
  return 0;
}

/** Blimp: a fat twelve-sided hull with the line name in block letters, fins, gondola, rope ladder. */
export function blimp(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const liv = line.livery;
  const f = frame % 2;
  // Hull: rings of twelve facets, one facet centred on each side and on the top.
  const ring = (k: number): number => (k / SIDES) * Math.PI * 2 - Math.PI / SIDES;
  for (let i = 0; i + 2 < HULL.length; i += 2) {
    const z0 = HULL[i];
    const r0 = HULL[i + 1];
    const z1 = HULL[i + 2];
    const r1 = HULL[i + 3];
    for (let k = 0; k < SIDES; k++) {
      const a0 = ring(k);
      const a1 = ring(k + 1);
      const col = liv.base;
      const pts: number[] = [];
      pts.push(r0 * Math.cos(a0), r0 * Math.sin(a0), z0);
      if (r0 > 0) pts.push(r0 * Math.cos(a1), r0 * Math.sin(a1), z0);
      pts.push(r1 * Math.cos(a1), r1 * Math.sin(a1), z1);
      if (r1 > 0) pts.push(r1 * Math.cos(a0), r1 * Math.sin(a0), z1);
      face(b, pts, 0, 0, (z0 + z1) / 2, col);
    }
  }
  const cos15 = Math.cos(Math.PI / SIDES);
  const facetHalf = Math.sin(Math.PI / SIDES);
  const bend = (u: number): number => hullR(u) * cos15 + 0.03;
  const bendHi = (u: number): number => hullR(u) * cos15 + 0.05;
  // The livery pattern along the equator facet of each side.
  for (const s of [1, -1]) {
    const P: Plane = { o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [s, 0, 0], bend };
    pattern(b, P, liv.pattern, -5.6, 4.6, -facetHalf * 2.6, facetHalf * 2.6, liv.stripe, liv.accent);
  }
  // Roof mark along the top facet.
  const T: Plane = { o: [0, 0, 0], u: [0, 0, 1], v: [1, 0, 0], n: [0, 1, 0], bend };
  pattern(b, T, liv.pattern, -6, 5, -facetHalf * 2.5, facetHalf * 2.5, liv.accent);
  // The line name in block letters on the upper side facets, reading nose-first from either side.
  const text = blockText(line.name);
  const a = (Math.PI * 2) / SIDES;
  for (const s of [1, -1]) {
    const P: Plane = {
      o: [0, 0, 0],
      u: [0, 0, 1],
      v: [-s * Math.sin(a), Math.cos(a), 0],
      n: [s * Math.cos(a), Math.sin(a), 0],
      bend: bendHi,
    };
    const span = 9.5;
    const cols = text.length * 4 - 1;
    const px = Math.min(0.19, span / cols);
    const ph = Math.min(px, (facetHalf * 2.7 * 2) / 5);
    // Readers on the +x side read toward -z; on the -x side toward +z.
    const dir = -s;
    const start = (cols * px) / 2;
    for (let c = 0; c < text.length; c++) {
      const g = FONT[text[c]];
      if (!g) continue;
      for (let row = 0; row < 5; row++) {
        let run = -1;
        for (let col = 0; col <= 3; col++) {
          const on = col < 3 && g[row * 3 + col] === '1';
          if (on && run < 0) run = col;
          if (!on && run >= 0) {
            const ua = dir * ((c * 4 + run) * px - start);
            const ub = dir * ((c * 4 + col) * px - start);
            const v1 = ph * 2.5 - row * ph;
            rect(b, P, Math.min(ua, ub), v1 - ph, Math.max(ua, ub), v1, liv.stripe);
            run = -1;
          }
        }
      }
    }
  }
  // Tail fins in the stripe ink with accent tips; the rudders kick on twos.
  const flap = f === 0 ? 0.25 : -0.25;
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    const finPts = (r0: number, r1: number, zA: number, zB: number, zC: number): number[] => [
      cx * r0, cy * r0, zA,
      cx * r0, cy * r0, zB,
      cx * r1, cy * r1, zC,
      cx * r1, cy * r1, zA - 0.3,
    ];
    const fin = finPts(1.2, 3.1, -7.3, -4.6, -6.3);
    const t = 0.07;
    const ox = -cy * t;
    const oy = cx * t;
    const sideA = fin.slice();
    const sideB = fin.slice();
    for (let i = 0; i < 12; i += 3) {
      sideA[i] += ox;
      sideA[i + 1] += oy;
      sideB[i] -= ox;
      sideB[i + 1] -= oy;
    }
    face(b, sideA, -ox * 10, -oy * 10, -6.3, liv.stripe);
    face(b, sideB, ox * 10, oy * 10, -6.3, liv.stripe);
    // Rudder flap: trailing edge swung sideways.
    const sw = flap * (k % 2 === 0 ? 1 : -1);
    const rx = -cy * sw;
    const ry = cx * sw;
    const rud = [cx * 1.25, cy * 1.25, -7.35, cx * 3.0, cy * 3.0, -7.6, cx * 3.0 + rx, cy * 3.0 + ry, -8.4, cx * 1.25 + rx * 0.5, cy * 1.25 + ry * 0.5, -8.0];
    face(b, rud, -cy * 5, cx * 5, -7.8, liv.accent);
    face(b, rud, cy * 5, -cx * 5, -7.8, liv.accent);
  }
  // Gondola with glowing windows and nav lamps.
  const gyTop = -2.85;
  const gy0 = line.anchorY;
  const gl = 1.8;
  b.box(0, (gyTop + gy0) / 2, 0.3, 0.75, (gyTop - gy0) / 2, gl, 1, 0, liv.stripe === INK.ink ? INK.ink : shade(liv.stripe, 0.9), { bottom: true });
  for (const s of [1, -1]) rect(b, flank(s, 0.75), -1.2, gy0 + 0.25, 1.9, gyTop - 0.2, GLASS, 1);
  b.box(0, (gyTop + gy0) / 2, 0.3 + gl + 0.02, 0.6, 0.2, 0.03, 1, 0, GLASS, { glow: 1 });
  b.box(2.95, 0, 0.5, 0.08, 0.12, 0.12, 1, 0, INK.teal, { glow: 1 });
  b.box(-2.95, 0, 0.5, 0.08, 0.12, 0.12, 1, 0, INK.pink, { glow: 1 });
  b.box(0, -3.0, 0.3, 0.12, 0.12, 0.12, 1, 0, INK.mango, { glow: 1 });
  // Propellers on outriggers, blades turned between frames.
  for (const s of [1, -1]) {
    const x = s * 1.5;
    const y = gyTop - 0.3;
    const z = -1.3;
    b.beam(s * 0.75, y, z + 0.3, x, y, z + 0.3, 0.05, INK.ink);
    b.box(x, y, z + 0.3, 0.14, 0.14, 0.3, 1, 0, INK.ink, {});
    const ang = f === 0 ? 0.3 : 0.3 + Math.PI / 2;
    const bx = Math.cos(ang) * 0.6;
    const by = Math.sin(ang) * 0.6;
    b.beam(x - bx, y - by, z - 0.03, x + bx, y + by, z - 0.03, 0.06, INK.concrete);
  }
  // Rope ladder from the gondola's tail down to the pink bottom rung.
  const z = -line.anchorBack;
  const gy = line.anchorY - line.hang;
  for (const x of [0.25, -0.25]) b.beam(x, line.anchorY, z, x, gy + 0.05, z, 0.025, INK.sand);
  const rungs = Math.max(2, Math.floor(line.hang / 0.45));
  for (let i = 1; i < rungs; i++) {
    const y = gy + (i * line.hang) / rungs;
    b.beam(-0.25, y, z, 0.25, y, z, 0.022, INK.sand);
  }
  handle(b, 0, gy, z);
}
