# Brief M6d — verify the drawn city, the vehicles, the city fixes and the performance pass

Role: verifier (`.claude/agents/verifier.md`). Fresh context. You change no source file. You may add
throwaway scripts under your scratch directory only. Report, do not repair.

## Goal

Four pieces of work have been merged without an independent check. Check each against what it was
asked to do and against `docs/DESIGN.md`, and say plainly what holds and what does not.

| Piece | Brief | Main files |
| --- | --- | --- |
| Drawn city (chunk streaming, LOD, dressing) | `docs/briefs/m2-cityview.md` | `src/render/cityView.ts`, `src/render/dress/**`, `src/render/worldMesh.ts` |
| Vehicles | `docs/briefs/m3c-vehicles.md` | `src/render/vehicles.ts`, `src/render/vehicleKinds/**`, `src/sim/lineup.ts` |
| City fixes and retune | `docs/briefs/m2-cityfix.md`, `docs/briefs/m3-retune.md`, `docs/briefs/m6c1-followups.md` | `src/sim/city/**`, `tests/sim/city*.test.ts` |
| Performance pass | `docs/briefs/m6c2-perf.md` | `tests/perf/**`, `src/sim/lines.ts` (vehicle memo, `segDir`), `src/render/geom.ts`, `src/app/main.ts` |

Read `CLAUDE.md`, `docs/DESIGN.md` (§ look, § city, § rides roster, §10 budgets) and
`docs/DECISIONS.md` first. A decision recorded there is not a defect; a brief requirement that was
dropped without a decision is.

## What to check

1. **Gate.** Run `npm ci` then `npm run gate` once, on as idle a machine as you can get (another
   agent may be running tests; if a timing budget fails, rerun `npm run perf` alone and report both).
   Report each stage.
2. **Streaming.** Drive the built game with Playwright (`tests/e2e/run.mjs` and the hook in
   `src/app/testHook.ts` show how; `window.__skitch.advance`). Travel the whole spine from the
   summit to the docks and back up on rides at play speed and look for: holes in the ground or
   missing buildings in view, chunks popping in inside the fog distance, far-LOD seams, geometry
   count (`renderer.info.memory.geometries`) growing without bound over two round trips, a frame
   whose chunk-build share exceeds its budget by a wide margin. Screenshots at deviceScaleFactor 1.
3. **Look against DESIGN.** Take day and night screenshots in each of the four districts and at the
   line-up (`?world=lineup`) and prop town (`?world=proptown`). For each: are the district's
   signature props and palette there, are halftone shadows and misregistration visible, are windows
   and signs lit at night, can each of the 16 lines' vehicles be told apart by shape and livery, do
   animated kinds change on twos (12 Hz), do ground vehicles sit on the road and pitch with it?
   List anything that reads as a placeholder (plain boxes where DESIGN names a thing).
4. **Hot paths.** Read `cityView.ts`, `vehicles.ts`, `view.ts`, `camera.ts`, `main.ts` frame loop:
   per-frame allocation (closures, arrays, vectors, object literals) outside chunk builds is a
   defect. Disposal: every geometry/material/texture created is disposed when its chunk unloads
   and in `dispose()`.
5. **City fixes hold.** The city tests assert what the briefs asked (spawn rolls unaided, no traps,
   awnings bounce, handrails on stair streets, forklifts reach the east docks). Check no test was
   loosened to pass: compare the thresholds in `tests/sim/city*.test.ts` with the numbers in the
   briefs and DECISIONS, and write two or three bots of your own (in scratch, importing from
   `src/sim`) that wander from random starts for 3 000 ticks with random steer/hops and report any
   that end stuck (speed under 0.5 m/s for 600 ticks while not hitched and not on flat docks).
6. **Performance pass.** The vehicle memo returns bit-identical states whatever the order of calls
   (write your own randomised check over all 16 lines, including the blimp's vertical segments);
   `tests/perf/budgets.json` matches DESIGN §10 and DECISIONS 65–68; the perf route does what a
   player does (it is not parked somewhere cheap); the tour visits all four districts by day and
   night. Say whether dropping the one-step p95 budget is justified by what you measure.

## Return

A verdict per numbered check: PASS / FAIL / PARTIAL, each with the evidence (command, number,
screenshot path under `artifacts/`). Then a list of defects ordered by how much a player would
notice, each with file and line. No file contents. Keep it under 700 words.
