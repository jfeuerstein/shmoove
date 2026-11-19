/**
 * The bots that play the feel slice. Each factory returns a `Bot` with its own state; a bot only
 * reads `sim.state` and `sim.terrain` (and, for the line bots, the bowl's feature list, which a
 * player learns by looking) and writes one `InputFrame` per tick.
 */
import type { Bowl } from '../../../src/sim/bowl';
import { DT, FEEL } from '../../../src/sim/constants';
import { angleDiff, datan2, dcos, dsin, len2, PI, TAU } from '../../../src/sim/math';
import { Rng } from '../../../src/sim/rng';
import type { Sim } from '../../../src/sim/sim';
import type { Terrain } from '../../../src/sim/terrain';
import { letGo, stickToward, travelYaw, yawTo, type Bot } from './steer';

/** Never touches the screen. */
export function makeTucker(): Bot {
  return (_sim, out) => {
    letGo(out);
    out.hop = false;
  };
}

/** The carver turns back toward the middle beyond this radius: the rim is for riders with speed. */
const CARVER_HOME_R = 110;

/**
 * Holds the stick at full travel the whole time, steering along a slow wander. Never tucks, never
 * hops. What the stick alone can do.
 */
export function makeCarver(seed: number): Bot {
  const rng = new Rng(seed * 2654435761 + 1);
  let yaw = 0;
  let rate = 0;
  let next = 0;
  let started = false;
  return (sim, out) => {
    const m = sim.state.mover;
    if (!started) {
      yaw = m.heading;
      started = true;
    }
    if (next <= 0) {
      next = 60 + rng.int(120);
      rate = rng.range(-0.8, 0.8);
    }
    next--;
    yaw += rate * DT;
    if (len2(m.x, m.z) > CARVER_HOME_R) {
      const home = yawTo(m, 0, 0);
      yaw = home + angleDiff(yaw, home) * 0.5;
    }
    if (yaw > PI) yaw -= TAU;
    else if (yaw < -PI) yaw += TAU;
    stickToward(sim, yaw, 1, out);
    out.hop = false;
  };
}

type TargetKind = 'pipe' | 'pipeLow' | 'pad' | 'kicker' | 'crater';

/** A place on the bowl the line bots aim for. */
interface Target {
  kind: TargetKind;
  x: number;
  z: number;
  /** The way to leave it, for pipes and kickers; NaN when any way will do. */
  exitYaw: number;
  /** Closer than this counts as there, m. A pad has to be ridden onto. */
  reach: number;
  /** Index of the target that has to come next (a pipe's high end leads down to its low end), or -1. */
  then: number;
}

/** How the line bots play. Chosen by running them over seeds 1 to 10, not by feel. */
const LINER = {
  /** A target counts as reached within this distance, m. */
  reach: 9,
  /** Start carving when the line is this far off, rad; stop once within aimDone. */
  aimStart: 0.25,
  aimDone: 0.06,
  /** A landing this far off the line is not hopped out of: the line needs the ground to turn. */
  hopAlign: 1.2,
  /** A chain is started on ground that does not fall once at this share of run speed. */
  chainFrom: 0.8,
  /** Lookahead for "the ground ahead falls", s of travel, and its least length, m. */
  lookS: 0.3,
  lookMin: 3,
  /** Ground ahead that falls more than this per metre counts as falling. */
  falls: 0.02,
  /** Choosing the next target: seconds of cost per radian of turn on the way in and on the way out. */
  turnIn: 3,
  turnOut: 1,
  /** Seconds of cost per metre of climb to the target. */
  climb: 0.05,
  /** What each kind of target is worth, s. */
  padWorth: 5,
  pipeWorth: 8,
  kickerWorth: 1,
  craterWorth: 0.5,
  /** Targets nearer than this are not picked, m. */
  minDist: 18,
  /** How many targets back are not picked again. */
  memory: 3,
  /** Hops stop this many seconds of travel before a pad, so the mover is on the ground over it. */
  padGround: 0.75,
  /** How far off a pad's middle the line may pass, m. */
  padMiss: 1.2,
} as const;

/** How far back the drop-in of a pipe starts from its high end, m. */
const PIPE_DROP_IN = 6;

function buildTargets(bowl: Bowl, terrain: Terrain): Target[] {
  const out: Target[] = [];
  const f = bowl.features;
  for (const p of f.pipes) {
    const yaw = datan2(p.x1 - p.x0, p.z1 - p.z0);
    out.push({
      kind: 'pipe',
      x: p.x0 - dsin(yaw) * PIPE_DROP_IN,
      z: p.z0 - dcos(yaw) * PIPE_DROP_IN,
      exitYaw: yaw,
      reach: LINER.reach,
      then: out.length + 1,
    });
    out.push({ kind: 'pipeLow', x: p.x1, z: p.z1, exitYaw: yaw, reach: LINER.reach, then: -1 });
  }
  for (const k of f.kickers) out.push({ kind: 'kicker', x: k.x, z: k.z, exitYaw: k.yaw, reach: LINER.reach, then: -1 });
  for (const pad of terrain.pads) out.push({ kind: 'pad', x: pad.x, z: pad.z, exitYaw: NaN, reach: pad.radius, then: -1 });
  out.push({ kind: 'crater', x: f.crater.x, z: f.crater.z, exitYaw: NaN, reach: LINER.reach, then: -1 });
  return out;
}

