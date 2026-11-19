/**
 * Everything in a run that is not the mover: the horde, sparks, shots, the player's health and
 * build, the run clock, and the one-tick queues other parts read (deaths, effects).
 *
 * All of it is structure-of-arrays with dense packing: live items are indices [0, count), and
 * removing one moves the last into its place. Indices are therefore only stable within a tick, and
 * only until `reapHorde`. Nothing here allocates after `makeWorld`.
 */
import { makeLoadout, clearLoadout, raiseWeapon, W_SEEKERS, WEAPON_COUNT, type Loadout } from './arsenal';
import { xpForLevel } from './balance';
import { makeOffer, type Offer } from './offer';
import { Rng } from './rng';
import { makeStats, recomputeStats, type Stats } from './stats';

export const MAX_ENEMIES = 512;
export const MAX_SPARKS = 640;
export const MAX_SHOTS = 96;
export const MAX_FX = 192;
export const MAX_ZONES = 96;
export const MAX_THINGS = 64;
/** Numbers each weapon may keep between ticks (meters, angles, cooldowns). */
export const WEAPON_MEM = 8;

// ---- enemies --------------------------------------------------------------------------------

export const KIND_SHUFFLER = 0;
export const KIND_GNAT = 1;
export const KIND_BOLLARD = 2;
/** Fast; runs for where the mover will be. */
export const KIND_CUTTER = 3;
/** Keeps its distance and lobs shots onto the mover's path. */
export const KIND_LOBBER = 4;
/** Slow; leaves tar behind it. */
export const KIND_SLUDGE = 5;
/** Small and fast; latches on and drags. */
export const KIND_CLINGER = 6;
/** How many ordinary kinds there are: the ones the director brings. The bosses follow them in `KINDS`. */
export const KIND_COUNT = 7;
/** The first mini-boss (3:00): charges in a straight line after a tell. See `bosses.ts`. */
export const KIND_BRUISER = 7;
/** The second mini-boss (6:00): keeps its distance and lays lines of lob rings across your path. */
export const KIND_MORTAR = 8;
/** The final boss (9:00): slows you near it and sends rings along the ground. */
export const KIND_STANDSTILL = 9;

export const WEIGHT_LIGHT = 0;
export const WEIGHT_MEDIUM = 1;
export const WEIGHT_HEAVY = 2;

export interface EnemyKind {
  name: string;
  /** Body radius on the ground, m. */
  radius: number;
  /** How tall it stands, m. A mover in the air above this passes over it. */
  height: number;
  /** Top speed, m/s. */
  speed: number;
  /** How fast it gets to that speed, m/s2. */
  accel: number;
  hp: number;
  /** Damage to the player on contact. */
  damage: number;
  weight: number;
  /** Sparks' worth dropped on death. */
  xp: number;
  /** Below its plow gear it grabs hold of the mover instead of hurting (see STATE_LATCHED). */
  latches?: boolean;
  /** A boss: one at a time, never thrown, never recycled, cannot be hopped over. See `World.boss`. */
  boss?: boolean;
}

/** `Horde.state` of an enemy holding on to the mover. Set by contact; the horde's step does the rest. */
export const STATE_LATCHED = 1;
/** Most that can hold on at once. */
export const MAX_LATCHED = 4;

