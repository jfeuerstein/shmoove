/**
 * Everything in a run that is not the mover: the horde, sparks, shots, the player's health and
 * build, the run clock, and the one-tick queues other parts read (deaths, effects).
 *
 * All of it is structure-of-arrays with dense packing: live items are indices [0, count), and
 * removing one moves the last into its place. Indices are therefore only stable within a tick, and
 * only until `reapHorde`. Nothing here allocates after `makeWorld`.
 */
import { Rng } from './rng';
import { makeWake, type Wake } from './wake';

export const MAX_ENEMIES = 512;
export const MAX_SPARKS = 640;
export const MAX_SHOTS = 96;
export const MAX_FX = 192;

// ---- enemies --------------------------------------------------------------------------------

export const KIND_SHUFFLER = 0;
export const KIND_GNAT = 1;
export const KIND_BOLLARD = 2;
export const KIND_COUNT = 3;

export const WEIGHT_LIGHT = 0;
export const WEIGHT_MEDIUM = 1;
export const WEIGHT_HEAVY = 2;

export interface EnemyKind {
  name: string;
  /** Body radius on the ground, m. */
  radius: number;
  /** How tall it stands, m. A mover in the air above this passes over it. */
  height: number;
  /** Top speed, m/s. Always below the floor of gear 3. */
  speed: number;
  /** How fast it gets to that speed, m/s2. */
  accel: number;
  hp: number;
  /** Damage to the player on contact. */
  damage: number;
  weight: number;
  /** Sparks' worth dropped on death. */
  xp: number;
}

export const KINDS: readonly EnemyKind[] = [
  { name: 'shuffler', radius: 0.6, height: 1.7, speed: 4.5, accel: 10, hp: 10, damage: 8, weight: WEIGHT_LIGHT, xp: 1 },
  { name: 'gnat', radius: 0.35, height: 0.6, speed: 8.5, accel: 18, hp: 2, damage: 3, weight: WEIGHT_LIGHT, xp: 0.5 },
  { name: 'bollard', radius: 1.3, height: 2.4, speed: 1.6, accel: 3, hp: 120, damage: 15, weight: WEIGHT_HEAVY, xp: 12 },
];

/** Ticks an enemy takes to rise out of the ground; it cannot touch or be touched before. */
export const SPAWN_TICKS = 36;

export interface Horde {
  count: number;
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  hp: Float32Array;
  /** Ticks left of the hit flash. */
  flash: Uint8Array;
  /** Ticks since it spawned, saturating. */
  age: Uint16Array;
  /** Ticks left thrown and harmless: it does not steer, hurt, or get plowed. */
  stun: Uint8Array;
  /** 0..1, fixed per enemy: desynchronises animation. */
  phase: Float32Array;
  /** MARK_* flags; cleared at spawn, carried to `deaths` if it dies. */
  mark: Uint8Array;
}

/** Caught inside a popped loop: if it dies this tick, its sparks fly straight to the player. */
export const MARK_SWEPT = 1;

// ---- sparks, shots --------------------------------------------------------------------------

export interface Sparks {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  value: Float32Array;
  /** 1 once it is flying to the player (in magnet range, or swept up by a loop). Never cleared. */
  pull: Uint8Array;
}

export interface Shots {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  /** Ticks left. */
  life: Uint8Array;
  damage: Float32Array;
}

// ---- one-tick queues ------------------------------------------------------------------------

