/**
 * The skater: a chunky box figure. Poses are whole pre-built geometries swapped at 12 Hz
 * ("on twos") while position and heading stay smooth, with a two-frame boil so a held pose is
 * never dead still. Local frame: +z forward along the board, origin at the wheels.
 */
import * as THREE from 'three';
import { Mode } from '../sim/types';
import { MeshBuilder } from './geom';
import { INK, ghostMaterial, inkMaterial, shadowMaterial } from './look';

interface Pose {
  /** 0 standing .. 1 deep crouch. */
  crouch: number;
  /** Torso lean toward the nose, rad. */
  pitch: number;
  /** Whole-body roll into a carve, rad (positive leans to the skater's right). */
  lean: number;
  /** Arm directions in body space (x = skater's left, y = up, z = forward), not normalised. */
  armL: [number, number, number];
  armR: [number, number, number];
  /** Whole-figure tumble about the hips, rad (bails). */
  tumble?: number;
  /** Board kicked away from the feet (bails). */
  boardOff?: boolean;
}

const POSES: Record<string, Pose> = {
  stand: { crouch: 0.05, pitch: 0.05, lean: 0, armL: [0.25, -1, 0.05], armR: [-0.25, -1, 0.05] },
  roll: { crouch: 0.22, pitch: 0.18, lean: 0, armL: [0.5, -0.8, 0.25], armR: [-0.5, -0.8, -0.15] },
  tuck: { crouch: 0.8, pitch: 0.75, lean: 0, armL: [0.2, -0.5, 0.9], armR: [-0.2, -0.5, 0.9] },
  carveL: { crouch: 0.45, pitch: 0.3, lean: -0.38, armL: [1, 0.05, 0.2], armR: [-0.8, -0.5, -0.3] },
  carveR: { crouch: 0.45, pitch: 0.3, lean: 0.38, armL: [0.8, -0.5, -0.3], armR: [-1, 0.05, 0.2] },
  airUp: { crouch: 0.75, pitch: 0.35, lean: 0, armL: [0.8, 0.7, 0.1], armR: [-0.8, 0.7, 0.1] },
  airDown: { crouch: 0.4, pitch: 0.15, lean: 0, armL: [1, 0.25, -0.1], armR: [-1, 0.25, -0.1] },
  grind: { crouch: 0.5, pitch: 0.2, lean: 0, armL: [1, 0.15, 0.35], armR: [-1, 0.15, -0.35] },
  wall: { crouch: 0.55, pitch: 0.25, lean: 0.75, armL: [0.7, 0.6, 0.2], armR: [-0.9, -0.3, 0] },
  tow: { crouch: 0.4, pitch: -0.22, lean: 0, armL: [0.15, 0.3, 1], armR: [-0.6, -0.7, -0.2] },
  hang: { crouch: 0.3, pitch: 0, lean: 0, armL: [0.12, 1, 0.1], armR: [-0.12, 1, 0.1] },
  bail0: { crouch: 0.6, pitch: 0.6, lean: 0, armL: [1, 0.6, 0.3], armR: [-1, -0.2, 0.6], tumble: 0.8, boardOff: true },
  bail1: { crouch: 0.8, pitch: 0.9, lean: 0.3, armL: [0.6, -0.6, 0.6], armR: [-1, 0.5, -0.2], tumble: 2.3, boardOff: true },
  bail2: { crouch: 0.7, pitch: 0.5, lean: -0.3, armL: [1, 0.2, -0.5], armR: [-0.5, 0.8, 0.4], tumble: 3.9, boardOff: true },
  bail3: { crouch: 0.9, pitch: 1.0, lean: 0, armL: [0.8, -0.4, 0.2], armR: [-0.8, -0.4, 0.2], tumble: 5.4, boardOff: true },
};

const SKIN = 0xc98a5e;

/**
 * What the skater wears: the deck (sides and bottom in `deckBase`, the grip on top printed with
 * `deckAccent` in `deckPattern`: 0 plain, 1 a stripe along, 2 check, 3 nose and tail dipped, 4 bands
 * across; the nose block is always the accent), the hoodie and its arms, its pocket and hem, and
 * the cap. Unlocked by finds (src/sim/game/finds.ts) and put on in the album's wardrobe.
 */
export interface SkaterPalette {
  deckBase: number;
  deckAccent: number;
  deckPattern: number;
  shirt: number;
  trim: number;
  cap: number;
}

/** The look the skater always had. */
export const STREET_PALETTE: Readonly<SkaterPalette> = Object.freeze({
  deckBase: INK.teal,
  deckAccent: INK.mango,
  deckPattern: 0,
  shirt: INK.mango,
  trim: INK.pink,
  cap: INK.pink,
});