export const KINDS: readonly EnemyKind[] = [
  { name: 'shuffler', radius: 0.6, height: 1.7, speed: 4, accel: 10, hp: 10, damage: 8, weight: WEIGHT_LIGHT, xp: 1 },
  { name: 'gnat', radius: 0.35, height: 0.6, speed: 8.5, accel: 18, hp: 2, damage: 3, weight: WEIGHT_LIGHT, xp: 0.5 },
  { name: 'bollard', radius: 1.3, height: 2.4, speed: 1.6, accel: 3, hp: 120, damage: 15, weight: WEIGHT_HEAVY, xp: 12 },
  { name: 'cutter', radius: 0.5, height: 1.5, speed: 10.5, accel: 16, hp: 26, damage: 10, weight: WEIGHT_MEDIUM, xp: 3 },
  { name: 'lobber', radius: 0.7, height: 1.9, speed: 3.2, accel: 6, hp: 18, damage: 8, weight: WEIGHT_MEDIUM, xp: 3 },
  { name: 'sludge', radius: 0.9, height: 1.1, speed: 3, accel: 4, hp: 40, damage: 10, weight: WEIGHT_MEDIUM, xp: 4 },
  { name: 'clinger', radius: 0.3, height: 0.7, speed: 9, accel: 20, hp: 8, damage: 0, weight: WEIGHT_LIGHT, xp: 1, latches: true },
  // Bosses: `accel` 0 because the horde never steers one; `bosses.ts` sets its velocity every tick
  // and the horde's step only carries it along. `speed` is its walking speed, for the drawing.
  { name: 'bruiser', radius: 2.2, height: 2.6, speed: 3, accel: 0, hp: 900, damage: 20, weight: WEIGHT_HEAVY, xp: 30, boss: true },
  { name: 'mortar', radius: 1.8, height: 2.8, speed: 2, accel: 0, hp: 1400, damage: 15, weight: WEIGHT_HEAVY, xp: 30, boss: true },
  { name: 'standstill', radius: 3, height: 7, speed: 2.5, accel: 0, hp: 2600, damage: 25, weight: WEIGHT_HEAVY, xp: 30, boss: true },
];

/** `Tally.hits` and `.hurt` indices past the enemy kinds: a lobbed shot landing, a boss's ring, anything else. */
export const HURT_LOB = KINDS.length;
export const HURT_RING = KINDS.length + 1;
export const HURT_OTHER = KINDS.length + 2;
export const HURT_COUNT = KINDS.length + 3;


/** The widest enemy, m. Every query that must reach an enemy's edge pads by this. */
export const MAX_ENEMY_RADIUS = KINDS.reduce((r, k) => (k.radius > r ? k.radius : r), 0);

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
  /** ELITE_* : 0 for an ordinary enemy. Set by whoever spawns it, after `spawnEnemy`. */
  elite: Uint8Array;
  /** For the kind's own use (a clinger holding on, a lobber winding up). 0 at spawn. */
  state: Uint8Array;
  /** For the kind's own use, ticks. 0 at spawn. */
  timer: Uint16Array;
}

export const ELITE_NONE = 0;
/** Enemies near it move faster. */
export const ELITE_HASTE = 1;
/** Enemies near it take half damage. */
export const ELITE_SHIELD = 2;
/** Sparks near it do not fly to the player. */
export const ELITE_JAM = 3;

/** Caught inside a popped loop: if it dies this tick, its sparks fly straight to the player. */
export const MARK_SWEPT = 1;
/** Within a shield elite's aura this tick: damage to it is halved. Set and cleared by the horde's step. */
export const MARK_SHIELDED = 2;
/** The elite of a pack a totem called. Its death is the totem's reward. Never cleared. */
export const MARK_PACK = 4;
/** An elite. Its death is worth more sparks. Set with `Horde.elite`; never cleared. */
export const MARK_ELITE = 8;

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
  /** SHOT_* : whose it is and how it flies. */
  kind: Uint8Array;
  /** For the kind's own use (skips left, a target). */
  aux: Float32Array;
}

export const SHOT_DART = 0;
export const SHOT_STONE = 1;

/**
 * Things on the ground with a place, a size and a lifetime: mines, tar, the ring where a lobbed
 * shot will land. Dense like everything else; whoever makes a zone steps and removes it.
 */
export interface Zones {
  count: number;
  /** ZONE_* */
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  r: Float32Array;
  /** Ticks left. */
  life: Uint16Array;
  /** Ticks since it was made. */
  age: Uint16Array;
  /** Damage or strength, as the kind uses it. */
  power: Float32Array;
}

export const ZONE_MINE = 0;
export const ZONE_TAR = 1;
export const ZONE_LOB = 2;
/**
 * A ring spreading over the ground from a centre: `r` is where its front is now, `power` the
 * damage. It hurts a mover on the ground as the front crosses it; an ollie clears it.
 */
export const ZONE_RING = 3;

/**
 * Things on the map the player rides through: crates, shrines, gates, hoops, totems. Placed from
 * the bowl's sites when a run starts.
 */
