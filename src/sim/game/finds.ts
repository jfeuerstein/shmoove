/**
 * Finds: the reasons to explore. Everything here is read from the World contract, so it works on
 * any world that places pickups and zones.
 *
 * - **Tiles** (`world.pickups` of kind 'tile'): taken when the skater's body (feet to head) passes
 *   within TILE_REACH, in any mode: rolling, grinding, towed, in the air. Each is taken once. Taking
 *   one keeps a flow line in progress alive (its window starts again) without adding a trick.
 * - **Spots** (zones of kind 'spot'): found the first time the skater passes through one in the air
 *   or at SPOT_SPEED or more.
 * - **Postcards** (zones of kind 'landmark'): one the first time the skater comes within its radius.
 * - **Best lines**: the longest flow line that ended without a bail, per district (where it ended);
 *   a line is at least two tricks.
 * - **Best runs**: for every name with both a 'routeStart' and a 'routeEnd' zone, the fewest ticks
 *   from leaving the start to entering the end without a bail (at most ROUTE_MAX_TICKS).
 * - **Unlocks**: board decks and kits (cap and shirt) for the skater. Decks at 5, 15, 30, 45 and all
 *   tiles (scaled down on a world with fewer than 60), a kit per landmark's postcard, a deck for all
 *   the spots of a district. The reducer owns what is unlocked and what is worn; `findsWear` puts
 *   one on.
 *
 * Cost: tiles through a spatial hash of the pickups (a few buckets a tick); zones every ZONE_EVERY
 * ticks, against the path the skater took since the last check.
 */
import { keepFlow } from '../player';
import { Mode } from '../types';
import { DISTRICT_NAMES, districtAt, type World, type Zone } from '../world';
import type { CommandResult } from './chalk';
import { ZONE_DY } from './errands';
import type { Game, GameReducer } from './game';

/** How close the body has to pass to a tile, m. */
export const TILE_REACH = 1.8;
/** Height of the body above the wheels, m (a tile anywhere from the feet to the head counts). */
export const BODY_HEIGHT = 1.7;
/** Speed that finds a spot without leaving the ground, m/s. */
export const SPOT_SPEED = 8;
/** Zones (spots, landmarks, route ends) are checked every this many ticks. */
export const ZONE_EVERY = 6;
/** A landmark's postcard: within its radius and this far above or below its centre, m. */
export const LANDMARK_DY = 8;
/** A route run longer than this is abandoned, ticks (5 minutes). */
export const ROUTE_MAX_TICKS = 18000;
/** Tiles that unlock a deck, counted on a world of 60; `all` is the last. */
export const TILE_STEPS = [5, 15, 30, 45] as const;
const TILE_STEPS_OF = 60;
/** Further than this in one tick is a teleport (a new game, a script), not a path, m. */
const JUMP = 4;
const BUCKET = 8;
const TIERS = 3;

// ---------------------------------------------------------------------------------------------
// The wardrobe

export type WearSlot = 'deck' | 'kit';

/** A board deck: `base` on the sides and bottom, the grip on top printed with `accent` in `pattern`. */
export interface DeckLivery {
  id: string;
  slot: 'deck';
  name: string;
  base: number;
  accent: number;
  /** 0 plain, 1 stripe along, 2 check, 3 nose and tail dipped, 4 bands across. */
  pattern: number;
}

/** A kit: shirt (hoodie), its trim (pocket and hem) and the cap. */
export interface KitLivery {
  id: string;
  slot: 'kit';
  name: string;
  shirt: number;
  trim: number;
  cap: number;
}

export type Livery = DeckLivery | KitLivery;

// The inks of the print (src/render/look.ts INK), repeated here because the sim cannot import render.
const C = {
  mango: 0xffae1a,
  pink: 0xff2e88,
  teal: 0x00a99d,
  cobalt: 0x1f3fbf,
  concrete: 0xd9d2c3,
  paper: 0xf3ebdd,
  ink: 0x1b1a2e,
  brick: 0xe0704a,
  sand: 0xe8cf9e,
  leaf: 0x4fb37a,
  sea: 0x1aa7c4,
  white: 0xfbf6ec,
} as const;