/** Enemies that died this tick, filled by `reapHorde`. */
export interface Deaths {
  count: number;
  kind: Uint8Array;
  /** The enemy's MARK_* flags when it died. */
  mark: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export const FX_ENEMY_HIT = 1; // a = damage
export const FX_ENEMY_DIE = 2; // a = kind
export const FX_PLOW = 3; // a = kind
export const FX_BONK = 4; // a = kind
export const FX_PLAYER_HIT = 5; // a = damage
export const FX_POP = 6; // at the loop's centre, a = its radius
export const FX_SPARK = 7; // a spark was taken, a = value
export const FX_LEVEL_UP = 8; // a = new level
export const FX_SHOT = 9; // a seeker left the player

/** Things that happened this tick, for drawing and sound. Overflow is dropped. */
export interface Fx {
  count: number;
  type: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  a: Float32Array;
}

// ---- player, run ----------------------------------------------------------------------------

export interface Player {
  hp: number;
  maxHp: number;
  /** Ticks left during which nothing can hurt. */
  invuln: number;
  xp: number;
  /** XP needed for the next level. */
  xpNext: number;
  level: number;
  kills: number;
  /** Weapon levels; 0 means not owned. */
  wakeLevel: number;
  seekersLevel: number;
  /** Loops popped and the most enemies killed by one. */
  pops: number;
  bestPop: number;
}

export const PHASE_PLAY = 0;
export const PHASE_DEAD = 1;
export const PHASE_WON = 2;

export interface Run {
  /** Ticks played. */
  ticks: number;
  phase: number;
}

// ---- the grid -------------------------------------------------------------------------------

export const GRID_CELL = 4;
export const GRID_HALF = 180;
export const GRID_DIM = (2 * GRID_HALF) / GRID_CELL;

/** Enemies bucketed by cell, rebuilt once a tick after they move. */
export interface Grid {
  /** Cell c holds items[start[c] .. start[c + 1]). */
  start: Int32Array;
  items: Int16Array;
  /** Scratch for the rebuild. */
  fill: Int32Array;
}

export interface World {
  seed: number;
  /** False in tests that place enemies by hand: the spawn director does nothing. */
  spawning: boolean;
  rng: Rng;
  horde: Horde;
  sparks: Sparks;
  shots: Shots;
  deaths: Deaths;
  fx: Fx;
  player: Player;
  run: Run;
  wake: Wake;
  /** Metres travelled toward the next volley of seekers. */
  seekerMeter: number;
  grid: Grid;
  /** Two result buffers for `queryEnemies`, so a query can run inside a loop over another's result. */
  nearA: Int16Array;
  nearB: Int16Array;
}

function makePlayer(): Player {
  return {
    hp: 100,
    maxHp: 100,
    invuln: 0,
    xp: 0,
    xpNext: 5,
    level: 1,
    kills: 0,
    wakeLevel: 1,
    seekersLevel: 0,
    pops: 0,
    bestPop: 0,
  };
}

export function makeWorld(seed: number): World {
  const E = MAX_ENEMIES;
  const S = MAX_SPARKS;
  const H = MAX_SHOTS;
  return {
    seed,
    spawning: true,
    rng: new Rng(seed).fork('world'),
    horde: {
      count: 0,
      kind: new Uint8Array(E),
      x: new Float32Array(E),
      y: new Float32Array(E),
      z: new Float32Array(E),
      vx: new Float32Array(E),
      vz: new Float32Array(E),
      hp: new Float32Array(E),
      flash: new Uint8Array(E),
      age: new Uint16Array(E),
      stun: new Uint8Array(E),
      phase: new Float32Array(E),
      mark: new Uint8Array(E),
    },
    sparks: {
      count: 0,
      x: new Float32Array(S),
      y: new Float32Array(S),
      z: new Float32Array(S),
      value: new Float32Array(S),
      pull: new Uint8Array(S),
    },
    shots: {
      count: 0,
      x: new Float32Array(H),
      y: new Float32Array(H),
      z: new Float32Array(H),
      vx: new Float32Array(H),
      vy: new Float32Array(H),
      vz: new Float32Array(H),
      life: new Uint8Array(H),
      damage: new Float32Array(H),
    },
    deaths: { count: 0, kind: new Uint8Array(E), mark: new Uint8Array(E), x: new Float32Array(E), y: new Float32Array(E), z: new Float32Array(E) },
    fx: {
      count: 0,
      type: new Uint8Array(MAX_FX),
      x: new Float32Array(MAX_FX),
      y: new Float32Array(MAX_FX),
      z: new Float32Array(MAX_FX),
      a: new Float32Array(MAX_FX),
    },
    player: makePlayer(),
    run: { ticks: 0, phase: PHASE_PLAY },
    wake: makeWake(),
    seekerMeter: 0,
    grid: {
      start: new Int32Array(GRID_DIM * GRID_DIM + 1),
      items: new Int16Array(E),
      fill: new Int32Array(GRID_DIM * GRID_DIM),
    },
    nearA: new Int16Array(E),
    nearB: new Int16Array(E),
  };
}

/** Put a world back to the start of a run with the same seed, in place. */
export function resetWorld(w: World): void {
  w.rng = new Rng(w.seed).fork('world');
  w.horde.count = 0;
  w.sparks.count = 0;
  w.shots.count = 0;
  w.deaths.count = 0;
  w.fx.count = 0;
  Object.assign(w.player, makePlayer());
  w.run.ticks = 0;
  w.run.phase = PHASE_PLAY;
  w.wake.count = 0;
  w.wake.acc = 0;
  w.seekerMeter = 0;
  w.grid.start.fill(0);
}

export function emitFx(w: World, type: number, x: number, y: number, z: number, a: number): void {
  const f = w.fx;
  if (f.count >= MAX_FX) return;
  const i = f.count++;
  f.type[i] = type;
  f.x[i] = x;
  f.y[i] = y;
  f.z[i] = z;
  f.a[i] = a;
}

/** Add an enemy at full health. Returns its index, or -1 if the horde is full. */
export function spawnEnemy(w: World, kind: number, x: number, y: number, z: number): number {
  const h = w.horde;
  if (h.count >= MAX_ENEMIES) return -1;
  const i = h.count++;
  h.kind[i] = kind;
  h.x[i] = x;
  h.y[i] = y;
  h.z[i] = z;
  h.vx[i] = 0;
  h.vz[i] = 0;
  h.hp[i] = KINDS[kind].hp;
  h.flash[i] = 0;
  h.age[i] = 0;
  h.stun[i] = 0;
  h.phase[i] = w.rng.next();
  h.mark[i] = 0;
  return i;
}

/** Take an enemy out without it counting as a death (recycling). Moves the last enemy into slot i. */
export function removeEnemy(w: World, i: number): void {
  const h = w.horde;
  const j = --h.count;
  if (i === j) return;
  h.kind[i] = h.kind[j];
  h.x[i] = h.x[j];
  h.y[i] = h.y[j];
  h.z[i] = h.z[j];
  h.vx[i] = h.vx[j];
  h.vz[i] = h.vz[j];
  h.hp[i] = h.hp[j];
  h.flash[i] = h.flash[j];
  h.age[i] = h.age[j];
  h.stun[i] = h.stun[j];
  h.phase[i] = h.phase[j];
  h.mark[i] = h.mark[j];
}

const FLASH_TICKS = 6;

/** Hurt an enemy. It stays in the horde until `reapHorde`, so indices hold for the rest of the tick. */
export function damageEnemy(w: World, i: number, amount: number): void {
  const h = w.horde;
  if (h.hp[i] <= 0) return;
  h.hp[i] -= amount;
  h.flash[i] = FLASH_TICKS;
  emitFx(w, FX_ENEMY_HIT, h.x[i], h.y[i], h.z[i], amount);
}

/** Throw an enemy along (dx, dz) (need not be unit) at `speed`, harmless for `stun` ticks. */
export function shoveEnemy(w: World, i: number, dx: number, dz: number, speed: number, stun: number): void {
  const h = w.horde;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-6) {
    h.vx[i] = (dx / l) * speed;
    h.vz[i] = (dz / l) * speed;
  }
  if (stun > h.stun[i]) h.stun[i] = stun > 255 ? 255 : stun;
}

