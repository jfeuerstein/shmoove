/**
 * The mover against the horde: hurt, plow, bonk.
 *
 * Below the gear that plows an enemy's weight, touching it hurts: damage, one gear lost, a moment
 * when nothing else can hurt, and everything close thrown back so there is a way out. At or above
 * that gear the mover goes through it: the enemy takes the ram and is knocked aside, and it costs a
 * little speed. Something too heavy to plow is also a wall: the mover stops dead against it.
 */
import { gearPower, PLAYER_RADIUS, PLOW_GEAR, RAM_DAMAGE_PER_SPEED } from './balance';
import { FEEL } from './constants';
import { gearFloor, gearForSpeed } from './flow';
import { dcos, dsin, len2, len3 } from './math';
import { EV_GEAR_DOWN, type MoverState, type SimState } from './types';
import {
  damageEnemy,
  emitFx,
  FX_BONK,
  FX_PLAYER_HIT,
  FX_PLOW,
  KINDS,
  MAX_ENEMY_RADIUS,
  PHASE_DEAD,
  queryEnemies,
  shoveEnemy,
  SPAWN_TICKS,
  WEIGHT_HEAVY,
  type World,
} from './world';

/** Widest enemy plus the mover, for the query, m. */
const REACH = MAX_ENEMY_RADIUS + PLAYER_RADIUS;
/** Share of an enemy's height the mover must clear to pass over it in the air. */
const CLEAR = 0.6;
const PLOW_STUN_TICKS = 24;
/** Speed a heavy costs when it shatters, in plowed enemies. */
const SHATTER_COST = 8;

function scaleSpeed(m: MoverState, to: number): void {
  const speed = len3(m.vx, m.vy, m.vz);
  if (speed <= to || speed < 1e-6) return;
  const k = to / speed;
  m.vx *= k;
  m.vy *= k;
  m.vz *= k;
}

/** The player takes a hit: damage, a gear, a breath, and room. */
export function hurtPlayer(w: World, s: SimState, damage: number): void {
  const m = s.mover;
  const p = w.player;
  p.hp -= damage;
  p.invuln = FEEL.invulnTicks;
  emitFx(w, FX_PLAYER_HIT, m.x, m.y, m.z, damage);

  if (m.gear > 1) {
    scaleSpeed(m, Math.max(0, gearFloor(m.gear) - FEEL.gearHyst - 0.2));
    m.gear--;
    m.gearHold = 0;
    s.events |= EV_GEAR_DOWN;
  }

  const h = w.horde;
  const n = queryEnemies(w, m.x, m.z, FEEL.hitShoveRadius, w.nearB);
  for (let q = 0; q < n; q++) {
    const i = w.nearB[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    if (KINDS[h.kind[i]].weight === WEIGHT_HEAVY) continue;
    shoveEnemy(w, i, h.x[i] - m.x, h.z[i] - m.z, FEEL.hitShoveSpeed, FEEL.hitStunTicks);
  }

  if (p.hp <= 0) {
    p.hp = 0;
    w.run.phase = PHASE_DEAD;
  }
}

export function stepContact(w: World, s: SimState): void {
  const m = s.mover;
  const p = w.player;
  const h = w.horde;
  if (p.invuln > 0) p.invuln--;

  const n = queryEnemies(w, m.x, m.z, REACH, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS || h.stun[i] > 0) continue;
    const kind = KINDS[h.kind[i]];
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const touch = kind.radius + PLAYER_RADIUS;
    const d2 = dx * dx + dz * dz;
    if (d2 > touch * touch) continue;
    if (!m.grounded && m.y - h.y[i] > kind.height * CLEAR) continue;

    const speed = len3(m.vx, m.vy, m.vz);
    const hs = len2(m.vx, m.vz);

    // Plowing takes the gear and the speed that earns it: a gear the mover is about to lose (it has
    // just been stopped by something) does not plow.
    const plowGear = PLOW_GEAR[kind.weight];
    if (m.gear >= plowGear && speed >= gearFloor(plowGear) - FEEL.gearHyst) {
      // Through it.
      const heavy = kind.weight === WEIGHT_HEAVY;
      damageEnemy(w, i, heavy ? h.hp[i] : speed * RAM_DAMAGE_PER_SPEED * gearPower(m.gear));
      if (hs > 1e-3) {
        // Knocked forward and to whichever side it was on.
        const fx = m.vx / hs;
        const fz = m.vz / hs;
        const side = dx * -fz + dz * fx >= 0 ? 1 : -1;
        shoveEnemy(w, i, fx * 0.6 - fz * side, fz * 0.6 + fx * side, FEEL.plowShove, PLOW_STUN_TICKS);
      }
      scaleSpeed(m, Math.max(0, speed - FEEL.plowSpeedCost * (heavy ? SHATTER_COST : 1)));
      emitFx(w, FX_PLOW, h.x[i], h.y[i], h.z[i], h.kind[i]);
      continue;
    }

    if (kind.weight === WEIGHT_HEAVY) {
      // A wall: out of it, and stopped.
      // The way out is straight back from its centre; if the mover is exactly on it, back the way
      // it came, or failing that back along its heading.
      const d = Math.sqrt(d2);
      let nx: number;
      let nz: number;
      if (d > 1e-6) {
        nx = -dx / d;
        nz = -dz / d;
      } else if (hs > 1e-6) {
        nx = -m.vx / hs;
        nz = -m.vz / hs;
      } else {
        nx = -dsin(m.heading);
        nz = -dcos(m.heading);
      }
      m.x = h.x[i] + nx * touch;
      m.z = h.z[i] + nz * touch;
      m.vx = nx * FEEL.bonkBounce;
      m.vz = nz * FEEL.bonkBounce;
      if (m.grounded) m.vy = 0;
      h.stun[i] = 12;
      emitFx(w, FX_BONK, h.x[i], h.y[i], h.z[i], h.kind[i]);
      if (p.invuln === 0) hurtPlayer(w, s, kind.damage);
      // Stopped dead means the gears go too, at once.
      const now = gearForSpeed(len3(m.vx, m.vy, m.vz));
      if (now < m.gear) {
        m.gear = now;
        m.gearHold = 0;
        s.events |= EV_GEAR_DOWN;
      }
      continue;
    }

    if (p.invuln === 0) hurtPlayer(w, s, kind.damage);
  }

  m.speed = m.grounded ? len3(m.vx, m.vy, m.vz) : len2(m.vx, m.vz);
}
