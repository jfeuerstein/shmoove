# Brief M7g — the old city's last three red tests

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often.

## Why

After the controller rework and the denser timetable (DECISIONS 113–127), `npm test` has three
failures, all in the old city (`?world=city`). Task M7a handed them back with its findings. Fix
the city or its ride data so each passes as written, except where this brief changes the rule on
purpose.

## The three

1. **`cityLines.test.ts` › never lets two vehicles overlap.** Cars of one line no longer overlap.
   Cars of different lines still do: standing inside each other at shared stops, running inside
   each other along shared streets, and passing through each other at grade crossings (T2/T3 on
   the terraces and at Terrazas, T1 with T2 at the Antenna gate and with T3, M2/T2 on the ramps,
   D3/T2 at the depot). The rule, from now on, in three parts, each asserted over the whole day:
   - two vehicles never overlap while either is standing at a stop: give lines that share a
     place their own berths (move one line's stop along the street by at least a vehicle and a
     half, or put it on its own lane);
   - two vehicles never overlap while travelling the same way along a shared street: separate
     lanes (`lane`) or separate streets;
   - two vehicles crossing each other's paths may pass through each other for at most 1.5 s
     (a grade crossing with no signals); count these per day and report the number.
   Change the test to assert exactly those three parts (it is stricter than nothing and honest
   about crossings), and fix the data until it passes. You may change `phase`, `dwell`, `lane`,
   stop positions and `vehicles` of the ground lines D1–D3, M1–M3, T1–T4 in
   `src/sim/city/lines.ts` and their routes in `routes.ts`; headway at every stop stays 30 s or
   less in service hours (45 s for M3 and T4); do not touch A1–A3 or S1–S3.
2. **`cityLines.test.ts` › a skater hitches D2, slings, and catches T2.** The two lines still
   meet but no tram passes a forklift the same way, so the chain search finds nothing. The
   behaviour asserted is a two-link chain from D2 to T2 at their meeting. The strap now throws
   14 m (DECISIONS 119): extend the search (`tests/sim/bot/findChain.ts`) to catches of a tram
   going the other way or crossing, and if there is still none, move the meeting
   (`MEETINGS` in `lines.ts`) to where the two lines run side by side. The assertion stays.
3. **`city.test.ts` › the same for 800 more drops.** The lead fixed the stalled-board flip (a
   regression test is in `movement.test.ts`). What remains, from M7a's report: the garden-wall
   ledge rails sit about 1 m inside the carved wall blocks along every garden line (rail 121 at
   z 862.5 inside wall 335 is one); a skater can end exactly on a wall face just under its top
   (wall 387 at (113, 918)); two runs have two bails where the rule allows one. Fix the city
   (`src/sim/city/**`): rails on the wall tops where a skater can reach and leave them, no ledge
   a skater can come to rest on that they cannot roll off; then run both drop tests at their
   thresholds. If a pin turns out to be the controller (`src/sim/player.ts`, the lead's), stop
   and report the place, the heading and what happens tick by tick.

Then re-run the re-find commands in `docs/briefs/README.md` for anything your data change moved
(meetings, the first-launch clock and route, conductor limits, perfcity legs, the full-game plan),
and `npm run gate`. The machine is shared with two other agents: if only the perf stage fails on
timing, re-run `npm run perf` alone, report the load average and the per-part medians from
`artifacts/perf.json`, and say whether draw calls and triangles pass.

## Files you own

`src/sim/city/**`, `tests/sim/**`, `tests/e2e/routes/city-*.mjs`, `src/app/newGame.ts`,
`src/app/routes.ts`, `src/sim/game/content/**`, `docs/DESIGN.md` (ride table), `docs/DECISIONS.md`
(append after the last numbered item, before "Cut"). Not yours: `src/sim/player.ts`,
`src/sim/hitch.ts`, `src/sim/lines.ts`, values in `src/sim/constants.ts`, `src/render/**`,
`src/ui/**`, `src/sim/barrio/**`, `src/sim/game/finds.ts` (two other agents are working there).

## Return

What you changed for each of the three (with coordinates and line ids), the crossing count per
day, every re-find you re-ran, the gate table. Commands run with pass/fail. Changed files. No file
contents. Commit on your current branch; do not push or merge.