const deck = (id: string, name: string, base: number, accent: number, pattern: number): DeckLivery => ({ id, slot: 'deck', name, base, accent, pattern });
const kit = (id: string, name: string, shirt: number, trim: number, cap: number): KitLivery => ({ id, slot: 'kit', name, shirt, trim, cap });

/** What every skater starts in (the look the game always had). */
export const DEFAULT_DECK = deck('deck.street', 'Street Teal', C.teal, C.mango, 0);
export const DEFAULT_KIT = kit('kit.street', 'Mango Hoodie', C.mango, C.pink, C.pink);

/** Decks for tile counts, in order: 5, 15, 30, 45, all. */
export const TILE_DECKS: readonly DeckLivery[] = [
  deck('deck.mangoCheck', 'Mango Check', C.ink, C.mango, 2),
  deck('deck.cobaltStripe', 'Cobalt Stripe', C.cobalt, C.white, 1),
  deck('deck.pinkDip', 'Pink Dip', C.paper, C.pink, 3),
  deck('deck.seaBands', 'Sea Bands', C.sea, C.ink, 4),
  deck('deck.goldRun', 'Gold Run', C.mango, C.pink, 2),
];

/** Decks for all the spots of a district, by district order. */
export const SPOT_DECKS: readonly DeckLivery[] = [
  deck('deck.brickBands', 'Brick Bands', C.brick, C.paper, 4),
  deck('deck.leafStripe', 'Leaf Stripe', C.leaf, C.ink, 1),
  deck('deck.inkDip', 'Ink Dip', C.white, C.ink, 3),
  deck('deck.tealCheck', 'Teal Check', C.teal, C.paper, 2),
  deck('deck.sandStripe', 'Sand Stripe', C.sand, C.cobalt, 1),
];

/** Kits for postcards, by landmark order in the world. */
export const POSTCARD_KITS: readonly KitLivery[] = [
  kit('kit.seaSalt', 'Sea Salt', C.sea, C.white, C.white),
  kit('kit.brickPaper', 'Brick & Paper', C.brick, C.paper, C.ink),
  kit('kit.nightBus', 'Night Bus', C.cobalt, C.mango, C.mango),
  kit('kit.limeSoda', 'Lime Soda', C.leaf, C.mango, C.white),
  kit('kit.inkPink', 'Ink & Pink', C.ink, C.pink, C.pink),
  kit('kit.sandDune', 'Sand Dune', C.sand, C.brick, C.brick),
  kit('kit.paperCobalt', 'Paper Cobalt', C.white, C.cobalt, C.cobalt),
  kit('kit.tealTram', 'Teal Tram', C.teal, C.paper, C.mango),
  kit('kit.cherry', 'Cherry', C.pink, C.white, C.ink),
  kit('kit.concrete', 'Concrete', C.concrete, C.ink, C.teal),
  kit('kit.mangoInk', 'Mango & Ink', C.mango, C.ink, C.ink),
  kit('kit.harbour', 'Harbour', C.cobalt, C.sea, C.white),
];

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII'];

/** The n-th of a table, cycling with a numeral when a world asks for more than it holds. */
function nth<T extends Livery>(table: readonly T[], n: number): T {
  const k = Math.floor(n / table.length);
  const base = table[n % table.length];
  if (k === 0) return base;
  return { ...base, id: `${base.id}.${k + 1}`, name: base.name + (ROMAN[k] ?? ` ${k + 1}`) };
}

// ---------------------------------------------------------------------------------------------
// The catalog: what this world has to find, fixed at construction.

export type UnlockSource =
  | { kind: 'tiles'; need: number }
  | { kind: 'postcard'; landmark: string }
  | { kind: 'spots'; district: number };

export interface UnlockDef {
  item: Livery;
  source: UnlockSource;
}

