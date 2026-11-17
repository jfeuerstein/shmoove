/**
 * Chalk-line race drawing: the ghost skater (dotted cobalt silhouette), the chalk trail of the
 * line being raced as white dashes on the ground about every 2 m, and the finish zone as a pink
 * ring of posts. Nothing is drawn while no race (or race countdown) is running. Reads game state,
 * never writes it. Trail and ring geometry is rebuilt only when the raced line changes.
 */
import * as THREE from 'three';
import { FEEL } from '../sim/constants';
import { CHALK_END_RADIUS, chalkPath, type ChalkLine } from '../sim/game/chalk';
import type { Game } from '../sim/game/game';
import { Mode } from '../sim/types';
import { makeGroundSample, sampleGround, type World } from '../sim/world';
import { MeshBuilder } from './geom';
import { INK, inkMaterial } from './look';
import { createSkaterView, type SkaterFrame } from './skater';

export interface ChalkView {
  update(game: Game, alpha: number, dt: number): void;
  dispose(): void;
}

/** Spacing of the trail dashes along the path, metres, and their size. */
const DASH_EVERY = 2;
const DASH_LEN = 0.38;
const DASH_HALF_W = 0.11;
const LIFT = 0.05;
const RING_SEGMENTS = 40;
const RING_HALF_W = 0.16;
const POSTS = 8;
const POST_H = 1.3;

const _g = makeGroundSample();

function groundY(world: World, x: number, y: number, z: number): number {
  sampleGround(world, x, y + 0.3, z, FEEL.STEP_UP, _g);
  return _g.y;
}

/** Trail dashes and the finish ring of one line as a single mesh's geometry. */
function buildMarks(world: World, line: ChalkLine): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const path = chalkPath(world, line);
  const n = Math.floor(path.length / 3);
  // Walk the polyline, dropping a dash each DASH_EVERY metres of plan distance.
  let carry = DASH_EVERY * 0.5;
  for (let i = 1; i < n; i++) {
    const ax = path[(i - 1) * 3];
    const ay = path[(i - 1) * 3 + 1];
    const az = path[(i - 1) * 3 + 2];
    const bx = path[i * 3];
    const by = path[i * 3 + 1];
    const bz = path[i * 3 + 2];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) continue;
    const fx = dx / len;
    const fz = dz / len;
    // Side vector (to the right of travel).
    const sx = fz;
    const sz = -fx;
    let d = carry;
    while (d <= len) {
      const t = d / len;
      const x = ax + dx * t;
      const z = az + dz * t;
      const y = groundY(world, x, ay + (by - ay) * t, z) + LIFT;
      const hl = DASH_LEN * 0.5;
      b.quad(
        x - sx * DASH_HALF_W - fx * hl, y, z - sz * DASH_HALF_W - fz * hl,
        x - sx * DASH_HALF_W + fx * hl, y, z - sz * DASH_HALF_W + fz * hl,
        x + sx * DASH_HALF_W + fx * hl, y, z + sz * DASH_HALF_W + fz * hl,
        x + sx * DASH_HALF_W - fx * hl, y, z + sz * DASH_HALF_W - fz * hl,
        INK.white,
      );
      d += DASH_EVERY;
    }
    carry = d - len;
  }
  // Finish ring: a flat band following the ground, and posts round it with white caps.
  const cx = line.endX;
  const cz = line.endZ;
  const ry = line.endY;
  const r0 = CHALK_END_RADIUS - RING_HALF_W;
  const r1 = CHALK_END_RADIUS + RING_HALF_W;
  for (let k = 0; k < RING_SEGMENTS; k++) {
    const a0 = (k / RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((k + 1) / RING_SEGMENTS) * Math.PI * 2;
    const s0 = Math.sin(a0);
    const c0 = Math.cos(a0);
    const s1 = Math.sin(a1);
    const c1 = Math.cos(a1);
    const y0 = groundY(world, cx + s0 * CHALK_END_RADIUS, ry, cz + c0 * CHALK_END_RADIUS) + LIFT + 0.01;
    const y1 = groundY(world, cx + s1 * CHALK_END_RADIUS, ry, cz + c1 * CHALK_END_RADIUS) + LIFT + 0.01;
    b.quad(
      cx + s0 * r1, y0, cz + c0 * r1,
      cx + s1 * r1, y1, cz + c1 * r1,
      cx + s1 * r0, y1, cz + c1 * r0,
      cx + s0 * r0, y0, cz + c0 * r0,
      INK.pink,
    );
  }
  for (let k = 0; k < POSTS; k++) {
    const a = (k / POSTS) * Math.PI * 2;
    const x = cx + Math.sin(a) * CHALK_END_RADIUS;
    const z = cz + Math.cos(a) * CHALK_END_RADIUS;
    const y = groundY(world, x, ry, z);
    b.box(x, y + POST_H * 0.5, z, 0.07, POST_H * 0.5, 0.07, 1, 0, INK.pink, { top: INK.white });
    b.box(x, y + POST_H + 0.06, z, 0.1, 0.06, 0.1, 1, 0, INK.white, { bottom: true });
  }
  return b.build();
}

export function createChalkView(scene: THREE.Scene, world: World): ChalkView {
  const ghostView = createSkaterView({ ghost: true });
  ghostView.group.name = 'chalk-ghost';
  ghostView.group.visible = false;
  scene.add(ghostView.group);

  const material = inkMaterial({ doubleSided: true });
  let geometry = new THREE.BufferGeometry();
  const marks = new THREE.Mesh(geometry, material);
  marks.name = 'chalk-marks';
  marks.frustumCulled = false;
  marks.visible = false;
  scene.add(marks);
  let builtId = '';

  const frame: SkaterFrame = { x: 0, y: 0, z: 0, yaw: 0, mode: 0, steer: 0, speed: 0, vy: 0, hanging: false, groundY: 0, tick: 0 };

  return {
    update(game, alpha) {
      const ch = game.chalk;
      const ghost = ch.ghost;
      const racing = (ch.mode === 'countdown' || ch.mode === 'racing') && ghost !== null && ch.activeId !== null;
      if (!racing || !ghost || ch.activeId === null) {
        ghostView.group.visible = false;
        marks.visible = false;
        return;
      }
      if (ch.activeId !== builtId) {
        const line = ch.lines.find((l) => l.id === ch.activeId);
        geometry.dispose();
        geometry = line ? buildMarks(world, line) : new THREE.BufferGeometry();
        marks.geometry = geometry;
        builtId = ch.activeId;
      }
      marks.visible = true;
      ghostView.group.visible = true;

      // The ghost steps with the sim: interpolate between its last two positions like the player.
      const g = ghost.player;
      const a = ch.mode === 'racing' ? alpha : 1;
      const x = ch.ghostPrevX + (g.x - ch.ghostPrevX) * a;
      const y = ch.ghostPrevY + (g.y - ch.ghostPrevY) * a;
      const z = ch.ghostPrevZ + (g.z - ch.ghostPrevZ) * a;
      let yaw = g.heading;
      if (g.mode === Mode.HITCH && g.vx * g.vx + g.vz * g.vz > 0.25) yaw = Math.atan2(g.vx, g.vz);
      frame.x = x;
      frame.y = y;
      frame.z = z;
      frame.yaw = yaw;
      frame.mode = g.mode;
      frame.steer = g.steer;
      frame.speed = g.speed;
      frame.vy = g.vy;
      frame.hanging = false;
      frame.groundY = groundY(world, x, y, z);
      frame.tick = ghost.tick;
      ghostView.update(frame);
    },
    dispose() {
      scene.remove(ghostView.group);
      scene.remove(marks);
      ghostView.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
