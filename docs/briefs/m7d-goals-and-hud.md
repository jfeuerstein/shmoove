# Brief M7d — one goal on screen, and less of everything else

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.
Start only after task M7a has merged (the lead will say so).

## Why

The owner played the game (DECISIONS 112): "objectives are confusing" and "UI a little
overwhelming and unclear". Today a player sees a two-row split-flap board (place, speed, clock),
four corner buttons, a chain meter, a stop board, toasts, hint stubs, errand tickets that offer
themselves, conductor cards and inked-segment tickets, and nothing that says what they are
supposed to be doing after the first-launch lesson ends.

## The design

**One goal, always.** At every moment the game can say, in six words or fewer, what to do next
and where:

- During the first-launch lesson: its hints, as now.
- After it, by default: the line map. The goal is the nearest segment not yet inked that the
  player can get to from where they are (prefer one at or below their height, on a line in
  service now or within a minute): "RIDE TRAM 5 TO ESCUELA", with the pointer (the world chevron
  and the screen-edge arrow the hints already use: `src/render/hintView.ts`, `src/ui/hint*.ts`)
  on the stop to catch it at, and its next arrival there as a small countdown. On that line
  already: "STAY ON TO ESCUELA". Progress is one number: segments inked out of the total.
- With an errand or a conductor challenge taken: its current step replaces the default, in the
  same place and form, and the default returns when it ends.
- Map complete: the secrets, one at a time, as riddles ("SOMETHING RUNS THE TUNNEL AT MIDNIGHT").

The goal is a pure function of game state, computed in the game layer
(`src/sim/game/goal.ts`, a reducer like the others, deterministic, at most every 20 ticks), so it
can be tested without a browser.

**Less on screen.**

- The top board is one row: the goal. Place names flap in for two seconds on entering a
  district or passing a stop, then give way to the goal. No speed, no clock in normal play
  (the clock shows on the stop board and the map).
- Two corner buttons: the map (which carries progress) and a menu (pause, chalk lines, ledger,
  settings). The current four become entries in the menu.
- The stop board shows only while the skater is braking or standing within a stop's zone.
- At most one transient thing at a time (toast, inked ticket, hint): a queue with priorities,
  nothing stacked. Inked tickets shrink to a one-line stamp ("TRAM 5 · ESCUELA ✓ 12/41").
- The chain meter shows from the second link, as now, and nothing for a single ride.
- Errand and conductor offers are never thrown at a rolling player: a giver waves, with a small
  marker over them; the offer ticket appears only once the skater has braked to a stand in the
  ring (task M7a makes the sim rule; you make the UI match).
- Every string in play is at most six words. No sentence explains a rule; the lesson does that.

## Files you own

`src/sim/game/goal.ts` (new) and its registration in `src/sim/game/game.ts`, `src/ui/**` except
`hint*.ts` internals (extend their pointer API if you need to; say what), the goal pointer in
`src/render/hintView.ts`, minimal wiring in `src/app/main.ts`, tests under `tests/unit/ui/**` and
`tests/sim/goal.test.ts`, the e2e routes' UI expectations (`tests/e2e/routes/*.mjs`,
`src/app/testHook.ts` fields), `docs/DESIGN.md` (UI section), `docs/DECISIONS.md` (append before
"Cut"). Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`, `src/sim/city/**`, `src/render/dress/**`.

## Acceptance

1. `tests/sim/goal.test.ts`: from a new game played by the full-game bot, there is a goal at
   every tick after the lesson; it names a segment that is not inked and a stop on that
   segment's line; following it (catch at the pointed stop, ride to the named stop) inks that
   segment; it never points at a line out of service for more than a minute; it changes when the
   segment is inked; errand and conductor steps take it over and give it back; determinism.
2. Screenshots at 390x844, deviceScaleFactor 2, of: free play in each district, on a ride,
   at a stop braking, an errand offer, an errand under way, an inked stamp, the map, the menu.
   Open each: count the separate UI elements on screen (target: at most three in free play, the
   goal row and two buttons) and check nothing covers the skater or the ride.
3. `npm run gate` green.

## Return

What the goal says in each situation (the exact strings), the element count per screenshot before
and after, what you removed, what each screenshot shows. Commands run with pass/fail. Changed
files. No file contents. Commit on your current branch; do not push or merge.
