/**
 * Santa Rampa's hand-authored layout: the numbers every other city module builds from.
 *
 * The hill is a smooth base profile `baseHeight(z)` (z only). Streets are carved into it:
 * - Mercado landings: level cross streets every 52 m (z = MERCADO_LANDINGS).
 * - Terrace pads: a street plus a yard behind it, cresting at x = 0 and falling 2% to both ends,
 *   held by retaining walls (z = TERRACE_FRONTS, front edge on a grid line).
 * - Two switchback roads (east and west edge zones) whose inner hairpins meet every landing and
 *   pad at its end (x = +-APEX_X): the vehicle routes climb on these.
 * - N-S stair streets with landings at every crossing; the spine is the one at x = 0.
 */

export const CITY = {
  minX: -180,
  maxX: 180,
  minZ: -42,
  maxZ: 1302,
  cell: 3,
  /** z where each band starts: docks 0, mercado 280, terraces 600, antenna 940, top 1280 */
  bands: { docks: 0, mercado: 280, terraces: 600, antenna: 940, top: 1280 },
} as const;

export const GRID = { nx: 120, nz: 448 } as const;

/** Height of the sea surface terrain and of the docks at the quay. */
export const SEA_Y = 0.3;
export const DOCKS_Y0 = 3;
/** Docks grade: under the 1.2% at which a skater at rest would start to roll. */
export const DOCKS_GRADE = 0.01;
export const MERCADO_Y0 = DOCKS_Y0 + DOCKS_GRADE * CITY.bands.mercado;
export const TERRACES_Y0 = 70;
export const ANTENNA_Y0 = 150;
export const SUMMIT_Y = 230;
/** The steady hillside ends here; above it the summit rounds off to SUMMIT_Y. */
export const SUMMIT_SHOULDER_Z = 1236;
export const SUMMIT_Z = 1262;

/** The base hill: smooth, z only. */
export function baseHeight(z: number): number {
  const B = CITY.bands;
  if (z < -1.5) return SEA_Y;
  if (z <= B.mercado) return DOCKS_Y0 + DOCKS_GRADE * Math.max(0, z);
  if (z <= B.terraces) return MERCADO_Y0 + ((z - B.mercado) * (TERRACES_Y0 - MERCADO_Y0)) / (B.terraces - B.mercado);
  if (z <= B.antenna) return TERRACES_Y0 + ((z - B.terraces) * (ANTENNA_Y0 - TERRACES_Y0)) / (B.antenna - B.terraces);
  const shoulderY = SUMMIT_Y - 2;
  if (z <= SUMMIT_SHOULDER_Z) return ANTENNA_Y0 + ((z - B.antenna) * (shoulderY - ANTENNA_Y0)) / (SUMMIT_SHOULDER_Z - B.antenna);
  if (z >= SUMMIT_Z) return SUMMIT_Y;
  // Round the shoulder: slope eases to zero at the summit.
  const t = (z - SUMMIT_SHOULDER_Z) / (SUMMIT_Z - SUMMIT_SHOULDER_Z);
  const g0 = (shoulderY - ANTENNA_Y0) / (SUMMIT_SHOULDER_Z - B.antenna);
  const L = SUMMIT_Z - SUMMIT_SHOULDER_Z;
  // Cubic Hermite from (shoulderY, g0) to (SUMMIT_Y, 0).
  const h00 = 2 * t * t * t - 3 * t * t + 1;
  const h10 = t * t * t - 2 * t * t + t;
  const h01 = -2 * t * t * t + 3 * t * t;
  return h00 * shoulderY + h10 * g0 * L + h01 * SUMMIT_Y;
}

/** Docks height (the docks grade continued), used where docks streets run past z = 280. */
export function docksHeight(z: number): number {
  return DOCKS_Y0 + DOCKS_GRADE * Math.max(0, z);
}

// ---------------------------------------------------------------------------------------------
// Levels: Mercado landings and Terrace pads. Each level is a cross street whose end meets an
// inner hairpin of both switchback roads at x = +-APEX_X.

/** x of the inner hairpin apexes (the ends of every landing and pad street). */
export const APEX_X = 115;
export const ROAD_HALF = 7;
/** Inner hairpin radius and the x of the outer hairpin centres. */
export const INNER_R = 13;
export const OUTER_X = 152;
/** The docks boulevard: the bottom of both switchback roads. */
export const BOULEVARD_Z = 258;

/** Mercado landing centre lines. */
export const MERCADO_LANDINGS = [306, 358, 410, 462, 514, 566] as const;
export const LANDING_HALF = 8;
/** Terrace pad front edges (grid lines). Street = first 14 m, yard = next 19 m. */
export const TERRACE_FRONTS = [612, 666, 720, 774, 828, 882, 936] as const;
export const PAD_STREET = 14;
export const PAD_DEPTH = 33;
export const PAD_TILT = 0.02;

export interface Level {
  /** Street centre line. */
  z: number;
  /** z range of the level's street. */
  z0: number;
  z1: number;
  /** z range of the whole level pad (street + yard for terraces). */
  padZ1: number;
  terrace: boolean;
  /** Height at the apex (the road meets it here). */
  yEnd: number;
}

export const LEVELS: readonly Level[] = [
  ...MERCADO_LANDINGS.map((z) => ({
    z,
    z0: z - LANDING_HALF,
    z1: z + LANDING_HALF,
    padZ1: z + LANDING_HALF,
    terrace: false,
    yEnd: baseHeight(z),
  })),
  ...TERRACE_FRONTS.map((f) => ({
    z: f + PAD_STREET / 2,
    z0: f,
    z1: f + PAD_STREET,
    padZ1: f + PAD_DEPTH,
    terrace: true,
    yEnd: baseHeight(f + PAD_STREET / 2),
  })),
];

