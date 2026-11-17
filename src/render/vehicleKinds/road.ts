/**
 * Street rides: the fish truck, the forklift, the moped and the porter's handcart.
 */
import type { CompiledLine } from '../../sim/lines';
import { MeshBuilder, shade } from '../geom';
import { INK } from '../look';
import { face, figure, flank, flanks, grabBar, pattern, poly, prismX, rear, rect, roofMark, wheel, type Plane } from './paint';

const GLASS = 0x2a2f6e;

/** A fish in profile on a flank, nose forward (+u), drawn as quads: body, tail, fins, eye, gills. */
function fish(b: MeshBuilder, P: Plane, cu: number, cv: number, size: number, body: number, detail: number): void {
  const L = size;
  const Hh = size * 0.36;
  // Body: an elongated hexagon.
  poly(b, P, [cu - L * 0.55, cv, cu - L * 0.2, cv - Hh, cu + L * 0.3, cv - Hh, cu + L * 0.55, cv, cu + L * 0.3, cv + Hh, cu - L * 0.2, cv + Hh], body);
  // Tail fan.
  poly(b, P, [cu - L * 0.55, cv, cu - L * 0.85, cv - Hh * 1.05, cu - L * 0.78, cv, cu - L * 0.85, cv + Hh * 1.05], body);
  // Dorsal and belly fins in the detail ink.
  poly(b, P, [cu - L * 0.15, cv + Hh * 0.95, cu + L * 0.15, cv + Hh * 0.95, cu - L * 0.05, cv + Hh * 1.45], detail);
  poly(b, P, [cu - L * 0.05, cv - Hh * 0.95, cu + L * 0.12, cv - Hh * 0.95, cu, cv - Hh * 1.3], detail);
  // Second layer: eye, gill slash and scale stripes.
  const Q: Plane = { o: [P.o[0] + P.n[0] * 0.02, P.o[1] + P.n[1] * 0.02, P.o[2] + P.n[2] * 0.02], u: P.u, v: P.v, n: P.n };
  poly(b, Q, [cu + L * 0.33, cv + Hh * 0.2, cu + L * 0.42, cv + Hh * 0.2, cu + L * 0.42, cv + Hh * 0.45, cu + L * 0.33, cv + Hh * 0.45], INK.ink);
  poly(b, Q, [cu + L * 0.18, cv - Hh * 0.6, cu + L * 0.24, cv - Hh * 0.6, cu + L * 0.3, cv + Hh * 0.6, cu + L * 0.24, cv + Hh * 0.6], detail);
  for (const k of [-0.25, 0.0]) {
    poly(b, Q, [cu + L * k, cv - Hh * 0.7, cu + L * (k + 0.07), cv - Hh * 0.7, cu + L * (k + 0.07), cv + Hh * 0.7, cu + L * k, cv + Hh * 0.7], detail);
  }
}

/** A slatted crate. */
function crate(b: MeshBuilder, x: number, y: number, z: number, h: number, color: number): void {
  b.box(x, y + h, z, h, h, h, 1, 0, color, { top: shade(color, 1.15) });
  b.box(x, y + h, z, h + 0.02, h * 0.12, h + 0.02, 1, 0, shade(color, 0.7), { noTop: true });
}

