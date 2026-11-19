/**
 * The horde moves: every enemy closes on the mover as part of a crowd.
 *
 * Each tick an enemy either rises (does nothing), is thrown (slides without steering until it
 * stops), or steers: it accelerates toward a wanted velocity no faster than its kind allows.
 * Shufflers and bollards walk straight at the mover; gnats aim a little ahead of it and weave, so a
 * cloud reads as a swarm. Bodies then push apart, the lighter one giving way. Enemies far from the
 * mover are stepped every fourth tick with a four-tick step and no separation: the crowd you cannot
 * see costs a quarter as much.
 *
 * Pure and allocation-free: scratch lives at module level.
 */
import { DT } from './constants';
import { dcos, dsin, TAU } from './math';
import type { Terrain } from './terrain';
import type { SimState } from './types';
import { KIND_GNAT, KINDS, MAX_ENEMIES, queryEnemies, rebuildGrid, SPAWN_TICKS, type World } from './world';

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
} as const;

const AGE_MAX = 65535;
/** Widest body in KINDS, plus what anything can move in a tick, for neighbour queries, m. */
const QUERY_PAD = Math.max(...KINDS.map((k) => k.radius)) + 0.3;

const MOVED_NEAR = 1;
const MOVED_FAR = 2;
/** Per enemy this tick: 0 if it did not move, else MOVED_*. Only near movers take part in separation. */
const moved = new Uint8Array(MAX_ENEMIES);

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

/** Move enemy i by one step of `dt` seconds: steer or slide, then advance. */
function move(w: World, s: SimState, i: number, thrown: boolean, dt: number, time: number): void {
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
    const kind = KINDS[h.kind[i]];
    let tx = m.x;
    let tz = m.z;
    const gnat = h.kind[i] === KIND_GNAT;
    if (gnat) {
      tx += m.vx * HORDE.gnatLead;
      tz += m.vz * HORDE.gnatLead;
    }
    let dx = tx - h.x[i];
    let dz = tz - h.z[i];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) {
      steer(w, i, 0, 0, kind.accel, dt);
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
      steer(w, i, dx * kind.speed, dz * kind.speed, kind.accel, dt);
    }
  }
  h.x[i] += h.vx[i] * dt;
  h.z[i] += h.vz[i] * dt;
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

/** Advance every enemy one tick: age, steering or sliding, separation, ground and the rim. */
export function stepHorde(w: World, s: SimState, terrain: Terrain): void {
  const h = w.horde;
  const m = s.mover;
  rebuildGrid(w);
  const tick = w.run.ticks;
  const time = tick * DT;
  const far2 = HORDE.farDist * HORDE.farDist;
  const every = HORDE.farEvery;

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
    const dx = h.x[i] - m.x;
    const dz = h.z[i] - m.z;
    if (dx * dx + dz * dz > far2) {
      if ((i + tick) % every !== 0) continue;
      move(w, s, i, thrown, DT * every, time);
      moved[i] = MOVED_FAR;
    } else {
      move(w, s, i, thrown, DT, time);
      moved[i] = MOVED_NEAR;
    }
  }

  separate(w);

  const rMax = HORDE.region * terrain.radius;
  const rMax2 = rMax * rMax;
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
  }
}