const paletteKey = (p: SkaterPalette): string => `${p.deckBase},${p.deckAccent},${p.deckPattern},${p.shirt},${p.trim},${p.cap}`;

/** The print on the grip, on top of the deck (the deck's top is at y 0.132, it spans z -0.42..0.42). */
function deckPrint(b: MeshBuilder, pal: SkaterPalette): void {
  const y = 0.136;
  const c = pal.deckAccent;
  switch (pal.deckPattern) {
    case 1:
      b.box(0, y, 0, 0.03, 0.004, 0.36, 1, 0, c, {});
      break;
    case 2:
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) b.box(j === 0 ? -0.055 : 0.055, y, -0.35 + i * 0.1, 0.055, 0.004, 0.05, 1, 0, c, {});
      break;
    case 3:
      for (const z of [-0.36, 0.36]) b.box(0, 0.11, z, 0.114, 0.026, 0.065, 1, 0, c, { bottom: true });
      break;
    case 4:
      for (const z of [-0.24, 0, 0.24]) b.box(0, y, z, 0.11, 0.004, 0.035, 1, 0, c, {});
      break;
    default:
      break;
  }
}
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

function buildPose(pose: Pose, boil: number, pal: SkaterPalette): THREE.BufferGeometry {
  const out = new MeshBuilder();
  const piece = (m: THREE.Matrix4, fn: (b: MeshBuilder) => void): void => {
    const b = new MeshBuilder();
    fn(b);
    out.append(b, m);
  };
  const wob = boil === 0 ? 0 : 0.07;

  // Board and wheels. On a bail it lies kicked out to one side.
  const board = new THREE.Matrix4();
  if (pose.boardOff) board.makeRotationZ(0.9).setPosition(0.75, 0.2, -0.3);
  piece(board, (b) => {
    b.box(0, 0.11, 0, 0.11, 0.022, 0.42, 1, 0, pal.deckBase, { top: INK.ink, bottom: true });
    b.box(0, 0.125, 0.4, 0.1, 0.02, 0.06, 1, 0, pal.deckAccent, {});
    deckPrint(b, pal);
    for (const x of [-0.085, 0.085]) for (const z of [-0.27, 0.27]) b.box(x, 0.045, z, 0.028, 0.045, 0.045, 1, 0, INK.white, { bottom: true });
  });

  // Body, rolled into the carve about the board, tumbled about the hips when bailing.
  const hipY = 0.86 - 0.34 * pose.crouch;
  const body = new THREE.Matrix4().makeRotationZ(-pose.lean);
  if (pose.tumble !== undefined) {
    _m.makeTranslation(0, 0.55, 0);
    _m2.makeRotationX(pose.tumble);
    body.multiply(_m).multiply(_m2).multiply(_m.makeTranslation(0, -0.55, 0));
  }
  const hipZ = -0.06 * pose.crouch;
  piece(body, (b) => {
    // Legs: foot -> knee -> hip, knees pushed out as the crouch deepens.
    for (const side of [1, -1]) {
      const fz = side * 0.2;
      const kneeX = 0.16 * pose.crouch + 0.02;
      const kneeY = 0.14 + (hipY - 0.14) * 0.48;
      b.box(0, 0.165, fz, 0.07, 0.035, 0.11, 1, 0, INK.ink, { top: INK.white });
      b.beam(0, 0.2, fz, kneeX, kneeY, fz * 0.9, 0.065, INK.cobalt);
      b.beam(kneeX, kneeY, fz * 0.9, 0, hipY, hipZ + side * 0.07, 0.07, INK.cobalt);
    }
  });

  // Torso, head and arms share the torso frame: at the hips, turned side-on, leaning to the nose.
  const torso = body.clone();
  _m.makeTranslation(0, hipY, hipZ);
  torso.multiply(_m);
  torso.multiply(_m.makeRotationX(pose.pitch));
  torso.multiply(_m.makeRotationY(1.0));
  piece(torso, (b) => {
    b.box(0, 0.27, 0, 0.17, 0.27, 0.11, 1, 0, pal.shirt, {});
    // Hoodie pocket and hem in a second ink.
    b.box(0, 0.1, 0.115, 0.1, 0.06, 0.012, 1, 0, pal.trim, {});
    // Head, cap, brim.
    b.box(0, 0.66, 0.01, 0.105, 0.11, 0.105, 1, 0, SKIN, {});
    b.box(0, 0.775, 0.01, 0.115, 0.035, 0.115, 1, 0, pal.cap, {});
    b.box(0, 0.76, 0.16, 0.09, 0.012, 0.07, 1, 0, pal.cap, {});
  });
  // Arms are posed in body space (not the turned torso), so "forward" means toward the nose.
  const arms = body.clone();
  _m.makeTranslation(0, hipY, hipZ);
  arms.multiply(_m).multiply(_m.makeRotationX(pose.pitch));
  piece(arms, (b) => {
    const arm = (sx: number, dir: [number, number, number], w: number): void => {
      const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const sxp = sx * 0.13;
      const sy = 0.46;
      const sz = sx * 0.13;
      const hx = sxp + (dir[0] / l) * 0.5;
      const hy = sy + (dir[1] / l) * 0.5 + w;
      const hz = sz + (dir[2] / l) * 0.5;
      b.beam(sxp, sy, sz, hx, hy, hz, 0.055, pal.shirt);
      b.box(hx, hy, hz, 0.06, 0.06, 0.06, 1, 0, SKIN, { bottom: true });
    };
    arm(1, pose.armL, wob);
    arm(-1, pose.armR, -wob);
  });
  return out.build();
}

