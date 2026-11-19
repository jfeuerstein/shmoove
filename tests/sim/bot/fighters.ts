/**
 * Bots that see the horde. They read `sim.world` the way a player reads the screen (where the
 * enemies are, what kind, the trail behind them) and write one `InputFrame` per tick.
 *
 * - evader: the careful beginner. Holds the stick, never tucks or hops, steers for open ground.
 * - looper: the evader, plus it rides circles round the crowd to close Wake loops.
 * - rider: the good player. Plays lines like the liner, but around the horde.
 *
 * All three choose a heading the same way: a fan of candidate headings, each scored by how close the
 * next second of travel along it passes to what can hurt, how near the rim it goes and how much it
 * climbs; the looper and the rider add what they want on top. Every number was chosen by running
 * the bots over seeds 1 to 5, not by feel.
 */
import { W_WAKE } from '../../../src/sim/arsenal';
/** The gear that used to plow each weight. Nothing plows now; these bots are due to be rewritten. */
const PLOW_GEAR: readonly number[] = [9, 9, 9];
import type { Bowl } from '../../../src/sim/bowl';
import { FEEL } from '../../../src/sim/constants';
import { angleDiff, datan2, dcos, dsin, len2, PI, TAU } from '../../../src/sim/math';
import type { Sim } from '../../../src/sim/sim';
import { wakeLength } from '../../../src/sim/wake';
import { KIND_BOLLARD, KIND_GNAT, KINDS, MAX_ENEMIES, SPAWN_TICKS, WEIGHT_HEAVY } from '../../../src/sim/world';
import { makeLiner } from './bots';
import { letGo, stickToward, travelYaw, yawTo, type Bot } from './steer';

const SENSE = {
  /** Enemies within this distance are looked at, m. */
  range: 34,
  /** Candidate headings in the fan. */
  fan: 24,
  /** How far ahead a heading is judged, s, in this many steps. */
  lookS: 1.5,
  steps: 6,
  /** Speed assumed for the look-ahead when slower than this, m/s. */
  minSpeed: 7,
  /** Share of an enemy's own speed by which it is assumed to close on the path per second. */
  closing: 0.5,
  /** A path point this close to a body (beyond touching) counts as danger, m. */
  margin: 2.5,
  /** Danger weight by kind; risen enemies count fully, rising and thrown ones less. */
  shuffler: 1,
  gnat: 0.6,
  bollard: 3,
  rising: 0.4,
  stunned: 0.5,
  /** The rim: from this share of the bowl's radius, every metre further costs rimCost squared. */
  rimFrom: 0.68,
  rimCost: 0.04,
  /** Cost per metre of climb along the look-ahead, for a bot that only holds the stick. */
  climbCost: 0.12,
  /** Cost per radian of turn: keeps the choice from dithering. */
  turnCost: 0.15,
  /** Open ground: cost per enemy within openR of where the look-ahead ends. */
  openR: 14,
  openCost: 0.05,
} as const;

/** What a bot sees of the horde this tick: the enemies in range, copied once. */
class Senses {
  n = 0;
  readonly x = new Float32Array(MAX_ENEMIES);
  readonly z = new Float32Array(MAX_ENEMIES);
  /** Touch distance to the mover. */
  readonly r = new Float32Array(MAX_ENEMIES);
  readonly speed = new Float32Array(MAX_ENEMIES);
  readonly weight = new Float32Array(MAX_ENEMIES);
  /** 1 if it can be plowed in the mover's current gear. */
  readonly plow = new Uint8Array(MAX_ENEMIES);
  readonly kind = new Uint8Array(MAX_ENEMIES);
  /** Living enemies, and those within 12 m, in the whole horde. */
  near12 = 0;
  cx = 0;
  cz = 0;

