/**
 * The horde: one instanced mesh per enemy kind, plus one for the blob shadows under all of them.
 *
 * Each frame the world's dense enemy arrays are written straight into the instance matrices (no
 * `Matrix4` or `Object3D` per enemy): position extrapolated back from the latest tick by the
 * velocity (the world is not interpolated, its indices move), facing from the velocity (or toward
 * the mover while standing still), and a uniform scale that grows from 0 to 1 while the enemy rises
 * out of the ground.
 *
 * Every kind is a chunky low-poly creature with a face, built from convex pieces. Each piece carries
 * a tone of its kind's palette colour (baked per vertex, `tone()` from `look.ts`) and a part id with
 * a pivot (`aRig`), so the vertex shader can swing legs and arms, nod a head, open plates or lift a
 * crown without the CPU touching a vertex. Two per-instance attributes drive it: `aAnim` (phase,
 * speed share, hit flash) and `aPose` (crown colour, action, state, damage), worked out here from the
 * world each frame. Every surface is the flat, lit, fogged material from `look.ts`, extended through
 * `onBeforeCompile`.
 *
 * The seven, each with its silhouette and its way of moving:
 * - shuffler: a hunched lurcher reaching forward with both arms, one eye bigger than the other;
 *   it limps, pitching forward on every step.
 * - gnat: a dart with dark bug eyes and two pale wings that buzz; it bobs and never stops.
 * - bollard: a fat striped post on two stubby feet with sleepy eyes; it waddles side to side.
 * - cutter: lean and low, a visor slit for a face and a blade jutting from its chest; it skates,
 *   rocking from blade to blade.
 * - lobber: squat and wide with a grin, its ball held up over its head; it winds the arm back
 *   before a lob and follows through after.
 * - sludge: a mound with eyes on stalks and a drooping mouth; it oozes, squashing and stretching.
 * - clinger: a small spiky ball on six legs; it scuttles, and on the rider's back it kicks.
 *
 * Elites (`MARK_ELITE`, or any aura) are drawn `ELITE_SCALE` larger with a little white sheen and a
 * crown of spikes in the aura's colour (`auraColors()`); an aura also lays a ring on the ground at
 * its reach. A clinger holding on (`STATE_LATCHED`) is drawn on the mover's back.
 *
 * The bosses, each in its own colour from `PALETTE.bosses` and far bigger than anything else:
 * - the Bruiser, a bull on four legs under a great hump, its head low between wide horns. In its
 *   tell it drops its head, leans in and paws the ground; charging, it stretches long and gallops.
 * - the Mortar, a walking drum on four stubby legs with a tube standing up out of a turret; the tube
 *   kicks down into the drum when it fires a volley and the drum squats.
 * - the Standstill, a monolith on a stepped plinth with one eye that turns to follow the rider and
 *   two plates over its core that swing open as a ring goes out; shards circle its top.
 * Under a third of its health a boss looks damaged: darker, cracked, and missing a piece (a horn, a
 * shell, its point).
 */
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type MeshLambertMaterial,
  Vector3,
  Vector4,
} from 'three';
import { BOSS, BRUISER_CHARGE, BRUISER_TELL } from '../sim/bosses';
import { DT, TICK_HZ } from '../sim/constants';
import { HAZARDS } from '../sim/hazards';
import { HORDE } from '../sim/horde';
import type { Terrain } from '../sim/terrain';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_NONE,
  ELITE_SHIELD,
  KIND_BOLLARD,
  KIND_BRUISER,
  KIND_CLINGER,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_MORTAR,
  KIND_SHUFFLER,
  KIND_SLUDGE,
  KIND_STANDSTILL,
  KINDS,
  MARK_ELITE,
  MAX_ENEMIES,
  SPAWN_TICKS,
  STATE_LATCHED,
  type World,
} from '../sim/world';
import { rgbInto, uploadFirst } from './fxView';
import { PALETTE, flatMaterial, tone } from './look';
import { GroundRings } from './zonesView';

/** Share of an enemy's own colour it shows as glow, so its unlit side still reads as that colour. */
const ENEMY_GLOW = 0.38;
/** Ticks of hit flash shown at full strength; below that it fades out. */
const FLASH_FULL_TICKS = 3;
/**
 * Up to this many enemies flashing at once each flash fully; beyond it each flashes less (in
 * proportion), down to `FLASH_FLOOR`, so an area hit tints a crowd instead of turning it white.
 */
export const FLASH_CROWD = 6;
export const FLASH_FLOOR = 0.3;
/**
 * Blob shadow: radius as a share of the body radius, height above the ground, opacity. Black (the
 * darkest tone of the palette) whatever the look, so it darkens any floor and pins the enemy to it.
 */
export const SHADOW_SCALE = 1.35;
const SHADOW_LIFT = 0.05;
export const SHADOW_OPACITY = 0.6;
const SHADOW_SEGMENTS = 8;
/** Below this speed an enemy counts as standing and turns to face the mover, m/s. */
const STILL_SPEED = 0.05;
/** An elite is drawn this much larger than its kind. */
export const ELITE_SCALE = 1.4;
/** An elite always shows this much of the flash colour (white): a sheen, under its crown. */
const ELITE_SHEEN = 0.08;
/**
 * The colour of each aura, by ELITE_*: its ring on the ground and the crown of an elite carrying it.
 * Index 0 (ELITE_NONE) is the crown of an elite with no aura: the elite white. Haste orange (the
 * Wake's fire), shield blue (the second gear), jam magenta (the accent). Read from `PALETTE` when
 * called, so a look that replaces the palette is followed.
 */
export function auraColors(): readonly number[] {
  return [PALETTE.elite, PALETTE.wake, PALETTE.gears[1], PALETTE.accent];
}
/** Width of an aura's ring at the edge of its reach, m, and its strength. */
const AURA_BAND = 0.4;
const AURA_FADE = 0.35;
const AURA_SEGMENTS = 48;
const AURA_LIFT = 0.15;
/** Most aura rings drawn at once. */
export const MAX_AURA_RINGS = 32;
/**
 * A latched clinger rides on the mover's back: this far behind its middle, spread this far across
 * by its phase, and between these heights above its feet, m.
 */
const RIDE_BACK = 0.3;
const RIDE_SPREAD = 0.6;
const RIDE_LOW = 0.45;
const RIDE_HIGH = 1.05;
/** The clinger's middle above its feet, m. */
const CLINGER_MID = 0.35;

/** A boss under this share of its health looks damaged. */
export const BOSS_DAMAGED = 1 / 3;
/** The lobber's wind-up shows over the last this many ticks before a lob, and its follow-through for this many after. */
const LOB_WINDUP = 36;
const LOB_FOLLOW = 14;
/** Ticks the Bruiser takes to drop its head into the tell, and to stretch into a charge. */
const TELL_EASE = 8;
const CHARGE_EASE = 6;
/** Ticks the Mortar's tube takes to come back up after a volley. */
const RECOIL_TICKS = 30;
/** The Standstill's plates: start to part this many ticks before a ring, open fully over `PLATE_OPEN`, close over `PLATE_CLOSE`. */
const PLATE_EARLY = 30;
const PLATE_OPEN = 8;
const PLATE_CLOSE = 42;
/** How far its eye turns either way to follow the rider, rad. */
const EYE_TURN = 0.75;
const LOB_EVERY = Math.round(HAZARDS.lobEvery / DT);
const MORTAR_VOLLEY = Math.round(BOSS.mortar.volleyEvery * TICK_HZ);
const STAND_RING = Math.round(BOSS.standstill.ringEvery * TICK_HZ);

// ---- parts: how the vertex shader moves each piece (aRig.w) ---------------------------------

/** Never moves on its own (the whole-body wobble still applies). */
export const PART_BODY = 0;
/** Legs: swing about their pivot, A and B in opposite phase. */
export const PART_LEG_A = 1;
export const PART_LEG_B = 2;
/** Arms (wings, for the gnat): swing opposite the legs. */
export const PART_ARM_A = 3;
export const PART_ARM_B = 4;
/** Shown only on an elite, in its aura's colour; folded to nothing otherwise. */
export const PART_CROWN = 5;
/** A head (or what stands for one): nods, bobs, turns, by kind. */
export const PART_HEAD = 6;
/** The kind's action: the lobber's arm, the Mortar's tube, the Standstill's eye, the Bruiser's pawing leg. */
export const PART_ACT = 7;
/** The Standstill's two plates. */
export const PART_PLATE_A = 8;
export const PART_PLATE_B = 9;
/** Shown until the boss is damaged. */
export const PART_INTACT = 10;
/** Shown once the boss is damaged. */
export const PART_SCAR = 11;

