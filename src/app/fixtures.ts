/**
 * Stages for perf runs and screenshots.
 *
 * The crowd fixture (`?horde=N&sparks=M`): the spawn director off, N enemies of every kind
 * (`CROWD_MIX`) already risen, three of them elites (one of each aura, the ones nearest the spawn),
 * and M sparks, scattered evenly over a disc of `FIXTURE_RADIUS` around the spawn, none within
 * `FIXTURE_CLEAR` of it and none outside the map. The same seed always gives the same crowd.
 *
 * The arsenal fixture (`?arsenal`): every weapon at `ARSENAL_LEVEL`, one of each kind of map thing in
 * a row from `ROW_NEAR` to `ROW_FAR` ahead of the spawn, `ROW_SIDE` to one side of the way ahead, and
 * one of each kind of zone as far to the other side, so every view is on screen at once and the
 * mover can ride between them without anything coming between it and the camera.
 *
 * A fixture is a stage to look at and measure, not a run to lose: the player's health is raised
 * so that walking through the crowd for the length of a measurement cannot end it.
 */
import { WEAPON_COUNT } from '../sim/arsenal';
import { refreshBuild } from '../sim/build';
import { makeElite } from '../sim/director';
import { HAZARDS } from '../sim/hazards';
import { Rng, hashString } from '../sim/rng';
import type { Sim } from '../sim/sim';
import { CRUMBS } from '../sim/weapons/crumbs';
import {
  addZone,
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_SHIELD,
  KIND_CUTTER,
  KIND_SHUFFLER,
  KINDS,
  MAX_ENEMIES,
  MAX_SPARKS,
  MAX_THINGS,
  SPAWN_TICKS,
  spawnEnemy,
  THING_CRATE,
  THING_GATE,
  THING_GOLD_CRATE,
  THING_HOOP,
  THING_SHRINE,
  THING_TOTEM,
  ZONE_LOB,
  ZONE_MINE,
  ZONE_TAR,
  type World,
} from '../sim/world';

export const FIXTURE_RADIUS = 60;
export const FIXTURE_CLEAR = 8;
/** Kept this far inside the map's edge, m. */
const EDGE_CLEAR = 4;
/** Health the player is given on a fixture. */
export const FIXTURE_HP = 1_000_000;

/** Share of the crowd of each kind, by KIND_*. Sums to 1. */
export const CROWD_MIX: readonly number[] = [0.62, 0.13, 0.04, 0.07, 0.05, 0.05, 0.04];
/** The crowd's elites, one of each aura, given to the shufflers and cutters nearest the spawn. */
export const CROWD_ELITES: readonly number[] = [ELITE_HASTE, ELITE_SHIELD, ELITE_JAM];

/** Every weapon's level on the arsenal fixture. */
export const ARSENAL_LEVEL = 3;
/** The row of things: from this far ahead of the spawn to this far, m. */
export const ROW_NEAR = 12;
export const ROW_FAR = 40;
/** The kinds in the row, nearest first. */
export const ROW_KINDS: readonly number[] = [THING_CRATE, THING_GOLD_CRATE, THING_SHRINE, THING_GATE, THING_HOOP, THING_TOTEM];
/** The row stands this far to one side of the way ahead; the zones as far to the other, m. */
export const ROW_SIDE = 3.5;
/** The zones, at these distances ahead. */
export const ZONE_KINDS: readonly number[] = [ZONE_MINE, ZONE_TAR, ZONE_LOB];
const ZONE_AHEAD: readonly number[] = [14, 19, 24];
/** The hoop hangs this high over the ground, m (as over a kicker). */
const HOOP_HEIGHT = 2.8;
/** The gate is a slalom of its own. */
const ROW_GATE_GROUP = 250;
/** Zones that last as long as anyone looks, ticks. */
const LASTING = 65535;
/** The lob ring is made already half full, landing after this many ticks. */
const LOB_TICKS = 3000;

/** A point evenly spread over the ring [FIXTURE_CLEAR, FIXTURE_RADIUS] around (cx, cz) and inside the map. */
function scatter(rng: Rng, cx: number, cz: number, mapRadius: number, out: { x: number; z: number }): void {
  const inner = FIXTURE_CLEAR * FIXTURE_CLEAR;
  const outer = FIXTURE_RADIUS * FIXTURE_RADIUS;
  const limit = Math.max(0, mapRadius - EDGE_CLEAR);
  for (let tries = 0; tries < 64; tries++) {
    const r = Math.sqrt(inner + rng.next() * (outer - inner));
    const a = rng.next() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (x * x + z * z <= limit * limit) {
      out.x = x;
      out.z = z;
      return;
    }
  }
  // A spawn hard against the edge of a tiny map: settle for the spawn ring's nearest inside point.
  const l = Math.sqrt(cx * cx + cz * cz);
  const k = l > 1e-6 ? Math.max(0, l - FIXTURE_CLEAR) / l : 0;
  out.x = cx * k;
  out.z = cz * k;
}

/** The kind for a roll in [0, 1) by `CROWD_MIX`. */
export function crowdKind(roll: number): number {
  let acc = 0;
  for (let k = 0; k < CROWD_MIX.length; k++) {
    acc += CROWD_MIX[k];
    if (roll < acc) return k;
  }
  return KIND_SHUFFLER;
}