export interface SkaterFrame {
  x: number;
  y: number;
  z: number;
  /** Yaw the figure faces, rad (forward = (sin, cos) in x, z). */
  yaw: number;
  mode: number;
  steer: number;
  speed: number;
  vy: number;
  /** Hanging under an overhead strap rather than being towed along the ground. */
  hanging: boolean;
  /** Height of the ground below, for the shadow. */
  groundY: number;
  tick: number;
}

export interface SkaterView {
  group: THREE.Group;
  update(f: SkaterFrame): void;
  /** Dress the skater (poses are rebuilt lazily in the new colours; the same palette again is free). */
  setPalette(p: SkaterPalette): void;
  dispose(): void;
}

/** Sim ticks per animation frame: 60 Hz / 5 = 12 Hz. */
const TWOS = 5;

function poseFor(f: SkaterFrame, frame: number): string {
  switch (f.mode) {
    case Mode.BAIL:
      return `bail${frame % 4}`;
    case Mode.HITCH:
      return f.hanging ? 'hang' : 'tow';
    case Mode.GRIND:
      return 'grind';
    case Mode.WALL:
      return 'wall';
    case Mode.AIR:
      return f.vy > 1.5 ? 'airUp' : 'airDown';
    default:
      if (f.steer > 0.35) return 'carveR';
      if (f.steer < -0.35) return 'carveL';
      if (f.speed > 15) return 'tuck';
      if (f.speed < 0.6) return 'stand';
      return 'roll';
  }
}

/** `ghost: true` draws the figure as a dotted cobalt silhouette with no shadow (chalk-line ghosts). */
export function createSkaterView(opts: { ghost?: boolean } = {}): SkaterView {
  const cache = new Map<string, THREE.BufferGeometry>();
  let pal: SkaterPalette = { ...STREET_PALETTE };
  let palKey = paletteKey(pal);
  /** Geometries of an earlier palette, freed once the figure no longer shows one. */
  const old: THREE.BufferGeometry[] = [];
  const geo = (name: string, boil: number): THREE.BufferGeometry => {
    const key = `${name}:${boil}`;
    let g = cache.get(key);
    if (!g) {
      g = buildPose(POSES[name], boil, pal);
      cache.set(key, g);
    }
    return g;
  };
  const group = new THREE.Group();
  group.name = 'skater';
  const ghostMat = opts.ghost ? ghostMaterial() : null;
  const body = new THREE.Mesh(geo('stand', 0), ghostMat ?? inkMaterial());
  body.frustumCulled = false;
  group.add(body);
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = shadowMaterial();
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.renderOrder = 3;
  shadow.visible = !opts.ghost;
  group.add(shadow);
  let lastFrame = -1;

  return {
    group,
    update(f) {
      body.position.set(f.x, f.y, f.z);
      body.rotation.y = f.yaw;
      const frame = Math.floor(f.tick / TWOS);
      if (frame !== lastFrame) {
        lastFrame = frame;
        body.geometry = geo(poseFor(f, frame), frame % 2);
        for (const g of old) g.dispose();
        old.length = 0;
      }
      // The shadow shrinks and fades with height.
      const h = Math.max(0, f.y - f.groundY);
      const s = 1.5 / (1 + h * 0.18);
      shadow.position.set(f.x, f.groundY + 0.03, f.z);
      shadow.scale.set(s, 1, s);
      shadowMat.uniforms.uStrength.value = 1 / (1 + h * 0.25);
    },
    setPalette(p) {
      const k = paletteKey(p);
      if (k === palKey) return;
      palKey = k;
      pal = { ...p };
      for (const g of cache.values()) old.push(g);
      cache.clear();
      // The next update builds the pose in the new colours.
      lastFrame = -1;
    },
    dispose() {
      for (const g of old) g.dispose();
      for (const g of cache.values()) g.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      ghostMat?.dispose();
    },
  };
}