  look(sim: Sim): void {
    const h = sim.world.horde;
    const m = sim.state.mover;
    const r2 = SENSE.range * SENSE.range;
    let n = 0;
    let near = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < h.count; i++) {
      const dx = h.x[i] - m.x;
      const dz = h.z[i] - m.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const k = KINDS[h.kind[i]];
      this.x[n] = h.x[i];
      this.z[n] = h.z[i];
      this.r[n] = k.radius + 0.5;
      this.speed[n] = k.speed;
      this.kind[n] = h.kind[i];
      this.plow[n] = m.gear >= PLOW_GEAR[k.weight] ? 1 : 0;
      let wgt = h.kind[i] === KIND_BOLLARD ? SENSE.bollard : h.kind[i] === KIND_GNAT ? SENSE.gnat : SENSE.shuffler;
      if (h.age[i] < SPAWN_TICKS) wgt *= SENSE.rising;
      else if (h.stun[i] > 0) wgt *= SENSE.stunned;
      this.weight[n] = wgt;
      if (d2 < 144 && h.age[i] >= SPAWN_TICKS && k.weight !== WEIGHT_HEAVY) {
        near++;
        cx += h.x[i];
        cz += h.z[i];
      }
      n++;
    }
    this.n = n;
    this.near12 = near;
    this.cx = near > 0 ? cx / near : m.x;
    this.cz = near > 0 ? cz / near : m.z;
  }

  /**
   * Danger of riding straight along `yaw` at `v` m/s for the look-ahead. Enemies the mover would
   * plow in its gear count only `plowShare` as much (a rider still loses a little speed to each).
   */
  danger(sim: Sim, yaw: number, v: number, plowShare: number): number {
    const m = sim.state.mover;
    const fx = dsin(yaw) * v;
    const fz = dcos(yaw) * v;
    const dt = SENSE.lookS / SENSE.steps;
    let sum = 0;
    const reach = v * SENSE.lookS + SENSE.margin;
    for (let i = 0; i < this.n; i++) {
      // Too far to come within the margin of any point of the path: skip it (exact, by the
      // triangle inequality), which is most of what is in range.
      const ox = this.x[i] - m.x;
      const oz = this.z[i] - m.z;
      const slack = reach + this.r[i] + this.speed[i] * SENSE.closing * SENSE.lookS;
      if (ox * ox + oz * oz >= slack * slack) continue;
      // The closest this enemy comes to the path, and how soon.
      let worst = 0;
      for (let s = 1; s <= SENSE.steps; s++) {
        const t = s * dt;
        const dx = this.x[i] - (m.x + fx * t);
        const dz = this.z[i] - (m.z + fz * t);
        const gap = Math.sqrt(dx * dx + dz * dz) - this.r[i] - this.speed[i] * SENSE.closing * t;
        if (gap >= SENSE.margin) continue;
        const k = (SENSE.margin - (gap < 0 ? 0 : gap)) / SENSE.margin;
        // Sooner is worse: what is a second away can still be dodged.
        const d = k * k * (1 + SENSE.lookS - t);
        if (d > worst) worst = d;
      }
      if (worst > 0) sum += worst * this.weight[i] * (this.plow[i] ? plowShare : 1);
    }
    return sum;
  }

  /** Enemies within openR of (x, z). */
  crowdAt(x: number, z: number): number {
    const r2 = SENSE.openR * SENSE.openR;
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - x;
      const dz = this.z[i] - z;
      if (dx * dx + dz * dz < r2) c += this.weight[i];
    }
    return c;
  }
}

/** Cost of the rim and of climbing for a look-ahead ending at (x, z). */
function groundCost(sim: Sim, x: number, z: number, climbCost: number): number {
  const m = sim.state.mover;
  const rimFrom = SENSE.rimFrom * sim.terrain.radius;
  const r = len2(x, z);
  let c = 0;
  if (r > rimFrom) c += (r - rimFrom) * (r - rimFrom) * SENSE.rimCost;
  const climb = sim.terrain.heightAt(x, z) - m.y;
  c += climb * climbCost;
  return c;
}

/** What a bot may add to a heading's cost on top of danger and ground. */
type Extra = (yaw: number) => number;

interface Choice {
  yaw: number;
  cost: number;
}