/** Make the shufflers and cutters nearest (cx, cz) the crowd's elites. */
function crown(w: World, cx: number, cz: number): void {
  const h = w.horde;
  for (const aura of CROWD_ELITES) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < h.count; i++) {
      if (h.elite[i] !== 0 || (h.kind[i] !== KIND_SHUFFLER && h.kind[i] !== KIND_CUTTER)) continue;
      const d = (h.x[i] - cx) * (h.x[i] - cx) + (h.z[i] - cz) * (h.z[i] - cz);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    makeElite(w, best, aura);
  }
}

function stage(w: World): void {
  // As a boon, so the health stays up when a level or a card works the build out again.
  const p = w.player;
  p.boonMaxHp += FIXTURE_HP - p.maxHp;
  refreshBuild(w);
  p.hp = p.maxHp;
}

/** Put the crowd on `sim`'s map. Counts are clamped to what the world holds. */
export function applyFixture(sim: Sim, enemies: number, sparks: number): void {
  const w = sim.world;
  const t = sim.terrain;
  w.spawning = false;
  const rng = new Rng(hashString('fixture', w.seed));
  const p = { x: 0, z: 0 };

  const first = w.horde.count;
  const ne = Math.min(MAX_ENEMIES - w.horde.count, Math.max(0, Math.floor(enemies)));
  for (let n = 0; n < ne; n++) {
    const kind = crowdKind(rng.next());
    scatter(rng, t.spawnX, t.spawnZ, t.radius, p);
    const i = spawnEnemy(w, kind, p.x, t.heightAt(p.x, p.z), p.z);
    if (i < 0) break;
    w.horde.age[i] = SPAWN_TICKS;
  }
  if (w.horde.count > first) crown(w, t.spawnX, t.spawnZ);

  const s = w.sparks;
  const ns = Math.min(MAX_SPARKS - s.count, Math.max(0, Math.floor(sparks)));
  for (let n = 0; n < ns; n++) {
    // What the kinds drop, in the same proportions.
    const value = KINDS[crowdKind(rng.next())].xp;
    scatter(rng, t.spawnX, t.spawnZ, t.radius, p);
    const i = s.count++;
    s.x[i] = p.x;
    s.y[i] = t.heightAt(p.x, p.z);
    s.z[i] = p.z;
    s.value[i] = value;
    s.pull[i] = 0;
  }

  if (ne > 0 || ns > 0) stage(w);
}

/** Add a thing to the world as the map would. Returns its index, or -1 if full. */
function placeThing(w: World, kind: number, x: number, y: number, z: number, yaw: number, group: number): number {
  const t = w.things;
  if (t.count >= MAX_THINGS) return -1;
  const i = t.count++;
  t.kind[i] = kind;
  t.x[i] = x;
  t.y[i] = y;
  t.z[i] = z;
  t.yaw[i] = yaw;
  t.state[i] = 0;
  t.progress[i] = 0;
  t.timer[i] = 0;
  t.group[i] = group;
  return i;
}

/**
 * Every weapon at `ARSENAL_LEVEL` (written straight into the levels: the four slots show the first
 * four), one of each map thing in a row ahead of the spawn and one of each zone beside it.
 */
export function applyArsenal(sim: Sim): void {
  const w = sim.world;
  const t = sim.terrain;
  const l = w.player.loadout;
  for (let id = 0; id < WEAPON_COUNT; id++) l.weaponLevel[id] = ARSENAL_LEVEL;
  for (let k = 0; k < l.weapons.length; k++) l.weapons[k] = k;
  refreshBuild(w);
  stage(w);

  const yaw = t.spawnYaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // Square to the way ahead.
  const sx = fz;
  const sz = -fx;
  for (let k = 0; k < ROW_KINDS.length; k++) {
    const d = ROW_NEAR + ((ROW_FAR - ROW_NEAR) * k) / (ROW_KINDS.length - 1);
    const x = t.spawnX + fx * d + sx * ROW_SIDE;
    const z = t.spawnZ + fz * d + sz * ROW_SIDE;
    const kind = ROW_KINDS[k];
    const ground = t.heightAt(x, z);
    const y = kind === THING_HOOP ? ground + HOOP_HEIGHT : ground;
    placeThing(w, kind, x, y, z, yaw, kind === THING_GATE ? ROW_GATE_GROUP : 0);
  }
  for (let k = 0; k < ZONE_KINDS.length; k++) {
    const d = ZONE_AHEAD[k];
    const x = t.spawnX + fx * d - sx * ROW_SIDE;
    const z = t.spawnZ + fz * d - sz * ROW_SIDE;
    const y = t.heightAt(x, z);
    const kind = ZONE_KINDS[k];
    if (kind === ZONE_MINE) addZone(w, kind, x, y, z, CRUMBS.radius[ARSENAL_LEVEL - 1], LASTING, 0);
    else if (kind === ZONE_TAR) addZone(w, kind, x, y, z, HAZARDS.tarRadius, LASTING, HAZARDS.tarDrag);
    else {
      const i = addZone(w, kind, x, y, z, HAZARDS.lobRadius, LOB_TICKS, HAZARDS.lobDamage);
      if (i >= 0) w.zones.age[i] = LOB_TICKS;
    }
  }
}