/** Remove every enemy whose health ran out this tick, recording each in `deaths`. Call once, late. */
export function reapHorde(w: World): void {
  const h = w.horde;
  const d = w.deaths;
  let i = 0;
  while (i < h.count) {
    if (h.hp[i] > 0) {
      i++;
      continue;
    }
    const k = d.count++;
    d.kind[k] = h.kind[i];
    d.mark[k] = h.mark[i];
    d.x[k] = h.x[i];
    d.y[k] = h.y[i];
    d.z[k] = h.z[i];
    w.player.kills++;
    emitFx(w, FX_ENEMY_DIE, h.x[i], h.y[i], h.z[i], h.kind[i]);
    removeEnemy(w, i);
  }
}

function cellOf(v: number): number {
  const c = Math.floor((v + GRID_HALF) / GRID_CELL);
  return c < 0 ? 0 : c >= GRID_DIM ? GRID_DIM - 1 : c;
}

/** Bucket the horde by cell. Call after the horde has moved and before anything queries it. */
export function rebuildGrid(w: World): void {
  const h = w.horde;
  const g = w.grid;
  const cells = GRID_DIM * GRID_DIM;
  g.start.fill(0);
  for (let i = 0; i < h.count; i++) g.start[cellOf(h.z[i]) * GRID_DIM + cellOf(h.x[i]) + 1]++;
  for (let c = 0; c < cells; c++) g.start[c + 1] += g.start[c];
  for (let c = 0; c < cells; c++) g.fill[c] = g.start[c];
  for (let i = 0; i < h.count; i++) g.items[g.fill[cellOf(h.z[i]) * GRID_DIM + cellOf(h.x[i])]++] = i;
}

