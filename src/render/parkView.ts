/**
 * The park: what makes the bowl a place, and the paint on its furniture. Nothing here collides or
 * is read by the sim; all of it is drawn from the terrain and the map's seed, so a seed always looks
 * the same.
 *
 * - The dressing, all of it outside the rideable radius (on and beyond the rim's lip): a deck round
 *   the lip; a fence of wall panels with posts between them (a rhythm that ticks past at speed) and
 *   blocks of colour sprayed on their inner face; floodlight towers with glowing heads; bleachers
 *   with a crowd; billboards with lit stripes; and a skyline of tall dark blocks with a band of light
 *   each beyond the rim. All of it is dim: silhouettes with a little light (`LIGHT_DIM`,
 *   `LIGHT_GLOW`), quieter than anything in the bowl, so the top of the screen does not pull the eye
 *   from the fight. What must read from across the bowl (the lamps on the fence posts, the
 *   floodlights, the billboards and the skyline, dark shapes with lit parts) is a second
 *   instanced mesh drawn without fog: the camera sees the rim's lip only from far across the bowl,
 *   where the fog has nearly taken everything else, and silhouettes and lights there still say where
 *   the edge is and that it is a place. Both built once.
 * - The decals, lifted a few centimetres over the ground: chevrons on each boost pad pointing down
 *   its fall line (the way a rider crossing it mostly goes; the boost itself is along the rider's
 *   own heading) that light one after another along it; on each kicker, stripes up both edges of
 *   the ramp that trace its profile from the side, a bright band at the lip it launches from, and
 *   two chevrons up its face; and along every rail a glow that shows only on the rail being ground,
 *   brightest round the board. One mesh, built once; per frame only three uniforms change.
 *
 * Three draw calls.
 */
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  type MeshLambertMaterial,
} from 'three';
import type { Bowl } from '../sim/bowl';
import { hashString, Rng } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { addInstanceFloat, fadeMaterial, rgbInto, tintMaterial, writeMatrix } from './fxView';
import { PALETTE, tone } from './look';

/** Dressing stands no nearer the middle than this beyond the terrain's radius, m. */
export const DRESS_CLEAR = 0.5;
/** The fence: panel width, height above the lip, how far below it the panel reaches, depth, m. */
const PANEL_WIDE = 7;
const PANEL_HIGH = 2.4;
const PANEL_SINK = 2;
const PANEL_DEEP = 0.5;
/** The fence's inner face, m beyond the radius. */
const FENCE_IN = 1.2;
const DECK_SEGMENTS = 40;
const DECK_DEEP = 46;
const TOWERS = 8;
const BLEACHERS = 3;
const BLEACHER_STEPS = 5;
const BLEACHER_WIDE = 18;
const CROWD_PER_STEP = 7;
const SIGNS = 6;
/** Blocks in the skyline: close enough together to stand as one dark wall of city round the bowl. */
const SKYLINE = 44;
/**
 * The scenery's lights (fence lamps, floodlight heads, billboard stripes, the skyline's bands): a
 * darker tone of their colour and a little glow, so they are silhouettes with a little light,
 * dimmer than anything in the bowl, and never outshine an enemy below them.
 */
export const LIGHT_DIM = -0.45;
export const LIGHT_GLOW = 0.3;
/** Upper bound on the dressing's boxes, for the instanced mesh. */
export const MAX_DRESSING = 1400;
export const MAX_UNFOGGED = 360;

/** Decal heights over the ground, m. */
const DECAL_LIFT = 0.1;
/** Pad chevrons: how many, their arm length and width, m. */
export const PAD_CHEVRONS = 3;
const PAD_ARM = 1.25;
const PAD_ARM_WIDE = 0.38;
/** Kicker marks: the core half-width of a kicker's ramp (KICK_CORE in the bowl), the ramp's start and the lip, m from the crest. */
const KICK_EDGE = 2.4;
const KICK_FROM = -11;
const KICK_LIP = 1.0;
const KICK_STRIPE = 0.32;
const KICK_SEGMENTS = 14;
/** The grind glow: its size round the bar, segments per rail, and how far the hot spot reaches, m. */
const GLOW_SIZE = 0.6;
const GLOW_SEGMENTS = 10;
export const GLOW_REACH = 5;
/** How fast the chevrons' light runs along them, cycles per second. */
const FLOW_RATE = 1.4;