/**
 * Per kind: the hop-wobble. `hop` is how high it bounces at full speed (m), `rate` how many bounces
 * a second, `sway` how far it rocks side to side (m per m of height), `idle` the share of the
 * wobble left while standing still (gnats never stop buzzing).
 */
interface Wobble {
  hop: number;
  rate: number;
  sway: number;
  idle: number;
}

const WOBBLE: readonly Wobble[] = [
  // Shuffler: a heavy lurch.
  { hop: 0.1, rate: 2.2, sway: 0.05, idle: 0.2 },
  // Gnat: buzzing.
  { hop: 0.12, rate: 7.5, sway: 0.2, idle: 1 },
  // Bollard: a slow waddle (the rock is in its own motion).
  { hop: 0.06, rate: 1.1, sway: 0, idle: 0.25 },
  // Cutter: a quick, low sprint.
  { hop: 0.04, rate: 2.3, sway: 0, idle: 0.15 },
  // Lobber: a heavy rock from foot to foot.
  { hop: 0.08, rate: 1.7, sway: 0.05, idle: 0.35 },
  // Sludge: the ooze is in its own motion.
  { hop: 0.02, rate: 0.9, sway: 0.03, idle: 0.5 },
  // Clinger: never still.
  { hop: 0.08, rate: 9, sway: 0.15, idle: 1 },
  // Bruiser: a heavy stomp.
  { hop: 0.1, rate: 1.4, sway: 0.02, idle: 0.1 },
  // Mortar: a slow settle.
  { hop: 0.05, rate: 0.7, sway: 0.01, idle: 0.4 },
  // Standstill: does not move at all, which is the unsettling part.
  { hop: 0, rate: 0, sway: 0, idle: 0 },
];

/**
 * Per kind: the gait. `leg` and `arm` are how far legs and arms swing at full speed (rad), `rate`
 * steps a second at full speed, `still` the share of the swing left standing.
 */
interface Gait {
  leg: number;
  arm: number;
  rate: number;
  still: number;
}

const GAIT: readonly Gait[] = [
  { leg: 0.5, arm: 0.18, rate: 1.1, still: 0.1 },
  { leg: 0, arm: 0, rate: 1, still: 1 },
  { leg: 0.35, arm: 0, rate: 0.55, still: 0.15 },
  { leg: 0.55, arm: 0.35, rate: 1.15, still: 0.1 },
  { leg: 0.35, arm: 0, rate: 0.85, still: 0.25 },
  { leg: 0, arm: 0, rate: 1, still: 1 },
  { leg: 0, arm: 0, rate: 1, still: 1 },
  { leg: 0.45, arm: 0, rate: 0.7, still: 0.05 },
  { leg: 0.4, arm: 0, rate: 0.45, still: 0.1 },
  { leg: 0, arm: 0, rate: 0, still: 0 },
];

// ---- geometry -------------------------------------------------------------------------------

const BOX_FACES = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 3, 2, 6, 3, 6, 7, 1, 0, 4, 1, 4, 5, 2, 1, 5, 2, 5, 6, 0, 3, 7, 0, 7, 4];
const OCTA_FACES = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 4, 2, 1, 3, 4, 1, 5, 3, 1, 2, 5];
const TETRA_FACES = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
const PYRAMID_FACES = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 1, 2, 0, 2, 3];

/**
 * A model being built: convex pieces, each triangle turned to face away from its own piece's middle,
 * with a tone of the kind's colour and a part (and its pivot) per vertex.
 */
class Model {
  readonly pos: number[] = [];
  private readonly tones: number[] = [];
  private readonly rig: number[] = [];
  private k = 0;
  private part = PART_BODY;
  private px = 0;
  private py = 0;
  private pz = 0;

  constructor(private readonly base: number) {}

  /** What follows is `part` (pivoting about px, py, pz) in tone `k` of the kind's colour. */
  set(part: number, k: number, px = 0, py = 0, pz = 0): this {
    this.part = part;
    this.k = k;
    this.px = px;
    this.py = py;
    this.pz = pz;
    return this;
  }

