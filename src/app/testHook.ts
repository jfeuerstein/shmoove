/**
 * The test hook: an `InputSource` that scripts can hold, and `window.__shmoove`, installed only with
 * `?hook`. The e2e and perf runners drive the game through it.
 *
 * Without a script holding it, `HookInput` reads as a thumb off the screen (tucked, no stick).
 */
import type { InputSource } from '../input/source';
import { setPassiveLevel, setWeaponLevel } from '../sim/build';
import { hurtPlayer } from '../sim/contact';
import { findBoss } from '../sim/bosses';
import { TICK_HZ } from '../sim/constants';
import { copySimState, type Sim } from '../sim/sim';
import { damageEnemy, ZONE_RING, type World } from '../sim/world';
import type { InputFrame } from '../sim/types';
import type { FrameStatsSummary } from './loop';

export interface HookState {
  tick: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  gear: number;
  grounded: boolean;
  tucked: boolean;
  /** The rail being ground (its index in `rails()`), or -1. */
  rail: number;
  chain: number;
  viewYaw: number;
  events: number;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  kills: number;
  enemies: number;
  sparks: number;
  /** PHASE_PLAY 0, PHASE_DEAD 1, PHASE_WON 2, PHASE_CHOOSE 3 (an offer is open). */
  phase: number;
  /** Run time, s. */
  seconds: number;
  /** The open card offer, or null. */
  offer: HookOffer | null;
  /** What is carried, in slot order. */
  weapons: HookItem[];
  passives: HookItem[];
  tokens: number;
  /** The boss on the field (`kind` -1 when none) and how many have fallen. */
  boss: { kind: number; hp: number; maxHp: number; x: number; z: number; felled: number };
  /** Offers waiting behind the open one. */
  offersQueued: number;
  /** The Standstill's rings on the ground: centre and the front's radius, m. */
  rings: { x: number; z: number; r: number }[];
}

/** A rail on the map: its two ends, in world space. */
export interface HookRail {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export interface HookItem {
  id: number;
  level: number;
}

export interface HookOffer {
  /** OFFER_LEVEL 0, OFFER_CRATE 1, OFFER_TOTEM 2, OFFER_SHRINE 3. */
  source: number;
  /** `type` is CARD_WEAPON 0, CARD_PASSIVE 1 or CARD_BOON 2; `by` the levels it gives. */
  cards: { type: number; id: number; by: number }[];
}

export interface TestHook {
  ready: boolean;
  /** A plain copy of the parts of the sim state scripts check. */
  state(): HookState;
  /** Override the input until cleared with null. Fields left out read as a thumb off the screen. */
  hold(frame: Partial<InputFrame> | null): void;
  /** A hop on the next step. */
  hop(): void;
  /** Stop (true) or restart (false) the real-time clock. */
  pause(on: boolean): void;
  /** Advance n ticks now and render one frame. */
  step(n: number): void;
  /** The player takes a hit of this much damage now (as `hurtPlayer`). */
  hurt(damage: number): void;
  /** Start a new run, as the AGAIN button does. */
  restart(): void;
  /** Averages over the last 120 frames. */
  stats(): FrameStatsSummary;
  /** Take card `index` of the open offer on the next step. */
  pick(index: number): void;
  /** Add experience; the next step levels up if it is enough. */
  giveXp(amount: number): void;
  /** Set a weapon's level outright (0 removes it). */
  setWeapon(id: number, level: number): void;
  setPassive(id: number, level: number): void;
  /** The rails on the map. */
  rails(): HookRail[];
  /** Put the rider on the ground at (x, z), heading `yaw`, moving at `speed` m/s, the view behind it. */
  place(x: number, z: number, yaw: number, speed: number): void;
  /** Set the run clock to `seconds`: the director and the bosses go by it from the next step. */
  setClock(seconds: number): void;
  /** Take the boss on the field down to no health: it falls on the next step. False if there is none. */
  killBoss(): boolean;
}

declare global {
  interface Window {
    __shmoove?: TestHook;
  }
}

export class HookInput implements InputSource {
  private held: InputFrame | null = null;
  private hopNext = false;

  hold(frame: Partial<InputFrame> | null): void {
    if (frame === null) {
      this.held = null;
      return;
    }
    this.held = {
      steerX: typeof frame.steerX === 'number' ? frame.steerX : 0,
      steerY: typeof frame.steerY === 'number' ? frame.steerY : 0,
      carve: frame.carve === true,
      hop: frame.hop === true,
    };
  }

  hop(): void {
    this.hopNext = true;
  }

  sample(out: InputFrame): void {
    out.steerX = 0;
    out.steerY = 0;
    out.carve = false;
    out.hop = false;
    this.overlay(out);
  }