export interface RouteDef {
  name: string;
  start: Zone;
  end: Zone;
}

export interface FindsCatalog {
  /** Indices into `world.pickups` of the tiles, in world order. */
  tiles: number[];
  /** Per pickup index: its district and tier (-1 for pickups that are not tiles). */
  tileDistrict: Int8Array;
  tileTier: Int8Array;
  /** Districts the world knows (bands and the names). */
  districts: number;
  /** Tiles per district and tier: totals[d * 3 + tier]. */
  totals: number[];
  spots: Zone[];
  /** District of each spot, same order. */
  spotDistrict: number[];
  landmarks: Zone[];
  routes: RouteDef[];
  unlocks: UnlockDef[];
}

export interface FindsState {
  readonly catalog: FindsCatalog;
  /** Per pickup index: 1 once taken. */
  taken: Uint8Array;
  /** Tiles taken, and per district and tier: found[d * 3 + tier]. */
  count: number;
  found: number[];
  /** Spot id -> tick found. */
  spots: Record<string, number>;
  /** Landmark id -> tick the postcard came. */
  postcards: Record<string, number>;
  /** Longest unbailed flow line per district (0 for none yet). */
  bestLines: number[];
  /** Route name -> fewest ticks. */
  bestRuns: Record<string, number>;
  /** Item id -> tick unlocked (the two street items are always worn-able and not listed). */
  unlocked: Record<string, number>;
  /** Worn item ids. */
  deck: string;
  kit: string;
}

export interface FindsData {
  v: 1;
  tiles: number[];
  spots: Record<string, number>;
  postcards: Record<string, number>;
  lines: number[];
  runs: Record<string, number>;
  unlocked: Record<string, number>;
  deck: string;
  kit: string;
}

/** Thresholds for a world with `total` tiles: TILE_STEPS scaled to it, then all of them. */
export function tileThresholds(total: number): number[] {
  if (total <= 0) return [];
  const k = total >= TILE_STEPS_OF ? 1 : total / TILE_STEPS_OF;
  const out: number[] = [];
  for (const s of TILE_STEPS) out.push(Math.min(total, Math.max(1, Math.round(s * k))));
  out.push(total);
  return out;
}

export function buildCatalog(world: World): FindsCatalog {
  const n = world.pickups.length;
  const tileDistrict = new Int8Array(n).fill(-1);
  const tileTier = new Int8Array(n).fill(-1);
  let districts: number = DISTRICT_NAMES.length;
  for (const b of world.bands) districts = Math.max(districts, b.district + 1);
  const totals = new Array<number>(districts * TIERS).fill(0);
  const tiles: number[] = [];
  for (const p of world.pickups) {
    if (p.kind !== 'tile') continue;
    const d = districtAt(world, p.z);
    const tier = Math.max(0, Math.min(TIERS - 1, Math.floor(p.tier)));
    tileDistrict[p.index] = d;
    tileTier[p.index] = tier;
    totals[d * TIERS + tier]++;
    tiles.push(p.index);
  }
  const spots = world.zones.filter((z) => z.kind === 'spot');
  const spotDistrict: number[] = spots.map((z) => districtAt(world, z.z));
  const landmarks = world.zones.filter((z) => z.kind === 'landmark');
  const routes: RouteDef[] = [];
  for (const s of world.zones) {
    if (s.kind !== 'routeStart' || routes.some((r) => r.name === s.name)) continue;
    const e = world.zones.find((z) => z.kind === 'routeEnd' && z.name === s.name);
    if (e) routes.push({ name: s.name, start: s, end: e });
  }
  const unlocks: UnlockDef[] = [];
  tileThresholds(tiles.length).forEach((need, i) => unlocks.push({ item: nth(TILE_DECKS, i), source: { kind: 'tiles', need } }));
  landmarks.forEach((z, i) => unlocks.push({ item: nth(POSTCARD_KITS, i), source: { kind: 'postcard', landmark: z.id } }));
  let j = 0;
  for (let d = 0; d < districts; d++) {
    if (!spotDistrict.includes(d)) continue;
    unlocks.push({ item: nth(SPOT_DECKS, j++), source: { kind: 'spots', district: d } });
  }
  return { tiles, tileDistrict, tileTier, districts, totals, spots, spotDistrict, landmarks, routes, unlocks };
}

