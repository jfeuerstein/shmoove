/**
 * The horde moves: every enemy closes on the mover as part of a crowd.
 *
 * Each tick an enemy either rises (does nothing), is thrown (slides without steering until it
 * stops), or steers: it accelerates toward a wanted velocity no faster than its kind allows.
 * Shufflers, bollards, sludges and clingers walk straight at the mover; gnats aim a little ahead of
 * it and weave, so a cloud reads as a swarm; cutters run for where it will be; lobbers keep their
 * distance and lob. Bodies then push apart, the lighter one giving way. Enemies far from the mover
 * are stepped every fourth tick with a four-tick step and no separation: the crowd you cannot see
 * costs a quarter as much.
 *
 * A clinger that has latched on rides the mover. A sludge leaves tar as it goes. Elites carry an
 * aura: haste (those near it steer faster), shield (those near it are marked shielded) and jam
 * (sparks near it are not pulled by the magnet; see `jammed`).
 *
 * Pure and allocation-free after a world's first tick: scratch lives at module level.
 */
import { DT, FEEL } from './constants';
import { dropTar, HAZARDS, lob } from './hazards';
import { dcos, dsin, TAU } from './math';
import type { Terrain } from './terrain';
import type { SimState } from './types';
import {
  ELITE_HASTE,
  ELITE_JAM,
  ELITE_NONE,
  ELITE_SHIELD,
  KIND_CUTTER,
  KIND_GNAT,
  KIND_LOBBER,
  KIND_SLUDGE,
  KINDS,
  MARK_SHIELDED,
  MAX_ENEMIES,
  queryEnemies,
  rebuildGrid,
  SPAWN_TICKS,
  STATE_LATCHED,
  type World,
} from './world';

/** How the horde moves. Speeds and accelerations per kind are in `KINDS`. */
export const HORDE = {
  /** A thrown enemy slows at this rate until it stops, m/s2. */
  throwDecel: 8,
  /** Gnats aim at the mover's position plus this much of its velocity, s. */
  gnatLead: 0.4,
  /** How far a gnat's heading swings to the side: sideways share of the wanted direction. */
  gnatWeave: 0.8,
  /** Weaves per second. */
  gnatWeaveHz: 0.6,
  /** Inside this distance of its aim point a gnat stops weaving and homes in, m. */
  gnatHome: 4,
  /** Enemies stay within this share of the terrain's radius, off the rim. */
  region: 0.86,
  /** Beyond this distance from the mover an enemy is stepped coarsely, m. */
  farDist: 70,
  /** A far enemy is stepped once every this many ticks, with a step this many ticks long. */
  farEvery: 4,
  /** Share of an overlap removed per tick between two bodies. */
  pushShare: 0.6,
  /**
   * A cutter aims where the mover will be after this long, s; or, if it could get there sooner,
   * after that long, so that close up it meets the mover instead of running on ahead of it.
   */
  cutterLead: 1.2,
  /** A lobber closes in when farther than lobberFar and backs off when nearer than lobberNear, m. */
  lobberNear: 14,
  lobberFar: 22,
  /** A latched clinger rides this far from the mover's centre, m. */
  rideOffset: 0.75,
  /** An elite's aura reaches this far, m. */
  auraReach: 8,
  /** Enemies in a haste aura steer this much faster ... */
  haste: 1.25,
  /** ... but never past this share of gear 3's floor (and never slower than their own speed). */
  hasteCap: 0.95,
  /** Sparks this near a jam elite are not pulled by the magnet, m. */
  jamReach: 10,
} as const;

const AGE_MAX = 65535;
/** Widest body in KINDS, plus what anything can move in a tick, for neighbour queries, m. */
const QUERY_PAD = Math.max(...KINDS.map((k) => k.radius)) + 0.3;

const MOVED_NEAR = 1;
const MOVED_FAR = 2;
/** Per enemy this tick: 0 if it did not move, else MOVED_*. Only near movers take part in separation. */
const moved = new Uint8Array(MAX_ENEMIES);

/** Most elites whose auras are kept track of at once; beyond this the rest have none. */
const MAX_AURAS = 32;

