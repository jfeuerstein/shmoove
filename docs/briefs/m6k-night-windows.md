# Brief M6k — the city is lit at night

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.

## Why

DESIGN says windows, signs and lamps glow mango at night. The last independent check
(`docs/briefs/m6i-verify-final.md`) found night reads as night (cobalt) but almost nothing is lit:
one mango window in a Mercado view, none from the lookout or on the Terraces. The mechanism
exists: a vertex `glow` attribute that `inkMaterial()` turns into mango when `uNight` rises
(`src/render/look.ts`), and `src/render/dress/solids.ts` gives some windows a lit flag. Find out
why so little of it shows in the streamed city (too few windows on the building kinds the city
uses, lit share too low, windows dropped at the distances they are seen from, glow lost in the far
level of detail, quads too small to survive at phone size) and fix it.

## What "lit" means here

Standing at each of the perf tour's viewpoints at night (`?route=tour&t=0.9`, see
`tests/perf/run.mjs` and `tourPoints` in `src/app/routes.ts`) and on a descent of the spine at
night, every view that has buildings in it shows clearly lit windows on them: in the near city
most buildings have some windows lit (about half of their windows, in an irregular pattern that
does not change from frame to frame or as chunks reload), and the far silhouettes carry at least a
scatter of lit points so the hill reads as a town. Street lamps and stall bulbs along the spine
where DESIGN names them. By day nothing changes.

## Constraints

- Budgets hold: `npm run perf` passes, tour maxima stay under 120 draw calls and 180 000
  triangles (today 71 and 139.5k: you have room, spend it carefully; a lit window in the far
  level of detail should cost two triangles or none, e.g. by colouring existing faces' vertices).
- No per-frame work: lighting is baked into chunk geometry through `glow`; no new materials, no
  new draw calls per building.
- Deterministic dressing: which windows are lit comes from `hash2`/the solid's index, as now.
- Chunk build pieces stay small (`tests/unit/chunkPieces.test.ts` must pass unchanged).

## Files you own

`src/render/dress/**`, `src/render/worldMesh.ts`, `src/render/cityView.ts` (only if the far level
of detail needs it), new tests under `tests/unit/`, `docs/DESIGN.md` (the look section's night
paragraph), `docs/DECISIONS.md` (append one entry after the last numbered item, before "Cut").
Not yours: `src/render/look.ts`, `src/sim/**`.

## Acceptance

1. A unit test builds every city chunk at both levels of detail and asserts: in the near level,
   at least 60 % of buildings with windows have a lit one and between 35 % and 65 % of all
   windows are lit; in the far level, at least 25 % of buildings carry a glowing vertex; day
   geometry (positions, colours) of everything that existed before is unchanged apart from added
   quads.
2. Night screenshots at all nine tour viewpoints and four on a night descent, before and after,
   at deviceScaleFactor 1, saved under `artifacts/night/` and also copied to
   `/tmp/claude-0/-home-user-shmoove/18699613-b328-589d-85de-f067a4fdd11b/scratchpad/night/`.
   Open every one and describe it; iterate until each view with buildings shows lit windows a
   player would notice on a phone.
3. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`,
   `npm run perf` green (rerun perf alone if a timing fails under load, and report both).

## Return

What was wrong, what you changed, the counts from the unit test, tour maxima before and after,
what each screenshot shows. Commands run with pass/fail. Changed files. No file contents. Commit
on your current branch; do not push or merge.
