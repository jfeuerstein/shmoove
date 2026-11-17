/**
 * Proptown: a 300 x 420 m fixture with one of every solid kind, rail kind and surface, laid out
 * in four district strips on a gentle hill, so the city view can be looked at and tested without
 * the generated city. A straight main street runs from a lookout at the top down to the docks;
 * beside it a stair street with a handrail, terraces with retaining walls, a quay on the sea and a
 * few bus stops. No ride lines. Open with `?world=proptown`.
 */
import { PI, clamp, dcos, dsin, lerp, smoothstep } from './math';
import { Rng } from './rng';
import {
  District,
  Surface,
  addRail,
  addSolid,
  addZone,
  createWorld,
  fillHeights,
  fillSurfaces,
  finalizeWorld,
  terrainHeight,
  type SolidOpts,
  type World,
} from './world';

export const PROPTOWN = {
  minX: -150,
  minZ: -30,
  cell: 3,
  nx: 100,
  nz: 140,
  bands: { docks: 0, mercado: 100, terraces: 200, antenna: 310 },
  streetHalf: 6,
  walkHalf: 12,
  /** Mercado stair street (east of the main street). */
  stairX0: 24,
  stairX1: 33,
  stairZ0: 120,
  stairZ1: 144,
  eastX: 15,
  eastZ0: 100,
  eastZ1: 204,
  /** Terrace shelves west of the main street: [start, end) in z; each ends in a retaining wall. */
  shelves: [
    [200, 237],
    [237, 273],
    [273, 309],
  ] as const,
  shelfX: -15,
  trackX0: 30,
  trackX1: 36,
  spawn: { x: 0, z: 380 },
} as const;

/** The main street's profile: flat docks, then steady climbs. */
function base(z: number): number {
  if (z < -3) return 0.3;
  if (z < 0) return lerp(0.3, 3, (z + 3) / 3);
  if (z < 100) return 3 + 0.005 * z;
  if (z < 200) return 3.5 + 0.08 * (z - 100);
  if (z < 310) return 11.5 + 0.07 * (z - 200);
  return 19.2 + 0.09 * (z - 310);
}

/** The east Mercado block: a low landing, the stair flight, a high landing. */
function east(z: number): number {
  const P = PROPTOWN;
  if (z <= P.stairZ0) return 3.5;
  if (z <= P.stairZ1) return 3.5 + 0.32 * (z - P.stairZ0);
  const top = 3.5 + 0.32 * (P.stairZ1 - P.stairZ0);
  return lerp(top, base(P.eastZ1), (z - P.stairZ1) / (P.eastZ1 - P.stairZ1));
}

/** West terrace shelves: near level, with a bank in the last cell up to the next shelf. */
function shelf(z: number): number | null {
  for (const [z0, z1] of PROPTOWN.shelves) {
    if (z < z0 || z >= z1) continue;
    const lo = base(z0);
    if (z <= z1 - 3) return lo + 0.004 * (z - z0);
    return lerp(lo + 0.004 * (z1 - 3 - z0), base(z1), (z - (z1 - 3)) / 3);
  }
  return null;
}

function hill(x: number, z: number): number {
  if (z <= 310) return 0;
  const s = smoothstep(clamp((z - 310) / 40, 0, 1));
  const u = x / 150;
  return 3 * s * (1 - u * u);
}

export function proptownHeight(x: number, z: number): number {
  const P = PROPTOWN;
  if (x >= P.eastX && z >= P.eastZ0 && z <= P.eastZ1) return east(z);
  if (x <= P.shelfX) {
    const s = shelf(z);
    if (s !== null) return s;
  }
  return base(z) + hill(x, z);
}

function proptownSurface(x: number, z: number): Surface {
  const P = PROPTOWN;
  const ax = Math.abs(x);
  if (z < -3) return Surface.WATER;
  if (z < 0) return Surface.PLAZA;
  if (x >= P.stairX0 && x <= P.stairX1 && z >= P.stairZ0 && z <= P.stairZ1) return Surface.STAIRS;
  if (z >= 9 && z <= 15) return Surface.TRACK; // the crane rails along the quay
  if (ax <= P.streetHalf && z >= 9) return Surface.STREET;
  if (z < P.bands.mercado) {
    if (z >= 42 && z <= 51) return Surface.STREET;
    if (x > 100 && z > 60 && z < 96) return Surface.DIRT;
    return Surface.PLAZA;
  }
  if (z < P.bands.terraces) {
    if (x >= P.eastX && z > P.stairZ0 && z < P.stairZ1) return x < 48 ? Surface.PLAZA : Surface.GRASS;
    return Surface.PLAZA;
  }
  if (z < P.bands.antenna) {
    if (x >= P.trackX0 && x <= P.trackX1) return Surface.TRACK;
    if (x > 64) return Surface.GRASS;
    return Surface.PLAZA;
  }
  if (ax <= P.walkHalf - 2) return Surface.PLAZA;
  const dx = x + 30;
  const dz = z - 368;
  if (dx * dx + dz * dz < 15 * 15 || (x > 80 && z < 340)) return Surface.DIRT;
  return Surface.GRASS;
}