/** The risen elites of one world, as last found by its horde step. */
interface Auras {
  count: number;
  /** Index in the horde: valid only inside the horde step. */
  idx: Int16Array;
  aura: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  /** How many of each kind of aura, to skip the work when there are none. */
  haste: number;
  shield: number;
  jam: number;
}

const auraStates = new WeakMap<World, Auras>();

function aurasOf(w: World): Auras {
  let a = auraStates.get(w);
  if (a === undefined) {
    a = {
      count: 0,
      idx: new Int16Array(MAX_AURAS),
      aura: new Uint8Array(MAX_AURAS),
      x: new Float32Array(MAX_AURAS),
      z: new Float32Array(MAX_AURAS),
      haste: 0,
      shield: 0,
      jam: 0,
    };
    auraStates.set(w, a);
  }
  return a;
}

/** Find the risen, living elites and where they stand. */
function findAuras(w: World, a: Auras): void {
  const h = w.horde;
  a.count = 0;
  a.haste = 0;
  a.shield = 0;
  a.jam = 0;
  for (let i = 0; i < h.count && a.count < MAX_AURAS; i++) {
    const e = h.elite[i];
    if (e === ELITE_NONE || h.age[i] < SPAWN_TICKS || h.hp[i] <= 0) continue;
    const k = a.count++;
    a.idx[k] = i;
    a.aura[k] = e;
    a.x[k] = h.x[i];
    a.z[k] = h.z[i];
    if (e === ELITE_HASTE) a.haste++;
    else if (e === ELITE_SHIELD) a.shield++;
    else if (e === ELITE_JAM) a.jam++;
  }
}

