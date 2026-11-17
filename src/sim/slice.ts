/**
 * The M1 feel slice: one hill street, one tram loop, one funicular, a terrace with a staircase and
 * a handrail, a kiosk to wallride, an awning to bounce on. Small enough to tune the controller
 * on; built with the same World contract the full city uses. Open with `?slice`.
 */
import { compileLine, nearestArc, smoothPath, type LineDef } from './lines';
import { PI, clamp, lerp } from './math';
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
  type World,
} from './world';

/** Timed so a funicular car overtakes each climbing tram mid-hill: the slice's built-in chain. */
export const FUNI_PHASE = 1470;

/** Awning height above the sidewalk at its centre: underside and top. */
export const AWNING_CLEAR = 2.3;
export const AWNING_TOP = 2.5;

export const SLICE = {
  slope: 0.13,
  slopeZ0: 40,
  slopeZ1: 340,
  baseY: 2,
  streetHalf: 9,
  // Terrace and staircase on the east side.
  terraceX: 14,
  terraceZ0: 244,
  terraceZ1: 290,
  stairZ0: 204,
  stairX0: 16,
  stairX1: 24,
  railX: 20,
  // Funicular tracks on the west side.
  funiUpX: -15,
  funiDownX: -19,
  funiZ0: 50,
  funiZ1: 345,
  // Tram lanes.
  tramUpX: -4,
  tramDownX: 4,
  tramZ0: 30,
  tramZ1: 350,
} as const;

function baseHeight(z: number): number {
  const S = SLICE;
  if (z < -2) return 0.2;
  if (z < S.slopeZ0) return S.baseY;
  if (z > S.slopeZ1) return S.baseY + (S.slopeZ1 - S.slopeZ0) * S.slope;
  return S.baseY + (z - S.slopeZ0) * S.slope;
}

function sliceHeight(x: number, z: number): number {
  const S = SLICE;
  const base = baseHeight(z);
  if (x <= S.terraceX - 4 || z <= S.stairZ0 || z >= S.terraceZ1) return base;
  const top = baseHeight(S.terraceZ1);
  const east = z >= S.terraceZ0 ? top : lerp(baseHeight(S.stairZ0), top, (z - S.stairZ0) / (S.terraceZ0 - S.stairZ0));
  return lerp(base, east, clamp((x - (S.terraceX - 4)) / 4, 0, 1));
}

function sliceSurface(x: number, z: number): Surface {
  const S = SLICE;
  if (z < -2) return Surface.WATER;
  if (x >= S.stairX0 && x <= S.stairX1 && z >= S.stairZ0 && z <= S.terraceZ0) return Surface.STAIRS;
  if (Math.abs(x) <= S.streetHalf) return Surface.STREET;
  if (x >= S.funiDownX - 2 && x <= S.funiUpX + 2 && z >= S.funiZ0 - 6 && z <= S.funiZ1 + 6) return Surface.TRACK;
  return Surface.PLAZA;
}

/** Drape a flat xyz path onto the terrain. */
function drape(w: World, pts: number[]): number[] {
  for (let i = 0; i < pts.length; i += 3) pts[i + 1] = terrainHeight(w, pts[i], pts[i + 2]);
  return pts;
}

