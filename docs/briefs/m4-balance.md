# M4: bots and balance for the ten-minute run

Model: opus. Read `docs/PITCH.md`, `docs/DECISIONS.md` items 42 to 57, `docs/briefs/README.md`,
`docs/briefs/m2-common.md`, `docs/briefs/m3-common.md`, `docs/briefs/m4-run.md` (the run you are
balancing), then `docs/briefs/m2-balance.md` for how an earlier pass went (its rules are gone; its
method stands: when numbers could not meet a band it stopped and said which mechanic was
missing). Then `tests/sim/run.test.ts`, `tests/sim/bot/*.ts`, `tests/sim/weapons/table.test.ts`,
`src/sim/contact.ts`, `src/sim/stats.ts`, `src/sim/arsenal.ts`, `src/sim/offer.ts`,
`src/sim/bosses.ts`, `src/sim/director.ts`, every table in `src/sim/` you are about to tune,
`docs/PLAYTEST.md`, `scripts/gate.mjs`, `package.json`.

## Why

The game is a standard survivor on a skateboard and a run is now ten minutes with three bosses.
Nothing has been balanced since either change. The weapons were last measured with the Lance
doing a tenth of the leaders' damage and the Slam and Skipper the most. The owner is about to
play it properly for the first time; it has to be fair before they do.

## Goal

A ten-minute run with a skill curve that comes from what a survivor's skill is: keeping out of
reach, choosing a build, using the map and the board. Someone who stands still dies in the first
minute; someone who wanders dies in the first act; a careful player with a sensible build
usually reaches the final boss and beats it about half the time; no weapon is the only answer or
a wasted card; each boss is a fight and none is a wall.

## You own

- `tests/sim/bot/*`: rewrite the bots for these rules; delete what is dead.
- A new `tests/balance/` and `npm run balance` (add the script to `package.json`; it is not part
  of `npm test` or the gate): the full harness below, printing its tables and exiting non-zero
  if a band fails. `tests/sim/balance.test.ts`: a light version that stays in `npm test`.
- Numbers, not code or structure, in: every table in `src/sim/weapons/*.ts` and
  `src/sim/seekers.ts`, `WAKE`, `BUMPER` and the passives' `byLevel` values, `OFFER`, `KINDS`
  (bosses included), `DIRECTOR`, `HORDE`, the tables in `src/sim/hazards.ts`, `bosses.ts` and
  `things.ts`, `src/sim/balance.ts`, and the `combat` and `wake` groups of `FEEL`. Every number
  you change goes in your report: old, new, what it fixed. If a test elsewhere pins a number you
  changed, update that expectation and say so.
- `docs/PLAYTEST.md`: rewrite it for the game as it now is: what to do in a first run and what
  to notice, a short list of things the owner should report back, and the constants only a thumb
  can judge with their shipped values (`tests/unit/playtest.test.ts` checks the values). It still
  describes a game that no longer exists.

Do not change movement (`run`, `carve`, `tuck`, `hop`, `air`, `ground`, `gears`, `rail` groups,
the mover) or any code. If a band cannot be met by numbers, stop and report what is missing,
with the evidence.

## Bots

A bot is `(sim, out) => void`, sees what a player sees, and answers offers through a picker.

- **idler**: never touches the screen.
- **wanderer**: holds the stick on a slow wander, blind to everything.
- **kiter**: the careful player. Steers for open ground away from the nearest crowd, bollards,
  lob rings and tar; never stops; takes sparks when safe; knows each boss's one trick (turns out
  of the Bruiser's charge line during its tell, leaves the Mortar's line of rings, ollies the
  Standstill's ring and stays out of its slow). Default picker (your call; say what).
- **rider**: the kiter, plus the board: heads downhill when pressed, ollies over gnats and out of
  a ring of shufflers, uses pads and rails as a way out, goes for a crate, a hoop or a slalom
  when it is cheap.
- **Pickers**: the default, and one per weapon ("takes this weapon whenever it is dealt, then the
  default") for the parity band.

## Bands

**The full harness** (`npm run balance`; seeds 1 to 5; a run is up to 12 minutes of game time):

1. idler: dead by 1:00 on every seed.
2. wanderer: alive at 0:20 and dead by 3:00 on every seed.
3. kiter: alive at 3:00 on every seed; fells the Bruiser on at least 4 of 5; reaches the
   Standstill (alive at 9:00) on at least 3 of 5; clears the run on at least 1 and at most 4.
4. rider: clears the run on at least 2 of 5, and does at least as well as the kiter on at least
   3 of 5 (further, or both cleared and more health left).
5. On every cleared run: level 20 or more, and the horde peaked at 250 or more alive.
6. After the first hit, nobody goes from full health to dead in under 6 s.
7. A player who cannot kill faces 380 or more alive by 9:00.
8. **Bosses are fights, not walls.** Over the kiter's and rider's runs that meet each boss: the
   Bruiser takes 20 to 60 s to fell, the Mortar 25 to 75 s, the Standstill 40 to 120 s; each
   boss lands at least one hit across the ten runs; no boss accounts for more than half of the
   deaths.
9. **Parity.** For each of the nine weapons other than the starter, the kiter with that weapon's
   picker, on seeds 1 to 3: its kills by 6:00 summed over the three seeds are between 0.6 and 1.6
   times the median of the nine, and it is alive at 6:00 on at least one seed.
10. **Every enemy bites, none decides.** Over the kiter's and rider's ten runs, each of cutter,
    lobber (its ring), sludge and bollard accounts for at least one hit, and no one kind for more
    than half of all hits.
11. **The map pays.** Over the rider's five runs it opens at least 10 crates, takes at least 5
    hoops or gates and grinds at least 5 rails in total.
12. Deterministic: each bot's shortest run replayed tick by tick.

It prints a run table (seed by bot: how it ended, time, health, kills, level, the build it ended
with, bosses felled and how long each took, hits by enemy kind, peak horde) and a parity table.

**The light version** (`tests/sim/balance.test.ts`, in `npm test`, under 40 s): seed 1 only.
Bands 1 and 2; the kiter is alive at 3:00 and fells the Bruiser; determinism on the idler's
run; and one assertion that the full harness's last recorded results file (`tests/balance/
last.json`, written by `npm run balance` and committed) is no older than the newest change to
any tuned table: compare a hash of the tables' source text stored in that file against the
current one, so a number cannot be changed without the full harness being run again.

`npm test` as a whole must stay under 90 s.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` pass; `npm run balance` exits zero with every
   band met, or you have stopped and reported which band cannot be met and why.
2. Both tables, the list of changed numbers, the commands with pass/fail, the time `npm test`
   and `npm run balance` each take are in your report, with one paragraph on what the balance
   now is and the three things a thumb should check first.
3. Nothing outside the files and number tables named above has changed.
