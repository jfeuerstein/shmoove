# Brief M7a — bring the game in line with the new controller

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes): uncommitted work can vanish without warning.

## Why

The owner played the game and found it clunky and slow (DECISIONS 112). The lead changed the
movement controller in response (DECISIONS 113–115, commit "After the first playtest"):

- **Hold never brakes.** The planted foot from holding a still finger is gone (`FOOT_SPEED`,
  `FOOT_STEER`, `FOOT_STAND`, `FOOT_NEAR` are deleted). A thumb resting on the glass does nothing
  but reach for rides.
- **Brake is its own input.** `InputFrame.brake` (optional boolean): on the ground it brakes at
  `FOOT_BRAKE` from any speed and holds the board still on a slope. The touch gesture is the
  finger pulled down `BRAKE_PULL_PX` from where it landed (`src/input/gestures.ts`); the keys are
  ArrowDown and S. `Game.step` passes it to the sim (`AppliedInput.brake`).
- **Speed.** `STAIR_DRAG` 0.85 → 0.35, `ROLL_RESIST` 0.3 → 0.15, `AIR_DRAG` 0.006 → 0.0045,
  `TURN_RATE_MAX` 2.4 → 3.0, `LAT_ACCEL_MAX` 10 → 18, `GRIND_ENTRY_BOOST` 1 → 3.5,
  `HITCH_REACH` 4.5 → 6.5, `SLING_MIN` 6.5 → 11, `SLING_GAIN` 1.14 → 1.2, `WALL_BAIL_SPEED`
  12 → 20, `BAIL_TIME` 1.3 → 0.9.
- **Pumping.** Carving back and forth drives the board up to `PUMP_SPEED_CAP` 7 m/s, fading
  toward the cap, on the flat and downhill only (`PUMP_UPHILL`).

`npm test` now has 30 failures in 11 files and the open-loop browser routes are stale. Your job is
a green gate on this controller without changing how it feels.

## What to do

1. **Brake end to end.**
   - Chalk lines record it: a recorded line replays exactly when the player braked. Widen the
     frame storage or add a third event stream as you judge best (`src/sim/game/chalk.ts`,
     `game.ts`); share codes stay canonical and as small as they are for lines without braking;
     `CHALK_VERSION` stays 1 (nothing has shipped: DECISIONS 109). Tests: a line with braking
     round-trips through its code and its ghost matches tick for tick.
   - Gesture tests (`tests/unit`): pulling down past the threshold brakes, coming back up
     releases, a resting or carving thumb never brakes, a swipe up still hops, brake and hold
     can be true together (waiting at a stop with a hand out).
   - Onboarding (`src/sim/game/onboarding.ts`, `src/ui/hint*.ts`): where the lesson told the
     player to "PRESS AND HOLD STILL" to stop at the waiting spot, it now teaches the brake: lead
     to the spot, "PULL DOWN TO STOP" (a new glyph: thumb dragging down) until they stand in the
     ring, then "HOLD FOR THE RIDE". With rides now catchable on the move from 6.5 m, braking is
     an option the lesson shows once, not a step that completion needs: a player who catches the
     ride rolling past has learnt the hitch. Keep completion as carve, hitch, ink, sling.
   - Errand offers: holding still in a giver's ring used to take the errand. A resting thumb is
     now always "holding", so offers would be taken by rolling through. An offer fills only while
     the skater is braking or standing (speed under 1 m/s) in the ring; copy "PULL DOWN TO TAKE".
   - Bots and tests that waited by holding still now brake (`tests/sim/bot/**`,
     `onboardingPlayers`, `citySecrets`, `fullGame`): the bots brake where a player would.
2. **Tests that encode the old numbers.** For each failing test decide which it is:
   - It asserts a behaviour that still holds and only its setup or numbers are stale (speeds,
     tick counts, positions of scripted releases): re-find the setup so it asserts the same
     behaviour. The scripted chains and meetings (`cityLines`, `citySummit`, `citySecrets`,
     `content`) were found by search before; find them again.
   - It asserts the old design, which DECISIONS 113–115 changed on purpose. There are four, and
     each gets a new assertion of the new design, not a deletion: stairs cost some speed but are
     a real way down (top speed on the slice's stairs between 9 and 15 m/s) and the rail is
     still clearly the faster line (at least 15 % quicker end to end, exit above 16 m/s); a
     square wall hit bails only above `WALL_BAIL_SPEED`; the bail's length follows `BAIL_TIME`;
     the city's "no traps" and "wanderer" tests keep their meaning (nobody pinned; a random
     wanderer still bounces, lands on roofs and grinds) with thresholds re-measured and the
     measurement reported.
   - If a behaviour really broke (not a stale number), stop and report it with the test, the
     tick and what happens: do not adjust a test around a controller bug. The controller files
     (`src/sim/player.ts`, `src/sim/hitch.ts`, `src/sim/constants.ts` values,
     `src/render/camera.ts`) are the lead's.
3. **Open-loop routes.** Re-find the scripted touches of every e2e route that fails
   (`tests/e2e/routes/*.mjs`) and the first-launch replay, by search in the deterministic sim
   as before; assertions stay as strict as they are. `tests/unit/perfRoute.test.ts` and the
   `perfcity` legs in `src/app/routes.ts`: re-find starts so each window still travels, hitches
   and crosses chunks as the harness requires.
4. **New-game clock.** With the skater twice as fast, the first ride no longer meets a new player
   at the first stop: re-derive `NEW_GAME_DAY_FRAC` (`src/app/newGame.ts`) and the tolerance test.
5. **Documents.** `docs/DESIGN.md` (controls table: brake; movement numbers), `docs/PLAYTEST.md`
   (every `FEEL` key present, deleted ones gone, the brake and pumping questions added),
   `README.md` keys, `docs/DECISIONS.md` (append after item 115, before "Cut").

## Files you own

`tests/**`, `src/sim/game/**`, `src/ui/hint*.ts` and the minimal mounting in `src/ui/index.ts`,
`src/input/gestures.ts` only if a test exposes a defect in the pull-down gesture (say what),
`src/app/newGame.ts`, `src/app/routes.ts`, `docs/**`, `README.md`.
Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`, the values in `src/sim/constants.ts`,
`src/render/**`, `src/sim/city/**` (another task will change the rides after you).

## Acceptance

`npm run gate` green. The players test at its thresholds (attentive ≥ 27/30, clumsy ≥ 20/30,
fast ≥ 27/30) with bots that rest a thumb on the glass between actions (hold true whenever they
are not steering): that is how a person plays, and it is what broke last time.

## Return

For every test you changed: which kind it was (stale setup, or old design re-specified) and the
old and new numbers. Anything that looks like a controller defect. The new-game clock and when the
first ride meets a player. Commands run with pass/fail. Changed files. No file contents. Commit on
your current branch; do not push or merge.