/** Fish truck: cab, insulated box with a big fish on both sides, crates on the tailgate. */
export function truck(b: MeshBuilder, line: CompiledLine): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const liv = line.livery;
  const cabLen = 1.6;
  const zc = L - cabLen;
  const deck = 0.95;
  // Chassis.
  b.box(0, 0.62, 0, W * 0.75, 0.18, L * 0.98, 1, 0, INK.ink, { bottom: true });
  // Cab with a raked windscreen.
  prismX(b, [zc, 0.55, L, 0.55, L, 1.45, L - 0.45, 2.45, zc, 2.45], -W, W, liv.stripe);
  prismX(b, [L - 0.02, 1.5, L + 0.01, 1.52, L - 0.42, 2.38, L - 0.47, 2.38], -W + 0.08, W - 0.08, GLASS, { glow: 0.5 });
  for (const s of [1, -1]) {
    rect(b, flank(s, W), zc + 0.15, 1.5, L - 0.55, 2.25, GLASS, 0.6);
    rect(b, flank(s, W), zc + 0.1, 0.75, L - 0.1, 1.0, liv.base);
  }
  b.box(0, 2.52, zc + 0.6, W * 0.85, 0.07, 0.55, 1, 0, liv.accent, {});
  // Insulated box.
  const bz0 = -L;
  const bz1 = zc - 0.12;
  const bc = (bz0 + bz1) / 2;
  const bh = (bz1 - bz0) / 2;
  b.box(0, (deck + H) / 2, bc, W, (H - deck) / 2, bh, 1, 0, liv.base, { bottom: true });
  for (const s of [1, -1]) {
    const P = flank(s, W);
    pattern(b, P, liv.pattern, bz0 + 0.12, bz1 - 0.12, deck + 0.12, deck + 0.55, liv.stripe, liv.accent);
    fish(b, P, bc, (deck + 0.65 + H) / 2 + 0.05, Math.min(bh * 1.55, 3.4), liv.accent, liv.stripe);
  }
  roofMark(b, liv, H, W * 0.82, bz0 + 0.2, bz1 - 0.2);
  // Box corner trims.
  for (const s of [1, -1]) {
    b.box(s * W, (deck + H) / 2, bz1, 0.06, (H - deck) / 2, 0.06, 1, 0, INK.paper, {});
    b.box(s * W, (deck + H) / 2, bz0, 0.06, (H - deck) / 2, 0.06, 1, 0, INK.paper, {});
  }
  rect(b, rear(L), -W * 0.85, deck + 0.3, W * 0.85, H - 0.2, shade(liv.base, 0.85));
  rect(b, rear(L + 0.02), -0.04, deck + 0.3, 0.04, H - 0.2, INK.ink);
  // Tailgate shelf with crates of fish.
  b.box(0, deck - 0.05, -L - 0.22, W * 0.9, 0.05, 0.22, 1, 0, INK.concrete, { bottom: true });
  crate(b, -0.5, deck, -L - 0.22, 0.2, INK.teal);
  crate(b, 0.05, deck, -L - 0.22, 0.2, INK.mango);
  crate(b, -0.22, deck + 0.4, -L - 0.22, 0.18, INK.paper);
  b.box(0.55, deck + 0.12, -L - 0.22, 0.14, 0.04, 0.12, 1, 0, INK.concrete, {});
  // Lamps.
  for (const s of [1, -1]) {
    b.box(s * W * 0.7, 0.95, L + 0.03, 0.18, 0.12, 0.03, 1, 0, INK.white, { glow: 1 });
    b.box(s * W * 0.75, deck + 0.15, -L - 0.03, 0.12, 0.12, 0.03, 1, 0, INK.pink, { glow: 0.9 });
  }
  b.box(0, 2.6, zc + 0.6, 0.35, 0.06, 0.08, 1, 0, INK.mango, { glow: 0.8 });
  // Wheels: steer axle under the cab, twin axles under the box.
  for (const z of [L - 0.85, -L * 0.45, -L * 0.75]) for (const s of [1, -1]) wheel(b, s * (W - 0.2), 0.45, z, 0.45, 0.18, 0.4);
  b.box(0, 0.62, -L - 0.08, W * 0.9, 0.1, 0.1, 1, 0, INK.ink, {});
  grabBar(b, line, -L - 0.06, 0.62, 0.5);
}

