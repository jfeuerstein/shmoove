# SKITCH — Plan

Status key: `[ ]` not started, `[~]` in progress, `[x]` done.

The gate for every milestone is `npm run gate`: typecheck, lint, unit tests and deterministic sim
tests driven by scripted input, the production build, a Playwright run at 390x844 with touch
emulation that plays every scripted route and saves screenshots, the PWA check, and the frame-time
and budget check. Only `m1` was tagged; M2–M5 were closed by their merge commits and the status
here (DECISIONS 20), and `m6` is the lead's to tag.

## Last gate (M6j, this branch)

Green, with a verifier running tests on the same 4-core machine (load average 7.8 at the perf stage):

| Stage | Result | Time |
| --- | --- | --- |
| typecheck | PASS | 4.5 s |
| lint | PASS | 5.1 s |
| test | PASS: 693 tests in 51 files | 25.3 s |
| build | PASS: bundle 285 kB gzip (budget 400) | 4.9 s |
| e2e | PASS: 15 routes, no console errors or warnings | 453 s |
| pwa | PASS | 8.1 s |
| perf | PASS | 186 s |

Perf (`artifacts/perf.json`), headless Chromium at 4x CPU throttle, `perfcity` route, five windows
pooled: frame work mean 6.2 ms, p95 15.4 ms (budget 10 / 16.6); game step mean 0.14 ms, p95 0.70 ms
(0.6 / 1.5); one-step frames mean 5.65 ms (6); most draw calls in a timed frame 34, triangles 63k.
Tour of fixed viewpoints, day and night: at most 71 draw calls and 139.5k triangles (120 / 180k).
Per window, mean / p95 ms: Mercado 5.9 / 15.0, Terraces 6.4 / 19.1, Antenna 5.6 / 12.6, streaming
run 7.0 / 17.0, Docks 6.2 / 17.0. Single windows over 16.6 ms p95 under load are the render submit
waiting on the software rasteriser (DECISIONS 87); the pooled figure is the gated one. The previous
full gate on this branch measured 5.4 / 14.1 ms pooled.

A fresh clone of the branch into a temporary directory passed `npm install` (3 s with a warm npm
cache), `npm run build` (9 s) and `npm test` (693 tests, 25 s).

## M0 — Foundations `[x]`

- [x] CLAUDE.md, DESIGN.md, PLAN.md, agent definitions
- [x] Scaffold: Vite + TS strict + ESLint (sim purity rules) + Vitest + Playwright e2e + perf harness + `npm run gate`

Acceptance: fresh clone passes `npm install`, `npm run build`, `npm test`; `npm run gate` runs end to
end. Met (re-checked in M6j, above).

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

Result at the time: 147 unit + sim tests, 3 e2e routes (carve/hop, hitch/whip/sling, grind) with
screenshots, perf on the slice at 4x throttle: 23 draw calls, 27k triangles, 2.7 ms mean / 8.3 ms p95
work. Verified by an independent Opus verifier (brief `m1-verify`): 11 source mutations, all caught;
four defects found and fixed (DECISIONS 19).

## M2 — City `[x]`

- [x] City generator: four districts into the World contract
- [x] Chunk mesher + seamless streaming, district dressing, sea, day/night, props
- [x] City fixes from verification: the spawn rolls, landings fall, the summit is crowned, the
      Mercado is tight with awnings, stalls and handrails on every stair street, forklifts reach the
      east docks, handrail/stair/clearance tests made strict
- [x] Retune: no traps from 400 random starts, awnings bounce a wanderer, parapets on the hairpins
- [x] The city is the default world; `city-spine` and `city-errand` e2e routes
- [x] Independent check of the drawn city (brief `m6d-verify-world`): haze and night fixed
      (DECISIONS 69, 70); chunk builds in one-row pieces and a perf gate that covers the whole city
      followed in M6f

## M3 — Rides and time `[x]`

- [x] All 16 lines on the city's routes with lanes, stops, hours; scheduled meetings; a scripted
      climb from the docks to the summit on rides only; the four-link summit route