/** Lowest and highest ground under a rotated footprint (corners and centre). */
function groundRange(w: World, cx: number, cz: number, hx: number, hz: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const g = terrainHeight(w, cx + i * hx, cz + j * hz);
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
  }
  return { lo, hi };
}

/** A box standing on the ground: base sunk below the lowest ground, top `h` above the highest. */
function stand(w: World, kind: string, cx: number, cz: number, hx: number, hz: number, h: number, extra: Partial<SolidOpts> = {}): void {
  const g = groundRange(w, cx, cz, hx, hz);
  addSolid(w, { cx, cz, hx, hz, yBase: g.lo - 0.6, yTop: g.hi + h, kind, ...extra });
}

/** A retaining wall from (x0, z0) to (x1, z1) in pieces of at most 14 m, topped `over` above the higher side. */
function wallRun(w: World, x0: number, z0: number, x1: number, z1: number, half: number, over: number, kind = 'wall'): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const n = Math.max(1, Math.ceil(len / 14));
  const alongX = Math.abs(dx) >= Math.abs(dz);
  for (let k = 0; k < n; k++) {
    const ax = x0 + (dx * k) / n;
    const az = z0 + (dz * k) / n;
    const bx = x0 + (dx * (k + 1)) / n;
    const bz = z0 + (dz * (k + 1)) / n;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const hx = alongX ? Math.abs(bx - ax) / 2 : half;
    const hz = alongX ? half : Math.abs(bz - az) / 2;
    const g = groundRange(w, cx, cz, hx + 0.6, hz + 0.6);
    addSolid(w, { cx, cz, hx, hz, yBase: g.lo - 1, yTop: g.hi + over, kind, style: k });
  }
}