export function buildSlice(seed = 1, funiPhase: number = FUNI_PHASE): World {
  const S = SLICE;
  const w = createWorld({ seed, minX: -64, minZ: -16, cell: 2, nx: 64, nz: 216 });
  fillHeights(w, sliceHeight);
  fillSurfaces(w, sliceSurface);
  w.bands = [{ district: District.TERRACES, zMin: -Infinity, zMax: Infinity }];
  w.spawn = { x: 1.5, z: 336, heading: PI };

  // Building rows behind the sidewalks, stepping up the hill.
  let style = 0;
  for (let z = 20; z < 400; z += 20) {
    const hEast = 7 + ((z * 7) % 5);
    const hWest = 6 + ((z * 11) % 6);
    const gE = baseHeight(z);
    // Leave the terrace, the stairs and their run-out open on the east side.
    if (z + 17 < S.stairZ0 - 24 || z > S.terraceZ1 + 8) {
      addSolid(w, { cx: 26, cz: z + 8, hx: 7, hz: 8.5, yBase: gE - 1, yTop: gE + hEast, kind: 'building', style: style++ });
    } else {
      addSolid(w, { cx: 44, cz: z + 8, hx: 8, hz: 8.5, yBase: gE - 1, yTop: gE + hEast + 4, kind: 'building', style: style++ });
    }
    addSolid(w, { cx: -44, cz: z + 8, hx: 8, hz: 8.5, yBase: gE - 1, yTop: gE + hWest, kind: 'building', style: style++ });
  }

  // A long low kiosk on the east sidewalk: wallride its side, ride over its lip onto the roof.
  const kioskY = baseHeight(80);
  addSolid(w, { cx: 14, cz: 80, hx: 2, hz: 14, yBase: kioskY - 3, yTop: kioskY + 2.6, kind: 'kiosk', style: 3 });

  // An awning over the east sidewalk, below the stairs.
  const awnY = baseHeight(170);
  addSolid(w, {
    cx: 13,
    cz: 170,
    hx: 3,
    hz: 5,
    yBase: awnY + AWNING_CLEAR,
    yTop: awnY + AWNING_TOP,
    surface: Surface.AWNING,
    oneWay: true,
    kind: 'awning',
    style: 1,
  });

  // The handrail down the middle of the stairs, with a flat run-in on the terrace.
  const railH = 0.9;
  addRail(
    w,
    [
      S.railX, sliceHeight(S.railX, S.terraceZ0 + 6) + railH, S.terraceZ0 + 6,
      S.railX, sliceHeight(S.railX, S.terraceZ0) + railH, S.terraceZ0,
      S.railX, sliceHeight(S.railX, S.stairZ0) + railH, S.stairZ0,
      S.railX, sliceHeight(S.railX, S.stairZ0 - 3) + railH, S.stairZ0 - 3,
    ],
    'handrail',
  );
  // A curb ledge beside the street.
  addRail(w, [10.5, baseHeight(150) + 0.45, 150, 10.5, baseHeight(110) + 0.45, 110], 'ledge');

  // Tram: up the west lane, round the top, down the east lane, round the bottom.
  const tramCtrl = [
    S.tramUpX, 0, S.tramZ0,
    S.tramUpX, 0, 120,
    S.tramUpX, 0, 220,
    S.tramUpX, 0, S.tramZ1,
    0, 0, S.tramZ1 + 10,
    S.tramDownX, 0, S.tramZ1,
    S.tramDownX, 0, 220,
    S.tramDownX, 0, 120,
    S.tramDownX, 0, S.tramZ0,
    0, 0, S.tramZ0 - 10,
  ];
  const tramPath = drape(w, smoothPath(tramCtrl, 3, true));
  const tram: LineDef = {
    id: 'T5',
    name: 'Tranvía 5',
    kind: 'tram',
    district: District.TERRACES,
    stem: 1,
    path: tramPath,
    loop: true,
    stops: [
      { s: 0, name: 'Muelle' },
      { s: nearestArc(tramPath, S.tramUpX, 190), name: 'Escalera' },
      { s: nearestArc(tramPath, 0, S.tramZ1 + 10), name: 'Mirador' },
      { s: nearestArc(tramPath, S.tramDownX, 190), name: 'Escalera' },
    ],
    cruise: 9,
    accel: 2.5,
    dwell: 3,
    vehicles: 2,
    windows: [[0, 1]],
    overhead: false,
    anchorBack: 5,
    anchorY: 1,
    hang: 0,
    rope: 3.6,
    bodyHalfLen: 4.8,
    bodyHalfWid: 1.3,
    bodyHeight: 3.3,
    livery: { base: 0xffae1a, stripe: 0x1f3fbf, accent: 0xff2e88, pattern: 0 },
  };

  // Funicular: two cars on parallel tracks, a closed circuit so they pass each other.
  const funiCtrl = [
    S.funiUpX, 0, S.funiZ0,
    S.funiUpX, 0, 150,
    S.funiUpX, 0, 250,
    S.funiUpX, 0, S.funiZ1,
    (S.funiUpX + S.funiDownX) / 2, 0, S.funiZ1 + 4,
    S.funiDownX, 0, S.funiZ1,
    S.funiDownX, 0, 250,
    S.funiDownX, 0, 150,
    S.funiDownX, 0, S.funiZ0,
    (S.funiUpX + S.funiDownX) / 2, 0, S.funiZ0 - 4,
  ];
  const funiPath = drape(w, smoothPath(funiCtrl, 3, true));
  const funi: LineDef = {
    id: 'T1',
    name: 'Funicular',
    kind: 'funicular',
    district: District.TERRACES,
    stem: 0,
    path: funiPath,
    loop: true,
    stops: [
      { s: 0, name: 'Base' },
      { s: nearestArc(funiPath, (S.funiUpX + S.funiDownX) / 2, S.funiZ1 + 4), name: 'Cima' },
    ],
    cruise: 15,
    accel: 3.5,
    dwell: 4,
    vehicles: 2,
    phase: funiPhase,
    windows: [[0, 1]],
    overhead: false,
    anchorBack: 4,
    anchorY: 1,
    hang: 0,
    rope: 3,
    bodyHalfLen: 3.8,
    bodyHalfWid: 1.3,
    bodyHeight: 3,
    livery: { base: 0xff2e88, stripe: 0xf3ebdd, accent: 0x00a99d, pattern: 3 },
  };
  w.lines = [compileLine(tram, 0), compileLine(funi, 1)];

  addZone(w, { id: 'spawn', name: 'Mirador', kind: 'spawn', x: w.spawn.x, y: terrainHeight(w, w.spawn.x, w.spawn.z), z: w.spawn.z, r: 4 });
  addZone(w, { id: 'terrace', name: 'Terraza', kind: 'landmark', x: 20, y: baseHeight(S.terraceZ1), z: 268, r: 8 });

  finalizeWorld(w);
  return w;
}