/** Forklift: mast and forks carrying a pallet, roll cage over a seated driver, a beacon on top. */
export function forklift(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const H = line.bodyHeight;
  const liv = line.livery;
  // Body tub and the rear counterweight.
  b.box(0, 0.62, L * 0.15, W, 0.38, L * 0.75, 1, 0, liv.base, { bottom: true });
  prismX(b, [-L, 0.25, -L * 0.45, 0.25, -L * 0.45, 1.25, -L * 0.85, 1.25, -L, 1.05], -W, W, liv.stripe);
  flanks(b, liv, W, -L * 0.45, L * 0.88, 0.32, 0.95);
  rect(b, rear(L), -W * 0.8, 0.45, W * 0.8, 0.9, liv.accent);
  // Seat and driver.
  b.box(0, 1.1, -L * 0.35, 0.25, 0.08, 0.22, 1, 0, INK.ink, {});
  b.box(0, 1.35, -L * 0.52, 0.25, 0.25, 0.06, 1, 0, INK.ink, {});
  figure(b, 0, 0.62, -L * 0.38, {
    shirt: INK.mango,
    legs: INK.cobalt,
    hat: INK.mango,
    stride: 0,
    seated: true,
    handL: [0.18, 0.62 + 0.55, 0.5],
    handR: [-0.18, 0.62 + 0.55, 0.5],
    scale: 0.95,
  });
  b.beam(0, 1.0, L * 0.4, 0, 1.25, L * 0.12, 0.04, INK.ink);
  b.beam(-0.2, 1.25, L * 0.12, 0.2, 1.25, L * 0.12, 0.03, INK.ink);
  // Roll cage: four posts and a roof plate carrying the roof mark.
  for (const x of [W - 0.06, -W + 0.06]) {
    b.beam(x, 0.95, L * 0.45, x, H, L * 0.25, 0.045, INK.ink);
    b.beam(x, 1.15, -L * 0.8, x, H, -L * 0.6, 0.045, INK.ink);
  }
  b.box(0, H + 0.04, -L * 0.17, W, 0.05, L * 0.47, 1, 0, liv.base, { bottom: true });
  roofMark(b, liv, H + 0.09, W * 0.85, -L * 0.6, L * 0.25);
  // Beacon, flashing on twos.
  const lit = frame % 2 === 0;
  b.box(0, H + 0.19, -L * 0.2, 0.12, 0.1, 0.12, 1, 0, lit ? INK.mango : shade(INK.mango, 0.55), { glow: lit ? 1 : 0.15 });
  if (lit) {
    for (const s of [1, -1]) {
      b.beam(s * 0.16, H + 0.19, -L * 0.2, s * 0.42, H + 0.24, -L * 0.2, 0.025, INK.mango, 1);
    }
    b.beam(0, H + 0.19, -L * 0.2 - 0.16, 0, H + 0.24, -L * 0.2 - 0.42, 0.025, INK.mango, 1);
  }
  // Mast, carriage, forks and the loaded pallet.
  const mz = L + 0.12;
  for (const x of [0.32, -0.32]) b.beam(x, 0.15, mz, x, H + 0.15, mz, 0.06, INK.ink);
  b.beam(-0.32, H + 0.1, mz, 0.32, H + 0.1, mz, 0.05, INK.ink);
  b.box(0, 0.6, mz + 0.1, 0.4, 0.3, 0.05, 1, 0, liv.stripe, {});
  for (const x of [0.22, -0.22]) b.box(x, 0.32, mz + 0.62, 0.05, 0.03, 0.5, 1, 0, INK.ink, { bottom: true });
  b.box(0, 0.42, mz + 0.62, 0.48, 0.07, 0.5, 1, 0, INK.sand, { bottom: true });
  b.box(0, 0.8, mz + 0.62, 0.42, 0.31, 0.42, 1, 0, INK.paper, { top: liv.accent });
  b.box(0, 0.8, mz + 0.62, 0.43, 0.06, 0.43, 1, 0, liv.stripe, { noTop: true });
  // Lamps.
  for (const s of [1, -1]) b.box(s * (W - 0.08), 1.0, L * 0.9, 0.08, 0.07, 0.03, 1, 0, INK.white, { glow: 1 });
  // Wheels.
  for (const s of [1, -1]) {
    wheel(b, s * (W - 0.12), 0.3, L * 0.55, 0.3, 0.12, 0);
    wheel(b, s * (W - 0.12), 0.26, -L * 0.6, 0.26, 0.11, 0);
  }
  grabBar(b, line, -L * 0.95, 0.8, 0.42);
}

/** Moped with a top box and its rider. Two frames: wheels turn, the rider boils. */
export function moped(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const liv = line.livery;
  const f = frame % 2;
  const rot = f * (Math.PI / 8);
  const r = 0.3;
  wheel(b, 0, r, L * 0.68, r, 0.07, rot, 8);
  wheel(b, 0, r, -L * 0.62, r, 0.08, rot, 8);
  // Rear shell over the back wheel, floorboard, leg shield and steering post.
  const sw = Math.min(W * 0.62, 0.28);
  prismX(b, [-L * 0.95, 0.45, -L * 0.05, 0.42, -L * 0.05, 0.78, -L * 0.6, 0.86, -L * 0.98, 0.72], -sw, sw, liv.base);
  for (const s of [1, -1]) pattern(b, flank(s, sw), liv.pattern, -L * 0.85, -L * 0.1, 0.48, 0.74, liv.stripe);
  b.box(0, 0.88, -L * 0.42, 0.17, 0.04, 0.32, 1, 0, INK.ink, {});
  b.box(0, 0.3, L * 0.1, 0.16, 0.05, L * 0.32, 1, 0, INK.ink, { bottom: true });
  prismX(b, [L * 0.38, 0.28, L * 0.55, 0.28, L * 0.62, 1.05, L * 0.48, 1.05], -0.22, 0.22, liv.base);
  b.beam(0, 1.05, L * 0.55, 0, 1.18, L * 0.5, 0.04, INK.ink);
  b.beam(-0.34, 1.2, L * 0.48, 0.34, 1.2, L * 0.48, 0.03, INK.ink);
  b.box(0, 1.12, L * 0.62, 0.09, 0.07, 0.04, 1, 0, INK.white, { glow: 1 });
  b.box(0, 0.72, L * 0.32, 0.12, 0.25, 0.05, 1, 0, liv.base, {});
  // Top box on the rear rack, patterned, with the accent lid as the roof mark.
  const tz = -L * 0.88;
  b.box(0, 1.08, tz, 0.26, 0.2, 0.24, 1, 0, liv.base, { bottom: true });
  for (const s of [1, -1]) pattern(b, flank(s, 0.26), liv.pattern, tz - 0.2, tz + 0.2, 0.93, 1.23, liv.stripe);
  b.box(0, 1.3, tz, 0.27, 0.025, 0.25, 1, 0, liv.accent, {});
  b.box(0, 1.0, tz - 0.25, 0.1, 0.05, 0.02, 1, 0, INK.pink, { glow: 0.9 });
  // Rider: helmet in the accent ink, hands on the bars.
  const bob = f === 0 ? 0 : 0.03;
  figure(b, 0, 0.36 + bob, -L * 0.35, {
    shirt: liv.stripe === INK.paper ? INK.ink : liv.stripe,
    legs: INK.ink,
    hat: liv.accent,
    stride: 0,
    seated: true,
    handL: [0.33, 1.22 - 0.36 - bob, L * 0.83],
    handR: [-0.33, 1.22 - 0.36 - bob, L * 0.83],
  });
  grabBar(b, line, tz - 0.22, 0.95, 0.3);
}

