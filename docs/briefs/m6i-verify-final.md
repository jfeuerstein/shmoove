# Brief M6i — verify the last changes: onboarding fixes, finishable secrets, foot down, camera

Role: verifier (`.claude/agents/verifier.md`). Fresh context. You change no source file; throwaway
scripts go in a scratch directory outside `src/` and `tests/`. Report, do not repair.

Read `CLAUDE.md`, `docs/DESIGN.md`, `docs/DECISIONS.md` items 71–99, and the briefs
`docs/briefs/m6g-onboarding-fixes.md` and `docs/briefs/m6h-secrets-finishable.md`. A decision
recorded in DECISIONS is not a defect; a brief requirement dropped without one is.

## What to check

1. **Gate.** `npm ci`, then `npm run gate` once. Report each stage and the perf table (per window
   and pooled) with the load average. If only a timing budget fails, rerun `npm run perf` alone
   once and report both.
2. **Tests were not loosened.** Read the test diffs of these merges
   (`git log --merges --oneline -8`, then `git diff <merge>^1 <merge> -- tests/`): for every
   changed assertion or threshold in an existing test, say whether the new form still asserts the
   behaviour a player would observe and whether the change is explained in DECISIONS. Known
   changes to judge: `citySummit.test.ts` runs 6600 ticks instead of 4000; `city.test.ts` now
   allows one rail at the needle; the chalk damage case; the full-game test's save condition; the
   start check in `tests/e2e/routes/city-first-launch.mjs`; Saffron's errand hours.
3. **The first minute with your own players.** Bots of your own in scratch (new game as
   `src/app/newGame.ts` makes it, hints on, seeing only what a player sees: the hint, its pointer
   target, their own state), 40 seeds each, 5 simulated minutes: one who reacts 1–3 s late; one
   2–6 s late with ±30 % steer noise who sometimes lifts the finger early; one who ignores every
   hint for the first 60 s; one who does nothing at all. Report completions, median time, where
   the others end and why. For the do-nothing player: where do they come to rest, does the
   "wiggle to roll" hint show, and if they then wiggle, can they get off that spot without a bail
   and reach a ride (a spot whose only exit is a fall that bails and respawns them on it is a
   trap: say so with coordinates)?
4. **Foot down** (`src/sim/player.ts`, `tests/sim/foot.test.ts`, DECISIONS 77). Try to break it
   with scratch sims in the city: can a player still catch a ride from behind by pressing early at
   4–7 m/s within 10–25 m of it; does a standing skater beside each ground line's lane at each of
   its stops get picked up or knocked down (try 1.5, 2.5, 3.5 and 4.5 m from the lane centre);
   can holding still ever stop a skater somewhere they cannot leave; does it change any chalk
   replay or the determinism hashes (two runs, same inputs).
5. **Secrets.** With bots or by reading the full-game test's run: the blimp is catchable by a hop
   from the hill station platform at its time and sets the rider down unhurt; the king kite ride
   earned by the four-link chain inks all of S3; the guy wire takes a skater from the needle to
   the lawn without a bail, whether they roll or hop off, and cannot be ridden up; the platform
   can be reached standing from the lawn at 6, 10, 14 m/s and from the stairs; no errand giver's
   offer zone overlaps a stop's waiting area; an ignored offer stays away 45 s; a save on the
   first grounded tick after a ride resumes there; the day count survives a save. Then look for
   what the changes broke: every other line's timetable and stops unchanged
   (`git diff` of `src/sim/city/lines.ts` and `routes.ts`), the six scheduled meetings still
   meet, the climb from docks to summit still works.
6. **Camera** (`src/render/camera.ts`, `tests/unit/camera.test.ts`). Drive the built game with
   Playwright through `city-first-launch`, `city-spine` and a descent of your own down the Mercado
   stairs under the awnings, a frame every 10 ticks at deviceScaleFactor 1, and look at the
   frames: any frame where the skater is not visible, is off the bottom, or the view is filled by
   one surface is a defect (give the tick and the screenshot). Also take a screenshot standing at
   the summit showing the guy wire, and one at the hill station showing the run-in steps, and
   say what they look like.
7. **Look, once more.** Day and night screenshots in each district after the haze and night-tint
   changes (`FOG_NEAR`/`FOG_FAR`, night `tint` in `src/render/look.ts`): does the far city arrive
   in haze rather than popping, does night read as night with lit windows, can rails, stair edges
   and rides be read at night?

## Return

Verdict per numbered check (PASS / FAIL / PARTIAL) with evidence (command, numbers, screenshot
path under `artifacts/verify/`). Then defects ordered by how much a player would notice, each with
file and line. No file contents. Under 800 words.