/** Is enemy i inside an aura of type `aura` other than its own? */
function inAura(w: World, a: Auras, i: number, aura: number): boolean {
  const h = w.horde;
  const r2 = HORDE.auraReach * HORDE.auraReach;
  for (let k = 0; k < a.count; k++) {
    if (a.aura[k] !== aura || a.idx[k] === i) continue;
    const dx = h.x[i] - a.x[k];
    const dz = h.z[i] - a.z[k];
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/**
 * Is a spark at (x, z) inside a jam elite's aura, so the magnet must leave it alone? Goes by where
 * the elites stood after this tick's horde step.
 */
export function jammed(w: World, x: number, z: number): boolean {
  const a = auraStates.get(w);
  if (a === undefined || a.jam === 0) return false;
  const r2 = HORDE.jamReach * HORDE.jamReach;
  for (let k = 0; k < a.count; k++) {
    if (a.aura[k] !== ELITE_JAM) continue;
    const dx = x - a.x[k];
    const dz = z - a.z[k];
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

function steer(w: World, i: number, wantX: number, wantZ: number, accel: number, dt: number): void {
  const h = w.horde;
  const dx = wantX - h.vx[i];
  const dz = wantZ - h.vz[i];
  const d = Math.sqrt(dx * dx + dz * dz);
  const max = accel * dt;
  if (d <= max) {
    h.vx[i] = wantX;
    h.vz[i] = wantZ;
  } else {
    const k = max / d;
    h.vx[i] += dx * k;
    h.vz[i] += dz * k;
  }
}

/**
 * How far ahead a cutter aims, s: the time at which running straight at `speed` would meet a mover
 * at offset (ox, oz) moving at (vx, vz), held to `HORDE.cutterLead`. Close up that is soon, so it
 * meets the mover instead of running on ahead of it.
 */
function interceptTime(ox: number, oz: number, vx: number, vz: number, speed: number): number {
  const a = vx * vx + vz * vz - speed * speed;
  const b = ox * vx + oz * vz;
  const c = ox * ox + oz * oz;
  let t: number = HORDE.cutterLead;
  if (a < -1e-6) {
    // a t^2 + 2 b t + c = 0 with a < 0 and c >= 0: one root is never negative.
    const root = (-b - Math.sqrt(b * b - a * c)) / a;
    if (root < t) t = root;
  }
  return t;
}

/** Move enemy i by one step of `dt` seconds: steer (at up to `speed`) or slide, then advance. */
function move(w: World, s: SimState, i: number, thrown: boolean, dt: number, time: number, speed: number): void {
  const h = w.horde;
  const m = s.mover;
  if (thrown) {
    const v = Math.sqrt(h.vx[i] * h.vx[i] + h.vz[i] * h.vz[i]);
    const slow = HORDE.throwDecel * dt;
    if (v <= slow) {
      h.vx[i] = 0;
      h.vz[i] = 0;
    } else {
      const k = (v - slow) / v;
      h.vx[i] *= k;
      h.vz[i] *= k;
    }
  } else {
    const kindId = h.kind[i];
    const kind = KINDS[kindId];
    let tx = m.x;
    let tz = m.z;
    const gnat = kindId === KIND_GNAT;
    if (gnat) {
      tx += m.vx * HORDE.gnatLead;
      tz += m.vz * HORDE.gnatLead;
    } else if (kindId === KIND_CUTTER) {
      const lead = interceptTime(m.x - h.x[i], m.z - h.z[i], m.vx, m.vz, speed);
      tx += m.vx * lead;
      tz += m.vz * lead;
    }
    let dx = tx - h.x[i];
    let dz = tz - h.z[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) {
      steer(w, i, 0, 0, kind.accel, dt);
    } else if (kindId === KIND_LOBBER) {
      // Hold the band: in when too far, out when too near, still in between.
      const k = d > HORDE.lobberFar ? speed / d : d < HORDE.lobberNear ? -speed / d : 0;
      steer(w, i, dx * k, dz * k, kind.accel, dt);
    } else {
      dx /= d;
      dz /= d;
      if (gnat) {
        // Swing the heading to either side, out of step with the rest of the cloud.
        const fade = d < HORDE.gnatHome ? d / HORDE.gnatHome : 1;
        const side = HORDE.gnatWeave * fade * dsin(TAU * (h.phase[i] + time * HORDE.gnatWeaveHz));
        const ux = dx - dz * side;
        const uz = dz + dx * side;
        const ul = Math.sqrt(ux * ux + uz * uz);
        dx = ux / ul;
        dz = uz / ul;
      }
      steer(w, i, dx * speed, dz * speed, kind.accel, dt);
    }
  }
  h.x[i] += h.vx[i] * dt;
  h.z[i] += h.vz[i] * dt;
  if (h.kind[i] === KIND_SLUDGE) {
    // Distance toward the next patch of tar, kept in millimetres.
    const mm = h.timer[i] + Math.round(Math.sqrt(h.vx[i] * h.vx[i] + h.vz[i] * h.vz[i]) * dt * 1000);
    h.timer[i] = mm > 65535 ? 65535 : mm;
  }
}

/** A latched clinger rides the mover, at its own place around it. */
function ride(w: World, s: SimState, i: number): void {
  const h = w.horde;
  const m = s.mover;
  const a = TAU * h.phase[i];
  h.x[i] = m.x + dsin(a) * HORDE.rideOffset;
  h.y[i] = m.y;
  h.z[i] = m.z + dcos(a) * HORDE.rideOffset;
  h.vx[i] = m.vx;
  h.vz[i] = m.vz;
}

/** Push overlapping risen, near bodies apart. A heavier body does not give way to a lighter one. */
function separate(w: World): void {
  const h = w.horde;
  for (let i = 0; i < h.count; i++) {
    if (moved[i] !== MOVED_NEAR) continue;
    const ri = KINDS[h.kind[i]].radius;
    const wi = KINDS[h.kind[i]].weight;
    const n = queryEnemies(w, h.x[i], h.z[i], ri + QUERY_PAD, w.nearA);
    for (let q = 0; q < n; q++) {
      const j = w.nearA[q];
      if (j <= i || moved[j] !== MOVED_NEAR) continue;
      const kj = KINDS[h.kind[j]];
      const reach = ri + kj.radius;
      let dx = h.x[j] - h.x[i];
      let dz = h.z[j] - h.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        // On the same spot: part them along a direction fixed by their phases.
        const a = TAU * (h.phase[i] - h.phase[j] + 0.37 * (j - i));
        dx = dsin(a);
        dz = dcos(a);
      } else {
        dx /= d;
        dz /= d;
      }
      const push = (reach - d) * HORDE.pushShare;
      const shareJ = wi > kj.weight ? 1 : wi < kj.weight ? 0 : 0.5;
      const shareI = 1 - shareJ;
      h.x[i] -= dx * push * shareI;
      h.z[i] -= dz * push * shareI;
      h.x[j] += dx * push * shareJ;
      h.z[j] += dz * push * shareJ;
    }
  }
}

/**
 * Advance every enemy one tick: age, steering or sliding, separation, ground and the rim. Lobbers
 * lob, sludges leave tar, latched clingers ride, and the elites' auras are worked out.
 */
export function stepHorde(w: World, s: SimState, terrain: Terrain): void {
  const h = w.horde;
  const m = s.mover;
  rebuildGrid(w);
  const tick = w.run.ticks;
  const time = tick * DT;
  const far2 = HORDE.farDist * HORDE.farDist;
  const every = HORDE.farEvery;
  const auras = aurasOf(w);
  findAuras(w, auras);
  const hasteMax = FEEL.gear3 * HORDE.hasteCap;
  const lobRange2 = HAZARDS.lobRange * HAZARDS.lobRange;
  const lobEvery = Math.round(HAZARDS.lobEvery / DT);
  let latched = 0;

  for (let i = 0; i < h.count; i++) {
    const thrown = h.stun[i] > 0;
    if (h.flash[i] > 0) h.flash[i]--;
    if (thrown) h.stun[i]--;
    moved[i] = 0;
    if (h.age[i] < SPAWN_TICKS) {
      h.age[i]++;
      h.vx[i] = 0;
      h.vz[i] = 0;
      continue;
    }
    if (h.age[i] < AGE_MAX) h.age[i]++;
    const kind = KINDS[h.kind[i]];
    if (h.state[i] === STATE_LATCHED && kind.latches === true) {
      ride(w, s, i);
      latched++;
      continue;
    }
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    const d2 = dx * dx + dz * dz;
    if (h.kind[i] === KIND_LOBBER && !thrown && d2 <= lobRange2) {
      h.timer[i]++;
      if (h.timer[i] >= lobEvery) {
        h.timer[i] = 0;
        lob(w, terrain, m.x + m.vx * HAZARDS.lobLead, m.z + m.vz * HAZARDS.lobLead);
      }
    }
    let speed = kind.speed;
    if (auras.haste > 0 && inAura(w, auras, i, ELITE_HASTE)) {
      const fast = speed * HORDE.haste;
      speed = fast < hasteMax ? fast : hasteMax > speed ? hasteMax : speed;
    }
    if (d2 > far2) {
      if ((i + tick) % every !== 0) continue;
      move(w, s, i, thrown, DT * every, time, speed);
      moved[i] = MOVED_FAR;
    } else {
      move(w, s, i, thrown, DT, time, speed);
      moved[i] = MOVED_NEAR;
    }
  }
  // What is holding on now, before contact adds to it.
  w.player.latched = latched;

  separate(w);

  const rMax = HORDE.region * terrain.radius;
  const rMax2 = rMax * rMax;
  const tarMm = HAZARDS.tarEvery * 1000;
  for (let i = 0; i < h.count; i++) {
    if (moved[i] === 0) continue;
    const x = h.x[i];
    const z = h.z[i];
    const r2 = x * x + z * z;
    if (r2 > rMax2) {
      const r = Math.sqrt(r2);
      const k = rMax / r;
      h.x[i] = x * k;
      h.z[i] = z * k;
      const ox = x / r;
      const oz = z / r;
      const out = h.vx[i] * ox + h.vz[i] * oz;
      if (out > 0) {
        h.vx[i] -= ox * out;
        h.vz[i] -= oz * out;
      }
    }
    h.y[i] = terrain.heightAt(h.x[i], h.z[i]);
    if (h.kind[i] === KIND_SLUDGE && h.timer[i] >= tarMm) {
      h.timer[i] -= tarMm;
      dropTar(w, h.x[i], h.y[i], h.z[i]);
    }
  }

  // Shields go by where the elites stand now; so does the jam, read later by the sparks.
  for (let k = 0; k < auras.count; k++) {
    auras.x[k] = h.x[auras.idx[k]];
    auras.z[k] = h.z[auras.idx[k]];
  }
  for (let i = 0; i < h.count; i++) {
    h.mark[i] &= ~MARK_SHIELDED;
    if (auras.shield > 0 && inAura(w, auras, i, ELITE_SHIELD)) h.mark[i] |= MARK_SHIELDED;
  }
}
