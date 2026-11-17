# Brief M6g — a first minute that clumsy players get through

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes): uncommitted work can vanish without warning.

## Why

An independent check of onboarding (`docs/briefs/m6b-onboarding.md`) passed the code and failed the
lesson. With bots that know only what a player knows, 30 seeds each, 5 simulated minutes:

| Player | Completed | What went wrong |
| --- | --- | --- |
| Attentive (reacts 0.5–1.5 s late) | 18/30 | 10 never grind, so the lesson never ends |
| Clumsy (reacts 2–6 s late, imprecise) | 1/30 | 22 never hitch: the hitch hint is up ~3 s while they roll past the first stop; then they are below it with no way back, and roll to the docks |
| Fast, skips the stairs' rail | 8/30 | 21 never grind |

Also: the pointer is often off-screen or hidden behind the HUD or the cart's parasol; a crane whose
strap needs a hop was pointed at with "PRESS AND HOLD STILL"; a save from before onboarding
restarts the lesson and closes errands; two checks in the ride scan have no test.

## What changed underneath you (already on the branch)

**Holding a still finger now plants a foot** (`src/sim/player.ts`, `FOOT_*` in
`src/sim/constants.ts`, tests in `tests/sim/foot.test.ts`): on the ground below `FOOT_SPEED`
(7 m/s), with the carve near zero and no grabbable ride within `FOOT_NEAR` (10 m), the skater
brakes at `FOOT_BRAKE` and then stands, even on a slope, and stays standing as a ride comes up; the
ride's grab point passing within reach latches as before. Dragging while holding keeps rolling. So
"PRESS AND HOLD STILL" now literally stops you where you are to wait, and a player can wait at a
stop. Use it.

## What to do

1. **Completion is carve, hitch, sling, ink**, then the map pointer and the last ticket. `hop` and
   `grind` stay as hints that show in their situations until each has been done once, before or
   after completion (as `chain` already does). They no longer hold anything back.
2. **The hitch hint leads the player to the ride instead of announcing it as it passes.**
   - Show it early: when the skater is heading for a stop (within about 45 m, at or below their
     height, on their way) where a ground ride they could grab will stand or pass within about
     20 s. Point at a waiting spot beside the lane (within reach of where the grab point will
     pass, clear of the vehicle's body), not at the ride. Copy: "PRESS AND HOLD STILL". Once the
     ride is within 30 m the pointer moves to its grab bar, as now.
   - Until `hitch` is learnt, never point at a ride that needs a hop to reach. After it, such
     rides get their own copy ("FLICK UP, THEN HOLD").
   - Make the pointer impossible to miss: a chevron at least 1.2 m tall floating clear above the
     vehicle (parasols and roofs included), and when its target is off-screen or behind the HUD,
     an arrow at the screen edge (or on the stub) turning toward it, from the target projected to
     the screen each frame.
3. **A rescue hint for a stalled skater** (`roll`): standing on the ground for 3 s without holding,
   with no slope to take them: "WIGGLE TO ROLL" with the slide glyph; done when they have pumped
   themselves above 2 m/s once. Not part of completion. The docks are flat: a player who missed
   every ride ends up there, and nothing told them that carving back and forth moves the board.
4. **Only a release the player made counts as the sling** (not the ride letting go of them).
5. **Old saves:** a save with no onboarding section but with any progress (an inked segment, an
   errand, a conductor ticket, a chalk line) is a player who has learnt the game: steps done,
   errands open, no lesson. A save with nothing in it gets the lesson.
6. **Tests the verifier found missing:** the ride scan's "stays in service" check and its "ride on
   a street below a wall" check each get a test that fails without them; the save round trip goes
   through the real save code (`exportSave` → JSON → `migrate` → `importSave`).
7. **Players, not a perfect bot** (`tests/sim/onboardingPlayers.test.ts`): bots that see only what
   is on screen (the current hint and its pointer target as the onboarding state exposes them,
   their own position and speed; no vehicle scans, no timetable, no hard-coded coordinates),
   30 fixed seeds each, new game as `src/app/newGame.ts` makes it, 5 simulated minutes:
   - attentive (acts on a hint 0.5–1.5 s after it shows, steers toward the pointer): at least
     27/30 complete;
   - clumsy (2–6 s late, steer noise of ±30 %, holds a second longer than needed): at least 20/30;
   - fast (never hops onto a rail): at least 27/30;
   - does nothing: the `roll` hint is on screen once they have come to rest.
   Do not lower these numbers. If onboarding changes alone cannot reach them, stop and report what
   in the city or the timetable is in the way, with places and times.
8. **The browser route** `tests/e2e/routes/city-first-launch.mjs` and its sim replay are
   regenerated for the new flow; open every screenshot and check the pointer is visible in each
   one that has a target.
9. Correct `docs/DECISIONS.md` item 72 (0.4036 of a day is 09:41, not 10:41) and append an entry
   for what you decided here.

## Files you own

`src/sim/game/onboarding.ts`, `src/ui/hint*.ts`, `src/render/hintView.ts`, the save migration for
item 5 (`src/sim/game/save.ts` or where migration lives), minimal edits in `src/ui/index.ts` and
`src/app/main.ts` (another agent is editing the perf timing in `main.ts`: keep your diff small),
`tests/sim/onboarding*.test.ts`, `tests/unit/ui/hint*.test.ts`,
`tests/e2e/routes/city-first-launch.mjs`, `docs/DECISIONS.md` (item 72 and one new entry).
Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`, `src/render/camera.ts`, `src/sim/city/**`,
`src/app/newGame.ts`'s clock unless the players test needs a different one (then say why).

## Acceptance

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm run e2e -- city-first-launch` all green, with the players test at the thresholds above.

## Return

The players table (completed out of 30 per bot, and where the rest ended), what you changed for
each numbered item, what each screenshot shows, anything about the city that still makes the
first minute worse than it should be. Commands run with pass/fail. Changed files. No file
contents. Commit on your current branch; do not push or merge.
