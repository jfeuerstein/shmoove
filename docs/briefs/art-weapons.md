# Art: weapons, shots, zones and effects

Model: opus. Read `docs/briefs/art-common.md` first (it is the contract), then `docs/PITCH.md`
section 5, `src/render/weaponsView.ts`, `shotsView.ts`, `wakeView.ts`, `sparksView.ts`,
`zonesView.ts`, `fxView.ts`, `src/render/look.ts`, `src/sim/weapons/*.ts` (what each weapon does
and what it exports for drawing), `src/sim/seekers.ts`, `src/sim/wake.ts`, `src/sim/world.ts`
(shots, zones, `FX_*`), `src/app/fixtures.ts` (`?arsenal`), their unit tests and
`tests/e2e/routes/arsenal.mjs`.

## Goal

Each of the ten weapons is recognisable by what it looks like on screen, firing is satisfying to
watch, and at level 5 it visibly is a bigger thing than at level 1. A player who has never read
a card can tell which weapon just killed something.

## You own

`src/render/weaponsView.ts`, `shotsView.ts`, `wakeView.ts`, `sparksView.ts`, `zonesView.ts`,
`fxView.ts` (not `bossView.ts`, and leave `fxView`'s boss arrival and fall as they are), their
unit tests, `tests/e2e/routes/arsenal.mjs` (add shots).

## What to build

One distinct visual idea per weapon, from muzzle to impact:

- **Seekers:** darts with fins and a short ribbon trail that curve to their target; a small
  spark where they hit.
- **Wake:** a trail of flame-like tongues behind the board that flickers, not a flat ribbon; a
  closed loop flashes along its whole length and bursts (the pop).
- **Bumper:** a visible bumper round the rider (a hoop of plates at hip height) that flares and
  throws out a ring when it goes off.
- **Slam:** a shockwave with a leading edge that travels along the ground and cracks left
  behind for a moment.
- **Orbit:** real discs: saw blades or records, spinning on their own axis as well as round the
  rider, with a streak.
- **Static:** a jagged bolt that jumps enemy to enemy with a flash at each, re-rolled a few
  times while it lasts so it crackles.
- **Skipper:** flat stones that visibly skip: an arc between enemies and a splash-ring at each
  bounce.
- **Slipstream:** streaks of drawn-in air behind the board, curving inward, carrying sparks.
- **Crumbs:** mines with a character (a spiked ball with a blinking light), an arming blink,
  a proper blast.
- **Lance:** a beam with a core and a sheath that charges for a blink before it fires and
  scorches a line.

Also: **sparks** (the experience pick-ups) as small gems that bob, spin and stretch toward the
rider when pulled, with a pop on pick-up, bigger gems for bigger values; **tar** with a wet
edge and bubbles; **lob rings** that read as "something lands here soon" (the falling shot
visible on its way down, its shadow growing); **damage and death**: a hit that shows direction,
a death burst in the enemy's colour that leaves a short-lived splat or shards on the ground;
**level up** and **heal** effects on the rider.

Level: every weapon's drawing takes its level (and `stats.area` where the sim does) so a level
5 is bigger, brighter or more numerous in the way the sim says it is. Never draw a reach that
is not the sim's reach.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. For each weapon: a screenshot at level 1 and at level 5 mid-fire against a crowd (`?hook`,
   `setWeapon`, `?horde=N`), and one of all ten at once (`?arsenal`). Sparks, tar, a lob ring
   about to land, a level-up.
3. With all ten at level 5 and 400 enemies the screen is busy but the rider and the nearest
   enemies can still be found at a glance. Say honestly which effect is the loudest and whether
   it should be.
4. Perf scene draw calls and triangles in your report.

## Return

Summary, decisions, what is still weak, perf numbers, commands with pass/fail, changed files,
branch and last commit.
