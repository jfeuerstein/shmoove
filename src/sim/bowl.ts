/**
 * The Bowl: the map, generated from a seed.
 *
 * A heightfield about 340 m across built to make speed. The floor is a shallow dish of rolling
 * hills; around it a banked rim turns a fast mover back inward; a crater sits near the middle; two
 * half-pipe valleys fall toward the middle from near the rim; kickers sit where lines arrive and
 * boost pads lie on the gentle runs.
 *
 * The shape is composed analytically, sampled once onto a 1 m grid, and served by bicubic
 * (Catmull-Rom) interpolation, so height and slope are continuous everywhere: the mover reads the
 * normal every tick and would feel a crease as a bump.
 *
 * Deterministic: only `Rng` and `src/sim/math.ts`. Same seed, bit-identical heights.
 */
import { dcos, dsin, datan2, PI, smoothstep, TAU } from './math';
import { Rng } from './rng';
import { railOver, type BoostPad, type Rail, type Terrain } from './terrain';
import type { Vec3 } from './types';

export const BOWL_RADIUS = 170;

export interface BowlFeatures {
  /** Centre and radius of the crater (the edge of the bowl, where the raised lip peaks). */
  crater: { x: number; z: number; radius: number };
  /** Straight troughs; x0,z0 is the high end, x1,z1 the low end. */
  pipes: { x0: number; z0: number; x1: number; z1: number; halfWidth: number }[];
  /** The middle of each kicker's flat top; yaw = the direction to ride it. */
  kickers: { x: number; z: number; yaw: number }[];
  /** Where the things on the map go (see `chooseSites`). Chosen after the ground is final. */
  sites: Site[];
  /**
   * The rails, in the same order as `Bowl.rails` (see `chooseRails`). Chosen after the sites, from
   * their own stream.
   */
  rails: RailSite[];
}

/**
 * What a rail is there for: one of a chain laid end to end, one down the fall line of a hillside,
 * one down a half-pipe's floor, or one where it fitted.
 */
export type RailKind = 'chain' | 'hill' | 'pipe' | 'open';

/**
 * A rail on the map, seen from above. x0,z0 is the high end, the one it is ridden from (either end
 * of a level one). The rails of one chain share a `chain` (1, 2, ...) and are listed in the order
 * they are ridden; every other rail has chain 0. The bar stands `RAIL_LIFT` m above the ground at
 * both ends.
 */
export interface RailSite {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind: RailKind;
  chain: number;
}

/** What stands at a site. */
export type SiteKind = 'crate' | 'gold' | 'shrine' | 'gate' | 'hoop' | 'totem';

/**
 * A place for one thing on the map. `yaw` is the way a gate faces (along its slalom's line) or a
 * hoop's kicker rides; 0 for the rest. The gates of one slalom share a `group` (1, 2, ...) and are
 * listed in the order they are ridden; everything else has group 0. A hoop's height is not here: it
 * hangs `HOOP_RISE` m above the top of the kicker `HOOP_AHEAD` m behind it.
 */
export interface Site {
  kind: SiteKind;
  x: number;
  z: number;
  yaw: number;
  group: number;
}

export interface Bowl extends Terrain {
  readonly seed: number;
  readonly features: BowlFeatures;
}

// ---------------------------------------------------------------------------------------------
// Shape constants (map design, not feel: the mover's feel lives in FEEL).

/** Where the floor ends and the banked rim begins. */
const FLOOR_R = 130;
/** The floor is a dish this many metres higher at its edge than at the centre. */
const DISH = 16;
/** Slope of the rim at the bowl's radius: 60 degrees. */
const RIM_TOP_SLOPE = 1.7320508075688772;
const DISH_EDGE_SLOPE = (2 * DISH) / FLOOR_R;
/** Quadratic term of the rim so its slope grows from the dish's edge slope to RIM_TOP_SLOPE. */
const RIM_CURVE = (RIM_TOP_SLOPE - DISH_EDGE_SLOPE) / (2 * (BOWL_RADIUS - FLOOR_R));

/** Hills fade out between these radii so the rim is a clean bank. */
const HILL_FADE_IN = 98;
const HILL_FADE_OUT = 128;
const HILL_WAVES = 4;
const HILL_LEN_MIN = 50;
const HILL_LEN_MAX = 90;
/** Upper bound on the hills' slope (sum of amplitude x wavenumber). */
const HILL_SLOPE = 0.5;
const HILL_AMP_SUM = 6.5;
/** How far beyond a feature the hills take to come back. */
const HILL_RETURN = 24;

const CRATER_DEPTH = 6.8;
const CRATER_LIP = 3;
const CRATER_LIP_HALF = 9;
const CRATER_OFFSET = 5;

const PIPE_HALF = 16;
const PIPE_DEPTH_HIGH = 6.5;
const PIPE_DEPTH_LOW = 7.5;
/** The valley the pipe lies in sinks this far below the dish from the high end to the low end. */
const PIPE_SINK = 3.5;
/** Share of the half-width over which the wall's slope builds up (and dies away at the top). */
const PIPE_EASE = 0.25;
/** Length of the drop-in behind the high end and of the climb-out past the low end. */
const PIPE_HEAD = 16;
const PIPE_TAIL = 28;
/** Width of the bank beside each wall over which the pipe's correction of the dish fades out. */
const PIPE_BAND = 16;
/** The pipe's high end (with its drop-in) stays inside this radius, clear of the rim. */
const PIPE_HEAD_R = 127;

const KICK_CORE = 2.5;
const KICK_SIDE = 8;

const PAD_RADIUS = 2.5;
const PAD_MAX_SLOPE = 0.13;

/**
 * The spawn is a level-ish start ramp along a grid axis, so the 1 m grid reproduces it exactly:
 * SPAWN_TILT out to SPAWN_KINK metres ahead (the last grid sample whose slope still counts for the
 * 6 m around the spawn), then the fall steepens at SPAWN_BEND per metre to SPAWN_STEEP.
 */
const SPAWN_TILT = 0.0495;
const SPAWN_KINK = 7;
const SPAWN_BEND = 0.1;
const SPAWN_STEEP = 0.3;
/** The ramp is exact within this distance either side of its line, then blends into the ground. */
const SPAWN_SIDE = 8;
const SPAWN_SIDE_BLEND = 8;
const SPAWN_BACK = 8;
const SPAWN_AHEAD = 10;
const SPAWN_BLEND = 10;

/** Grid: 1 m spacing, wide enough that every point within radius + 5 m has a full stencil. */
const GRID_ORIGIN = -178;
const GRID_N = 357;
/** Floor slope the generator accepts before it lays the features out again. */
const ACCEPT_SLOPE = 0.84;
const ATTEMPTS = 24;

// ---------------------------------------------------------------------------------------------
// The analytic shape.

interface Wave {
  a: number;
  kx: number;
  kz: number;
  ph: number;
}

interface Pipe {
  x0: number;
  z0: number;
  /** Unit direction from the high end to the low end. */
  dx: number;
  dz: number;
  len: number;
  /** The dish's curvature along any straight line: DISH / FLOOR_R^2. */
  bend: number;
}

interface Kick {
  /** Start of the ramp. */
  x: number;
  z: number;
  fx: number;
  fz: number;
  run: number;
  top: number;
  back: number;
  h: number;
}

interface Shape {
  waves: Wave[];
  cx: number;
  cz: number;
  cr: number;
  pipes: Pipe[];
  kicks: Kick[];
  spawnOn: boolean;
  /** Spawn point (on the grid) and its axis-aligned forward direction. */
  sx: number;
  sz: number;
  sfx: number;
  sfz: number;
  sh: number;
}

/** Rises from 0 to 1 over [0, 1] with zero slope at both ends and a late, sharp lip. */
function kickRise(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (4 - 3 * t);
}

/** 1 inside `inner`, smoothly 0 by `inner + band`. */
function falloff(d: number, inner: number, band: number): number {
  return 1 - smoothstep((d - inner) / band);
}

/** The radial profile: dish on the floor, the banked rim beyond. */
function radialHeight(r: number): number {
  if (r <= FLOOR_R) {
    const u = r / FLOOR_R;
    return DISH * u * u;
  }
  const e = r - FLOOR_R;
  return DISH + DISH_EDGE_SLOPE * e + RIM_CURVE * e * e;
}

function hills(sh: Shape, x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < sh.waves.length; i++) {
    const w = sh.waves[i];
    h += w.a * dsin(w.kx * x + w.kz * z + w.ph);
  }
  return h;
}

