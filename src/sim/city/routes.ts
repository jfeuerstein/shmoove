/**
 * Route geometry for all 16 lines (DESIGN section 5). Ground routes follow the switchback roads,
 * landings and terrace streets, joined by S-bends and arcs of known radius, then draped on the
 * terrain. Overhead routes sit a set height above whatever is under them.
 */
import { nearestArc } from '../lines';
import { PI, TAU, datan2, dcos, dsin, len2, len3 } from '../math';
import { Surface, addSolid, addZone, terrainHeight, topHeight, type World } from '../world';
import { needleTop } from './dress';
import type { RouteDef } from './index';
import { BOULEVARD_Z, INNER_R, LEVELS, NEEDLE } from './layout';
import { Turtle, type Road } from './roads';
import type { Ground } from './terrain';

/** Arc length of a quarter of an inner hairpin. */
const QUARTER = (PI / 2) * INNER_R;
/** Radius of the S-bends between a road and a cross street. */
const S_R = 20;
/** Spacing of the published route points. */
const SPACING = 3;

const LEVEL_Z: number[] = LEVELS.map((L) => L.z);
function levelIndex(z: number): number {
  const i = LEVEL_Z.indexOf(z);
  if (i < 0) throw new Error(`no level at z=${z}`);
  return i;
}

/** Collects a flat route as x, z pairs, piece by piece. */
class Builder {
  readonly xz: number[] = [];

  constructor(x: number, z: number) {
    this.xz.push(x, z);
  }

  get x(): number {
    return this.xz[this.xz.length - 2];
  }

  get z(): number {
    return this.xz[this.xz.length - 1];
  }

  /** Heading of the last step (direction (cos a, sin a)). */
  get a(): number {
    const n = this.xz.length;
    return datan2(this.xz[n - 1] - this.xz[n - 3], this.xz[n - 2] - this.xz[n - 4]);
  }

  push(x: number, z: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    if (dx * dx + dz * dz > 1e-6) this.xz.push(x, z);
  }

  turtle(): Turtle {
    return new Turtle(this.x, this.z, this.xz.length >= 4 ? this.a : 0);
  }

  take(t: Turtle): void {
    for (let i = 2; i < t.xz.length; i += 2) this.push(t.xz[i], t.xz[i + 1]);
  }

  straightTo(x: number, z: number): void {
    const len = len2(x - this.x, z - this.z);
    const n = Math.max(1, Math.ceil(len / 2));
    const x0 = this.x;
    const z0 = this.z;
    for (let i = 1; i <= n; i++) this.push(x0 + ((x - x0) * i) / n, z0 + ((z - z0) * i) / n);
  }

  /** Follow a road from arc position s0 to s1 (backwards if s1 < s0). */
  road(r: Road, s0: number, s1: number): void {
    const p = r.pts;
    const n = p.length / 3;
    let s = 0;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) s += len2(p[i * 3] - p[i * 3 - 3], p[i * 3 + 2] - p[i * 3 - 1]);
      pts.push([s, p[i * 3], p[i * 3 + 2]]);
    }
    const at = (q: number): [number, number] => {
      for (let i = 1; i < pts.length; i++) {
        if (pts[i][0] >= q) {
          const f = (q - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
          return [pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * f];
        }
      }
      const last = pts[pts.length - 1];
      return [last[1], last[2]];
    };
    const [sx, sz] = at(s0);
    this.push(sx, sz);
    if (s1 >= s0) {
      for (const q of pts) if (q[0] > s0 && q[0] < s1) this.push(q[1], q[2]);
    } else {
      for (let i = pts.length - 1; i >= 0; i--) if (pts[i][0] < s0 && pts[i][0] > s1) this.push(pts[i][1], pts[i][2]);
    }
    const [ex, ez] = at(s1);
    this.push(ex, ez);
  }

  /** Shift sideways by dz while heading along +-x, with two arcs of radius S_R. */
  sBend(dz: number): void {
    const t = this.turtle();
    const east = dcos(t.a) > 0;
    const c = 1 - Math.abs(dz) / (2 * S_R);
    const th = datan2(Math.sqrt(1 - c * c), c);
    const sgn = (dz > 0 ? 1 : -1) * (east ? 1 : -1);
    t.arc(S_R, sgn * th).arc(S_R, -sgn * th);
    this.take(t);
  }

  close(): void {
    this.push(this.xz[0], this.xz[1]);
  }
}

