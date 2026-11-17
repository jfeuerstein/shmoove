# SKITCH — Plan

Status key: `[ ]` not started, `[~]` in progress, `[x]` done (gate green, tagged).

The gate for every milestone is `npm run gate`: typecheck, lint, unit tests, deterministic sim tests
driven by scripted input, a Playwright run at 390x844 with touch emulation that plays a scripted route
and saves screenshots (reviewed against DESIGN.md), and the frame-time/budget check.

## M0 — Foundations `[x]`

- [x] CLAUDE.md, DESIGN.md, PLAN.md, agent definitions
- [x] Scaffold: Vite + TS strict + ESLint (sim purity rules) + Vitest + Playwright e2e + perf harness + `npm run gate`

Acceptance: fresh clone passes `npm install`, `npm run build`, `npm test`; `npm run gate` runs end to end.

## M1 — Feel slice `[x]` (tag `m1`)

One street, one tram, one funicular, one staircase with a handrail.

- [x] Sim core: world queries, deterministic math, line kinematics
- [x] Movement controller: ground, air, hop, grind, wallride, bail, vehicle bodies
- [x] Hitch, slingshot, chain
- [x] Gesture input (touch + keyboard)
- [x] Core look: ink material, halftone shadow, riso post pass
- [x] Chase camera
- [x] Debug panel exposing every `FEEL` constant
- [x] docs/PLAYTEST.md first pass

Result: 147 unit + sim tests, 3 e2e routes (carve/hop, hitch/whip/sling, grind) with screenshots,
perf on the slice at 4x throttle: 23 draw calls, 27k triangles, 2.7 ms mean / 8.3 ms p95 work.

Acceptance:
- Sim tests (scripted input): rolls downhill and reaches terminal speed; carves; hops; grinds the
  handrail end to end faster than the stairs; hitches the tram and inherits its velocity; slingshot
  exit angle depends on release timing; tram → funicular chain reaches 2 links and exits faster than a
  single link; chain ends after landing; same seed + inputs give identical state hashes.
- e2e: scripted touch route hitches, slings, grinds; screenshots show halftone shadows and
  misregistration; debug panel lists every FEEL key.
- Perf budgets hold on the slice.

## M2 — City `[~]` (tag `m2`)

- [x] City generator: four districts into the World contract (1068 solids, 213 rails, 85 zones,
      16 routes, 10 chain spots)
- [x] Chunk mesher + seamless streaming (`src/render/cityView.ts`; resumable chunk builds)
- [x] Full look: district dressing for every kind, sea, day/night ramps, props; fixture `?world=proptown`
- [~] City fixes from independent verification (brief: `docs/briefs/m2-cityfix.md`, waits for the
      ride data which edits the same files): the spawn does not roll, pockets at terrace ends,
      a flat summit, the Mercado is too sparse near the spine, east docks far from any ride, and
      four tests that stayed green when their property was broken
- [ ] The city as the default world, e2e routes and perf on it (first look: `city-spine` route;
      perf at the spawn 16 draw calls, 42k triangles, 4.4 ms mean / 14.6 ms p95)

Acceptance:
- Sim tests: generator is deterministic (hash); a no-input skater dropped at the summit reaches the
  docks without leaving the world or getting stuck; every district has rails, awnings/roofs as
  specified; no solid blocks a street centreline.
- e2e: screenshots from each district match DESIGN section 7; no visible chunk pop within 150 m.
- Perf budgets hold while streaming across the whole city.

## M3 — Rides and time `[~]` (tag `m3`)

- [~] All 16 lines on the city's routes: stops, hours, vehicles, timetable meetings (implementer running)
- [x] Vehicle meshes for every kind, pattern liveries, line-up fixture (`?world=lineup`)
- [x] Day cycle visuals (sky, ink ramps, night glow)
- [x] Timetable boards at stops, HUD destination board
- [x] Line map screen and segment inking

Acceptance:
- Sim tests: every line's lap period divides the day; vehicles only leave the terminus inside service
  hours; each regular line can be ridden end to end by a scripted skater and inks completely; a scripted
  route climbs from the docks to the summit using rides only; secret lines are hidden until ridden.
- e2e: line map screen screenshot with partial ink; every livery distinguishable in a line-up screenshot.

## M4 — Sound `[~]` (tag `m4`)

- [x] Synth voices and the four district tracks (4 stems each)
- [x] Stem mixer driven by hitch/chain/bail events
- [x] Wheel, wind, ride and UI sounds
- [ ] Wired into the app loop; e2e check that the graph starts on first touch
- [ ] Verifier follow-ups: softer master compressor (ratio ~4), two mixer tests tightened (fresh
      first link with stems still in; `grindEnd` while still in grind mode), no per-frame array in
      `engine.ts`, funk and highlife lead figures moved out of the harmony's register

Verified independently: 17 of 19 mixer mutations caught, transport property test clean over 10 000
random advances, chord charts match, real-browser run with no clipping (peak 0.80), bail silence in
38 ms, 15 of 24 voices at peak. Nobody has heard it yet: see PLAYTEST.

Acceptance:
- Unit tests (OfflineAudioContext-free, on the mixer state machine): hitch fades in the right stem;
  chain of 3 brings the full band; bail cuts to wheels; one track at a time; stem starts are beat-quantised.
- e2e: audio graph starts on first touch without errors; rendered level meters change on hitch.

## M5 — Things to do `[~]` (tag `m5`)

- [ ] Errands (≥ 10, 2–4 min) — brief written, waits for the ride data
- [ ] Conductor challenges (13) — same task
- [ ] Secrets (ghost tram, blimp, Needle via four-link chain) — same task; the summit route itself
      is proved in the ride-data task
- [x] Chalk lines: record, share code, ghost replay (verified: exact on 66 660 compared ticks).
      Denser share code in progress: realistic input gave 25 kB for two minutes.
- [x] Saves (verified against 500 corruptions)

Acceptance:
- Sim tests: each errand and challenge type completes and fails correctly under scripted state; share
  code round-trips; a ghost replay reproduces the recorded final state hash exactly; saves round-trip
  and migrate; the Needle is unreachable below a four-link chain and reachable with one.
- e2e: errand ticket, challenge board, chalk export/import flow screenshots.

## M6 — Ship `[ ]` (tag `m6`)

- [ ] Onboarding that teaches by play
- [ ] Menus, settings, pause
- [ ] Haptics
- [ ] Performance pass against budgets
- [ ] PWA: manifest, icons generated in code, service worker, offline, portrait lock
- [ ] README with deploy steps; PLAYTEST.md final
- [ ] Full-game check: first launch → completed line map (scripted, accelerated)

Acceptance:
- Fresh clone: `npm install`, `npm run build`, `npm test` pass.
- Lighthouse-style PWA checks: manifest valid, service worker registered, works offline.
- e2e: first-launch onboarding completes by scripted touch; a scripted full-game sim test completes
  the line map from a new save.
- No placeholders, TODOs or stubs in the tree; cuts listed in DECISIONS.md.