  /**
   * A convex piece: its corners (x, y, z each) and its faces (index triples), each turned away from
   * the piece's middle, or from `centre` when given.
   */
  hull(p: readonly number[], faces: readonly number[], centre?: readonly [number, number, number]): this {
    const n = p.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += p[i * 3];
      cy += p[i * 3 + 1];
      cz += p[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    if (centre) [cx, cy, cz] = centre;
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] * 3;
      const b = faces[f + 1] * 3;
      const c = faces[f + 2] * 3;
      const ux = p[b] - p[a];
      const uy = p[b + 1] - p[a + 1];
      const uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a];
      const vy = p[c + 1] - p[a + 1];
      const vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const mx = (p[a] + p[b] + p[c]) / 3 - cx;
      const my = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 - cy;
      const mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz;
      const order = nx * mx + ny * my + nz * mz >= 0 ? [a, b, c] : [a, c, b];
      for (const o of order) {
        this.pos.push(p[o], p[o + 1], p[o + 2]);
        this.tones.push(this.k);
        this.rig.push(this.px, this.py, this.pz, this.part);
      }
    }
    return this;
  }

  /**
   * A block from y0 to y1 whose bottom is 2*bx by 2*bz and top 2*tx by 2*tz, centred on (dx, dz),
   * the top shifted forward (+z) by `lean`. Twelve triangles.
   */
  block(y0: number, y1: number, bx: number, bz: number, tx: number, tz: number, lean = 0, dz = 0, dx = 0): this {
    return this.hull(
      [
        dx - bx, y0, dz - bz, dx + bx, y0, dz - bz, dx + bx, y0, dz + bz, dx - bx, y0, dz + bz,
        dx - tx, y1, dz + lean - tz, dx + tx, y1, dz + lean - tz, dx + tx, y1, dz + lean + tz, dx - tx, y1, dz + lean + tz,
      ],
      BOX_FACES,
    );
  }

  /** A box centred at (x, y, z), half-sizes (hx, hy, hz), turned `yaw` about y. Twelve triangles. */
  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw = 0): this {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const p: number[] = [];
    for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) {
      const lx = sx * hx;
      const lz = sz * hz;
      p.push(x + c * lx + s * lz, y + sy * hy, z - s * lx + c * lz);
    }
    return this.hull(p, BOX_FACES);
  }

  /** A diamond about (x, y, z) reaching rx, ry, rz along the axes. Eight triangles. */
  octa(x: number, y: number, z: number, rx: number, ry: number, rz: number): this {
    return this.hull([x, y + ry, z, x, y - ry, z, x + rx, y, z, x - rx, y, z, x, y, z + rz, x, y, z - rz], OCTA_FACES);
  }

  /** A `sides`-sided limb from A (thickness ra) to B (thickness rb), open at the ends. Two triangles a side. */
  limb(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, sides = 4): this {
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    // u = d x helper, v = d x u.
    const hx = Math.abs(dx) > 0.9 ? 0 : 1;
    const hy = Math.abs(dx) > 0.9 ? 1 : 0;
    let ux = -dz * hy;
    let uy = dz * hx;
    let uz = dx * hy - dy * hx;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const p: number[] = [];
    for (let k = 0; k < sides; k++) {
      const a = ((k + 0.5) / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      p.push(ax + (ux * c + vx * s) * ra, ay + (uy * c + vy * s) * ra, az + (uz * c + vz * s) * ra);
      p.push(bx + (ux * c + vx * s) * rb, by + (uy * c + vy * s) * rb, bz + (uz * c + vz * s) * rb);
    }
    const faces: number[] = [];
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides;
      faces.push(k * 2, j * 2, j * 2 + 1, k * 2, j * 2 + 1, k * 2 + 1);
    }
    return this.hull(p, faces);
  }

  /**
   * A ring of `n` sides from radius r0 at y0 to r1 at y1 about (cx, cz), squeezed by sx across and
   * sz along, with a cap at the bottom and/or top. Two triangles a side and one per side per cap.
   */
  prism(n: number, r0: number, r1: number, y0: number, y1: number, bottom: boolean, top: boolean, cx = 0, cz = 0, sx = 1, sz = 1): this {
    const p: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      p.push(cx + s * r0 * sx, y0, cz + c * r0 * sz, cx + s * r1 * sx, y1, cz + c * r1 * sz);
    }
    p.push(cx, y0, cz, cx, y1, cz);
    const faces: number[] = [];
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      faces.push(k * 2, j * 2, j * 2 + 1, k * 2, j * 2 + 1, k * 2 + 1);
      if (bottom) faces.push(k * 2, j * 2, n * 2);
      if (top) faces.push(k * 2 + 1, j * 2 + 1, n * 2 + 1);
    }
    // The caps' middles are only corners when a cap uses them; otherwise they would pull the piece's
    // middle off its true centre, which is harmless for a ring, so they stay.
    return this.hull(p, faces);
  }

  /** A cone of `n` sides from a ring of radius r at y0 to a point at (cx + ax, y1, cz + az). One triangle a side. */
  cone(n: number, r: number, y0: number, y1: number, cx = 0, cz = 0, ax = 0, az = 0): this {
    const p: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      p.push(cx + Math.sin(a) * r, y0, cz + Math.cos(a) * r);
    }
    p.push(cx + ax, y1, cz + az);
    const faces: number[] = [];
    for (let k = 0; k < n; k++) faces.push(k, (k + 1) % n, n);
    return this.hull(p, faces);
  }

  /** A pyramid from the quad (four corners, in order round it) to an apex. Six triangles. */
  pyramid(quad: readonly number[], ax: number, ay: number, az: number): this {
    return this.hull([...quad, ax, ay, az], PYRAMID_FACES);
  }

  /** A four-cornered spike or shard. Four triangles. */
  tetra(p: readonly number[]): this {
    return this.hull(p, TETRA_FACES);
  }

  /** A spike from a small square base round (x, y, z) up to (x + ax, y + h, z + az), its base left open (it is sunk into what it stands on). Four triangles. */
  spike(x: number, y: number, z: number, r: number, h: number, ax = 0, az = 0): this {
    return this.hull([x - r, y, z - r, x + r, y, z - r, x + r, y, z + r, x - r, y, z + r, x + ax, y + h, z + az], PYRAMID_FACES.slice(0, 12), [x + ax * 0.3, y + h * 0.3, z + az * 0.3]);
  }

  /** Move everything (pivots too) up or down so the lowest corner of the body (not the crown) is on the ground. */
  ground(): this {
    let low = Infinity;
    for (let v = 0; v < this.tones.length; v++) if (this.rig[v * 4 + 3] !== PART_CROWN) low = Math.min(low, this.pos[v * 3 + 1]);
    for (let v = 0; v < this.tones.length; v++) {
      this.pos[v * 3 + 1] -= low;
      this.rig[v * 4 + 1] -= low;
    }
    return this;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    const tint = new Float32Array(this.tones.length * 3);
    const c = new Color();
    for (let v = 0; v < this.tones.length; v++) {
      // The crown is white here: the shader tints it with the aura's colour.
      const hex = this.rig[v * 4 + 3] === PART_CROWN ? tone(PALETTE.elite, this.tones[v]) : tone(this.base, this.tones[v]);
      c.setHex(hex);
      tint[v * 3] = c.r;
      tint[v * 3 + 1] = c.g;
      tint[v * 3 + 2] = c.b;
    }
    g.setAttribute('aTint', new Float32BufferAttribute(tint, 3));
    g.setAttribute('aRig', new Float32BufferAttribute(this.rig, 4));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** The palette colour of a kind. */
export function kindColor(kind: number): number {
  return kind < PALETTE.enemies.length ? PALETTE.enemies[kind] : PALETTE.bosses[kind - KIND_BRUISER];
}

/** Tones: eyes, pupils and dark recesses, used across the kinds. */
const EYE = 0.9;
const DARK = -0.78;

/**
 * A hunched lurcher, 1.7 m: two thick legs, a broad stooped torso, the head pushed forward with one
 * big eye and one small, and both arms reaching out in front.
 */
export function shufflerGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_SHUFFLER));
  m.set(PART_LEG_A, -0.45, 0.18, 0.78, 0).block(0, 0.8, 0.13, 0.19, 0.12, 0.11, -0.05, 0.05, 0.18);
  m.set(PART_LEG_B, -0.45, -0.18, 0.78, 0).block(0, 0.8, 0.13, 0.19, 0.12, 0.11, -0.05, 0.05, -0.18);
  m.set(PART_BODY, 0).block(0.72, 1.38, 0.34, 0.22, 0.44, 0.28, 0.16);
  m.set(PART_BODY, 0.18).block(1.3, 1.7, 0.2, 0.19, 0.17, 0.16, 0.04, 0.22);
  m.set(PART_BODY, EYE).octa(0.085, 1.53, 0.43, 0.075, 0.08, 0.05).octa(-0.09, 1.52, 0.42, 0.05, 0.055, 0.04);
  m.set(PART_BODY, DARK).block(1.36, 1.43, 0.11, 0.03, 0.12, 0.03, 0, 0.42, 0.01);
  m.set(PART_ARM_A, 0.06, 0.42, 1.28, 0.2).limb(0.42, 1.28, 0.2, 0.33, 1.13, 0.76, 0.1, 0.08);
  m.set(PART_ARM_A, 0.28, 0.42, 1.28, 0.2).tetra([0.33, 1.24, 0.8, 0.45, 1.04, 0.8, 0.21, 1.04, 0.8, 0.33, 1.1, 0.98]);
  m.set(PART_ARM_B, 0.06, -0.42, 1.28, 0.2).limb(-0.42, 1.28, 0.2, -0.31, 1.18, 0.74, 0.1, 0.08);
  m.set(PART_ARM_B, 0.28, -0.42, 1.28, 0.2).tetra([-0.31, 1.29, 0.78, -0.19, 1.09, 0.78, -0.43, 1.09, 0.78, -0.31, 1.15, 0.96]);
  m.set(PART_CROWN, 0, 0, 1.7, 0.24).spike(0.08, 1.68, 0.24, 0.084, 0.448, 0.04).spike(-0.08, 1.68, 0.24, 0.084, 0.448, -0.04);
  return m.geometry();
}

/** A dart hovering at knee height, its point forward: dark bug eyes and two pale buzzing wings. */
export function gnatGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_GNAT));
  const c = 0.55;
  m.set(PART_BODY, 0).hull([0, c, 0.6, 0, c, -0.42, 0.2, c, 0.04, -0.2, c, 0.04, 0, c + 0.22, 0.06, 0, c - 0.18, 0.04], OCTA_FACES);
  for (const side of [1, -1]) {
    m.set(PART_BODY, DARK).tetra([side * 0.05, c + 0.2, 0.36, side * 0.17, c + 0.06, 0.34, side * 0.07, c + 0.02, 0.44, side * 0.12, c + 0.16, 0.22]);
    m.set(side > 0 ? PART_ARM_A : PART_ARM_B, 0.62, side * 0.08, c + 0.17, 0.05)
      .tetra([side * 0.07, c + 0.19, 0.14, side * 0.07, c + 0.19, -0.06, side * 0.52, c + 0.34, -0.2, side * 0.2, c + 0.15, -0.02]);
  }
  m.set(PART_CROWN, 0, 0, c + 0.2, 0.06).tetra([0, c + 0.48, 0.02, -0.06, c + 0.17, 0.12, 0.06, c + 0.17, 0.12, 0, c + 0.17, -0.06]);
  return m.geometry();
}