/** The cheapest heading of the fan (plus straight on), with the cost terms every bot shares. */
function choose(sim: Sim, senses: Senses, out: Choice, climbCost: number, plowShare: number, extra: Extra | null): void {
  const m = sim.state.mover;
  const ty = travelYaw(m);
  const v = Math.max(m.speed, SENSE.minSpeed);
  const reach = v * SENSE.lookS;
  let best = Infinity;
  let bestYaw = ty;
  for (let k = 0; k <= SENSE.fan; k++) {
    const yaw = k === SENSE.fan ? ty : ty + (k / SENSE.fan) * TAU - PI;
    const ex = m.x + dsin(yaw) * reach;
    const ez = m.z + dcos(yaw) * reach;
    let cost = senses.danger(sim, yaw, v, plowShare);
    cost += groundCost(sim, ex, ez, climbCost);
    cost += senses.crowdAt(ex, ez) * SENSE.openCost;
    cost += Math.abs(angleDiff(yaw, ty)) * SENSE.turnCost;
    if (extra) cost += extra(yaw);
    if (cost < best) {
      best = cost;
      bestYaw = yaw;
    }
  }
  out.yaw = bestYaw;
  out.cost = best;
}

/** Holds the stick, never tucks or hops; steers away from the crowd and the rim, toward open ground. */
export function makeEvader(): Bot {
  const senses = new Senses();
  const c: Choice = { yaw: 0, cost: 0 };
  return (sim, out) => {
    senses.look(sim);
    choose(sim, senses, c, SENSE.climbCost, 1, null);
    stickToward(sim, c.yaw, 1, out);
    out.hop = false;
  };
}

const LOOP = {
  /** A loop is started when at least this many risen enemies are within 12 m, behind the mover. */
  crowd: 4,
  /** The circle's length as a share of the trail: room to close it before the tail fades. */
  fill: 0.9,
  /** Smallest and largest circle radius, m. */
  minR: 3.6,
  maxR: 8,
  /** How hard the bot pulls back onto the circle per metre off it, rad. */
  pull: 0.35,
  /** Cost per radian away from the circle's heading: careful, and bold while health is above boldHp. */
  follow: 0.6,
  followBold: 2,
  boldHp: 85,
  /** Give up a loop after this many laps without a pop. */
  maxLaps: 1.6,
} as const;

/**
 * The evader, but when a crowd is following close behind it rides a circle beside it, tight enough
 * to fit in the trail, and closes the loop round whatever followed it in. While healthy it holds the
 * circle boldly; when hurt it lets the evader's caution pull it off. One loop per circle; then it
 * looks again.
 */
export function makeLooper(): Bot {
  const senses = new Senses();
  const c: Choice = { yaw: 0, cost: 0 };
  let looping = false;
  let ox = 0;
  let oz = 0;
  let radius = 0;
  /** +1 turning left (anticlockwise seen from above), -1 right. */
  let spin = 1;
  let turned = 0;
  let lastYaw = 0;
  let pops = 0;

  const orbit: Extra = (yaw) => {
    if (!looping) return 0;
    return Math.abs(angleDiff(yaw, orbitYaw)) * followNow;
  };
  let orbitYaw = 0;
  let followNow: number = LOOP.follow;

  return (sim, out) => {
    const m = sim.state.mover;
    const w = sim.world;
    senses.look(sim);
    if (w.player.pops !== pops) {
      pops = w.player.pops;
      looping = false;
    }
    followNow = w.player.hp > LOOP.boldHp ? LOOP.followBold : LOOP.follow;
    const ty = travelYaw(m);
    if (looping) {
      turned += Math.abs(angleDiff(ty, lastYaw));
      if (turned > TAU * LOOP.maxLaps) looping = false;
    }
    lastYaw = ty;
    // A crowd following behind is one that will follow the circle in; one ahead would be ridden into.
    const behind = (senses.cx - m.x) * dsin(ty) + (senses.cz - m.z) * dcos(ty) < 0;
    if (!looping && senses.near12 >= LOOP.crowd && behind && w.player.loadout.weaponLevel[W_WAKE] > 0) {
      // Start a circle tangent to the current path, on the side the crowd is.
      const len = wakeLength(w, m.gear) * LOOP.fill;
      radius = Math.min(LOOP.maxR, Math.max(LOOP.minR, len / TAU));
      const side = (senses.cx - m.x) * dcos(ty) - (senses.cz - m.z) * dsin(ty);
      // forward (sin, cos); left of it is (cos, -sin) in this yaw convention when side > 0.
      spin = side >= 0 ? 1 : -1;
      ox = m.x + dcos(ty) * radius * spin;
      oz = m.z - dsin(ty) * radius * spin;
      looping = true;
      turned = 0;
    }
    if (looping) {
      // Heading along the circle, pulled back onto it when off.
      const toCentre = yawTo(m, ox, oz);
      const off = len2(m.x - ox, m.z - oz) - radius;
      const pull = Math.max(-1.2, Math.min(1.2, off * LOOP.pull));
      orbitYaw = toCentre - spin * (PI / 2 - pull);
    }
    choose(sim, senses, c, SENSE.climbCost, 1, orbit);
    stickToward(sim, c.yaw, 1, out);
    out.hop = false;
  };
}