/** Signed along/across coordinates of (x, z) in a pipe's frame. */
function pipeAlong(p: Pipe, x: number, z: number): number {
  return (x - p.x0) * p.dx + (z - p.z0) * p.dz;
}
function pipeAcross(p: Pipe, x: number, z: number): number {
  return (x - p.x0) * p.dz - (z - p.z0) * p.dx;
}

/** Distance from (x, z) to a pipe's axis, drop-in and climb-out included. */
function pipeAxisDist(p: Pipe, x: number, z: number): number {
  let s = pipeAlong(p, x, z);
  if (s < -PIPE_HEAD) s = -PIPE_HEAD;
  else if (s > p.len + PIPE_TAIL) s = p.len + PIPE_TAIL;
  const px = p.x0 + p.dx * s;
  const pz = p.z0 + p.dz * s;
  return Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
}

/**
 * The trough, as a height to add to the dish. Along a straight line the dish is a parabola, so the
 * pipe first adds back the gap between that parabola and its chord (fading out over PIPE_BAND
 * beside the walls), which makes the floor fall evenly from the high end to the low end. The trough
 * is cut into that, deepening from PIPE_DEPTH_HIGH to PIPE_DEPTH_LOW, with a drop-in behind the
 * high end and a climb-out past the low end.
 */
function pipeCut(p: Pipe, x: number, z: number): number {
  const s = pipeAlong(p, x, z);
  if (s <= -PIPE_HEAD || s >= p.len + PIPE_TAIL) return 0;
  const w = Math.abs(pipeAcross(p, x, z));
  if (w >= PIPE_HALF + PIPE_BAND) return 0;
  let h = (p.bend * pipeBend(p, s) - PIPE_SINK * pipeSink(p, s)) * falloff(w, PIPE_HALF, PIPE_BAND);
  const u = w / PIPE_HALF;
  if (u < 1) {
    const env = s < 0 ? smoothstep((s + PIPE_HEAD) / PIPE_HEAD) : 1 - smoothstep((s - p.len) / PIPE_TAIL);
    const depth = PIPE_DEPTH_HIGH + ((PIPE_DEPTH_LOW - PIPE_DEPTH_HIGH) * s) / p.len;
    h -= depth * env * troughProfile(u);
  }
  return h;
}

/**
 * The parabola-to-chord gap divided by the dish's curvature: s(L - s) between the ends, continued
 * past each end by a cubic that returns to zero with zero slope, so the correction has no crease.
 */
function pipeBend(p: Pipe, s: number): number {
  const L = p.len;
  if (s < 0) {
    const k = 1 + s / PIPE_HEAD;
    return L * s * k * k;
  }
  if (s > L) {
    const e = s - L;
    const k = 1 - e / PIPE_TAIL;
    return -L * e * k * k;
  }
  return s * (L - s);
}

/**
 * How far the valley the pipe lies in has sunk, as a share of PIPE_SINK: s / L between the ends,
 * back to zero with zero slope at the end of the drop-in and of the climb-out.
 */
function pipeSink(p: Pipe, s: number): number {
  const L = p.len;
  if (s < 0) {
    const k = 1 + s / PIPE_HEAD;
    return (s / L) * k * k;
  }
  if (s > L) {
    const t = (s - L) / PIPE_TAIL;
    const t2 = t * t;
    return 2 * t2 * t - 3 * t2 + 1 + (t2 * t - 2 * t2 + t) * (PIPE_TAIL / L);
  }
  return s / L;
}

/**
 * 1 on the axis, 0 at the wall top, zero slope at both. The wall's slope ramps up over the first
 * PIPE_EASE of the half-width, holds, and ramps down over the last: the steepest wall for a given
 * depth is as gentle as a smooth wall can be.
 */
function troughProfile(u: number): number {
  const a = PIPE_EASE;
  const m = 1 / (1 - a);
  if (u <= a) return 1 - (m * u * u) / (2 * a);
  if (u < 1 - a) return 1 - m * (a / 2 + (u - a));
  const e = 1 - u;
  return (m * e * e) / (2 * a);
}

function craterHeight(sh: Shape, x: number, z: number): number {
  const dx = x - sh.cx;
  const dz = z - sh.cz;
  const r = Math.sqrt(dx * dx + dz * dz);
  let h = 0;
  const u = r / sh.cr;
  if (u < 1) {
    const c = 1 - u * u;
    h -= CRATER_DEPTH * c * c;
  }
  const v = (r - sh.cr) / CRATER_LIP_HALF;
  if (v > -1 && v < 1) {
    const c = 1 - v * v;
    h += CRATER_LIP * c * c;
  }
  return h;
}

function kickHeight(k: Kick, x: number, z: number): number {
  const q = (x - k.x) * k.fx + (z - k.z) * k.fz;
  if (q <= 0 || q >= k.run + k.top + k.back) return 0;
  const w = Math.abs((x - k.x) * k.fz - (z - k.z) * k.fx);
  if (w >= KICK_CORE + KICK_SIDE) return 0;
  let a: number;
  if (q < k.run) a = kickRise(q / k.run);
  else if (q < k.run + k.top) a = 1;
  else a = 1 - smoothstep((q - k.run - k.top) / k.back);
  return k.h * a * falloff(w, KICK_CORE, KICK_SIDE);
}

/** How much of the hills survive at (x, z): none on the rim and in or near the big features. */
function hillMask(sh: Shape, x: number, z: number, r: number): number {
  let m = falloff(r, HILL_FADE_IN, HILL_FADE_OUT - HILL_FADE_IN);
  if (m === 0) return 0;
  const dx = x - sh.cx;
  const dz = z - sh.cz;
  const rc = Math.sqrt(dx * dx + dz * dz);
  m *= 1 - falloff(rc, sh.cr + CRATER_LIP_HALF, HILL_RETURN);
  for (let i = 0; i < sh.pipes.length && m > 0; i++) {
    m *= 1 - falloff(pipeAxisDist(sh.pipes[i], x, z), PIPE_HALF + PIPE_BAND, HILL_RETURN);
  }
  return m;
}

/** The ground before the spawn is levelled. */
function naturalHeight(sh: Shape, x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  let h = radialHeight(r);
  if (r >= HILL_FADE_OUT + 6) return h;
  const m = hillMask(sh, x, z, r);
  if (m > 0) h += m * hills(sh, x, z);
  h += craterHeight(sh, x, z);
  for (let i = 0; i < sh.pipes.length; i++) h += pipeCut(sh.pipes[i], x, z);
  for (let i = 0; i < sh.kicks.length; i++) h += kickHeight(sh.kicks[i], x, z);
  return h;
}

/** How far the start ramp has fallen `q` metres ahead of the spawn. */
function spawnDrop(q: number): number {
  if (q <= SPAWN_KINK) return SPAWN_TILT * q;
  const e = q - SPAWN_KINK;
  const eSteep = (SPAWN_STEEP - SPAWN_TILT) / (2 * SPAWN_BEND);
  if (e <= eSteep) return SPAWN_TILT * q + SPAWN_BEND * e * e;
  return SPAWN_TILT * q + SPAWN_BEND * eSteep * eSteep + (SPAWN_STEEP - SPAWN_TILT) * (e - eSteep);
}

function shapeHeight(sh: Shape, x: number, z: number): number {
  const h = naturalHeight(sh, x, z);
  if (!sh.spawnOn) return h;
  const dx = x - sh.sx;
  const dz = z - sh.sz;
  const q = dx * sh.sfx + dz * sh.sfz;
  const w = Math.abs(dx * sh.sfz - dz * sh.sfx);
  if (w >= SPAWN_SIDE + SPAWN_SIDE_BLEND) return h;
  if (q <= -SPAWN_BACK - SPAWN_BLEND || q >= SPAWN_AHEAD + SPAWN_BLEND) return h;
  const along = q < 0 ? falloff(-q, SPAWN_BACK, SPAWN_BLEND) : falloff(q, SPAWN_AHEAD, SPAWN_BLEND);
  const m = along * falloff(w, SPAWN_SIDE, SPAWN_SIDE_BLEND);
  const ramp = sh.sh - spawnDrop(q);
  return m === 1 ? ramp : h + m * (ramp - h);
}

/** Slope magnitude of the analytic shape by central differences. */
function shapeSlope(sh: Shape, x: number, z: number): number {
  const e = 0.25;
  const gx = (shapeHeight(sh, x + e, z) - shapeHeight(sh, x - e, z)) / (2 * e);
  const gz = (shapeHeight(sh, x, z + e) - shapeHeight(sh, x, z - e)) / (2 * e);
  return Math.sqrt(gx * gx + gz * gz);
}

// ---------------------------------------------------------------------------------------------
// Layout.