/** A fat striped post, 2.4 m, on two stubby feet, with sleepy eyes high on its front. */
export function bollardGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_BOLLARD));
  m.set(PART_LEG_A, -0.5, 0.5, 0.3, 0).block(0, 0.32, 0.3, 0.42, 0.26, 0.34, 0, 0.08, 0.5);
  m.set(PART_LEG_B, -0.5, -0.5, 0.3, 0).block(0, 0.32, 0.3, 0.42, 0.26, 0.34, 0, 0.08, -0.5);
  m.set(PART_BODY, 0).prism(8, 1.15, 0.9, 0.25, 1.95, false, false);
  m.set(PART_BODY, 0.6).prism(8, 1.13, 1.09, 0.65, 0.98, false, false);
  m.set(PART_BODY, -0.18).prism(8, 0.95, 0.7, 1.95, 2.4, false, true);
  // Sleepy eyes, heavy-lidded (flat on top), and a wide dark mouth.
  for (const side of [1, -1]) m.set(PART_BODY, EYE).tetra([side * 0.12, 1.68, 0.97, side * 0.52, 1.68, 0.92, side * 0.32, 1.5, 0.98, side * 0.32, 1.63, 1.06]);
  m.set(PART_BODY, DARK).block(1.2, 1.36, 0.36, 0.06, 0.3, 0.06, 0, 1.0);
  m.set(PART_CROWN, 0, 0, 2.4, 0).spike(0.25, 2.36, 0, 0.168, 0.672, 0.06).spike(-0.25, 2.36, 0, 0.168, 0.672, -0.06);
  return m.geometry();
}

/**
 * Lean and pointed forward, 1.5 m: crouched legs on skate blades, a torso pitched hard toward the
 * mover, a visor slit for a face, a fin behind and a blade jutting from the chest; one arm swept back.
 */
export function cutterGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_CUTTER));
  for (const side of [1, -1]) {
    m.set(side > 0 ? PART_LEG_A : PART_LEG_B, -0.4, side * 0.1, 0.62, -0.05)
      .limb(side * 0.1, 0.64, -0.05, side * 0.12, 0.1, 0.02, 0.08, 0.06)
      .set(side > 0 ? PART_LEG_A : PART_LEG_B, -0.7, side * 0.1, 0.62, -0.05)
      .block(0, 0.12, 0.05, 0.22, 0.05, 0.18, 0.02, 0.04, side * 0.12);
  }
  m.set(PART_BODY, 0).block(0.58, 1.32, 0.2, 0.15, 0.15, 0.12, 0.42);
  m.set(PART_BODY, 0.12).block(1.22, 1.5, 0.13, 0.13, 0.11, 0.11, 0.05, 0.5);
  m.set(PART_BODY, EYE).block(1.33, 1.42, 0.115, 0.03, 0.105, 0.03, 0, 0.635);
  m.set(PART_BODY, -0.42).pyramid([-0.05, 1.3, 0.4, 0.05, 1.3, 0.4, 0.05, 1.48, 0.42, -0.05, 1.48, 0.42], 0, 1.45, 0.12);
  m.set(PART_BODY, 0.6).pyramid([-0.14, 0.86, 0.2, 0.14, 0.86, 0.2, 0.09, 1.2, 0.42, -0.09, 1.2, 0.42], 0, 1.02, 0.95);
  m.set(PART_ARM_A, 0.08, 0.16, 1.2, 0.3).limb(0.16, 1.2, 0.3, 0.17, 0.88, -0.35, 0.06, 0.05);
  m.set(PART_CROWN, 0, 0, 1.5, 0.55).spike(0.07, 1.48, 0.53, 0.056, 0.352, 0.04, -0.04).spike(-0.07, 1.48, 0.53, 0.056, 0.352, -0.04, -0.04);
  return m.geometry();
}

/**
 * Squat with something raised to throw, 1.9 m: a wide low body with a pale belly and a grin, eyes
 * on top, one stubby arm and the other up over its head holding the ball.
 */
export function lobberGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_LOBBER));
  m.set(PART_LEG_A, -0.5, 0.32, 0.3, 0).block(0, 0.32, 0.2, 0.26, 0.17, 0.2, 0, 0.04, 0.32);
  m.set(PART_LEG_B, -0.5, -0.32, 0.3, 0).block(0, 0.32, 0.2, 0.26, 0.17, 0.2, 0, 0.04, -0.32);
  m.set(PART_BODY, 0).block(0.25, 1.05, 0.6, 0.5, 0.45, 0.38);
  m.set(PART_BODY, 0.45).block(0.32, 0.82, 0.42, 0.06, 0.36, 0.06, 0, 0.46);
  m.set(PART_BODY, DARK).block(0.86, 0.92, 0.22, 0.05, 0.26, 0.05, 0, 0.42);
  m.set(PART_BODY, EYE).octa(0.2, 1.04, 0.33, 0.09, 0.1, 0.07).octa(-0.2, 1.04, 0.33, 0.09, 0.1, 0.07);
  m.set(PART_ACT, 0.08, 0.38, 1.0, -0.05).limb(0.38, 1.0, -0.05, 0.3, 1.58, -0.15, 0.1, 0.08);
  m.set(PART_ACT, -0.35, 0.38, 1.0, -0.05).octa(0.3, 1.72, -0.15, 0.18, 0.18, 0.18);
  m.set(PART_BODY, 0.08).limb(-0.55, 0.85, 0, -0.66, 0.5, 0.2, 0.1, 0.08);
  m.set(PART_CROWN, 0, 0, 1.05, 0).spike(-0.12, 1.03, -0.1, 0.084, 0.416).spike(-0.32, 1.03, -0.1, 0.07, 0.32, -0.04);
  return m.geometry();
}

/** Wide and low, 1.1 m: a mound with bubbles in it, a drooping mouth and two eyes up on stalks. */
export function sludgeGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_SLUDGE));
  m.set(PART_BODY, -0.15).prism(8, 0.98, 0.88, 0, 0.45, false, false);
  m.set(PART_BODY, 0.05).prism(8, 0.88, 0.48, 0.45, 0.92, false, false, 0, 0.06);
  m.set(PART_BODY, 0.08).cone(8, 0.48, 0.92, 1.06, 0, 0.06);
  m.set(PART_BODY, 0.3).octa(0.72, 0.4, -0.3, 0.2, 0.18, 0.2).octa(-0.6, 0.62, -0.4, 0.16, 0.14, 0.16);
  m.set(PART_BODY, DARK).block(0.3, 0.5, 0.3, 0.06, 0.22, 0.06, 0.05, 0.86);
  for (const side of [1, -1]) {
    m.set(PART_HEAD, 0.1, 0, 0.8, 0.36).limb(side * 0.2, 0.78, 0.36, side * 0.27, 0.96, 0.42, 0.05, 0.04, 3);
    m.set(PART_HEAD, EYE, 0, 0.8, 0.36).octa(side * 0.27, 1.0, 0.44, 0.1, 0.1, 0.09);
  }
  m.set(PART_CROWN, 0, 0, 1.0, 0).spike(0, 1.0, -0.1, 0.098, 0.448).spike(0.2, 0.96, -0.12, 0.084, 0.352, 0.05).spike(-0.2, 0.96, -0.12, 0.084, 0.352, -0.05);
  return m.geometry();
}

/** Small and spiky, 0.7 m: a spiked ball with two beady eyes, carried on six splayed legs. */
export function clingerGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_CLINGER));
  const c = CLINGER_MID;
  const r = 0.17;
  const v = [0, c + r, 0, 0, c - r, 0, r, c, 0, -r, c, 0, 0, c, r, 0, c, -r];
  const spike = 0.3;
  for (let f = 0; f < OCTA_FACES.length; f += 3) {
    const a = OCTA_FACES[f] * 3;
    const b = OCTA_FACES[f + 1] * 3;
    const d = OCTA_FACES[f + 2] * 3;
    let mx = (v[a] + v[b] + v[d]) / 3;
    let my = (v[a + 1] + v[b + 1] + v[d + 1]) / 3 - c;
    let mz = (v[a + 2] + v[b + 2] + v[d + 2]) / 3;
    const l = Math.sqrt(mx * mx + my * my + mz * mz);
    mx = (mx / l) * spike;
    my = (my / l) * spike;
    mz = (mz / l) * spike;
    // The face pulled out to a point: three sides, facing away from the ball's middle.
    m.set(PART_BODY, my < 0 ? -0.3 : 0).hull([v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[d], v[d + 1], v[d + 2], mx, c + my, mz], [0, 1, 3, 1, 2, 3, 2, 0, 3], [0, c, 0]);
  }
  m.set(PART_BODY, 0.2).spike(0, c + 0.1, -0.02, 0.06, 0.25, 0, -0.06);
  m.set(PART_BODY, EYE).octa(0.08, c + 0.07, 0.17, 0.05, 0.06, 0.04).octa(-0.08, c + 0.07, 0.17, 0.05, 0.06, 0.04);
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const z = (k - 1) * 0.16;
      const part = (k === 1) === side > 0 ? PART_LEG_A : PART_LEG_B;
      m.set(part, -0.4, side * 0.1, c, z).limb(side * 0.1, c, z, side * 0.33, 0.02, z * 1.6, 0.035, 0.02, 3);
    }
  }
  m.set(PART_CROWN, 0, 0, c + 0.15, 0).spike(0.1, c + 0.12, 0, 0.056, 0.32, 0.06).spike(-0.1, c + 0.12, 0, 0.056, 0.32, -0.06);
  return m.ground().geometry();
}

