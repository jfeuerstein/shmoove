# M3: seven weapons

Model: opus. Read `docs/briefs/m3-common.md` first, then `src/sim/weapons/index.ts`,
`src/sim/seekers.ts` and `src/sim/wake.ts` (the two weapons that exist), `src/sim/stats.ts`,
`src/sim/arsenal.ts`, `tests/sim/seekers.test.ts`.

## Goal

The rest of the arsenal: seven weapons that each make a different way of moving pay. A player who
takes the Slam should start hunting air; one who takes the Lance should tuck through crowds.

## You own

`src/sim/weapons/slam.ts`, `orbit.ts`, `static.ts`, `skipper.ts`, `slipstream.ts`, `crumbs.ts`,
`lance.ts`; one test file per weapon in `tests/sim/weapons/`; in `src/sim/weapons/index.ts` the
`registerWeapon` lines for yours.

## The weapons

Starting numbers are given so the seven are comparable; put them in each file's table and adjust
where a test shows one is useless or dominant (say what you changed). "x area" means times
`stats.area`; all damage is times `powerOf`.

- **Slam** (`W_SLAM`). On `EV_LAND` after a flight of 12 ticks or more: a shockwave where the mover
  landed. Radius `(2.5 + 0.06 * lastAir + 0.15 * impact)` m x area, at most 9 m. Damage
  30 / 40 / 52 / 66 / 82, scaled from 0.6x for the shortest flight to 1.6x at 60 ticks. Light
  enemies in it are thrown outward. `FX_SLAM` with the radius.
- **Orbit** (`W_ORBIT`). 2 / 2 / 3 / 3 / 4 discs circling the mover at 2.6 m x area, evenly spaced.
  The angle advances with distance travelled (0.5 rad per metre): standing still, they stand
  still. Each disc hits everything within 0.7 m of it (plus the enemy's radius) for
  8 / 10 / 12 / 15 / 18, each disc at most once every 12 ticks, the discs taking turns. Export
  `orbitDisc(w, s, k, out)` (the position of disc k) for the renderer and tests.
- **Static** (`W_STATIC`). Charge builds with metres travelled; every 30 / 26 / 22 / 19 / 16 m it
  discharges: a chain from the nearest enemy within 10 m through up to 3 / 4 / 5 / 6 / 8 enemies,
  each within 6 m of the one before, none twice, 14 / 17 / 21 / 26 / 32 each. `FX_ARC` at each
  enemy struck, in order (`a` = its place in the chain). With nothing in reach the charge waits.
- **Skipper** (`W_SKIPPER`). On `EV_HOP` it throws a stone along the heading; on `EV_CLEAN_HOP`,
  two, fanned 12 degrees apart. A stone (`SHOT_STONE`) flies at the mover's speed plus 14 m/s,
  0.6 m above the ground, for up to 90 ticks. It hits the first enemy in its way for
  12 / 15 / 19 / 24 / 30, then skips on toward the nearest other enemy within 8 m, up to
  2 / 3 / 3 / 4 / 5 skips. `FX_STONE` when thrown.
- **Slipstream** (`W_SLIPSTREAM`). In gear 2 or higher, a cone behind the mover, 8 / 10 / 12 / 14 /
  16 m long x area with a half-angle of 25 degrees. Sparks in it get `pull = 1`. Light enemies in
  it are drawn toward the line directly behind the mover at 2 / 2.5 / 3 / 3.5 / 4 m/s, which is
  where the Wake is. No damage of its own.
- **Crumbs** (`W_CRUMBS`). Every 14 / 12 / 10 / 9 / 8 m a mine is left on the ground
  (`ZONE_MINE`, armed after 20 ticks, gone after 600, at most 12 at once: the oldest goes). A risen
  enemy within 1.2 m sets it off: 26 / 32 / 40 / 50 / 62 to everything within 3 / 3.3 / 3.6 / 4 /
  4.5 m x area. `FX_BLAST` with the radius.
- **Lance** (`W_LANCE`). While the mover is tucked and in gear 2 or higher, a beam ahead along the
  heading: 6 / 7 / 8 / 9 / 10 m long plus 1.5 m a gear, 0.7 m either side x area. Everything in it
  takes 14 / 18 / 22 / 27 / 32 a second, applied every 6 ticks. Export `lanceLength(w, s)` (0 when
  off) for the renderer and tests.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; nothing existing breaks.
2. Per weapon, on `arena()` with hand-placed, rooted enemies: it does what its paragraph says
   (each clause has an assertion: when it fires, what it hits, what it does not, its effect);
   nothing happens at level 0 or when its trigger is absent (standing still for the distance
   weapons, no hop for the Skipper, not tucked for the Lance); level 5 beats level 1; it never
   touches rising or dead enemies; pools never overflow at the fastest trigger rate.
3. Per weapon, the plan's test: against the same field of enemies, the same ride in a higher gear
   kills more per minute than in a lower one (hold the gear as `tests/sim/wake.test.ts` does).
4. A determinism test: a 40 s scripted ride with all seven at level 3 gives the same `hashWorld`
   every tick, twice.
5. No allocation in any step (say how you checked). The seven together, at level 5 with 400
   enemies, add under 0.5 ms a tick in Node (assert under 2 ms; report the number).
6. Report a table: for each weapon alone at level 3 on the same 60 s scripted ride through a
   placed crowd, kills and damage dealt, in gear 2 and in gear 4. It is how the lead will spot the
   useless and the dominant.