const RIDE = {
  /** Danger on the line above which the rider leaves it, in gear 3 and up. */
  worry: 1,
  /** Cost per radian away from the liner's line while dodging in gear 3 and up. */
  followLine: 1.2,
  /** Share of danger a plowable enemy counts for, with speed to spare. */
  plowShare: 0,
  /** Speed above the gear-3 floor below which plowables count fully again, m/s. */
  plowSpare: 1.5,
  /** Below gear 3: cost per radian away from the line while dodging. */
  followLow: 1.2,
  /** Below gear 3: danger under which the rider lets go to tuck down a falling heading. */
  tuckSafe: 0.15,
  /** Below gear 3: danger on the line above which the rider dodges. */
  worryLow: 0.5,
} as const;

/**
 * Plays lines like the liner (tucks downhill, clean hops, pads and pipes) but sees the horde. In
 * gear 3 and up it keeps the liner's line, rides straight through what it plows and steers only
 * round bollards and what it cannot plow. Below gear 3 it also keeps the line, which is how speed
 * comes back, and leaves it only to dodge, as close to the line as is safe, tucking again as soon as
 * it is pointed down a slope with nothing close.
 *
 * Every dodge costs speed. Run over seeds 1 to 5, a rider that dodged more reached gear 3 less and
 * died sooner; one that never dodged below gear 3 did about as well as this one.
 */
export function makeRider(bowl: Bowl): Bot {
  const liner = makeLiner(bowl);
  const senses = new Senses();
  const c: Choice = { yaw: 0, cost: 0 };
  let lineYaw = 0;
  let followCost = 0;
  const follow: Extra = (yaw) => Math.abs(angleDiff(yaw, lineYaw)) * followCost;

  return (sim, out) => {
    const m = sim.state.mover;
    liner(sim, out);
    if (!m.grounded) return;
    senses.look(sim);
    const ty = travelYaw(m);
    // Where the liner wants to go: its stick, or straight on while it tucks.
    lineYaw = out.carve ? sim.state.viewYaw - datan2(out.steerX, out.steerY) : ty;
    const v = Math.max(m.speed, SENSE.minSpeed);
    const spare = m.speed - (FEEL.gear3 - FEEL.gearHyst);
    if (m.gear >= PLOW_GEAR[0] && spare > RIDE.plowSpare) {
      if (senses.danger(sim, lineYaw, v, RIDE.plowShare) < RIDE.worry) return;
      followCost = RIDE.followLine;
      choose(sim, senses, c, 0, RIDE.plowShare, follow);
      if (Math.abs(angleDiff(c.yaw, lineYaw)) < 0.05) return;
      stickToward(sim, c.yaw, 1, out);
      out.hop = false;
      return;
    }
    // Below gear 3: the line is how speed comes back, so keep it unless something is about to hit.
    if (senses.danger(sim, lineYaw, v, 1) < RIDE.worryLow) return;
    followCost = RIDE.followLow;
    choose(sim, senses, c, 0, 1, follow);
    if (Math.abs(angleDiff(c.yaw, lineYaw)) < 0.05) return;
    out.hop = false;
    const look = Math.max(3, m.speed * 0.3);
    const falls = sim.terrain.heightAt(m.x + dsin(ty) * look, m.z + dcos(ty) * look) < m.y - 0.02 * look;
    if (falls && Math.abs(angleDiff(c.yaw, ty)) < 0.1 && senses.danger(sim, ty, v, 1) < RIDE.tuckSafe) letGo(out);
    else stickToward(sim, c.yaw, 1, out);
  };
}