export function buildProptown(seed = 1): World {
  const P = PROPTOWN;
  const w = createWorld({ seed, minX: P.minX, minZ: P.minZ, cell: P.cell, nx: P.nx, nz: P.nz });
  const rng = new Rng(seed);
  fillHeights(w, proptownHeight);
  fillSurfaces(w, proptownSurface);
  w.bands = [
    { district: District.DOCKS, zMin: -Infinity, zMax: P.bands.mercado },
    { district: District.MERCADO, zMin: P.bands.mercado, zMax: P.bands.terraces },
    { district: District.TERRACES, zMin: P.bands.terraces, zMax: P.bands.antenna },
    { district: District.ANTENNA, zMin: P.bands.antenna, zMax: Infinity },
  ];
  w.spawn = { x: P.spawn.x, z: P.spawn.z, heading: PI };
  let style = 0;
  const nextStyle = (): number => style++ * 3 + rng.int(3);

  // --- Docks -----------------------------------------------------------------------------------
  // The quay: a low wall over the bank down to the sea, in segments.
  for (let x = -150; x < 150; x += 30) {
    addSolid(w, { cx: x + 15, cz: -1.35, hx: 15, hz: 1.95, yBase: 0, yTop: 3.7, kind: 'quay', style: 0 });
  }
  stand(w, 'warehouse', -70, 30, 18, 10, 10, { style: 1 });
  stand(w, 'warehouse', -72, 76, 15, 12, 9, { style: 2 });
  stand(w, 'warehouse', 70, 27, 14, 8, 3.2, { style: 4 }); // the fish market
  stand(w, 'shed', 112, 30, 3, 2.5, 3, { style: 1 });
  stand(w, 'kiosk', 16, 76, 2, 1.4, 2.6, { style: 2 });
  // Container stacks stepping up: 1, 2, 3, 2, 1 levels.
  const cInk = [0, 1, 2, 3, 4, 5, 6, 7];
  let ci = 0;
  for (let row = 0; row < 3; row++) {
    const cz = 62 + row * 10;
    for (let col = 0; col < 5; col++) {
      const cx = 32 + col * 13.5;
      const levels = [1, 2, 3, 2, 1][(col + row) % 5];
      const g = terrainHeight(w, cx, cz);
      for (let l = 0; l < levels; l++) {
        addSolid(w, { cx, cz, hx: 6.05, hz: 1.22, yBase: g + 2.6 * l - (l === 0 ? 0.3 : 0), yTop: g + 2.6 * (l + 1), kind: 'container', style: cInk[ci++ % cInk.length] });
      }
    }
  }
  for (let k = 0; k < 6; k++) {
    const cx = 18 + (k % 3) * 2.2;
    const cz = 22 + Math.floor(k / 3) * 2.4;
    const s = 0.5 + 0.12 * (k % 2);
    stand(w, 'crate', cx, cz, s, s, 2 * s, { style: k });
  }
  addRail(w, [-40, 1.0 + base(15), 15, -40, 1.0 + base(50), 50, -40, 1.0 + base(90), 90], 'pipe');
  addRail(w, [12.5, base(20) + 0.45, 20, 12.5, base(40) + 0.45, 40], 'ledge');

  // --- Mercado Steps ---------------------------------------------------------------------------
  // The wall between the main street and the east block.
  wallRun(w, 13.5, 102, 13.5, 202, 1.8, 0.9);
  // Buildings flanking the stair flight.
  stand(w, 'building', 19.5, 126, 4, 6, 6, { style: nextStyle() });
  stand(w, 'building', 19.5, 138.5, 4, 6, 5, { style: nextStyle() });
  stand(w, 'building', 40.5, 127, 7, 6.5, 7, { style: nextStyle() });
  stand(w, 'building', 40.5, 140, 7, 5.5, 4, { style: nextStyle() });
  // The handrail down the middle of the flight: level run-in on the landing, past the bottom.
  const rx = (P.stairX0 + P.stairX1) / 2;
  addRail(
    w,
    [
      rx, east(P.stairZ1 + 6) + 0.9, P.stairZ1 + 6,
      rx, east(P.stairZ1) + 0.9, P.stairZ1,
      rx, east(P.stairZ0) + 0.9, P.stairZ0,
      rx, east(P.stairZ0 - 2.5) + 0.9, P.stairZ0 - 2.5,
    ],
    'handrail',
  );
  // Low landing: a market of stalls and awnings.
  for (let k = 0; k < 6; k++) {
    stand(w, 'stall', 54 + k * 7, 108, 1.4, 1.0, 2.4, { style: k, surface: Surface.ROOF });
  }
  for (let k = 0; k < 3; k++) {
    stand(w, 'building', 60 + k * 16, 115.5, 7.5, 3.5, 7 + k, { style: nextStyle() });
    const g = terrainHeight(w, 60 + k * 16, 110.6);
    addSolid(w, { cx: 60 + k * 16, cz: 110.6, hx: 5, hz: 1.4, yBase: g + 2.5, yTop: g + 2.7, surface: Surface.AWNING, oneWay: true, kind: 'awning', style: k });
  }
  // High landing: houses and a kiosk.
  for (let k = 0; k < 6; k++) {
    stand(w, 'building', 44 + k * 17, 190, 7, 8, 6 + ((k * 5) % 7), { style: nextStyle() });
  }
  stand(w, 'kiosk', 30, 170, 1.6, 2.4, 2.7, { style: 1 });
  // West side: a street wall of shops with awnings over the sidewalk.
  for (let k = 0; k < 8; k++) {
    const cz = 106 + k * 12;
    stand(w, 'building', -21, cz, 7.5, 5.6, 6 + ((k * 7) % 6), { style: nextStyle() });
    if (k % 2 === 0) {
      const g = terrainHeight(w, -11.6, cz);
      addSolid(w, { cx: -11.4, cz, hx: 1.6, hz: 3.2, yBase: g + 2.4, yTop: g + 2.6, surface: Surface.AWNING, oneWay: true, kind: 'awning', style: k });
    }
  }
  addZone(w, { id: 'stop_mercado', name: 'Mercado', kind: 'stop', x: 5, y: base(160), z: 160, r: 4 });

  // --- Terraces --------------------------------------------------------------------------------
  for (const [z0, z1] of P.shelves) {
    // Retaining wall across the shelf's uphill end, and along the street where the shelf drops below it.
    wallRun(w, -150, z1 - 1.5, P.shelfX - 0.3, z1 - 1.5, 1.8, 0.8);
    wallRun(w, -13.5, z0 + 9, -13.5, z1 - 3.3, 1.8, 0.8);
    const wy = proptownHeight(-60, z1) + 0.8;
    // A ledge along the wall top.
    addRail(w, [-140, wy + 0.02, z1 - 1.5 - 1.6, -40, wy + 0.02, z1 - 1.5 - 1.6], 'ledge');
    // Two rows of houses with a lane between, laundry strung across it.
    const front = z0 + 6.5;
    const back = z1 - 9.5;
    for (let k = 0; k < 6; k++) {
      const cx = -30 - k * 19;
      const hf = 5 + ((k * 3) % 4);
      const hb = 5.5 + ((k * 5) % 4);
      stand(w, 'house', cx, front, 6.5, 4.5, hf, { style: nextStyle() });
      stand(w, 'house', cx, back, 6.5, 5, hb, { style: nextStyle() });
      if (k < 5) {
        const y = proptownHeight(cx + 9.5, z0 + 18) + 4;
        addRail(w, [cx + 3, y, front + 4.5, cx + 3.5, y, back - 5], 'wire');
      }
    }
  }
  // East of the street: the tram bed with a fence, a clock tower, a kiosk, houses.
  const fence: number[] = [];
  for (let z = 204; z <= 306; z += 6) fence.push(P.trackX0 - 1.2, proptownHeight(P.trackX0 - 1.2, z) + 1.1, z);
  addRail(w, fence, 'fence');
  stand(w, 'tower', 52, 256, 4, 4, 18, { style: 3 });
  stand(w, 'kiosk', 20, 232, 2.2, 1.5, 2.6, { style: 4 });
  for (let k = 0; k < 4; k++) {
    stand(w, 'house', 75 + k * 18, 222, 6, 5, 5 + k, { style: nextStyle() });
    stand(w, 'house', 75 + k * 18, 286, 6, 5, 7 - k, { style: nextStyle() });
  }
  addZone(w, { id: 'stop_terrazas', name: 'Terrazas', kind: 'stop', x: -5, y: base(262), z: 262, r: 4 });

  // --- Antenna Hill ----------------------------------------------------------------------------
  const mastAt = (mx: number, mz: number, h: number, guys: number): number => {
    const g = terrainHeight(w, mx, mz);
    addSolid(w, { cx: mx, cz: mz, hx: 0.5, hz: 0.5, yBase: g - 0.5, yTop: g + h, kind: 'mast', style: 0 });
    for (let k = 0; k < guys; k++) {
      const a = (k / guys) * PI * 2 + 0.4;
      const ca = dcos(a);
      const sa = dsin(a);
      const ax = mx + 26 * ca;
      const az = mz + 26 * sa;
      addRail(w, [mx + 0.6 * ca, g + h - 1.5, mz + 0.6 * sa, ax, terrainHeight(w, ax, az) + 0.3, az], 'guy');
    }
    return g + h;
  };
  mastAt(40, 352, 22, 3);
  mastAt(-72, 362, 20, 3);
  const top = mastAt(100, 376, 16, 0);
  addSolid(w, { cx: 100, cz: 376, hx: 2, hz: 2, yBase: top, yTop: top + 0.6, kind: 'platform', style: 0 });
  stand(w, 'pylon', 62, 322, 0.4, 0.4, 14, { style: 0 });
  stand(w, 'pylon', -60, 330, 0.4, 0.4, 14, { style: 0 });
  stand(w, 'pylon', 70, 132, 0.4, 0.4, 12, { style: 0 });
  stand(w, 'tank', -30, 342, 2.5, 2.5, 6, { style: 0 });
  stand(w, 'shed', -104, 330, 3, 2.4, 3, { style: 2 });
  stand(w, 'building', 72, 344, 4, 3, 3.5, { style: nextStyle() }); // the radio shack
  addZone(w, { id: 'stop_antena', name: 'Antena', kind: 'stop', x: 5, y: base(345), z: 345, r: 4 });
  addZone(w, { id: 'stop_muelle', name: 'Muelle', kind: 'stop', x: 5, y: base(64), z: 64, r: 4 });

  // Something the vocabulary does not know: drawn as a plain box.
  stand(w, 'bandstand', -40, 120, 2, 2, 1, { style: 0 });

  const sy = terrainHeight(w, w.spawn.x, w.spawn.z);
  addZone(w, { id: 'spawn', name: 'Mirador', kind: 'spawn', x: w.spawn.x, y: sy, z: w.spawn.z, r: 5 });
  addZone(w, { id: 'fish_market', name: 'Mercado del Pescado', kind: 'landmark', x: 70, y: base(27), z: 27, r: 8 });
  addZone(w, { id: 'stairs', name: 'Escalera', kind: 'landmark', x: rx, y: east(132), z: 132, r: 6 });
  finalizeWorld(w);
  return w;
}