function makeWaves(rng: Rng, scale: number): Wave[] {
  const raw: { a: number; k: number; dir: number; ph: number }[] = [];
  let slope = 0;
  let amp = 0;
  for (let i = 0; i < HILL_WAVES; i++) {
    const len = rng.range(HILL_LEN_MIN, HILL_LEN_MAX);
    const a = rng.range(0.6, 1);
    const k = TAU / len;
    raw.push({ a, k, dir: rng.range(0, TAU), ph: rng.range(0, TAU) });
    slope += a * k;
    amp += a;
  }
  const s = Math.min(HILL_SLOPE / slope, HILL_AMP_SUM / amp) * scale;
  return raw.map((w) => ({ a: w.a * s, kx: w.k * dsin(w.dir), kz: w.k * dcos(w.dir), ph: w.ph }));
}

/** Shortest distance between points of two pipes' axes (drop-in and climb-out included). */
function pipesApart(a: Pipe, b: Pipe): number {
  let best = Infinity;
  for (let s = -PIPE_HEAD; s <= b.len + PIPE_TAIL; s += 2) {
    const d = pipeAxisDist(a, b.x0 + b.dx * s, b.z0 + b.dz * s);
    if (d < best) best = d;
  }
  return best;
}

function layPipe(rng: Rng, normalAngle: number, cx: number, cz: number, cr: number): Pipe | null {
  const d = rng.range(74, 80);
  const nx = dsin(normalAngle);
  const nz = dcos(normalAngle);
  const hand = rng.chance(0.5) ? 1 : -1;
  const dx = -nz * hand;
  const dz = nx * hand;
  // From the high end the axis runs `a0` metres to its closest approach to the centre, then on.
  const a0 = Math.sqrt(PIPE_HEAD_R * PIPE_HEAD_R - d * d) - PIPE_HEAD;
  const len = rng.range(122, 130);
  const x0 = nx * d - dx * a0;
  const z0 = nz * d - dz * a0;
  const p: Pipe = {
    x0,
    z0,
    dx,
    dz,
    len,
    bend: DISH / (FLOOR_R * FLOOR_R),
  };
  if (pipeAxisDist(p, cx, cz) < cr + CRATER_LIP_HALF + PIPE_HALF + PIPE_BAND * 0.75) return null;
  return p;
}

function makeKick(rng: Rng, x: number, z: number, fx: number, fz: number): Kick {
  return {
    x,
    z,
    fx,
    fz,
    run: rng.range(9, 12),
    top: rng.range(2, 3.5),
    back: rng.range(11, 15),
    h: rng.range(2.2, 3.2),
  };
}

function kickCrest(k: Kick): { x: number; z: number } {
  const q = k.run + k.top / 2;
  return { x: k.x + k.fx * q, z: k.z + k.fz * q };
}

/**
 * True if the kicker's footprint stays clear of the given pipes and their banks, the crater, the
 * rim, the spawn ramp and the other kickers.
 */
function kickFits(sh: Shape, pipes: readonly Pipe[], k: Kick, minApart: number): boolean {
  const reach = k.run + k.top + k.back;
  const c = kickCrest(k);
  for (const o of sh.kicks) {
    const oc = kickCrest(o);
    if (dist(c.x, c.z, oc.x, oc.z) < minApart) return false;
  }
  for (let i = 0; i <= 2; i++) {
    const px = k.x + k.fx * reach * i * 0.5;
    const pz = k.z + k.fz * reach * i * 0.5;
    if (Math.sqrt(px * px + pz * pz) > 125) return false;
    if (dist(px, pz, sh.cx, sh.cz) < sh.cr + CRATER_LIP_HALF) return false;
    if (dist(px, pz, sh.sx, sh.sz) < 30) return false;
    for (const p of pipes) if (pipeAxisDist(p, px, pz) < PIPE_HALF + PIPE_BAND + 4) return false;
  }
  return true;
}

/** Largest slope of the shape over a disc, sampled. */
function discSlope(sh: Shape, x: number, z: number, radius: number): number {
  let worst = shapeSlope(sh, x, z);
  for (let ring = 1; ring <= 2; ring++) {
    const rr = (radius * ring) / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      const s = shapeSlope(sh, x + rr * dsin(a), z + rr * dcos(a));
      if (s > worst) worst = s;
    }
  }
  return worst;
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
}

interface Layout {
  shape: Shape;
  pads: BoostPad[];
  features: BowlFeatures;
  spawnX: number;
  spawnZ: number;
  spawnYaw: number;
}