/** The landing the wedding plaza opens off, and the x range it holds level (the plaza plus its blend). */
export const PLAZA_LEVEL_Z = 462;
const PLAZA_FLAT_X0 = 8;
const PLAZA_FLAT_X1 = 72;

/**
 * Height of a level's street (and pad) at x, along its length. Every level crests at x = 0 and
 * falls PAD_TILT to the hairpin apexes, so a skater at rest on a cross street rolls off to a road
 * and down it. The plaza landing holds the wedding plaza level and falls more steeply east of it.
 */
export function levelHeight(L: Level, x: number): number {
  const ax = Math.min(Math.abs(x), APEX_X);
  if (L.z === PLAZA_LEVEL_Z && x > PLAZA_FLAT_X0) {
    const flat = L.yEnd + PAD_TILT * (APEX_X - PLAZA_FLAT_X0);
    if (x <= PLAZA_FLAT_X1) return flat;
    return L.yEnd + ((flat - L.yEnd) * (APEX_X - ax)) / (APEX_X - PLAZA_FLAT_X1);
  }
  return L.yEnd + PAD_TILT * (APEX_X - ax);
}

/**
 * Where a level is crossed by a stair street (or the funicular bed), its street also falls toward
 * the flight below, so a skater who has come to rest on the stair street's path rolls on down.
 */
export const CROSS_FALL = 0.033;
/** The spawn lookout's fall: steeper, so a new skater rolls off without a push. */
export const SPAWN_FALL = 0.05;
/** The new-game spawn: on the spine's apron at the top landing of the Mercado, facing downhill. */
export const SPAWN_LEVEL_Z = 566;
export const SPAWN_Z = 570;
/**
 * The cross fall is full to CROSS_PAD beyond a stair street's edge (negative: inside it) and fades
 * out over the next CROSS_FADE, before the building rows that flank the street begin.
 */
const CROSS_PAD = -0.5;
const CROSS_FADE = 2;

/** Axis and half width of every stair street (and the funicular bed) crossing a level. */
export function crossings(L: Level): readonly (readonly [number, number])[] {
  if (L.terrace) return [[SPINE_X, SPINE_HALF], [(FUNI_X0 + FUNI_X1) / 2, (FUNI_X1 - FUNI_X0) / 2]];
  const out: [number, number][] = [[SPINE_X, SPINE_HALF], [FUNI_X, 6]];
  for (const x of MERCADO_STAIRS) {
    // The stair streets that open onto the wedding plaza arrive at its level floor, and resume
    // at the next landing up with no flight below it (the church stands there).
    if ((L.z === PLAZA_LEVEL_Z || L.z === PLAZA_LEVEL_Z + 52) && x > PLAZA_FLAT_X0 && x < PLAZA_FLAT_X1) continue;
    out.push([x, STAIR_HALF]);
  }
  return out;
}

/** Weight (0..1) of the cross fall at x on level L. */
export function crossWeight(L: Level, x: number): number {
  let wt = 0;
  for (const [a, h] of crossings(L)) {
    const d = Math.abs(x - a) - h - CROSS_PAD;
    if (d <= 0) return 1;
    if (d < CROSS_FADE) {
      const t = 1 - d / CROSS_FADE;
      wt = Math.max(wt, t * t * (3 - 2 * t));
    }
  }
  return wt;
}

/**
 * Height of a level's street at (x, z): its profile along x, plus the fall toward the flight below
 * at crossings. The fall hangs from the street's back edge, so a crossing is a shallow trough:
 * rolling into one from the street beside it is always downhill.
 */
export function streetHeight(L: Level, x: number, z: number): number {
  const wt = crossWeight(L, x);
  if (wt <= 0) return levelHeight(L, x);
  const fall = L.z === SPAWN_LEVEL_Z && Math.abs(x - SPINE_X) <= SPINE_HALF + CROSS_PAD + CROSS_FADE ? SPAWN_FALL : CROSS_FALL;
  const zz = z < L.z0 ? L.z0 : z > L.z1 ? L.z1 : z;
  return levelHeight(L, x) + wt * fall * (zz - L.z1);
}

// ---------------------------------------------------------------------------------------------
// Strips and stair streets.

/** The spine runs straight down x = 0; its stair strip is SPINE_HALF either side. */
export const SPINE_X = 0;
export const SPINE_HALF = 6;
export const SPINE_TOP_Z = 1246;
export const SPINE_BOTTOM_Z = 236;

/** Funicular corridor (TRACK), with the axis at FUNI_X. */
export const FUNI_X = -28;
export const FUNI_X0 = -45;
export const FUNI_X1 = -12;
export const FUNI_Z0 = 558;
export const FUNI_Z1 = 950;

/** Mercado stair streets (besides the spine and the funicular run-out at FUNI_X). */
export const MERCADO_STAIRS = [-84, -56, 28, 56, 84] as const;
export const STAIR_HALF = 4;

/** Wedding plaza (flat, at the level of the landing at 462). */
export const PLAZA_BODA = { x0: 12, x1: 68, z0: 454, z1: 486 } as const;

/** Hill station plaza on Antenna Hill (the lower cable car's top, the summit cable car's base). */
export const HILL_STATION = { x0: 12, x1: 48, z0: 1030, z1: 1050 } as const;

/** The summit antenna: mast foot and the needle platform's top above the summit ground. */
export const NEEDLE = { x: 0, z: 1262, height: 26, half: 2 } as const;