  /** Lay the script's intent over a frame another source filled: a hold replaces it, a hop adds to it. */
  overlay(out: InputFrame): void {
    const h = this.held;
    if (h) {
      out.steerX = h.steerX;
      out.steerY = h.steerY;
      out.carve = h.carve;
      out.hop = h.hop;
    }
    if (this.hopNext) {
      out.hop = true;
      this.hopNext = false;
    }
  }
}

/** What the hook needs from the app. */
export interface HookHost {
  sim: Sim;
  input: HookInput;
  pause(on: boolean): void;
  /** Run n sim steps now and draw one frame of the result. */
  stepNow(n: number): void;
  /** Start a new run. */
  restart(): void;
  stats(): FrameStatsSummary;
  /** Queue a card pick for the next step. */
  pick(index: number): void;
}

function items(slots: Int8Array, levels: Uint8Array): HookItem[] {
  const out: HookItem[] = [];
  for (let i = 0; i < slots.length; i++) if (slots[i] >= 0) out.push({ id: slots[i], level: levels[slots[i]] });
  return out;
}

function ringsOf(w: World): HookState['rings'] {
  const zn = w.zones;
  const out: HookState['rings'] = [];
  for (let i = 0; i < zn.count; i++) if (zn.kind[i] === ZONE_RING) out.push({ x: zn.x[i], z: zn.z[i], r: zn.r[i] });
  return out;
}

function offerOf(w: World): HookOffer | null {
  const o = w.offer;
  if (!o.open) return null;
  const cards: HookOffer['cards'] = [];
  for (let i = 0; i < o.count; i++) cards.push({ type: o.type[i], id: o.id[i], by: o.by[i] });
  return { source: o.source, cards };
}

export function installTestHook(host: HookHost): TestHook {
  const hook: TestHook = {
    ready: false,
    state() {
      const s = host.sim.state;
      const m = s.mover;
      const w = host.sim.world;
      return {
        tick: s.tick,
        x: m.x,
        y: m.y,
        z: m.z,
        speed: m.speed,
        gear: m.gear,
        grounded: m.grounded,
        tucked: m.tucked,
        rail: m.rail,
        chain: m.chain,
        viewYaw: s.viewYaw,
        events: s.events,
        hp: w.player.hp,
        maxHp: w.player.maxHp,
        level: w.player.level,
        xp: w.player.xp,
        xpNext: w.player.xpNext,
        kills: w.player.kills,
        enemies: w.horde.count,
        sparks: w.sparks.count,
        phase: w.run.phase,
        seconds: w.run.ticks / 60,
        offer: offerOf(w),
        weapons: items(w.player.loadout.weapons, w.player.loadout.weaponLevel),
        passives: items(w.player.loadout.passives, w.player.loadout.passiveLevel),
        tokens: w.player.tokens,
        boss: { ...w.boss },
        offersQueued: w.offerQueued,
        rings: ringsOf(w),
      };
    },
    hold(frame) {
      host.input.hold(frame);
    },
    hop() {
      host.input.hop();
    },
    pause(on) {
      host.pause(on);
    },
    step(n) {
      const k = Math.floor(n);
      if (!(k > 0)) return;
      host.stepNow(k);
    },
    hurt(damage) {
      hurtPlayer(host.sim.world, host.sim.state, damage);
    },
    restart() {
      host.restart();
    },
    stats() {
      return host.stats();
    },
    pick(index) {
      host.pick(Math.floor(index));
    },
    giveXp(amount) {
      if (Number.isFinite(amount) && amount > 0) host.sim.world.player.xp += amount;
    },
    setWeapon(id, level) {
      setWeaponLevel(host.sim.world, Math.floor(id), Math.floor(level));
    },
    setPassive(id, level) {
      setPassiveLevel(host.sim.world, Math.floor(id), Math.floor(level));
    },
    rails() {
      return host.sim.terrain.rails.map((r) => ({ x0: r.x0, y0: r.y0, z0: r.z0, x1: r.x1, y1: r.y1, z1: r.z1 }));
    },
    place(x, z, yaw, speed) {
      if (![x, z, yaw, speed].every(Number.isFinite)) return;
      const sim = host.sim;
      const s = sim.state;
      const m = s.mover;
      const n = { x: 0, y: 1, z: 0 };
      sim.terrain.normalAt(x, z, n);
      m.x = x;
      m.y = sim.terrain.heightAt(x, z);
      m.z = z;
      m.nx = n.x;
      m.ny = n.y;
      m.nz = n.z;
      // Along the ground, heading `yaw` as seen from above.
      const hx = Math.sin(yaw);
      const hz = Math.cos(yaw);
      const hy = -(hx * n.x + hz * n.z) / n.y;
      const k = speed / Math.sqrt(hx * hx + hy * hy + hz * hz);
      m.vx = hx * k;
      m.vy = hy * k;
      m.vz = hz * k;
      m.speed = speed;
      m.heading = yaw;
      m.grounded = true;
      m.rail = -1;
      m.railCooldown = 0;
      m.airTicks = 0;
      m.hopBuffer = 0;
      m.landPending = false;
      s.viewYaw = yaw;
      // No streak from where it was.
      copySimState(sim.prev, s);
    },
    setClock(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      host.sim.world.run.ticks = Math.round(seconds * TICK_HZ);
    },
    killBoss() {
      const w = host.sim.world;
      const i = findBoss(w);
      if (i < 0) return false;
      // Twice over: a shield elite's aura halves damage to whatever stands in it.
      damageEnemy(w, i, 2 * w.horde.hp[i] + 1);
      return true;
    },
  };
  window.__shmoove = hook;
  return hook;
}
