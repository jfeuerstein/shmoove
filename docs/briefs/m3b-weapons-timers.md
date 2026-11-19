# M3, second pass: weapons fire on timers

Model: opus. Read `docs/PITCH.md` (rewritten: a standard survivor), `docs/DECISIONS.md` items 42 to
46, `docs/briefs/README.md`, `docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`, then every
file in `src/sim/weapons/`, `src/sim/seekers.ts`, `src/sim/wake.ts`, `src/sim/stats.ts`,
`src/sim/contact.ts`, `tests/sim/weapons/`, `tests/sim/seekers.test.ts`.

## Why

The design changed after the owner played. Movement is no longer tied to damage: a weapon must
fire the same whether the player is flying down a hill or standing still. The core rules have
been changed already (contact, healing, gear power is 1 in every gear). The weapons have not:
most are still fed by metres, hops, landings or tucks.

## Goal

Every weapon fires on its own timer in seconds. Nothing about a weapon reads how fast the mover is
going, what gear it is in, whether it hopped, landed or tucked.

## You own

`src/sim/weapons/*.ts`, `src/sim/seekers.ts`, `tests/sim/weapons/*`, `tests/sim/seekers.test.ts`.
You may not change `src/sim/wake.ts` (the trail is laid by moving and that is fine; it is the one
weapon whose shape is the path).

## The rule for all of them

- A wait in seconds, by level, in the file's table. The time actually waited is
  `wait * w.player.stats.haste` (Haste is a passive; 1 is normal, lower fires faster). Keep the
  countdown in `w.mem` (or `w.seekerMeter` for the Seekers), in seconds.
- Damage is the table's number times `powerOf(w.player.stats, s.mover.gear)` (which is the build's
  might; the gear no longer changes it; keep calling it so might applies).
- Size is times `w.player.stats.area`.
- The first shot of a run comes after one full wait, not at tick 0.

## Each weapon

- **Seekers.** A volley every 1.2 / 1.05 / 0.9 / 0.8 / 0.7 s; darts and damage as now; with no
  target in range it holds and fires the moment one is.
- **Slam.** A shockwave round the mover every 4 / 3.6 / 3.2 / 2.9 / 2.6 s: radius
  4.5 / 4.8 / 5.1 / 5.5 / 6 m x area, 22 / 28 / 35 / 43 / 52, light enemies thrown outward,
  `FX_SLAM`. Landings no longer matter. Keep `slamRadius` exported (now a function of level and
  area) for the renderer.
- **Orbit.** The discs turn at 2.2 rad/s all the time and hit standing still.
- **Static.** A chain every 3 / 2.7 / 2.4 / 2.1 / 1.8 s; with nothing in reach it waits.
- **Skipper.** Every 2.2 / 2 / 1.8 / 1.6 / 1.4 s, 1 / 1 / 2 / 2 / 3 stones, thrown at the nearest
  enemy within 20 m (along the heading if there is none), at 22 m/s; skips as now.
- **Slipstream.** Always on; no gear needed.
- **Crumbs.** A mine at the mover's feet every 1.6 / 1.4 / 1.2 / 1.05 / 0.9 s; the rest as now.
- **Lance.** Always on, along the heading, tucked or not: 7 / 8 / 9 / 10 / 11 m x area, the same
  width and damage per second. Keep `lanceLength` exported.
- **Bumper** has no step and is already converted (it hurts what a hit throws back).

The renderer reads `orbitDisc`, `orbitDiscCount`, `lanceLength`, `slipstreamLength`,
`slamRadius`: keep those names working.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass.
2. Per weapon, on `arena()` with hand-placed, rooted enemies: it fires standing still at its wait;
   Haste shortens the wait in proportion; the same field takes the same damage whether the mover
   stands, runs or is launched at 30 m/s, and in any gear (this is the test that would have
   caught the old design: write it so it would fail against the code as it is now); level 5 beats
   level 1; rising and dead enemies are left alone; pools never overflow at the fastest rate with
   maximum Haste.
3. Nothing in `src/sim/weapons/` or `src/sim/seekers.ts` reads `EV_HOP`, `EV_CLEAN_HOP`,
   `EV_LAND`, `mover.tucked`, `mover.gear` (except to pass to `powerOf`), `mover.speed`,
   `lastAir`, `impact` or distance travelled. A test greps the source for these and fails on a
   new one.
4. Determinism (all weapons at level 3, 40 s, `hashWorld` twice) and the cost test still pass.
5. The table test prints, for each weapon alone at level 3 over 60 s among the same placed crowd:
   kills and damage standing still and while riding. They should be within a few percent of each
   other for every weapon but the Wake. Put the table in your report with one line on which
   weapons look too strong or too weak; do not retune (a balance pass follows).
