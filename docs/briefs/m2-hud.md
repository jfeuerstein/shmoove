# M2: the run on screen

Model: sonnet. Read `docs/briefs/m2-common.md` first, then `src/ui/hud.ts` and its CSS and test,
`src/app/testHook.ts`, `src/app/main.ts`, `tests/e2e/run.mjs` and a route or two.

## Goal

A player can see how the run is going (time, health, XP, level) without anything covering the
middle of the screen, and when the run ends they see how it went and start again with one tap.

## You own

- `src/ui/hud.ts` and its CSS, `tests/unit/hud.test.ts`
- `src/ui/endScreen.ts` (+ CSS), `tests/unit/endScreen.test.ts`
- `src/app/testHook.ts` (additions below)
- `tests/e2e/routes/run.mjs`
- In `src/app/main.ts`: creating the end screen, calling its update, and the restart wiring.

## What to build

**HUD** (only the gear, name, speed and chain when `sim.horde` is false, as now). With a run:

- Run clock, top left: time left as `m:ss`, counting down from `RUN_TICKS`.
- Kills, top right, small. (With `?debug` the panel button is at the top right: do not overlap it.)
- Health: a thin bar across the top edge inside the safe area, `PALETTE.hp`, turning
  `PALETTE.hpLow` under 30%, with a short pulse when health drops.
- XP: a thin bar along the very bottom edge inside the safe area, `PALETTE.spark`, with the level
  number at its left end. A short pulse on level-up.
- The gear numeral stays where it is.

`Hud.update` takes the sim (or its state and world). Writes to the DOM only when a shown value
changes: text when the text changes, bar widths by transform when the value changes by a visible
amount.

**End screen** (`endScreen.ts`): when `run.phase` is `PHASE_DEAD` or `PHASE_WON`, after a pause of
0.6 s so the last moment is seen, a card rises over the lower half of the screen: the title
(`STOPPED` when dead, `STILL MOVING` when the clock ran out), then time survived, kills, level,
loops popped and the best loop (`player.pops`, `player.bestPop`), and one button, `AGAIN`, at
least 56 px tall and most of the width, in the thumb zone. Tapping it calls the restart callback
and the card goes. Touches on the card never reach the game. Keep the "what to show and when"
logic in a pure function and test it.

**Restart** (in `main.ts`): `sim.reset()`, reset the chase camera, clear the end screen. Nothing
else may carry over between runs.

**Test hook** additions: `state()` also returns `hp`, `maxHp`, `level`, `xp`, `xpNext`, `kills`,
`enemies`, `sparks`, `phase`, `seconds` (run time). New methods `hurt(damage: number)` (calls
`hurtPlayer`) and `restart()`.

## Acceptance

1. `npm run gate` is green.
2. `hud.test.ts`: the clock text for several times; the health bar's colour change at 30%; no
   writes when nothing changed (extend the existing write-counting test to the new parts); without
   a run none of the new parts exist.
3. `endScreen.test.ts`: hidden while playing; hidden during the pause; shown after it with the
   right title and numbers for dead and for won; hidden again after restart.
4. `tests/e2e/routes/run.mjs` on the bowl with `?hook`: the clock shows `3:00` then counts down;
   `hook.hurt(30)` shortens the health bar; `hook.hurt(500)` ends the run, the card appears with
   `STOPPED`, the mover has stopped; a real touch on `AGAIN` restarts: health full, clock back at
   `3:00`, the card gone, the mover moves again when driven. Screenshots of the HUD mid-run and of
   the end card.
5. Open both screenshots with the Read tool and say what you see: nothing over the middle of the
   screen during play; the card readable and the button obviously the thing to press.