/**
 * The Bruiser, 2.6 m and 4 m across its horns: a bull on four legs under a great hump, its head held
 * low in front between two wide horns, glaring eyes under heavy brows, a tail behind.
 */
export function bruiserGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_BRUISER));
  // Legs: front left with back right (A), back left (B), front right paws (ACT).
  const legs: [number, number, number][] = [
    [0.95, 0.75, PART_LEG_A],
    [-0.95, 0.75, PART_ACT],
    [0.95, -0.85, PART_LEG_B],
    [-0.95, -0.85, PART_LEG_A],
  ];
  for (const [x, z, part] of legs) {
    m.set(part, -0.2, x, 1.0, z).block(0.22, 1.1, 0.34, 0.36, 0.42, 0.44, 0, z, x);
    m.set(part, -0.72, x, 1.0, z).block(0, 0.26, 0.36, 0.38, 0.33, 0.35, 0.02, z + 0.02, x);
  }
  m.set(PART_BODY, 0).block(0.85, 2.05, 1.35, 1.15, 1.5, 1.0, 0.3, -0.1);
  m.set(PART_BODY, -0.35).block(0.78, 1.15, 1.1, 0.95, 1.3, 1.05, 0.05, -0.1);
  m.set(PART_BODY, 0.12).block(1.9, 2.6, 1.15, 0.75, 0.6, 0.4, 0.25, 0.4);
  m.set(PART_BODY, -0.1).block(1.0, 1.95, 1.15, 0.4, 1.05, 0.35, 0, -1.1);
  m.set(PART_BODY, -0.2).limb(0, 1.85, -1.4, 0, 1.0, -1.55, 0.08, 0.06, 3);
  m.set(PART_BODY, -0.6).octa(0, 0.92, -1.55, 0.13, 0.16, 0.1);
  // The head, down and forward, with everything on it nodding together about the neck.
  const nx = 0;
  const ny = 1.55;
  const nz = 1.35;
  m.set(PART_HEAD, 0.05, nx, ny, nz).block(0.75, 1.7, 0.62, 0.52, 0.52, 0.45, 0.12, 1.9);
  m.set(PART_HEAD, 0.35, nx, ny, nz).block(0.72, 1.18, 0.44, 0.28, 0.4, 0.26, 0.06, 2.45);
  m.set(PART_HEAD, DARK, nx, ny, nz).box(0.17, 1.02, 2.73, 0.07, 0.07, 0.03).box(-0.17, 1.02, 2.73, 0.07, 0.07, 0.03);
  m.set(PART_HEAD, EYE, nx, ny, nz).octa(0.32, 1.4, 2.45, 0.15, 0.11, 0.09).octa(-0.32, 1.4, 2.45, 0.15, 0.11, 0.09);
  m.set(PART_HEAD, -0.55, nx, ny, nz).box(0.32, 1.54, 2.46, 0.2, 0.05, 0.08, -0.3).box(-0.32, 1.54, 2.46, 0.2, 0.05, 0.08, 0.3);
  // Horns: out from the sides of the head, then forward and up to a point. The right one breaks off.
  for (const side of [1, -1]) {
    const part = side > 0 ? PART_HEAD : PART_INTACT;
    m.set(part, 0.72, nx, ny, nz).limb(side * 0.45, 1.5, 2.0, side * 1.4, 1.62, 2.25, 0.17, 0.13);
    m.set(part, 0.82, nx, ny, nz).pyramid(
      [side * 1.32, 1.5, 2.15, side * 1.48, 1.5, 2.15, side * 1.48, 1.74, 2.35, side * 1.32, 1.74, 2.35],
      side * 2.0,
      2.05,
      2.95,
    );
  }
  m.set(PART_SCAR, 0.5, nx, ny, nz).limb(-0.45, 1.5, 2.0, -0.95, 1.56, 2.12, 0.17, 0.15);
  m.set(PART_SCAR, 0.75).box(1.38, 1.5, 0.2, 0.08, 0.32, 0.05, 0.4).box(-1.4, 1.35, -0.4, 0.08, 0.36, 0.05, -0.3).box(0.6, 2.2, 0.4, 0.05, 0.25, 0.25, 0.6);
  return m.geometry();
}

/**
 * The Mortar, 2.8 m: a drum on four stubby legs, glaring out of its front, a turret on top with a
 * tube standing up out of it and a flared, dark-mouthed muzzle; spare shells strapped to its back.
 */
export function mortarGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_MORTAR));
  for (const [x, z, part] of [
    [0.95, 0.95, PART_LEG_A],
    [-0.95, -0.95, PART_LEG_A],
    [-0.95, 0.95, PART_LEG_B],
    [0.95, -0.95, PART_LEG_B],
  ]) {
    m.set(part, -0.5, x, 0.55, z).block(0, 0.6, 0.32, 0.32, 0.26, 0.26, 0, z, x);
  }
  m.set(PART_BODY, -0.3).prism(10, 1.45, 1.72, 0.35, 0.58, true, false);
  m.set(PART_BODY, 0).prism(10, 1.72, 1.5, 0.55, 1.55, false, true);
  m.set(PART_BODY, -0.42).prism(10, 1.8, 1.77, 0.72, 0.95, false, false);
  m.set(PART_BODY, 0.15).prism(10, 1.08, 0.8, 1.52, 1.95, false, true);
  m.set(PART_ACT, -0.18, 0, 1.6, 0).prism(10, 0.55, 0.55, 1.6, 2.55, false, false);
  m.set(PART_ACT, 0.1, 0, 1.6, 0).prism(10, 0.62, 0.8, 2.52, 2.8, false, false);
  m.set(PART_ACT, DARK, 0, 1.6, 0).prism(10, 0.72, 0.72, 2.6, 2.78, false, true);
  m.set(PART_BODY, EYE).octa(0.46, 1.2, 1.52, 0.27, 0.2, 0.12).octa(-0.46, 1.2, 1.52, 0.27, 0.2, 0.12);
  m.set(PART_BODY, DARK).octa(0.42, 1.18, 1.62, 0.1, 0.1, 0.05).octa(-0.42, 1.18, 1.62, 0.1, 0.1, 0.05);
  m.set(PART_BODY, DARK).box(0.46, 1.45, 1.48, 0.3, 0.06, 0.09, -0.3).box(-0.46, 1.45, 1.48, 0.3, 0.06, 0.09, 0.3);
  m.set(PART_BODY, 0.5).prism(6, 0.2, 0.2, 1.55, 2.15, false, true, 0.45, -1.0);
  m.set(PART_INTACT, 0.5).prism(6, 0.2, 0.2, 1.55, 2.15, false, true, -0.45, -1.0);
  m.set(PART_SCAR, 0.75).box(1.25, 1.1, 0.95, 0.06, 0.3, 0.2, 0.9).box(-1.35, 1.0, -0.6, 0.06, 0.34, 0.2, -1.1).box(0.2, 1.75, -0.9, 0.3, 0.06, 0.2, 0.3);
  return m.geometry();
}

/**
 * The Standstill, 7 m: a stepped plinth, a tall slab narrowing as it rises with ridges up its edges
 * and a point on top, lines of light down its front, one great eye, and two plates over a glowing
 * core. Three shards circle its top.
 */