export interface Things {
  count: number;
  /** THING_* */
  kind: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  /** 0 waiting, then as the kind uses it; THING_DONE when spent. */
  state: Uint8Array;
  /** As the kind uses it (laps, gates cleared). */
  progress: Float32Array;
  /** Ticks, as the kind uses it. */
  timer: Uint16Array;
  /** Things that belong together (the gates of one slalom) share a group; 0 for none. */
  group: Uint8Array;
}

export const THING_CRATE = 0;
export const THING_GOLD_CRATE = 1;
export const THING_SHRINE = 2;
export const THING_GATE = 3;
export const THING_HOOP = 4;
export const THING_TOTEM = 5;
export const THING_DONE = 255;

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
export const FX_SLAM = 10; // a shockwave on the ground, a = its radius
export const FX_ARC = 11; // one link of a chain: at the enemy struck, a = its place in the chain (0 first)
export const FX_BLAST = 12; // a mine or bomb went off, a = its radius
export const FX_HEAL = 13; // a = health given
export const FX_CARD = 14; // a card was taken, a = its type
export const FX_THING = 15; // something on the map was used, a = its kind
export const FX_TOKEN = 16; // a = tokens gained
export const FX_STONE = 17; // a skipping stone left the player
export const FX_BOSS_IN = 18; // a boss has arrived, a = its kind
export const FX_BOSS_DOWN = 19; // a boss has fallen, a = its kind

/** Things that happened this tick, for drawing and sound. Overflow is dropped. */
export interface Fx {
  count: number;
  type: Uint8Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  a: Float32Array;
}

// ---- the Wake's trail (the logic is in wake.ts; the state lives here so nothing imports in a circle) ----

export const WAKE_MAX = 128;

export interface Wake {
  /** Points [0, count), oldest first. */
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** The run tick each point was laid on. */
  born: Int32Array;
  /** Distance from the newest point to the mover, m. */
  acc: number;
}

export function makeWake(): Wake {
  return {
    count: 0,
    x: new Float32Array(WAKE_MAX),
    y: new Float32Array(WAKE_MAX),
    z: new Float32Array(WAKE_MAX),
    born: new Int32Array(WAKE_MAX),
    acc: 0,
  };
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
  /** The build: what is carried and at what level. Change it only through build.ts. */
  loadout: Loadout;
  /** Worked out from the build; read by everything, written only by build.ts. */
  stats: Stats;
  /** Meta currency picked up this run. */
  tokens: number;
  /** Extra drag on the mover from what is holding on to it and what it is standing in, 1/s. */
  cling: number;
  /** How many enemies are holding on. */
  latched: number;
  /** Shrine boons for this run: added to the stats after the build is worked out. */
  boonMight: number;
  boonMaxHp: number;
  boonMagnet: number;
  /** Loops popped and the most enemies killed by one. */
  pops: number;
  bestPop: number;
}

/** Written every tick by whoever steps the boss; nothing else may write it. */
export interface BossState {
  kind: number;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  /** How many bosses have fallen this run. */
  felled: number;
  /** Index in `BOSS_TIMES` of the next boss to come. */
  next: number;
  /** The run tick the bosses last stepped (-2 before the first), to notice a clock that was set. */
  lastTick: number;
  /** The Bruiser's aim, a unit vector along the ground: set when its tell starts, held through the charge. */
  aimX: number;
  aimZ: number;
  /** Where the Bruiser's charge began. */
  fromX: number;
  fromZ: number;
  /** The mover's position at the bosses' last step, for the rings' crossing test. */
  moverX: number;
  moverZ: number;
}

/** What the spawn director remembers between ticks. */
export interface DirectorState {
  /** False until the director's first step of a run, which sets the rest. */
  ready: boolean;
  /** Gnats still to come in the cloud being spawned, and where. */
  cloudLeft: number;
  cloudX: number;
  cloudZ: number;
  /** Run ticks from which the next bollard, lobber, sludge and elite may come. */
  nextBollard: number;
  nextLobber: number;
  nextSludge: number;
  nextElite: number;
  /** Spawns paid for and not yet made. */
  budget: number;
}

/**
 * Who dealt and who took what this run: counters for the end card and the playtest report. Nothing
 * in the sim reads them.
 */