/**
 * Indices of the enemies whose centres are within `r` of (x, z), written to `out`. Returns how many.
 * Uses the grid as last rebuilt. Pass `w.nearA`, or `w.nearB` when already iterating a result in A.
 */
export function queryEnemies(w: World, x: number, z: number, r: number, out: Int16Array): number {
  const h = w.horde;
  const g = w.grid;
  const x0 = cellOf(x - r);
  const x1 = cellOf(x + r);
  const z0 = cellOf(z - r);
  const z1 = cellOf(z + r);
  const r2 = r * r;
  let n = 0;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * GRID_DIM + cx;
      for (let k = g.start[c]; k < g.start[c + 1]; k++) {
        const i = g.items[k];
        const dx = h.x[i] - x;
        const dz = h.z[i] - z;
        if (dx * dx + dz * dz <= r2) out[n++] = i;
      }
    }
  }
  return n;
}

/** The nearest living, risen enemy within `r` of (x, z), or -1. Uses the grid as last rebuilt. */
export function nearestEnemy(w: World, x: number, z: number, r: number): number {
  const h = w.horde;
  const n = queryEnemies(w, x, z, r, w.nearB);
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const i = w.nearB[k];
    if (h.hp[i] <= 0 || h.age[i] < SPAWN_TICKS) continue;
    const dx = h.x[i] - x;
    const dz = h.z[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A cheap fingerprint of the world, for determinism tests. */
export function hashWorld(w: World): number {
  const h = w.horde;
  const p = w.player;
  let a = (0x811c9dc5 ^ h.count ^ (w.sparks.count << 10) ^ (w.shots.count << 20)) >>> 0;
  const mix = (v: number): void => {
    a = Math.imul(a ^ (Math.round(v * 1024) | 0), 0x01000193) >>> 0;
  };
  for (let i = 0; i < h.count; i++) {
    mix(h.x[i]);
    mix(h.z[i]);
    mix(h.hp[i]);
  }
  for (let i = 0; i < w.sparks.count; i++) mix(w.sparks.x[i] + w.sparks.z[i]);
  mix(p.hp);
  mix(p.xp);
  mix(p.level);
  mix(p.kills);
  mix(w.run.ticks);
  mix(w.run.phase);
  mix(w.wake.count);
  return a;
}
