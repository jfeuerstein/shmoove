# M3: cards on screen, the build bar, damage numbers

Model: sonnet. Read `docs/briefs/m3-common.md` first, then `src/sim/offer.ts`, `src/sim/arsenal.ts`,
`src/sim/build.ts`, `src/ui/hud.ts`, `src/ui/endScreen.ts`, `src/app/main.ts`, `src/app/loop.ts`,
`src/app/settings.ts`, `src/app/testHook.ts`, `src/ui/threat.ts` (for projecting a world point to
the screen), `tests/e2e/routes/run.mjs`.

## Goal

Levelling up is a choice made with one thumb in under two seconds, and it gives the player their
momentum back. The build is visible at a glance. Hits show what they did.

## You own

`src/ui/cards.ts`, `src/ui/buildBar.ts`, `src/ui/numbers.ts` (+ CSS beside each),
`tests/unit/cards.test.ts`, `tests/unit/buildBar.test.ts`, `tests/unit/numbers.test.ts`,
`tests/e2e/routes/cards.mjs`. In `src/app/loop.ts`: a time scale on the stepper. In
`src/app/settings.ts` (+ its test) and `src/ui/debugPanel.ts`: an auto-pick setting and its switch.
In `src/app/testHook.ts`: the additions below. In `src/app/main.ts`: creating and updating these,
the pick input, the time ramp, and removing `autoPick: true` from the `Sim` (replace it with the
setting).

## What to build

**Cards** (`cards.ts`). When `w.run.phase === PHASE_CHOOSE`, up to three cards stacked in the lower
half of the screen, each at least 84 px tall and nearly full width: the two-letter code in a tile,
the name, what taking it does (`NEW` and the blurb for something not carried; `Lv 2 > 3` for a
level; `+2` and a gold edge for a rare one; a boon's name and blurb from `BOON_INFO`), and the
weapon's `fedBy` in small print. A header says where it came from (level up, crate, shrine,
totem). The game behind stays visible and dimmed. Tapping a card sends that pick; touches never
reach the game. Nothing else closes it. The text for a card is a pure function of the offer and
the loadout: test that.

**The pick as input.** The choice goes to the sim as `InputFrame.pick` on the next tick (wrap the
input source in `main.ts`: the frame carries the pending pick once, then -1).

**Time.** The sim holds still by itself while an offer is open. When the last offer closes, the
game runs at 0.3 speed and ramps to full over 0.5 s (a `scale` on `FixedStepper`: scaled time
accumulates, steps stay exactly 1/60 s). Unit-test the stepper with a scale.

**Auto-pick** (a setting, off by default, with a switch at the top of the debug panel): the sim
answers offers itself with a simple policy (a new weapon if offered, else the first weapon card,
else the first card) and the cards never show.

**Build bar** (`buildBar.ts`). Just above the XP bar: four weapon tiles then four passive tiles,
each the two-letter code with level pips under it; empty slots are faint outlines. About 34 px
tiles so eight fit at 390 px wide. Writes only when the loadout changes.

**Damage numbers** (`numbers.ts`). For each `FX_ENEMY_HIT` in `w.fx` (burn and pop do not emit
one), a number at the hit's place on screen that floats up and fades over about 0.6 s; a pool of
24, the oldest reused; for `FX_POP`, one larger number at the loop's centre with how many it
killed if you can tell from that tick's `FX_ENEMY_DIE` count. Moved by transform only.

**Test hook.** `state()` also returns `offer` (`null`, or `{ source, cards: [{ type, id, by }] }`),
`weapons` and `passives` (arrays of `{ id, level }` in slot order), `tokens`. New methods
`pick(index)`, `giveXp(amount)`, and `setWeapon(id, level)` / `setPassive(id, level)`.

## Acceptance

1. `npm run gate` is green.
2. Unit tests: card text for a new weapon, a level, a rare, a passive, each boon, each source; the
   build bar for an empty, partial and full loadout and no writes when unchanged; number pooling
   (the 25th reuses the oldest; nothing allocated); the stepper's scale (half speed takes twice as
   long for the same steps; the ramp reaches full speed in 0.5 s of real time).
3. `tests/e2e/routes/cards.mjs` on the bowl with `?hook`: `giveXp` enough for a level; the cards
   appear, three of them, in the lower half; the world does not advance while they are up; a real
   touch on the second card takes it: the cards go, the build bar shows the new tile, the world
   advances again and the mover still has its speed; with the auto-pick setting on, a level never
   shows cards. Screenshots with the cards up and of the build bar after several levels.
4. Open both screenshots with the Read tool and say what you see: card text readable at 390 px,
   nothing truncated, the tiles and pips legible, nothing over the middle of the screen in play.
