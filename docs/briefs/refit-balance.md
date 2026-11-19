# Refit the bots and the numbers to the higher ollie and the new objectives

Model: opus. Read `docs/briefs/m4-balance.md` (the bands and the rules of that task: they all
still hold), `docs/DECISIONS.md` items 71 to 74, `tests/balance/harness.ts`, `tests/balance/last.json`
(the failing run), `tests/sim/bot/fight.ts`, `tests/sim/bot/picks.ts`, `src/sim/things.ts`,
`src/sim/constants.ts` (the `hop` and `rail` groups).

## Why

After the owner's playtest the ollie was raised (`hopSpeed` 7 to 8.5: about half as high again,
a fifth longer in the air), the top speed tier lowered a little, and the map's objectives made
simpler (a shrine opens when ridden into; a slalom has no clock and no miss; a hoop stands on
its kicker's top with a wide catch and counts riding or flying). `npm run balance` now fails four
of its twelve bands:

- 3: the kiter clears 5 of 5 (at most 4).
- 4: the rider clears 3 of 5 and does at least as well as the kiter on only 2 of 5.
- 10: bollards land no hit.
- 11: the rider grinds 4 rails (5 or more).

The bands sat on knife edges before; the bots were also written for the old ollie and the old
objectives. Two of the four are about the rider bot, which ollies and grinds.

## Goal

`npm run balance` exits zero again, by the smallest change that is honest:

1. First the **rider bot**: it should ride as a good player would with the ollie as it now is
   (when it hops over gnats and rings, how it lines up and hops onto a rail, how it uses the
   new one-touch shrine and the no-clock slalom, the hoop on the kicker). Find out why it now
   dies on two seeds and grinds less, and fix the bot where the bot is what is wrong.
2. Then **numbers**, only in the tables `m4-balance.md` lists, and as few as will do. Every
   number changed goes in your report: old, new, what it fixed.

Do not change movement (the `run`, `carve`, `tuck`, `hop`, `air`, `ground`, `gears`, `rail`
groups, the mover), the objectives' rules, or any code outside the bots and the harness. Do not
loosen a band or its reading. If a band cannot be met without that, stop and report which, with
the evidence, and what would have to change.

Keep it short: this is a refit, not a rebalance. Plan on a handful of full harness passes
(each is about five minutes), using single-seed or single-bot probes in between.

## You own

`tests/sim/bot/*`, `tests/balance/*` (but not the bands' thresholds), `tests/sim/balance.test.ts`,
the numbers in the tuned tables, any test elsewhere that pins a number you change (update the
expectation and say so), and the bot paragraphs of `docs/PLAYTEST.md` if what they say changes.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; `npm run balance` exits zero and
   `tests/balance/last.json` is committed from that run. Or you have stopped and reported.
2. Your report has the final band lines, the numbers changed, what was wrong with the rider
   bot, the commands with pass/fail, and how many full passes it took.