function layout(seed: number, attempt: number): Layout | null {
  const root = new Rng(seed);
  const hillScale = attempt < ATTEMPTS / 2 ? 1 : 1 - (attempt - ATTEMPTS / 2) / (ATTEMPTS / 2);
  const rng = root.fork(`layout-${attempt}`);
  const sh: Shape = {
    waves: makeWaves(root.fork(`hills-${attempt >> 2}`), hillScale),
    cx: 0,
    cz: 0,
    cr: rng.range(33, 37),
    pipes: [],
    kicks: [],
    spawnOn: false,
    sx: 0,
    sz: 0,
    sfx: 0,
    sfz: 0,
    sh: 0,
  };
  const ca = rng.range(0, TAU);
  const co = rng.range(0, CRATER_OFFSET);
  sh.cx = co * dsin(ca);
  sh.cz = co * dcos(ca);

  // Two pipes on roughly opposite sides of the middle.
  const n1 = rng.range(0, TAU);
  const p1 = layPipe(rng, n1, sh.cx, sh.cz, sh.cr);
  const p2 = layPipe(rng, n1 + PI + rng.range(-0.5, 0.5), sh.cx, sh.cz, sh.cr);
  if (!p1 || !p2) return null;
  if (pipesApart(p1, p2) < 2 * PIPE_HALF + 24) return null;
  sh.pipes.push(p1, p2);

  // Spawn: a whole-metre grid point 60 to 100 m out, clear of the features, its start ramp running
  // along a grid axis toward the middle (on the axis itself, or a few metres beside it), where the
  // ground ahead already falls so a tucked mover gets going.
  let best = -Infinity;
  let bx = 0;
  let bz = 0;
  let bfx = 0;
  let bfz = 0;
  const axis0 = rng.int(4);
  for (let ai = 0; ai < 4; ai++) {
    const axis = (axis0 + ai) % 4;
    const ox = axis === 0 ? 1 : axis === 2 ? -1 : 0;
    const oz = axis === 1 ? 1 : axis === 3 ? -1 : 0;
    for (let r = 60; r <= 100; r += 4) {
      for (let side = -2; side <= 2; side++) {
        const off = side * 8;
        if (Math.abs(off) > r * 0.25) continue;
        const x = ox * r + oz * off;
        const z = oz * r + ox * off;
        const rr = Math.sqrt(x * x + z * z);
        if (rr < 60 || rr > 100) continue;
        if (dist(x, z, sh.cx, sh.cz) < sh.cr + CRATER_LIP_HALF + 20) continue;
        let clear = true;
        for (const p of sh.pipes) if (pipeAxisDist(p, x, z) < PIPE_HALF + PIPE_BAND + 6) clear = false;
        if (!clear) continue;
        const fx = -ox;
        const fz = -oz;
        const here = naturalHeight(sh, x, z);
        const ahead = here - naturalHeight(sh, x + fx * 20, z + fz * 20);
        const behind = naturalHeight(sh, x - fx * 12, z - fz * 12) - here;
        const flat = discSlope(sh, x, z, 14);
        const score =
          -Math.abs(ahead - 4.5) - 0.3 * Math.abs(behind - 1.2) - 8 * flat - 0.05 * Math.abs(off);
        if (score > best) {
          best = score;
          bx = x;
          bz = z;
          bfx = fx;
          bfz = fz;
        }
      }
    }
  }
  if (best === -Infinity) return null;
  sh.sx = bx;
  sh.sz = bz;
  sh.sfx = bfx;
  sh.sfz = bfz;
  sh.sh = naturalHeight(sh, bx, bz);

  // Kickers: one past the low end of each pipe, two or three just outside the crater lip, and the
  // rest on hill shoulders, ridden downhill.
  const nKick = 6 + rng.int(4);
  for (const p of sh.pipes) {
    const s = p.len + PIPE_TAIL - 3;
    const k = makeKick(rng, p.x0 + p.dx * s, p.z0 + p.dz * s, p.dx, p.dz);
    if (!kickFits(sh, sh.pipes.filter((o) => o !== p), k, 30)) return null;
    sh.kicks.push(k);
  }
  const nLip = 2 + rng.int(2);
  const lipA = rng.range(0, TAU);
  for (let i = 0; i < 12 && sh.kicks.length < 2 + nLip; i++) {
    const a = lipA + (i * TAU) / 12 + rng.range(-0.15, 0.15);
    const fx = dsin(a);
    const fz = dcos(a);
    const r0 = sh.cr + CRATER_LIP_HALF + 1;
    const k = makeKick(rng, sh.cx + fx * r0, sh.cz + fz * r0, fx, fz);
    if (!kickFits(sh, sh.pipes, k, 34)) continue;
    sh.kicks.push(k);
  }
  if (sh.kicks.length < 4) return null;
  const tries = 400;
  for (let i = 0; i < tries && sh.kicks.length < nKick; i++) {
    const r = rng.range(40, 108);
    const a = rng.range(0, TAU);
    const x = r * dsin(a);
    const z = r * dcos(a);
    const e = 0.5;
    const gx = (naturalHeight(sh, x + e, z) - naturalHeight(sh, x - e, z)) / (2 * e);
    const gz = (naturalHeight(sh, x, z + e) - naturalHeight(sh, x, z - e)) / (2 * e);
    const g = Math.sqrt(gx * gx + gz * gz);
    if (g < 0.06 || g > 0.28) continue;
    const k = makeKick(rng, x, z, -gx / g, -gz / g);
    if (!kickFits(sh, sh.pipes, k, 34)) continue;
    // A shoulder, not a saddle or a ridge: the ground across the kicker's line is nearly straight.
    const c = kickCrest(k);
    const across =
      (naturalHeight(sh, c.x + k.fz * 12, c.z - k.fx * 12) + naturalHeight(sh, c.x - k.fz * 12, c.z + k.fx * 12)) / 2 -
      naturalHeight(sh, c.x, c.z);
    if (Math.abs(across) > 0.5) continue;
    const reach = k.run + k.top + k.back;
    if (discSlope(sh, k.x + k.fx * reach * 0.5, k.z + k.fz * reach * 0.5, reach * 0.5) > 0.32) continue;
    sh.kicks.push(k);
  }
  if (sh.kicks.length < 6) return null;
  sh.spawnOn = true;

  // Boost pads: one on each pipe floor, some on kicker run-ups, the rest on gentle open floor.
  const pads: BoostPad[] = [];
  const nPad = 6 + rng.int(4);
  const padOk = (x: number, z: number): boolean => {
    if (Math.sqrt(x * x + z * z) > 122) return false;
    if (dist(x, z, sh.sx, sh.sz) < 14) return false;
    for (const o of pads) if (dist(x, z, o.x, o.z) < 22) return false;
    return discSlope(sh, x, z, PAD_RADIUS) < PAD_MAX_SLOPE;
  };
  for (const p of sh.pipes) {
    const s = p.len * rng.range(0.3, 0.45);
    const x = p.x0 + p.dx * s;
    const z = p.z0 + p.dz * s;
    if (padOk(x, z)) pads.push({ x, z, radius: PAD_RADIUS });
  }
  for (const k of sh.kicks) {
    if (pads.length >= nPad - 1) break;
    const back = rng.range(9, 14);
    const x = k.x - k.fx * back;
    const z = k.z - k.fz * back;
    if (rng.chance(0.6) && padOk(x, z)) pads.push({ x, z, radius: PAD_RADIUS });
  }
  for (let i = 0; i < 400 && pads.length < nPad; i++) {
    const r = rng.range(20, 118);
    const a = rng.range(0, TAU);
    const x = r * dsin(a);
    const z = r * dcos(a);
    if (padOk(x, z)) pads.push({ x, z, radius: PAD_RADIUS });
  }
  if (pads.length < 6) return null;

  const features: BowlFeatures = {
    crater: { x: sh.cx, z: sh.cz, radius: sh.cr },
    pipes: sh.pipes.map((p) => ({
      x0: p.x0,
      z0: p.z0,
      x1: p.x0 + p.dx * p.len,
      z1: p.z0 + p.dz * p.len,
      halfWidth: PIPE_HALF,
    })),
    kickers: sh.kicks.map((k) => {
      const c = kickCrest(k);
      return { x: c.x, z: c.z, yaw: datan2(k.fx, k.fz) };
    }),
    sites: [],
    rails: [],
  };
  return { shape: sh, pads, features, spawnX: bx, spawnZ: bz, spawnYaw: datan2(sh.sfx, sh.sfz) };
}

// ---------------------------------------------------------------------------------------------
// Sampling and interpolation.

function sampleGrid(sh: Shape, out: Float32Array): void {
  for (let j = 0; j < GRID_N; j++) {
    const z = GRID_ORIGIN + j;
    const row = j * GRID_N;
    for (let i = 0; i < GRID_N; i++) out[row + i] = shapeHeight(sh, GRID_ORIGIN + i, z);
  }
}

/** Steepest grid slope on the floor, by central differences. */
function gridFloorSlope(g: Float32Array): number {
  let worst = 0;
  const lo = Math.ceil(-FLOOR_R - GRID_ORIGIN);
  const hi = Math.floor(FLOOR_R - GRID_ORIGIN);
  for (let j = lo; j <= hi; j++) {
    const z = GRID_ORIGIN + j;
    for (let i = lo; i <= hi; i++) {
      const x = GRID_ORIGIN + i;
      if (x * x + z * z > FLOOR_R * FLOOR_R) continue;
      const k = j * GRID_N + i;
      const gx = (g[k + 1] - g[k - 1]) * 0.5;
      const gz = (g[k + GRID_N] - g[k - GRID_N]) * 0.5;
      const s = gx * gx + gz * gz;
      if (s > worst) worst = s;
    }
  }
  return Math.sqrt(worst);
}

class BowlTerrain implements Bowl {
  readonly radius = BOWL_RADIUS;
  readonly seed: number;
  readonly features: BowlFeatures;
  readonly spawnX: number;
  readonly spawnZ: number;
  readonly spawnYaw: number;
  readonly pads: readonly BoostPad[];
  /** Rails to grind, filled once by `chooseRails` (the same order as `features.rails`). */
  readonly rails: Rail[] = [];
  private readonly grid: Float32Array;
  /** Slope from the last `sample` call. */
  private gx = 0;
  private gz = 0;

  constructor(seed: number, lay: Layout, grid: Float32Array) {
    this.seed = seed;
    this.features = lay.features;
    this.spawnX = lay.spawnX;
    this.spawnZ = lay.spawnZ;
    this.spawnYaw = lay.spawnYaw;
    this.pads = lay.pads;
    this.grid = grid;
  }

  /** Catmull-Rom bicubic height at (x, z); leaves the slope in gx, gz. */
  private sample(x: number, z: number): number {
    let fx = x - GRID_ORIGIN;
    let fz = z - GRID_ORIGIN;
    // Clamp (NaN included) so the 4x4 stencil stays on the grid.
    if (!(fx >= 1)) fx = 1;
    else if (fx > GRID_N - 2.000001) fx = GRID_N - 2.000001;
    if (!(fz >= 1)) fz = 1;
    else if (fz > GRID_N - 2.000001) fz = GRID_N - 2.000001;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const tx2 = tx * tx;
    const tx3 = tx2 * tx;
    const tz2 = tz * tz;
    const tz3 = tz2 * tz;
    const wx0 = 0.5 * (-tx + 2 * tx2 - tx3);
    const wx1 = 0.5 * (2 - 5 * tx2 + 3 * tx3);
    const wx2 = 0.5 * (tx + 4 * tx2 - 3 * tx3);
    const wx3 = 0.5 * (tx3 - tx2);
    const dx0 = 0.5 * (-1 + 4 * tx - 3 * tx2);
    const dx1 = 0.5 * (-10 * tx + 9 * tx2);
    const dx2 = 0.5 * (1 + 8 * tx - 9 * tx2);
    const dx3 = 0.5 * (3 * tx2 - 2 * tx);
    const wz0 = 0.5 * (-tz + 2 * tz2 - tz3);
    const wz1 = 0.5 * (2 - 5 * tz2 + 3 * tz3);
    const wz2 = 0.5 * (tz + 4 * tz2 - 3 * tz3);
    const wz3 = 0.5 * (tz3 - tz2);
    const dz0 = 0.5 * (-1 + 4 * tz - 3 * tz2);
    const dz1 = 0.5 * (-10 * tz + 9 * tz2);
    const dz2 = 0.5 * (1 + 8 * tz - 9 * tz2);
    const dz3 = 0.5 * (3 * tz2 - 2 * tz);
    const g = this.grid;
    let h = 0;
    let hx = 0;
    let hz = 0;
    for (let r = 0; r < 4; r++) {
      const k = (j - 1 + r) * GRID_N + i - 1;
      const a = g[k];
      const b = g[k + 1];
      const c = g[k + 2];
      const d = g[k + 3];
      const v = wx0 * a + wx1 * b + wx2 * c + wx3 * d;
      const dv = dx0 * a + dx1 * b + dx2 * c + dx3 * d;
      const wz = r === 0 ? wz0 : r === 1 ? wz1 : r === 2 ? wz2 : wz3;
      const dwz = r === 0 ? dz0 : r === 1 ? dz1 : r === 2 ? dz2 : dz3;
      h += wz * v;
      hx += wz * dv;
      hz += dwz * v;
    }
    this.gx = hx;
    this.gz = hz;
    return h;
  }

