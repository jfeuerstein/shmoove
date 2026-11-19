# M2: bots that fight, and the three-minute balance

Model: opus. Read `docs/briefs/m2-common.md` first, then `docs/PITCH.md` sections 2, 4, 6 and 8,
`docs/PLAN.md` (M2), `tests/sim/bot/*.ts`, `tests/sim/bowl-bots.test.ts`.

## Goal

The three-minute slice is fair and has a skill curve: a player who does nothing dies fast, a
player who only holds the stick lasts a while and dies, and a player who plays lines, keeps their
speed and closes loops usually sees the clock run out. Bots stand in for those players, and the
numbers are tuned until the bots land in the bands below. The owner's thumb will judge whether it
is fun; this makes sure it is not broken before they try.

## You own

- `tests/sim/bot/fighters.ts` (new bots), `tests/sim/bot/playRun.ts` (a runner for horde runs),
  `tests/sim/balance.test.ts`
- The numbers (not the structure or the code) in: `src/sim/balance.ts`, `KINDS` in
  `src/sim/world.ts`, `DIRECTOR` in `src/sim/director.ts`, `HORDE` in `src/sim/horde.ts`, `SEEKERS`
  in `src/sim/seekers.ts`, and the `combat` and `wake` groups of `FEEL` in `src/sim/constants.ts`.
  Every number you change goes in your report with the old value, the new value and what it fixed.
  If a test elsewhere pins a number you changed, update that expectation and say so.
- `docs/PLAYTEST.md`: add a short section for the horde slice (what to do, what to notice) and the
  `combat` and `wake` constants in the same table form as the others. `tests/unit/playtest.test.ts`
  checks the values you quote against the game.

Do not change the movement constants (`run`, `carve`, `tuck`, `hop`, `air`, `ground`, `gears`
groups), the mover, contact, wake, horde or director code. If the bands cannot be met by numbers
alone, stop tuning and report what mechanic is missing or wrong, with the evidence.

## Where it stands

The existing bots (`tucker`, `carver`, `liner`, `masher`) ignore the horde entirely. Run as they
are on seeds 1 to 3 with `new Sim(bowl, { seed, horde: true })`:

| Bot | Dies at | Kills | Level | Hits taken |
| --- | --- | --- | --- | --- |
| tucker | 34 to 36 s | 43 to 75 | 2 to 4 | 13 |
| carver | 26 to 32 s | 39 to 68 | 1 to 3 | 13 |
| liner | 76 to 109 s | 335 to 813 | 8 to 15 | 14 to 15 |
| masher | 38 to 59 s | 73 to 193 | 2 to 6 | 13 |

Nobody closes a loop, nobody survives, and once anybody is hit they are hit every 0.6 s until
dead. Some of that is blind bots; some may be numbers.

## Bots to write

A bot is `(sim, out) => void` as before; it may read `sim.world` (it sees what the player sees).

- **evader**: holds the stick, never tucks or hops. Steers away from the nearest crowd and from
  bollards, toward open ground, staying off the rim. What a careful beginner does.
- **looper**: evader's survival sense, plus it circles: when a cluster is near, it rides a circle
  round it tight enough to fit in the trail (`wakeLength`) and closes the loop. What a player who
  has understood the Wake does.
- **rider**: plays lines like `liner` (tucks downhill, clean hops, uses pads and pipes) but sees
  the horde: avoids bollards below gear 5, does not ride into a crowd below gear 3, runs for a
  downhill when slow and pressed, and closes a loop when the chance is cheap. The good player.

## Bands (seeds 1 to 5, a full run each)

1. `tucker`: dead by 0:45 on every seed.
2. `carver` (blind): dead by 1:30 on every seed, and alive at 0:20 on every seed.
3. `evader`: alive at 0:45 on every seed; dead before the end on at least 3 of 5.
4. `looper`: at least 3 pops on every seed and a best loop of at least 6 on at least 3 of 5;
   outlives `evader` on at least 4 of 5.
5. `rider`: sees the clock run out on at least 3 of 5; on those runs ends with between 10 and 80
   health (it was a fight); reaches level 8 or more; at least 300 kills.
6. After the first hit, nobody goes from full health to dead in under 8 s on any seed (the spiral
   has a way out).
7. The horde is at 300 or more alive at some point in any run that reaches 2:30.
8. Every run is deterministic (`hashWorld` + `hashSimState` per tick, twice).
9. Print one table (seed by bot: end, seconds, health, kills, level, weapon levels, pops, best
   loop, share of time in gear 3+, hits taken, peak horde) with `console.log`; no assertion on it.

`npm test` must stay under 60 s in total; a full run of five bots on five seeds is 25 runs of up
to 10 800 ticks, so keep the runner lean and consider asserting several bands from one set of runs.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass, with every band asserted.
2. The table and the list of changed numbers are in your report, with one paragraph on what the
   balance now is and what you would want a thumb to check first.
3. Nothing outside the files and number tables named above has changed.
