# Brief M7e — El Barrio: one district that is fun to skate, as a vertical slice

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes): uncommitted work can vanish without warning.

## Why

The owner has played the game twice. The verdict (DECISIONS 112, 116): it looks bad, speed is not
fun or rewarding, and "the city doesn't lend itself well to fun exploration". Look at
`artifacts/screens/city-spine-*.png` after `npm run build && npm run e2e -- city-spine`: the
generated city is open terraces of flat roofs that the skater looks down on, joined by one stair
street and some switchbacks. Nothing stands beside or above the skater, there is one obvious way
down, flats kill speed, and there is nothing to find.

Nobody on this project can feel the game except the owner. So instead of rebuilding the whole
hill blind again, build **one district** properly, as its own world, and put it in front of the
owner. If it is fun it becomes the pattern for the rest of the hill.

## What to build

A new world, `src/sim/barrio/**`, registered as `?world=barrio` in `src/app/world.ts` and, once
its acceptance passes, made the **default world** (the old city stays at `?world=city`; its tests
keep running against it). Built through the same World contract as everything else
(`src/sim/world.ts`: heightfield, surfaces, solids, rails, zones, lines, and now `pickups` and
zones of kind `'spot'`). Deterministic from a seed, authored by code: this is a designed place
built with generator helpers, not a random city. Use a fine grid (cell 1.5 m) so banks and bowls
have a shape.

**The place.** A hillside market quarter about 260 m wide and 420 m long that falls about 110 m
from the Mirador (a lookout plaza at the top, where a new game starts) to the Rambla (a boulevard
along the bottom).

**Rule 1: a canyon, not a plateau.** Every route runs between buildings two to five storeys tall
or under things: for at least 80 % of the length of each main route there is a wall or facade at
least 7 m above the skater within 8 m on both sides, and something overhead (bunting, wires, an
arch, a balcony, an awning above head height, a bridge) at least every 20 m. Roofs are where you
go on purpose, not what you look down on from the street.

**Rule 2: three ways down that braid.** Each is a line a skater can hold from top to bottom
without stalling, each plays differently, and they cross:

- **Calle Mayor**, the main street: 8–10 m wide, smooth, falling in S-curves with banked outside
  walls you can carve up, market stalls, delivery ramps as kickers, short stair sets with rails
  down the middle, and traffic to hitch. The readable, forgiving line.
- **Los Tejados**, the roof run: reached from the street by ramps, awning bounces and wallrides.
  A chain of roofs stepping down with plank bridges, gaps to clear, awnings as trampolines,
  washing lines and wires to grind from roof to roof, ending in a long drop into the lower plaza.
  The trick line.
- **El Canal**, the storm drain: a concrete channel 6–7 m wide with banked sides (a half-pipe in
  section), winding down behind the houses through two tunnels under streets, with pipes along
  its walls to grind and a spillway kicker at the bottom. The fast line.

Cross-links at least every 60 m of descent (alleys 3–4 m wide, stair cuts, ramps up to the roofs,
grates down into the canal), so a player can switch lines and each link is a small discovery.

**Rule 3: momentum is never taken away.** No dead ends and no flats that stop you: every flat
longer than 12 m is a plaza with banked edges or a bowl you can carve round and leave at speed;
the bottom of every stair set and ramp has a kicker or a transition; places you would turn round
are quarter-pipes. The Rambla at the bottom is not a place to stall: it has the way back up.

**Rule 4: the loop is short.** From the Rambla, two rides climb back to the Mirador: a funicular
straight up one side (14 m/s, a car every 20 s) and a tram climbing Calle Mayor (stops at the
plazas, one every 30 s). A grindable wire runs from the Mirador down over the roofs as an express.
Mopeds and handcarts work Calle Mayor and the Rambla as traffic (10 m/s or more). Ride up, skate
down, in about 90 seconds.

**Rule 5: landmarks.** Four places you can see from elsewhere and want to reach: the clock tower
with a bowl round its fountain; the market hall you can skate through (an aisle under a roof with
skylights, entered at one end and left by a ramp at the other); the church steps (the biggest
stair set, with the longest rail); the tiled stair (every riser a different colour).

