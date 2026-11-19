# The run report: what a playtest measures

Model: sonnet. Read `CLAUDE.md`, `docs/briefs/README.md` (common rules), then `src/sim/world.ts`
(`Tally`, `SRC_*`, `HURT_*`, `KINDS`, `FX_*`, things, `BossState`), `src/sim/types.ts` (`EV_*`),
`src/sim/arsenal.ts`, `src/app/main.ts`, `src/app/loop.ts` (`FrameStats`), `src/app/settings.ts`,
`src/ui/endScreen.ts` and `endScreen.css`, `src/ui/pause.ts`, `src/ui/howTo.ts`,
`src/app/testHook.ts`, `tests/e2e/routes/run.mjs`.

## Why

The owner is about to playtest on a phone and wants exact things to measure. The game should
measure them itself and hand them over in one tap, so the owner reports numbers, not
impressions.

## What to build

**1. `src/app/runLog.ts` (pure, no DOM, unit-tested):** a recorder fed once per sim step
(`afterStep(sim)`) and once per drawn frame (`frame(ms)`), allocation-free while recording, that
produces a plain `RunReport` object at the end of a run. It records:

- **Outcome:** dead, won or abandoned (restarted or left); run time; level; kills; seed; control
  scheme; the look in use if a `look` setting exists by the time you merge (else omit).
- **The build:** every card taken, in order, with the run time it was taken and where it came
  from (level, crate, shrine, totem, boss); the final weapons and passives with levels.
- **Damage dealt by weapon** (`w.tally.dealt`), as totals and as a share.
- **Hits and damage taken by cause** (`w.tally.hits`, `w.tally.hurt`: each enemy kind by name,
  lob, ring, other); health at each whole minute; the lowest health reached; time spent under
  30% health.
- **Movement:** distance; average and top speed; share of time in each gear; time in the air;
  ollies, clean ollies and the longest clean chain; rails ground and seconds on rails; pads
  hit; time standing still (under 1 m/s); share of time holding the stick.
- **The map:** crates opened, shrines finished, slalom gates and hoops taken, totems called,
  tokens. (Read things' states; see `src/sim/things.ts`.)
- **Bosses:** for each that arrived: when, how long it lived, hits taken while it was up, and
  whether it fell.
- **The horde:** enemies alive at each whole minute and the peak.
- **Cards:** seconds spent choosing, total and per offer (real time).
- **Frames, measured on the device:** average frame time, the 95th and 99th percentile (a fixed
  histogram, no arrays that grow), frames over 33 ms, frames over 50 ms, and the average while
  the horde was over 200.
- **Device:** user agent, screen size in CSS px, device pixel ratio, whether installed
  (standalone display mode), the app's build id (the service worker's cache name or a build
  constant Vite already defines; if neither is reachable, say so).
- **Lesson:** if the lesson ran this session, how long each step took.

**2. On the end card:** a short stats block (time, level, kills, top weapon by damage, what hurt
most) and a **COPY REPORT** button that puts the whole report on the clipboard as text: a
readable summary of about 25 lines followed by the JSON on one line. Where the clipboard is not
allowed it falls back to a selectable text box. A confirmation ("Copied") shows for a moment.

**3. Kept reports:** the last ten reports are saved (through `src/app/settings.ts`'s storage
pattern, under their own key, tolerant of storage being unavailable or full). The pause sheet
or the how-to sheet gets a **REPORTS** entry that lists them (when, outcome, time) and copies
any one, or all.

**4. The test hook:** `report(): RunReport | null` (the current run so far).

## You own

New `src/app/runLog.ts`, `src/app/reports.ts` (storage), `src/ui/reportView.ts` + css, their unit
tests; the stats block and button on `src/ui/endScreen.ts` / `endScreen.css` (the build summary
on that card belongs to another task: leave it where it is); one entry in `src/ui/pause.ts` or
`src/ui/howTo.ts`; wiring in `src/app/main.ts`; `report()` in `src/app/testHook.ts`; a new
`tests/e2e/routes/report.mjs`. Nothing in `src/sim/` or `src/render/`. If a number above cannot be
read from outside the sim, leave it out and say so; do not add sim state.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass.
2. Unit tests on `runLog` with a real `Sim` (see `tests/sim/tally.test.ts` for how one is driven):
   the report's kills, level and time match the world's; damage shares sum to 1; hits by cause
   sum to the hits that happened; a boss's times are right (`w.run.ticks` can be set); the
   percentile histogram is right against a known list of frame times; recording allocates
   nothing per step (no arrays or objects created in `afterStep`/`frame`: assert by reading the
   code path you wrote, and keep it obviously so).
3. `report.mjs`: play a short run to death with the hook, the end card shows the stats block,
   COPY REPORT yields text whose JSON parses and whose kills equal `state().kills`; AGAIN starts
   a new log; the kept list shows the finished run after a reload. Screenshots of the end card
   and the reports list. No console errors.
4. The end card still fits at 360x640.

## Return

Summary, the exact list of fields in `RunReport`, anything left out and why, commands with
pass/fail, changed files, branch and last commit.