  heightAt(x: number, z: number): number {
    return this.sample(x, z);
  }

  normalAt(x: number, z: number, out: Vec3): Vec3 {
    this.sample(x, z);
    const inv = 1 / Math.sqrt(this.gx * this.gx + 1 + this.gz * this.gz);
    out.x = -this.gx * inv;
    out.y = inv;
    out.z = -this.gz * inv;
    return out;
  }
}

/** Largest slope of the finished terrain within `radius` of (x, z). */
function terrainDiscSlope(t: Terrain, x: number, z: number, radius: number): number {
  const n: Vec3 = { x: 0, y: 1, z: 0 };
  let worst = 0;
  for (let ring = 0; ring <= 4; ring++) {
    const rr = (radius * ring) / 4;
    const count = ring === 0 ? 1 : 16;
    for (let i = 0; i < count; i++) {
      const a = (i * TAU) / count;
      t.normalAt(x + rr * dsin(a), z + rr * dcos(a), n);
      const s = Math.sqrt(n.x * n.x + n.z * n.z) / n.y;
      if (s > worst) worst = s;
    }
  }
  return worst;
}

/** How far the fall line from the spawn has to drop before it bottoms out, m. */
const SPAWN_RUN_DROP = 5;
const RUN_N: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * Height lost following the fall line from the spawn until the ground levels out. A spawn whose
 * fall line ends in a shallow hollow strands a player who lets go; a long drop hands them speed.
 * Pure geometry, so the map for a seed does not depend on any feel constant.
 */
export function spawnRunDrop(t: Terrain): number {
  let x = t.spawnX;
  let z = t.spawnZ;
  // Step off the level spawn pad the way the mover faces.
  x += dsin(t.spawnYaw) * 8;
  z += dcos(t.spawnYaw) * 8;
  for (let i = 0; i < 400; i++) {
    t.normalAt(x, z, RUN_N);
    const h = Math.sqrt(RUN_N.x * RUN_N.x + RUN_N.z * RUN_N.z);
    if (h < 0.02) break;
    x += RUN_N.x / h;
    z += RUN_N.z / h;
  }
  return t.heightAt(t.spawnX, t.spawnZ) - t.heightAt(x, z);
}

// ---------------------------------------------------------------------------------------------
// Sites: where the things on the map stand.

/** A hoop hangs this far above its kicker's top, m, and this far past the top along the kicker. */
export const HOOP_RISE = 3;
export const HOOP_AHEAD = 5;

/** Where sites are chosen, and the rules every one of them keeps. Map design, not feel. */
const SITE = {
  /** On the floor: inside this radius, m. */
  floorR: 125,
  /** Steepest ground a site may stand on. */
  maxSlope: 0.35,
  /** Least distance from the spawn, a boost pad and any other site, m (gates of one slalom excepted). */
  apart: 14,
  /** Things other than hoops keep this far from a kicker's top, so none stands on a ramp, m. */
  kickerClear: 18,
  crates: 12,
  golds: 2,
  /** Least distance between any two crates, gold or not, m. */
  crateApart: 25,
  /** Crates placed off the circuits first: farther than `offCircuit` from a pipe axis and the crater. */
  offCrates: 8,
  offCircuit: 20,
  shrines: 2,
  /** The ring a shrine is orbited in: its ground must be open and gentle this far out, m. */
  shrineRoom: 7,
  /** Steepest ground within the shrine's room: tried strict first, then relaxed. */
  shrineSlope: [0.18, 0.26, 0.34],
  slaloms: 2,
  gates: 5,
  /** Along the line between gates, and to either side of it, m. */
  gateStep: 18,
  gateSide: 3,
  /**
   * What a slalom's line must be, tried strict first, then relaxed: the least height lost from the
   * first gate to the last (m), how far it may turn from straight down the slope at the first gate
   * (rad), the most it climbs from one gate to the next (m), the steepest ground along it, and how
   * far it keeps from a kicker's top, the crater's edge and a pipe's axis (m). The gates themselves
   * always keep the rules of every site.
   */
  slalom: [
    { drop: 3.5, skew: 1.1, climb: 0.6, slope: 0.3, kicker: 12, crater: CRATER_LIP_HALF, pipe: PIPE_HALF },
    { drop: 2, skew: 1.3, climb: 0.8, slope: 0.3, kicker: 12, crater: 0, pipe: PIPE_HALF / 2 },
    { drop: 0.5, skew: 1.45, climb: 1.2, slope: 0.34, kicker: 8, crater: -PIPE_HALF, pipe: 0 },
    { drop: 0.1, skew: 1.5, climb: 2, slope: 0.6, kicker: 6, crater: -BOWL_RADIUS, pipe: 0 },
  ],
  hoops: 4,
  /** Least drop behind a kicker for a hoop over it, m, looked for this far back along its line. */
  hoopRunIn: 6,
  hoopLookBack: 70,
  totems: 2,
  /** Least distance between the two totems, m. */
  totemApart: 60,
  /** Candidates drawn for each site before the rules are relaxed. */
  tries: 600,
} as const;

/** Slope of the finished terrain at one point. */
function siteSlope(t: Terrain, x: number, z: number): number {
  t.normalAt(x, z, RUN_N);
  return Math.sqrt(RUN_N.x * RUN_N.x + RUN_N.z * RUN_N.z) / RUN_N.y;
}

/** Distance from (x, z) to the nearest pipe axis or the crater's edge (0 inside the crater). */
function circuitDist(sh: Shape, x: number, z: number): number {
  let d = dist(x, z, sh.cx, sh.cz) - sh.cr;
  if (d < 0) d = 0;
  for (const p of sh.pipes) {
    const a = pipeAxisDist(p, x, z);
    if (a < d) d = a;
  }
  return d;
}

type SlalomRules = (typeof SITE.slalom)[number];

/**
 * The most height there is to drop onto a kicker straight back along its line, within
 * `hoopLookBack` metres and short of the top of the rim, m.
 */
function kickerRunIn(bowl: Bowl, x: number, z: number, yaw: number): number {
  const top = bowl.heightAt(x, z);
  const fx = dsin(yaw);
  const fz = dcos(yaw);
  let best = -Infinity;
  for (let d = 2; d <= SITE.hoopLookBack; d += 2) {
    const px = x - fx * d;
    const pz = z - fz * d;
    if (px * px + pz * pz > (BOWL_RADIUS - 20) * (BOWL_RADIUS - 20)) break;
    const h = bowl.heightAt(px, pz) - top;
    if (h > best) best = h;
  }
  return best;
}

/**
 * True if a slalom line from (x, z) along (dx, dz), from a few metres before its first gate to a
 * few past its last, stays on gentle floor clear of the kickers, the crater and the pipes, never
 * climbs much from one gate to the next, and loses height overall.
 */
function slalomFits(bowl: Bowl, sh: Shape, x: number, z: number, dx: number, dz: number, rules: SlalomRules): boolean {
  const span = SITE.gateStep * (SITE.gates - 1);
  const run = 4;
  for (let q = -run; q <= span + run; q += 3) {
    const px = x + dx * q;
    const pz = z + dz * q;
    if (px * px + pz * pz >= (SITE.floorR - 3) * (SITE.floorR - 3)) return false;
    if (siteSlope(bowl, px, pz) >= rules.slope) return false;
    if (dist(px, pz, sh.cx, sh.cz) < sh.cr + rules.crater) return false;
    for (const p of sh.pipes) if (pipeAxisDist(p, px, pz) < rules.pipe) return false;
    for (const k of bowl.features.kickers) if (dist(px, pz, k.x, k.z) < rules.kicker) return false;
  }
  let prev = bowl.heightAt(x, z);
  for (let k = 1; k < SITE.gates; k++) {
    const h = bowl.heightAt(x + dx * SITE.gateStep * k, z + dz * SITE.gateStep * k);
    if (h > prev + rules.climb) return false;
    prev = h;
  }
  return bowl.heightAt(x, z) - prev >= rules.drop;
}

