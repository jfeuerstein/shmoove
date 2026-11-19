# M1: debug panel, stick view, scheme switch

Model: sonnet. Read `docs/briefs/README.md` for the common rules.

## Goal

The owner tunes the feel on their phone. With `?debug` there is a panel listing every `FEEL`
constant, editable live, plus a switch between the three control schemes. Without it the game shows
only a faint stick under the thumb.

## You own

`src/ui/debugPanel.ts`, `src/ui/stickView.ts`, `src/app/settings.ts`, CSS files beside them,
`tests/unit/settings.test.ts`, `tests/e2e/routes/debug.mjs`. In `src/app/main.ts`: only the lines
that create these three things and call their `update`.

## Interfaces

- `FEEL`, `FEEL_DEFS`, `FEEL_KEYS`, `resetFeel()` in `src/sim/constants.ts` (each def has `min`,
  `max`, `step`, `group`, `note`).
- `Scheme`, `SCHEMES` in `src/input/source.ts`; `TouchInput.setScheme()` and `.gestures.stick` in
  `src/input/touch.ts`.
- `parseParams()` in `src/app/params.ts` (`debug`, `scheme`).
- `PALETTE` / `gearCss()` in `src/render/look.ts` for colours.

## What to build

**`settings.ts`**: pure logic plus thin `localStorage` wrapper. Stores the chosen scheme and any
`FEEL` values that differ from their shipped defaults, under one versioned key. Loading clamps each
value to its def's range, ignores unknown keys, and survives missing or corrupt storage (private
mode throws). `?scheme=` in the URL wins over the stored scheme. Exports a function that returns
the current overrides as a short text block (`key = value` per line) for the owner to paste back.

**`debugPanel.ts`**: only created with `?debug`. A button at the top right corner (inside the safe
area) opens a full-height sheet over the right two thirds of the screen; closed by the same button.
While open the game keeps running and the left third still shows it. Contents: the scheme switch
(three large buttons); then one collapsible section per `group`; in each, one row per constant with
its name, current value, a range slider from `min` to `max` by `step`, and the `note` in small
text. Changed values are highlighted and have a per-row reset. Buttons at the top: reset all, copy
overrides to the clipboard (falls back to showing the text block in a selectable box). Everything
is at least 44 px tall. Touches on the panel never reach the game's input. Edits write `FEEL`
directly and are saved through `settings.ts`.

**`stickView.ts`**: a faint ring at the stick origin and a dot at the thumb, drawn from
`gestures.stick`, visible only while a touch is active, never intercepting pointer events. Updates
by transform only.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. `settings.test.ts`: round trip, clamping, unknown keys, corrupt JSON, throwing storage, URL
   scheme precedence, only non-default values stored, the text block.
3. `tests/e2e/routes/debug.mjs`: with `?debug&hook`, open the panel, drag the `runSpeed` slider to
   a lower value, hold forward through the hook and assert the mover settles at the new speed;
   switch scheme and assert it sticks across a reload; reset all restores the default; without
   `?debug` the button does not exist. Screenshot with the panel open.
4. Open the screenshot with the Read tool and say what you see: rows readable at 390 px wide, no
   horizontal scrolling, notes not truncated mid-word.
