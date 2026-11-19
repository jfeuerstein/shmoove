# M2: the horde moves, and the director that feeds it

Model: opus. Read `docs/briefs/m2-common.md` first.

## Goal

Enemies that close on the player as a crowd, and a director that keeps the right number of the
right kinds arriving from where the player is heading, so the horde feels like it is everywhere
without simulating the whole map.

## You own

`src/sim/horde.ts`, `src/sim/director.ts`, `tests/sim/horde.test.ts`, `tests/sim/director.test.ts`.
In `src/sim/sim.ts`: the `// [director]` and `// [horde]` lines and their imports. You may retune
the numbers in `KINDS` (`world.ts`) and nothing else there; say what you changed and why.

## `stepHorde(w, s, terrain)`

Per enemy, per tick: `age` up (saturating), `flash` and `stun` down.

- **Rising** (`age < SPAWN_TICKS`): does not move.
- **Steering**: accelerate at the kind's `accel` toward a wanted velocity, capped at the kind's
  `speed`. Shufflers and bollards head straight at the mover. Gnats aim at where the mover will be
  (its position plus about 0.4 s of its velocity) and weave from side to side by their `phase`, so a
  cloud reads as a swarm, not a column. Nothing ever exceeds its kind's speed by steering.
- **Thrown** (`stun > 0`): no steering; it keeps the velocity it was thrown with and slows at about
  8 m/s2 until it stops.
- **Separation**: bodies do not stack. Overlapping enemies are pushed apart; a heavy one does not
  give way to a light one. Call `rebuildGrid(w)` at the start of your step for your own neighbour
  queries (the grid from the previous tick has stale indices after the reap); the sim rebuilds it
  again after you have moved everything.
- **Ground**: `y` follows `terrain.heightAt`. Enemies stay off the rim: keep them within 0.86 of
  `terrain.radius`.
- **Far away is cheap**: enemies more than 70 m from the mover update every fourth tick (staggered
  by index) with a four-tick step and no separation. Their average speed must still be right.

## `stepDirector(w, s, terrain)`

Does nothing unless `w.spawning`. Keep the numbers in one exported table in `director.ts`.

- **How many**: a target for living enemies that rises with run time, linear between
  0 s: 25, 30 s: 60, 60 s: 120, 120 s: 260, 180 s: 400. Spawn at most 4 a tick while below it.
- **Which**: shufflers always. Gnats from 40 s, arriving as clouds of about 10 in a 3 m blob,
  rising to about 30% of the horde. Bollards from 80 s, one at a time, up to 6 alive by the end.
- **Where**: 38 to 65 m from the mover. When the mover is going faster than 3 m/s, about 70% of
  spawns are within 70 degrees of its direction of travel; otherwise all around. Inside 0.86 of the
  radius, on ground with slope under 0.6. Try a few candidates and skip the tick if none fits.
- **Recycling**: an enemy more than 85 m from the mover, or more than 55 m away and behind a mover
  that is travelling faster than 7 m/s, is taken out with `removeEnemy` (not a death), so the
  director brings it back ahead.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; nothing existing breaks (in particular
   `tests/sim/contact.test.ts` and `tests/sim/wake.test.ts`).
2. `tests/sim/horde.test.ts` on `arena()`: shufflers reach a standing mover at their speed and no
   faster; a gnat cloud weaves (its members' paths are not parallel lines) and arrives; nothing
   steers faster than its kind's speed over 30 s; 60 shufflers placed on one spot spread until no
   two overlap by more than a fifth of a radius within 3 s; a light enemy cannot push a bollard
   but a bollard pushes through lights; a thrown enemy slides, stops within a second or so, does
   not steer meanwhile, then resumes; rising enemies do not move; enemies never leave 0.86 of the
   radius; far enemies close at the right average speed; no non-finite numbers after 60 s with 400
   enemies; two identical runs give the same `hashWorld` every tick.
3. `tests/sim/director.test.ts` on the real bowl (`makeBowl(1..3)`) with a scripted mover: the
   living count tracks the target within 15% once it has had time to catch up; every spawn is 38 m
   or more from the mover, inside the region, on a fair slope; kinds appear on schedule and in
   roughly the stated shares; with the mover held at 20 m/s on a straight line, most of the horde
   within 70 m is ahead of it after 20 s (it recycles); with `w.spawning = false` nothing spawns;
   deterministic.
4. One timing test: `stepDirector` + `stepHorde` with 400 enemies averages under 1 ms a tick in
   Node (assert under 3 ms so the gate does not flake). Report the measured average.
5. No allocation in either step (say how you checked).
