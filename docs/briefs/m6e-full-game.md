# Brief M6e — the full-game check: first launch to a completed line map, by play alone

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes; WIP commits are fine if `npm run typecheck` passes): uncommitted work
can vanish without warning.

## Goal

Prove that the shipped game can be finished. A scripted skater starts a **new game** exactly as the
app does on first launch (same world, same spawn, same new-game clock, onboarding on) and, with
nothing but `InputFrame`s fed to `Game.step`, plays until the line map is complete
(`progress.mapComplete`, the `mapComplete` game event). Then it goes on and inks the secret lines
too. No teleports, no `placePlayer`, no writes to sim or game state, no changes to `FEEL`, no
special world: the bot sees what a player sees (its own state, the world, the timetable, events).

This is a test of the game, not of the bot. Where the bot cannot do something a player is supposed
to be able to do, that is a finding: report it with specifics rather than papering over it.

## Read first

`CLAUDE.md`, `docs/DESIGN.md` (rides roster, line map, secrets), `docs/DECISIONS.md` (skim),
`src/sim/game/game.ts`, `src/sim/game/progress.ts` (how segments ink, `INK_SLACK`,
`allNonSecretComplete`), `src/sim/game/secrets.ts`, `src/sim/game/onboarding.ts`,
`src/sim/city/lines.ts` (the 16 lines, hours, `minChain`, `MEETINGS`), `src/sim/lines.ts`
(`vehicleAt`, `ticksToArrival`, `grabPoint`), `src/sim/hitch.ts`, and the existing bots, which
already solve most of the pieces: `tests/sim/cityClimb.test.ts` (docks to summit on rides),
`tests/sim/citySummit.test.ts` (the four-link summit chain), `tests/sim/onboarding.test.ts` (first
launch), `tests/sim/conductors.test.ts`, `tests/sim/errands.test.ts`, `tests/sim/helpers.ts`. Find
where the app creates a new game (`src/app/main.ts`, `NEW_GAME_DAY_FRAC`) and build yours the same
way.

## Files you own

- `tests/sim/bot/**` (new): the reusable closed-loop skater (navigation to a point, wait at a stop,
  catch a named line, ride to a stop, release, descend to a district). Lift what is common out of
  the existing bots **by copying**, not by editing their test files.
- `tests/sim/fullGame.test.ts` (new).
- `docs/PLAN.md` (the M6 full-game line only), and a short entry in `docs/DECISIONS.md` for
  anything you had to decide.

Nothing in `src/`. If the game needs a change for the run to be possible (a segment that cannot be
inked, a stop that cannot be reached, a line whose hours never coincide with a way to get there),
stop and report it: line, segment, what the bot tried, what happened, the tick.

## Acceptance tests (`tests/sim/fullGame.test.ts`)

1. **New game to map complete.** From a new game, the bot inks every segment of every non-secret
   line and the game emits `mapComplete` exactly once. Assert along the way: onboarding completes;
   the skater's position never jumps more than a skater can move in a tick except on a bail
   recovery (count them and assert the count is modest: say what it was); no stretch of 3 simulated
   minutes passes without a newly inked segment or a change of district (the bot is never stuck);
   the whole thing takes less than 90 simulated minutes (report the figure, and the per-line order
   and time).
2. **The secrets.** Continuing the same game: the ghost tram (night), the blimp, and the summit
   route with its four-link chain are each inked or found as `secrets.ts` defines; every line's
   `complete` is true at the end.
3. **Save in the middle.** At three points (after onboarding, at about half the segments, just
   before the last segment) export the save through the real save code, build a fresh `Game`,
   import, and continue with the same bot: the final state hash and the list of game events match
   the uninterrupted run.
4. **Determinism.** Two full runs give the same hash at the end.
5. **Cost.** The test file runs in under 90 s on this machine (the sim steps at tens of
   microseconds; if the bot's planning dominates, make it cheaper rather than the run shorter).
6. `npm run typecheck`, `npm run lint`, `npm test` green. (You do not need to run the whole gate.)

Tests assert what a player would observe. Do not weaken an existing test.

## Return

A short summary: the order the bot inked the lines in and the simulated time for each, total time,
bails, anything in the game that made the run harder than it should be for a human (a stop that is
awkward to reach, a ride that leaves just as you arrive, a wait over a minute), each with line and
place. Commands run with pass/fail. Changed files. No file contents. Commit on your current branch;
do not push or merge.
