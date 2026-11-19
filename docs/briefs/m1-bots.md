# M1: bots, bowl behaviour tests and the playtest list

Model: opus. Read `docs/briefs/README.md` for the common rules, and `docs/PLAN.md` (M1).

## Goal

Everything about the feel slice that a machine can check is checked by bots playing the real bowl,
so the owner's time on the phone goes only to what a thumb must judge, and that list is written
down.

## You own

`tests/sim/bot/*.ts`, `tests/sim/bowl-bots.test.ts`, `tests/e2e/routes/touch.mjs`,
`docs/PLAYTEST.md`.

## Interfaces

`Sim` (`src/sim/sim.ts`), `InputFrame`, `EV_*` (`src/sim/types.ts`), `makeBowl`, `Bowl`,
`BowlFeatures` (`src/sim/bowl.ts`), `FEEL` / `FEEL_DEFS` (`src/sim/constants.ts`),
`tests/sim/fixtures.ts`. A bot is `(sim: Sim, out: InputFrame) => void`, called once per tick before
`sim.step(out)`; it may read anything in `sim.state` and `sim.terrain` and keep its own state. The
stick is relative to `sim.state.viewYaw` (see the yaw convention in `types.ts`); write one helper
that turns a wanted world yaw into a stick and use it everywhere.

## Bots

- **tucker**: never touches the screen.
- **carver**: holds the stick, steering along a slow wander; never tucks, never hops.
- **liner**: plays well. Steers toward the high end of the nearest half-pipe, tucks down it, hops
  clean on every landing, carves round at the low end or the rim and picks the next line (the other
  pipe, a kicker, a boost pad, the crater). Tucks whenever the ground ahead falls, carves only to
  aim.
- **masher**: liner's steering, but taps hop at random times unrelated to landing.

## Tests (`tests/sim/bowl-bots.test.ts`), seeds 1 to 5, 120 s each unless said

1. carver never passes gear 3 and spends at least 80% of its time in gears 1 and 2 (the stick alone
   does not make speed; brief dips downhill are allowed).
2. liner reaches gear 4 within 30 s and gear 5 within 90 s on every seed, and spends at least 40%
   of the run in gear 3 or higher.
3. liner's average speed is at least 1.6 times carver's.
4. masher does clearly worse than liner (lower time in gear 3+, shorter longest chain) but is never
   stuck: it travels at least 600 m.
5. tucker from spawn is moving within 5 s and travels at least 150 m in 60 s (the bowl is never a
   dead end for someone who lets go).
6. Nobody ever leaves the radius, produces a non-finite number, or stops for more than 4 s while
   holding the stick.
7. liner's longest clean-hop chain is at least 8 on every seed.
8. Two runs of the same bot on the same seed are bit-identical (`hashSimState` every tick).
9. Print one table (seed by bot: average speed, time share per gear, top speed, longest chain,
   distance) with `console.log` so the lead can read the balance; no assertion on it.

If a test fails because the mover or the bowl makes it impossible (not because the bot is clumsy),
do not weaken the test and do not edit `src/`: report the numbers.

## `tests/e2e/routes/touch.mjs`

Real touch events through CDP (`Input.dispatchTouchEvent`), not the hook's `hold`: a drag up and
held moves the mover and reaches gear 2; lifting the thumb shows the tucked state; a quick tap hops
(the mover leaves the ground); in `?scheme=lift` lifting after a hold hops; in `?scheme=swipe` a
fast flick up while holding hops and a tap does not. The stick ring is visible during the touch and
gone after. Screenshot during the drag.

## `docs/PLAYTEST.md`

The owner's checklist for the phone. Short. For each of the three schemes: what to do for five
minutes and what to notice. Then the constants only a thumb can judge, grouped as in the debug
panel, each with its current value (read from `FEEL_DEFS`, do not invent), what it feels like when
it is too low and too high, and how to change it (`?debug`). Then how to send the result back (the
panel's copy button). Plain words, no jargon the pitch does not use.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. The table from test 9 is in your report, with one line on what it says about balance.
3. `npm test` stays under 30 s in total.
