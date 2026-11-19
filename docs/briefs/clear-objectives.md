# Clear objectives: one-touch rules, readable states, labels

Model: opus. Read `CLAUDE.md`, `docs/briefs/README.md` (common rules), `docs/briefs/art-common.md`
(the style and material rules still hold), `docs/PITCH.md` section 7, then `src/sim/things.ts`,
`src/sim/bowl.ts` (sites, kickers), `src/render/thingsView.ts`, `src/render/look.ts` (the colour
language at the top), `src/ui/threat.ts` (how a world point is put on the screen), `src/ui/howTo.ts`,
`src/app/runLog.ts` (the `map` counters), `tests/sim/things.test.ts`, `tests/sim/bot/fight.ts`,
`tests/e2e/routes/park.mjs`.

## Why

The owner played a whole run and said: "some objectives feel very janky or clunky, like the
shrines you have to stay in range of", and asked for the game to be easier to understand by eye.
A shrine wants three laps inside ten seconds within a band of distance: on a skateboard that is
fiddly, and nothing on screen says what it wants. The map's objectives should each be one clear
thing to do, forgiving to hit, and say what they are.

The lead has already raised the ollie (`FEEL.hopSpeed` 8.5, about half as high again) and made
every point of interest gold in every look (`PALETTE.things[1..5]` are one colour; the plain
crate is wood).

## The rules, as they should now be

- **Crate, gold crate:** ride into it. Unchanged.
- **Shrine:** ride into its ring and it opens its three boons at once. No laps, no timer, no
  band to stay in. The ring drawn on the ground is exactly the reach (about 4 m; your number).
  Then it is spent.
- **Slalom:** five gates, taken in order, the next one lit. Riding between the lit gate's posts
  counts; anything else does nothing. **No clock and no miss:** progress is kept until all five
  are taken, then it pays as now. Posts a little wider apart than today.
- **Hoop:** the ring in the air over a kicker. Make it forgiving: a wider catch (and a ring
  drawn to match the catch), so a rider who goes straight up the kicker at run speed or faster,
  up to a metre off its middle line, takes it without an ollie, and one who ollies off the lip
  takes it too. Prove that with a test over every hoop on seeds 1 to 3; if a hoop's kicker
  cannot deliver that, move the ring to where the flight goes (the ring's place is yours to
  compute from the kicker; the bowl's sites are not yours to move).
- **Totem:** ride into it to call an elite pack; a rare card when its elite falls. Unchanged,
  but nothing told the player that: see labels.

Take out what the old rules leave dead (`shrineInner/Outer/Laps/Ticks`, the yaw states, the miss
state and its timers, and the crate's `crateGear` / `goldGear` / `rattleTicks` if nothing reads
them any more). No dead numbers left in `THINGS`.

## What the player sees

- **States that read:** a shrine's ring is bright and inviting while fresh; a slalom shows
  which gate is next and how many are done; a hoop's ring is the size of its catch; spent
  things look spent, as now.
- **Labels** (new `src/ui/thingLabels.ts` + css, DOM, pooled, no per-frame allocation, styles
  written only on change): a small tag over a live point of interest when the rider is near
  enough to act on it (about 35 m) and it is in frame: its name and, in a few words, what to
  do. `CRATE`, `GOLD CRATE`, `SHRINE · ride in`, `GATES 2/5`, `HOOP · jump through`,
  `TOTEM · calls elites`. At most three at once, the nearest first; never over the rider, the
  top HUD or the build bar; hidden under cards, the pause sheet and the end card. Which labels
  show and what they say is a pure function with tests.
- **Fewer beacons:** plain crates get none (there are many and they are found by riding);
  every other live point of interest keeps one, and it fades out as the rider gets close
  (the label takes over).
- **How to play** (`src/ui/howTo.ts`): the lines about the map say the new rules in the same
  few words as the labels.

## You own

`src/sim/things.ts` (rules and the `THINGS` numbers), `src/render/thingsView.ts`, new
`src/ui/thingLabels.ts` and its css, the map lines in `src/ui/howTo.ts`, the `map` counters in
`src/app/runLog.ts` if a state's meaning changes (and their tests), `tests/sim/things.test.ts`,
`tests/unit/thingsView.test.ts`, new unit tests, `tests/sim/bot/fight.ts` only where the rider
bot goes for a shrine, a slalom or a hoop (keep it using them under the new rules),
`tests/e2e/routes/park.mjs` and `rails.mjs` if they break, `docs/PITCH.md` section 7's table, and
in `src/app/main.ts` only the construction and update of the labels. Nothing else in `src/sim/`
(the mover, the bowl, the hook are not yours); not `fxView.ts`, `weaponsView.ts`, `zonesView.ts`,
`parkView.ts`, `threat.ts` or `numbers.ts` (another task is calming those now); not `look.ts`.

`THINGS` is one of the tables the balance harness hashes: after you change it the light test in
`tests/sim/balance.test.ts` will say the harness must be rerun. That one failure is expected and
is the lead's to clear (`npm run balance` after merging); do not run the harness and do not
touch `tests/balance/`.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test` (but for the one expected failure above),
   `npm run build`, `npm run e2e` pass. Not the gate, not perf beyond draw calls and triangles
   once at the end.
2. Sim tests that say the rules as a player would: riding into a shrine's ring opens boons
   that tick and never before; a slalom keeps its progress however long the rider takes and
   whatever it misses; each hoop on seeds 1 to 3 is taken by the straight run described above;
   determinism still holds (`tests/sim/reset.test.ts`, `tests/sim/run.test.ts`).
3. Label tests: which show, their words, the cap of three, hidden when out of frame or far.
4. `park.mjs`: screenshots of each point of interest with its label, a slalom part done
   (`GATES 2/5`), a shrine being ridden into and its cards, a hoop taken off its kicker. Look at
   each with the Read tool. Could someone who has never played say what each thing wants?
5. Rules of the game: how fast the rider moves never changes damage dealt, damage taken or
   healing.

## Return

Summary, decisions, the old and new `THINGS` numbers, anything still clunky and why, what you saw
in each screenshot, commands with pass/fail, changed files, branch and last commit.
