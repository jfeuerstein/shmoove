# Verification before the first full playtest

Model: opus (verifier). You fix nothing; you report.

## Why

The owner is about to play a whole run on a phone for the first time. Everything since M2 was
merged on its own task's word and the gate: the pivot to a standard survivor (DECISIONS 42), the
weapons on timers, rails, the lesson, the ten-minute run and its three bosses, sound, and hit
feedback. Nobody with fresh eyes has checked them together. Find what would spoil that playtest
before the owner does.

Balance is being tuned by another task at the same time. Do not judge numbers (how strong, how
many, how long); do judge rules, bugs, and whether a thing can be seen and understood.

## Read

`CLAUDE.md`, `docs/PITCH.md`, `docs/DECISIONS.md` items 42 to 63, then these briefs, each of which
is a contract you check: `m3-lesson.md`, `m3b-weapons-timers.md`, `m3b-rails.md`, `m4-run.md`,
`m5-audio.md`, `m5-juice.md`. The lead's own code since M2 has no brief: `src/sim/contact.ts`,
the rails in `src/sim/mover.ts`, `src/sim/world.ts`, `src/sim/stats.ts`, `src/sim/build.ts`.

## Check

1. **Each brief's acceptance criteria**, as your agent definition says. One line each.
2. **The three rules.** How fast the rider is moving never changes damage dealt, damage taken or
   healing; weapons fire on timers; touching an enemy hurts. Read every place damage, healing or
   a weapon's timer is computed and say whether speed, gear, tuck, air or landing can reach it.
   Board passives (Wax, Springs, Wings) may change movement only.
3. **A first run, as the owner will have it.** Build the app (`npm run build`), serve `dist/`, and
   drive it in Playwright at 390x844 with touch (`tests/e2e/run.mjs` shows how; `?hook` gives
   `window.__shmoove`, see `src/app/testHook.ts`). With no saved settings: the lesson appears, can
   be finished with real touch gestures, and does not come back; a run starts; a level opens three
   cards and a tap takes one; the how-to and the sound switch work; dying shows the end card and
   AGAIN starts a clean run (no enemies, zones, boss, offer or timers left over from the last);
   each boss arrives at its time (`setClock`), shows its bar, can be felled (`killBoss`), and the
   Standstill's fall ends the run as won; putting the page in the background and bringing it back
   neither kills the rider nor runs the clock on. Take screenshots at each point, look at them
   with the Read tool, and describe what a player would see. Say what is unreadable, overlapping,
   off the screen, or behind the notch or home bar.
4. **What is drawn.** For every enemy kind, weapon, zone, map thing, boss attack and tell: is
   there something on screen when the sim says it is there? (`?arsenal`, `?horde=N`, the hook.)
   A danger the player cannot see is a severity-1 bug. Known already: a boss's arrival and fall
   have no effect drawn, and a boss's death burst uses the shuffler's colour; do not re-report
   these, but do say whether each boss's tell and attack can be seen in time to dodge.
5. **Determinism and state.** Two sims with the same seed and inputs hash the same through a boss
   fight and a level-up; `Sim.reset` leaves nothing behind (compare a reset sim's hash with a new
   one's); `hashWorld`/`hashSimState` cover the boss and every array the run added.
6. **Edge cases worth five minutes each.** A level-up on the tick a boss arrives; a card offer
   open when the rider dies or the run is won; grinding a rail when hit, when a clinger latches,
   when an offer opens; two bosses due at once (`setClock` past both); the Bruiser's charge
   reaching the rim; health above the maximum after a boss's heal; the clock after the win.
7. **Quality bar** over everything since tag-point `m2` (`git log` to find the M2 merge): TODOs,
   stubs, skipped or weakened tests, dead code that fakes a feature, per-tick allocation in
   `src/sim/` and per-frame allocation in `src/render/`, sim purity.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`. Report counts and times. Skip
   `npm run perf`: other tasks are loading the machine.

## Return

PASS or FAIL overall on "ready for the owner to play a whole run", then one line per numbered
check above (per criterion for check 1), then the issues in order of how much each would spoil
the playtest, each with file:line, how to reproduce it, and how sure you are. Keep trivia in a
separate short list. Scratch scripts and screenshots stay out of the repo (use your scratch
directory); commit nothing.
