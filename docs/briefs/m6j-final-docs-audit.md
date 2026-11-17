# Brief M6j — final documents, small defects and the ship audit

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes).

The game is built. This task makes the repository say so truthfully and closes the small things.

## 1. Documents that match the code

Read the code, not the old text, and correct each document where they differ. Do not invent:
if you cannot find it in the code or tests, it does not go in.

- `docs/DESIGN.md`: sweep every section. Known to be stale: the input section (holding a still
  finger plants a foot: DECISIONS 77), the camera (frame limit, sight-line check), onboarding
  (DECISIONS 71–76, 88–93), the rides roster (speeds, hours, vehicle counts and stops from
  `src/sim/city/lines.ts`; S2 and S3 as they are now), errands and conductors (counts, names),
  secrets, chalk (the `SK2-` format and its size), saves (version 2), budgets and what the perf
  gate measures (§10), the look (haze distances, night tint), audio.
- `docs/PLAN.md`: every milestone's real status and result, with the numbers from the last gate
  run (`artifacts/perf.json`, test counts), and what was verified by whom. No open items that
  are done; anything truly open says so.
- `docs/DECISIONS.md`: one numbered list with no duplicate or missing numbers, each entry still
  true (where a later entry overturns an earlier one, the earlier one says "superseded by N").
  Add a final section **Cut** listing everything in the original design that was not built or
  was built smaller, each with one line of why. Find them by comparing DESIGN's promises with
  the code; known ones: standing on vehicle roofs, real shadow maps, Capacitor (by instruction),
  online sharing of chalk lines (local only by design).
- `docs/PLAYTEST.md`: every `FEEL` key appears in it or is plainly not a thumb's call; every
  constant it names exists (check mechanically against `src/sim/constants.ts` and the other
  files it cites); the "Play these first" list is the ten things most likely to be wrong, in
  order, starting with frame time on a real phone, the first minute, hitching, the sling, the
  camera on stairs and under awnings, waiting at a stop with a planted foot, night readability.
- `README.md` and `CLAUDE.md`: commands, layout, URL parameters, deploy steps as they are.
- `docs/briefs/README.md`: an index of the briefs with one line each and the outcome.

## 2. Small defects

- The chain meter flashes "lost" when a one-link chain ends (`src/ui/chain.ts`): a single ride
  is not a chain; nothing was lost. Fix with a test.
- The line-up e2e route asserts nothing about liveries: add assertions through the test hook
  that each of the 16 lines draws with its own livery pair (ids or colours as the hook can
  expose them; add the minimal hook field if needed).
- `docs/DECISIONS.md` item 72 and anything else that states a time of day: check against
  `NEW_GAME_DAY_FRAC` and the board's clock.
- Any console warning or error during `npm run e2e` (the runner collects them: make sure it
  fails on one, and fix what it finds).

## 3. The audit

- No placeholders: search the tree (excluding `node_modules`, `dist`, `artifacts`) for `TODO`,
  `FIXME`, `XXX`, `HACK`, `placeholder`, `stub`, `not implemented`, `lorem`, `temp`, empty
  function bodies and commented-out code. Each hit is either removed, finished, or (if it is a
  legitimate word in context) left; list what you did with each.
- No dead files: scratch folders, throwaway scripts, unused exports (`npx ts-prune` is not
  installed and must not be added: use `tsc --noUnusedLocals --noUnusedParameters` once and
  grep for exports nothing imports). `tests/perf/profile.mjs` stays (a documented diagnostic).
- Dependencies: `package.json` holds only what is used; no asset files in the repo other than
  generated icons and the manifest (list any binary file found).
- Fresh clone: `git clone` this repository's current branch into a temporary directory outside
  the repo, then `npm install`, `npm run build`, `npm test` there. Report the result and timings.
- `npm run gate` green at the end, on as idle a machine as you can get.

## Files you own

`docs/**`, `README.md`, `CLAUDE.md`, `src/ui/chain.ts` and its test,
`tests/e2e/routes/lineup*.mjs`, `tests/e2e/run.mjs`, the minimal hook field in
`src/app/testHook.ts`/`main.ts`, and deletions of dead code anywhere (say what). Not yours: any
behaviour change in `src/sim/**` or `src/render/**`. If the audit finds a real defect there, report
it; do not fix it.

## Return

What changed in each document (a line each), the Cut list, the audit's findings and what you did
with each, the fresh-clone result, the final gate table. Commands run with pass/fail. Changed
files. No file contents. Commit on your current branch; do not push or merge.
