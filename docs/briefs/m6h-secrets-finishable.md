# Brief M6h — secrets a player can finish, and rides that set you down

Role: implementer (`.claude/agents/implementer.md`). Run `npm install` first. Commit early and often
(at least every 20 minutes): uncommitted work can vanish without warning.

## Why

The full-game check (`docs/briefs/m6e-full-game.md`, `tests/sim/fullGame.test.ts`,
`tests/sim/bot/**`) plays the shipped game from a new save to a complete map by input alone. It
found that the regular map can be finished, and that the secret lines cannot be finished fairly:

1. **The blimp (S2) can never be completed.** Its lap starts at Cumbre with the ladder 28 m above
   the summit; the only place a skater can reach the ladder is its sweep over the hill station
   platform about 410 m into the lap, so the first segment (Cumbre → Cerro Sur) can never be
   ridden end to end.
2. **The blimp drops you 28 m.** It vanishes at the end of its lap with the rider still on the
   ladder: a bail onto the summit.
3. **The king kite (S3) needs a hidden trick.** The four-link summit chain catches it after its
   first stop, so the ride that the whole secret builds up to inks nothing. Completing S3 means
   keeping the chain alive by hopping on the 4 × 4 m needle for 2.6 s until the next lap.
4. **The needle strands you.** After the king kite's lap the only way off the needle is a 26 m
   drop: a bail.
5. **The hill station platform sheds you.** It sits 1.1 m above a plaza built to roll skaters off
   its sides; arriving from the summit lawn at 13 m/s bails on its edge or flies over it. Catching
   A1 downhill and the blimp both need you on it.
6. Smaller things: an errand offer re-fires every few seconds while you circle near its giver
   (`kite_spool` offered 5 times in a minute); a save taken just after a ride resumes you where
   you boarded, because the resume spot is refreshed only every 0.5 s on the ground and never
   after a ride; a save keeps only the time of day, so the day count restarts on load.

## What to do

1. **Blimp:** every segment of S2 can be inked by a skater who catches the ladder at the hill
   station platform, and the ride sets them down. Reorder or re-place its stops so the lap (or the
   inkable part of it) starts where the ladder is in reach of a hop from the platform, and bring
   the ladder back within reach of ground a skater can stand on (the hill station, or the summit
   lawn) before the blimp goes out of service, with a stop there so the timetable shows it.
   Keep it a secret that takes knowing: one pass at dusk is fine.
2. **King kite:** the ride the summit chain earns inks S3 in one go. Move its stops (not the
   chain's geometry or timing, which were hard to make work: `tests/sim/citySummit.test.ts`)
   so the catch point comes before the first stop's segment starts, within the ink rule in
   `src/sim/game/progress.ts`.
3. **A way down from the needle that is a reward, not a bail:** a guy wire from the needle's top
   to the summit lawn, as a grindable rail (`addRail`, drawn like the other wires), steep enough
   to be a thrill and shallow enough to land. A skater who rolls off the needle's edge toward it
   and hops lands the grind (the rail magnet is generous: `RAIL_SNAP*` in `FEEL`).
4. **Hill station platform:** a skater coming down from the summit by the lawn or the stairs at
   any speed up to 14 m/s can end up standing on it: lower the lip, widen it, add a run-in or a
   parapet on the downhill side (your choice; say which). The plaza around it may still shed.
5. **Errand offers** do not re-fire for a giver within 45 s of the last offer from that giver
   being ignored or declined.
6. **Resume spot:** refreshed on the first grounded tick after a ride ends (and after a grind or
   a landing), not only on the half-second clock. **Day count** saved and restored (save version
   bump with migration; old saves load with day 0).
7. **Errand givers stand clear of stops.** Since holding a still finger now stops you to wait for
   a ride (DECISIONS 77), a player waiting at a stop inside a giver's spot takes the errand instead
   (the moped stop on the boulevard, `stop_M1_0`, is one). Move givers so no giver's offer zone
   overlaps the waiting area of any stop (the stop zone plus 4 m), with a test over every giver
   and stop, and let the full-game bot stand still at every stop (it circles at those today).
8. Update the full-game test: S2 completes; every line is complete at the end; no bail in the
   whole run except ones the bot chooses (there should be none: it takes the wire down). Keep
   every other assertion as strict as it is.

## Files you own

`src/sim/city/**` (lines, routes, zones, layout for the platform and the wire),
`src/render/dress/**` only as far as drawing the wire and any new platform parts,
`src/sim/game/errands.ts`, `src/sim/game/save.ts`, `src/app/save.ts`, the safe-spot code where it
lives, `tests/sim/**` (city, lines, summit, errands, save, full game, bot), `docs/DESIGN.md` (the
roster rows for S2 and S3 and the secrets section), `docs/DECISIONS.md` (append), `docs/PLAYTEST.md`
(the summit and blimp entries). Not yours: `src/sim/player.ts`, `src/sim/hitch.ts`,
`src/sim/lines.ts`, `src/sim/game/onboarding.ts`, `src/ui/**`, `tests/perf/**`,
`src/render/cityView.ts`.

## Acceptance

1. `tests/sim/fullGame.test.ts` passes with S2 and S3 complete and no bails, in under 90 simulated
   minutes for the regular map, and still under 90 s of test time.
2. New sim tests: the blimp is catchable from the platform by a hop and inks every S2 segment in
   one ride and sets the rider down standing; the summit chain's king-kite ride inks every S3
   segment; from the needle's top, a hop toward the wire grinds to the lawn without a bail; a
   skater from the summit reaches a standing stop on the hill station platform from the lawn at
   6, 10 and 14 m/s and from the stairs; an ignored errand offer does not return for 45 s; a save
   taken on the first tick after a ride resumes at the alighting place; the day count survives a
   save.
3. Every existing city, lines, summit, climb, errand and conductor test still passes unchanged
   (they assert geometry the chain depends on). If one must change, say exactly why.
4. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and
   `npm run e2e -- city-spine city-errand proptown lineup` green; open the screenshots that show
   the summit and say what the wire and the platform look like.

## Return

What you changed for each numbered item, the new S2 and S3 stop lists with times of day, the
full-game run's line order and total time, anything you could not make work and why. Commands run
with pass/fail. Changed files. No file contents. Commit on your current branch; do not push or
merge.