/**
 * Choose the sites from the finished terrain: up to four hoops over kickers, two slaloms, two
 * shrines, two totems, two gold crates and twelve crates, in that order (the hardest to fit first).
 * Every site is on the floor, on gentle ground, clear of the spawn, the pads and every other site.
 * Over seeds 1 to 300 every seed gets the full set; one that does not throws rather than hand back
 * a map short of its things.
 */
function chooseSites(bowl: Bowl, sh: Shape, rng: Rng): void {
  const sites = bowl.features.sites;
  const kickers = bowl.features.kickers;

  /**
   * The rules every site keeps. Sites of the same nonzero `group` ignore each other. A hoop hangs
   * in the air over a kicker's landing, so the slope it answers for is its kicker's top (checked
   * where hoops are chosen), not the landing under it.
   */
  const fits = (x: number, z: number, group: number, hoop: boolean): boolean => {
    if (x * x + z * z >= SITE.floorR * SITE.floorR) return false;
    if (dist(x, z, bowl.spawnX, bowl.spawnZ) < SITE.apart) return false;
    for (const p of bowl.pads) if (dist(x, z, p.x, p.z) < SITE.apart) return false;
    for (const o of sites) {
      if (group !== 0 && o.group === group) continue;
      if (dist(x, z, o.x, o.z) < SITE.apart) return false;
    }
    if (!hoop) for (const k of kickers) if (dist(x, z, k.x, k.z) < SITE.kickerClear) return false;
    return hoop || siteSlope(bowl, x, z) < SITE.maxSlope;
  };
  const add = (kind: SiteKind, x: number, z: number, yaw: number, group: number): void => {
    sites.push({ kind, x, z, yaw, group });
  };
  // A candidate point on the floor, uniform over the disc.
  let cx = 0;
  let cz = 0;
  const draw = (): void => {
    const r = (SITE.floorR - 3) * Math.sqrt(rng.next());
    const a = rng.range(0, TAU);
    cx = r * dsin(a);
    cz = r * dcos(a);
  };

  // Hoops: a hoop takes speed to reach, so they hang over the kickers with the longest drop behind
  // them (a kicker ridden out of a pipe or the crater climbs to its ramp and gets none).
  const runIn = kickers.map((k) => kickerRunIn(bowl, k.x, k.z, k.yaw));
  const order = kickers.map((_, i) => i).sort((a, b) => runIn[b] - runIn[a] || a - b);
  // If no kicker has the drop, the one with the most still gets a hoop: every map has one.
  let hoops = 0;
  for (let pass = 0; pass < 2 && hoops === 0; pass++) {
    for (const i of order) {
      const k = kickers[i];
      if (hoops >= (pass === 0 ? SITE.hoops : 1) || (pass === 0 && runIn[i] < SITE.hoopRunIn)) break;
      const x = k.x + dsin(k.yaw) * HOOP_AHEAD;
      const z = k.z + dcos(k.yaw) * HOOP_AHEAD;
      if (!fits(x, z, 0, true) || siteSlope(bowl, k.x, k.z) >= SITE.maxSlope) continue;
      add('hoop', x, z, k.yaw, 0);
      hoops++;
    }
  }

  // Slaloms: five gates down a line that falls, alternating either side of it.
  for (let g = 1; g <= SITE.slaloms; g++) {
    let placed = false;
    for (let level = 0; level < SITE.slalom.length && !placed; level++) {
      const rules = SITE.slalom[level];
      for (let i = 0; i < SITE.tries && !placed; i++) {
        draw();
        // The line leaves the first gate across the fall line, within `skew` of straight down.
        bowl.normalAt(cx, cz, RUN_N);
        if (Math.sqrt(RUN_N.x * RUN_N.x + RUN_N.z * RUN_N.z) < 0.02) continue;
        const yaw = datan2(RUN_N.x, RUN_N.z) + rng.range(-rules.skew, rules.skew);
        const dx = dsin(yaw);
        const dz = dcos(yaw);
        if (!slalomFits(bowl, sh, cx, cz, dx, dz, rules)) continue;
        let ok = true;
        for (let k = 0; k < SITE.gates && ok; k++) {
          const side = k % 2 === 0 ? SITE.gateSide : -SITE.gateSide;
          ok = fits(cx + dx * SITE.gateStep * k + dz * side, cz + dz * SITE.gateStep * k - dx * side, g, false);
        }
        if (!ok) continue;
        for (let k = 0; k < SITE.gates; k++) {
          const side = k % 2 === 0 ? SITE.gateSide : -SITE.gateSide;
          add('gate', cx + dx * SITE.gateStep * k + dz * side, cz + dz * SITE.gateStep * k - dx * side, yaw, g);
        }
        placed = true;
      }
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for slalom ${g}`);
  }

  // Shrines: open, gentle ground with room to ride round them.
  for (let n = 0; n < SITE.shrines; n++) {
    let placed = false;
    for (let level = 0; level < SITE.shrineSlope.length && !placed; level++) {
      for (let i = 0; i < SITE.tries && !placed; i++) {
        draw();
        if (!fits(cx, cz, 0, false)) continue;
        if (circuitDist(sh, cx, cz) < SITE.shrineRoom + PIPE_HALF / 2) continue;
        let roomy = true;
        for (const p of bowl.pads) if (dist(cx, cz, p.x, p.z) < SITE.shrineRoom + p.radius) roomy = false;
        if (!roomy) continue;
        if (terrainDiscSlope(bowl, cx, cz, SITE.shrineRoom) >= SITE.shrineSlope[level]) continue;
        add('shrine', cx, cz, 0, 0);
        placed = true;
      }
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for a shrine`);
  }

  // Totems, well apart.
  for (let n = 0; n < SITE.totems; n++) {
    let placed = false;
    for (let i = 0; i < SITE.tries * 2 && !placed; i++) {
      draw();
      if (!fits(cx, cz, 0, false)) continue;
      let far = true;
      for (const o of sites) if (o.kind === 'totem' && dist(cx, cz, o.x, o.z) < SITE.totemApart) far = false;
      if (!far) continue;
      add('totem', cx, cz, 0, 0);
      placed = true;
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for a totem`);
  }

  // Crates: the gold ones and most of the rest off the circuits, the others anywhere.
  for (let n = 0; n < SITE.golds + SITE.crates; n++) {
    const kind: SiteKind = n < SITE.golds ? 'gold' : 'crate';
    const off = n < SITE.offCrates;
    let placed = false;
    for (let i = 0; i < SITE.tries * 2 && !placed; i++) {
      draw();
      if (!fits(cx, cz, 0, false)) continue;
      if (off && circuitDist(sh, cx, cz) <= SITE.offCircuit) continue;
      let far = true;
      for (const o of sites) {
        if ((o.kind === 'crate' || o.kind === 'gold') && dist(cx, cz, o.x, o.z) < SITE.crateApart) far = false;
      }
      if (!far) continue;
      add(kind, cx, cz, 0, 0);
      placed = true;
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for a crate`);
  }
}

// ---------------------------------------------------------------------------------------------
// Rails: straight bars to grind, stood on the finished ground.

/** A rail's bar stands this far above the ground at both ends, m. */
export const RAIL_LIFT = 1.2;

/** Where rails go, and the rules every one of them keeps. Map design, not feel. */
const RAIL = {
  /** How many rails a map has. */
  min: 8,
  max: 12,
  /** The rail and its run-ups stay inside this radius, m. */
  floorR: 125,
  minLen: 14,
  maxLen: 32,
  /** The ground under the bar, sampled every metre, lies this far below it, m. */
  underMin: 0.7,
  underMax: 2.4,
  /** A rail falls by at least `fall` of its length from end to end, or by no more than `level`. */
  fall: 0.03,
  level: 0.02,
  /** And never more steeply than this. */
  steep: 0.3,
  /** Clear run-up beyond each end, m, on ground under `runUpSlope`. */
  runUp: 3,
  runUpSlope: 0.35,
  /**
   * Along each run-up the ground stays this far below the bar's line carried on past the end, m,
   * so a hop taken there comes down level with the bar.
   */
  runUpUnderMin: 0.9,
  runUpUnderMax: 1.5,
  /** No site (hoops excepted), pad edge or other rail within this of a rail's line or run-ups, m. */
  apart: 4,
  /** No rail within this of the spawn, m. */
  spawn: 14,
  chains: 2,
  /** A chain has two rails, or three where a third fits, laid end to end along one line. */
  chainMost: 3,
  /** Lengths tried for a chain's first rail and for the next ones, m, in order. */
  chainFirstLens: [32, 29, 26, 23, 20, 17],
  chainNextLens: [20, 16, 24, 14, 28],
  /** Gaps tried between one rail of a chain and the next, m, nearest first (5 to 8). */
  chainGaps: [5, 5.5, 6, 6.5, 7, 7.5, 8],
  /** A chain starts where the ground falls at least this steeply (speed off the first rail carries the flight)... */
  chainSlope: 0.12,
  /** ...and heads within this of straight down, rad. */
  chainSkew: 0.5,
  chainTries: 10000,
  hills: 2,
  /** Least slope under the middle of a hillside rail. */
  hillSlope: 0.1,
  /** A pipe rail runs parallel to the pipe's axis, this far to one side of it, m. */
  pipeSideMin: 1.5,
  pipeSideMax: 3.5,
  /** Candidates drawn for each rail before giving up (and for each chain, `chainTries`). */
  tries: 2000,
} as const;