/** Horizontal length an S-bend uses. */
function sBendRun(dz: number): number {
  const c = 1 - Math.abs(dz) / (2 * S_R);
  return 2 * S_R * Math.sqrt(1 - c * c);
}

/** Resample a flat x, z polyline at about SPACING m and attach heights. */
function resample(xz: number[], y: (x: number, z: number) => number, closed: boolean): number[] {
  const n = xz.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + len2(xz[i * 2] - xz[i * 2 - 2], xz[i * 2 + 1] - xz[i * 2 - 1]);
  const total = cum[n - 1];
  const m = Math.max(2, Math.round(total / SPACING));
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j <= m; j++) {
    const s = (total * j) / m;
    while (k < n - 2 && cum[k + 1] < s) k++;
    const f = cum[k + 1] > cum[k] ? (s - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    const x = xz[k * 2] + (xz[k * 2 + 2] - xz[k * 2]) * f;
    const z = xz[k * 2 + 1] + (xz[k * 2 + 3] - xz[k * 2 + 1]) * f;
    out.push(x, y(x, z), z);
  }
  if (closed) {
    const L = out.length;
    out[L - 3] = out[0];
    out[L - 2] = out[1];
    out[L - 1] = out[2];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ground loops built from the road network.

const XR = 128; // x where a road meets the S-bend to a cross street (inner hairpin quarter points)

/**
 * Up one road from the boulevard to level `top`, across it, down the other road, back along the
 * boulevard. `upWest` picks which road climbs.
 */
function boulevardLoop(g: Ground, top: number, upWest: boolean, bx: number): number[] {
  const up = upWest ? g.west : g.east;
  const down = upWest ? g.east : g.west;
  const sgn = upWest ? -1 : 1; // side of the climbing road
  const b = new Builder(-sgn * bx, BOULEVARD_Z);
  b.straightTo(sgn * 152, BOULEVARD_Z);
  const i = levelIndex(top);
  b.road(up, 0, up.apexS[i] - QUARTER);
  b.sBend(INNER_R);
  b.straightTo(-sgn * (XR - sBendRun(INNER_R)), top);
  b.sBend(-INNER_R);
  b.road(down, down.apexS[i] - QUARTER, 0);
  b.close();
  return b.xz;
}

/** A loop between two levels: up the west road, across the top, down the east road, back. */
function levelLoop(g: Ground, lo: number, hi: number, startX: number): number[] {
  const il = levelIndex(lo);
  const ih = levelIndex(hi);
  const b = new Builder(startX, lo);
  b.straightTo(-(XR - sBendRun(INNER_R)), lo);
  b.sBend(INNER_R);
  b.road(g.west, g.west.apexS[il] + QUARTER, g.west.apexS[ih] - QUARTER);
  b.sBend(INNER_R);
  b.straightTo(XR - sBendRun(INNER_R), hi);
  b.sBend(-INNER_R);
  b.road(g.east, g.east.apexS[ih] - QUARTER, g.east.apexS[il] + QUARTER);
  b.sBend(-INNER_R);
  b.close();
  return b.xz;
}

/** Fish trucks: fish market -> boulevard -> up to the Mercado gate -> down -> quayside -> market. */
function fishLoop(g: Ground): number[] {
  const b = new Builder(-110, 32);
  b.straightTo(-42, 32);
  let t = b.turtle().arc(12, PI / 2);
  b.take(t);
  b.straightTo(-30, BOULEVARD_Z - 12);
  t = b.turtle().arc(12, PI / 2);
  b.take(t);
  b.straightTo(-152, BOULEVARD_Z);
  const i = 0;
  b.road(g.west, 0, g.west.apexS[i] - QUARTER);
  b.sBend(INNER_R);
  b.straightTo(XR - sBendRun(INNER_R), LEVELS[i].z);
  b.sBend(-INNER_R);
  b.road(g.east, g.east.apexS[i] - QUARTER, 0);
  b.straightTo(30, BOULEVARD_Z);
  t = b.turtle().arc(12, PI / 2);
  b.take(t);
  b.straightTo(18, 20);
  t = b.turtle().arc(12, -PI / 2);
  b.take(t);
  b.straightTo(-130, 8);
  t = b.turtle().arc(12, -PI);
  b.take(t);
  b.close();
  return b.xz;
}

/** Forklifts: a rounded rectangle round the west warehouses. */
function forkliftLoop(): number[] {
  const R = 8;
  const b = new Builder(-82, 92);
  const corner = (): void => {
    b.take(b.turtle().arc(R, PI / 2));
  };
  b.straightTo(-35 - R, 92);
  corner();
  b.straightTo(-35, 250 - R);
  corner();
  b.straightTo(-130 + R, 250);
  corner();
  b.straightTo(-130, 92 + R);
  corner();
  b.close();
  return b.xz;
}

/** The wedding parade: a stadium round the plaza. */
function paradeLoop(): number[] {
  const b = new Builder(40, 457);
  b.straightTo(50, 457);
  b.take(b.turtle().arc(12, PI));
  b.straightTo(30, 481);
  b.take(b.turtle().arc(12, PI));
  b.close();
  return b.xz;
}

/** The funicular: two tracks 4 m apart mid-hill, flaring to 12 m turn-rounds at both ends. */
export const FUNI_TRACK = { cx: -28, zBottom: 573, zTop: 936, r: 12, flare: 10, sR: 30 } as const;

function funicularLoop(): number[] {
  const F = FUNI_TRACK;
  const b = new Builder(F.cx, F.zBottom - F.r);
  // Bottom turn-round, heading east then up the east (up) track.
  b.take(b.turtle().arc(F.r, PI / 2));
  const shift = (dx: number): void => {
    const t = b.turtle();
    const north = dsin(t.a) > 0;
    const c = 1 - Math.abs(dx) / (2 * F.sR);
    const th = datan2(Math.sqrt(1 - c * c), c);
    // Heading north (+z), a shift toward -x is a left turn (positive da).
    const sgn = (dx < 0 ? 1 : -1) * (north ? 1 : -1);
    t.arc(F.sR, sgn * th).arc(F.sR, -sgn * th);
    b.take(t);
  };
  shift(-F.flare);
  const sRun = sBendRunR(F.flare, F.sR);
  b.straightTo(F.cx + F.r - F.flare, F.zTop - sRun);
  shift(F.flare);
  b.straightTo(F.cx + F.r, F.zTop);
  b.take(b.turtle().arc(F.r, PI));
  shift(F.flare);
  b.straightTo(F.cx - F.r + F.flare, F.zBottom + sRun);
  shift(-F.flare);
  b.straightTo(F.cx - F.r, F.zBottom);
  b.take(b.turtle().arc(F.r, PI / 2));
  b.close();
  return b.xz;
}

function sBendRunR(d: number, r: number): number {
  const c = 1 - Math.abs(d) / (2 * r);
  return 2 * r * Math.sqrt(1 - c * c);
}

// ---------------------------------------------------------------------------------------------
// Overhead routes.

/** A closed loop of two parallel cables `sep` apart between a and b, round ends. */
function cableLoop(ax: number, az: number, bx: number, bz: number, sep: number): number[] {
  const a = datan2(bz - az, bx - ax);
  const b = new Builder(ax + (sep / 2) * dsin(a), az - (sep / 2) * dcos(a));
  b.straightTo(bx + (sep / 2) * dsin(a), bz - (sep / 2) * dcos(a));
  b.take(new Turtle(b.x, b.z, a).arc(sep / 2, PI));
  b.straightTo(ax - (sep / 2) * dsin(a), az + (sep / 2) * dcos(a));
  b.take(new Turtle(b.x, b.z, a + PI).arc(sep / 2, PI));
  b.close();
  return b.xz;
}

function ellipse(cx: number, cz: number, rx: number, rz: number, phase = 0): number[] {
  const n = Math.ceil((TAU * Math.max(rx, rz)) / 2);
  const xz: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = phase + (TAU * i) / n;
    xz.push(cx + rx * dsin(f), cz + rz * dcos(f));
  }
  return xz;
}

/** Smooth a path's heights in place (a few passes of a 1-2-1 filter). */
function smoothHeights(path: number[], passes: number, closed: boolean): void {
  const n = path.length / 3;
  for (let p = 0; p < passes; p++) {
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + (n - 1)) % (n - 1) : Math.max(0, i - 1);
      const c = closed ? (i + 1) % (n - 1) : Math.min(n - 1, i + 1);
      ys[i] = (path[a * 3 + 1] + 2 * path[i * 3 + 1] + path[c * 3 + 1]) / 4;
    }
    for (let i = 0; i < n; i++) path[i * 3 + 1] = ys[i];
    if (closed) path[(n - 1) * 3 + 1] = path[1];
  }
}

