# M3: drawing what M3 added

Model: opus. Read `docs/briefs/m3-common.md` first, then `docs/briefs/m2-render.md` (its rules and
budgets still hold), `src/render/hordeView.ts`, `shotsView.ts`, `fxView.ts`, `wakeView.ts`,
`sparksView.ts`, `moverView.ts`, `src/render/look.ts`, `src/app/fixtures.ts`, `src/app/main.ts`,
and for what you are drawing: `src/sim/world.ts` (zones, things, shots' kinds, `Horde.elite` /
`state`, the `FX_*` types), `src/sim/hazards.ts`, `src/sim/weapons/*.ts` (each exports what a
renderer needs: `orbitDisc`, `orbitDiscCount`, `lanceLength`, `slipstreamLength`, `slamRadius`),
`docs/briefs/m3-things.md` (what a thing's `state` and `progress` mean).

## Goal

Everything M3 put in the sim can be seen and told apart at a glance in portrait: four new enemies
and elites, seven weapons, three kinds of zone, six kinds of map object. Still a handful of draw
calls.

## You own

`src/render/hordeView.ts`, `shotsView.ts`, `fxView.ts`; new `src/render/zonesView.ts`,
`thingsView.ts`, `weaponsView.ts`; their unit tests in `tests/unit/`; `src/app/fixtures.ts` and its
test; `tests/e2e/routes/horde.mjs` and a new `tests/e2e/routes/arsenal.mjs`; the horde keys in
`tests/perf/budgets.json` and the perf runner's fixture URL. In `src/app/params.ts` (+ test): new
fixture parameters. In `src/app/main.ts`: creating and updating your views.

## What to draw

All colours from `PALETTE` (they are already there: `enemies[3..6]`, `elite`, `zones`, `things`,
`orbit`, `arc`, `lance`, `stone`, `slam`). Geometry built in code, flat-shaded, instanced.

**Enemies.** Real shapes for the four new kinds in place of the stand-in block, at most 40
triangles each, each a silhouette nobody would confuse with another at 30 m: the **cutter** lean
and pointed forward, the **lobber** squat with something raised to throw, the **sludge** wide and
low, the **clinger** small and spiky. An **elite** is drawn 1.4 times as large with a ring on the
ground under it in its aura's colour out to the aura's reach (pick three distinguishable colours
from the palette you have; say which). A **latched clinger** (`state === STATE_LATCHED`) is drawn
stuck to the mover's back, not on the ground.

**Zones** (`zonesView.ts`). A mine: a small disc that blinks once armed. Tar: a dark patch. A lob
ring: an outline that fills in as its time runs out, so the moment it lands is readable. One
instanced mesh per kind.

**Things** (`thingsView.ts`). Crate and gold crate: boxes, the gold one unmistakably gold. Shrine:
a pillar with a ring on the ground at the orbit distance that fills by `progress` (laps). Gate: two
posts and a bar, the next gate of a slalom brighter than the rest. Hoop: a ring in the air, facing
its `yaw`. Totem: a tall marker. Spent things (`THING_DONE`) are shown spent (lowered, greyed or
gone, your call per kind; a hoop that is waiting to come back is faint).

**Weapons** (`weaponsView.ts`, plus `shotsView.ts` and `fxView.ts`). Orbit: the discs, where
`orbitDisc` says. Skipper: stones (`SHOT_STONE`) drawn differently from darts. Static: for each
run of `FX_ARC` in a tick, a jagged bolt from the mover through the struck enemies in order,
gone in about 0.15 s (pooled). Slam: a ring expanding to `FX_SLAM`'s radius. Crumbs: `FX_BLAST`
as a flash and ring. Lance: a beam ahead of the mover as long as `lanceLength`. Slipstream: a
faint cone or streaks behind the mover while it is carried and active. `FX_HEAL` and `FX_TOKEN`:
a small rising mark at the mover. Keep the mover the brightest thing on screen.

**Fixtures.** Extend the crowd fixture's mix with the new kinds and a couple of elites. Add
`?arsenal`: gives the player all ten weapons at level 3 (write `loadout.weaponLevel` directly;
the slots hold four), places one of each kind of thing in a row 12 to 40 m ahead of the spawn and
one of each zone beside it, for screenshots and for seeing every view at once.

## Budgets

With `?horde=400&sparks=600&arsenal`: at most 32 draw calls, at most 120 000 triangles, frame
work under 8 ms and sim step under 2 ms at 4x CPU throttle. Update the horde keys in
`budgets.json` to these and make this the perf runner's crowd measurement.

Note: the map's things are being built in parallel (`src/sim/things.ts`, placement from the
bowl's sites). In your worktree `w.things` is empty unless your fixture fills it. Draw whatever is
in `w.things`; do not assume where it came from.

## Acceptance

1. `npm run gate` is green with the new budgets.
2. Unit tests: instance data for each new enemy kind, an elite (scale and ring), a latched
   clinger (follows the mover); each zone kind from a known world; each thing kind in its waiting,
   in-progress and spent states; orbit discs at `orbitDisc`'s positions; a bolt's points for a
   known run of `FX_ARC`; stones and darts told apart; the fixtures (deterministic, counts, the
   arsenal's levels).
3. `tests/e2e/routes/arsenal.mjs` with `?hook&arsenal&horde=120`: steps the game through a hop
   and a tuck so the Slam, Skipper and Lance show, asserts draw calls within budget and no console
   problems, saves two screenshots (one mid-fight, one looking at the row of things).
4. Open the screenshots with the Read tool and say what you see: can each enemy kind, each zone
   and each thing be told apart; is the mover still the brightest; is the middle of the screen
   readable or is it noise. If it is noise, say what you turned down.
5. Report the perf numbers.
