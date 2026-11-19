# M2: drawing the horde

Model: opus. Read `docs/briefs/m2-common.md` first, then `src/render/look.ts`,
`src/render/terrainView.ts`, `src/render/moverView.ts`, `src/render/scene.ts`, `src/app/main.ts`,
`tests/e2e/run.mjs`, `tests/perf/run.mjs`.

## Goal

400 enemies, 600 sparks, shots, the Wake and its pop, drawn in a handful of draw calls at 60 fps on
a mid-range phone, readable at a glance in portrait; plus the screen-edge cues for what the narrow
frame cannot show.

## You own

- `src/render/hordeView.ts`, `sparksView.ts`, `shotsView.ts`, `wakeView.ts`, `fxView.ts`
- `src/ui/threat.ts` (+ CSS beside it)
- `src/app/fixtures.ts`
- `tests/unit/hordeView.test.ts`, `tests/unit/wakeView.test.ts`, `tests/unit/threat.test.ts`
- `tests/e2e/routes/horde.mjs`
- In `tests/perf/run.mjs` and `tests/perf/budgets.json`: the horde measurement below.
- In `src/app/params.ts` (+ its test): the `horde` and `sparks` integer parameters.
- In `src/app/main.ts`: creating your views, handing them `sim.world.fx` once per tick right after
  `sim.step`, updating them per frame, and applying the fixture.

## What to build

**Horde** (`hordeView.ts`): one `InstancedMesh` per enemy kind, geometry built in code, colours
`PALETTE.enemies[kind]`. Shuffler: a chunky block figure, 1.7 m, at most 40 triangles. Gnat: a
small faceted shard, at most 12. Bollard: a fat tapered block, 2.4 m, at most 40. Each frame, write
positions (extrapolated as the common brief says), facing (from velocity) and rise-out-of-the-
ground scale (`age / SPAWN_TICKS`) straight into the instance matrix array, with no `Matrix4`,
`Object3D` or other per-instance objects. Animation lives in the vertex shader: a hop-wobble driven
by a time uniform, the instance's `phase` and its speed. Hit flash: the instance blends to
`PALETTE.enemyFlash` while `flash > 0`. Flat-shaded, lit and fogged like everything else (extend
`flatMaterial` through `onBeforeCompile`, or a small shader that takes its light and fog from
`look.ts`). One more instanced mesh draws a dark blob shadow under every enemy. Set
`mesh.count` each frame; turn frustum culling off for these meshes.

**Sparks** (`sparksView.ts`): one instanced mesh of small diamonds in `PALETTE.spark`, bobbing and
turning; bigger for bigger `value`.

**Shots** (`shotsView.ts`): one instanced mesh of short streaks in `PALETTE.shot`, aligned to
velocity.

**Wake** (`wakeView.ts`): a ribbon along `w.wake` points, as wide as it burns
(`2 * FEEL.wakeWidth`), just above the ground, `PALETTE.wake`, bright at the mover and fading to
nothing at the tail. One draw call, one preallocated buffer.

**Effects** (`fxView.ts`): from `w.fx`. `FX_POP`: a ring that expands to the loop's radius and a
flash disc on the ground in `PALETTE.pop` (pool of 4). `FX_ENEMY_DIE`: a small burst of shards in
the enemy's colour (one instanced pool of 256). `FX_PLAYER_HIT`: a brief red tint over the frame
(a DOM overlay or a full-screen quad; `PALETTE.threat`). Others may be ignored for now.

**Threat cues** (`src/ui/threat.ts`): a glow along the bottom and lower side edges of the screen in
`PALETTE.threat` whose strength follows how many risen enemies are within 14 m of the mover and
either behind it or outside the frame, smoothed over about a third of a second. And an edge
marker: for each bollard within 60 m that is off screen, a chevron pinned to the nearest screen
edge pointing at it (pool of 6, moved by transform only). Keep the maths (which enemies count,
where a marker sits) in pure functions and test those.

**Fixture** (`src/app/fixtures.ts`, `?horde=N&sparks=M`): turns the director off and scatters N
enemies (about 80% shufflers, 15% gnats, 5% bollards), already risen, over a 60 m disc around the
spawn but not within 8 m of it, and M sparks likewise. Deterministic. For perf and screenshots.

## Budgets

With `?horde=400&sparks=600`: at most 20 draw calls, at most 110 000 triangles, frame work under
8 ms and sim step under 2 ms at 4x CPU throttle. Add this as a second measurement in the perf
runner (the existing empty-bowl measurement stays) with its own keys in `budgets.json`.

Note: enemy movement and spawning are being built in parallel. In your worktree enemies stand
still; after the merge they will walk. Your views must not assume either.

## Acceptance

1. `npm run gate` is green, including the new perf measurement and the `horde` route.
2. Unit tests: instance matrices for a known world (position, facing, rise scale; `count` equals
   the living enemies of that kind); the wake ribbon's vertices for a known trail (width, order,
   fade, empty trail draws nothing); the threat functions (behind counts, in frame ahead does not,
   out of range does not; marker lands on the correct edge for left, right, behind).
3. `tests/e2e/routes/horde.mjs` with `?hook&horde=200&sparks=100`: steps 120 ticks, asserts draw
   calls within budget and no console problems, saves a screenshot.
4. Open the screenshot with the Read tool and say what you see: enemies must read as three
   distinct kinds at a glance, the mover must still be the brightest thing on screen, sparks and
   shadows visible, nothing covering the middle.
5. Report the perf numbers for both measurements.