/** The rail none is: what `uRail` holds while no rail is ground. */
export const NO_RAIL = -1;

function isBowl(t: Terrain): t is Bowl {
  return 'features' in t;
}

/** A growing set of triangles with the decal attributes. */
class Decals {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly fade: number[] = [];
  readonly flow: number[] = [];
  readonly rail: number[] = [];

  vertex(x: number, y: number, z: number, rgb: Float32Array, fade: number, flow: number, rail: number, along: number): void {
    this.pos.push(x, y, z);
    this.col.push(rgb[0], rgb[1], rgb[2]);
    this.fade.push(fade);
    this.flow.push(flow);
    this.rail.push(rail, along);
  }

  /** A quad a b c d (in order round it), facing up when they go anticlockwise seen from above. */
  quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    rgb: Float32Array, fade: number, flow = -1, rail = NO_RAIL, a0 = 0, a1 = 0,
  ): void {
    this.vertex(ax, ay, az, rgb, fade, flow, rail, a0);
    this.vertex(bx, by, bz, rgb, fade, flow, rail, a1);
    this.vertex(cx, cy, cz, rgb, fade, flow, rail, a1);
    this.vertex(ax, ay, az, rgb, fade, flow, rail, a0);
    this.vertex(cx, cy, cz, rgb, fade, flow, rail, a1);
    this.vertex(dx, dy, dz, rgb, fade, flow, rail, a0);
  }

  get triangles(): number {
    return this.pos.length / 9;
  }
}

/** Boxes in one instanced mesh, written once while the park is built. */
class BoxSet {
  readonly mesh: InstancedMesh;
  private readonly rgb: Float32Array;
  private readonly glow: InstancedBufferAttribute;
  n = 0;

  constructor(name: string, capacity: number, fog: boolean) {
    const box = new BoxGeometry(1, 1, 1);
    this.glow = addInstanceFloat(box, 'aGlow', capacity);
    const mat = tintMaterial();
    mat.fog = fog;
    this.mesh = new InstancedMesh(box, mat, capacity);
    this.mesh.name = name;
    this.rgb = new Float32Array(capacity * 3);
    this.mesh.instanceColor = new InstancedBufferAttribute(this.rgb, 3);
  }

  /** One box at (x, y, z) sized (sx, sy, sz), turned to `yaw` (its local z = (sin yaw, 0, cos yaw)). */
  box(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, color: number, glow: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    const i = this.n++;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    writeMatrix(this.mesh.instanceMatrix.array, i, c * sx, 0, -s * sx, 0, sy, 0, s * sz, 0, c * sz, x, y, z);
    rgbInto(this.rgb, i * 3, color);
    (this.glow.array as Float32Array)[i] = glow;
  }

  /**
   * A box standing at angle `a` round the bowl (0 = +z, growing toward +x), `r` from the middle, its
   * width across the radius, its depth along it, from y0 to y1, facing the middle.
   */
  ringBox(a: number, r: number, wide: number, deep: number, y0: number, y1: number, color: number, glow: number): void {
    // Local z points out along the radius: yaw = a.
    this.box(Math.sin(a) * r, (y0 + y1) / 2, Math.cos(a) * r, a, wide, y1 - y0, deep, color, glow);
  }

  finish(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.computeBoundingSphere();
  }
}

export class ParkView {
  readonly object = new Group();
  /** The dressing's near boxes (fogged), and its lights and far silhouettes (not fogged, so they read across the bowl). */
  readonly dressing: InstancedMesh;
  readonly unfogged: InstancedMesh;
  readonly decals: Mesh;
  /** The uniforms the decals animate by: seconds, the rail being ground and how far along it, m. */
  readonly uTime = { value: 0 };
  readonly uRail = { value: NO_RAIL };
  readonly uRailM = { value: 0 };
  /** Boxes in the dressing and its lights, triangles in the decals. */
  readonly dressingCount: number;
  readonly unfoggedCount: number;
  readonly decalTriangles: number;
  private readonly railLength: Float32Array;
  private readonly railCount: number;