/**
 * What the chain check assumes of a rider: on at run speed a few metres along the first rail, the
 * grind's push, the pop off the end, gravity, the ticks after leaving a rail before another can be
 * caught, and a little less reach below and above a bar than the mover has. These are the mover's
 * values when the map was laid out, copied rather than read so the map for a seed never depends on
 * a feel slider; `tests/sim/bowl-rails.test.ts` rides every chain with the real mover.
 *
 * The wait matters most: 18 ticks off the end a rider has dropped about half a metre below the
 * first rail's line carried on, whatever its speed, which is all the reach it has. So the next rail
 * has to start lower than that line: a chain only fits where the fall line steepens.
 */
const CHAIN_RIDER = {
  speed: 10,
  onAt: 3,
  push: 1.5,
  pop: 2,
  gravity: 25,
  wait: 18,
  below: 0.45,
  above: 1.1,
  maxVy: 1,
} as const;
const RAIL_DT = 1 / 60;

/** A rail seen from above, x0,z0 being the end it is ridden from. */
interface RailLine {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function segPointDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return dist(px, pz, ax + dx * t, az + dz * t);
}

/** Which side of the line a->b the point p is on (the sign of the cross product). */
function side(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}

/** Least distance between two segments (0 if they cross). */
function segSegDist(a: RailLine, b: RailLine): number {
  const s1 = side(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0);
  const s2 = side(a.x0, a.z0, a.x1, a.z1, b.x1, b.z1);
  const s3 = side(b.x0, b.z0, b.x1, b.z1, a.x0, a.z0);
  const s4 = side(b.x0, b.z0, b.x1, b.z1, a.x1, a.z1);
  if (s1 * s2 < 0 && s3 * s4 < 0) return 0;
  return Math.min(
    segPointDist(a.x0, a.z0, a.x1, a.z1, b.x0, b.z0),
    segPointDist(a.x0, a.z0, a.x1, a.z1, b.x1, b.z1),
    segPointDist(b.x0, b.z0, b.x1, b.z1, a.x0, a.z0),
    segPointDist(b.x0, b.z0, b.x1, b.z1, a.x1, a.z1),
  );
}

/** The rail with its run-ups: carried on `RAIL.runUp` m beyond each end. */
function withRunUps(l: RailLine): RailLine {
  const len = dist(l.x0, l.z0, l.x1, l.z1);
  const ux = ((l.x1 - l.x0) / len) * RAIL.runUp;
  const uz = ((l.z1 - l.z0) / len) * RAIL.runUp;
  return { x0: l.x0 - ux, z0: l.z0 - uz, x1: l.x1 + ux, z1: l.z1 + uz };
}

/** Height lost from the first end of the rail to the second, as a share of its length (negative: it climbs). */
function railFall(t: Terrain, l: RailLine): number {
  return (t.heightAt(l.x0, l.z0) - t.heightAt(l.x1, l.z1)) / dist(l.x0, l.z0, l.x1, l.z1);
}

/**
 * True if the rail keeps the rules of its own: its length; on the floor with its run-ups; the
 * ground under it neither too near nor too far; falling clearly or level; and a run-up at each end
 * on gentle ground that sits where the bar's line carried on can be hopped onto. (The clearances
 * from other things are checked by `railClear`.)
 */
function railShapeFits(t: Terrain, l: RailLine): boolean {
  const len = dist(l.x0, l.z0, l.x1, l.z1);
  if (len < RAIL.minLen || len > RAIL.maxLen) return false;
  const e = withRunUps(l);
  const r2 = RAIL.floorR * RAIL.floorR;
  if (e.x0 * e.x0 + e.z0 * e.z0 >= r2 || e.x1 * e.x1 + e.z1 * e.z1 >= r2) return false;
  const f = Math.abs(railFall(t, l));
  if ((f > RAIL.level && f < RAIL.fall) || f > RAIL.steep) return false;
  const y0 = t.heightAt(l.x0, l.z0) + RAIL_LIFT;
  const y1 = t.heightAt(l.x1, l.z1) + RAIL_LIFT;
  const n = Math.ceil(len);
  for (let k = 1; k < n; k++) {
    const q = k / len;
    const under = y0 + (y1 - y0) * q - t.heightAt(l.x0 + (l.x1 - l.x0) * q, l.z0 + (l.z1 - l.z0) * q);
    if (under < RAIL.underMin || under > RAIL.underMax) return false;
  }
  // The run-ups, sampled every half metre out from each end.
  const ux = (l.x1 - l.x0) / len;
  const uz = (l.z1 - l.z0) / len;
  const grade = (y1 - y0) / len;
  for (let d = 0.5; d <= RAIL.runUp + 1e-9; d += 0.5) {
    for (let end = 0; end < 2; end++) {
      const px = end === 0 ? l.x0 - ux * d : l.x1 + ux * d;
      const pz = end === 0 ? l.z0 - uz * d : l.z1 + uz * d;
      const line = end === 0 ? y0 - grade * d : y1 + grade * d;
      const under = line - t.heightAt(px, pz);
      if (under < RAIL.runUpUnderMin || under > RAIL.runUpUnderMax) return false;
      if (siteSlope(t, px, pz) >= RAIL.runUpSlope) return false;
    }
  }
  return true;
}

/**
 * True if the rail and its run-ups keep clear of the spawn, the pads, every site but the hoops, and
 * the other rails (`partners`, the rails of its own chain, need only clear the bar itself).
 */
function railClear(bowl: Bowl, l: RailLine, others: readonly RailLine[], partners: readonly RailLine[]): boolean {
  const e = withRunUps(l);
  if (segPointDist(e.x0, e.z0, e.x1, e.z1, bowl.spawnX, bowl.spawnZ) < RAIL.spawn) return false;
  for (const p of bowl.pads) if (segPointDist(e.x0, e.z0, e.x1, e.z1, p.x, p.z) < RAIL.apart + p.radius) return false;
  for (const s of bowl.features.sites) {
    if (s.kind !== 'hoop' && segPointDist(e.x0, e.z0, e.x1, e.z1, s.x, s.z) < RAIL.apart) return false;
  }
  for (const o of others) {
    if (segSegDist(e, o) < RAIL.apart || segSegDist(l, withRunUps(o)) < RAIL.apart) return false;
  }
  for (const o of partners) if (segSegDist(l, o) < RAIL.apart) return false;
  return true;
}

/**
 * True if a rider who gets on `a` at run speed a few metres from its start, grinds it to the end
 * without touching anything, and flies off the end comes down onto `b` (laid on along the same
 * line) before the ground, in the first half of it. Assumes the `CHAIN_RIDER`.
 */
function chainCatches(t: Terrain, a: RailLine, b: RailLine): boolean {
  const c = CHAIN_RIDER;
  const ya0 = t.heightAt(a.x0, a.z0) + RAIL_LIFT;
  const ya1 = t.heightAt(a.x1, a.z1) + RAIL_LIFT;
  const yb0 = t.heightAt(b.x0, b.z0) + RAIL_LIFT;
  const yb1 = t.heightAt(b.x1, b.z1) + RAIL_LIFT;
  const hl = dist(a.x0, a.z0, a.x1, a.z1);
  const l3 = Math.sqrt(hl * hl + (ya1 - ya0) * (ya1 - ya0));
  // The grind: the slope pulls, the grind pushes.
  let v = c.speed;
  for (let d = (c.onAt / hl) * l3; d < l3; d += v * RAIL_DT) v += ((c.gravity * (ya0 - ya1)) / l3 + c.push) * RAIL_DT;
  // The flight.
  const ux = (a.x1 - a.x0) / hl;
  const uz = (a.z1 - a.z0) / hl;
  const vh = (v * hl) / l3;
  let vy = (v * (ya1 - ya0)) / l3 + c.pop;
  let x = a.x1;
  let z = a.z1;
  let y = ya1;
  const bdx = b.x1 - b.x0;
  const bdz = b.z1 - b.z0;
  const bl2 = bdx * bdx + bdz * bdz;
  for (let tick = 0; tick < 240; tick++) {
    vy -= c.gravity * RAIL_DT;
    x += ux * vh * RAIL_DT;
    z += uz * vh * RAIL_DT;
    y += vy * RAIL_DT;
    const q = ((x - b.x0) * bdx + (z - b.z0) * bdz) / bl2;
    if (q >= 0 && q <= 1) {
      const ry = yb0 + (yb1 - yb0) * q;
      if (tick >= c.wait - 1 && vy <= c.maxVy && y >= ry - c.below && y <= ry + c.above) return q <= 0.5;
    }
    if (y <= t.heightAt(x, z)) return false;
  }
  return false;
}

