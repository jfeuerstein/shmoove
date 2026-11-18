# Brief M7f — reasons to explore: things to find, and what finding them gives you

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.

## Why

The owner asked for "cool reasons to explore the city". Today the only reasons are the line map
and a few errands. The new district (`docs/briefs/m7e-barrio.md`, world `?world=barrio`, being
built by another agent) places 60 painted tiles (`world.pickups`, `addPickup` in
`src/sim/world.ts`, three tiers: 0 a trail along a line, 1 on a detour, 2 hidden) and 12 named
spots (zones of kind `'spot'`: gaps and transfers) and has four landmarks (zones of kind
`'landmark'`). Nothing yet picks them up, counts them or rewards them. You build that, against the
World contract, so it works on any world that has pickups, spots and landmarks.

## What to build

1. **The reducer** `src/sim/game/finds.ts` (pure, deterministic, like the other reducers in
   `src/sim/game/`, registered in `game.ts`, saved under its own key with migration):
   - **Tiles:** collected when the skater's body passes within 1.8 m (any mode, including towed
     and in the air). Event `tile { index, tier, district, count, total }`. Collecting a tile
     also keeps a flow line alive: it resets the flow window without adding a trick (add a
     small exported function for this in `src/sim/player.ts` only if none exists; say so).
   - **Spots:** found the first time the skater passes through the zone in the air or at 8 m/s
     or more. Event `spot { id, name }`.
   - **Landmarks:** a postcard the first time the skater comes within the landmark's radius.
     Event `postcard { id, name }`.
   - **Best lines:** the longest flow line (`flowEnd` with `bailed: false`) per district, and
     the fastest descent of each named route if the world defines routes as zone pairs
     (`'routeStart'`/`'routeEnd'` with the same name: time from leaving one to entering the
     other without a bail). Events `bestLine`, `bestRun`.
   - **What it gives you.** Finding things unlocks things you can see: board decks and cap and
     shirt colours for the skater (a small palette of liveries generated in code, in the style
     of the rides'), at 5, 15, 30, 45 and all 60 tiles, one per landmark postcard, one for all
     spots in a district. The reducer owns which are unlocked and which is worn
     (`findsWear(deckId)` command); the skater view draws the worn one.
   - Scans cost nothing per tick worth measuring: a spatial hash of pickups, zones checked at
     most every 6 ticks.
2. **In the world** (`src/render/findsView.ts`, wired minimally in `src/app/main.ts`): tiles as
   small painted squares turning on twos, each tier a different border, glowing at night,
   gone once collected, with a short burst of paper squares when taken; one or two draw calls
   for all of them (instancing), nothing drawn beyond 120 m. Spots get nothing in the world
   until found (finding them is the point); landmarks get nothing either.
3. **On screen** (`src/ui/**`): a small counter that appears for two seconds when a tile is taken
   ("TILE 14/60"), a stamp when a spot is found ("SALTO DE LOS GATOS"), a postcard ticket for a
   landmark, an unlock ticket ("NEW DECK: MANGO CHECK"). A new ledger tab, the album: tiles per
   district and tier (hidden ones shown only as "?"), the spots found and the silhouettes of
   those not, the postcards, best lines and runs, and the wardrobe where a deck or colour is
   put on. The line map shows tile and spot counts per district. One transient thing on screen
   at a time: use the toast queue that exists.
4. **Sound and touch** (`src/app/audioView.ts`, `src/audio/**`, `src/app/haptics.ts`): a bright
   two-note chime per tile that climbs with a trail (the next tile within 3 s is a step
   higher), a stamp thud for a spot, a fanfare of four notes for an unlock; a tap per tile.

## Files you own

`src/sim/game/finds.ts` (new) and its registration and events in `src/sim/game/game.ts`, the save
section (`src/sim/game/save.ts`: add a key, bump the version with a migration), the one small
function in `src/sim/player.ts` if needed, `src/render/findsView.ts` (new), the skater's deck and
colours in `src/render/skater.ts` (a palette parameter; keep its poses and animation as they
are), `src/ui/**` for the counter, tickets, album and wardrobe, the sounds and haptics above,
minimal wiring in `src/app/main.ts` and `src/app/testHook.ts`, tests under `tests/sim/finds.test.ts`
and `tests/unit/**`, `docs/DESIGN.md` (a section on finds), `docs/DECISIONS.md` (append before
"Cut"). Other agents are working in `tests/**` and `src/sim/game/**` (controller fallout),
`src/render/dress/**` (city life) and `src/sim/barrio/**` (the district): keep your edits to
shared files small and additive, and merge `claude/build-skitch-game-ntnaek` before you finish.
The branch has failing sim tests that belong to the controller-fallout task: add none.

## Acceptance

1. `tests/sim/finds.test.ts` on a synthetic world with pickups, spots, landmarks and a route:
   tiles are taken in range and only once; a towed and an airborne skater take them; counts and
   totals per tier and district; a spot needs air or speed; a postcard once; best line and best
   run update only when beaten and never from a bailed line or run; each unlock threshold fires
   once; `findsWear` only accepts an unlocked deck; everything survives a save through the real
   save code and an old save loads with nothing found; determinism; a tile keeps a flow line
   alive without adding to it.
2. On the barrio world if it has merged (otherwise on the synthetic world placed in a fixture
   world of your own, `?world=finds`): an e2e route that collects three tiles in a trail, finds a
   spot, opens the album and puts on an unlocked deck, with screenshots of each; open them and
   say what they show; nothing covers the skater.
3. `npm run typecheck`, `npm run lint`, `npm run build`; `npm test` with no new failures;
   `npm run perf` unaffected (report draw calls with and without tiles in view).

## Return

What is found how, the unlock list with thresholds, what each screenshot shows, draw calls,
anything you had to add to shared files. Commands run with pass/fail. Changed files. No file
contents. Commit on your current branch; do not push or merge.
