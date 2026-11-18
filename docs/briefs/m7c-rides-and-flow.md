# Brief M7c — always something to grab, and a number for "is it flowing"

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.
Start only after task M7a has merged (the lead will say so): it re-finds the scripted routes on the
new controller, and this task changes the timetables under them.

## Why

The owner played the game (DECISIONS 112): "quick bursts of kind of boring movement, followed by
slowly getting dragged around by various vehicles and waiting around/moving at 1 mile an hour
trying to figure out how to gain any speed again or go anywhere". The controller is now twice as
fast (DECISIONS 113–115). The rides are still slow and rare: the handcart cruises at 3.5 m/s, the
parade at 2.2, the crane at 4, cable cars and forklifts at 7; most lines have one to four vehicles
on a 1.3 km hill; several lines sleep for half the day; at the bottom of the hill there may be
nothing to catch for a minute or more.

## Part 1 — measure it (do this first, report the baseline before changing any ride)

`tests/sim/playProfile.test.ts` with a bot in `tests/sim/bot/casual.ts`: a casual player, not a
planner. It knows nothing of timetables. It rests a thumb on the glass (hold true) except while
carving; rolls downhill carving; steers for a ride it can see within 40 m and roughly ahead; when
towed, swings once and lets go after 2–5 s unless the ride is taking it uphill, in which case it
stays on to the next stop; pumps when slow on flat ground; at the bottom looks for any ride going
up. Play 20 simulated minutes from a new game at three seeds and three times of day (morning,
afternoon, night) and report, then assert:

| Measure | Target |
| --- | --- |
| Mean speed off a ride | ≥ 11 m/s |
| Share of time off a ride under 3 m/s | ≤ 8 % |
| Longest stretch under 3 m/s | ≤ 12 s |
| Mean speed on a ride | ≥ 10 m/s |
| Share of time on a ride | between 15 % and 40 % |
| Time from reaching the docks to being on a ride going up, median / worst | ≤ 15 s / ≤ 40 s |
| Time between hitches, median | ≤ 25 s |
| Height regained by rides per minute | enough that the bot is back above the Mercado within 90 s of reaching the docks |
| Bails per minute | ≤ 0.5 |

These are the game's flow budgets from now on; they go in `docs/DESIGN.md` beside the frame
budgets. If a target cannot be met by ride data alone (it needs the controller or the city's
shape), say which and by how much: do not lower it.

## Part 2 — the rides

In `src/sim/city/lines.ts` and `routes.ts`:

- **Fast.** Every ordinary line cruises at 10 m/s or more (the parade and the crane may be
  slower: they are set pieces). Shorter dwells (2 s) and brisker acceleration.
- **Frequent.** At every stop of every ordinary line, during its hours, the gap between
  vehicles is at most 30 s; on the lines that climb the hill from the docks (the funicular, the
  trams) at most 20 s. Add vehicles.
- **Never asleep.** At any time of day every district has at least two ground lines in service,
  and at least one line climbing out of the docks.
- **Through traffic.** New un-inked traffic (not on the line map, no stops, hitchable like
  anything else): vans and mopeds looping the vehicle streets top to bottom in both directions,
  so that on any vehicle street something passes within reach every 10–15 s. Give it its own
  kinds or liveries so it reads as traffic, and its stem in the district mix.
- The secret lines (S1–S3) and the summit chain keep their timing and geometry
  (`tests/sim/citySummit.test.ts`, `citySecrets.test.ts`): do not disturb them.
- Draw-call budget: each drawn vehicle is a mesh. `npm run perf` must stay green (tour maximum
  under 110 draw calls); cull or thin by distance in `src/render/vehicles.ts` if needed.

Then re-find what depends on the timetable: the six meetings, the climb, the errands' and
conductors' limits, the full-game bot's plan, the new-game clock and the first-launch route, the
`perfcity` legs. Assertions stay as strict as they are; numbers that were measured from the old
timetable are measured again and reported.

## Files you own

`src/sim/city/lines.ts`, `src/sim/city/routes.ts`, `src/sim/lineup.ts`,
`src/render/vehicles.ts` and `src/render/vehicleKinds/**` (new traffic kinds),
`src/sim/game/content/**` (limits), `src/app/newGame.ts`, `src/app/routes.ts`, `tests/**`,
`docs/DESIGN.md` (roster, flow budgets), `docs/PLAYTEST.md`, `docs/DECISIONS.md` (append before
"Cut"). Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`, values in `src/sim/constants.ts`,
`src/render/camera.ts`, `src/render/dress/**`, `src/ui/**`.

## Acceptance

`npm run gate` green, with `playProfile` at its targets, the headway and never-asleep rules as
tests over the whole day, and the full-game bot still completing every line.

## Return

The profile table before and after (per time of day), the roster as it is now (cruise, vehicles,
headway, hours per line), what each target cost, anything that needs the controller or the city
changed. Commands run with pass/fail. Changed files. No file contents. Commit on your current
branch; do not push or merge.