export interface Tally {
  /** Damage dealt, by source: a weapon id, or `SRC_OTHER` (a bomb crate, a clinger shaken off). */
  dealt: Float64Array;
  /** Hits and damage the player took, by cause: an enemy kind (bosses included) or a `HURT_*`. */
  hits: Uint16Array;
  hurt: Float64Array;
}

/** `Tally.dealt` index for damage no weapon dealt. */
export const SRC_OTHER = WEAPON_COUNT;
export const SRC_COUNT = WEAPON_COUNT + 1;

function makeBoss(): BossState {
  return { kind: -1, hp: 0, maxHp: 0, x: 0, z: 0, felled: 0, next: 0, lastTick: -2, aimX: 0, aimZ: 1, fromX: 0, fromZ: 0, moverX: 0, moverZ: 0 };
}

function makeDirector(): DirectorState {
  return { ready: false, cloudLeft: 0, cloudX: 0, cloudZ: 0, nextBollard: 0, nextLobber: 0, nextSludge: 0, nextElite: 0, budget: 0 };
}

export const PHASE_PLAY = 0;
export const PHASE_DEAD = 1;
export const PHASE_WON = 2;
/** An offer is open: the world holds still until a card is taken. */
export const PHASE_CHOOSE = 3;

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
  zones: Zones;
  things: Things;
  /** The cards on the table, if any. */
  offer: Offer;
  /** Offers waiting their turn: the source of each, oldest first. */
  offerQueue: Uint8Array;
  offerQueued: number;
  /** Which weapons can be offered at all (built and unlocked), by weapon id. */
  pool: Uint8Array;
  /** WEAPON_MEM numbers per weapon id, for the weapon's own use. Zeroed at the start of a run. */
  mem: Float64Array;
  /** Metres travelled toward the next volley of seekers. */
  seekerMeter: number;
  /** The boss on the field, for the HUD and the camera. `kind` is -1 when there is none. */
  boss: BossState;
  director: DirectorState;
  tally: Tally;
  /** What is dealing damage right now (a weapon id or `SRC_OTHER`), for the tally. */
  source: number;
  /** `player.pops` as the hazards last saw it: a rise means a loop popped since. */
  popsSeen: number;
  /** Places a totem has asked for an elite pack, waiting for the director: [0, packs). */
  packs: number;
  packX: Float32Array;
  packZ: Float32Array;
  grid: Grid;
  /** Two result buffers for `queryEnemies`, so a query can run inside a loop over another's result. */
  nearA: Int16Array;
  nearB: Int16Array;
}

/** What every run starts with: something that shoots at whatever is nearest. */
export const STARTER_WEAPON = W_SEEKERS;

function starterLoadout(): Loadout {
  const l = makeLoadout();
  raiseWeapon(l, STARTER_WEAPON);
  return l;
}

