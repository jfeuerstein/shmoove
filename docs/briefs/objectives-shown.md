# Objectives in between, shown and not told

Model: opus. Read `CLAUDE.md`, `docs/briefs/README.md` (common rules), `docs/briefs/art-common.md`
(style and material rules), `docs/briefs/clear-objectives.md` (the last pass, which this one
revises), `docs/DECISIONS.md` items 74 to 76, then `src/sim/things.ts`, `src/render/thingsView.ts`,
`src/ui/thingLabels.ts`, `src/ui/howTo.ts`, `src/app/runLog.ts` (the `map` counters),
`tests/sim/things.test.ts`, `tests/sim/bot/fight.ts`, `tests/balance/harness.ts`,
`tests/e2e/routes/park.mjs`, `cards.mjs`.

## Why

The objectives were first fiddly (a shrine wanted three laps inside ten seconds in a narrow
band), then made one-touch with a label saying what to do. The owner played that and said: "now
the objectives feel a bit too easy - have them be somewhere in between the two difficulties, but
visually conveying how to complete them rather than a label saying it (such as the dotted line
along the round lighting up, or the circle around the shrine lighting up to indicate you have
to circle it)".

So: each objective is a small thing to do on the board, forgiving but not free, and the thing
itself shows what it wants and how far along you are. No words over anything in the world.

## The rules

- **Crate, gold crate, totem:** ride into it. Unchanged.
- **Shrine: circle it once.** Round the shrine is a ring of twelve segments. A segment lights
  when the rider is in its sector, between 2.5 and 11 m from the shrine. Either direction, any
  speed, no clock, and the lit ones stay lit while the rider stays within 25 m; ride further
  away than that and they go out. All twelve lit: the boons open and the shrine is spent.
- **Slalom: ride the line before it runs out.** Five gates, in order. Taking the first starts
  it; from then each next gate must be taken within 5 s of the last (it was 2.4 s). Run out and
  it goes back to the start at once, ready to try again: no lock-out. Posts 3.5 m either side.
- **Hoop: ollie through it.** The ring hangs over its kicker's lip, its bottom half a metre
  above the ramp, and is taken only in the air. A rider who comes straight up the kicker
  between run speed and 24 m/s, up to a metre off its middle line, and taps an ollie anywhere in
  a window of a quarter of a second or more near the lip goes through; one who rides up
  without an ollie at 20 m/s or less does not. Size and place the ring so that holds on every
  hoop of seeds 1 to 3 (a test proves both halves), and draw the ring at the size of its catch.
- Crossing a gate's or a hoop's line further in one tick than riding allows still does not
  count (keep that rule).

Numbers above are the intent; adjust any of them a little if a test of the feel says so, and
say what you changed. `THINGS` keeps no dead numbers.

## What shows it (no labels)

Delete the labels: `src/ui/thingLabels.ts`, its css, its tests and its wiring in `main.ts`. Nothing
in the world carries words. Instead:

- **Shrine:** the ring on the ground is twelve dashes at about 6 m. Unlit dashes are dim; lit
  ones are bright gold. While some are unlit, a pulse runs round the ring through the unlit
  ones, in the direction the rider is circling (clockwise before the rider has started), so
  the ring itself says "go round". Each dash lights with a small pop as the rider passes it;
  the last one sets the whole ring flashing as the shrine opens. Going out of range dims them
  all at once.
- **Slalom:** a dotted line on the ground runs gate to gate. Before it is started, dots march
  along the whole line from the first gate, showing the way and the order. Once started, the
  leg to the next gate is the clock: its dots go out one by one from the rider's end toward
  the gate as the time runs, so a glance says how long is left. Taken gates drop their banners
  and their leg of the line stays lit behind the rider. A reset is seen: the banners come back
  up and the line starts marching again.
- **Hoop:** a dotted arc on the ground and in the air shows the flight: dots up the ramp, off
  the lip and through the ring, marching in the direction of travel. The ring pulses gently.
  Ridden under without an ollie, nothing happens (no error effect: the arc already says it).
- **Totem:** a faint ring at its touch distance and a slow red glow in its eyes: gold says
  reward, red says it bites.
- **Beacons** still mark live points of interest from afar (none for plain crates); with no
  labels to hand over to, let them fade out between 30 and 12 m.
- **How to play** (`src/ui/howTo.ts`): one line in the same spirit: circle a shrine, ride a
  slalom's line before it runs out, ollie through a hoop, totems call elites. Words belong on
  that sheet, not in the world.

Everything drawn takes its colour from `PALETTE` (points of interest are gold in every look;
`PALETTE.threat` for the totem's eyes), uses the existing material helpers, and adds no more
than one draw call (the horde perf scene is at 38 of 40; report what it comes to).

## The bots and the balance

The rider bot (`tests/sim/bot/fight.ts`) goes for shrines, slaloms and hoops: teach it the new
rules as a good player would do them (circle a shrine at a few metres when it is safe; ride a
slalom's line; ollie at the lip). Then run `npm run balance` and commit `tests/balance/last.json`
from a run that exits zero. If a band misses, fix the bot first where the bot is what is wrong;
then numbers, as few as will do, only in the tables `docs/briefs/m4-balance.md` lists; never
loosen a band. If it cannot be met, stop and report which band and why. Probe one bot on one
seed before spending a five-minute full pass.

## You own

`src/sim/things.ts`, `src/render/thingsView.ts`, the deletion of `src/ui/thingLabels.*` and its
wiring in `src/app/main.ts` (and only that in `main.ts`, plus what `things.update` needs passed),
the map line in `src/ui/howTo.ts`, the `map` counters in `src/app/runLog.ts` if a state's meaning
changes, `tests/sim/things.test.ts`, `tests/unit/thingsView.test.ts`, `tests/unit/howTo.test.ts`,
`tests/sim/bot/*`, `tests/balance/last.json` (and the harness only if a bot's interface changes;
not the bands), `tests/e2e/routes/park.mjs` and `cards.mjs`, `docs/PITCH.md` section 7's table,
the lines of `docs/PLAYTEST.md` that describe the objectives. Nothing else in `src/sim/` beyond
tuned numbers under the balance rule above; not `look.ts`, the mover, the bowl or the hook.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass, and
   `npm run balance` exits zero (or you have stopped and reported). Not the gate. Perf once at
   the end for draw calls and triangles.
2. Sim tests that say the rules as a player would meet them: a shrine opens after one lap
   either way and not after half a lap; its lit segments survive a pause nearby and go out
   past 25 m; a slalom resets when its clock runs out and can be started again at once, and is
   completed by a rider who takes each gate inside 5 s; the hoop test described above;
   determinism (`tests/sim/reset.test.ts`, `tests/sim/run.test.ts`) still holds.
3. View tests: which dashes are lit follows the sim's state; the slalom's lit leg shortens
   with its clock; the hoop's arc passes through the ring's middle; no text nodes are made.
4. `park.mjs` screenshots: a shrine untouched, half circled, and opening; a slalom before
   starting, mid-leg with time half gone, and just reset; a hoop from the run-in and a rider
   in the air through it; a totem. Look at each with the Read tool. Without any words, would
   someone who has never played know what to do with each, and how far along they are? Say
   honestly which is weakest.
5. Rules of the game: how fast the rider moves never changes damage dealt, damage taken or
   healing.

## Return

Summary, the final rules and `THINGS` numbers (old, new), decisions, what was changed for the
bots and the balance (band lines from the final run, any numbers changed), what is still weak,
what you saw in each screenshot, perf draw calls and triangles, commands with pass/fail,
changed files, branch and last commit.