  constructor(terrain: Terrain, seed: number) {
    this.object.name = 'park';
    const solid = new BoxSet('park-dressing', MAX_DRESSING, true);
    const clear = new BoxSet('park-unfogged', MAX_UNFOGGED, false);
    this.dress(terrain, new Rng(hashString('park', seed)), solid, clear);
    solid.finish();
    clear.finish();
    this.dressing = solid.mesh;
    this.unfogged = clear.mesh;
    this.dressingCount = solid.n;
    this.unfoggedCount = clear.n;

    const rails = terrain.rails;
    this.railCount = rails.length;
    this.railLength = new Float32Array(Math.max(1, rails.length));
    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      this.railLength[i] = Math.hypot(r.x1 - r.x0, r.y1 - r.y0, r.z1 - r.z0);
    }
    const d = new Decals();
    this.paint(terrain, d);
    this.decalTriangles = d.triangles;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(d.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(d.col, 3));
    g.setAttribute('aFade', new Float32BufferAttribute(d.fade, 1));
    g.setAttribute('aFlow', new Float32BufferAttribute(d.flow, 1));
    g.setAttribute('aRail', new Float32BufferAttribute(d.rail, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.decals = new Mesh(g, this.decalMaterial());
    this.decals.name = 'park-decals';
    this.decals.renderOrder = 2;
    this.decals.visible = d.triangles > 0;

    for (const m of [this.dressing, this.unfogged, this.decals]) {
      m.matrixAutoUpdate = false;
      this.object.add(m);
    }
    this.object.matrixAutoUpdate = false;
  }

  /** The rail being ground (`rail`, or -1) and how far along it (`railT`, 0..1); `time` in seconds. */
  update(mover: { readonly rail: number; readonly railT: number }, time: number): void {
    this.uTime.value = time;
    const r = mover.rail;
    if (r >= 0 && r < this.railCount) {
      this.uRail.value = r;
      this.uRailM.value = mover.railT * this.railLength[r];
    } else {
      this.uRail.value = NO_RAIL;
    }
  }

  /**
   * The decals' surface: the shared glowing fade surface, with the strength of each vertex set by the
   * animation: a chevron lights as the wave along its pad passes it, and a rail's glow shows only
   * while that rail is ground.
   */
  private decalMaterial(): MeshLambertMaterial {
    const m = fadeMaterial(0xffffff, true);
    m.side = DoubleSide;
    // Additive, so the order of its faces does not matter: one pass, not one per side.
    m.forceSinglePass = true;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    const base = m.onBeforeCompile.bind(m);
    const uTime = this.uTime;
    const uRail = this.uRail;
    const uRailM = this.uRailM;
    m.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer);
      shader.uniforms.uTime = uTime;
      shader.uniforms.uRail = uRail;
      shader.uniforms.uRailM = uRailM;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uRail;\nuniform float uRailM;\nattribute float aFlow;\nattribute vec2 aRail;')
        .replace(
          'vFade = aFade;',
          [
            'vFade = aFade;',
            `if (aFlow >= 0.0) { float ph = fract(uTime * ${FLOW_RATE.toFixed(3)} - aFlow); vFade *= 0.3 + 0.7 * (1.0 - ph) * (1.0 - ph); }`,
            'if (aRail.x >= 0.0) {',
            '  float on = abs(aRail.x - uRail) < 0.5 ? 1.0 : 0.0;',
            `  float hot = max(0.0, 1.0 - abs(aRail.y - uRailM) / ${GLOW_REACH.toFixed(3)});`,
            '  vFade *= on * (0.35 + 0.65 * hot);',
            '}',
          ].join('\n'),
        );
    };
    return m;
  }

  // ---- the dressing --------------------------------------------------------------------------

  private dress(terrain: Terrain, rng: Rng, solid: BoxSet, clear: BoxSet): void {
    const R = terrain.radius;
    const lip = (a: number): number => terrain.heightAt(Math.sin(a) * R, Math.cos(a) * R);
    const rim = PALETTE.rim;
    const graffiti = [...PALETTE.enemies, ...PALETTE.things.slice(1), PALETTE.accent, PALETTE.pad, PALETTE.gears[1], PALETTE.gears[3]];

    // The deck round the lip, a little below it.
    for (let k = 0; k < DECK_SEGMENTS; k++) {
      const a = ((k + 0.5) / DECK_SEGMENTS) * Math.PI * 2;
      const wide = ((Math.PI * 2 * (R + DECK_DEEP)) / DECK_SEGMENTS) * 1.04;
      const y = lip(a);
      solid.ringBox(a, R + DRESS_CLEAR + DECK_DEEP / 2, wide, DECK_DEEP, y - 1.2, y - 0.15, tone(PALETTE.groundA, -0.2), 0);
    }

    // Big things stand at angles chosen first, so the fence can leave room for none of them (they
    // stand behind it) and they keep apart.
    const towerAt: number[] = [];
    const off = rng.next() * Math.PI * 2;
    for (let k = 0; k < TOWERS; k++) towerAt.push(off + ((k + 0.5 * (rng.next() - 0.5)) / TOWERS) * Math.PI * 2);
    const taken: number[] = [...towerAt];
    const apart = (a: number, gap: number): boolean => {
      for (const b of taken) {
        let d = Math.abs(a - b) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < gap) return false;
      }
      return true;
    };
    const place = (gap: number): number => {
      for (let tries = 0; tries < 40; tries++) {
        const a = rng.next() * Math.PI * 2;
        if (apart(a, gap)) {
          taken.push(a);
          return a;
        }
      }
      const a = rng.next() * Math.PI * 2;
      taken.push(a);
      return a;
    };

    // The fence: panels with a post between each, and colour sprayed on their inner face.
    const panels = Math.round((Math.PI * 2 * (R + FENCE_IN)) / PANEL_WIDE);
    const rFence = R + FENCE_IN + PANEL_DEEP / 2;
    const panelA = tone(rim, -0.35);
    const panelB = tone(rim, -0.2);
    const post = tone(rim, 0.25);
    const lampA = tone(PALETTE.pad, LIGHT_DIM);
    const lampB = tone(PALETTE.accent, LIGHT_DIM);
    for (let k = 0; k < panels; k++) {
      const a = (k / panels) * Math.PI * 2;
      const y = lip(a);
      const wide = ((Math.PI * 2 * rFence) / panels) * 1.01;
      solid.ringBox(a, rFence, wide, PANEL_DEEP, y - PANEL_SINK, y + PANEL_HIGH, k % 2 === 0 ? panelA : panelB, 0.05);
      const pa = a + Math.PI / panels;
      solid.ringBox(pa, rFence + 0.05, 0.55, PANEL_DEEP + 0.25, y - PANEL_SINK, y + PANEL_HIGH + 0.6, post, 0.1);
      // A small light on every post: a dotted line round the lip, seen from across the bowl.
      clear.ringBox(pa, rFence + 0.05, 0.4, 0.4, y + PANEL_HIGH + 0.6, y + PANEL_HIGH + 1, k % 2 === 0 ? lampA : lampB, LIGHT_GLOW);
      if (rng.chance(0.75)) {
        const blocks = 1 + rng.int(3);
        let x = -wide / 2 + 0.4;
        for (let b = 0; b < blocks && x < wide / 2 - 0.8; b++) {
          const w = Math.min(wide / 2 - 0.4 - x, 0.8 + rng.next() * 2.6);
          const h = 0.5 + rng.next() * 1.4;
          const yb = y + 0.2 + rng.next() * (PANEL_HIGH - h - 0.3);
          // Across the panel: along the tangent at angle a.
          const t = x + w / 2;
          const cx = Math.sin(a) * (R + FENCE_IN - 0.04) + Math.cos(a) * t;
          const cz = Math.cos(a) * (R + FENCE_IN - 0.04) - Math.sin(a) * t;
          solid.box(cx, yb + h / 2, cz, a, w, h, 0.12, graffiti[rng.int(graffiti.length)], 0.12);
          x += w + 0.2 + rng.next() * 0.8;
        }
      }
    }

    // Floodlight towers behind the fence: a mast, a bar and a dimly lit head turned to the middle.
    const mast = tone(PALETTE.railPost, -0.25);
    const head = tone(PALETTE.sun, LIGHT_DIM);
    for (const a of towerAt) {
      const y = lip(a);
      const h = 22 + rng.next() * 8;
      const r = R + 6;
      clear.ringBox(a, r, 1, 1, y - 1, y + h, mast, 0);
      clear.ringBox(a, r - 0.4, 6, 0.4, y + h - 0.2, y + h + 0.3, mast, 0);
      clear.ringBox(a, r - 0.9, 5.2, 0.9, y + h + 0.3, y + h + 2.4, head, LIGHT_GLOW);
    }

    // Bleachers: steps rising away from the bowl, side walls, and a crowd in colours.
    const seat = tone(PALETTE.gears[1], -0.45);
    const seatB = tone(PALETTE.gears[1], -0.3);
    const side = tone(rim, -0.1);
    for (let k = 0; k < BLEACHERS; k++) {
      const a = place(0.2);
      const y = lip(a);
      for (let st = 0; st < BLEACHER_STEPS; st++) {
        const r = R + 4 + st * 1.7;
        const top = y + 0.8 + st * 1;
        solid.ringBox(a, r, BLEACHER_WIDE, 1.7, y - 1, top, st % 2 === 0 ? seat : seatB, 0);
        for (let p = 0; p < CROWD_PER_STEP; p++) {
          if (!rng.chance(0.8)) continue;
          const t = (p / (CROWD_PER_STEP - 1) - 0.5) * (BLEACHER_WIDE - 2) + (rng.next() - 0.5) * 0.8;
          const cx = Math.sin(a) * r + Math.cos(a) * t;
          const cz = Math.cos(a) * r - Math.sin(a) * t;
          const hh = 1 + rng.next() * 0.4;
          solid.box(cx, top + hh / 2, cz, a, 0.7, hh, 0.55, graffiti[rng.int(graffiti.length)], 0.06);
        }
      }
      for (let e = -1; e <= 1; e += 2) {
        const t = (e * (BLEACHER_WIDE + 0.6)) / 2;
        const r = R + 4 + ((BLEACHER_STEPS - 1) * 1.7) / 2;
        const cx = Math.sin(a) * r + Math.cos(a) * t;
        const cz = Math.cos(a) * r - Math.sin(a) * t;
        const top = y + 0.8 + BLEACHER_STEPS + 0.4;
        solid.box(cx, (y - 1 + top) / 2, cz, a, 0.6, top - y + 1, BLEACHER_STEPS * 1.7, side, 0);
      }
    }

    // Billboards on two legs, with glowing stripes.
    const leg = tone(PALETTE.railPost, -0.15);
    const board = tone(rim, -0.45);
    for (let k = 0; k < SIGNS; k++) {
      const a = place(0.12);
      const y = lip(a);
      const r = R + 3.5;
      for (let e = -1; e <= 1; e += 2) {
        const t = e * 3.2;
        clear.box(Math.sin(a) * r + Math.cos(a) * t, y + 2.5, Math.cos(a) * r - Math.sin(a) * t, a, 0.45, 7, 0.45, leg, 0);
      }
      clear.ringBox(a, r, 10, 0.4, y + 5, y + 9, board, 0);
      const c0 = graffiti[rng.int(graffiti.length)];
      const c1 = graffiti[rng.int(graffiti.length)];
      clear.ringBox(a, r - 0.25, 8.6, 0.12, y + 7.4, y + 8.4, tone(c0, LIGHT_DIM), LIGHT_GLOW);
      clear.ringBox(a, r - 0.25, 4 + rng.next() * 4, 0.12, y + 5.6, y + 6.6, tone(c1, LIGHT_DIM), LIGHT_GLOW * 0.8);
    }

    // The skyline beyond the rim: tall dark blocks standing close, a wall of city darker than the sky
    // and the bowl, each with one dim band of light.
    const block = tone(rim, -0.7);
    const blockB = tone(PALETTE.fog, -0.6);
    for (let k = 0; k < SKYLINE; k++) {
      const a = ((k + rng.next() * 0.8) / SKYLINE) * Math.PI * 2;
      const r = R + 30 + rng.next() * 45;
      const y = lip(a);
      const h = 40 + rng.next() * 55;
      const wide = 16 + rng.next() * 20;
      const deep = 12 + rng.next() * 10;
      clear.ringBox(a, r, wide, deep, y - 4, y + h, k % 2 === 0 ? block : blockB, 0);
      const band = y + h * (0.55 + rng.next() * 0.35);
      clear.ringBox(a, r - deep / 2 - 0.2, wide * 0.8, 0.6, band, band + 1.2, tone(graffiti[rng.int(graffiti.length)], LIGHT_DIM), LIGHT_GLOW);
    }
  }

  // ---- the decals ----------------------------------------------------------------------------

  private paint(terrain: Terrain, d: Decals): void {
    const tmp = new Float32Array(3);
    const at = (x: number, z: number): number => terrain.heightAt(x, z) + DECAL_LIFT;

    // Pad chevrons, pointing down the fall line (toward the middle on level ground).
    const padRgb = new Float32Array(3);
    rgbInto(padRgb, 0, tone(PALETTE.pad, 0.65));
    const n = { x: 0, y: 1, z: 0 };
    for (const p of terrain.pads) {
      terrain.normalAt(p.x, p.z, n);
      let fx = n.x;
      let fz = n.z;
      let l = Math.hypot(fx, fz);
      if (l < 0.01) {
        fx = -p.x;
        fz = -p.z;
        l = Math.hypot(fx, fz);
      }
      if (l < 1e-6) {
        fx = 0;
        fz = 1;
        l = 1;
      }
      fx /= l;
      fz /= l;
      for (let k = 0; k < PAD_CHEVRONS; k++) {
        const s = (k - (PAD_CHEVRONS - 1) / 2) * 0.95;
        this.chevron(d, at, p.x + fx * s, p.z + fz * s, fx, fz, PAD_ARM, PAD_ARM_WIDE, padRgb, 0.9, k / PAD_CHEVRONS);
      }
    }

    // Kicker marks.
    if (isBowl(terrain)) {
      const stripe = new Float32Array(3);
      rgbInto(stripe, 0, tone(PALETTE.accent, 0.3));
      const lipRgb = new Float32Array(3);
      rgbInto(lipRgb, 0, tone(PALETTE.accent, 0.7));
      for (const k of terrain.features.kickers) {
        const fx = Math.sin(k.yaw);
        const fz = Math.cos(k.yaw);
        const rx = fz;
        const rz = -fx;
        // Stripes up both edges of the ramp, following its profile.
        for (let e = -1; e <= 1; e += 2) {
          for (let s = 0; s < KICK_SEGMENTS; s++) {
            const q0 = KICK_FROM + ((KICK_LIP - KICK_FROM) * s) / KICK_SEGMENTS;
            const q1 = KICK_FROM + ((KICK_LIP - KICK_FROM) * (s + 1)) / KICK_SEGMENTS;
            const wi = e * (KICK_EDGE - KICK_STRIPE / 2);
            const wo = e * (KICK_EDGE + KICK_STRIPE / 2);
            const p = (q: number, w: number): [number, number] => [k.x + fx * q + rx * w, k.z + fz * q + rz * w];
            const [ax, az] = p(q0, wi);
            const [bx, bz] = p(q0, wo);
            const [cx, cz] = p(q1, wo);
            const [ex, ez] = p(q1, wi);
            d.quad(ax, at(ax, az), az, bx, at(bx, bz), bz, cx, at(cx, cz), cz, ex, at(ex, ez), ez, stripe, 0.75);
          }
        }
        // The lip: a band across the end of the top, where the board leaves the ground.
        const across = 4;
        for (let s = 0; s < across; s++) {
          const w0 = -KICK_EDGE - KICK_STRIPE / 2 + ((2 * KICK_EDGE + KICK_STRIPE) * s) / across;
          const w1 = -KICK_EDGE - KICK_STRIPE / 2 + ((2 * KICK_EDGE + KICK_STRIPE) * (s + 1)) / across;
          const q0 = KICK_LIP - 0.45;
          const q1 = KICK_LIP;
          const ax = k.x + fx * q0 + rx * w0;
          const az = k.z + fz * q0 + rz * w0;
          const bx = k.x + fx * q0 + rx * w1;
          const bz = k.z + fz * q0 + rz * w1;
          const cx = k.x + fx * q1 + rx * w1;
          const cz = k.z + fz * q1 + rz * w1;
          const ex = k.x + fx * q1 + rx * w0;
          const ez = k.z + fz * q1 + rz * w0;
          d.quad(ax, at(ax, az), az, bx, at(bx, bz), bz, cx, at(cx, cz), cz, ex, at(ex, ez), ez, lipRgb, 1);
        }
        // Two chevrons up the face.
        for (let c = 0; c < 2; c++) {
          const q = -8 + c * 3.5;
          this.chevron(d, at, k.x + fx * q, k.z + fz * q, fx, fz, 1.5, 0.4, stripe, 0.8, c / 2);
        }
      }
    }

    // The grind glow: crossed strips along every rail, shown only on the one being ground.
    rgbInto(tmp, 0, PALETTE.grindSpark);
    const rails = terrain.rails;
    for (let i = 0; i < rails.length; i++) {
      const r = rails[i];
      const len = this.railLength[i];
      const h = GLOW_SIZE / 2;
      const dx = r.x1 - r.x0;
      const dz = r.z1 - r.z0;
      const lh = Math.max(1e-6, Math.hypot(dx, dz));
      const sx = (dz / lh) * h;
      const sz = (-dx / lh) * h;
      for (let s = 0; s < GLOW_SEGMENTS; s++) {
        const t0 = s / GLOW_SEGMENTS;
        const t1 = (s + 1) / GLOW_SEGMENTS;
        const x0 = r.x0 + dx * t0;
        const y0 = r.y0 + (r.y1 - r.y0) * t0 - 0.08;
        const z0 = r.z0 + dz * t0;
        const x1 = r.x0 + dx * t1;
        const y1 = r.y0 + (r.y1 - r.y0) * t1 - 0.08;
        const z1 = r.z0 + dz * t1;
        // Upright, along the rail.
        d.quad(x0, y0 - h, z0, x1, y1 - h, z1, x1, y1 + h, z1, x0, y0 + h, z0, tmp, 0.5, -1, i, t0 * len, t1 * len);
        // Flat, across it.
        d.quad(x0 - sx, y0, z0 - sz, x1 - sx, y1, z1 - sz, x1 + sx, y1, z1 + sz, x0 + sx, y0, z0 + sz, tmp, 0.4, -1, i, t0 * len, t1 * len);
      }
    }
  }

  /** A chevron of two arms with its tip ahead along (fx, fz), lying on the ground. */
  private chevron(
    d: Decals, at: (x: number, z: number) => number,
    x: number, z: number, fx: number, fz: number, arm: number, wide: number,
    rgb: Float32Array, fade: number, flow: number,
  ): void {
    const tipX = x + fx * arm * 0.35;
    const tipZ = z + fz * arm * 0.35;
    const k = arm * 0.7071;
    const hw = wide / 2;
    for (let e = -1; e <= 1; e += 2) {
      // From the tip back and to one side; the arm's own sideways direction.
      const ex = tipX - fx * k + fz * k * e;
      const ez = tipZ - fz * k - fx * k * e;
      const ax = ex - tipX;
      const az = ez - tipZ;
      const al = Math.hypot(ax, az);
      const nx = (-az / al) * hw;
      const nz = (ax / al) * hw;
      d.quad(
        tipX - nx, at(tipX - nx, tipZ - nz), tipZ - nz,
        ex - nx, at(ex - nx, ez - nz), ez - nz,
        ex + nx, at(ex + nx, ez + nz), ez + nz,
        tipX + nx, at(tipX + nx, tipZ + nz), tipZ + nz,
        rgb, fade, flow,
      );
    }
  }
}