/** Every item the world offers, the street pair first. */
export function wardrobe(c: FindsCatalog): Livery[] {
  return [DEFAULT_DECK, DEFAULT_KIT, ...c.unlocks.map((u) => u.item)];
}

export function findLivery(c: FindsCatalog, id: string): Livery | null {
  if (id === DEFAULT_DECK.id) return DEFAULT_DECK;
  if (id === DEFAULT_KIT.id) return DEFAULT_KIT;
  for (const u of c.unlocks) if (u.item.id === id) return u.item;
  return null;
}

export function isUnlocked(s: FindsState, id: string): boolean {
  return id === DEFAULT_DECK.id || id === DEFAULT_KIT.id || s.unlocked[id] !== undefined;
}

/** The deck and kit the skater wears. */
export function wornDeck(s: FindsState): DeckLivery {
  const l = findLivery(s.catalog, s.deck);
  return l !== null && l.slot === 'deck' ? l : DEFAULT_DECK;
}

export function wornKit(s: FindsState): KitLivery {
  const l = findLivery(s.catalog, s.kit);
  return l !== null && l.slot === 'kit' ? l : DEFAULT_KIT;
}

/** Tiles and spots of one district: found / total. */
export function districtFinds(s: FindsState, d: number): { tiles: number; tilesTotal: number; spots: number; spotsTotal: number } {
  const c = s.catalog;
  let tiles = 0;
  let tilesTotal = 0;
  if (d >= 0 && d < c.districts) {
    for (let t = 0; t < TIERS; t++) {
      tiles += s.found[d * TIERS + t];
      tilesTotal += c.totals[d * TIERS + t];
    }
  }
  let spots = 0;
  let spotsTotal = 0;
  for (let i = 0; i < c.spots.length; i++) {
    if (c.spotDistrict[i] !== d) continue;
    spotsTotal++;
    if (s.spots[c.spots[i].id] !== undefined) spots++;
  }
  return { tiles, tilesTotal, spots, spotsTotal };
}

export function createFindsState(world: World): FindsState {
  const catalog = buildCatalog(world);
  return {
    catalog,
    taken: new Uint8Array(world.pickups.length),
    count: 0,
    found: new Array<number>(catalog.districts * TIERS).fill(0),
    spots: {},
    postcards: {},
    bestLines: new Array<number>(catalog.districts).fill(0),
    bestRuns: {},
    unlocked: {},
    deck: DEFAULT_DECK.id,
    kit: DEFAULT_KIT.id,
  };
}

// ---------------------------------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTick = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Copy the entries of `src` whose key is in `keys` and whose value is a tick. */
function ticksOf(src: unknown, keys: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRec(src)) return out;
  for (const k of keys) {
    const v = src[k];
    if (isTick(v)) out[k] = v;
  }
  return out;
}

/** Plan distance from (px, pz) to the segment a-b, and where along it (0..1) the closest point is. */
function segClosest(ax: number, az: number, bx: number, bz: number, px: number, pz: number, out: { d2: number; t: number }): void {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 1e-9 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = ax + ex * t - px;
  const dz = az + ez * t - pz;
  out.d2 = dx * dx + dz * dz;
  out.t = t;
}

const _c = { d2: 0, t: 0 };

interface RouteRun {
  /** Inside the start zone at the last check. */
  armed: boolean;
  /** Tick the skater left the start, -1 when no run is on. */
  from: number;
}