**Rule 6: things to find.** 60 painted tiles (`addPickup(w, 'tile', ...)`): 30 as breadcrumb
trails along the three lines (tier 0: following them teaches the route and its best jumps), 20 on
detours (tier 1: over a gap, at the end of a wire, on a bowl's lip, above an awning), 10 hidden
(tier 2: a back yard, a ledge behind the tower, inside the canal's tunnel roof). 12 named spots
(zones of kind `'spot'`, e.g. "Salto de los Gatos", "El Tobogán"): gaps and transfers a skater
discovers by clearing them. Another task builds the reducer and UI that count them: you only
place them, and prove each can be reached.

**Dressing.** Use the existing kinds and dressing (`src/sim/city/kinds.ts`,
`src/render/dress/**`) so the look applies, and add kinds where the place needs them (arches,
balconies, bunting, the canal's pipes, the hall). The world streams like the city
(`isStreamed`). Another agent is adding ground paint, people and props to `src/render/dress/**`
driven by world data: lay out lanes, stair streets, plazas and stalls as the city does so that
work lands on your district too.

## Files you own

`src/sim/barrio/**` (new), `src/app/world.ts`, new solid/rail kinds in `src/sim/city/kinds.ts` and
their dressing in `src/render/dress/**` (new files; minimal edits to shared ones, another agent
is working there), `tests/sim/barrio*.test.ts`, `tests/sim/bot/**` (additions),
`tests/e2e/routes/barrio-*.mjs`, the default-world switch and the new-game start for this world in
`src/app/**`, `docs/DESIGN.md` (a new section for the district), `docs/DECISIONS.md` (append
before "Cut"), `docs/PLAYTEST.md`. Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`, values in
`src/sim/constants.ts`, `src/render/look.ts`, `src/render/camera.ts`, `src/sim/city/**` apart from
`kinds.ts`, `src/sim/game/**`, `src/ui/**`. The branch has failing sim tests from a controller
change another agent is fixing: ignore failures that exist before your change; add none.

## How to know it is good without a thumb

1. **Three line bots** (`tests/sim/barrio.test.ts`), each holding one line from the Mirador to the
   Rambla by input alone, with a thumb's limits (reaction 0.2 s, no frame-perfect inputs):
   no bail, never under 6 m/s for more than 2 s, mean speed at least 13 m/s; the roof bot clears
   at least 6 gaps and grinds at least 3 wires; the canal bot carves at least 10 bank-to-bank
   transitions and both tunnels; the street bot hits at least 4 kickers and hitches and slings
   at least twice. Report each line's time, mean and top speed.
2. **A casual bot** that just rolls downhill carving at random and hopping now and then, 40 seeds:
   reaches the Rambla every time without stalling for more than 5 s, and between them the 40 runs
   use all three lines and at least 8 different cross-links.
3. **The loop:** from the Rambla, a bot rides up and skates down three times; median loop under
   100 s; never more than 20 s waiting.
4. **Canyon and momentum rules measured over the geometry:** rule 1's percentages along each
   line's path; no flat patch over 12 m without a bank or kicker within reach; no trap (400 random
   drops: nobody pinned, nobody stuck for 10 s).
5. **Every tile and spot is reachable:** each tier-0 tile is collected by its line's bot; each
   tier-1 and tier-2 tile and each spot by some scripted run from the top (report which).
6. **Pictures:** a frame every two seconds down each line by day, eight at night, at
   deviceScaleFactor 2, saved under `artifacts/barrio/` and copied to
   `/tmp/claude-0/-home-user-shmoove/18699613-b328-589d-85de-f067a4fdd11b/scratchpad/barrio/`.
   Open every one. In each street and canal frame, buildings, walls and props must fill more of
   the frame than bare ground and sky together; say so per frame, and iterate on the ones that
   fail. Describe what a player would want to go and look at in each.
7. **Budgets:** `npm run perf` with `SKITCH_PERF_PARAMS` pointing at the barrio's own legs and
   tour (add them in `src/app/routes.ts` alongside the city's): at most 110 draw calls and
   175 000 triangles in any view, pooled frame work p95 under 16.6 ms at 4x throttle.
8. `npm run typecheck`, `npm run lint`, `npm run build`; `npm test` with no new failures;
   `npm run e2e -- barrio-street barrio-roofs barrio-canal` (three touch routes that ride each
   line's first 30 seconds and take screenshots).

## Return

A map of the district in words (the three lines, the cross-links by name, the landmarks), each
line's bot numbers, the casual bots' line usage, the loop times, the rule measurements, where each
tile tier is, what each screenshot shows and which you had to iterate on, budgets, anything in the
controller or camera that fought the design (with place and what happens). Commands run with
pass/fail. Changed files. No file contents. Commit on your current branch; do not push or merge.
