# M3, second pass: bots and balance for a standard survivor

Model: opus. Read `docs/PITCH.md` (rewritten), `docs/DECISIONS.md` items 42 to 48,
`docs/briefs/README.md`, `docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`, then
`docs/briefs/m2-balance.md` and `docs/briefs/m3-balance.md` for how the earlier passes went (their
rules are gone; their method stands), `tests/sim/balance.test.ts`, `tests/sim/bot/*.ts`,
`tests/sim/weapons/table.test.ts`, `src/sim/contact.ts`, `src/sim/stats.ts`, `src/sim/arsenal.ts`,
`src/sim/offer.ts`, every table in `src/sim/` you are about to tune, `docs/PLAYTEST.md`.

## Why

The game is now a standard survivor on a skateboard. Touching an enemy hurts at any speed.
Weapons fire on timers and hit the same however the player moves. Nothing heals but the Regen
passive and the heal card. The bots and bands in the repo were written for the old rules (plowing
in gear 3, speed as power) and three of the bands are switched off (`STRICT = false`). Nothing has
been balanced since the change.

## Goal

A three-minute run with a skill curve that comes from what a survivor's skill is: keeping out of
reach, choosing a build, using the map. A player who stands still dies quickly; one who wanders
dies; one who kites well with a sensible build usually wins; and no weapon is the only answer or
a wasted card.

## You own

- `tests/sim/bot/*` (rewrite the bots for these rules; delete what is dead), 
  `tests/sim/balance.test.ts`.
- Numbers, not code or structure, in: every table in `src/sim/weapons/*.ts` and
  `src/sim/seekers.ts`, `WAKE`, `BUMPER` and the passives' `byLevel` values, `OFFER`, `KINDS`,
  `DIRECTOR`, `HORDE`, the tables in `src/sim/hazards.ts` and `src/sim/things.ts`,
  `src/sim/balance.ts`, and the `combat` and `wake` groups of `FEEL`. Every number you change goes
  in your report: old, new, what it fixed. If a test elsewhere pins a number you changed, update
  that expectation and say so.
- `docs/PLAYTEST.md`: rewrite it for the game as it now is (what to try in five minutes, what to
  notice, the constants only a thumb can judge with their shipped values;
  `tests/unit/playtest.test.ts` checks the values). It still describes the old game.

Do not change movement (`run`, `carve`, `tuck`, `hop`, `air`, `ground`, `gears`, `rail` groups,
the mover) or any code. If a band cannot be met by numbers, stop and report what is missing,
with the evidence.

## Bots

A bot is `(sim, out) => void`, sees what a player sees, and answers offers through a picker.

- **idler**: never touches the screen.
- **wanderer**: holds the stick on a slow wander, blind to the horde.
- **kiter**: the careful player. Steers for open ground away from the nearest crowd, bollards,
  lob rings and tar; never stops; takes sparks when it is safe; default picker (your call; say
  what).
- **rider**: the kiter, plus the board: heads downhill when pressed, ollies over gnats and out of
  a ring of shufflers, uses pads, goes for a crate, a hoop or a slalom when it is cheap.
- **Pickers**: the default, and one per weapon ("takes this weapon whenever it is dealt, then the
  default") for the parity band.

## Bands (seeds 1 to 5, a full run each; `STRICT` and its switch are removed)

1. idler: dead by 1:00 on every seed.
2. wanderer: alive at 0:20 and dead by 2:00 on every seed.
3. kiter: alive at 1:30 on every seed; sees the clock run out on at least 2 of 5 and at most 4.
4. rider: sees the clock run out on at least 3 of 5, and does at least as well as the kiter on
   at least 3 of 5 (longer alive, or both won and more health left).
5. On the kiter's and rider's winning runs: level 8 or more, 300 or more kills, and the horde
   peaked at 120 or more alive (it was a fight).
6. After the first hit, nobody goes from full health to dead in under 6 s.
7. A player who cannot kill faces 380 or more alive by 3:00.
8. Deterministic (each bot's shortest run replayed tick by tick).
9. **Parity.** For each of the nine weapons other than the starter, the kiter with that weapon's
   picker, on seeds 1 to 3: its kills summed over the three seeds are between 0.6 and 1.6 times
   the median of the nine, and it wins at least once.
10. **Every enemy bites, none decides.** Over the kiter's and rider's ten runs, each of cutter,
    lobber (its ring), sludge and bollard accounts for at least one hit, and no kind for more
    than 60% of all hits.
11. **The map pays.** Over the rider's five runs it opens at least 5 crates and takes at least 3
    hoops or gates in total.

Print the run table (seed by bot: end, time, health, kills, level, the build it ended with as
weapon codes and levels, hits taken by enemy kind, peak horde) and a second table for band 9.

`npm test` must stay under 75 s in total: reuse runs between bands, keep the runner lean, replay
for determinism on one run per bot.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass with every band asserted, or you have
   stopped and reported which band cannot be met and why.
2. Both tables, the list of changed numbers, the commands with pass/fail and the total test time
   are in your report, with one paragraph on what the balance now is and what a thumb should
   check first.
3. Nothing outside the files and number tables named above has changed.