export class FindsReducer implements GameReducer {
  readonly key = 'finds';
  readonly state: FindsState;
  private readonly world: World;
  private readonly hashStart: Int32Array;
  private readonly hashItems: Int32Array;
  private readonly nbx: number;
  private readonly nbz: number;
  private readonly runs: RouteRun[];
  /** Skater position after the last step, and at the last zone check. */
  private px = Number.NaN;
  private py = 0;
  private pz = 0;
  private zx = Number.NaN;
  private zy = 0;
  private zz = 0;
  /** Was the skater in the air or fast at any tick since the last zone check? */
  private lively = false;
  /** Was there a bail since the last zone check? */
  private bailed = false;

  constructor(world: World) {
    this.world = world;
    this.state = createFindsState(world);
    this.nbx = Math.max(1, Math.ceil((world.maxX - world.minX) / BUCKET));
    this.nbz = Math.max(1, Math.ceil((world.maxZ - world.minZ) / BUCKET));
    const nb = this.nbx * this.nbz;
    const counts = new Int32Array(nb + 1);
    const tiles = this.state.catalog.tiles;
    for (const i of tiles) counts[this.bucket(world.pickups[i].x, world.pickups[i].z) + 1]++;
    for (let b = 0; b < nb; b++) counts[b + 1] += counts[b];
    const items = new Int32Array(tiles.length);
    const cur = counts.slice(0, nb);
    for (const i of tiles) items[cur[this.bucket(world.pickups[i].x, world.pickups[i].z)]++] = i;
    this.hashStart = counts;
    this.hashItems = items;
    this.runs = this.state.catalog.routes.map(() => ({ armed: false, from: -1 }));
  }

  private bx(x: number): number {
    const b = Math.floor((x - this.world.minX) / BUCKET);
    return b < 0 ? 0 : b >= this.nbx ? this.nbx - 1 : b;
  }

  private bz(z: number): number {
    const b = Math.floor((z - this.world.minZ) / BUCKET);
    return b < 0 ? 0 : b >= this.nbz ? this.nbz - 1 : b;
  }

  private bucket(x: number, z: number): number {
    return this.bz(z) * this.nbx + this.bx(x);
  }

  // ------------------------------------------------------------------------------------------
  // Saves

  exportState(): FindsData {
    const s = this.state;
    const tiles: number[] = [];
    for (let i = 0; i < s.taken.length; i++) if (s.taken[i]) tiles.push(i);
    return {
      v: 1,
      tiles,
      spots: { ...s.spots },
      postcards: { ...s.postcards },
      lines: [...s.bestLines],
      runs: { ...s.bestRuns },
      unlocked: { ...s.unlocked },
      deck: s.deck,
      kit: s.kit,
    };
  }