/** A porter pushing a long-handled handcart of sacks and crates under a parasol. Two frames. */
export function handcart(b: MeshBuilder, line: CompiledLine, frame: number): void {
  const L = line.bodyHalfLen;
  const W = line.bodyHalfWid;
  const liv = line.livery;
  const f = frame % 2;
  const bedY = 0.55;
  const z0 = -L * 0.25;
  const z1 = L;
  const zc = (z0 + z1) / 2;
  const hl = (z1 - z0) / 2;
  // Bed and side boards with the livery.
  b.box(0, bedY, zc, W * 0.85, 0.05, hl, 1, 0, INK.sand, { bottom: true });
  for (const s of [1, -1]) {
    b.box(s * W * 0.85, bedY + 0.22, zc, 0.03, 0.2, hl, 1, 0, liv.base, {});
    pattern(b, flank(s, W * 0.85 + 0.03), liv.pattern, z0 + 0.05, z1 - 0.05, bedY + 0.05, bedY + 0.4, liv.stripe);
  }
  b.box(0, bedY + 0.22, z1, W * 0.85, 0.2, 0.03, 1, 0, liv.base, {});
  // Load: sacks and crates.
  b.box(0.2, bedY + 0.3, zc + 0.35, 0.25, 0.25, 0.3, 1, 0, INK.concrete, { top: INK.paper });
  b.box(-0.22, bedY + 0.28, zc + 0.3, 0.22, 0.23, 0.28, 1, 0, INK.sand, {});
  crate(b, 0.05, bedY + 0.05, zc - 0.35, 0.24, INK.teal);
  b.box(0, bedY + 0.75, zc + 0.2, 0.22, 0.2, 0.25, 1, 0, INK.brick, { top: liv.accent });
  // Wheels turn on twos.
  const rot = f * (Math.PI / 6);
  for (const s of [1, -1]) wheel(b, s * (W * 0.85 + 0.1), 0.42, zc - 0.1, 0.42, 0.06, rot, 8);
  b.beam(-W * 0.85 - 0.1, 0.42, zc - 0.1, W * 0.85 + 0.1, 0.42, zc - 0.1, 0.03, INK.ink);
  b.beam(0, bedY - 0.05, z1 - 0.1, 0, 0.0, z1 - 0.1, 0.035, INK.ink);
  // Long handles back past the porter, joined by the pink grab bar.
  const gz = -line.anchorBack;
  for (const s of [1, -1]) b.beam(s * W * 0.7, bedY + 0.05, z0, s * 0.42, line.anchorY, gz, 0.035, INK.ink);
  // Parasol: pole and an eight-panel canopy in two inks, the roof mark seen from above.
  const py = 2.35;
  b.beam(0, bedY, zc - 0.25, 0, py, zc - 0.25, 0.03, INK.ink);
  const R = Math.min(W + 0.45, 1.05);
  const cz = zc - 0.25;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    const col = i % 2 === 0 ? liv.accent : liv.stripe === liv.accent ? INK.paper : liv.stripe;
    const tri = [0, py + 0.35, cz, R * Math.cos(a0), py - 0.05, cz + R * Math.sin(a0), R * Math.cos(a1), py - 0.05, cz + R * Math.sin(a1)];
    face(b, tri, 0, py - 1, cz, col);
    const under = [0, py + 0.33, cz, R * Math.cos(a0), py - 0.07, cz + R * Math.sin(a0), R * Math.cos(a1), py - 0.07, cz + R * Math.sin(a1)];
    face(b, under, 0, py + 2, cz, shade(col, 0.8));
  }
  // The porter, striding on twos.
  const pz = gz + 0.55;
  figure(b, 0, 0, pz, {
    shirt: INK.paper,
    legs: INK.cobalt,
    hat: liv.base,
    stride: f === 0 ? 1 : -1,
    handL: [0.36, line.anchorY + 0.04, 0.3],
    handR: [-0.36, line.anchorY + 0.04, 0.3],
  });
  grabBar(b, line, gz + 0.02, line.anchorY, 0.42);
}