// ---------------------------------------------------------------------------------------------

interface Spec {
  id: string;
  loop: boolean;
  overhead: boolean;
  path: number[];
  stops: [string, number, number][];
}

function stopsOf(path: number[], stops: [string, number, number][]): { name: string; s: number }[] {
  return stops.map(([name, x, z], i) => ({ name, s: i === 0 ? 0 : nearestArc(path, x, z) }));
}

/** Rotate a closed path so it starts at the point nearest (x, z). */
function startAt(path: number[], x: number, z: number): number[] {
  const n = path.length / 3 - 1; // last repeats first
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = len2(path[i * 3] - x, path[i * 3 + 2] - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const i = (best + k) % n;
    out.push(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
  }
  return out;
}

/** Structures that exist for the routes: the ghost tram's covered cut. Call before finalize. */
export const GHOST_CUT = { x0: 56, x1: 94, level: 566 } as const;

export function addRouteStructures(w: World): void {
  const L = LEVELS[levelIndex(GHOST_CUT.level)];
  const y = L.yEnd;
  addSolid(w, {
    cx: (GHOST_CUT.x0 + GHOST_CUT.x1) / 2,
    cz: L.z,
    hx: (GHOST_CUT.x1 - GHOST_CUT.x0) / 2,
    hz: L.z1 - L.z,
    rot: 0,
    yBase: y + 5.2,
    yTop: y + 5.8,
    surface: Surface.PLAZA,
    kind: 'platform',
    style: 2,
  });
  // The disused track bed inside the cut.
  for (let iz = 0; iz < w.nz; iz++) {
    const zc = w.minZ + (iz + 0.5) * w.cell;
    if (Math.abs(zc - L.z) > 4) continue;
    for (let ix = 0; ix < w.nx; ix++) {
      const xc = w.minX + (ix + 0.5) * w.cell;
      if (xc >= GHOST_CUT.x0 && xc <= GHOST_CUT.x1) w.surfaces[iz * w.nx + ix] = Surface.TRACK;
    }
  }
}

export function buildRoutes(w: World, g: Ground): Record<string, RouteDef> {
  const drape = (x: number, z: number): number => terrainHeight(w, x, z);
  const ground = (xz: number[]): number[] => resample(xz, drape, true);
  const specs: Spec[] = [];

  // Docks.
  const craneY = (x: number, z: number): number => topHeight(w, x, z) + 11;
  const crane = resample([-140, 9, 140, 9], craneY, false);
  specs.push({ id: 'D1', loop: false, overhead: true, path: crane, stops: [['Grúa Oeste', -140, 9], ['Grúa Centro', 0, 9], ['Grúa Este', 140, 9]] });
  specs.push({ id: 'D2', loop: true, overhead: false, path: ground(forkliftLoop()), stops: [['Almacenes Sur', -82, 92], ['Almacenes Este', -35, 170], ['Cocheras', -82, 250], ['Almacenes Oeste', -130, 170]] });
  specs.push({ id: 'D3', loop: true, overhead: false, path: ground(fishLoop(g)), stops: [['Lonja', -110, 32], ['Bulevar', -90, BOULEVARD_Z], ['Puerta del Mercado', 0, 306], ['Muelle', -60, 8]] });

  // Mercado.
  specs.push({ id: 'M1', loop: true, overhead: false, path: ground(boulevardLoop(g, 410, true, 60)), stops: [['Bulevar', 60, BOULEVARD_Z], ['Rampa Oeste', -152, 345], ['Rellano 410', 0, 410], ['Rampa Este', 152, 345]] });
  specs.push({ id: 'M2', loop: true, overhead: false, path: ground(levelLoop(g, 358, 410, 40)), stops: [['Rellano 358', 40, 358], ['Rampa Oeste', -152, 384], ['Rellano 410', 0, 410], ['Rampa Este', 152, 384]] });
  specs.push({ id: 'M3', loop: true, overhead: false, path: ground(paradeLoop()), stops: [['Iglesia', 40, 457], ['Fuente', 62, 469], ['Torre', 40, 481]] });

  // Terraces.
  specs.push({ id: 'T1', loop: true, overhead: false, path: ground(funicularLoop()), stops: [['Base', FUNI_TRACK.cx, FUNI_TRACK.zBottom - FUNI_TRACK.r], ['Cima', FUNI_TRACK.cx, FUNI_TRACK.zTop + FUNI_TRACK.r]] });
  const top = LEVELS[LEVELS.length - 1].z;
  specs.push({ id: 'T2', loop: true, overhead: false, path: ground(boulevardLoop(g, top, true, 0)), stops: [['Muelle', 0, BOULEVARD_Z], ['Mercado', -152, 436], ['Terrazas', -152, 754], ['Puerta de la Antena', 0, top], ['Escuela', 152, 754], ['Mercado Este', 152, 436]] });
  specs.push({ id: 'T3', loop: true, overhead: false, path: ground(levelLoop(g, 619, 835, 0)), stops: [['Terraza Baja', 0, 619], ['Zigzag Oeste', -152, 727], ['Terraza Alta', 0, 835], ['Zigzag Este', 152, 727]] });
  specs.push({ id: 'T4', loop: true, overhead: false, path: ground(boulevardLoop(g, 727, false, 0)), stops: [['Garaje', 0, BOULEVARD_Z], ['Rampa Este', 152, 488], ['Terraza 727', 0, 727], ['Rampa Oeste', -152, 488]] });

  // Antenna Hill.
  const a1 = cableLoop(60, 978, 34, 1036, 8);
  const cable = (h: number) => (x: number, z: number): number => topHeight(w, x, z) + h;
  const A1 = resample(a1, cable(11), true);
  smoothHeights(A1, 3, true);
  specs.push({ id: 'A1', loop: true, overhead: true, path: A1, stops: [['Puerta', 60, 978], ['Estación del Cerro', 34, 1036]] });
  const A2 = resample(cableLoop(40, 1046, 40, 1226, 8), cable(11), true);
  smoothHeights(A2, 3, true);
  specs.push({ id: 'A2', loop: true, overhead: true, path: A2, stops: [['Estación del Cerro', 40, 1046], ['Cresta', 40, 1226]] });
  const kites = ellipse(-20, 1100, 75, 75);
  const A3 = resample(kites, (x, z) => topHeight(w, x, z) + 17 + 3 * dsin(datan2(z - 1100, x + 20) * 4), true);
  smoothHeights(A3, 2, true);
  specs.push({ id: 'A3', loop: true, overhead: true, path: A3, stops: [['Campo Sur', -20, 1025], ['Campo Norte', -20, 1175]] });

  // Secrets.
  specs.push({ id: 'S1', loop: true, overhead: false, path: ground(levelLoop(g, 566, 619, 75)), stops: [['Túnel', 75, 566], ['Terraza Baja', 0, 619]] });
  const blimp = resample(ellipse(0, 1110, 130, 125), (x, z) => topHeight(w, x, z) + 38, true);
  smoothHeights(blimp, 4, true);
  specs.push({ id: 'S2', loop: true, overhead: true, path: blimp, stops: [['Cumbre', 0, 1235], ['Cerro Sur', 0, 985]] });
  const nt = needleTop();
  const king = resample(ellipse(0, NEEDLE.z - 32, 32, 32), () => nt + 6, true);
  specs.push({ id: 'S3', loop: true, overhead: true, path: king, stops: [['La Aguja', NEEDLE.x, NEEDLE.z], ['Cresta Sur', 0, NEEDLE.z - 64]] });

  const out: Record<string, RouteDef> = {};
  for (const s of specs) {
    const path = s.loop ? startAt(s.path, s.stops[0][1], s.stops[0][2]) : s.path;
    out[s.id] = { id: s.id, loop: s.loop, overhead: s.overhead, path, stops: stopsOf(path, s.stops) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pylons, stops and chain spots.

/** Pylons between the two cables of each cable car, never under either cable. */
export function addPylons(w: World): void {
  const lines: [number, number, number, number][] = [
    [60, 978, 34, 1036],
    [40, 1046, 40, 1226],
  ];
  for (const [ax, az, bx, bz] of lines) {
    const len = len2(bx - ax, bz - az);
    const n = Math.max(1, Math.floor(len / 40));
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      const x = ax + (bx - ax) * f;
      const z = az + (bz - az) * f;
      const g = terrainHeight(w, x, z);
      addSolid(w, { cx: x, cz: z, hx: 0.4, hz: 0.4, rot: 0, yBase: g - 1, yTop: g + 6.5, surface: Surface.ROOF, kind: 'pylon', style: 0 });
    }
  }
}

export function addStopZones(w: World, routes: Record<string, RouteDef>): void {
  for (const id of Object.keys(routes)) {
    const r = routes[id];
    r.stops.forEach((st, n) => {
      const p = pointAt(r.path, st.s);
      addZone(w, { id: `stop_${id}_${n}`, name: st.name, kind: 'stop', x: p[0], y: topHeight(w, p[0], p[2]), z: p[2], r: 6 });
    });
  }
}

function pointAt(path: number[], s: number): [number, number, number] {
  let acc = 0;
  for (let i = 1; i < path.length / 3; i++) {
    const d = len3(path[i * 3] - path[i * 3 - 3], path[i * 3 + 1] - path[i * 3 - 2], path[i * 3 + 2] - path[i * 3 - 1]);
    if (acc + d >= s) {
      const f = d > 0 ? (s - acc) / d : 0;
      return [
        path[i * 3 - 3] + (path[i * 3] - path[i * 3 - 3]) * f,
        path[i * 3 - 2] + (path[i * 3 + 1] - path[i * 3 - 2]) * f,
        path[i * 3 - 1] + (path[i * 3 + 2] - path[i * 3 - 1]) * f,
      ];
    }
    acc += d;
  }
  return [path[0], path[1], path[2]];
}

/** Pairs of lines that pass close enough to chain, with a hint of where. */
export const CHAIN_PAIRS: readonly [string, string, number, number][] = [
  ['D3', 'M1', -160, 280],
  ['M1', 'M2', -152, 384],
  ['T3', 'T4', -152, 700],
  ['T2', 'T4', -152, 500],
  ['T1', 'T2', -28, 943],
  ['T1', 'S1', -28, 566],
  ['T1', 'T3', -28, 835],
  ['D2', 'T2', -82, 254],
  ['D2', 'D3', -32, 170],
  ['A2', 'A3', 40, 1055],
];

/** Plan distance at which two lines count as passing each other. */
export const CHAIN_DIST = 12;

export function addChainZones(w: World, routes: Record<string, RouteDef>): void {
  for (const [a, b, hx, hz] of CHAIN_PAIRS) {
    const A = routes[a].path;
    const B = routes[b].path;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let i = 0; i < A.length; i += 3) {
      if (len2(A[i] - hx, A[i + 2] - hz) > 60) continue;
      for (let j = 0; j < B.length; j += 3) {
        const d = len2(A[i] - B[j], A[i + 2] - B[j + 2]);
        const dy = Math.abs(A[i + 1] - B[j + 1]);
        if (dy > (routes[a].overhead ? 8 : 3)) continue;
        // Prefer the spot nearest the hint among close passes.
        const score = d < CHAIN_DIST ? len2((A[i] + B[j]) / 2 - hx, (A[i + 2] + B[j + 2]) / 2 - hz) : 1e6 + d;
        if (score < best) {
          best = score;
          bx = (A[i] + B[j]) / 2;
          bz = (A[i + 2] + B[j + 2]) / 2;
        }
      }
    }
    if (best >= 1e6) continue;
    addZone(w, { id: `chain_${a}_${b}`, name: `${a} × ${b}`, kind: 'chain', x: bx, y: topHeight(w, bx, bz), z: bz, r: 8 });
  }
}
