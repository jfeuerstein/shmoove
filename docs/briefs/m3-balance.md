# M3: bots that build, and the balance of the whole arsenal

Model: opus. Read `docs/briefs/m3-common.md` first, then `docs/briefs/m2-balance.md` (the bots,
the bands and how round two went), `docs/DECISIONS.md` items 22 to 34, `tests/sim/balance.test.ts`,
`tests/sim/bot/*.ts`, `tests/sim/weapons/table.test.ts`, `docs/PLAYTEST.md`.

## Goal

With ten weapons, eleven passives, seven enemies, elites and the map's objects in, the three
minutes still have a skill curve, and no weapon is the only right answer or a wasted card. The
bands that were switched off while M3's content landed are back on.

## Where it stands

- `STRICT` in `tests/sim/balance.test.ts` is `false`: bands 4a, 4b and 5 print but are not
  asserted.
- After the four new enemies arrived (before the seven weapons and the map objects), every bot
  that had been lasting 2:13 to 3:00 died at 1:18 to 1:43; the deaths cluster on 10-damage hits
  from 60 s, when cutters arrive. Nobody won.
- The weapons agent's table (each weapon alone at level 3 on the same ride): the Slam does about
  2.2 times the Wake's damage because a plain hop triggers it at a 5.6 m radius; Orbit and Crumbs
  are strong; Static, Skipper and the Lance do about half the Wake.

## You own

- `tests/sim/bot/*` (bots, pickers, the runner), `tests/sim/balance.test.ts`.
- Numbers, not code or structure, in: every table in `src/sim/weapons/*.ts`, `WAKE`, `SEEKERS`,
  `BUMPER` and the passives' `byLevel` values, `OFFER` (card weights and rarity), `KINDS`,
  `DIRECTOR`, `HORDE`, the tables in `src/sim/hazards.ts` and `src/sim/things.ts`,
  `src/sim/balance.ts`, and the `combat` and `wake` groups of `FEEL`. Every number you change goes
  in your report: old, new, what it fixed. If a test elsewhere pins a number you changed, update
  that expectation and say so.
- `docs/PLAYTEST.md`: a section for the build (what to try, what to notice) and any quoted value
  you changed.

Do not change movement (`run`, `carve`, `tuck`, `hop`, `air`, `ground`, `gears` groups, the
mover) or any code. If a band cannot be met by numbers, stop and report what mechanic is missing,
with the evidence, as you did in M2.

## Bots

Keep the five. Add what the build needs:

- **Pickers**: one per weapon ("takes this weapon whenever it is dealt, otherwise weapons first"),
  used by the parity band below; the looper keeps the Wake-first picker; the rider gets a sensible
  default (your call; say what).
- The **rider** uses the map: it goes for a crate, a hoop or a slalom when it is close to its line
  and cheap, and rams a totem only above half health.
- The bots see what a player sees: lob rings (leave them), tar (go round), bollards and elites.

## Bands (seeds 1 to 5, a full run each, `STRICT = true`)

1. tucker dead by 1:00 on every seed.
2. carver alive at 0:20 and dead by 1:30 on every seed.
3. evader alive at 0:45 on every seed; dead before the end on at least 3 of 5.
4. looper: a pop on every seed, 10 or more across the five, a best loop of 6+ on at least 3 of 5,
   and it outlives the evader on at least 3 of 5.
5. rider: sees the clock run out on at least 3 of 5, at level 8+ with 300+ kills each time, at
   least twice with 10% to 80% of its health, and at most twice with more than 80%.
6. After the first hit, nobody goes from full health to dead in under 8 s.
7. A player who cannot kill faces 380+ alive by 3:00; the rider's winning runs peak at 120+.
8. Deterministic (each bot's shortest run replayed tick by tick).
9. **Parity.** For each of the nine weapons other than the Wake, the rider with that weapon's
   picker, on seeds 1 to 3: its kills summed over the three seeds are between 0.6 and 1.6 times
   the median of the nine, and it wins at least once. No weapon is a wasted card; none is the
   only answer.
10. **The new enemies bite but do not decide.** Over the rider's five runs, hits taken from each
    of cutter, lobber (its ring), sludge (by contact) are each at least 1 in total, and no one
    kind accounts for more than 60% of all hits.
11. **The map pays.** Over the rider's five runs it opens at least 5 crates and takes at least 3
    hoops or gates in total; and with the things switched off (an empty `w.things`) it wins no
    more often than with them.

Print the table as before (add the build each bot ended with: weapon codes and levels) and a
second table for band 9 (weapon, kills per seed, wins).

`npm test` must stay under 75 s in total. Band 9 is 27 more full runs: keep the runner lean,
reuse runs between bands, and replay for determinism on one run per bot.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass with `STRICT = true` and every band
   asserted, or you have stopped and reported which band cannot be met and why.
2. Both tables, the list of changed numbers, the commands with pass/fail and the total test time
   are in your report, with one paragraph on what the balance now is and what a thumb should
   check first.
3. Nothing outside the files and number tables named above has changed.
