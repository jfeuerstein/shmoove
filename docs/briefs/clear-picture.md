# A calmer picture: what matters stands out

Model: opus. Read `CLAUDE.md`, `docs/briefs/README.md` (common rules), `docs/briefs/art-common.md`
(the style and material rules still hold), `src/render/look.ts` (the colour language at the top),
then `src/ui/threat.ts` and `threat.css`, `src/ui/lowHealth.ts`, `src/ui/numbers.ts`,
`src/render/fxView.ts`, `weaponsView.ts`, `wakeView.ts`, `zonesView.ts`, `shotsView.ts`,
`sparksView.ts`, `parkView.ts`, `hordeView.ts` (read only, but for its shadows and hit flash),
`tests/e2e/routes/arsenal.mjs`, `looks.mjs`.

## Why

The owner played a whole run and asked for the game to be "a little easier to understand
visually". Looking at real frames from a run, the picture is busy in ways that hide what
matters:

- A red glow sits on the bottom and side edges almost all the time, and a red wash covers the
  screen after every hit. Red should mean "now", not "always".
- The rider is often under its own weapons' effects (rings, flashes, the Bumper's hoop, the
  level-up rings) and cannot be found at a glance.
- The top of the screen is full of unexplained light: skyline neon, billboards, floodlights
  and beacon columns, all brighter than the enemies below them.
- Tar is dark on dark; damage numbers pile up.

## The order of things

From loudest to quietest, what the eye should find first:

1. a danger about to land (a lob ring, a boss's ring or lane), and an enemy about to touch you;
2. the rider;
3. enemies;
4. what to pick up or ride to (sparks, crates, points of interest);
5. your own weapons' effects;
6. the park and the scenery.

Every change below serves that order. Nothing is removed that tells the player something; it
is made as loud as it deserves and no louder.

## What to do

- **Edge glow and hit wash** (`threat.ts`, `threat.css`, `lowHealth.*`): the glow shows only for
  enemies that are close, out of frame or behind, and closing; thinner and fainter than now at
  its strongest, and gone when there are none. The hit wash is a short flash at the edges, not
  a screen of red, and scales with the hit. Low health gets a steady, slim edge of its own that
  does not look like the hit flash. With full health and nothing near, there is no red on
  screen at all.
- **The rider under its own effects** (`fxView.ts`, `weaponsView.ts`, `wakeView.ts`): effects
  centred on the rider (Slam's wave, the Bumper's hoop and pulse, Orbit's streaks, level-up and
  heal rings, the Wake's pop) are drawn so the rider and the ground within two metres of it
  stay readable: thinner, more open, shorter-lived or more transparent near the middle. No
  effect of the player's own is ever the brightest thing on screen for more than a blink.
- **Scenery** (`parkView.ts`): the skyline, billboards, floodlights and fence lamps drop to
  silhouettes with a little light, dimmer than anything in the bowl. They still give the bowl
  an edge and a sense of place.
- **Hazards on the ground** (`zonesView.ts`): tar gets a lighter wet rim and a sheen so it reads
  on the dark floor in every look; lob rings and mines stay the clearest things on the ground.
- **Damage numbers** (`numbers.ts`): fewer and smaller: merged per enemy over a short time, a
  cap on how many show at once, none drawn over the rider; big hits and kills win the cap.
- **Enemies against the floor** (`hordeView.ts`, shadows and flash only): the blob shadow under
  each enemy is strong enough to pin it to the ground in all four looks, and the hit flash does
  not turn a whole crowd white at once.

The four looks (`?look=night|pool|tape|riso`) must all come out better, not only the default.

## You own

`src/ui/threat.ts`, `threat.css`, `src/ui/lowHealth.ts` and css, `src/ui/numbers.ts` and css,
`src/render/fxView.ts`, `weaponsView.ts`, `wakeView.ts`, `zonesView.ts`, `shotsView.ts`,
`sparksView.ts`, `parkView.ts`, and in `src/render/hordeView.ts` only the shadows and the hit
flash; their unit tests; a new `tests/e2e/routes/clarity.mjs`. Not `thingsView.ts` or anything about
the map's objectives (another task is reworking those now, beacons included); not `look.ts`,
`scene.ts`, `terrainView.ts` or `camera.ts` (the lead's); nothing in `src/sim/`; not `main.ts`.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass. Not the
   gate; perf once at the end for draw calls and triangles (budget 40 and 200,000 with the
   horde, and the horde scene is at 39 now: add none).
2. Unit tests for what is a rule: no glow and no wash at full health with nothing near; the
   glow's strength against how many are near and closing; the wash's strength and length
   against the hit; the numbers' merging and cap.
3. `clarity.mjs`: three seeded moments of real play driven through the hook (an early minute, a
   mid run with three weapons, a late crowd with four weapons at level 5), each in all four
   looks, saved as `clarity-<look>-<moment>.png`; and these measured from the screenshot in
   the route, with the numbers in your report before and after:
   - with full health and no enemy within 10 m, the share of pixels in the outer tenth of the
     screen that are red-dominant: under 1%;
   - in the late moment, the share of near-white pixels in a box of 2 m round the rider: under
     a third;
   - in every moment, the mean brightness of the top fifth of the screen is below that of the
     middle three fifths.
4. Before and after, side by side, for the default look's three moments. Look at every
   screenshot with the Read tool and say, for each moment: where is the rider, what is the
   nearest danger, how long did it take your eye to find them.
5. Rules of the game: how fast the rider moves never changes damage dealt, damage taken or
   healing; nothing drawn may suggest it does.

## Return

Summary, decisions, the three measures before and after, what is still noisy and why, what you
saw in each screenshot, perf draw calls and triangles, commands with pass/fail, changed files,
branch and last commit.
