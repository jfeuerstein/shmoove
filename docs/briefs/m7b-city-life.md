# Brief M7b — a city with people and paint in it

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.

## Why

The owner played the game: "city empty and bland" (DECISIONS 112). Look at
`artifacts/screens/city-*.png` after `npm run build && npm run e2e -- city-spine city-errand`:
most of the frame is flat concrete grey, streets and landings are bare, nobody is about, and the
colour sits in a few awnings and vehicles. DESIGN promises painted-bus maximalism: mango, pink,
teal and cobalt on concrete, liveries and pattern everywhere, characters animated on twos.

## What to do

Decoration only: nothing you add collides, changes the world the sim sees, or changes where a
skater can go. All of it is generated in code and baked into the streamed chunks
(`src/render/cityView.ts`, `src/render/dress/**`, `src/render/worldMesh.ts`), drawn with the shared
`inkMaterial()`. Deterministic from the world seed and positions (`hash2`).

1. **Paint on the ground.** The big grey areas get printed pattern: lane lines, arrows and stop
   boxes on vehicle streets (follow the lines' paths), zebra crossings where stair streets cross
   them, coloured stair risers in runs (every flight its own two-colour rhythm), tile patterns on
   plazas and landings by district, painted murals and numbers on the retaining walls beside the
   spine, chalk hopscotch and arrows, manhole covers, drain grates, puddle-flat patches of colour
   at the docks (bay numbers, hazard stripes). No large area of a street-level view should be
   one flat grey.
2. **People.** Figures in the chunky style of the skater (`src/render/skater.ts`): standing at
   stops and stalls, sitting on steps and walls, leaning in doorways, carrying things, a few
   walking short loops on plazas and pavements. Animated on twos (12 Hz) with two or three
   poses. They are drawn, not simulated: no collision, and never standing where the skater's
   routes run (stay off vehicle lanes, the stair streets' middle, rails and their run-ins:
   the world has all of these). Density by district and hour: the Mercado crowded by day,
   the docks working, the terraces quiet, the summit sparse; thin at night.
3. **Things.** Per district, small props that say who lives here: crates, baskets and hanging
   goods at stalls, plants in pots and on balconies, laundry lines across alleys, bunting and
   papel picado across stair streets, bikes and scooters against walls, cats on roofs, birds on
   wires that scatter when the skater passes within 6 m (a two-pose swap is enough), nets and
   buoys at the docks, antennas and dishes up the hill. Wall colour: more buildings painted in
   the palette, with painted bands, shop names as shapes, and door colours.
4. **By day and by night.** Glow on what would be lit (bulbs on bunting, shop signs); nothing
   new that breaks the night look.

## Constraints

- Budgets hold and are re-measured: `npm run perf` green; tour maxima at most 110 draw calls and
  175 000 triangles (today 71 and 145.7k); pooled frame work p95 under 16.6 ms at 4x throttle.
  Spend triangles where the camera looks (near chunks, street level, the spine), nothing on what
  the far level of detail cannot show. Animated figures must not cost a draw call each: batch
  them (one or two meshes per chunk whose geometry swaps between baked poses, or instancing).
- No per-frame allocation. Chunk build pieces stay small (`tests/unit/chunkPieces.test.ts`).
- The far and near versions of a chunk still agree on the buildings' outlines
  (`tests/unit/cityView.test.ts`).
- Nothing changes in `src/sim/**`.

## Files you own

`src/render/dress/**`, `src/render/cityView.ts`, `src/render/worldMesh.ts`, a new
`src/render/people.ts` (or under `dress/`) and the minimal wiring in `src/render/view.ts` /
`src/app/main.ts` (another agent is editing `main.ts` and `src/ui/**`: keep your diff small),
new tests under `tests/unit/`, `docs/DESIGN.md` (the look and city sections),
`docs/DECISIONS.md` (append after the last numbered item, before "Cut"). Not yours:
`src/render/look.ts`, `src/render/camera.ts`, `src/sim/**`, `src/ui/**`, `tests/sim/**`,
`tests/e2e/**`.

## Acceptance

1. Before and after screenshots at deviceScaleFactor 2, by day and at night: the nine tour
   viewpoints (`?route=tour`) and eight frames of a descent of the spine (`?route=perf`), saved
   under `artifacts/life/` and copied to
   `/tmp/claude-0/-home-user-shmoove/18699613-b328-589d-85de-f067a4fdd11b/scratchpad/life/`.
   Open every one. For each after-frame, measure the share of pixels within 12 levels of the
   concrete grey and report it against the before-frame; iterate until no street-level frame
   has more than 35 % of its pixels in flat concrete and every district's frames show people.
2. Unit tests: every near chunk in the Mercado, Terraces and Docks has ground paint; figures
   never stand within 2 m of a vehicle lane, on a rail's run-in or in the middle third of a
   stair street; decoration is identical when a chunk is rebuilt; the triangle count per chunk
   stays under a bound you set from the budget.
3. `npm run typecheck`, `npm run lint`, `npm test` (ignore failures that exist before your
   change: 30 tests fail on this branch today because of a controller change another agent is
   handling; list any new ones), `npm run build`, `npm run perf`.

## Return

What you added per district, the grey-share table before and after, tour maxima and frame work
before and after, what each screenshot shows, anything you wanted and could not afford. Commands
run with pass/fail. Changed files. No file contents. Commit on your current branch; do not push or
merge.
