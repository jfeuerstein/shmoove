# Fixes before the first full playtest: see the boss, and pause

Model: opus. Read `CLAUDE.md`, `docs/briefs/README.md` (the common rules), `docs/briefs/m4-run.md`
(the bosses), then `src/sim/bosses.ts`, `src/sim/world.ts` (`BossState`, zones, fx), `src/ui/threat.ts`,
`src/ui/bossBar.ts`, `src/render/zonesView.ts`, `src/render/fxView.ts`, `src/app/main.ts`,
`src/app/loop.ts`, `src/audio/audio.ts`, `src/input/touch.ts`, `tests/e2e/routes/boss.mjs`.

## Why

An independent check played the whole run. It works, but a boss is on screen about a tenth of the
time in its own fight and nothing points at it, so the Bruiser's tell and charge and a Standstill
ring from behind cannot be seen. A danger the player cannot see is the worst kind of bug in this
game. The same check found the run cannot be paused. The owner plays next.

## What to build

### 1. Where the boss is (`src/ui/threat.ts`, `threat.css`)

While a boss is alive and outside the frame, one marker pinned to the screen edge pointing at it:
bigger than a bollard's chevron, in that boss's colour (`PALETTE.bosses[kind - KIND_BRUISER]`),
never pooled away by bollards. While the Bruiser is telling or charging the marker pulses hard
enough to be noticed without looking at it. Keep the pure-function style of the file (where a
marker sits is already a tested pure function; reuse it).

### 2. The Bruiser's charge lane (new `src/render/bossView.ts`)

When the Bruiser's tell starts, a lane on the ground from the Bruiser along its aim: as wide as
the Bruiser (`2 * KINDS[KIND_BRUISER].radius`), `BOSS.bruiser.chargeFar` long, following the
terrain. It fills along its length over the tell so its end is reached as the charge starts, holds
at full while the Bruiser charges, and is gone when the charge ends. `PALETTE.bosses[0]`, bright
enough to read on the dark ground from the chase camera, drawn under the enemies. This is the
tell the player dodges by: it crosses where the rider is going even when the Bruiser is behind.

What the sim gives you: `findBoss(w)` for the index; `w.horde.state[i]` is `BRUISER_TELL` or
`BRUISER_CHARGE` and `w.horde.timer[i]` the ticks into that phase; `w.boss.aimX/aimZ` is the unit
aim; the lane starts at the Bruiser's position during the tell and at `w.boss.fromX/fromZ` during
the charge. Read only.

### 3. The Standstill's slow (same view)

A disc on the ground under the Standstill, `BOSS.standstill.auraReach` in radius, following it:
a faint fill and a clear edge, so the player sees why the board went heavy and where it stops.
`PALETTE.bosses[2]`, quiet enough that the rings (which are `PALETTE.ring`) still stand out on it.

### 4. A ring coming from behind (`src/ui/threat.ts`)

When the front of a `ZONE_RING` is outside the frame or behind the rider, the rider is outside
the front, and the front will reach the rider within 1.2 s at `BOSS.standstill.ringSpeed`: a cue
on the screen edge toward the ring's centre in `PALETTE.ring`, growing as it nears. One at a
time (the nearest front). Gone the moment the front has passed.

### 5. Arrival and fall (`src/render/fxView.ts`)

`FX_BOSS_IN` (a boss arrives; `a` is its kind) and `FX_BOSS_DOWN` (it falls) draw nothing today.
Arrival: a column or shockwave at the spot in the boss's colour, about a second. Fall: a burst
several times an ordinary death's, in the boss's colour. Also: the ordinary death burst for
kinds 7 to 9 falls back to the shuffler's colour; use `PALETTE.bosses`. Pooled, no per-frame
allocation, inside the existing draw-call budget (`tests/perf/budgets.json`).

### 6. The boss's name (`src/ui/bossBar.ts`)

The big name on arrival is timed by sim ticks, so it stays up whenever the world holds still: on
the end card if the rider dies within two seconds of an arrival, and behind cards. Time it by
real time, and hide it at once when the run is over or cards are open. "THE STANDSTILL" spans 5
to 385 px of a 390 px screen: fit it with at least 16 px either side at 360 px wide.

### 7. Pause (`src/app/main.ts`, a new `src/ui/pause.ts` + css, `src/audio/audio.ts` if needed)

- A pause button in the HUD: top right corner area, at least 44 px square, clear of the kills
  count and of the notch (`env(safe-area-inset-top)`), outside the steering zone (the lower two
  thirds). It must not start a steer or an ollie when pressed.
- Paused: the sim does not step, music and effects are silent, a plain overlay says PAUSED with
  RESUME (and HOW TO PLAY, which already exists). Resume gives no jump: no catch-up steps, the
  rider where it was.
- The game pauses itself when the page is hidden (`visibilitychange`), on `pagehide`, and when
  the window loses focus (`blur`), and stays paused until the player presses RESUME. Not during
  the lesson's own holds, the card screen or the end card in a way that breaks them: a pause
  there must come back to exactly that screen.
- The test hook's `pause(on)` keeps its meaning (it stops the real-time clock for scripts and
  shows no overlay). Add `paused(): boolean` to the hook for the overlay's state.

## You own

`src/ui/threat.ts`, `threat.css`, `src/ui/bossBar.ts` and its styles, new `src/render/bossView.ts`,
`src/render/fxView.ts`, new `src/ui/pause.ts` and `pause.css`, `src/ui/hud.ts`/`hud.css` only to
make room for the button, `src/app/main.ts` (wiring only), `src/app/testHook.ts` (`paused()`
only), `src/audio/audio.ts` only if pause needs a method there, tests under `tests/unit/` for
what you add, `tests/e2e/routes/boss.mjs` and a new `tests/e2e/routes/pause.mjs`. You may add
entries to `PALETTE` in `src/render/look.ts` (add only). Nothing in `src/sim/`: a balance task is
editing its number tables right now. If you need something from the sim that is not there, stop
and say what.

## Acceptance

1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` pass. (Not
   `npm run perf` or the whole gate: the machine is busy. Do run `node tests/perf/run.mjs` once at
   the end if the machine is quiet and report the draw calls and frame time.)
2. Unit tests, pure where the logic is pure: the boss marker shows exactly when a boss is alive
   and out of frame and points the right way; it pulses in the tell and the charge; the ring cue
   shows only for a front that is unseen, still outside the rider and under 1.2 s away; the lane's
   length against tell time, its start point in the tell and in the charge, and that it is gone
   in the walk and the rest; the name is hidden when the run is over.
3. `tests/e2e/routes/boss.mjs`, extended: with the Bruiser placed behind the rider, the marker is
   in the DOM and visible; a screenshot during a tell with the lane crossing the frame
   (`artifacts/screens/boss-lane.png`); a screenshot of the Standstill's disc with a ring on it
   (`boss-aura.png`); one of an arrival effect (`boss-in.png`).
4. `tests/e2e/routes/pause.mjs`: the button pauses (tick stops advancing over real time), RESUME
   resumes; dispatching `visibilitychange` with the page hidden pauses and it stays paused when
   shown again; pausing with cards open and resuming leaves the cards open; pressing the button
   does not hop or steer (`state().events`, heading); no console errors. Screenshot `pause.png`.
5. Look at every screenshot you saved with the Read tool and say what you see: can the lane be
   told from the ground and from a rail; can the disc be told from tar; does the marker read as
   "the boss is that way"; is the pause button clear of the clock, the kills and the boss bar.

## Return

A short summary, decisions made, anything cut or uncertain, commands with pass/fail, changed
files, the branch name and last commit. No file contents.
