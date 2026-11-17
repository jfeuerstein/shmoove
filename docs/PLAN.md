# SKITCH — Plan

Status key: `[ ]` not started, `[~]` in progress, `[x]` done (gate green, tagged).

The gate for every milestone is `npm run gate`: typecheck, lint, unit tests, deterministic sim tests
driven by scripted input, a Playwright run at 390x844 with touch emulation that plays a scripted route
and saves screenshots (reviewed against DESIGN.md), and the frame-time/budget check.

## M0 — Foundations `[~]`

- [x] CLAUDE.md, DESIGN.md, PLAN.md, agent definitions
- [ ] Scaffold: Vite + TS strict + ESLint (sim purity rules) + Vitest + Playwright e2e + perf harness + `npm run gate`

Acceptance: fresh clone passes `npm install`, `npm run build`, `npm test`; `npm run gate` runs end to end.

## M1 — Feel slice `[ ]` (tag `m1`)

One street, one tram, one funicular, one staircase with a handrail.

- [ ] Sim core: world queries, deterministic math, line kinematics
- [ ] Movement controller: ground, air, hop, grind, wallride, bail
- [ ] Hitch, slingshot, chain
- [ ] Gesture input (touch + keyboard)
- [ ] Core look: ink material, halftone shadow, riso post pass
- [ ] Chase camera
- [ ] Debug panel exposing every `FEEL` constant
- [ ] docs/PLAYTEST.md first pass

Acceptance:
- Sim tests (scripted input): rolls downhill and reaches terminal speed; carves; hops; grinds the
  handrail end to end faster than the stairs; hitches the tram and inherits its velocity; slingshot
  exit angle depends on release timing; tram → funicular chain reaches 2 links and exits faster than a
  single link; chain ends after landing; same seed + inputs give identical state hashes.
- e2e: scripted touch route hitches, slings, grinds; screenshots show halftone shadows and
  misregistration; debug panel lists every FEEL key.
- Perf budgets hold on the slice.

## M2 — City `[ ]` (tag `m2`)

- [ ] City generator: four districts into the World contract (heightfield, surfaces, solids, rails, zones)
- [ ] Chunk mesher + seamless streaming
- [ ] Full look: district dressing, sky, sea, day/night ramps, props

Acceptance:
- Sim tests: generator is deterministic (hash); a no-input skater dropped at the summit reaches the
  docks without leaving the world or getting stuck; every district has rails, awnings/roofs as
  specified; no solid blocks a street centreline.
- e2e: screenshots from each district match DESIGN section 7; no visible chunk pop within 150 m.
- Perf budgets hold while streaming across the whole city.

## M3 — Rides and time `[ ]` (tag `m3`)

- [ ] All 16 lines: paths, stops, hours, vehicles, liveries
- [ ] Vehicle meshes for every kind
- [ ] Day cycle visuals
- [ ] Timetable boards at stops, HUD destination board
- [ ] Line map screen and segment inking

Acceptance:
- Sim tests: every line's lap period divides the day; vehicles only leave the terminus inside service
  hours; each regular line can be ridden end to end by a scripted skater and inks completely; a scripted
  route climbs from the docks to the summit using rides only; secret lines are hidden until ridden.
- e2e: line map screen screenshot with partial ink; every livery distinguishable in a line-up screenshot.

## M4 — Sound `[ ]` (tag `m4`)

- [ ] Synth voices and the four district tracks (4 stems each)
- [ ] Stem mixer driven by hitch/chain/bail events
- [ ] Wheel, wind, ride and UI sounds

Acceptance:
- Unit tests (OfflineAudioContext-free, on the mixer state machine): hitch fades in the right stem;
  chain of 3 brings the full band; bail cuts to wheels; one track at a time; stem starts are beat-quantised.
- e2e: audio graph starts on first touch without errors; rendered level meters change on hitch.

## M5 — Things to do `[ ]` (tag `m5`)

- [ ] Errands (≥ 8, 2–4 min)
- [ ] Conductor challenges (13)
- [ ] Secrets (ghost tram, blimp, Needle via four-link chain)
- [ ] Chalk lines: record, share code, ghost replay
- [ ] Saves

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
