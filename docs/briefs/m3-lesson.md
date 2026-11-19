# The first-run lesson and "how to play"

Model: sonnet. Read `docs/briefs/README.md`, `docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`,
then `docs/PITCH.md` sections 3 and 4, `src/app/main.ts`, `src/app/settings.ts`,
`src/app/fixtures.ts`, `src/app/params.ts`, `src/ui/endScreen.ts`, `src/ui/hud.ts`,
`src/sim/types.ts` (`EV_*`), `src/sim/world.ts` (`spawnEnemy`, the player), `src/input/source.ts`.

## Why

The owner played the game for the first time and said they were confused about how to play it
properly. Nothing on screen says that letting go is a verb, that the big number is the thing to
raise, or that below gear 3 everything hurts. The plan had a lesson in M6; it is needed now.

## Goal

A first-time player learns the game by doing it, in about a minute, with the horde held back until
they can use it. And anyone can look up the rules in one tap.

## You own

`src/app/lesson.ts` (the lesson's logic, pure: what step it is on and whether the step is done,
from the sim's state and events), `src/ui/lessonView.ts` (+ CSS), `src/ui/howTo.ts` (+ CSS),
`tests/unit/lesson.test.ts`, `tests/unit/howTo.test.ts`, `tests/e2e/routes/lesson.mjs`. In
`src/app/settings.ts` (+ its test): a `lessonDone` flag. In `src/app/params.ts` (+ test): `lesson`
(forces it) and `nolesson` (skips it). In `src/ui/endScreen.ts` (+ test): a `HOW TO PLAY` button
under `AGAIN`. In `src/app/main.ts`: wiring. In the existing e2e routes: add `nolesson` to their
URLs if they would otherwise start in the lesson.

## The lesson

It runs on the real bowl, in a real run, with the spawn director off (`w.spawning = false`) and
the run clock not counting toward the end (hold `w.run.ticks` at 0 from app code while it lasts).
One step at a time; each is one short line of text and a condition. The words below are the
words to use.

1. **"Drag to steer."** Done when the thumb has carved for 2 s in total and the mover has gone 15 m.
2. **"Now let go on a downhill. Letting go is how you get fast."** Done when the mover has been
   tucked while in gear 3 or higher. While waiting, if the mover is tucked and slow on level
   ground for 3 s, the line changes to "Steer to a slope first, then let go."
3. **"Tap to hop."** Done on a hop.
4. **"Tap again the moment you land."** Done on a clean hop (`EV_CLEAN_HOP`). After three hops
   that were not clean the line adds "A little earlier." or "A little later." (from whether the
   last tap came before or after the landing window).
5. **"The big number is your gear. Under 3, everything hurts."** Twelve shufflers come up 25 to
   35 m ahead of the mover. Done when the player has been in gear 3 and plowed one, or has been
   hurt twice (then it says "That is why. Find a downhill, let go, and go through them in 3.").
   The player cannot die in the lesson: health is held at 30 or above.
6. **"Your trail burns. Circle back onto it to pop everything inside."** Done on a pop
   (`p.pops` rises), or after 25 s.
7. **"That is the game. Stay fast."** for 2 s, then the lesson ends: `lessonDone` is saved, the
   run is reset (`sim.reset()` and the rest of `restart`) with the director on.

A `SKIP` button (at least 44 px, top right under the kills counter) ends it the same way at any
time. The lesson shows when `lessonDone` is not set, unless `?nolesson`; `?lesson` forces it; it
never shows with `?flat`, `?solo`, `?horde`, `?arsenal` or `?perf`.

**The view** (`lessonView.ts`): the current line in a band across the screen just under the HUD's
gear block (never over the middle or the thumb zone), large enough to read at arm's length, with
a short tick animation when a step completes. A row of seven small dots shows progress.

## How to play (`howTo.ts`)

A sheet reached from `HOW TO PLAY` on the end card, and closed by a button on it. Seven lines, no
scrolling at 390x844:

- Drag: steer. The stick alone only reaches gear 2.
- Let go: tuck. No steering, least drag. Downhill, this is where speed comes from.
- Tap: hop. Tap again as you land to keep your speed and add a little.
- The big number is your gear. Everything you carry hits harder in a higher gear.
- Under gear 3 everything hurts and a hit costs a gear. In 3 and up you go through the small ones
  and your health comes back.
- Your trail burns what stands in it. Come back onto it to close a loop: the loop pops.
- The fat ones stop you dead below gear 5. Go round.

And a button `REPLAY THE LESSON` that clears `lessonDone` and restarts into it.

## Acceptance

1. `npm run gate` is green.
2. `tests/unit/lesson.test.ts` drives the pure lesson logic with scripted states and events: each
   step completes on its condition and not before; the alternate lines appear when they should;
   skip ends it from any step; the order is fixed; nothing allocates per tick.
3. `tests/e2e/routes/lesson.mjs` with `?hook&lesson`: the first line shows and nothing has
   spawned; drive each step through the hook (hold the stick; then release on a slope, or set a
   speed if the hook cannot reach gear 3 by riding; hop; hop on landing; and so on) and assert the
   line changes each time; `SKIP` ends it and a normal run begins with the clock at 3:00; after a
   reload the lesson does not show again; with `?hook&nolesson` it never shows. A screenshot of
   step 2 and one of the how-to sheet.
4. Open both screenshots with the Read tool and say what you see: the line is readable, is not
   over the mover or the thumb zone, and the sheet fits without scrolling.
