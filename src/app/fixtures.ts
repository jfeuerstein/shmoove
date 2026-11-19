/**
 * The crowd fixture (`?horde=N&sparks=M`), for perf runs and screenshots: the spawn director off,
 * N enemies (about 80% shufflers, 15% gnats, 5% bollards) already risen, and M sparks, scattered
 * evenly over a disc of `FIXTURE_RADIUS` around the spawn, none within `FIXTURE_CLEAR` of it and
 * none outside the map. The same seed always gives the same crowd.
 *
 * A fixture is a stage to look at and measure, not a run to lose: the player's health is raised
 * so that walking through the crowd for the length of a measurement cannot end it.
 */
import { Rng, hashString } from '../sim/rng';
import type { Sim } from '../sim/sim';
import { KIND_BOLLARD, KIND_GNAT, KIND_SHUFFLER, KINDS, MAX_ENEMIES, MAX_SPARKS, SPAWN_TICKS, spawnEnemy } from '../sim/world';

export const FIXTURE_RADIUS = 60;
export const FIXTURE_CLEAR = 8;
/** Kept this far inside the map's edge, m. */
const EDGE_CLEAR = 4;
/** Health the player is given on a fixture. */
export const FIXTURE_HP = 1_000_000;

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

/** Put the crowd on `sim`'s map. Counts are clamped to what the world holds. */
export function applyFixture(sim: Sim, enemies: number, sparks: number): void {
  const w = sim.world;
  const t = sim.terrain;
  w.spawning = false;
  const rng = new Rng(hashString('fixture', w.seed));
  const p = { x: 0, z: 0 };

  const ne = Math.min(MAX_ENEMIES - w.horde.count, Math.max(0, Math.floor(enemies)));
  for (let n = 0; n < ne; n++) {
    const roll = rng.next();
    const kind = roll < 0.8 ? KIND_SHUFFLER : roll < 0.95 ? KIND_GNAT : KIND_BOLLARD;
    scatter(rng, t.spawnX, t.spawnZ, t.radius, p);
    const i = spawnEnemy(w, kind, p.x, t.heightAt(p.x, p.z), p.z);
    if (i < 0) break;
    w.horde.age[i] = SPAWN_TICKS;
  }

  const s = w.sparks;
  const ns = Math.min(MAX_SPARKS - s.count, Math.max(0, Math.floor(sparks)));
  for (let n = 0; n < ns; n++) {
    const roll = rng.next();
    // What the kinds drop, in the same proportions.
    const value = roll < 0.8 ? KINDS[KIND_SHUFFLER].xp : roll < 0.95 ? KINDS[KIND_GNAT].xp : KINDS[KIND_BOLLARD].xp;
    scatter(rng, t.spawnX, t.spawnZ, t.radius, p);
    const i = s.count++;
    s.x[i] = p.x;
    s.y[i] = t.heightAt(p.x, p.z);
    s.z[i] = p.z;
    s.value[i] = value;
    s.pull[i] = 0;
  }

  if (ne > 0 || ns > 0) {
    w.player.maxHp = FIXTURE_HP;
    w.player.hp = FIXTURE_HP;
  }
}