export function standstillGeometry(): BufferGeometry {
  const m = new Model(kindColor(KIND_STANDSTILL));
  m.set(PART_BODY, -0.4).block(0, 0.5, 2.9, 2.9, 2.7, 2.7);
  m.set(PART_BODY, -0.25).block(0.48, 0.85, 2.3, 2.0, 2.1, 1.85);
  m.set(PART_BODY, 0).block(0.85, 6.2, 1.7, 0.9, 1.3, 0.7);
  m.set(PART_BODY, -0.18).block(0.85, 6.0, 0.22, 0.95, 0.18, 0.75, 0, 0, 1.58).block(0.85, 6.0, 0.22, 0.95, 0.18, 0.75, 0, 0, -1.58);
  m.set(PART_INTACT, 0.1).pyramid([-1.2, 6.18, -0.65, 1.2, 6.18, -0.65, 1.2, 6.18, 0.65, -1.2, 6.18, 0.65], 0, 7, 0);
  m.set(PART_SCAR, -0.3).pyramid([-1.2, 6.18, -0.65, 1.2, 6.18, -0.65, 1.2, 6.18, 0.65, -1.2, 6.18, 0.65], 0.6, 6.55, 0.2);
  // The lines of light, above the eye.
  m.set(PART_BODY, 0.6).box(0, 5.55, 0.79, 0.7, 0.06, 0.04).box(-0.55, 5.1, 0.82, 0.06, 0.32, 0.04).box(0.55, 5.1, 0.82, 0.06, 0.32, 0.04);
  // The eye: a dark socket, the eyeball, and an iris that turns to follow the rider.
  m.set(PART_BODY, DARK).block(3.65, 4.75, 0.95, 0.08, 0.9, 0.08, 0, 0.8);
  m.set(PART_ACT, EYE, 0, 4.2, 0.86).octa(0, 4.2, 0.86, 0.66, 0.44, 0.26);
  m.set(PART_ACT, DARK, 0, 4.2, 0.86).octa(0, 4.2, 1.1, 0.24, 0.26, 0.12);
  // The core behind the plates, and the plates, hinged at their outer edges.
  m.set(PART_BODY, 0.85).block(1.4, 3.3, 0.85, 0.06, 0.8, 0.06, 0, 0.88);
  for (const side of [1, -1]) {
    const part = side > 0 ? PART_PLATE_A : PART_PLATE_B;
    const hinge = side * 1.2;
    m.set(part, -0.12, hinge, 2.4, 1.0).block(1.25, 3.5, 0.57, 0.09, 0.53, 0.09, 0, 0.98, side * 0.61);
    m.set(part, 0.55, hinge, 2.4, 1.0).box(side * 0.6, 2.4, 1.08, 0.08, 0.7, 0.03);
  }
  // Shards circling the top.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    m.set(PART_HEAD, 0.4, 0, 6.2, 0).octa(Math.sin(a) * 2.0, 6.0 + k * 0.25, Math.cos(a) * 2.0, 0.18, 0.32, 0.18);
  }
  m.set(PART_SCAR, DARK).box(0.9, 2.8, 0.78, 0.05, 0.6, 0.04, 0.4).box(-0.7, 5.0, 0.76, 0.06, 0.5, 0.04, -0.5).box(1.4, 1.2, 0.5, 0.05, 0.4, 0.4);
  return m.geometry();
}

/** The shape of each kind, by KIND_*. */
export function geometryFor(kind: number): BufferGeometry {
  if (kind === KIND_SHUFFLER) return shufflerGeometry();
  if (kind === KIND_GNAT) return gnatGeometry();
  if (kind === KIND_BOLLARD) return bollardGeometry();
  if (kind === KIND_CUTTER) return cutterGeometry();
  if (kind === KIND_LOBBER) return lobberGeometry();
  if (kind === KIND_SLUDGE) return sludgeGeometry();
  if (kind === KIND_CLINGER) return clingerGeometry();
  if (kind === KIND_BRUISER) return bruiserGeometry();
  if (kind === KIND_MORTAR) return mortarGeometry();
  if (kind === KIND_STANDSTILL) return standstillGeometry();
  throw new Error(`no shape for enemy kind ${kind}`);
}

function wobbleFor(kind: number): Wobble {
  return kind < WOBBLE.length ? WOBBLE[kind] : WOBBLE[KIND_SHUFFLER];
}

function gaitFor(kind: number): Gait {
  return kind < GAIT.length ? GAIT[kind] : GAIT[KIND_SHUFFLER];
}

// ---- material -------------------------------------------------------------------------------

/**
 * Each kind's own motion, in GLSL, run after the generic swing of legs and arms. In scope: `part`,
 * `piv` (the part's pivot), `moving` (0..1, how much of its motion it shows), `gs` (the sine of its
 * gait), `ph` (its phase, 0..1) and `aPose` (crown, action, state, damage).
 */
const KIND_MOTION: readonly string[] = [
  // Shuffler: pitches forward on every step and limps to one side.
  [
    'transformed = rotX(transformed, vec3(0.0), (0.08 + 0.1 * abs(gs)) * moving);',
    'transformed = rotZ(transformed, vec3(0.0), 0.07 * gs * moving);',
  ].join('\n'),
  // Gnat: the wings buzz.
  [
    'if (part > 2.5 && part < 4.5) {',
    '  float side = part < 3.5 ? 1.0 : -1.0;',
    '  transformed = rotZ(transformed, piv, side * 0.75 * sin(uTime * 46.0 + ph * 6.2831853));',
    '}',
  ].join('\n'),
  // Bollard: rocks from foot to foot.
  'transformed = rotZ(transformed, vec3(0.0), 0.1 * gs * moving);',
  // Cutter: rocks from blade to blade, low.
  'transformed = rotZ(transformed, vec3(0.0), 0.13 * gs * moving);',
  // Lobber: the arm winds back before a lob and swings through after; the body leans with it.
  [
    'if (part > 6.5 && part < 7.5) transformed = rotX(transformed, piv, -1.15 * aPose.y + 1.7 * aPose.z);',
    'transformed = rotX(transformed, vec3(0.0), -0.14 * aPose.y + 0.16 * aPose.z);',
  ].join('\n'),
  // Sludge: squashes and stretches, the front reaching ahead as it moves; the eyes sway.
  [
    'float sq = sin(uTime * 2.3 + ph * 6.2831853);',
    'if (part > 5.5 && part < 6.5) transformed = rotZ(transformed, piv, 0.25 * sin(uTime * 3.1 + ph * 9.0));',
    'transformed.y *= 1.0 + 0.11 * sq;',
    'transformed.xz *= 1.0 - 0.055 * sq;',
    'transformed.z += max(transformed.z, 0.0) * (0.12 + 0.18 * sq) * moving;',
  ].join('\n'),
  // Clinger: the legs scuttle; holding on, they kick, wider and faster.
  [
    'if (part > 0.5 && part < 2.5) {',
    '  float side = part < 1.5 ? 1.0 : -1.0;',
    '  float rate = mix(14.0, 24.0, aPose.z);',
    '  float amp = mix(0.15 + 0.3 * moving, 0.75, aPose.z);',
    '  transformed = rotX(transformed, piv, side * amp * sin(uTime * rate + ph * 6.2831853));',
    '}',
  ].join('\n'),
  // Bruiser: in its tell the head drops, the body leans in and the front right leg paws; charging,
  // it stretches long and low.
  [
    'if ((part > 5.5 && part < 6.5) || part > 9.5) transformed = rotX(transformed, piv, 0.38 * aPose.y - 0.1 * aPose.z);',
    'if (part > 6.5 && part < 7.5) transformed = rotX(transformed, piv, -uGait.x * gs * swing - 0.8 * aPose.y * max(0.0, sin(uTime * 11.0)));',
    'transformed = rotX(transformed, vec3(0.0), 0.07 * aPose.y);',
    'transformed.z *= 1.0 + 0.32 * aPose.z;',
    'transformed.y *= 1.0 - 0.12 * aPose.z;',
    'transformed.x *= 1.0 - 0.06 * aPose.z;',
  ].join('\n'),
  // Mortar: the tube kicks down into the drum and the drum squats.
  [
    'if (part > 6.5 && part < 7.5) transformed.y -= 0.6 * aPose.y;',
    'else transformed.y *= 1.0 - 0.07 * aPose.y;',
    'transformed.xz *= 1.0 + 0.03 * aPose.y;',
  ].join('\n'),
  // Standstill: the eye follows the rider, the plates swing open about their hinges, the shards
  // circle; damaged, it lists.
  [
    'if (part > 6.5 && part < 7.5) transformed = rotY(transformed, piv, aPose.z);',
    'if (part > 7.5 && part < 8.5) transformed = rotY(transformed, piv, 1.1 * aPose.y);',
    'if (part > 8.5 && part < 9.5) transformed = rotY(transformed, piv, -1.1 * aPose.y);',
    'if (part > 5.5 && part < 6.5) {',
    '  transformed = rotY(transformed, vec3(0.0), uTime * 0.7);',
    '  transformed.y += 0.25 * sin(uTime * 1.7 + transformed.x);',
    '}',
    'transformed = rotZ(transformed, vec3(0.0), 0.05 * aPose.w);',
  ].join('\n'),
];