- [x] Retune and verification follow-ups: tram 5 every two minutes, a catchable blimp, a
      night-only express night bus, stops off the spine, body-corner clearance
- [x] Vehicle meshes for every kind, pattern liveries, line-up fixture (`?world=lineup`); the
      line-up e2e route asserts each of the 16 lines is drawn in its own livery (M6j)
- [x] Day cycle visuals, timetable boards at stops, HUD destination board
- [x] Line map screen and segment inking
- [x] Independent verification of the ride data (failed once on the blimp; fixed)

## M4 — Sound `[x]`

- [x] Four district tracks in four stems, the stem mixer, wheel/wind/ride/UI sounds, wired into the
      loop; verified by measurement (brief `m4-audio-verify`). Nobody has heard it: see PLAYTEST
- [x] Verifier follow-ups: lighter compressor, two mixer tests, lead register

## M5 — Things to do `[x]`

- [x] Errands (13), conductor challenges (13), secrets (4), ledger, world markers. Verified: the M5
      verifier completed every errand and challenge with bots of its own; the repository's bots
      play four errands and two challenges end to end, and the rest are proved feasible from
      geometry and the timetable (DECISIONS 51)
- [x] Verifier follow-ups: `ferry_luggage` limit, three conductor tests
- [x] Chalk lines: record, `SK2-` share code (about 2.4 kB for two minutes), ghost race. Verified exact
- [x] Saves. Verified against 500 corruptions; version 2 keeps the day (M6h)

## M6 — Ship `[x]` (to be tagged `m6` by the lead)

- [x] Onboarding that teaches by play (M6b), its independent check (which led to the planted foot,
      DECISIONS 77), and the fixes for clumsy players (M6g): four lesson steps, a lead to a waiting
      spot at a stop, a first-launch e2e touch route that completes the lesson; player bots
      complete 30/30 for each of three profiles (DECISIONS 88–93)
- [x] Menus: title, pause, settings, map-complete. Verified
- [x] Haptics
- [x] PWA: manifest, icons generated in code, service worker, offline, portrait lock. Verified,
      including the update flow and a stale-cache bug the verifier found and fixed
- [x] README with deploy steps; GitHub Pages workflow deploying `develop` and the working branch
- [x] Performance pass, then made honest: the gate times five windows across all four districts
      with hitches, slings and chunk streaming at speed (it used to time 8 s on the summit lawn).
      Chunk builds are one row, solid or rail at a time. Figures above
- [x] Full-game check: first launch → completed line map by a scripted skater with no teleports
      (`tests/sim/fullGame.test.ts`, bot in `tests/sim/bot/`): every line complete, no bails, the
      map at 51.5 simulated minutes, all four secrets at 67.3, three save/load points end in the
      same state
- [x] Secrets a player can finish (M6h): the blimp is caught at the hill station and sets you down
      there, the summit chain's king-kite ride inks S3, a guy wire down from the needle, run-in
      steps onto the hill station platform, quieter errand givers clear of stops, saves keep the
      day (DECISIONS 94–99)
- [x] Camera looks for a clear line to the skater (awnings, pillars) and keeps them in frame
- [x] Final docs and audit (M6j): documents brought in line with the code, the chain meter's false
      "lost", livery assertions, e2e failing on console warnings, dead code removed, fresh clone
      checked
- [~] Independent check of M6g, M6h, the planted foot and the camera (brief `m6i-verify-final`):
      running alongside M6j; its findings go to the lead

Acceptance:
- Fresh clone: `npm install`, `npm run build`, `npm test` pass. Met.
- PWA checks: manifest valid, service worker registered, works offline, updates. Met by
  `npm run e2e:pwa` (our own checks; Lighthouse itself is not run).
- e2e: first-launch onboarding completes by scripted touch (`city-first-launch`); a scripted
  full-game sim test completes the line map from a new save (`fullGame.test.ts`). Met.
- No placeholders, TODOs or stubs in the tree; cuts listed in DECISIONS.md. Met (M6j audit; Cut
  section in DECISIONS).

Still open, and only a human can close them: everything in `docs/PLAYTEST.md`, starting with frame
time on a real phone.