function worth(kind: TargetKind): number {
  switch (kind) {
    case 'pad':
      return LINER.padWorth;
    case 'pipe':
      return LINER.pipeWorth;
    case 'kicker':
      return LINER.kickerWorth;
    case 'crater':
      return LINER.craterWorth;
    default:
      return 0;
  }
}

export interface LinerOptions {
  /**
   * Masher mode: taps hop at random, with this chance per tick, and never on purpose at a landing.
   * Left out, the bot hops clean out of every landing on its line.
   */
  randomHop?: { seed: number; perTick: number };
}

/**
 * Plays the bowl well. Starts at the high end of the nearest half-pipe and tucks down it, then keeps
 * picking the next line the way a player who knows the bowl would: the target (the other pipe, a
 * kicker, a boost pad, the crater) that is worth the most for the least turning and climbing.
 * Tucks whenever the ground ahead falls or it is above run speed, carves only to aim (and to push up
 * to run speed where the ground does not help), hops clean out of every landing on its line, starts
 * a chain on purpose where the ground does not fall, air-steers in the chain, and stays on the
 * ground over a pad.
 */
export function makeLiner(bowl: Bowl, opts: LinerOptions = {}): Bot {
  const rng = opts.randomHop ? new Rng(opts.randomHop.seed * 40503 + 7) : null;
  const perTick = opts.randomHop ? opts.randomHop.perTick : 0;
  let targets: Target[] = [];
  const recent: number[] = [];
  let cur = -1;
  /** Where the mover was when the current target was picked: passing the target ends the leg too. */
  let fromX = 0;
  let fromZ = 0;
  let aiming = true;

  function choose(sim: Sim, first: boolean): void {
    const m = sim.state.mover;
    const prev = cur;
    if (prev >= 0) {
      recent.push(prev);
      if (recent.length > LINER.memory) recent.shift();
    }
    let pick = -1;
    if (prev >= 0 && targets[prev].then >= 0) pick = targets[prev].then;
    if (pick < 0 && first) {
      let best = Infinity;
      for (let i = 0; i < targets.length; i++) {
        if (targets[i].kind !== 'pipe') continue;
        const d = len2(targets[i].x - m.x, targets[i].z - m.z);
        if (d < best) {
          best = d;
          pick = i;
        }
      }
    }
    if (pick < 0) {
      const ty = travelYaw(m);
      const v = Math.max(m.speed, FEEL.runSpeed);
      let best = Infinity;
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (t.kind === 'pipeLow' || i === prev || recent.includes(i)) continue;
        const d = len2(t.x - m.x, t.z - m.z);
        if (d < LINER.minDist) continue;
        const inYaw = yawTo(m, t.x, t.z);
        let cost = d / v + LINER.turnIn * Math.abs(angleDiff(inYaw, ty)) - worth(t.kind);
        if (!Number.isNaN(t.exitYaw)) cost += LINER.turnOut * Math.abs(angleDiff(t.exitYaw, inYaw));
        const climb = sim.terrain.heightAt(t.x, t.z) - m.y;
        if (climb > 0) cost += LINER.climb * climb;
        if (cost < best) {
          best = cost;
          pick = i;
        }
      }
    }
    cur = pick;
    fromX = m.x;
    fromZ = m.z;
    aiming = true;
  }

  return (sim, out) => {
    const m = sim.state.mover;
    if (cur < 0) {
      targets = buildTargets(bowl, sim.terrain);
      choose(sim, true);
    }
    out.hop = false;

    let t = targets[cur];
    const past = (m.x - t.x) * (t.x - fromX) + (m.z - t.z) * (t.z - fromZ) > 0;
    if (len2(t.x - m.x, t.z - m.z) < t.reach || past) {
      choose(sim, false);
      t = targets[cur];
    }

    const want = yawTo(m, t.x, t.z);
    const ty = travelYaw(m);
    const err = Math.abs(angleDiff(want, ty));
    const dist = len2(t.x - m.x, t.z - m.z);
    const padNear = t.kind === 'pad' && dist < m.speed * LINER.padGround + 3;

    if (!m.grounded) {
      // Air-steer toward the line; the thumb is down, which is all the air asks.
      stickToward(sim, want, 1, out);
    } else {
      const speed = m.speed;
      const look = Math.max(LINER.lookMin, speed * LINER.lookS);
      const ax = m.x + dsin(ty) * look;
      const az = m.z + dcos(ty) * look;
      const falls = sim.terrain.heightAt(ax, az) < m.y - LINER.falls * look;
      // A pad is small: the aim tightens as it comes closer, so the line crosses it.
      const tight = t.kind === 'pad' ? Math.min(1, LINER.padMiss / (dist * LINER.aimStart)) : 1;
      if (aiming && err < LINER.aimDone * tight) aiming = false;
      if (!aiming && err > LINER.aimStart * tight) aiming = true;
      const push = speed < FEEL.runSpeed - 0.3 && !falls;
      if (aiming || push) stickToward(sim, want, 1, out);
      else letGo(out);
      if (!rng && !padNear) {
        // Every landing on the line is hopped out of clean; on ground that does not fall, a chain
        // is started on purpose.
        if (m.landPending) out.hop = err < LINER.hopAlign;
        else out.hop = !falls && !aiming && speed >= FEEL.runSpeed * LINER.chainFrom;
      }
    }
    if (rng && rng.chance(perTick)) out.hop = true;
  };
}

/** Liner's steering, with hop taps at random times that have nothing to do with landings. */
export function makeMasher(bowl: Bowl, seed: number): Bot {
  return makeLiner(bowl, { randomHop: { seed, perTick: 1 / 40 } });
}