  importState(data: unknown): void {
    const s = this.state;
    const c = s.catalog;
    s.taken.fill(0);
    s.count = 0;
    s.found.fill(0);
    s.spots = {};
    s.postcards = {};
    s.bestLines.fill(0);
    s.bestRuns = {};
    s.unlocked = {};
    s.deck = DEFAULT_DECK.id;
    s.kit = DEFAULT_KIT.id;
    for (const r of this.runs) {
      r.armed = false;
      r.from = -1;
    }
    this.px = Number.NaN;
    this.zx = Number.NaN;
    if (!isRec(data)) return;
    if (Array.isArray(data.tiles)) {
      for (const i of data.tiles) {
        if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= s.taken.length) continue;
        if (c.tileTier[i] < 0 || s.taken[i]) continue;
        this.take(i);
      }
    }
    s.spots = ticksOf(data.spots, c.spots.map((z) => z.id));
    s.postcards = ticksOf(data.postcards, c.landmarks.map((z) => z.id));
    if (Array.isArray(data.lines)) {
      for (let d = 0; d < s.bestLines.length && d < data.lines.length; d++) {
        const v = data.lines[d];
        if (isTick(v)) s.bestLines[d] = v;
      }
    }
    if (isRec(data.runs)) {
      for (const r of c.routes) {
        const v = data.runs[r.name];
        if (isTick(v) && v > 0) s.bestRuns[r.name] = v;
      }
    }
    s.unlocked = ticksOf(data.unlocked, c.unlocks.map((u) => u.item.id));
    // Whatever the finds have earned is unlocked, even if the saved list missed it.
    this.unlockEarned(null, 0);
    if (typeof data.deck === 'string' && this.wearable(data.deck, 'deck')) s.deck = data.deck;
    if (typeof data.kit === 'string' && this.wearable(data.kit, 'kit')) s.kit = data.kit;
  }

  // ------------------------------------------------------------------------------------------
  // Commands

  /** Put on an unlocked deck or kit (by item id). */
  wear(id: string): CommandResult {
    const l = findLivery(this.state.catalog, id);
    if (l === null) return { ok: false, reason: 'No such deck or kit' };
    if (!isUnlocked(this.state, id)) return { ok: false, reason: 'Not unlocked yet' };
    if (l.slot === 'deck') this.state.deck = id;
    else this.state.kit = id;
    return { ok: true };
  }

  private wearable(id: string, slot: WearSlot): boolean {
    const l = findLivery(this.state.catalog, id);
    return l !== null && l.slot === slot && isUnlocked(this.state, id);
  }

  // ------------------------------------------------------------------------------------------

  step(game: Game): void {
    const sim = game.sim;
    const p = sim.player;
    for (const e of sim.events) {
      if (e.type === 'bail') this.bailed = true;
      else if (e.type === 'flowEnd' && !e.bailed) this.endLine(game, e.count, districtAt(this.world, p.z));
    }
    if (this.bailed) for (const r of this.runs) r.from = -1;
    if (p.mode === Mode.AIR || p.speed >= SPOT_SPEED) this.lively = true;

    // Tiles, every tick, along the path since the last tick.
    let ax = this.px;
    let ay = this.py;
    let az = this.pz;
    if (!(ax === ax) || Math.abs(p.x - ax) + Math.abs(p.z - az) > JUMP) {
      ax = p.x;
      ay = p.y;
      az = p.z;
    }
    this.tiles(game, ax, ay, az, p.x, p.y, p.z);
    this.px = p.x;
    this.py = p.y;
    this.pz = p.z;

    if (sim.tick % ZONE_EVERY !== 0) return;
    let zx = this.zx;
    let zy = this.zy;
    let zz = this.zz;
    if (!(zx === zx) || Math.abs(p.x - zx) + Math.abs(p.z - zz) > JUMP * ZONE_EVERY) {
      zx = p.x;
      zy = p.y;
      zz = p.z;
    }
    this.zones(game, zx, zy, zz, p.x, p.y, p.z);
    this.zx = p.x;
    this.zy = p.y;
    this.zz = p.z;
    this.lively = false;
    this.bailed = false;
  }

  private tiles(game: Game, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const s = this.state;
    if (s.count >= s.catalog.tiles.length) return;
    const r = TILE_REACH;
    const x0 = this.bx(Math.min(ax, bx) - r);
    const x1 = this.bx(Math.max(ax, bx) + r);
    const z0 = this.bz(Math.min(az, bz) - r);
    const z1 = this.bz(Math.max(az, bz) + r);
    const pk = this.world.pickups;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const b = gz * this.nbx + gx;
        for (let k = this.hashStart[b]; k < this.hashStart[b + 1]; k++) {
          const i = this.hashItems[k];
          if (s.taken[i]) continue;
          const t = pk[i];
          segClosest(ax, az, bx, bz, t.x, t.z, _c);
          if (_c.d2 > r * r) continue;
          // Height of the feet at that point of the path; the body runs from there to the head.
          const fy = ay + (by - ay) * _c.t;
          let dy = 0;
          if (t.y < fy) dy = fy - t.y;
          else if (t.y > fy + BODY_HEIGHT) dy = t.y - fy - BODY_HEIGHT;
          if (_c.d2 + dy * dy > r * r) continue;
          this.take(i);
          keepFlow(game.sim.player);
          game.events.push({ type: 'tile', index: i, tier: s.catalog.tileTier[i], district: s.catalog.tileDistrict[i], count: s.count, total: s.catalog.tiles.length });
          this.unlockEarned(game, game.sim.tick);
        }
      }
    }
  }

  private take(i: number): void {
    const s = this.state;
    s.taken[i] = 1;
    s.count++;
    s.found[s.catalog.tileDistrict[i] * TIERS + s.catalog.tileTier[i]]++;
  }

  private zones(game: Game, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const s = this.state;
    const c = s.catalog;
    const tick = game.sim.tick;
    if (this.lively) {
      for (const z of c.spots) {
        if (s.spots[z.id] !== undefined) continue;
        segClosest(ax, az, bx, bz, z.x, z.z, _c);
        if (_c.d2 >= z.r * z.r) continue;
        const y = ay + (by - ay) * _c.t;
        if (Math.abs(y - z.y) >= Math.max(ZONE_DY, z.r)) continue;
        s.spots[z.id] = tick;
        game.events.push({ type: 'spot', id: z.id, name: z.name });
        this.unlockEarned(game, tick);
      }
    }
    for (const z of c.landmarks) {
      if (s.postcards[z.id] !== undefined) continue;
      const dx = bx - z.x;
      const dz = bz - z.z;
      if (dx * dx + dz * dz >= z.r * z.r || Math.abs(by - z.y) >= LANDMARK_DY) continue;
      s.postcards[z.id] = tick;
      game.events.push({ type: 'postcard', id: z.id, name: z.name });
      this.unlockEarned(game, tick);
    }
    for (let i = 0; i < c.routes.length; i++) {
      const route = c.routes[i];
      const run = this.runs[i];
      const inStart = inside(route.start, bx, by, bz);
      if (inStart) {
        run.armed = true;
        run.from = -1;
        continue;
      }
      if (run.armed) {
        run.armed = false;
        if (!this.bailed) run.from = tick;
      }
      if (run.from < 0) continue;
      const ticks = tick - run.from;
      if (ticks > ROUTE_MAX_TICKS) {
        run.from = -1;
        continue;
      }
      if (!inside(route.end, bx, by, bz)) continue;
      run.from = -1;
      const best = s.bestRuns[route.name];
      if (best !== undefined && ticks >= best) continue;
      s.bestRuns[route.name] = ticks;
      game.events.push({ type: 'bestRun', name: route.name, ticks, first: best === undefined });
    }
  }

  private endLine(game: Game, count: number, d: number): void {
    const s = this.state;
    if (count < 2 || d < 0 || d >= s.bestLines.length || count <= s.bestLines[d]) return;
    const first = s.bestLines[d] === 0;
    s.bestLines[d] = count;
    game.events.push({ type: 'bestLine', district: d, count, first });
  }

  /** Unlock everything the finds so far have earned; with a game, announce each. */
  private unlockEarned(game: Game | null, tick: number): void {
    const s = this.state;
    const c = s.catalog;
    for (const u of c.unlocks) {
      if (s.unlocked[u.item.id] !== undefined) continue;
      const src = u.source;
      let earned = false;
      if (src.kind === 'tiles') earned = s.count >= src.need;
      else if (src.kind === 'postcard') earned = s.postcards[src.landmark] !== undefined;
      else {
        const f = districtFinds(s, src.district);
        earned = f.spotsTotal > 0 && f.spots >= f.spotsTotal;
      }
      if (!earned) continue;
      s.unlocked[u.item.id] = tick;
      game?.events.push({ type: 'unlock', id: u.item.id, slot: u.item.slot, name: u.item.name });
    }
  }
}

/** A zone as a cylinder: within its radius in plan and ZONE_DY (or its radius, if larger) in height. */
function inside(z: Zone, x: number, y: number, zz: number): boolean {
  const dx = x - z.x;
  const dz = zz - z.z;
  return dx * dx + dz * dz < z.r * z.r && Math.abs(y - z.y) < Math.max(ZONE_DY, z.r);
}
