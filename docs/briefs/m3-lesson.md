# The first-run lesson, "how to play", and a quieter HUD

Model: sonnet. Read `docs/PITCH.md` (rewritten: a standard survivor on a skateboard),
`docs/DECISIONS.md` items 42 to 47, `docs/briefs/README.md`, `docs/briefs/m2-common.md`,
`docs/briefs/m3-common.md`, then `src/app/main.ts`, `src/app/settings.ts`, `src/app/fixtures.ts`,
`src/app/params.ts`, `src/app/testHook.ts`, `src/ui/endScreen.ts`, `src/ui/hud.ts`,
`src/ui/cards.ts`, `src/sim/types.ts` (`EV_*`), `src/sim/world.ts` (`spawnEnemy`, the player,
`PHASE_CHOOSE`), `src/sim/build.ts`.

> **Restarted.** A first version of this task was stopped when the game's design changed. Its
> work is on the branch `wip/m3-lesson`: the structure (pure lesson logic in `src/app/lesson.ts`,
> the view, the how-to sheet, the `lessonDone` flag, the URL parameters, the `HOW TO PLAY` button)
> is right; what it says taught the old rules. Start by merging that branch into yours, then
> change the script, the sheet, the tests and the route to what is below.

## Why

The owner played the game for the first time and said they were confused about how to play it
properly. Nothing on screen said what to do. The game has since become simpler (weapons fire
themselves on timers, touching an enemy hurts, movement is just movement), and the lesson should
be as simple.

## You own

`src/app/lesson.ts`, `src/ui/lessonView.ts` (+ CSS), `src/ui/howTo.ts` (+ CSS),
`tests/unit/lesson.test.ts`, `tests/unit/howTo.test.ts`, `tests/e2e/routes/lesson.mjs`;
`src/ui/hud.ts`, its CSS and `tests/unit/hud.test.ts`. In `src/app/settings.ts` (+ test):
`lessonDone`. In `src/app/params.ts` (+ test): `lesson` and `nolesson`. In `src/ui/endScreen.ts`
(+ test): the `HOW TO PLAY` button under `AGAIN`. In `src/app/main.ts`: wiring. In the existing
e2e routes: `nolesson` where a route would otherwise open in the lesson, and the HUD assertions
below.

## The lesson

It runs on the real bowl, in a real run, with the spawn director off (`w.spawning = false`), the
run clock held (keep `w.run.ticks` at 0 from app code while it lasts) and the player unable to die
(health held at 30 or above). One line at a time, each with a condition:

1. **"Drag to steer."** Done when the thumb has steered for 2 s in total and the rider has gone
   15 m.
2. **"Tap to ollie."** Done on a hop.
3. **"Hills make you fast. Find one."** Done when the rider has gone faster than 16 m/s. After
   12 s without it the line becomes "Head for the dip in the middle."
4. **"Your weapons fire themselves. Stay out of reach."** Eight shufflers come up 25 to 35 m
   ahead. Done when three are dead.
5. **"Pick up the sparks. They are your levels."** Done when a card offer opens. If it has not
   after 10 s, give the player the XP they are short so it always comes.
6. **"Take a card."** Done when the card is taken. The real card screen shows; the lesson line
   sits above it and is not covered by it.
7. **"That is the game. Don't get touched."** for 2 s, then the lesson ends: `lessonDone` is
   saved and the run is restarted (`sim.reset()` and the rest of `restart`) with the director on.

A `SKIP` button (at least 44 px, top right under the kills counter) ends it the same way at any
time. The lesson shows when `lessonDone` is not set, unless `?nolesson`; `?lesson` forces it; it
never shows with `?flat`, `?solo`, `?horde`, `?arsenal` or `?perf`. During the lesson cards are
never auto-picked, whatever the setting.

**The view**: the current line in a band just under the top of the HUD (never over the middle or
the thumb zone), large enough to read at arm's length, a short tick when a step completes, seven
small dots for progress.

## How to play (`howTo.ts`)

A sheet reached from `HOW TO PLAY` on the end card, closed by a button on it. Seven lines, no
scrolling at 390x844:

- Drag: steer. Let go: coast. Tap: ollie.
- Tap again as you land and you keep your speed.
- Hills, half-pipes and the green pads make you fast.
- Your weapons fire themselves. You only have to move.
- Touching an enemy hurts. An ollie clears the small ones.
- Sparks are XP. A level is a card: a weapon, a level on one you carry, or a passive.
- Ride into crates. Circle shrines. Thread the gates. Fly through hoops.

And a button `REPLAY THE LESSON` that clears `lessonDone` and restarts into it.

## The HUD stops leading with the gear

Gears are no longer a rule the player needs. The huge gear numeral and the gear's name go. In
their place, small and top centre: the speed in m/s, tinted with `gearCss(gear)` so it still
warms up as the rider goes faster, and the ollie chain count when it is above zero. The clock,
kills, health bar, XP bar and build bar stay as they are. Existing e2e routes that assert on the
gear numeral or name (`boot`, `drive`, `touch`, maybe others) assert on the speed readout and the
sim state instead; no dead elements are kept for their sake.

## Acceptance

1. `npm run gate` is green.
2. `tests/unit/lesson.test.ts` drives the pure lesson logic with scripted states and events: each
   step completes on its condition and not before; the alternate line and the XP top-up happen
   when they should; skip ends it from any step; the order is fixed; nothing allocates per tick.
3. `tests/unit/hud.test.ts`: the speed readout's text and tint for several speeds and gears; the
   chain shows only above zero; no gear numeral or name exists; writes only on change.
4. `tests/e2e/routes/lesson.mjs` with `?hook&lesson`: the first line shows and nothing has
   spawned; each step is driven through the hook and the line changes each time, including a real
   touch on a card for step 6; `SKIP` ends it and a normal run begins with the clock at 3:00;
   after a reload the lesson does not show again; with `?hook&nolesson` it never shows. A
   screenshot of step 3 and one of the how-to sheet.
5. Open both screenshots with the Read tool and say what you see: the line is readable and is not
   over the rider or the thumb zone; the sheet fits without scrolling; the top of the screen is
   calmer than it was.
