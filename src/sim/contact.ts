/**
 * The mover against the horde. The rule is the genre's: touching an enemy hurts. Then a moment
 * when nothing else can, and everything close is thrown back so there is a way out.
 *
 * How fast the player is going changes nothing here. Movement is how you get out of the way: a
 * hop clears the small ones, a slope outruns the rest.
 */
import { W_BUMPER } from './arsenal';
import { PLAYER_RADIUS } from './balance';
import { DT, FEEL } from './constants';
import { dcos, dsin, len2, len3 } from './math';
import type { SimState } from './types';
import {
  damageEnemy,
  emitFx,
  FX_BONK,
  FX_PLAYER_HIT,
  KINDS,
  MAX_ENEMY_RADIUS,
  MAX_LATCHED,
  PHASE_DEAD,
  queryEnemies,
  shoveEnemy,
  SPAWN_TICKS,
  STATE_LATCHED,
  WEIGHT_HEAVY,
  HURT_OTHER,
  SRC_OTHER,
  type World,
} from './world';

/** Widest enemy plus the mover, for the query, m. */
const REACH = MAX_ENEMY_RADIUS + PLAYER_RADIUS;
/** Share of an enemy's height the mover must clear to pass over it in the air. */
const CLEAR = 0.6;

/** The player takes a hit: damage, a breath, and room. */
export function hurtPlayer(w: World, s: SimState, damage: number, cause: number = HURT_OTHER): void {
  const m = s.mover;
  const p = w.player;
  // Armour takes a little off every hit, never all of it.
  const taken = Math.max(1, damage - p.stats.armour);
  p.hp -= taken;
  w.tally.hits[cause]++;
  w.tally.hurt[cause] += taken;
  p.invuln = FEEL.invulnTicks;
  emitFx(w, FX_PLAYER_HIT, m.x, m.y, m.z, taken);

  // Everything close and light is thrown back; with the Bumper it is hurt too.
  const h = w.horde;
  const thorns = p.stats.thorns * p.stats.might;
  const n = queryEnemies(w, m.x, m.z, FEEL.hitShoveRadius, w.nearB);
  for (let q = 0; q < n; q++) {
    const i = w.nearB[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    if (KINDS[h.kind[i]].weight === WEIGHT_HEAVY) continue;
    shoveEnemy(w, i, h.x[i] - m.x, h.z[i] - m.z, FEEL.hitShoveSpeed, FEEL.hitStunTicks);
    if (thorns > 0) {
      w.source = W_BUMPER;
      damageEnemy(w, i, thorns, true);
      w.source = SRC_OTHER;
    }
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

  if (p.hp > 0 && p.hp < p.maxHp) {
    p.hp += p.stats.regen * DT;
    if (p.hp > p.maxHp) p.hp = p.maxHp;
  }

  const n = queryEnemies(w, m.x, m.z, REACH, w.nearA);
  for (let q = 0; q < n; q++) {
    const i = w.nearA[q];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS || h.stun[i] > 0) continue;
    const kind = KINDS[h.kind[i]];
    // Holding on already. (Only for kinds that latch: `state` is each kind's own to use.)
    if (kind.latches === true && h.state[i] === STATE_LATCHED) continue;
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const touch = kind.radius + PLAYER_RADIUS;
    const d2 = dx * dx + dz * dz;
    if (d2 > touch * touch) continue;
    // In the air and clear of its head: over it. (Nothing clears a boss.)
    if (kind.boss !== true && !m.grounded && m.y - h.y[i] > kind.height * CLEAR) continue;

    if (kind.latches === true) {
      // It grabs on instead of hurting, if there is room; the horde's step carries it from here.
      if (p.latched < MAX_LATCHED) {
        h.state[i] = STATE_LATCHED;
        p.latched++;
      }
      continue;
    }

    if (kind.weight === WEIGHT_HEAVY && m.rail < 0) {
      // Too heavy to push past: the mover is put back outside it and loses what speed it had
      // into it. It keeps the rest, so a glancing touch slides round. (On a rail the rail holds
      // the board: it scrapes past and only takes the hit.)
      const d = Math.sqrt(d2);
      const hs = len2(m.vx, m.vz);
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
      const into = m.vx * nx + m.vz * nz;
      if (into < 0) {
        m.vx -= into * nx;
        m.vz -= into * nz;
        emitFx(w, FX_BONK, h.x[i], h.y[i], h.z[i], h.kind[i]);
      }
    }

    if (p.invuln === 0) hurtPlayer(w, s, kind.damage, h.kind[i]);
  }

  m.speed = m.grounded ? len3(m.vx, m.vy, m.vz) : len2(m.vx, m.vz);
}
