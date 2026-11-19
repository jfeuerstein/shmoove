# Art: icons for weapons, passives, boons and the HUD

Model: opus. Read `docs/briefs/art-common.md` for the style and the rules that apply to the DOM
(colour from `PALETTE`, no assets), then `src/sim/arsenal.ts` (`WEAPON_INFO`, `PASSIVE_INFO`),
`src/sim/offer.ts` (`BOON_INFO`, card types), `src/ui/cards.ts` and `cards.css`,
`src/ui/buildBar.ts` and `buildBar.css`, `src/ui/endScreen.ts`, `src/ui/howTo.ts`,
`src/ui/hud.ts`, their unit tests, `tests/e2e/routes/cards.mjs`.

## Goal

Nothing in the game is named by a two-letter code any more. Every weapon, passive and boon has
a drawn icon that says what it does, used on the cards, in the build bar and on the end card.

## You own

A new `src/ui/icons.ts` (+ test), `src/ui/cards.ts` and `cards.css`, `src/ui/buildBar.ts` and
`buildBar.css`, the build summary on `src/ui/endScreen.ts` (not its buttons or layout beyond
that: another task is adding a run report to the end card), `tests/e2e/routes/cards.mjs`.

## What to build

- **`icons.ts`:** one inline SVG per weapon (10), passive (11) and boon, generated in code as
  strings or DOM nodes (no files, no fonts, no emoji). One family: a 24-unit grid, bold filled
  shapes with one cut-out detail, readable at 28 px in the build bar and good at 64 px on a
  card. Each icon is the thing it is: a dart for Seekers, a flame trail for the Wake, a saw disc
  for Orbit, a coil for Springs, a horseshoe for Magnet. Colour by `currentColor` so the caller
  tints it: weapons in `PALETTE.accent`, passives in `PALETTE.pad`, boons in `PALETTE.mover`
  (as the bars already distinguish them), read when the UI is built.
- **Cards:** the icon large at the top of each card, the name, the one line of what this level
  gives, level pips. A new weapon, a level on one you carry, and a passive are told apart at a
  glance (a NEW tag, a frame colour). The card's whole face is the tap target, as now.
- **Build bar:** icons in place of the two letters, level pips under each, empty slots as faint
  outlines.
- **End card:** the build shown as icons with levels.
- A static gallery for judging the set: `?icons` is not available to you (params are the
  lead's); instead write a unit-test-driven HTML snapshot or have the e2e route render every
  icon at 28 and 64 px into one screenshot (`artifacts/screens/icons.png`) by injecting them
  into a blank overlay through `page.evaluate` from the module the app already loaded, or by
  any means that needs no new URL parameter.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. Unit tests: every weapon, passive and boon id has an icon; each is valid SVG with a viewBox
   and uses `currentColor`; no two are identical; cards and the build bar contain no two-letter
   codes.
3. Screenshots: `icons.png` (the whole set at both sizes, labelled), a level-up offer, a boss
   offer, a shrine offer, the build bar full, the end card. Look at them with the Read tool: at
   28 px, which icons could be mistaken for each other? Fix the worst pair and say which
   remain.
4. The cards still fit at 360x640 without scrolling.

## Return

Summary, decisions, what is still weak, commands with pass/fail, changed files, branch and last
commit.