function makePlayer(): Player {
  return {
    hp: 100,
    maxHp: 100,
    invuln: 0,
    xp: 0,
    xpNext: xpForLevel(1),
    level: 1,
    kills: 0,
    loadout: starterLoadout(),
    stats: makeStats(),
    tokens: 0,
    cling: 0,
    latched: 0,
    boonMight: 0,
    boonMaxHp: 0,
    boonMagnet: 0,
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
      elite: new Uint8Array(E),
      state: new Uint8Array(E),
      timer: new Uint16Array(E),
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
      kind: new Uint8Array(H),
      aux: new Float32Array(H),
    },
    zones: {
      count: 0,
      kind: new Uint8Array(MAX_ZONES),
      x: new Float32Array(MAX_ZONES),
      y: new Float32Array(MAX_ZONES),
      z: new Float32Array(MAX_ZONES),
      r: new Float32Array(MAX_ZONES),
      life: new Uint16Array(MAX_ZONES),
      age: new Uint16Array(MAX_ZONES),
      power: new Float32Array(MAX_ZONES),
    },
    things: {
      count: 0,
      kind: new Uint8Array(MAX_THINGS),
      x: new Float32Array(MAX_THINGS),
      y: new Float32Array(MAX_THINGS),
      z: new Float32Array(MAX_THINGS),
      yaw: new Float32Array(MAX_THINGS),
      state: new Uint8Array(MAX_THINGS),
      progress: new Float32Array(MAX_THINGS),
      timer: new Uint16Array(MAX_THINGS),
      group: new Uint8Array(MAX_THINGS),
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
    offer: makeOffer(),
    offerQueue: new Uint8Array(8),
    offerQueued: 0,
    pool: new Uint8Array(WEAPON_COUNT).fill(1),
    mem: new Float64Array(WEAPON_COUNT * WEAPON_MEM),
    seekerMeter: 0,
    boss: makeBoss(),
    director: makeDirector(),
    tally: { dealt: new Float64Array(SRC_COUNT), hits: new Uint16Array(HURT_COUNT), hurt: new Float64Array(HURT_COUNT) },
    source: SRC_OTHER,
    popsSeen: 0,
    packs: 0,
    packX: new Float32Array(4),
    packZ: new Float32Array(4),
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
  const p = w.player;
  const loadout = p.loadout;
  const stats = p.stats;
  Object.assign(p, makePlayer());
  // Keep the same build objects (views hold on to them); put them back to the start.
  p.loadout = loadout;
  p.stats = stats;
  clearLoadout(loadout);
  raiseWeapon(loadout, STARTER_WEAPON);
  recomputeStats(stats, loadout);
  w.zones.count = 0;
  w.things.count = 0;
  w.offer.open = false;
  w.offer.count = 0;
  w.offerQueued = 0;
  w.mem.fill(0);
  w.packs = 0;
  Object.assign(w.boss, makeBoss());
  Object.assign(w.director, makeDirector());
  w.tally.dealt.fill(0);
  w.tally.hits.fill(0);
  w.tally.hurt.fill(0);
  w.source = SRC_OTHER;
  w.popsSeen = 0;
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
  h.elite[i] = 0;
  h.state[i] = 0;
  h.timer[i] = 0;
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
  h.elite[i] = h.elite[j];
  h.state[i] = h.state[j];
  h.timer[i] = h.timer[j];
}

const FLASH_TICKS = 6;

/**
 * Hurt an enemy. It stays in the horde until `reapHorde`, so indices hold for the rest of the tick.
 * `quiet` skips the hit effect, for damage that lands on many enemies at once (burn, pop): the
 * effect queue is small and the rare effects must not be crowded out.
 */
export function damageEnemy(w: World, i: number, amount: number, quiet = false): void {
  const h = w.horde;
  if (h.hp[i] <= 0) return;
  // A shield aura halves damage to the enemies in it. Not to a boss: nothing shields a boss.
  const dealt = (h.mark[i] & MARK_SHIELDED) !== 0 && KINDS[h.kind[i]].boss !== true ? amount * 0.5 : amount;
  // The tally counts what was there to take, not the overkill.
  w.tally.dealt[w.source] += dealt < h.hp[i] ? dealt : h.hp[i];
  h.hp[i] -= dealt;
  h.flash[i] = FLASH_TICKS;
  if (!quiet) emitFx(w, FX_ENEMY_HIT, h.x[i], h.y[i], h.z[i], amount);
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
      // The sweep is for this tick only: a survivor of a pop is not swept when it dies later.
      h.mark[i] &= ~MARK_SWEPT;
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

/** A fingerprint of the world, for determinism tests. Covers everything a later tick can depend on. */
export function hashWorld(w: World): number {
  const h = w.horde;
  const p = w.player;
  const sp = w.sparks;
  const sh = w.shots;
  const k = w.wake;
  let a = (0x811c9dc5 ^ h.count ^ (sp.count << 10) ^ (sh.count << 20)) >>> 0;
  const mix = (v: number): void => {
    a = Math.imul(a ^ (Math.round(v * 1024) | 0), 0x01000193) >>> 0;
  };
  for (let i = 0; i < h.count; i++) {
    mix(h.kind[i]);
    mix(h.x[i]);
    mix(h.z[i]);
    mix(h.vx[i]);
    mix(h.vz[i]);
    mix(h.hp[i]);
    mix(h.age[i]);
    mix(h.stun[i]);
    mix(h.mark[i]);
    mix(h.elite[i]);
    mix(h.state[i]);
    mix(h.timer[i]);
  }
  for (let i = 0; i < sp.count; i++) {
    mix(sp.x[i]);
    mix(sp.y[i]);
    mix(sp.z[i]);
    mix(sp.value[i]);
    mix(sp.pull[i]);
  }
  for (let i = 0; i < sh.count; i++) {
    mix(sh.x[i]);
    mix(sh.y[i]);
    mix(sh.z[i]);
    mix(sh.vx[i]);
    mix(sh.vz[i]);
    mix(sh.life[i]);
    mix(sh.damage[i]);
  }
  for (let i = 0; i < k.count; i++) {
    mix(k.x[i]);
    mix(k.z[i]);
    mix(k.born[i]);
  }
  mix(w.seekerMeter);
  mix(p.hp);
  mix(p.invuln);
  mix(p.xp);
  mix(p.level);
  mix(p.kills);
  for (let i = 0; i < p.loadout.weaponLevel.length; i++) mix(p.loadout.weaponLevel[i]);
  for (let i = 0; i < p.loadout.passiveLevel.length; i++) mix(p.loadout.passiveLevel[i]);
  for (let i = 0; i < w.mem.length; i++) mix(w.mem[i]);
  for (let i = 0; i < w.zones.count; i++) {
    mix(w.zones.kind[i]);
    mix(w.zones.x[i]);
    mix(w.zones.z[i]);
    mix(w.zones.r[i]);
    mix(w.zones.life[i]);
    mix(w.zones.power[i]);
  }
  for (let i = 0; i < w.things.count; i++) {
    mix(w.things.state[i]);
    mix(w.things.progress[i]);
  }
  const o = w.offer;
  mix(o.open ? 1 + o.source : 0);
  for (let i = 0; i < o.count; i++) {
    mix(o.type[i]);
    mix(o.id[i]);
    mix(o.by[i]);
  }
  mix(w.offerQueued);
  for (let i = 0; i < w.offerQueued; i++) mix(w.offerQueue[i]);
  const b = w.boss;
  mix(b.kind);
  mix(b.hp);
  mix(b.x);
  mix(b.z);
  mix(b.felled);
  mix(b.next);
  mix(b.aimX);
  mix(b.aimZ);
  const dr = w.director;
  mix(dr.cloudLeft);
  mix(dr.nextBollard);
  mix(dr.nextLobber);
  mix(dr.nextSludge);
  mix(dr.nextElite);
  mix(dr.budget);
  mix(w.popsSeen);
  mix(w.packs);
  // Where the dice stand: one draw, from a copy.
  mix(w.rng.peek());
  mix(p.tokens);
  mix(p.pops);
  mix(w.run.ticks);
  mix(w.run.phase);
  return a;
}

/** Take a shot out of the pool. Moves the last shot into slot i. */
export function removeShot(w: World, i: number): void {
  const sh = w.shots;
  const j = --sh.count;
  if (i === j) return;
  sh.x[i] = sh.x[j];
  sh.y[i] = sh.y[j];
  sh.z[i] = sh.z[j];
  sh.vx[i] = sh.vx[j];
  sh.vy[i] = sh.vy[j];
  sh.vz[i] = sh.vz[j];
  sh.life[i] = sh.life[j];
  sh.damage[i] = sh.damage[j];
  sh.kind[i] = sh.kind[j];
  sh.aux[i] = sh.aux[j];
}

/** Add a zone. Returns its index, or -1 if the pool is full. */
export function addZone(w: World, kind: number, x: number, y: number, z: number, r: number, life: number, power: number): number {
  const zn = w.zones;
  if (zn.count >= MAX_ZONES) return -1;
  const i = zn.count++;
  zn.kind[i] = kind;
  zn.x[i] = x;
  zn.y[i] = y;
  zn.z[i] = z;
  zn.r[i] = r;
  zn.life[i] = life;
  zn.age[i] = 0;
  zn.power[i] = power;
  return i;
}

/** Take a zone out of the pool. Moves the last zone into slot i. */
export function removeZone(w: World, i: number): void {
  const zn = w.zones;
  const j = --zn.count;
  if (i === j) return;
  zn.kind[i] = zn.kind[j];
  zn.x[i] = zn.x[j];
  zn.y[i] = zn.y[j];
  zn.z[i] = zn.z[j];
  zn.r[i] = zn.r[j];
  zn.life[i] = zn.life[j];
  zn.age[i] = zn.age[j];
  zn.power[i] = zn.power[j];
}