const GLSL_ROTATE = [
  'vec3 rotX(vec3 v, vec3 p, float a) { v -= p; float c = cos(a); float s = sin(a); return p + vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }',
  'vec3 rotY(vec3 v, vec3 p, float a) { v -= p; float c = cos(a); float s = sin(a); return p + vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }',
  'vec3 rotZ(vec3 v, vec3 p, float a) { v -= p; float c = cos(a); float s = sin(a); return p + vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }',
].join('\n');

/** Uniforms every enemy material shares: the clock and the crown colours. */
interface Shared {
  time: { value: number };
  crowns: { value: Vector3[] };
}

/**
 * How strongly each flashing enemy flashes when `n` of the `count` in `flash` are flashing this
 * frame: fully up to `FLASH_CROWD`, then `FLASH_CROWD / n`, never under `FLASH_FLOOR`.
 */
export function crowdFlash(flash: ArrayLike<number>, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (flash[i] > 0) n++;
  return n <= FLASH_CROWD ? 1 : Math.max(FLASH_FLOOR, FLASH_CROWD / n);
}

/**
 * The flat material, with the parts' motion and the wobble in the vertex shader and the baked tones,
 * glow and hit flash in the fragment shader.
 */
function enemyMaterial(kind: number, shared: Shared): MeshLambertMaterial {
  const color = kindColor(kind);
  const m = flatMaterial(color);
  m.emissive.setHex(color);
  m.emissiveIntensity = ENEMY_GLOW;
  const w = wobbleFor(kind);
  const g = gaitFor(kind);
  const wobble = { value: new Vector4(w.hop, w.rate, w.sway, w.idle) };
  const gait = { value: new Vector4(g.leg, g.arm, g.rate, g.still) };
  const flash = { value: new Color(PALETTE.enemyFlash) };
  const glow = { value: ENEMY_GLOW };
  const motion = kind < KIND_MOTION.length ? KIND_MOTION[kind] : '';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uCrown = shared.crowns;
    shader.uniforms.uWobble = wobble;
    shader.uniforms.uGait = gait;
    shader.uniforms.uFlashColor = flash;
    shader.uniforms.uGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute vec3 aAnim;',
          'attribute vec4 aPose;',
          'attribute vec3 aTint;',
          'attribute vec4 aRig;',
          'uniform float uTime;',
          'uniform vec4 uWobble;',
          'uniform vec4 uGait;',
          'uniform vec3 uCrown[4];',
          'varying float vFlash;',
          'varying vec3 vTint;',
          GLSL_ROTATE,
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float part = aRig.w;',
          'vec3 piv = aRig.xyz;',
          'float ph = aAnim.x;',
          'float moving = clamp(aAnim.y, 0.0, 1.0);',
          'float swing = mix(uGait.w, 1.0, moving);',
          'float gs = sin((uTime * uGait.z * (1.0 + 1.5 * aPose.z) + ph) * 6.2831853);',
          'vTint = aTint;',
          'if (part > 0.5 && part < 2.5) {',
          '  transformed = rotX(transformed, piv, (part < 1.5 ? 1.0 : -1.0) * uGait.x * gs * swing);',
          '} else if (part > 2.5 && part < 4.5) {',
          '  transformed = rotX(transformed, piv, (part < 3.5 ? -1.0 : 1.0) * uGait.y * gs * swing);',
          '} else if (part > 4.5 && part < 5.5) {',
          '  if (aPose.x < -0.5) transformed = piv;',
          '  else vTint = aTint * uCrown[int(aPose.x + 0.5)];',
          '} else if (part > 9.5 && part < 10.5) {',
          '  if (aPose.w > 0.5) transformed = piv;',
          '} else if (part > 10.5) {',
          '  if (aPose.w < 0.5) transformed = piv;',
          '}',
          'if (part < 10.5) vTint *= 1.0 - 0.28 * aPose.w;',
          motion,
          'float wPh = (uTime * uWobble.y + ph) * 6.2831853;',
          'float wAmt = mix(uWobble.w, 1.0, moving);',
          'float wS = sin(wPh);',
          'transformed.y += abs(wS) * uWobble.x * wAmt;',
          'transformed.x += wS * uWobble.z * position.y * wAmt;',
          'vFlash = aAnim.z;',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFlashColor;\nuniform float uGlow;\nvarying float vFlash;\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vTint;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance = vTint * uGlow;',
          'diffuseColor.rgb = mix(diffuseColor.rgb, uFlashColor, vFlash);',
          'totalEmissiveRadiance = mix(totalEmissiveRadiance, uFlashColor, vFlash);',
        ].join('\n'),
      );
  };
  // Each kind's shader differs by its motion: without its own key, three would share one program.
  m.customProgramCacheKey = () => `enemy-${kind}`;
  return m;
}