/**
 * Choose the rails from the finished ground and sites: one down each half-pipe's floor, beside the
 * axis; two chains of rails end to end down a fall line, each close enough behind the last that
 * riding off one lands on the next; two down the fall line of a hillside; then more where they fit,
 * up to a count drawn from the seed. Over seeds 1 to 300 every seed gets them all; one that does
 * not throws rather than hand back a map short of its rails.
 */
function chooseRails(bowl: BowlTerrain, rng: Rng): void {
  const lines: RailLine[] = [];
  const sites = bowl.features.rails;
  const want = RAIL.min + rng.int(RAIL.max - RAIL.min + 1);
  const add = (l: RailLine, kind: RailKind, chain: number): void => {
    lines.push(l);
    sites.push({ x0: l.x0, z0: l.z0, x1: l.x1, z1: l.z1, kind, chain });
    bowl.rails.push(railOver((x, z) => bowl.heightAt(x, z), l.x0, l.z0, l.x1, l.z1, RAIL_LIFT));
  };
  /** The line from (x, z) along (dx, dz), `from` to `to` metres. */
  const along = (x: number, z: number, dx: number, dz: number, from: number, to: number): RailLine => ({
    x0: x + dx * from,
    z0: z + dz * from,
    x1: x + dx * to,
    z1: z + dz * to,
  });
  /** The same line ridden from its high end. */
  const highFirst = (l: RailLine): RailLine => (railFall(bowl, l) >= 0 ? l : { x0: l.x1, z0: l.z1, x1: l.x0, z1: l.z0 });
  const fits = (l: RailLine, partners: readonly RailLine[] = []): boolean =>
    railShapeFits(bowl, l) && railClear(bowl, l, lines, partners);
  // A candidate point on the floor, uniform over the disc, and the way downhill from it.
  let cx = 0;
  let cz = 0;
  let fx = 0;
  let fz = 0;
  let slope = 0;
  const draw = (): void => {
    const r = (RAIL.floorR - 6) * Math.sqrt(rng.next());
    const a = rng.range(0, TAU);
    cx = r * dsin(a);
    cz = r * dcos(a);
    bowl.normalAt(cx, cz, RUN_N);
    const h = Math.sqrt(RUN_N.x * RUN_N.x + RUN_N.z * RUN_N.z);
    slope = h / RUN_N.y;
    fx = h > 1e-9 ? RUN_N.x / h : 0;
    fz = h > 1e-9 ? RUN_N.z / h : 1;
  };

  // Down each half-pipe's floor, parallel to the axis and off to one side of it.
  for (const p of bowl.features.pipes) {
    const len = dist(p.x0, p.z0, p.x1, p.z1);
    const dx = (p.x1 - p.x0) / len;
    const dz = (p.z1 - p.z0) / len;
    let placed = false;
    for (let i = 0; i < RAIL.tries && !placed; i++) {
      const off = rng.range(RAIL.pipeSideMin, RAIL.pipeSideMax) * (rng.chance(0.5) ? 1 : -1);
      const s0 = rng.range(RAIL.runUp, len - RAIL.minLen - RAIL.runUp);
      const s1 = Math.min(s0 + rng.range(RAIL.minLen, RAIL.maxLen), len - RAIL.runUp);
      const l = highFirst(along(p.x0 + dz * off, p.z0 - dx * off, dx, dz, s0, s1));
      if (!fits(l)) continue;
      add(l, 'pipe', 0);
      placed = true;
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for a rail in a pipe`);
  }

  // Chains: two or three rails end to end along one line that starts down the fall line. The first
  // is the longest that fits there (the faster it is left, the farther the flight carries); each
  // next one starts as soon after the last as lets riding off that one land on it.
  const next = (chain: readonly RailLine[], ux: number, uz: number): RailLine | null => {
    const last = chain[chain.length - 1];
    for (const gap of RAIL.chainGaps) {
      for (const len of RAIL.chainNextLens) {
        const l = along(last.x1, last.z1, ux, uz, gap, gap + len);
        // Ridden first end to last: each one falls that way, or is level.
        if (railFall(bowl, l) >= -RAIL.level && fits(l, chain) && chainCatches(bowl, last, l)) return l;
      }
    }
    return null;
  };
  for (let c = 1; c <= RAIL.chains; c++) {
    let placed = false;
    for (let i = 0; i < RAIL.chainTries && !placed; i++) {
      draw();
      if (slope < RAIL.chainSlope) continue;
      const yaw = datan2(fx, fz) + rng.range(-RAIL.chainSkew, RAIL.chainSkew);
      const ux = dsin(yaw);
      const uz = dcos(yaw);
      for (const len of RAIL.chainFirstLens) {
        const first = along(cx, cz, ux, uz, 0, len);
        if (railFall(bowl, first) < -RAIL.level || !fits(first)) continue;
        const chain = [first];
        const second = next(chain, ux, uz);
        if (!second) continue;
        chain.push(second);
        while (chain.length < RAIL.chainMost) {
          const more = next(chain, ux, uz);
          if (!more) break;
          chain.push(more);
        }
        for (const l of chain) add(l, 'chain', c);
        placed = true;
        break;
      }
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for rail chain ${c}`);
  }

  // Down the fall line of a hillside, centred where the slope is read.
  for (let n = 0; n < RAIL.hills; n++) {
    let placed = false;
    for (let i = 0; i < RAIL.tries && !placed; i++) {
      draw();
      if (slope < RAIL.hillSlope) continue;
      const half = rng.range(RAIL.minLen, RAIL.maxLen) / 2;
      const l = along(cx, cz, fx, fz, -half, half);
      if (railFall(bowl, l) < RAIL.fall || !fits(l)) continue;
      add(l, 'hill', 0);
      placed = true;
    }
    if (!placed) throw new Error(`makeBowl(${bowl.seed}): no room for a hillside rail`);
  }

  // The rest wherever they fit, any way round.
  for (let i = 0; i < RAIL.tries && lines.length < want; i++) {
    draw();
    const yaw = rng.range(0, TAU);
    const half = rng.range(RAIL.minLen, RAIL.maxLen) / 2;
    const l = highFirst(along(cx, cz, dsin(yaw), dcos(yaw), -half, half));
    if (fits(l)) add(l, 'open', 0);
  }
}

/**
 * Build the bowl for a seed. Same seed, bit-identical terrain.
 *
 * Layouts are drawn from the seed until one passes the floor-slope, spawn, spawn-run and pad checks on the
 * finished, interpolated surface; later attempts soften the hills. Over seeds 1 to 300 every seed
 * passes, nearly always on the first or second attempt; running out of attempts throws rather than
 * hand back a bowl that broke its own rules.
 */
export function makeBowl(seed: number): Bowl {
  const grid = new Float32Array(GRID_N * GRID_N);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const lay = layout(seed, attempt);
    if (!lay) continue;
    sampleGrid(lay.shape, grid);
    if (gridFloorSlope(grid) > ACCEPT_SLOPE) continue;
    const bowl = new BowlTerrain(seed, lay, grid);
    if (terrainDiscSlope(bowl, bowl.spawnX, bowl.spawnZ, 6) >= 0.05) continue;
    let padsOk = true;
    for (const p of bowl.pads) if (terrainDiscSlope(bowl, p.x, p.z, p.radius) >= 0.15) padsOk = false;
    if (padsOk && spawnRunDrop(bowl) >= SPAWN_RUN_DROP) {
      // The ground is final; what stands on it is chosen from its own stream, so it never moves it.
      chooseSites(bowl, lay.shape, new Rng(seed).fork('sites'));
      chooseRails(bowl, new Rng(seed).fork('rails'));
      return bowl;
    }
  }
  throw new Error(`makeBowl(${seed}): no layout passed its checks`);
}
