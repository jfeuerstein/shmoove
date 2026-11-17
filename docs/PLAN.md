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

- [x] City generator: four districts into the World contract
- [x] Chunk mesher + seamless streaming, district dressing, sea, day/night, props
- [x] City fixes from verification: the spawn rolls, landings fall, the summit is crowned, the
      Mercado is tight with awnings, stalls and handrails on every stair street, forklifts reach the
      east docks, handrail/stair/clearance tests made strict
- [~] Open (task `m3-retune`): the strict no-trap test fails by three runs (two pins outside the
      west hairpin parapets), a random wanderer bounces on 3 awnings where 12 are required
- [x] The city is the default world; `city-spine` and `city-errand` e2e routes

## M3 — Rides and time `[~]` (tag `m3`)

- [x] All 16 lines on the city's routes with lanes, stops, hours; six scheduled meetings; a scripted
      climb from the docks to the summit on rides only; the four-link summit route
- [~] Open (task `m3-retune`): three ride-data tests fail since the forklift loop grew; tram 5 comes
      every four minutes and should come every two; one conductor number to re-measure
- [x] Vehicle meshes for every kind, pattern liveries, line-up fixture (`?world=lineup`)
- [x] Day cycle visuals, timetable boards at stops, HUD destination board
- [x] Line map screen and segment inking
- [ ] Independent verification of the ride data (after the retune)

## M4 — Sound `[~]` (tag `m4`)

- [x] Four district tracks in four stems, the stem mixer, wheel/wind/ride/UI sounds, wired into the
      loop; verified by measurement (nobody has heard it: see PLAYTEST)
- [~] Verifier follow-ups (task `m6c1-followups`): lighter compressor, two mixer tests, lead register

## M5 — Things to do `[~]` (tag `m5`)

- [x] Errands (13), conductor challenges (13), secrets (4), ledger, world markers. Verified: every
      errand and challenge completed by independent bots
- [~] Verifier follow-ups (task `m6c1-followups`): `ferry_luggage` limit, three missing conductor tests
- [x] Chalk lines: record, `SK2-` share code (about 2.4 kB for two minutes), ghost race. Verified exact
- [x] Saves. Verified against 500 corruptions

## M6 — Ship `[~]` (tag `m6`)

- [ ] Onboarding that teaches by play (brief written: `docs/briefs/m6b-onboarding.md`)
- [x] Menus: title, pause, settings, map-complete. Verified
- [x] Haptics
- [x] PWA: manifest, icons generated in code, service worker, offline, portrait lock. Verified,
      including the update flow and a stale-cache bug the verifier found and fixed
- [x] README with deploy steps
- [ ] Performance pass: the city with all rides is at the frame-work budget (p95 14–17 ms at 4x
      throttle against 16.6), with no margin
- [ ] Full-game check: first launch → completed line map by a scripted skater with no teleports
- [ ] Final docs and audit

Acceptance:
- Fresh clone: `npm install`, `npm run build`, `npm test` pass.
- Lighthouse-style PWA checks: manifest valid, service worker registered, works offline.
- e2e: first-launch onboarding completes by scripted touch; a scripted full-game sim test completes
  the line map from a new save.
- No placeholders, TODOs or stubs in the tree; cuts listed in DECISIONS.md.