// ---- the view -------------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class HordeView {
  readonly object = new Group();
  /** One per kind, bosses included, indexed by `KIND_*`. */
  readonly meshes: InstancedMesh[] = [];
  readonly shadows: InstancedMesh;
  /** The elites' auras: a ring on the ground at the aura's reach, in the aura's colour. */
  readonly auras: GroundRings;
  /** Seconds, for the motion, and the crowns' colours; shared by every enemy material. */
  private readonly shared: Shared = { time: { value: 0 }, crowns: { value: [] } };
  private readonly anim: InstancedBufferAttribute[] = [];
  private readonly pose: InstancedBufferAttribute[] = [];
  private readonly counts = new Int32Array(KINDS.length);
  /** Linear RGB per aura, by ELITE_*. */
  private readonly auraRgb: Float32Array;

  /** With a terrain, the aura rings follow the ground; without, they lie level at the elite's feet. */
  constructor(terrain: Terrain | null = null) {
    this.object.name = 'horde';
    const shadowMat = flatMaterial(tone(PALETTE.sky, -1));
    shadowMat.transparent = true;
    shadowMat.opacity = SHADOW_OPACITY;
    shadowMat.depthWrite = false;
    shadowMat.polygonOffset = true;
    shadowMat.polygonOffsetFactor = -2;
    shadowMat.polygonOffsetUnits = -2;
    const shadowGeo = new CircleGeometry(1, SHADOW_SEGMENTS);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(shadowGeo, shadowMat, MAX_ENEMIES);
    this.shadows.name = 'horde-shadows';
    this.prepare(this.shadows);
    this.shadows.renderOrder = 1;
    this.object.add(this.shadows);

    const auras = auraColors();
    this.auraRgb = new Float32Array(auras.length * 3);
    for (let a = 0; a < auras.length; a++) {
      rgbInto(this.auraRgb, a * 3, auras[a]);
      this.shared.crowns.value.push(new Vector3(this.auraRgb[a * 3], this.auraRgb[a * 3 + 1], this.auraRgb[a * 3 + 2]));
    }

    for (let k = 0; k < KINDS.length; k++) {
      const geo = geometryFor(k);
      const anim = new InstancedBufferAttribute(new Float32Array(MAX_ENEMIES * 3), 3);
      anim.setUsage(DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const pose = new InstancedBufferAttribute(new Float32Array(MAX_ENEMIES * 4), 4);
      pose.setUsage(DynamicDrawUsage);
      geo.setAttribute('aPose', pose);
      const mesh = new InstancedMesh(geo, enemyMaterial(k, this.shared), MAX_ENEMIES);
      mesh.name = `horde-${KINDS[k].name}`;
      this.prepare(mesh);
      this.meshes.push(mesh);
      this.anim.push(anim);
      this.pose.push(pose);
      this.object.add(mesh);
    }

    this.auras = new GroundRings(MAX_AURA_RINGS, AURA_SEGMENTS, 'horde-auras', terrain, AURA_LIFT);
    this.object.add(this.auras.mesh);
  }

  private prepare(mesh: InstancedMesh): void {
    // Every slot starts as a pure scale and move (zeros elsewhere, one in the corner and at y), so
    // a frame writes only the entries that change.
    const m = mesh.instanceMatrix.array;
    m.fill(0);
    for (let i = 0; i < MAX_ENEMIES; i++) {
      m[i * 16 + 5] = 1;
      m[i * 16 + 15] = 1;
    }
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
  }

  /**
   * Draw the horde as it stands `alpha` (0..1) of the way from the previous tick to the latest.
   * `time` is in seconds; (mx, my, mz) is the mover as drawn, which standing enemies turn to face and
   * latched clingers ride, and `heading` the way it faces.
   */
  update(w: World, alpha: number, time: number, mx: number, mz: number, my = 0, heading = 0): void {
    const h = w.horde;
    const back = (1 - alpha) * DT;
    const counts = this.counts;
    counts.fill(0);
    const shadow = this.shadows.instanceMatrix.array;
    this.shared.time.value = time;
    this.auras.begin();
    const hs = Math.sin(heading);
    const hc = Math.cos(heading);
    const flashPeak = crowdFlash(h.flash, h.count);

    for (let i = 0; i < h.count; i++) {
      const k = h.kind[i];
      const def = KINDS[k];
      const n = counts[k]++;
      const vx = h.vx[i];
      const vz = h.vz[i];
      let x = h.x[i] - vx * back;
      let y = h.y[i];
      let z = h.z[i] - vz * back;

      // Facing: +z of the model turned to (sin, cos) = the velocity, or toward the mover.
      let speed = Math.sqrt(vx * vx + vz * vz);
      let s = 0;
      let c = 1;
      const latched = h.state[i] === STATE_LATCHED && def.latches === true;
      if (latched) {
        // On the mover's back, facing out behind it, spread across and up by its phase.
        const ph = h.phase[i];
        const across = (ph - 0.5) * RIDE_SPREAD;
        const up = RIDE_LOW + (RIDE_HIGH - RIDE_LOW) * ((ph * 7.31) % 1);
        x = mx - hs * RIDE_BACK + hc * across;
        y = my + up - CLINGER_MID;
        z = mz - hc * RIDE_BACK - hs * across;
        s = -hs;
        c = -hc;
        speed = 0;
      } else if (speed > STILL_SPEED) {
        s = vx / speed;
        c = vz / speed;
      } else {
        speed = 0;
        const dx = mx - x;
        const dz = mz - z;
        const l = Math.sqrt(dx * dx + dz * dz);
        if (l > 1e-4) {
          s = dx / l;
          c = dz / l;
        }
      }
      const age = h.age[i];
      const rise = age >= SPAWN_TICKS ? 1 : age / SPAWN_TICKS;
      const elite = h.elite[i];
      // An elite is marked as one and carries an aura; either makes it big and crowns it.
      const big = elite !== ELITE_NONE || (h.mark[i] & MARK_ELITE) !== 0;
      const scale = big ? rise * ELITE_SCALE : rise;

      // Only the entries that change: the zeros and the one were laid down in `prepare`.
      const m = this.meshes[k].instanceMatrix.array;
      const o = n * 16;
      m[o] = c * scale;
      m[o + 2] = -s * scale;
      m[o + 5] = scale;
      m[o + 8] = s * scale;
      m[o + 10] = c * scale;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;

      const a = this.anim[k].array as Float32Array;
      const f = h.flash[i];
      let flash = (f >= FLASH_FULL_TICKS ? 1 : f / FLASH_FULL_TICKS) * flashPeak;
      if (big && flash < ELITE_SHEEN) flash = ELITE_SHEEN;
      a[n * 3] = h.phase[i];
      a[n * 3 + 1] = speed / def.speed;
      a[n * 3 + 2] = flash;

      const p = this.pose[k].array as Float32Array;
      const po = n * 4;
      p[po] = big ? elite : -1;
      p[po + 1] = 0;
      p[po + 2] = latched ? 1 : 0;
      p[po + 3] = def.boss === true && h.hp[i] < def.hp * BOSS_DAMAGED ? 1 : 0;
      this.action(k, i, w, p, po, x, z, s, c, mx, mz);

      // A rider casts no shadow of its own: the mover's covers it.
      const r = latched ? 0 : def.radius * SHADOW_SCALE * scale;
      const so = i * 16;
      shadow[so] = r;
      shadow[so + 10] = r;
      shadow[so + 12] = x;
      shadow[so + 13] = y + SHADOW_LIFT;
      shadow[so + 14] = z;

      if (elite === ELITE_HASTE || elite === ELITE_SHIELD || elite === ELITE_JAM) {
        const reach = HORDE.auraReach;
        this.auras.add(x, y, z, reach - AURA_BAND, reach, this.auraRgb, elite * 3, AURA_FADE * rise);
      }
    }

    for (let k = 0; k < KINDS.length; k++) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.visible = counts[k] > 0;
      if (counts[k] > 0) {
        uploadFirst(mesh.instanceMatrix, counts[k]);
        uploadFirst(this.anim[k], counts[k]);
        uploadFirst(this.pose[k], counts[k]);
      }
    }
    this.shadows.count = h.count;
    this.shadows.visible = h.count > 0;
    if (h.count > 0) uploadFirst(this.shadows.instanceMatrix, h.count);
    this.auras.end();
  }

  /**
   * What enemy `i` of kind `k` is doing, into its pose's action (`p[o + 1]`) and state (`p[o + 2]`):
   * the lobber's wind-up and follow-through, the Bruiser's tell and charge, the Mortar's recoil, the
   * Standstill's plates and where its eye looks. It faces (s, c); the mover is at (mx, mz).
   */
  private action(k: number, i: number, w: World, p: Float32Array, o: number, x: number, z: number, s: number, c: number, mx: number, mz: number): void {
    const h = w.horde;
    const t = h.timer[i];
    if (k === KIND_LOBBER) {
      p[o + 1] = clamp01((t - (LOB_EVERY - LOB_WINDUP)) / LOB_WINDUP);
      p[o + 2] = t > 0 && t < LOB_FOLLOW ? 1 - t / LOB_FOLLOW : 0;
    } else if (k === KIND_BRUISER) {
      const st = h.state[i];
      if (st === BRUISER_TELL) p[o + 1] = clamp01((t + 1) / TELL_EASE);
      else if (st === BRUISER_CHARGE) p[o + 2] = clamp01((t + 1) / CHARGE_EASE);
    } else if (k === KIND_MORTAR) {
      const since = t % MORTAR_VOLLEY;
      // A volley goes out each time the timer comes round to a multiple; before the first, none has.
      p[o + 1] = h.age[i] > SPAWN_TICKS && (t >= MORTAR_VOLLEY || h.age[i] >= MORTAR_VOLLEY) && since < RECOIL_TICKS ? 1 - since / RECOIL_TICKS : 0;
    } else if (k === KIND_STANDSTILL) {
      const since = t % STAND_RING;
      let open = 0;
      if (h.age[i] > SPAWN_TICKS) {
        if (since >= STAND_RING - PLATE_EARLY) open = (0.5 * (since - (STAND_RING - PLATE_EARLY))) / PLATE_EARLY;
        else if (since < PLATE_OPEN) open = 0.5 + (0.5 * since) / PLATE_OPEN;
        else if (since < PLATE_OPEN + PLATE_CLOSE) open = 1 - (since - PLATE_OPEN) / PLATE_CLOSE;
      }
      p[o + 1] = open;
      // The eye turns toward the mover, in the model's own frame (+x is (c, -s), +z is (s, c)).
      const dx = mx - x;
      const dz = mz - z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      let yaw = Math.atan2(lx, lz);
      if (yaw > EYE_TURN) yaw = EYE_TURN;
      else if (yaw < -EYE_TURN) yaw = -EYE_TURN;
      p[o + 2] = yaw;
    }
  }
}
